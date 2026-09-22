/**
 * The Python adapter over a small project written into a temporary folder:
 * a protected name, a chokepoint function with one clean reference inside
 * it, one bypass outside it, one test reference under tests/, an __all__
 * that excludes the protected name, an underscore-prefixed name, a class
 * member, and a function-local. The classification, the four-rung ladder,
 * the refutation through an unsaved document, and the totality oracle pass
 * through pytest's JUnit report. npm run test:setup prepares the local Python
 * environment; COHERENCE_PYTHON explicitly overrides it. Missing pytest is
 * a test failure, never a skipped integration check.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { checkChokepoint, classifySite } from "../enforcement/check.ts";
import { formatRun, refuteCommand } from "../enforcement/cli.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { performRun } from "../enforcement/run.ts";
import { combinedFilter, reportFromJunit, verdictsFromReport } from "../enforcement/totality.ts";
import type { Definition } from "./adapter.ts";
import { PythonAdapter, locateServer, type PythonLanguageClient } from "./python.ts";

const INIT = `from pkg.store import seal, peek

__all__ = ["seal", "peek"]
`;

const STORE = `"""The store."""

SECRET_COLUMNS = {"tokens": ["token"]}

_HIDDEN = {"x"}

__all__ = ["seal", "peek"]


def seal(pattern: str, row: dict) -> dict:
    out = dict(row)
    for column in SECRET_COLUMNS.get(pattern, []):
        out.pop(column, None)
    return out


def peek(pattern: str) -> int:
    return len(_HIDDEN) + len(pattern)


class Tracker:
    def __init__(self) -> None:
        self._script = object()

    def swap(self) -> object:
        return self._script


def closure(pattern: str) -> int:
    INNER = {"y"}
    return len(INNER) + len(pattern)
`;

const RENDER_BYPASS = `from pkg.store import SECRET_COLUMNS, seal


def render(pattern: str, row: dict) -> str:
    sealed = seal(pattern, row)
    leaked = SECRET_COLUMNS[pattern]
    return str({"sealed": sealed, "leaked": leaked})
`;

const RENDER_CLEAN = `from pkg.store import seal


def render(pattern: str, row: dict) -> str:
    return str(seal(pattern, row))
`;

const TEST_FILE = `from pkg.store import SECRET_COLUMNS, seal


def test_seal_strips():
    assert "token" not in seal("tokens", {"token": 1})


def test_columns():
    assert SECRET_COLUMNS["tokens"] == ["token"]
`;

const SPEC = `# Fixture

A store with one door out.

## trust levels
- storage: the rows beneath everything
- public-egress: what leaves in the clear

## invariants
- digest-only egress: A secret leaves storage only through seal.
  protects: SECRET_COLUMNS
  chokepoint: seal
  because: a read of a leaked row must disclose no usable bearer
  crossing: storage -> public-egress
  kinds: none
- hidden set: The hidden set is read only through peek.
  protects: _HIDDEN
  chokepoint: peek
  because: the set is an implementation detail
  kinds: none
- inner set: The inner set never leaves closure.
  protects: INNER
  chokepoint: closure
  because: a function-local is the interpreter's own choke
  kinds: none
- egress totality: Every secret column is stripped.
  over: every column in SECRET_COLUMNS
  via: test_seal_strips
  because: a spot check is not enforcement
  refuted: removed the pop from seal -> test_seal_strips went red (2026-09-17)
  kinds: none
`;

let root: string;
let adapter: PythonAdapter;
const hint = { component: ".", testFolders: readEnforcementConfig("/nowhere").testFolders };
const serverPresent = locateServer(process.cwd()) !== undefined;

const TEST_PYTHON = fileURLToPath(new URL("../../.venv/bin/python", import.meta.url));

function pythonForTests(env: NodeJS.ProcessEnv = process.env): string {
  return env["COHERENCE_PYTHON"] || TEST_PYTHON;
}

/** The local test interpreter, or an explicit override; a missing runner fails rather than hiding coverage. */
function pythonWithPytest(env: NodeJS.ProcessEnv = process.env): string {
  const python = pythonForTests(env);
  const probe = spawnSync(python, ["-m", "pytest", "--version"], { encoding: "utf8" });
  assert.equal(
    probe.status,
    0,
    `pytest is unavailable in ${python}: ${probe.error?.message ?? probe.stderr.trim()}. Run npm run test:setup, or set COHERENCE_PYTHON to an interpreter with pytest.`,
  );
  return python;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

function definitionOf(resolved: Awaited<ReturnType<PythonAdapter["resolve"]>>): Definition {
  assert.ok(resolved.ok, JSON.stringify(resolved));
  return resolved.definition;
}

class ControlledPythonClient implements PythonLanguageClient {
  onNotification: PythonLanguageClient["onNotification"];
  onRequest: PythonLanguageClient["onRequest"];
  alive = true;
  initializeParams: unknown;
  configurationReply: unknown;
  private enumerated = false;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (method === "initialize") {
      this.initializeParams = params;
      this.configurationReply = await this.onRequest?.("workspace/configuration", { items: [{ section: "python" }] });
      return {} as T;
    }
    if (method === "textDocument/documentSymbol") {
      const file = String((params as { textDocument: { uri: string } }).textDocument.uri);
      if (this.enumerated && file.endsWith("/component/store.py")) {
        return [{ name: "TARGET", kind: 13, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } }] as T;
      }
      return [] as T;
    }
    if (method === "textDocument/references") {
      if (!this.enumerated) return [] as T;
      return [{ uri: pathToFileURL(join(this.root, "outside/use.py")).href, range: { start: { line: 2, character: 9 }, end: { line: 2, character: 15 } } }] as T;
    }
    throw new Error(`unexpected request ${method}`);
  }

  notify(): void {}

  kill(): void {
    this.alive = false;
  }

  finishEnumeration(): void {
    if (this.enumerated) return;
    this.enumerated = true;
    this.onNotification?.("window/logMessage", { message: "Found 2 source files" });
  }
}

/** Fail promptly if a controlled operation settles before the test releases its barrier. */
async function assertStillPending(promise: Promise<unknown>, message: string): Promise<void> {
  const pending = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise<typeof pending>((resolvePending) => setImmediate(() => resolvePending(pending))),
  ]);
  assert.equal(result, pending, message);
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), "coherence-python-"));
  write("coherence.config.json", JSON.stringify({ language: "python", testDir: "tests" }));
  write("Fixture.spec.md", SPEC);
  write("pkg/__init__.py", INIT);
  write("pkg/store.py", STORE);
  write("pkg/render.py", RENDER_BYPASS);
  write("tests/test_store.py", TEST_FILE);
  adapter = new PythonAdapter(root);
});

after(async () => {
  await adapter.close();
  rmSync(root, { recursive: true, force: true });
});

test("the Python language server binary is found (the adapter's precondition)", () => {
  assert.ok(serverPresent, "pyright must be installed: npm install");
});

test("Python waits for whole-workspace enumeration before bare-name resolution and references, and finds references outside the component", { timeout: 1_000 }, async () => {
  const controlledRoot = mkdtempSync(join(tmpdir(), "coherence-python-enumeration-"));
  mkdirSync(join(controlledRoot, "component"), { recursive: true });
  mkdirSync(join(controlledRoot, "outside"), { recursive: true });
  writeFileSync(join(controlledRoot, "component/store.py"), "TARGET = 1\n", "utf8");
  writeFileSync(join(controlledRoot, "outside/use.py"), "from component.store import TARGET\n\nRESULT = TARGET\n", "utf8");
  const client = new ControlledPythonClient(controlledRoot);
  const controlled = new PythonAdapter(controlledRoot, () => client);
  const definition: Definition = {
    name: "TARGET",
    kind: "symbol",
    file: "component/store.py",
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
    selection: { line: 0, character: 0 },
  };
  try {
    const resolution = controlled.resolve("TARGET", { ...hint, component: "component" });
    const references = controlled.references(definition);
    await assertStillPending(resolution, "bare-name resolution answered before workspace enumeration");
    await assertStillPending(references, "references answered before workspace enumeration");
    assert.deepEqual(client.initializeParams, {
      processId: process.pid,
      rootUri: pathToFileURL(controlledRoot).href,
      workspaceFolders: [{ uri: pathToFileURL(controlledRoot).href, name: "project" }],
      capabilities: {
        textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true }, publishDiagnostics: {} },
        workspace: { workspaceFolders: true, configuration: true },
      },
      initializationOptions: {},
    });
    assert.deepEqual(client.configurationReply, [{ analysis: { diagnosticMode: "openFilesOnly" } }], "the configuration adds no include or component filter");

    client.finishEnumeration();
    const resolved = definitionOf(await resolution);
    assert.equal(resolved.file, "component/store.py");
    const sites = await references;
    assert.deepEqual(sites.map((site) => `${site.file}:${site.line}`), ["outside/use.py:3"]);
  } finally {
    client.finishEnumeration();
    await controlled.close();
    rmSync(controlledRoot, { recursive: true, force: true });
  }
});

test("Python classification: inside the chokepoint, a test reference, a bypass; an import or an __all__ entry outside the chokepoint is a bypass", async () => {
  const protectedThing = definitionOf(await adapter.resolve("SECRET_COLUMNS", hint));
  const chokepoint = definitionOf(await adapter.resolve("seal", hint));
  assert.equal(protectedThing.file, "pkg/store.py");
  const sites = await adapter.references(protectedThing);
  const classes = sites.map((s) => `${s.file}:${s.line} ${classifySite(s, protectedThing, chokepoint, hint.testFolders)}`);
  assert.deepEqual(classes, ["pkg/render.py:1 bypass", "pkg/render.py:6 bypass", "pkg/store.py:12 inside", "tests/test_store.py:1 test", "tests/test_store.py:9 test"]);
  assert.equal(sites.find((s) => s.line === 6 && s.file === "pkg/render.py")!.symbol, "render", "a bypass names its referencing symbol");

  // Every site Pyright reports is a reference: the "seal" entry of __all__ and the package's import line included.
  const seal = await adapter.references(chokepoint);
  assert.ok(seal.some((s) => s.file === "pkg/store.py" && s.line === 7), 'the "seal" entry of __all__ is a reference');
  assert.ok(seal.some((s) => s.file === "pkg/__init__.py" && s.line === 1), "the package's import line is a reference");
});

test("Python grades: broken with a bypass; reference-choked when clean, with the convention as evidence; closure-choked for a function-local; checker-choked once Pyright's private-usage rule is an error; broken without a chokepoint; not chokeable for prose", async () => {
  const broken = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", ...hint, root });
  assert.equal(broken.grade, "broken");
  assert.equal(broken.verdict, "fail");
  assert.deepEqual(broken.bypasses, [
    { file: "pkg/render.py", line: 1, symbol: "module top level" },
    { file: "pkg/render.py", line: 6, symbol: "render" },
  ]);
  assert.equal(broken.counts.test, 2, "a test reference is reported, never a bypass");
  assert.equal(broken.refutation, "automatic");

  write("pkg/render.py", RENDER_CLEAN);
  await adapter.forget();
  const clean = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", ...hint, root });
  assert.equal(clean.grade, "reference-choked", clean.reason);
  assert.equal(clean.verdict, "pass");
  assert.equal(clean.enforcer, "Coherence's check at the edit and in CI");
  assert.match(clean.reason, /carries no underscore prefix; __all__ in pkg\/store\.py excludes it; no Pyright configuration/);
  assert.match(clean.reason, /2 test references/);

  const hidden = await checkChokepoint(adapter, { protects: "_HIDDEN", chokepoint: "peek", ...hint, root });
  assert.equal(hidden.grade, "reference-choked", "the underscore prefix alone is a convention: the top rung without a checker is Coherence's own");
  assert.match(hidden.reason, /_HIDDEN is underscore-prefixed; __all__ in pkg\/store\.py excludes it; no Pyright configuration/);

  const inner = await checkChokepoint(adapter, { protects: "INNER", chokepoint: "closure", ...hint, root });
  assert.equal(inner.grade, "closure-choked", inner.reason);
  assert.equal(inner.enforcer, "the interpreter");
  assert.match(inner.reason, /defined inside closure's body and is not a module attribute/);
  // The interpreter is the enforcer here and Coherence's own check is not: a function-local can only be named
  // inside the body that is the chokepoint, so the interpreter's refusal of a synthetic import is the refutation (rs-e93ecdd6).
  assert.equal(inner.refutation, "refused by the language", inner.refutationAccount);
  assert.equal(inner.verdict, "pass", inner.reason);
  assert.match(inner.refutationAccount, /refused by the interpreter's own rule: .*unknown import symbol/);
  assert.match(inner.refutationAccount, /the closure-choked rung is enforced by the interpreter, and its refusal is the refutation/);
  const innerElsewhere = await checkChokepoint(adapter, { protects: "INNER", chokepoint: "seal", ...hint, root });
  assert.equal(innerElsewhere.grade, "broken", "a function-local named under another chokepoint is referenced inside its own function, outside that chokepoint");
  assert.deepEqual(innerElsewhere.bypasses, [{ file: "pkg/store.py", line: 31, symbol: "closure" }]);

  const member = await checkChokepoint(adapter, { protects: "_script in store.py", chokepoint: "swap", ...hint, root });
  assert.equal(member.grade, "reference-choked", member.reason);
  assert.match(member.reason, /member of Tracker, reachable through the class/);

  write("pyrightconfig.json", JSON.stringify({ reportPrivateUsage: "error" }));
  await adapter.forget();
  const checked = await checkChokepoint(adapter, { protects: "_HIDDEN", chokepoint: "peek", ...hint, root });
  assert.equal(checked.grade, "checker-choked", checked.reason);
  assert.match(checked.enforcer ?? "", /^Pyright \(reportPrivateUsage: error in pyrightconfig\.json\)/);
  const stillPublic = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", ...hint, root });
  assert.equal(stillPublic.grade, "reference-choked", "a name without the prefix gains nothing from the rule");
  assert.match(stillPublic.reason, /reportPrivateUsage is an error in pyrightconfig\.json/);
  rmSync(join(root, "pyrightconfig.json"));
  await adapter.forget();

  const missing = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "no_such_function", ...hint, root });
  assert.equal(missing.grade, "broken");
  assert.match(missing.reason, /no symbol named no_such_function/);

  const prose = await checkChokepoint(adapter, { protects: "the rows every pattern keeps", chokepoint: "seal", ...hint, root });
  assert.equal(prose.grade, "not chokeable");
  assert.match(prose.reason, /totality oracle form .* is the compromise/);

  write("pkg/render.py", RENDER_BYPASS);
  await adapter.forget();
});

test("a Python module or package resolves, its members are the references' start, and the package's own files are inside it", async () => {
  const pkg = definitionOf(await adapter.resolve("pkg/", hint));
  assert.equal(pkg.kind, "module");
  assert.equal(pkg.file, "pkg/__init__.py");
  const store = definitionOf(await adapter.resolve("pkg/store.py", hint));
  const result = await checkChokepoint(adapter, { protects: "pkg/", chokepoint: "pkg/render.py", ...hint, root });
  assert.equal(result.bypasses.length, 0, result.reason);
  assert.equal(result.grade, "reference-choked");
  assert.match(result.reason, /any file may import pkg/);
  assert.ok(result.sites.some((s) => s.file === "pkg/store.py" && s.class === "inside"), "the package's own modules are inside the protected package");
  const visibility = await adapter.visibility(store);
  assert.equal(visibility.enforced, false);
  assert.match(visibility.evidence, /declares __all__ with 2 names/);
});

test("the Python refutation stages a re-export in an unsaved document, and a function-local is refused by the interpreter; nothing is written to disk", async () => {
  const before = readFileSync(join(root, "pkg/store.py"), "utf8");
  const protectedThing = definitionOf(await adapter.resolve("SECRET_COLUMNS", hint));
  const refutation = await adapter.refute(protectedThing, undefined);
  assert.equal(refutation.seen, true, refutation.account);
  assert.match(refutation.account, /a re-export of SECRET_COLUMNS through __all__ in the unsaved document pkg\/coherence_refutation_[0-9a-f]+\.py/);
  assert.ok(readdirSync(join(root, "pkg")).every((n) => !n.includes("refutation")), "no synthetic file lands on disk");

  const member = definitionOf(await adapter.resolve("_script in store.py", hint));
  const throughClass = await adapter.refute(member, undefined);
  assert.equal(throughClass.seen, true, throughClass.account);

  const inner = definitionOf(await adapter.resolve("INNER", hint));
  const closure = definitionOf(await adapter.resolve("closure", hint));
  const inside = await adapter.refute(inner, closure);
  assert.equal(inside.seen, true, inside.account);
  assert.match(inside.account, /refused by the interpreter's own rule: .*unknown import symbol/, inside.account);
  assert.deepEqual(inside.staged, [], "nothing is staged for a name no import can reach");
  assert.equal(readFileSync(join(root, "pkg/store.py"), "utf8"), before);
});

test("pytest's JUnit report reads as the jest shape, and -k names join with or", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" tests="3"><testcase classname="tests.test_store" name="test_seal_strips" time="0.001" /><testcase classname="tests.test_store.TestDoor" name="test_closes" time="0.001"><failure message="assert False">Traceback</failure></testcase><testcase classname="tests.test_store" name="test_later"><skipped type="pytest.skip" message="not yet" /></testcase></testsuite></testsuites>`;
  const report = reportFromJunit(xml);
  const results = report.testResults![0]!.assertionResults!;
  assert.deepEqual(results.map((r) => [r.fullName, r.status]), [["tests.test_store.test_seal_strips", "passed"], ["tests.test_store.TestDoor.test_closes", "failed"], ["tests.test_store.test_later", "skipped"]]);
  assert.deepEqual(results[1]!.ancestorTitles, ["tests", "test_store", "TestDoor"]);
  const verdicts = verdictsFromReport(report, ["test_seal_strips", "test_closes", "test_later", "test_absent"], "pytest");
  assert.equal(verdicts.get("test_seal_strips")!.verdict, "pass");
  assert.equal(verdicts.get("test_closes")!.verdict, "fail");
  assert.equal(verdicts.get("test_later")!.verdict, "not run");
  assert.equal(verdicts.get("test_absent")!.verdict, "fail");
  assert.equal(combinedFilter(["test_a", "test_b", "test_a"], "pytest"), "test_a or test_b");
  assert.equal(combinedFilter(["a (b)"], "regex"), "a \\(b\\)");
});

test("Python test setup uses the local environment and refuses a missing runner or a broken explicit override", () => {
  assert.equal(pythonForTests({}), TEST_PYTHON);
  assert.equal(pythonForTests({ COHERENCE_PYTHON: "/custom/python" }), "/custom/python");
  const dir = mkdtempSync(join(tmpdir(), "coherence-pytest-setup-"));
  try {
    const missing = join(dir, "missing-python");
    assert.throws(() => pythonWithPytest({ COHERENCE_PYTHON: missing }), /pytest is unavailable.*Run npm run test:setup/);
    const withoutPytest = join(dir, "python-without-pytest");
    writeFileSync(withoutPytest, '#!/bin/sh\nprintf "%s\\n" "No module named pytest" >&2\nexit 1\n', { mode: 0o755 });
    assert.throws(() => pythonWithPytest({ COHERENCE_PYTHON: withoutPytest }), /No module named pytest.*Run npm run test:setup/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the totality oracle pass through pytest: every test the bullets name in one invocation, mapped back from the JUnit report", async () => {
  const python = pythonWithPytest();
  const messages: string[] = [];
  const io = { cwd: root, out: (line: string) => messages.push(line), err: (line: string) => messages.push(line) };
  write("coherence.config.json", JSON.stringify({ language: "python", testDir: "tests", testFilterForm: "pytest", testJson: [python, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-k", "{filter}", "--junitxml={out}", "tests"] }));
  try {
    const before = await performRun(root, { session: "pytest", agent: "python", adapter, form: "totality oracle" });
    const unrefuted = before.record.invariants.find((e) => e.name === "egress totality")!;
    assert.equal(unrefuted.verdict, "pass", unrefuted.reason);
    assert.equal(unrefuted.refutation, "missing", "the spec's refuted line alone is not a witnessed refutation");

    // Run the real Python detector against a staged break, then restore it.
    write("pkg/store.py", STORE.replace("out.pop(column, None)", "pass"));
    const refuted = await refuteCommand(["./egress totality", "--broke", "removed the pop from seal", "--session", "pytest", "--agent", "python"], io);
    assert.equal(refuted, 0, messages.join("\n"));
    write("pkg/store.py", STORE);

    const outcome = await performRun(root, { session: "pytest", agent: "python", adapter, form: "totality oracle" });
    const entry = outcome.record.invariants.find((e) => e.name === "egress totality")!;
    assert.equal(entry.verdict, "pass", entry.reason);
    assert.equal(entry.mode, "batched");
    assert.equal(entry.refutation, "witnessed");
    assert.match(entry.reason, /1 test under "test_seal_strips" passed in one invocation/);
    assert.match(formatRun(outcome), /totality oracle: pass \(.*one invocation for every test the bullets name\)/);

    write("Fixture.spec.md", SPEC.replace("via: test_seal_strips", "via: test_no_such_name"));
    const missing = await performRun(root, { session: "pytest", agent: "python", adapter, form: "totality oracle" });
    assert.equal(missing.record.invariants[0]!.verdict, "fail");
    assert.match(missing.record.invariants[0]!.reason, /no test ran under the name "test_no_such_name"/);
  } finally {
    write("pkg/store.py", STORE);
    write("Fixture.spec.md", SPEC);
    rmSync(join(root, ".coherence"), { recursive: true, force: true });
    rmSync(join(root, ".pytest_cache"), { recursive: true, force: true });
    write("coherence.config.json", JSON.stringify({ language: "python", testDir: "tests" }));
  }
});

test("Python, ruling d-7abd1ba8: an import at the top of the chokepoint's module is inside; the same import elsewhere, an __all__ re-export, a bare star import, and a use outside the chokepoint's body are bypasses", async () => {
  const other = mkdtempSync(join(tmpdir(), "coherence-python-ruling-"));
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(other, path)), { recursive: true });
    writeFileSync(join(other, path), text, "utf8");
  };
  put("pkg/__init__.py", "");
  put("pkg/secrets.py", `SECRET_COLUMNS = {"tokens": ["token"]}\n`);
  put(
    "pkg/door.py",
    `from pkg.secrets import SECRET_COLUMNS


def seal(pattern: str, row: dict) -> dict:
    out = dict(row)
    for column in SECRET_COLUMNS.get(pattern, []):
        out.pop(column, None)
    return out


SNEAK = SECRET_COLUMNS
`,
  );
  put("pkg/render.py", `from pkg.secrets import SECRET_COLUMNS\n`);
  put("pkg/reexport.py", `from pkg.secrets import SECRET_COLUMNS\n\n__all__ = ["SECRET_COLUMNS"]\n`);
  put("pkg/star.py", `from pkg.secrets import *\n`);
  const fresh = new PythonAdapter(other);
  try {
    const protectedThing = definitionOf(await fresh.resolve("SECRET_COLUMNS in secrets.py", hint));
    const chokepoint = definitionOf(await fresh.resolve("seal", hint));
    const sites = await fresh.references(protectedThing);
    const classes = sites.map((s) => `${s.file}:${s.line} ${classifySite(s, protectedThing, chokepoint, hint.testFolders)}`);
    assert.deepEqual(classes, [
      "pkg/door.py:1 inside",
      "pkg/door.py:6 inside",
      "pkg/door.py:11 bypass",
      "pkg/reexport.py:1 bypass",
      "pkg/reexport.py:3 bypass",
      "pkg/render.py:1 bypass",
      "pkg/star.py:1 bypass",
    ]);
    assert.equal(sites.find((s) => s.file === "pkg/door.py" && s.line === 1)!.form, "import");
    assert.equal(sites.find((s) => s.file === "pkg/reexport.py" && s.line === 1)!.form, "re-export", "__all__ turns the import into a re-export");
    assert.equal(sites.find((s) => s.file === "pkg/star.py")!.form, "re-export", "a bare star import re-exports whatever the module holds");
  } finally {
    await fresh.close();
    rmSync(other, { recursive: true, force: true });
  }
});

test("a run over the Python fixture records the grade, the enforcer, and the refutation per chokepoint", async () => {
  const outcome = await performRun(root, { session: "python-run", agent: "python", adapter, form: "chokepoint" });
  const byName = new Map(outcome.record.invariants.map((e) => [e.name, e]));
  assert.equal(byName.get("digest-only egress")!.grade, "broken");
  assert.equal(byName.get("hidden set")!.grade, "reference-choked");
  assert.equal(byName.get("hidden set")!.enforcer, "Coherence's check at the edit and in CI");
  assert.equal(byName.get("inner set")!.grade, "closure-choked");
  assert.equal(byName.get("inner set")!.enforcer, "the interpreter");
  assert.equal(byName.get("inner set")!.refutation, "refused by the language", "the interpreter refuses the import, and that refusal is the refutation");
  assert.match(formatRun(outcome), /chokepoint closure protects INNER: closure-choked \(enforced by the interpreter\) — pass/);
  assert.equal(outcome.record.instrument.language, "python");
  rmSync(join(root, ".coherence"), { recursive: true, force: true });
});
