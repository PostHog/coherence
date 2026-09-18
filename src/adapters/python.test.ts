/**
 * The Python adapter over a small project written into a temporary folder:
 * a protected name, a chokepoint function with one clean reference inside
 * it, one bypass outside it, one test reference under tests/, an __all__
 * that excludes the protected name, an underscore-prefixed name, a class
 * member, and a function-local. The classification, the four-rung ladder,
 * the refutation through an unsaved document, and the totality oracle pass
 * through pytest's JUnit report (skipped visibly when no interpreter with
 * pytest is found: COHERENCE_PYTHON names one, else python3).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { checkChokepoint, classifySite } from "../enforcement/check.ts";
import { formatRun } from "../enforcement/cli.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { performRun } from "../enforcement/run.ts";
import { combinedFilter, reportFromJunit, verdictsFromReport } from "../enforcement/totality.ts";
import type { Definition } from "./adapter.ts";
import { PythonAdapter, locateServer } from "./python.ts";

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

/** An interpreter that can run pytest, or undefined with the reason the test is skipped. */
function pythonWithPytest(): { python: string } | { skip: string } {
  const candidates = [process.env["COHERENCE_PYTHON"], "python3"].filter((c): c is string => c !== undefined && c !== "");
  for (const python of candidates) {
    const probe = spawnSync(python, ["-m", "pytest", "--version"], { encoding: "utf8" });
    if (probe.status === 0) return { python };
  }
  return { skip: `no interpreter with pytest among ${candidates.join(", ")}; set COHERENCE_PYTHON to one to run the pytest pass` };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

function definitionOf(resolved: Awaited<ReturnType<PythonAdapter["resolve"]>>): Definition {
  assert.ok(resolved.ok, JSON.stringify(resolved));
  return resolved.definition;
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
  const broken = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", ...hint });
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
  const clean = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", ...hint });
  assert.equal(clean.grade, "reference-choked", clean.reason);
  assert.equal(clean.verdict, "pass");
  assert.equal(clean.enforcer, "Coherence's check at the edit and in CI");
  assert.match(clean.reason, /carries no underscore prefix; __all__ in pkg\/store\.py excludes it; no Pyright configuration/);
  assert.match(clean.reason, /2 test references/);

  const hidden = await checkChokepoint(adapter, { protects: "_HIDDEN", chokepoint: "peek", ...hint });
  assert.equal(hidden.grade, "reference-choked", "the underscore prefix alone is a convention: the top rung without a checker is Coherence's own");
  assert.match(hidden.reason, /_HIDDEN is underscore-prefixed; __all__ in pkg\/store\.py excludes it; no Pyright configuration/);

  const inner = await checkChokepoint(adapter, { protects: "INNER", chokepoint: "closure", ...hint });
  assert.equal(inner.grade, "closure-choked", inner.reason);
  assert.equal(inner.enforcer, "the interpreter");
  assert.equal(inner.verdict, "pass");
  assert.match(inner.reason, /defined inside closure's body and is not a module attribute/);
  const innerElsewhere = await checkChokepoint(adapter, { protects: "INNER", chokepoint: "seal", ...hint });
  assert.equal(innerElsewhere.grade, "broken", "a function-local named under another chokepoint is referenced inside its own function, outside that chokepoint");
  assert.deepEqual(innerElsewhere.bypasses, [{ file: "pkg/store.py", line: 31, symbol: "closure" }]);

  const member = await checkChokepoint(adapter, { protects: "_script in store.py", chokepoint: "swap", ...hint });
  assert.equal(member.grade, "reference-choked", member.reason);
  assert.match(member.reason, /member of Tracker, reachable through the class/);

  write("pyrightconfig.json", JSON.stringify({ reportPrivateUsage: "error" }));
  await adapter.forget();
  const checked = await checkChokepoint(adapter, { protects: "_HIDDEN", chokepoint: "peek", ...hint });
  assert.equal(checked.grade, "checker-choked", checked.reason);
  assert.match(checked.enforcer ?? "", /^Pyright \(reportPrivateUsage: error in pyrightconfig\.json\)/);
  const stillPublic = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", ...hint });
  assert.equal(stillPublic.grade, "reference-choked", "a name without the prefix gains nothing from the rule");
  assert.match(stillPublic.reason, /reportPrivateUsage is an error in pyrightconfig\.json/);
  rmSync(join(root, "pyrightconfig.json"));
  await adapter.forget();

  const missing = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "no_such_function", ...hint });
  assert.equal(missing.grade, "broken");
  assert.match(missing.reason, /no symbol named no_such_function/);

  const prose = await checkChokepoint(adapter, { protects: "the rows every pattern keeps", chokepoint: "seal", ...hint });
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
  const result = await checkChokepoint(adapter, { protects: "pkg/", chokepoint: "pkg/render.py", ...hint });
  assert.equal(result.bypasses.length, 0, result.reason);
  assert.equal(result.grade, "reference-choked");
  assert.match(result.reason, /any file may import pkg/);
  assert.ok(result.sites.some((s) => s.file === "pkg/store.py" && s.class === "inside"), "the package's own modules are inside the protected package");
  const visibility = await adapter.visibility(store);
  assert.equal(visibility.enforced, false);
  assert.match(visibility.evidence, /declares __all__ with 2 names/);
});

test("the Python refutation opens an unsaved document that imports and uses the protected thing, and nothing is written to disk", async () => {
  const before = readFileSync(join(root, "pkg/store.py"), "utf8");
  const protectedThing = definitionOf(await adapter.resolve("SECRET_COLUMNS", hint));
  const refutation = await adapter.refute(protectedThing, undefined);
  assert.equal(refutation.seen, true, refutation.account);
  assert.match(refutation.account, /unsaved document pkg\/coherence_refutation_[0-9a-f]+\.py importing and using the protected thing was reported as a reference/);
  assert.ok(readdirSync(join(root, "pkg")).every((n) => !n.includes("refutation")), "no synthetic file lands on disk");

  const member = definitionOf(await adapter.resolve("_script in store.py", hint));
  const throughClass = await adapter.refute(member, undefined);
  assert.equal(throughClass.seen, true, throughClass.account);

  const inner = definitionOf(await adapter.resolve("INNER", hint));
  const closure = definitionOf(await adapter.resolve("closure", hint));
  const inside = await adapter.refute(inner, closure);
  assert.equal(inside.seen, true, inside.account);
  assert.match(inside.account, /unsaved edit of pkg\/store\.py adding a use of INNER at line 31 \(inside the chokepoint's body/);
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

test("the totality oracle pass through pytest: every test the bullets name in one invocation, mapped back from the JUnit report", async (t) => {
  const found = pythonWithPytest();
  if ("skip" in found) {
    t.skip(found.skip);
    return;
  }
  write("coherence.config.json", JSON.stringify({ language: "python", testDir: "tests", testFilterForm: "pytest", testJson: [found.python, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-k", "{filter}", "--junitxml={out}", "tests"] }));
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
  write("Fixture.spec.md", SPEC);
  rmSync(join(root, ".coherence"), { recursive: true, force: true });
  rmSync(join(root, ".pytest_cache"), { recursive: true, force: true });
  write("coherence.config.json", JSON.stringify({ language: "python", testDir: "tests" }));
});

test("a run over the Python fixture records the grade, the enforcer, and the refutation per chokepoint", async () => {
  const outcome = await performRun(root, { session: "python-run", agent: "python", adapter, form: "chokepoint" });
  const byName = new Map(outcome.record.invariants.map((e) => [e.name, e]));
  assert.equal(byName.get("digest-only egress")!.grade, "broken");
  assert.equal(byName.get("hidden set")!.grade, "reference-choked");
  assert.equal(byName.get("hidden set")!.enforcer, "Coherence's check at the edit and in CI");
  assert.equal(byName.get("inner set")!.grade, "closure-choked");
  assert.equal(byName.get("inner set")!.enforcer, "the interpreter");
  assert.equal(byName.get("inner set")!.refutation, "automatic");
  assert.match(formatRun(outcome), /chokepoint closure protects INNER: closure-choked \(enforced by the interpreter\) — pass/);
  assert.equal(outcome.record.instrument.language, "python");
  rmSync(join(root, ".coherence"), { recursive: true, force: true });
});
