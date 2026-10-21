/**
 * A language Coherence has no adapter for, declared in the config and read
 * through its language server alone (declared.ts). The server here is a stub
 * for a toy language (declared-stub-server.ts), a real process speaking the
 * protocol over stdio, so the adapter's every request crosses a pipe as it
 * would to sourcekit-lsp or gopls. The config is read strictly; the adapter
 * resolves, lists references, earns reference-choked and no rung above it,
 * and its refutation stages the config's template as an unsaved document and
 * requires the server to report it; a run routes the language's chokepoints
 * to it, and every reading names the language as not read.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { DeclaredAdapter, readDeclaredLanguages, type DeclaredLanguage } from "./declared.ts";
import { instrumentFor } from "./index.ts";
import { checkChokepoint } from "../enforcement/check.ts";
import { DEFAULT_TEST_FOLDERS, readEnforcementConfig } from "../enforcement/config.ts";
import { enforcementLanguages, performRun } from "../enforcement/run.ts";
import { loadRuns } from "../enforcement/record.ts";
import { DECLARED_NOT_READ, languagesReadLine, scannedLanguagesRead } from "../readings/scope/languages-read.ts";
import { cli } from "../lifecycle/cli-fixture.ts";

const STUB = fileURLToPath(new URL("./declared-stub-server.ts", import.meta.url));

const TOY: DeclaredLanguage = {
  name: "toy",
  extensions: [".toy"],
  server: [process.execPath, "--disable-warning=ExperimentalWarning", STUB],
  testFilter: "toy::{name}",
  refute: "def coherence_probe\n  {name}\n",
};

const SPEC = `# Toy

A toy-language store whose secret leaves only through seal.

## invariants
- toy egress: A secret leaves the store only through seal.
  protects: SECRET
  chokepoint: seal
  because: a leaked row must disclose no usable bearer
  kinds: none
`;

const SECRETS = "def SECRET\n  token\ndef seal\n  SECRET\n";
const RENDER_BYPASS = "def render\n  seal\n  SECRET\n";
const RENDER_CLEAN = "def render\n  seal\n";

let root: string;
let adapter: DeclaredAdapter;
const hint = { component: ".", testFolders: [...DEFAULT_TEST_FOLDERS] };

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "coherence-declared-"));
  write("coherence.config.json", JSON.stringify({ language: "toy", languages: { toy: { extensions: TOY.extensions, server: TOY.server, testFilter: TOY.testFilter, refute: TOY.refute } } }));
  write("Toy.spec.md", SPEC);
  write("store/secrets.toy", SECRETS);
  write("api/render.toy", RENDER_BYPASS);
  write("tests/secrets.toy", "def t\n  SECRET\n");
  // A repository, as a real project is: its files are what git lists, so an unsaved document is evidence only because a refutation staged it.
  execFileSync("git", ["init", "-q"], { cwd: root });
  adapter = new DeclaredAdapter(root, TOY);
});

after(async () => {
  await adapter.close();
  rmSync(root, { recursive: true, force: true });
});

test("a declared language is read from the config strictly: a built-in's name, a missing server, an extension a built-in owns, a language the language key does not name, and an unknown name are each refused", () => {
  const refused = (raw: unknown, pattern: RegExp): void => assert.throws(() => readDeclaredLanguages(raw, "coherence.config.json"), pattern);
  refused({ python: { extensions: [".pyx"], server: ["x"] } }, /languages\.python is a built-in language/);
  refused({ swift: { extensions: [".swift"] } }, /languages\.swift\.server is the language server's command/);
  refused({ swift: { server: ["sourcekit-lsp"] } }, /languages\.swift\.extensions is a list of file extensions/);
  refused({ swift: { extensions: [".ts"], server: ["sourcekit-lsp"] } }, /names \.ts, which the built-in typescript adapter reads/);
  refused({ a: { extensions: [".x"], server: ["s"] }, b: { extensions: [".x"], server: ["s"] } }, /names \.x, which languages\.a already owns/);
  refused({ swift: { extensions: [".swift"], server: ["sourcekit-lsp"], refute: "nothing here" } }, /refute names neither \{name\} nor \{module\}/);
  refused({ swift: { extensions: [".swift"], server: ["sourcekit-lsp"], lint: true } }, /has lint; a declared language reads extensions, server, testFilter and refute/);
  assert.deepEqual(readDeclaredLanguages({ swift: { extensions: [".swift"], server: ["sourcekit-lsp"] } }, "c"), [{ name: "swift", extensions: [".swift"], server: ["sourcekit-lsp"] }]);

  const project = mkdtempSync(join(tmpdir(), "coherence-declared-config-"));
  const config = (raw: object): ReturnType<typeof readEnforcementConfig> => {
    writeFileSync(join(project, "coherence.config.json"), JSON.stringify(raw));
    return readEnforcementConfig(project);
  };
  try {
    const swift = { swift: { extensions: [".swift"], server: ["sourcekit-lsp"] } };
    assert.throws(() => config({ languages: swift }), /languages declares swift, which language does not name/);
    assert.throws(() => config({ language: "swiftt", languages: swift }), /language names "swiftt"; each is one of typescript, python, rust, swift/);
    assert.throws(() => config({ language: "go" }), /language names "go"; each is one of typescript, python, rust \(or a language declared under languages\)/);
    const mixed = config({ language: ["typescript", "swift"], languages: swift });
    assert.deepEqual([mixed.language, mixed.languages, mixed.enforced, mixed.declared.map((d) => d.name)], ["typescript", ["typescript"], ["typescript", "swift"], ["swift"]]);
    const alone = config({ language: "swift", languages: swift });
    assert.deepEqual([alone.language, alone.languages, alone.enforced], ["swift", [], ["swift"]]);
    assert.throws(() => instrumentFor("cobol", project, alone.declared), /cobol is neither a built-in language/);
    assert.ok(instrumentFor("swift", project, alone.declared) instanceof DeclaredAdapter);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a declared language's server resolves a name and lists its references; nothing above reference-choked is claimed, and the via becomes the declared test filter", async () => {
  const resolved = await adapter.resolve("SECRET", hint);
  assert.ok(resolved.ok, resolved.ok ? "" : resolved.reason);
  assert.equal(resolved.definition.file, "store/secrets.toy");
  const sites = await adapter.references(resolved.definition);
  assert.deepEqual(sites.map((s) => `${s.file}:${s.line} ${s.symbol}`), ["api/render.toy:3 render", "store/secrets.toy:4 seal", "tests/secrets.toy:2 t"]);
  const visibility = await adapter.visibility(resolved.definition);
  assert.equal(visibility.enforced, false);
  assert.equal(visibility.rung?.grade, "reference-choked");
  assert.match(visibility.evidence, /toy via declared-stub-server\.ts \(declared in the config\) is read through the language server protocol alone/);
  assert.deepEqual(adapter.ladder.rungs.map((r) => r.grade), ["reference-choked"]);
  assert.equal(adapter.testFilter("strips every token"), "toy::strips every token");
  const missing = await adapter.resolve("NOWHERE", hint);
  assert.ok(!missing.ok && /toy via declared-stub-server\.ts \(declared in the config\) knows no symbol named NOWHERE/.test(missing.reason));
});

test("a declared language's chokepoint grades broken with its bypass, then reference-choked once the bypass is gone; the refutation stages the config's template unsaved and is seen, and without a template it is not run", async () => {
  const input = { protects: "SECRET", chokepoint: "seal", ...hint, root };
  const broken = await checkChokepoint(adapter, input);
  assert.equal(broken.grade, "broken", broken.reason);
  assert.deepEqual(broken.bypasses, [{ file: "api/render.toy", line: 3, symbol: "render" }]);
  assert.equal(broken.counts.test, 1, "a test reference is counted, never a bypass");
  assert.equal(broken.refutation, "automatic", broken.refutationAccount);
  assert.match(broken.refutationAccount, /reported a reference to SECRET from the unsaved document store\/coherence-refutation-[0-9a-f]{8}\.toy, staged from languages\.toy\.refute/);
  // The site the refutation counts is the one in the unsaved document, never another the server reported (api/render.toy sorts first).
  const secret = await adapter.resolve("SECRET", hint);
  const seal = await adapter.resolve("seal", hint);
  assert.ok(secret.ok && seal.ok);
  const staged = await adapter.refute(secret.definition, seal.definition);
  assert.match(staged.staged[0]?.site?.file ?? "", /^store\/coherence-refutation-[0-9a-f]{8}\.toy$/, staged.account);

  write("api/render.toy", RENDER_CLEAN);
  await adapter.forget(["api/render.toy"]);
  const clean = await checkChokepoint(adapter, input);
  assert.equal(clean.verdict, "pass", clean.reason);
  assert.equal(clean.grade, "reference-choked");
  assert.match(clean.reason, /enforced by Coherence's check at the edit and in CI: toy via declared-stub-server\.ts \(declared in the config\) reports every reference/);

  const { refute: _template, ...withoutTemplate } = TOY;
  const untemplated = new DeclaredAdapter(root, withoutTemplate);
  try {
    const unproved = await checkChokepoint(untemplated, input);
    assert.equal(unproved.verdict, "not run", "no refutation, so never a pass");
    assert.equal(unproved.refutation, "missing");
    assert.match(unproved.reason, /refutation missing: no refute template declared for toy/);
  } finally {
    await untemplated.close();
    write("api/render.toy", RENDER_BYPASS);
    await adapter.forget(["api/render.toy"]);
  }
});

test("a run routes a declared language's chokepoint to its adapter and records which language answered; a mixed project picks it by the files the component holds; every reading names it as not read", async () => {
  const outcome = await performRun(root, { session: "declared-test", agent: "test", form: "chokepoint", adapter, refresh: [] });
  const record = loadRuns(root).records.at(-1)!;
  assert.equal(record.instrument.language, "toy");
  const entry = record.invariants.find((e) => e.name === "toy egress")!;
  assert.equal(entry.grade, "broken", entry.reason);
  assert.equal(outcome.record.instrument.server, "cold");

  writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ language: ["typescript", "toy"], languages: { toy: { extensions: [".toy"], server: TOY.server } } }));
  const mixed = readEnforcementConfig(root);
  const invariant = { latest: [] } as unknown as Parameters<typeof enforcementLanguages>[2];
  assert.deepEqual(enforcementLanguages(mixed, "store", invariant, "SECRET", "seal", () => ["store/secrets.toy", "web/app.ts"]), ["toy"]);
  assert.deepEqual(enforcementLanguages(mixed, ".", invariant, "SECRET in store/secrets.toy", "seal", () => []), ["toy"]);

  const read = scannedLanguagesRead(mixed);
  assert.deepEqual(read.read, ["typescript"]);
  assert.deepEqual(read.unread, [{ language: "toy", because: DECLARED_NOT_READ }]);
  assert.equal(languagesReadLine(read), `languages read: typescript; NOT READ: toy (${DECLARED_NOT_READ})`);
});

test("a declared language's server that misses a file's references never passes: a server answering only from open documents is handed every file, and a file whose text names the thing with no reported site makes the check not run, naming the file", async () => {
  const input = { protects: "SECRET", chokepoint: "seal", ...hint, root };
  const openOnly = new DeclaredAdapter(root, { ...TOY, server: [...TOY.server, "--open-only"] });
  const blind = new DeclaredAdapter(root, { ...TOY, server: [...TOY.server, "--blind=api/"] });
  try {
    const missed = await checkChokepoint(blind, input);
    assert.equal(missed.verdict, "not run", `a server blind to api/ must never grade a pass: ${missed.reason}`);
    assert.equal(missed.refutation, "missing");
    assert.match(missed.reason, /but no reference in api\/render\.toy:3, whose text names SECRET/);
    // Before the adapter opened every file, this server saw only the seed it opens at start, the definition and the probe: a bypass in any
    // other file went unseen. web/leak.toy sorts after the seed (api/render.toy), so nothing but the adapter's own opening reaches it.
    write("web/leak.toy", "def leak\n  SECRET\n");
    const opened = await checkChokepoint(openOnly, input);
    assert.equal(opened.grade, "broken", opened.reason);
    assert.deepEqual(opened.bypasses, [{ file: "api/render.toy", line: 3, symbol: "render" }, { file: "web/leak.toy", line: 2, symbol: "leak" }]);
  } finally {
    await openOnly.close();
    await blind.close();
    rmSync(join(root, "web"), { recursive: true, force: true });
  }
});

test("run --no-server checks a declared language's chokepoints in process, alone or beside a built-in, never leaving them to a server it was told not to start", async () => {
  const project = mkdtempSync(join(tmpdir(), "coherence-declared-cli-"));
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), text, "utf8");
  };
  try {
    put("Toy.spec.md", SPEC);
    put("store/secrets.toy", SECRETS);
    put("api/render.toy", RENDER_BYPASS);
    execFileSync("git", ["init", "-q"], { cwd: project });
    const declaration = { toy: { extensions: TOY.extensions, server: TOY.server, refute: TOY.refute } };
    for (const language of [["typescript", "toy"], ["toy"]]) {
      put("coherence.config.json", JSON.stringify({ language, languages: declaration }));
      const ran = await cli(["run", "--no-server", "--form", "chokepoint", "--session", `cli-${language.length}`, "--agent", "test"], { cwd: project });
      assert.doesNotMatch(ran.stdout + ran.stderr, /no toy adapter was handed/, `${language.join("+")}: the declared language had an adapter`);
      assert.match(ran.stdout, /chokepoint seal protects SECRET: broken/, `${language.join("+")}: ${ran.stdout}${ran.stderr}`);
      const record = loadRuns(project).records.at(-1)!;
      assert.equal(record.instrument.server, "cold", `${language.join("+")}: an in-process adapter, never the warm server --no-server refuses`);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a JavaScript project that names javascript as its language is pointed at typescript, which reads its files", () => {
  const project = mkdtempSync(join(tmpdir(), "coherence-declared-js-"));
  try {
    writeFileSync(join(project, "coherence.config.json"), JSON.stringify({ language: "javascript" }));
    assert.throws(() => readEnforcementConfig(project), /language names "javascript".*typescript also reads JavaScript \(\.js, \.mjs, \.cjs, \.jsx\)/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
