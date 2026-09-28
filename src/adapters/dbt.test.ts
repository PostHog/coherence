/**
 * The dbt adapter over a small dbt project written into a temporary folder,
 * with the manifest dbt would write for it: staging models, a folder of
 * entry models, the model that composes them, a projection downstream, a
 * diagnostic, a singular test and a YAML-declared test. Name forms, one site
 * per manifest edge, the test flag a YAML test carries, the chokepoint
 * grades and the in-memory refutation, a stale manifest answering nothing,
 * the dbt runner's report, the routing of vias, and two instruments in one
 * project.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { checkChokepoint, classifySite } from "../enforcement/check.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { performRun, routesFor } from "../enforcement/run.ts";
import { parseReport, runTotalityBatch, verdictsFromReport } from "../enforcement/totality.ts";
import type { Definition, LanguageAdapter, ReferenceSite, Resolved } from "./adapter.ts";
import { CompositeAdapter } from "./composite.ts";
import { DbtAdapter, dbtPaths, locate, readManifestText } from "./dbt.ts";

/** One model or test of the fixture: its file, what it depends on, and its text. */
interface Fixture {
  type: "model" | "test";
  name: string;
  file: string;
  refs: string[];
  text: string;
  id?: string;
}

const MODELS: Fixture[] = [
  { type: "model", name: "stg_charges", file: "models/staging/stg_charges.sql", refs: [], text: "select * from {{ source('stripe', 'charges') }}\n" },
  { type: "model", name: "revenue_entries", file: "models/book/entries/revenue_entries.sql", refs: ["stg_charges"], text: "-- revenue\nselect *\nfrom {{ ref('stg_charges') }}\n" },
  { type: "model", name: "payment_entries", file: "models/book/entries/payment_entries.sql", refs: ["stg_charges"], text: "select * from {{ ref(\"stg_charges\") }}\n" },
  { type: "model", name: "book", file: "models/book/book.sql", refs: ["revenue_entries", "payment_entries"], text: "select * from {{ ref('revenue_entries') }}\nunion all\nselect * from {{ ref('payment_entries') }}\n" },
  { type: "model", name: "account_balances", file: "models/book/balances/account_balances.sql", refs: ["book"], text: "select * from {{ ref('book') }}\n" },
  { type: "model", name: "diag_entries", file: "models/book/diagnostics/diag_entries.sql", refs: ["revenue_entries"], text: "select * from {{ ref('revenue_entries') }}\n" },
  // A ref dbt resolves that no literal call writes: the edge is still a site, at line 1.
  { type: "model", name: "dynamic_reader", file: "models/book/balances/dynamic_reader.sql", refs: ["book"], text: "{% set target = 'led' ~ 'ger' %}\nselect * from {{ ref(target) }}\n" },
  { type: "test", name: "book_balances", file: "tests/book_balances.sql", refs: ["book"], text: "select * from {{ ref('book') }} where debit <> credit\n" },
  { type: "test", name: "not_null_revenue_entries_entry_id", id: "test.fixture.not_null_revenue_entries_entry_id.a1b2c3", file: "models/book/schema.yml", refs: ["revenue_entries"], text: "" },
];

const SCHEMA_YML = `version: 2
models:
  - name: book
    columns:
      - name: entry_id
  - name: revenue_entries
    columns:
      - name: entry_id
        tests:
          - not_null
`;

const BYPASS = "select * from {{ ref('book') }}\nunion all\nselect * from {{ ref('revenue_entries') }}\n";

const SPEC = `# Book

Compose every entry family into one book.

## invariants
- entries cross the book: Every consumer reads the entry families through the book.
  protects: models/book/entries/
  chokepoint: book
  because: projections must reuse the one balanced history
  kinds: none
- book balances: Every entry has equal debit and credit legs.
  over: every entry in the book
  via: book_balances
  because: value must not be created or destroyed
  kinds: none
`;

let root: string;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

function idOf(f: Fixture): string {
  return f.id ?? `${f.type}.fixture.${f.name}`;
}

/** The manifest dbt would write for the fixture: nodes with their files, edges, access, and text. */
function manifest(fixtures: readonly Fixture[] = MODELS): string {
  const byName = new Map(fixtures.filter((f) => f.type === "model").map((f) => [f.name, idOf(f)]));
  const nodes = Object.fromEntries(
    fixtures.map((f) => [
      idOf(f),
      { unique_id: idOf(f), resource_type: f.type, name: f.name, original_file_path: f.file, depends_on: { nodes: f.refs.map((r) => byName.get(r)!) }, access: f.type === "model" ? "protected" : undefined, raw_code: f.text },
    ]),
  );
  return JSON.stringify({ metadata: { dbt_schema_version: "https://schemas.getdbt.com/dbt/manifest/v12.json", project_name: "fixture" }, nodes, sources: {} });
}

/** Write the manifest, then set every dbt file a minute older, so the manifest is current. */
function writeManifest(fixtures: readonly Fixture[] = MODELS): void {
  write("target/manifest.json", manifest(fixtures));
  const past = new Date(Date.now() - 60_000);
  for (const f of [...fixtures.filter((x) => x.text !== "").map((x) => x.file), "models/book/schema.yml", "dbt_project.yml"]) utimesSync(join(root, f), past, past);
}

const hint = { component: "models/book", testFolders: ["tests", "diagnostics"] };

async function resolved(adapter: LanguageAdapter, name: string): Promise<Definition> {
  const r = await adapter.resolve(name, hint);
  assert.ok(r.ok, `${name} resolves: ${r.ok ? "" : r.reason}`);
  return r.definition;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "coherence-dbt-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  write("dbt_project.yml", "name: fixture\nmodel-paths: [\"models\"]\ntest-paths:\n  - tests\n");
  for (const f of MODELS) if (f.text !== "") write(f.file, f.text);
  write("models/book/schema.yml", SCHEMA_YML);
  write("models/book/Book.spec.md", SPEC);
  write("coherence.config.json", JSON.stringify({ language: "dbt", testDirs: ["diagnostics"], dbt: { manifest: "target/manifest.json" } }));
  writeManifest();
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

test("dbt_project.yml paths: flow lists, block lists, and dbt's defaults for keys it omits", () => {
  assert.deepEqual(dbtPaths("model-paths: [\"models\", 'more']\ntest-paths:\n  - checks\n"), ["models", "more", "checks", "seeds", "snapshots", "macros", "analyses"]);
});

test("a model resolves by name, by name in its file, as a module by its file, and as a module by its folder; prose and unknown names do not", async () => {
  const adapter = new DbtAdapter(root);
  const byName = await resolved(adapter, "book");
  assert.equal(byName.kind, "symbol");
  assert.equal(byName.file, "models/book/book.sql");
  assert.equal((await resolved(adapter, "book in models/book/book.sql")).file, "models/book/book.sql");
  const file = await resolved(adapter, "models/book/book.sql");
  assert.equal(file.kind, "module");
  const folder = await resolved(adapter, "models/book/entries/");
  assert.equal(folder.kind, "module");
  assert.deepEqual(folder.members, ["models/book/entries/payment_entries.sql", "models/book/entries/revenue_entries.sql"]);
  const prose = await adapter.resolve("the entry families", hint);
  assert.equal(prose.ok, false);
  const unknown = await adapter.resolve("no_such_model", hint);
  assert.ok(!unknown.ok && /names no dbt model/.test(unknown.reason));
  const empty = await adapter.resolve("models/staging/nothing/", hint);
  assert.ok(!empty.ok && /holds no dbt model/.test(empty.reason));
});

test("every manifest edge is a reference: one site per edge, at the ref call, at line 1 when no literal call writes it, and a YAML test at its name line", async () => {
  const adapter = new DbtAdapter(root);
  const book = await resolved(adapter, "book");
  const sites = await adapter.references(book);
  const edges = MODELS.filter((f) => f.refs.includes("book"));
  assert.equal(sites.length, edges.length, "every edge into book is a site, the computed ref included");
  const at = (file: string): ReferenceSite => sites.find((s) => s.file === file)!;
  assert.deepEqual({ line: at("models/book/balances/account_balances.sql").line, character: at("models/book/balances/account_balances.sql").character }, { line: 1, character: 17 });
  assert.equal(at("models/book/balances/dynamic_reader.sql").line, 1, "a computed ref is located at line 1");
  assert.equal(at("models/book/balances/dynamic_reader.sql").symbol, "dynamic_reader");
  assert.equal(at("tests/book_balances.sql").testResource, true);

  const entries = await adapter.references(await resolved(adapter, "models/book/entries/"));
  const yaml = entries.find((s) => s.file === "models/book/schema.yml");
  assert.ok(yaml !== undefined, "a test declared in YAML is a site");
  assert.equal(yaml.line, 6, "at the name line of the model it tests");
  assert.equal(yaml.testResource, true, "a test resource is a test site wherever its file lies");
  assert.equal(entries.filter((s) => s.file === "models/book/book.sql").length, 2, "book reads both entry models: two edges, two sites");
});

test("locate: a ref with a package, a double-quoted ref, and a source call", () => {
  const model = { id: "model.p.orders", type: "model", name: "orders", file: undefined, dependsOn: [] };
  assert.deepEqual(locate("select 1\nfrom {{ ref('pkg', 'orders') }}", model, false), { line: 2, character: 8 });
  assert.deepEqual(locate('{{ ref("orders") }}', model, false), { line: 1, character: 3 });
  const source = { id: "source.p.stripe.charges", type: "source", name: "charges", file: undefined, dependsOn: [] };
  assert.deepEqual(locate("from {{ source('stripe', 'charges') }}", source, false), { line: 1, character: 8 });
});

test("a test resource is a test site wherever its file lies: the adapter marks a YAML test under a model folder, and the check classifies it a test", async () => {
  const adapter = new DbtAdapter(root);
  const entries = await resolved(adapter, "models/book/entries/");
  const book = await resolved(adapter, "book");
  const yaml = (await adapter.references(entries)).find((s) => s.file === "models/book/schema.yml");
  assert.ok(yaml !== undefined);
  assert.equal(yaml.testResource, true, "the manifest says the referencing resource is a test");
  assert.equal(classifySite(yaml, entries, book, ["tests"]), "test");
  const { testResource: _, ...plain } = yaml;
  assert.equal(classifySite(plain, entries, book, ["tests"]), "bypass", "without the instrument's word the same site is a bypass");
});

test("a module is its folder: a site in any member file is inside, a site beside the folder is not", async () => {
  const adapter = new DbtAdapter(root);
  const entries = await resolved(adapter, "models/book/entries/");
  const book = await resolved(adapter, "book");
  const site = (file: string): ReferenceSite => ({ file, line: 1, character: 0, symbol: "x" });
  assert.equal(classifySite(site("models/book/entries/payment_entries.sql"), entries, book, []), "inside");
  assert.equal(classifySite(site("models/book/entries_extra/other.sql"), entries, book, []), "bypass", "a folder whose name merely starts the same is not the module");
  assert.equal(classifySite(site("models/book/book.sql"), entries, book, []), "inside", "the chokepoint's own file");
});

test("the chokepoint grades reference-choked with an automatic refutation staged in memory, and nothing is written", async () => {
  const adapter = new DbtAdapter(root);
  const input = { protects: "models/book/entries/", chokepoint: "book", component: "models/book", testFolders: readEnforcementConfig(root).testFolders, root };
  const before = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;
  const result = await checkChokepoint(adapter, input);
  assert.equal(result.verdict, "pass", result.reason);
  assert.equal(result.grade, "reference-choked");
  assert.equal(result.refutation, "automatic", result.refutationAccount);
  assert.match(result.refutationAccount, /coherence_refutation_[0-9a-f]+\.sql downstream of book that refs payment_entries directly/);
  assert.equal(result.counts.test, 2, "the YAML test and the diagnostic are test references");
  assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout, before, "the refutation wrote nothing");
});

test("a consumer downstream of the chokepoint that reads a protected model directly is a bypass, named by file and line, whatever other chokepoint also guards that model", async () => {
  write("models/book/balances/account_balances.sql", BYPASS);
  writeManifest(MODELS.map((f) => (f.name === "account_balances" ? { ...f, refs: ["book", "revenue_entries"], text: BYPASS } : f)));
  try {
    const adapter = new DbtAdapter(root);
    const testFolders = readEnforcementConfig(root).testFolders;
    const outer = await checkChokepoint(adapter, { protects: "models/book/entries/", chokepoint: "book", component: "models/book", testFolders, root });
    assert.equal(outer.verdict, "fail");
    assert.equal(outer.grade, "broken");
    assert.deepEqual(outer.bypasses, [{ file: "models/book/balances/account_balances.sql", line: 3, symbol: "account_balances" }]);
    // The reference implementation's shadow stopped at a nested chokepoint and missed exactly this: here a second
    // invariant guarding the entry models' own input changes nothing about the first.
    const inner = await checkChokepoint(adapter, { protects: "stg_charges", chokepoint: "models/book/entries/", component: "models/book", testFolders, root });
    assert.equal(inner.verdict, "pass", inner.reason);
    const again = await checkChokepoint(adapter, { protects: "revenue_entries", chokepoint: "book", component: "models/book", testFolders, root });
    assert.equal(again.grade, "broken", "the same read bypasses the book when the protected thing is one entry model");
  } finally {
    write("models/book/balances/account_balances.sql", MODELS.find((f) => f.name === "account_balances")!.text);
    writeManifest();
  }
});

test("a stale manifest answers nothing: a dbt file newer than the manifest makes ready fail and every question throw, until a configured parse makes it current", async () => {
  const future = new Date(Date.now() + 60_000);
  utimesSync(join(root, "models/book/book.sql"), future, future);
  try {
    const stale = new DbtAdapter(root);
    const state = await stale.ready();
    assert.ok(!state.ok && /older than models\/book\/book\.sql/.test(state.reason), state.ok ? "ready" : state.reason);
    await assert.rejects(stale.resolve("book", hint), /dbt instrument: .*older than/);
    const run = await performRun(root, { session: "stale", agent: "dbt", adapter: stale, form: "chokepoint" });
    assert.equal(run.record.invariants[0]!.verdict, "not run");
    assert.equal(run.instrumentDied, true);

    let parses = 0;
    const settings = { manifest: "target/manifest.json", snapshot: false, parse: ["dbt", "parse"], parseTimeoutMs: 1000, test: undefined, testJson: undefined, testMatch: undefined, testTimeoutMs: undefined };
    const parsing = new DbtAdapter(root, settings, () => {
      parses += 1;
      write("target/manifest.json", manifest());
      utimesSync(join(root, "target/manifest.json"), new Date(Date.now() + 120_000), new Date(Date.now() + 120_000));
      return { ok: true, output: "" };
    });
    assert.deepEqual(await parsing.ready(), { ok: true });
    assert.equal(parses, 1);
    assert.equal((await resolved(parsing, "book")).file, "models/book/book.sql");

    const failing = new DbtAdapter(root, settings, () => ({ ok: false, output: "Compilation Error\n  model book refers to a missing node" }));
    utimesSync(join(root, "models/book/book.sql"), new Date(Date.now() + 240_000), new Date(Date.now() + 240_000));
    const failed = await failing.ready();
    assert.ok(!failed.ok && /the dbt parse command failed/.test(failed.reason));
  } finally {
    rmSync(join(root, ".coherence"), { recursive: true, force: true });
    writeManifest();
  }
});

test("the reference implementation's committed snapshot reads as a manifest, and says so", async () => {
  const snapshot = { version: 2, project: "fixture", resources: MODELS.map((f) => ({ uniqueId: idOf(f), resourceType: f.type, name: f.name, originalFilePath: f.file, dependsOn: f.refs.map((r) => `model.fixture.${r}`) })) };
  const read = readManifestText(JSON.stringify(snapshot), "snap");
  assert.equal(read.resources.length, MODELS.length);
  write(".coherence/dbt-manifest.json", JSON.stringify(snapshot));
  try {
    const settings = { manifest: ".coherence/dbt-manifest.json", snapshot: true, parse: undefined, parseTimeoutMs: 1000, test: undefined, testJson: undefined, testMatch: undefined, testTimeoutMs: undefined };
    const adapter = new DbtAdapter(root, settings);
    assert.deepEqual(await adapter.ready(), { ok: true });
    const visibility = await adapter.visibility(await resolved(adapter, "book"));
    assert.match(visibility.evidence, /the snapshot carries no access/);
    assert.match(visibility.rung!.fact, /the committed snapshot \.coherence\/dbt-manifest\.json \(not dbt's own manifest\)/);
  } finally {
    rmSync(join(root, ".coherence"), { recursive: true, force: true });
  }
});

/** A fake `dbt test`: writes run_results.json under --target-path with a status per test name, as dbt does. */
const FAKE_DBT = `
const args = process.argv.slice(1);
const select = args[args.indexOf("--select") + 1].split(" ");
const dir = args[args.indexOf("--target-path") + 1];
const statuses = { book_balances: "pass", not_null_revenue_entries_entry_id: "warn", broken_test: "fail" };
const results = select.filter((n) => n in statuses).map((n) => ({ unique_id: n === "not_null_revenue_entries_entry_id" ? "test.fixture." + n + ".a1b2c3" : "test.fixture." + n, status: statuses[n], message: statuses[n] === "pass" ? null : "Got 3 results, configured to " + statuses[n] + " if != 0", failures: statuses[n] === "pass" ? 0 : 3 }));
require("node:fs").writeFileSync(dir + "/run_results.json", JSON.stringify({ metadata: { dbt_schema_version: "https://schemas.getdbt.com/dbt/run-results/v6.json" }, results }));
process.exit(results.some((r) => r.status === "fail") ? 1 : 0);
`;

test("a dbt result maps by unique id: one invocation's run_results.json gives each test its verdict, a warning passes and says so, and a name matching no result reports matched 0", async () => {
  const runner = { ...readEnforcementConfig(root), testJson: ["node", "-e", FAKE_DBT, "--", "--select", "{filter}", "--target-path", "{outdir}"], testFilterForm: "dbt" as const };
  const batch = await runTotalityBatch(root, runner, ["book_balances", "not_null_revenue_entries_entry_id", "broken_test", "absent_test"]);
  assert.ok(batch !== undefined);
  assert.equal(batch.get("book_balances")!.verdict, "pass");
  assert.equal(batch.get("not_null_revenue_entries_entry_id")!.verdict, "pass");
  assert.match(batch.get("not_null_revenue_entries_entry_id")!.reason, /1 warned at severity warn \(Got 3 results, configured to warn if != 0\)/);
  assert.equal(batch.get("broken_test")!.verdict, "fail");
  assert.equal(batch.get("absent_test")!.verdict, "fail");
  assert.equal(batch.get("absent_test")!.matched, 0);

  // A unique id's name segment is the test's name; a longer name the id merely starts with is a different test.
  const report = parseReport(JSON.stringify({ metadata: { dbt_schema_version: "https://schemas.getdbt.com/dbt/run-results/v6.json" }, results: [{ unique_id: "test.fixture.book_balances_extra", status: "fail" }] }));
  assert.equal(verdictsFromReport(report, ["book_balances"], "dbt").get("book_balances")!.matched, 0);
});

test("a via the dbt manifest names as a test runs through the dbt runner; every other via through the project-wide runner; a name held twice runs nowhere", () => {
  write("coherence.config.json", JSON.stringify({ language: ["dbt", "python"], testDirs: ["diagnostics"], test: ["pytest", "-k"], dbt: { manifest: "target/manifest.json", testJson: ["dbt", "test", "--select", "{filter}"] } }));
  try {
    const config = readEnforcementConfig(root);
    assert.deepEqual(config.instruments, ["dbt", "python"]);
    assert.equal(config.language, "python", "the plain scans read the first language with source files of its own");
    const routes = routesFor(root, config, ["book_balances", "test_allocation_property"]);
    const dbt = routes.get("book_balances")!;
    assert.equal(dbt.runner, "dbt");
    assert.equal(dbt.runner === "dbt" ? dbt.config.testFilterForm : undefined, "dbt");
    assert.equal(routes.get("test_allocation_property")!.runner, "project");

    writeManifest([...MODELS, { type: "test", name: "book_balances", id: "test.other.book_balances", file: "tests/other.sql", refs: ["book"], text: "" }]);
    const twice = routesFor(root, config, ["book_balances"]).get("book_balances")!;
    assert.equal(twice.runner, "none");
    assert.match(twice.runner === "none" ? twice.reason : "", /holds 2 tests named "book_balances"/);
  } finally {
    write("coherence.config.json", JSON.stringify({ language: "dbt", testDirs: ["diagnostics"], dbt: { manifest: "target/manifest.json" } }));
    writeManifest();
  }
});

test("a run over the dbt instrument grades the chokepoint and runs the totality oracle through the dbt runner, in one record", async () => {
  write("coherence.config.json", JSON.stringify({ language: "dbt", testDirs: ["diagnostics"], dbt: { manifest: "target/manifest.json", testJson: ["node", "-e", FAKE_DBT, "--", "--select", "{filter}", "--target-path", "{outdir}"] } }));
  writeManifest();
  try {
    const outcome = await performRun(root, { session: "dbt-run", agent: "dbt", adapter: new DbtAdapter(root) });
    const byName = new Map(outcome.record.invariants.map((e) => [e.name, e]));
    assert.equal(byName.get("entries cross the book")!.grade, "reference-choked");
    assert.equal(byName.get("entries cross the book")!.refutation, "automatic");
    assert.equal(byName.get("book balances")!.verdict, "pass");
    assert.equal(byName.get("book balances")!.mode, "batched");
  } finally {
    rmSync(join(root, ".coherence"), { recursive: true, force: true });
    write("coherence.config.json", JSON.stringify({ language: "dbt", testDirs: ["diagnostics"], dbt: { manifest: "target/manifest.json" } }));
    writeManifest();
  }
});

/** A member adapter that resolves the names it is given and reports one site for each. */
function fakeMember(language: string, names: Record<string, string>, ready: { ok: true } | { ok: false; reason: string } = { ok: true }): LanguageAdapter {
  return {
    language,
    ladder: { top: "reference-choked", because: `${language} fixture`, rungs: [{ grade: "reference-choked", enforcer: "Coherence's check", fact: "fixture" }] },
    ready: async () => ready,
    resolve: async (name): Promise<Resolved> => (names[name] === undefined ? { ok: false, reason: `${language} knows no ${name}` } : { ok: true, definition: { name, kind: "symbol", file: names[name]!, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, selection: { line: 0, character: 0 } } }),
    references: async (definition) => [{ file: `${language}-reader`, line: 1, character: 0, symbol: definition.name }],
    visibility: async () => ({ enforced: false, visible: true, evidence: language }),
    testFilter: (via) => `${language}:${via}`,
    refute: async () => ({ seen: false, staged: [], account: language }),
    forget: async () => {},
    close: async () => {},
  };
}

test("two instruments in one project: the member that resolves a name answers every question about it, a name two members resolve is ambiguous, and one member down makes the composite not ready", async () => {
  const composite = new CompositeAdapter([fakeMember("dbt", { book: "models/book.sql", shared: "models/shared.sql" }), fakeMember("python", { allocate: "allocation/engine.py", shared: "shared.py" })]);
  assert.equal(composite.language, "dbt+python");
  const allocate = await composite.resolve("allocate", hint);
  assert.ok(allocate.ok);
  assert.equal((await composite.references(allocate.definition))[0]!.file, "python-reader");
  const book = await composite.resolve("book", hint);
  assert.ok(book.ok);
  assert.equal((await composite.references(book.definition))[0]!.file, "dbt-reader");
  const shared = await composite.resolve("shared", hint);
  assert.ok(!shared.ok && /resolves through 2 instruments/.test(shared.reason));
  assert.deepEqual(!shared.ok && shared.candidates, ["dbt: models/shared.sql", "python: shared.py"]);
  const neither = await composite.resolve("nothing", hint);
  assert.ok(!neither.ok && /^dbt: dbt knows no nothing; python: python knows no nothing$/.test(neither.reason));
  await assert.rejects(composite.references({ ...book.definition, file: "elsewhere.sql" }), /no instrument resolved/);
  const down = new CompositeAdapter([fakeMember("dbt", {}), fakeMember("python", {}, { ok: false, reason: "pyright did not start" })]);
  assert.deepEqual(await down.ready(), { ok: false, reason: "python: pyright did not start" });
});
