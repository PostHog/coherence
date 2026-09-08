import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, readdir, rename, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { TAXONOMY, LAB_TAXONOMY } from "../src/taxonomy/taxonomy-catalog.ts";
import { captureTaxonomy, classifyTaxonomy, profileTaxonomy, resolveTaxonomySubject, taxonomyStaleness, taxonomyHash } from "../src/taxonomy/taxonomy.ts";
import { recordTaxonomy, readTaxonomyRecords, taxonomyView } from "../src/taxonomy/taxonomy-ledger.ts";
import { runTaxonomyCommand } from "../src/taxonomy/taxonomy-cli.ts";
import { buildGraph } from "../src/derivation/derive.ts";
import { tmpProject, cfg, cleanup } from "./_helpers.ts";

const fixture = {
  "coherence.config.json": '{}\n', "coherence.spec.md": "# Fixture\n\n## intent\nTests taxonomy.\n",
  "src/session.ts": 'import { substrate } from "./transport.ts";\nexport function session() { return substrate(); }\n',
  "src/transport.ts": 'export function substrate() { return 1; }\n',
  "test/session.test.ts": 'export const observation = "reconnect preserves identity";\n',
};
const selection = { answers: { "signal:continuity": "yes" as const }, roles: ["role:session-subscription-owner"], facets: ["facet:lifecycle"] };
async function project() { const root = await tmpProject(fixture), config = cfg(root); return { root, config, graph: await buildGraph(config) }; }

test("taxonomy catalog — every frozen lab subject survives the namespaced port without added authority", async () => {
  const TAXONOMY = LAB_TAXONOMY;
  const lab = JSON.parse(await readFile(new URL("./fixtures/taxonomy-lab.json", import.meta.url), "utf8"));
  assert.deepEqual([TAXONOMY.roles.length, TAXONOMY.questions.length, TAXONOMY.facets.length, TAXONOMY.guarantees.length], [lab.roles.length, lab.evidenceQuestions.length, lab.facets.length, lab.guarantees.length]);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  for (const role of lab.roles) {
    const item = TAXONOMY.roles.find(r => r.id === `role:${slug(role.id)}`)!;
    assert.equal(item.label, role.id); assert.equal(item.responsibility, role.responsibility);
    assert.deepEqual(item.signals, role.signals.map((s: string) => `signal:${s}`));
    assert.deepEqual(item.cues, role.cues ?? []); assert.deepEqual(item.tensions, (role.excludes ?? []).map((s: string) => `signal:${s}`));
  }
  for (const question of lab.evidenceQuestions) assert.equal(TAXONOMY.questions.find(q => q.id === `signal:${question.id}`)?.question, question.question);
  for (const facet of lab.facets) assert.equal(TAXONOMY.facets.find(f => f.id === `facet:${facet.id}`)?.question, facet.question);
  for (const guarantee of lab.guarantees) {
    const item = TAXONOMY.guarantees.find(g => g.id === `guarantee:${guarantee.id}`)!;
    assert.equal(item.text, guarantee.text); assert.equal(item.level, guarantee.level);
    assert.equal(item.when, guarantee.when.role ? `role:${slug(guarantee.when.role)}` : `facet:${guarantee.when.facet}`);
  }
  const ids = [...TAXONOMY.roles, ...TAXONOMY.questions, ...TAXONOMY.facets, ...TAXONOMY.guarantees].map(v => v.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("taxonomy classification — unknowns and plural responsibilities never become a single guessed role or passing guarantee", () => {
  assert.equal(classifyTaxonomy().assessment, "unassessed");
  assert.equal(classifyTaxonomy({ answers: { "signal:continuity": "unknown" } }).candidates.length, 0);
  const answers = { "signal:continuity": "yes" as const, "signal:resource": "yes" as const };
  const proposal = classifyTaxonomy({ answers });
  assert.equal(proposal.assessment, "ambiguous");
  assert.ok(proposal.candidates.some(c => c.id === "role:session-subscription-owner" && c.tensions.length));
  const composite = classifyTaxonomy({ answers, roles: ["role:session-subscription-owner", "role:resource-driver"], facets: ["facet:lifecycle"] });
  assert.equal(composite.assessment, "composite");
  assert.ok(composite.suggestions.length > 0);
  assert.ok(composite.suggestions.every(g => g.status === "unverified"));
  assert.throws(() => classifyTaxonomy({ roles: ["CANONICAL_STATE"] }), /terminal role/);
  assert.throws(() => classifyTaxonomy({ roles: ["facet:state"] }), /terminal role/);
  assert.throws(() => classifyTaxonomy({ roles: ["role:session-subscription-owner"] }), /positive supporting signal/);
});

test("taxonomy domain — simulation does not erase core roles or activate outside its explicit pack", () => {
  assert.throws(() => classifyTaxonomy({ answers: { "signal:simulation-state": "yes" } }), /disabled/);
  assert.deepEqual(classifyTaxonomy({ facets: ["facet:deterministic"] }).suggestions.map(g => g.id), ["guarantee:G-DETERMINISM"]);
  const value = classifyTaxonomy({ domains: ["simulation"], answers: { "signal:simulation-state": "yes", "signal:execution": "yes" }, roles: ["role:simulation-state-authority", "role:runtime-executor"] });
  assert.equal(value.assessment, "composite");
  assert.ok(value.suggestions.some(g => g.id === "guarantee:G-SIM-SNAPSHOT"));
});

test("taxonomy interview — operational discriminators separate representation roles and preserve no-fit", () => {
  const answers = { "signal:representation": "yes" as const };
  const broad = classifyTaxonomy({ answers });
  assert.equal(broad.candidates.length, 4);
  assert.ok(broad.candidates.every(c => c.needsEvidence));
  for (const signal of ["signal:authority", "signal:execution"]) {
    const c = classifyTaxonomy({ answers: { [signal]: "yes" } });
    for (const candidate of c.candidates) if (candidate.needsEvidence)
      assert.ok(c.questions.some(q => q.id === candidate.needsEvidence), "a candidate requirement makes its own question relevant");
  }
  const operations = ["parses-syntax", "validates-rules", "transforms-form", "optimizes-form"];
  const roles = ["parser", "validator-type-checker", "lowerer-domain-transformer", "optimizer"];
  assert.deepEqual(new Set(broad.questions.slice(0, 4).map(q => q.id)), new Set(operations.map(s => `signal:${s}`)));
  for (let i = 0; i < roles.length; i++) {
    assert.throws(() => classifyTaxonomy({ answers, roles: [`role:${roles[i]}`] }), /operational evidence/);
    const specific = Object.fromEntries(operations.map((s, j) => [`signal:${s}`, i === j ? "yes" as const : "no" as const]));
    const result = classifyTaxonomy({ answers: { ...answers, ...specific }, roles: [`role:${roles[i]}`] });
    assert.deepEqual(result.candidates.map(c => c.id), [`role:${roles[i]}`]);
    assert.equal(result.assessment, "classified");
    assert.ok(result.suggestions.every(g => g.status === "unverified"));
  }
  const allNo = Object.fromEntries(TAXONOMY.questions.filter(q => q.pack === "core").map(q => [q.id, "no" as const]));
  assert.equal(classifyTaxonomy().assessment, "unassessed");
  assert.equal(classifyTaxonomy({ answers: { "signal:invocation": "no" } }).assessment, "needs-evidence");
  assert.equal(classifyTaxonomy({ answers: allNo }).assessment, "no-fit");
  const declarations = classifyTaxonomy({ answers: { ...allNo, ...answers, "signal:declarations-only": "yes" } });
  assert.equal(declarations.assessment, "no-fit"); assert.equal(declarations.candidates.length, 0);
  assert.throws(() => classifyTaxonomy({ answers: { "signal:parses-syntax": "yes", "signal:declarations-only": "yes" } }), /conflicts/);
  assert.equal(TAXONOMY.roles.length, LAB_TAXONOMY.roles.length, "no invented role to force a fit");
  for (const q of LAB_TAXONOMY.questions) assert.deepEqual(TAXONOMY.questions.find(n => n.id === q.id), q);
  for (const g of LAB_TAXONOMY.guarantees) assert.deepEqual(TAXONOMY.guarantees.find(n => n.id === g.id), g);
});

test("taxonomy history — old catalog assessments retain their meaning and expire without silent migration", async () => {
  const p = await project();
  try {
    const original = recordTaxonomy(p.config, p.graph, { ...selection, target: "src/session.ts", expected: null,
      session: "owner", because: "Historical assessment", evidence: ["src/session.ts"] });
    const { id, ...body } = original;
    body.snapshot.catalog = taxonomyHash(LAB_TAXONOMY);
    body.input = { domains: [], answers: { "signal:representation": "yes" }, roles: ["role:parser"], facets: [] };
    const historic = { ...body, id: `t-${taxonomyHash(body)}` };
    const path = join(p.root, ".coherence/taxonomy", (await readdir(join(p.root, ".coherence/taxonomy")))[0]);
    const bytes = JSON.stringify(historic) + "\n";
    await writeFile(path, bytes);
    const old = taxonomyView(p.config).items[0];
    assert.equal(old.status, "stale"); assert.equal(old.assessedCatalogVersion, LAB_TAXONOMY.version);
    assert.deepEqual(old.classification.roles, ["role:parser"]); assert.ok(old.staleReasons.includes("catalog changed"));
    assert.throws(() => recordTaxonomy(p.config, p.graph, { ...body.input, target: "src/session.ts", expected: historic.id,
      session: "owner", because: "Blind migration", evidence: ["src/session.ts"] }), /operational evidence/);
    recordTaxonomy(p.config, p.graph, { ...body.input, answers: { "signal:parses-syntax": "yes" }, target: "src/session.ts",
      expected: historic.id, session: "owner", because: "New operational assessment", evidence: ["src/session.ts"] });
    assert.equal(taxonomyView(p.config).items[0].assessedCatalogVersion, TAXONOMY.version);
    assert.equal(await readFile(path, "utf8"), bytes, "historical bytes survive the revision");
  } finally { await cleanup(p.root); }
});

test("taxonomy subjects — only resolved graph addresses enter evidence; absent, compound and escaped paths refuse", async () => {
  const p = await project();
  try {
    const subject = resolveTaxonomySubject(p.graph, "src/session.ts#session");
    assert.equal(subject.node, "s:src/session.ts#session"); assert.equal(subject.owner, "c:.");
    for (const address of ["../outside.ts", "/tmp/file.ts", "src/session.ts#missing", "src/session.ts#session#other", "src/session.ts#session other", "nope.ts"]) assert.throws(() => captureTaxonomy(p.config, p.graph, address));
    const snapshot = captureTaxonomy(p.config, p.graph, subject.target, ["test/session.test.ts"]);
    assert.ok(snapshot.files["src/transport.ts"]); assert.ok(snapshot.files["test/session.test.ts"]);
    assert.equal(snapshot.files["package.json"], null);
    assert.deepEqual(taxonomyStaleness(p.config, snapshot), []);
    await writeFile(join(p.root, "src/transport.ts"), "export function substrate() { return 2; }\n");
    assert.match(taxonomyStaleness(p.config, snapshot).join(), /src\/transport.ts/);
    await writeFile(join(p.root, "package.json"), '{"type":"module"}');
    assert.match(taxonomyStaleness(p.config, snapshot).join(), /package.json/);
  } finally { await cleanup(p.root); }
});

test("taxonomy ledger — immutable revisions, exact retries, stale-writer refusal and source expiration share one projection", async () => {
  const p = await project();
  try {
    const opts = { ...selection, target: "src/session.ts#session", expected: null, session: "owner", because: "Owns reconnect identity", evidence: ["src/session.ts"] };
    const a = recordTaxonomy(p.config, p.graph, opts);
    assert.equal(recordTaxonomy(p.config, p.graph, opts).id, a.id);
    assert.equal(taxonomyView(p.config).items[0].status, "classified");
    const b = recordTaxonomy(p.config, p.graph, { ...opts, expected: a.id, because: "Reviewed again" });
    assert.equal(taxonomyView(p.config).items[0].record.id, b.id);
    assert.equal(readTaxonomyRecords(p.config).length, 2);
    assert.throws(() => recordTaxonomy(p.config, p.graph, { ...opts, expected: a.id, because: "Conflicting writer" }), /advanced/);
    assert.throws(() => recordTaxonomy(p.config, p.graph, { ...opts, expected: "t-" + "a".repeat(64) }), /not current/);
    await writeFile(join(p.root, "src/session.ts"), "export function session() { return null; }\n");
    assert.equal(taxonomyView(p.config).items[0].status, "stale");
    assert.equal(readTaxonomyRecords(p.config)[0].basis, "caller-assessed");
  } finally { await cleanup(p.root); }
});

test("taxonomy damage — malformed or displaced history refuses instead of shrinking into a clean empty view", async () => {
  const p = await project();
  try {
    recordTaxonomy(p.config, p.graph, { ...selection, target: "src/session.ts", expected: null, session: "owner", because: "evidence", evidence: ["src/session.ts"] });
    const dir = join(p.root, ".coherence/taxonomy"), name = (await readdir(dir))[0], path = join(dir, name), bytes = await readFile(path, "utf8");
    await writeFile(path, bytes.trimEnd()); assert.throws(() => taxonomyView(p.config), /torn/);
    await writeFile(path, bytes.replace('"caller-assessed"', '"verified"')); assert.throws(() => taxonomyView(p.config), /schema/);
    await writeFile(path, bytes);
    await rename(path, join(dir, "unexpected.json")); assert.throws(() => taxonomyView(p.config), /Unexpected/);
  } finally { await cleanup(p.root); }
});

test("taxonomy containment — linked evidence and ledger directories refuse external reads and writes", async () => {
  const p = await project(), outside = await tmpProject({ "evidence.ts": "private" });
  try {
    await symlink(join(outside, "evidence.ts"), join(p.root, "linked.ts"));
    assert.throws(() => captureTaxonomy(p.config, p.graph, "src/session.ts", ["linked.ts"]), /contained/);
    await mkdir(join(p.root, ".coherence")); await symlink(outside, join(p.root, ".coherence/taxonomy"));
    assert.throws(() => recordTaxonomy(p.config, p.graph, { ...selection, target: "src/session.ts", expected: null, session: "owner", because: "evidence", evidence: ["src/session.ts"] }), /contained/);
    assert.deepEqual(await readdir(outside), ["evidence.ts"]);
  } finally { await cleanup(p.root); await cleanup(outside); }
});

test("taxonomy CLI — discovery is read-only, recording is explicit, and unsupported assurance cannot be attested", async () => {
  const p = await project();
  try {
    const run = (...args: string[]) => runTaxonomyCommand(p.config, args);
    assert.equal((await run("profile", "--json")).code, 0);
    assert.equal((await run("inspect", "src/session.ts", "--json")).code, 0);
    assert.equal((await run("list", "--check")).code, 1);
    assert.equal((await run("record", "src/session.ts", "--role", "role:parser")).code, 2);
    for (const args of [["attest"], ["record", "src/session.ts", "--status", "satisfied"], ["list", "--session", "a", "--session", "b"], ["inspect", "src/session.ts", "--answer", "signal:continuity=yes", "--answer", "signal:continuity=no"]]) assert.equal((await run(...args)).code, 2);
    const recorded = await run("record", "src/session.ts", "--expected", "none", "--session", "owner", "--because", "identity", "--evidence", "src/session.ts", "--answer", "signal:continuity=yes", "--role", "role:session-subscription-owner", "--json");
    assert.equal(recorded.code, 0, recorded.output);
    assert.equal((await run("list", "--check")).code, 0);
    assert.equal((await run("list", "--session", "nobody", "--check")).code, 1);
    const id = JSON.parse(recorded.output).record.id;
    assert.equal((await run("show", id, "--json")).code, 0);
    const revisited = JSON.parse((await run("inspect", "./src/session.ts", "--json")).output);
    assert.equal(revisited.currentAssessment.record.id, id);
    assert.equal(revisited.classification.assessment, "unassessed", "fresh proposal never silently copies the saved answers");
    assert.match((await run("inspect", "src/session.ts")).output, /Saved assessment: classified/);
  } finally { await cleanup(p.root); }
});

test("taxonomy durability — a fresh clone reconstructs records and committed population deletion refuses", async () => {
  const p = await project(), cloneParent = await tmpProject();
  const git = (args: string[], cwd = p.root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    await writeFile(join(p.root, ".gitignore"), await readFile(new URL("../.gitignore", import.meta.url), "utf8"));
    const record = recordTaxonomy(p.config, p.graph, { ...selection, target: "src/session.ts", expected: null, session: "owner", because: "identity", evidence: ["src/session.ts"] });
    git(["init", "-q"]); git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
    assert.match(git(["ls-files", ".coherence/taxonomy"]), /slot-/);
    const clone = join(cloneParent, "clone"); git(["clone", "--quiet", p.root, clone]);
    assert.equal(taxonomyView(cfg(clone)).items[0].record.id, record.id);
    await rename(join(clone, ".coherence/taxonomy"), join(clone, ".coherence/saved-taxonomy"));
    assert.throws(() => taxonomyView(cfg(clone)), /population disappeared/);
  } finally { await cleanup(p.root); await cleanup(cloneParent); }
});

test("taxonomy profile — manifests are evidence, not inferred simulation or executable configuration", async () => {
  const root = await tmpProject({ "package.json": '{"bin":"dist/cli.js","scripts":{"prepare":"exit 99"}}' });
  try {
    const value = profileTaxonomy(cfg(root));
    assert.ok(value.facts.some(f => f.fact === "declares bin"));
    assert.deepEqual(value.enabledPacks, ["core"]);
  } finally { await cleanup(root); }
});

test("taxonomy concurrency — two CLI writers cannot both own the initial predecessor slot", async () => {
  const p = await project();
  const execute = promisify(execFile), cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  try {
    const results = await Promise.all(["one", "two"].map(async session => {
      try {
        await execute(process.execPath, [cli, "taxonomy", "record", "src/session.ts", "--expected", "none", "--session", session,
          "--because", session, "--answer", "signal:continuity=yes", "--role", "role:session-subscription-owner", "--evidence", "src/session.ts", "--json"], { cwd: p.root });
        return 0;
      } catch (error) { return (error as { code: number }).code; }
    }));
    assert.deepEqual(results.sort(), [0, 2]);
    assert.equal(readTaxonomyRecords(p.config).length, 1);
  } finally { await cleanup(p.root); }
});
