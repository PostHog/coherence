import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/derivation/derive.ts";
import { totalityGateFailure } from "../src/verification/totality.ts";
import { runVerify } from "../src/verification/verify.ts";
import { readStatus } from "../src/evidence/status.ts";
import { tmpProject, cleanup, cfg, comp, sym, graph, runCaptured } from "./_helpers.ts";

const oracle = "test_domain";
const claim = 'boundary "policy totality" at DOMAIN via guard "test_domain"';
const base = {
  "policy.py": 'DOMAIN = ("a", "b")\n',
  "test_policy.py": 'from policy import DOMAIN\ndef test_domain():\n    for item in DOMAIN:\n        assert item in ("a", "b")\n',
};
const pyCfg = (root: string) => cfg(root, { language: "python", codeExt: ["py"], oracleExecution: "serial" });
const pyGraph = (path = "policy.py") => graph([
  comp(".", { claims: [claim], invariants: ["policy totality"], why: "r" }), sym("DOMAIN", path, undefined, "const"),
]);
async function gate(files: Record<string, string>, domain = "policy.py", extra = false): Promise<string | null> {
  const root = await tmpProject(files);
  try {
    const g = pyGraph(domain);
    if (extra) g.nodes.push(sym("DOMAIN", "duplicate.py", undefined, "const"));
    return await totalityGateFailure(pyCfg(root), g, "policy totality", "DOMAIN", null, oracle);
  } finally { await cleanup(root); }
}

// Stdlib-only executable fixtures: static inspection never imports the project. The
// configured runner executes the exact named function and prints only after its return.
const runner = 'import importlib, sys\nm = importlib.import_module(sys.argv[1])\ngetattr(m, sys.argv[2])()\nprint("ran " + sys.argv[2])\n';
async function verify(files: Record<string, string>, module = "test_policy", domain = "policy.py") {
  const root = await tmpProject({ ...files, "runner.py": runner });
  try {
    const config = { ...pyCfg(root), test: ["python3", "runner.py", module], testMatch: "ran test_domain" };
    const result = await runCaptured(() => runVerify(config, pyGraph(domain), {}));
    assert.equal(result.code, 0, result.out + result.err);
    assert.match(result.out, /1 green/);
    assert.equal((await readStatus(config)).verify!.claims[0].kind, "pass");
  } finally { await cleanup(root); }
}

test("Python enumeration admission — literal collections and direct aliases retain executed positive controls", async () => {
  for (const value of ['("a", "b")', '["a", "b"]', '{"a", "b"}', '{"a": 1, "b": 2}']) {
    const files = { ...base, "policy.py": `DOMAIN = ${value}\n`, "test_policy.py": base["test_policy.py"].replaceAll("DOMAIN", "cases").replace("import cases", "import DOMAIN as cases") };
    assert.equal(await gate(files), null, value);
    await verify(files);
  }
  for (const suffix of ["keys()", "values()", "items()"]) {
    const files = { ...base, "policy.py": 'DOMAIN = {"a": 1, "b": 2}\n', "test_policy.py": `from policy import DOMAIN\ndef test_domain():\n    for item in DOMAIN.${suffix}:\n        assert item\n` };
    assert.equal(await gate(files), null, suffix);
    await verify(files);
  }
});

test("Python enumeration admission — genuine graph derivation and package-relative aliases reach public verification", async () => {
  const root = await tmpProject({
    "project.spec.md": '# Policy\n\n## invariants\n\n- policy totality\n\n## works when\n\n- ' + claim + '\n\n## why\n\nThe policy has two states.\n',
    "pkg/__init__.py": "",
    "pkg/policy.py": 'DOMAIN: tuple[str, ...] = ("a", "b")\n',
    "pkg/test_policy.py": 'from .policy import DOMAIN as cases\ndef test_domain():\n    for item in cases:\n        assert item\n',
    "runner.py": runner,
  });
  try {
    const config = { ...pyCfg(root), test: ["python3", "runner.py", "pkg.test_policy"], testMatch: "ran test_domain" };
    const g = await buildGraph(config);
    assert.equal(g.nodes.filter((n) => n.kind === "symbol" && n.label === "DOMAIN").length, 1);
    assert.equal(g.nodes.find((n) => n.kind === "symbol" && n.label === "DOMAIN")?.sub, "const");
    const fast = await runCaptured(() => runVerify(config, g, { fast: true }));
    assert.equal(fast.code, 0, fast.out);
    assert.match(fast.out, /1 skipped/);
    const full = await runCaptured(() => runVerify(config, g, {}));
    assert.equal(full.code, 0, full.out + full.err);
    assert.match(full.out, /1 green/);
  } finally { await cleanup(root); }
});

test("Python enumeration admission — same-file collections and direct unittest methods execute", async () => {
  await verify({ "test_policy.py": base["policy.py"] + base["test_policy.py"].replace('from policy import DOMAIN\n', '') }, "test_policy", "test_policy.py");
  const files = { ...base, "test_policy.py": 'import unittest\nfrom policy import DOMAIN\nclass TestPolicy(unittest.TestCase):\n    def test_domain(self):\n        for item in DOMAIN:\n            self.assertTrue(item)\n' };
  assert.equal(await gate(files), null);
  const root = await tmpProject(files);
  try {
    const config = { ...pyCfg(root), test: ["python3", "-c", 'import sys, unittest; s = unittest.defaultTestLoader.loadTestsFromName("test_policy.TestPolicy." + sys.argv[1]); r=unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(s); sys.exit(not r.wasSuccessful())'], testMatch: 'test_domain .* ok' };
    const result = await runCaptured(() => runVerify(config, pyGraph(), {}));
    assert.equal(result.code, 0, result.out + result.err);
    assert.match(result.out, /1 green/);
  } finally { await cleanup(root); }
});

test("Python enumeration admission — scalar, empty, dynamic and rebound assignments cannot borrow collection evidence", async () => {
  for (const source of [
    'DOMAIN = 7', 'DOMAIN = "ab"', 'DOMAIN = []', 'DOMAIN = ()', 'DOMAIN = {}',
    'DOMAIN = set()', 'DOMAIN = list(other)', 'DOMAIN = [*other]', 'DOMAIN = {**other}',
    'DOMAIN = [x for x in other]', 'DOMAIN = {x for x in other}', 'DOMAIN = (x for x in other)',
    'DOMAIN = {[1]}', 'DOMAIN = {[1]: 2}', 'DOMAIN = {(1, [2]): 3}', 'DOMAIN = [get_item()]', 'DOMAIN = [f"{get_item()}"]',
    'DOMAIN = ("a", "b")\nDOMAIN = ("a",)',
    'DOMAIN = ["a", "b"]\nDOMAIN.pop()', 'DOMAIN = ["a", "b"]\nDOMAIN[0] = "c"',
    'DOMAIN = ["a", "b"]\ndel DOMAIN[0]', 'DOMAIN = ["a", "b"]\nDOMAIN += ["c"]',
    'class DOMAIN:\n    A = 1', 'if True:\n    DOMAIN = ("a", "b")',
  ]) assert.match((await gate({ ...base, "policy.py": source + '\n' })) ?? "unexpected pass", /\[totality\]/, source);
  assert.match((await gate(base, "policy.py", true))!, /resolve uniquely; found 2/);
});

test("Python enumeration admission — wrong modules, module-package collisions and search-root shadows refuse", async () => {
  const cases: Array<Record<string, string>> = [
    { ...base, "other.py": 'DOMAIN = ("decoy",)\n', "test_policy.py": base["test_policy.py"].replace("from policy", "from other") },
    { ...base, "policy/__init__.py": 'DOMAIN = ("decoy",)\n' },
    { "policy.py": base["policy.py"], "tests/test_policy.py": base["test_policy.py"], "tests/policy.py": 'DOMAIN = ("decoy",)\n' },
    { ...base, "alias.py": 'from policy import DOMAIN\n', "test_policy.py": base["test_policy.py"].replace("from policy", "from alias") },
    { ...base, "test_policy.py": base["test_policy.py"].replace("from policy import DOMAIN", "import policy as DOMAIN") },
    { ...base, "test_policy.py": base["test_policy.py"].replace("from policy import DOMAIN", "from policy import *") },
    { ...base, "policy.py": base["policy.py"] + 'OTHER = ("decoy",)\n', "test_policy.py": base["test_policy.py"].replace("import DOMAIN", "import DOMAIN, OTHER as DOMAIN") },
    { ...base, "policy.py": base["policy.py"] + 'OTHER = ("decoy",)\n', "test_policy.py": base["test_policy.py"].replace("import DOMAIN", "import DOMAIN as actual, OTHER as actual").replace("in DOMAIN:", "in actual:") },
  ];
  for (const files of cases) assert.match((await gate(files)) ?? "unexpected pass", /does not directly iterate/);
  const packageFiles = { "pkg/__init__.py": "", "pkg.py": "", "pkg/policy.py": base["policy.py"], "test_policy.py": base["test_policy.py"].replace("from policy", "from pkg.policy") };
  assert.match((await gate(packageFiles, "pkg/policy.py"))!, /does not directly iterate/);
});

test("Python enumeration admission — shadows and partial traversal never acquire direct-domain identity", async () => {
  const cases = [
    'from policy import DOMAIN\ndef test_domain():\n    match ("decoy",):\n        case DOMAIN:\n            pass\n    for item in DOMAIN:\n        assert item\n',
    base["test_policy.py"] + 'test_domain = lambda: None\n',
    'from policy import DOMAIN\ndef test_domain():\n    if (DOMAIN := ["a"]):\n        pass\n    for item in DOMAIN:\n        assert item\n',
    'from policy import DOMAIN\ndef test_domain():\n    try:\n        pass\n    except Exception as DOMAIN:\n        pass\n    for item in DOMAIN:\n        assert item\n',
    'from policy import DOMAIN\ndef test_domain(DOMAIN):\n    for item in DOMAIN:\n        assert item\n',
    'from policy import DOMAIN\nDOMAIN = ["a"]\ndef test_domain():\n    for item in DOMAIN:\n        assert item\n',
    'from policy import DOMAIN\ndef test_domain():\n    DOMAIN = ["a"]\n    for item in DOMAIN:\n        assert item\n',
    'from policy import DOMAIN\ndef test_domain():\n    for DOMAIN in [["a"]]:\n        for item in DOMAIN:\n            assert item\n',
    'from policy import DOMAIN\ndef test_domain():\n    with other as DOMAIN:\n        for item in DOMAIN:\n            assert item\n',
    'from policy import DOMAIN\ndef test_domain():\n    for item in DOMAIN:\n        break\n',
    'from policy import DOMAIN\ndef test_domain():\n    for item in DOMAIN:\n        return\n',
    'from policy import DOMAIN\ndef test_domain():\n    def nested():\n        for item in DOMAIN:\n            assert item\n',
    'from policy import DOMAIN\n@decorator\ndef test_domain():\n    for item in DOMAIN:\n        assert item\n',
    'from policy import DOMAIN\ndef outer():\n    def test_domain():\n        for item in DOMAIN:\n            assert item\n',
    ...['DOMAIN[:1]', '[x for x in DOMAIN if x == "a"]', 'filter(predicate, DOMAIN)', 'DOMAIN[:]', 'sorted(DOMAIN)', '["a"]', 'DOMAIN.keys()'].map((expr) => base["test_policy.py"].replace('in DOMAIN:', `in ${expr}:`)),
  ];
  for (const source of cases) assert.match((await gate({ ...base, "test_policy.py": source })) ?? "unexpected pass", /does not directly iterate/, source);
  const methods = 'from policy import DOMAIN\nclass A:\n    def test_domain(self):\n        for item in DOMAIN:\n            assert item\nclass B:\n    def test_domain(self):\n        for item in DOMAIN:\n            assert item\n';
  assert.match((await gate({ ...base, "test_policy.py": methods }))!, /found 2/);
});

test("Python enumeration admission — absent oracles refuse and static admission never executes project code", async () => {
  assert.match((await gate({ ...base, "test_policy.py": base["test_policy.py"].replace("test_domain", "test_other") }))!, /found 0/);
  const files = { ...base, "policy.py": 'raise RuntimeError("static inspection must not execute me")\n' + base["policy.py"] };
  assert.equal(await gate(files), null);
  const root = await tmpProject(base);
  try {
    assert.match((await totalityGateFailure(pyCfg(root), pyGraph(), "policy totality", "DOMAIN", null, ""))!, /names no oracle/);
    assert.equal(await totalityGateFailure({ ...pyCfg(root), totalityEnumeration: false }, pyGraph(), "policy totality", "DOMAIN", null, ""), null);
  } finally { await cleanup(root); }
});
