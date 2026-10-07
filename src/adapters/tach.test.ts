/**
 * The tach rung over a small project written into a temporary folder: a
 * tach.toml with three modules, one of them (shop.orders) declaring an
 * interface that exposes its facade; a protected internal in that module, a
 * use of it in the module's own code, a facade use from another module, and
 * an outside import of the internal planted when a test asks for it. tach is
 * provisioned by npm run test:setup; a missing tach is a test failure, never
 * a skipped check.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { checkChokepoint } from "../enforcement/check.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { editContext } from "../lifecycle/hook.ts";
import { PythonAdapter } from "./python.ts";
import { findTachConfig, locateTach, readTachConfig, tachGovernance, type TachConfig } from "./tach.ts";

const TACH_TOML = `exclude = ["**/tests", "**/__pycache__"]
source_roots = ["."]

[[modules]]
path = "shop.orders"
depends_on = []

[[modules]]
path = "shop.billing"
depends_on = [{ path = "shop.orders", deprecated = false }]

[[modules]]
path = "shop.reports"
depends_on = ["shop.orders"]

[[interfaces]]
expose = ["facade.*"]
from = ["shop.orders"]
`;

const SPEC = `# Shop

A shop whose order rows leave its module only through the facade.

## invariants
- order door: The order rows leave shop.orders only through total.
  protects: ORDER_ROWS
  chokepoint: total
  because: a fixture
  kinds: none
`;

const LEAK = "from shop.orders.store import ORDER_ROWS\n\n\ndef leak() -> dict:\n    return ORDER_ROWS\n";

let root: string;
let adapter: PythonAdapter;
const hint = { component: ".", testFolders: readEnforcementConfig("/nowhere").testFolders };

function write(at: string, path: string, text: string): void {
  mkdirSync(dirname(join(at, path)), { recursive: true });
  writeFileSync(join(at, path), text, "utf8");
}

function shop(at: string): void {
  write(at, "coherence.config.json", JSON.stringify({ language: "python", testDir: "tests" }));
  write(at, "Shop.spec.md", SPEC);
  write(at, "tach.toml", TACH_TOML);
  for (const pkg of ["shop", "shop/orders", "shop/billing", "shop/reports"]) write(at, `${pkg}/__init__.py`, "");
  write(at, "shop/orders/store.py", 'ORDER_ROWS = {"a": 1}\n');
  write(at, "shop/orders/facade.py", "from shop.orders.store import ORDER_ROWS\n\n\ndef total() -> int:\n    return sum(ORDER_ROWS.values())\n");
  write(at, "shop/orders/audit.py", "from shop.orders.store import ORDER_ROWS\n\n\ndef audit() -> int:\n    return len(ORDER_ROWS)\n");
  write(at, "shop/billing/bill.py", "from shop.orders.facade import total\n\n\ndef bill() -> int:\n    return total()\n");
  write(at, "shop/reports/summary.py", "from shop.orders.facade import total\n\n\ndef summary() -> str:\n    return str(total())\n");
}

/** The tach the tests run: Coherence's own test environment, which npm run test:setup provisions. */
function tachForTests(): string {
  const found = locateTach(root, root);
  assert.ok(found.path !== undefined, `tach is unavailable (looked in ${found.looked.join(", ")}). Run npm run test:setup.`);
  return found.path;
}

function stagedLeftovers(at: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(at, dir), { withFileTypes: true })) {
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.includes("refutation")) out.push(rel);
    }
  };
  walk("");
  return out;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "coherence-tach-"));
  shop(root);
  adapter = new PythonAdapter(root);
});

after(async () => {
  await adapter.close();
  rmSync(root, { recursive: true, force: true });
});

test("tach reads tach.toml as tach 0.34 does: the nearest file at or above the root, regex from and expose matched whole, a visibility list constraining only its modules, an exposed package above the internal", () => {
  const nested = join(root, "services", "api");
  mkdirSync(nested, { recursive: true });
  assert.equal(findTachConfig(nested), join(root, "tach.toml"), "a nested project inherits the tach.toml above it");
  const config = readTachConfig(join(root, "tach.toml"));
  assert.deepEqual(config.modules.map((m) => m.path), ["shop.orders", "shop.billing", "shop.reports"]);
  const governed = tachGovernance(config, "shop.orders.store.ORDER_ROWS", "shop.orders.facade.total");
  assert.ok(governed.governed, JSON.stringify(governed));
  assert.match(governed.fact, /interface for tach module shop\.orders \(expose \["facade\.\*"\] from \["shop\.orders"\]\) that exposes facade\.total and not store\.ORDER_ROWS/);
  const variant = (change: (c: TachConfig) => void): TachConfig => {
    const c = structuredClone(config);
    change(c);
    return c;
  };
  const why = (c: TachConfig, protectedPath = "shop.orders.store.ORDER_ROWS", chokepoint = "shop.orders.facade.total"): string => {
    const g = tachGovernance(c, protectedPath, chokepoint);
    assert.ok(!g.governed, `${protectedPath} should not be governed`);
    return g.reason;
  };
  assert.ok(tachGovernance(variant((c) => (c.interfaces[0]!.from = ["shop\\.ord.*"])), "shop.orders.store.ORDER_ROWS", "shop.orders.facade.total").governed, "from is a regular expression");
  assert.match(why(variant((c) => (c.interfaces[0]!.from = ["shop"]))), /declares no \[\[interfaces\]\]/, "from is matched whole, never as a prefix");
  assert.match(why(variant((c) => c.interfaces[0]!.expose.push("store"))), /exposes "store", which covers/, "an exposed module above the internal reaches it as an attribute");
  assert.ok(tachGovernance(variant((c) => c.interfaces[0]!.expose.push("sto")), "shop.orders.store.ORDER_ROWS", "shop.orders.facade.total").governed, "expose is matched whole: sto covers nothing");
  assert.match(why(variant((c) => (c.interfaces[0]!.visibility = ["shop.billing"]))), /visibility list/, "an interface with a visibility list constrains only the modules it lists");
  assert.match(why(config, "shop.orders.store.ORDER_ROWS", "shop.billing.bill.bill"), /no interface of one module stands between them/);
  assert.match(why(variant((c) => (c.interfaces[0]!.expose = ["api.*"]))), /exposes the chokepoint/, "a door the interface does not expose is refused like the thing");
  assert.match(why(config, "shop.orders", "shop.orders.facade.total"), /is tach module shop\.orders itself/);
  assert.match(why(config, "elsewhere.x", "elsewhere.y"), /lies in no module tach\.toml declares/);
  const strict = variant((c) => {
    c.interfaces = [];
    c.modules[0]!.strict = true;
  });
  assert.match(why(strict), /declares no \[\[interfaces\]\]/, "strict alone is deprecated and not read as governed");
  rmSync(join(root, "services"), { recursive: true, force: true });
});

test("a chokepoint tach governs grades checker-choked by tach with the interface as the fact, the module's own use inside; a planted outside import grades broken with tach's interface error as the bypass; without tach.toml the grading is Coherence's own", async () => {
  tachForTests();
  await adapter.forget();
  const clean = await checkChokepoint(adapter, { protects: "ORDER_ROWS", chokepoint: "total", ...hint, root });
  assert.equal(clean.grade, "checker-choked", clean.reason);
  assert.equal(clean.verdict, "pass", clean.reason);
  assert.equal(clean.enforcer, "tach (tach.toml)");
  assert.match(clean.reason, /tach\.toml declares an interface for tach module shop\.orders \(expose \["facade\.\*"\] from \["shop\.orders"\]\)/);
  assert.ok(clean.sites.some((s) => s.file === "shop/orders/audit.py" && s.of === "protected" && s.class === "inside"), "the module's own code is free to use its internals");
  assert.equal(clean.bypasses.length, 0);

  write(root, "shop/reports/leak.py", LEAK);
  await adapter.forget();
  const broken = await checkChokepoint(adapter, { protects: "ORDER_ROWS", chokepoint: "total", ...hint, root });
  assert.equal(broken.grade, "broken", broken.reason);
  assert.equal(broken.verdict, "fail");
  assert.ok(broken.bypasses.length > 0);
  const refused = broken.bypasses.find((b) => b.file === "shop/reports/leak.py" && b.line === 1);
  assert.ok(refused !== undefined, JSON.stringify(broken.bypasses));
  assert.match(refused.checker ?? "", /^tach \(tach\.toml\): tach refuses it: the path 'shop\.orders\.store\.ORDER_ROWS' is not part of the public interface for 'shop\.orders'/);
  assert.match(broken.reason, /shop\/reports\/leak\.py:1 in module top level \(tach \(tach\.toml\): tach refuses it/);
  assert.ok(!broken.bypasses.some((b) => b.file === "shop/orders/audit.py"), "the module's own use is never a bypass");
  rmSync(join(root, "shop/reports/leak.py"));

  rmSync(join(root, "tach.toml"));
  await adapter.forget();
  const without = await checkChokepoint(adapter, { protects: "ORDER_ROWS", chokepoint: "total", ...hint, root });
  assert.equal(without.grade, "broken", "without tach.toml, Coherence's own check calls the in-module use outside total a bypass, as it always has");
  assert.deepEqual(without.bypasses.map((b) => `${b.file}:${b.line}`), ["shop/orders/audit.py:1", "shop/orders/audit.py:5"]);
  assert.ok(without.bypasses.every((b) => b.checker === undefined));
  assert.doesNotMatch(without.reason, /tach/);
  assert.notEqual(without.refutation, "refused by the checker");
  write(root, "tach.toml", TACH_TOML);
  await adapter.forget();
});

test("tach's refusal of an outside import staged in a throwaway copy is the refutation, and the copy is gone with nothing written into the project", async () => {
  tachForTests();
  await adapter.forget();
  const before = stagedLeftovers(root);
  const copies = readdirSync(tmpdir()).filter((n) => n.startsWith("coherence-tach-") && !join(tmpdir(), n).startsWith(root));
  const result = await checkChokepoint(adapter, { protects: "ORDER_ROWS", chokepoint: "total", ...hint, root });
  assert.equal(result.refutation, "refused by the checker", result.refutationAccount);
  assert.match(result.refutationAccount, /`from shop\.orders\.store import ORDER_ROWS` staged at shop\/billing\/coherence_refutation_[0-9a-f]+\.py:1 in tach module shop\.billing, in a throwaway copy/);
  assert.match(result.refutationAccount, /was refused by tach \(\d+ ms\): the path 'shop\.orders\.store\.ORDER_ROWS' is not part of the public interface for 'shop\.orders'; the throwaway copy is gone/);
  assert.match(result.refutationAccount, /the checker-choked rung is enforced by tach \(tach\.toml\), and its refusal is the refutation/);
  assert.deepEqual(stagedLeftovers(root), before, "nothing staged lands in the project");
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith("coherence-tach-") && !join(tmpdir(), n).startsWith(root));
  assert.deepEqual(after.filter((n) => !copies.includes(n)), [], "the throwaway copy is removed");
});

test("without tach installed the tach rung is not available and the grade says why", async () => {
  const saved = process.env["COHERENCE_TACH"];
  process.env["COHERENCE_TACH"] = join(root, "no-such-tach");
  try {
    await adapter.forget();
    const result = await checkChokepoint(adapter, { protects: "ORDER_ROWS", chokepoint: "total", ...hint, root });
    assert.equal(result.grade, "broken");
    assert.ok(result.bypasses.some((b) => b.file === "shop/orders/audit.py"), "without tach the module boundary is not drawn, so Coherence's own check stands");
    rmSync(join(root, "shop/orders/audit.py"));
    await adapter.forget();
    const clean = await checkChokepoint(adapter, { protects: "ORDER_ROWS", chokepoint: "total", ...hint, root });
    assert.equal(clean.grade, "reference-choked", clean.reason);
    assert.equal(clean.enforcer, "Coherence's check at the edit and in CI");
    assert.match(clean.reason, /tach\.toml restricts shop\.orders\.store\.ORDER_ROWS through an interface of tach module shop\.orders, but tach is not installed \(looked in .*no-such-tach \(COHERENCE_TACH\)\), so tach's rung is not available/);
  } finally {
    write(root, "shop/orders/audit.py", "from shop.orders.store import ORDER_ROWS\n\n\ndef audit() -> int:\n    return len(ORDER_ROWS)\n");
    if (saved === undefined) delete process.env["COHERENCE_TACH"];
    else process.env["COHERENCE_TACH"] = saved;
    await adapter.forget();
  }
});

test("an edit spawns tach only when a file it wrote is a Python file inside a tach module, and checks only those files", { timeout: 120_000 }, async () => {
  const real = tachForTests();
  const at = mkdtempSync(join(tmpdir(), "coherence-tach-edit-"));
  const shim = mkdtempSync(join(tmpdir(), "coherence-tach-count-"));
  const log = join(shim, "calls");
  writeFileSync(join(shim, "tach"), `#!/bin/sh\nprintf '%s\\n' "$PWD $*" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(join(shim, "tach"), 0o755);
  const calls = (): string[] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "") : []);
  const saved = process.env["COHERENCE_TACH"];
  process.env["COHERENCE_TACH"] = join(shim, "tach");
  const edit = new PythonAdapter(at);
  try {
    shop(at);
    write(at, "scripts/report.py", "from shop.orders.facade import total  # never ORDER_ROWS\n\nprint(total())\n");
    const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: at, encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "seed");
    const hook = (file: string) => editContext(at, { cwd: at, session_id: "tach-edit", tool_name: "Edit", tool_input: { file_path: join(at, file) } }, { adapter: edit });

    const outside = await hook("scripts/report.py");
    assert.deepEqual(calls(), [], "an edit to a file in no tach module spawns no tach");
    assert.match(outside, /not witnessed yet, and no file this edit wrote lies in a tach module, so nothing was spawned/, "what was not witnessed is said, never silent");

    write(at, "shop/reports/summary.py", "from shop.orders.facade import total  # never ORDER_ROWS\n\n\ndef summary() -> str:\n    return str(total())\n");
    const inside = await hook("shop/reports/summary.py");
    assert.equal(inside, "", "a clean edit inside a tach module says nothing");
    assert.ok(calls().length > 0, "an edit inside a tach module runs tach");
    assert.ok(calls().every((c) => !c.startsWith(`${at} `)), `tach never runs over the whole tree at an edit, only over a throwaway copy: ${calls().join(" | ")}`);

    const before = calls().length;
    const again = await hook("scripts/report.py");
    assert.equal(calls().length, before, "a second edit outside every tach module spawns nothing new");
    assert.equal(again, "", "the refusal witnessed earlier stands while tach.toml is unchanged");

    write(at, "shop/reports/summary.py", `${LEAK}\n# ORDER_ROWS\n`);
    const leaked = await hook("shop/reports/summary.py");
    assert.match(leaked, /Structural defect revealed at this edit/);
    assert.match(leaked, /shop\/reports\/summary\.py:1/);
  } finally {
    if (saved === undefined) delete process.env["COHERENCE_TACH"];
    else process.env["COHERENCE_TACH"] = saved;
    await edit.close();
    rmSync(at, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});
