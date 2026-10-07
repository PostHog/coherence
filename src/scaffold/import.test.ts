/**
 * The boundary drafts: scaffold import tach over a synthetic project whose
 * tach.toml holds three modules, one [[interfaces]] entry and one product.yaml.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Io } from "../journal/cli.ts";
import { loadSpecModel } from "../spec/model.ts";
import { scaffoldCommand } from "./cli.ts";

const TACH = `# a synthetic shop
source_roots = ["."]

[[modules]]
path = "shop.billing"
depends_on = [
    "shop.stock", # prices
]
layer = "core"

[[modules]]
path = "shop.orders"
depends_on = ["shop.billing", { path = "shop.stock", deprecated = true }]

[[modules]]
path = "shop.stock"
depends_on = []
utility = true

[[interfaces]]
expose = [
    "api\\\\.facade.*",
    "api\\\\.(alpha|beta)",
]
from = ["shop\\\\.billing"]
`;

const PRODUCT = `name: Billing
owners:
    - team-payments
    - team-risk # second
`;

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-import-"));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  write("tach.toml", TACH);
  write("shop/billing/product.yaml", PRODUCT);
  write("shop/billing/api/facade/__init__.py", "");
  write("shop/billing/api/facade/charges.py", "def charge(): pass\n");
  write("shop/billing/rates.py", "RATE = 1\n");
  write("shop/orders/__init__.py", "");
  write("shop/stock/__init__.py", "");
  return root;
}

interface Run {
  code: number;
  out: string[];
  err: string[];
}

function run(cwd: string, ...argv: string[]): Run {
  const result: Run = { code: 0, out: [], err: [] };
  const io: Io = { cwd, out: (line) => result.out.push(line), err: (line) => result.err.push(line) };
  const code = scaffoldCommand(argv, io);
  if (typeof code !== "number") throw new Error("scaffold import stays synchronous");
  result.code = code;
  return result;
}

const BILLING = `# Billing

<what shop.billing is for, in one line> Billing, drafted from tach module shop.billing (tach.toml:4).
owners: team-payments, team-risk

## invariants
- declared dependencies only: Code in shop/billing imports another tach module only where tach.toml declares it: shop.stock.
  over: every import from shop/billing into another tach module that tach check reads
  via: test_tach_dependencies_shop_billing
  because: <why this exists; what it protects against>
  crossing: <trust level> -> <trust level>
  refuted: <what was broken> -> <what was seen> (<date>)
  kinds: <a, b: the kinds of thing protected, or none>
- reached only through its interface: Code outside shop/billing imports it only through api.facade, api\\.(alpha|beta).
  over: every import of shop/billing from another tach module that tach check reads
  via: test_tach_interface_shop_billing
  because: <why this exists; what it protects against>
  crossing: <trust level> -> <trust level>
  refuted: <what was broken> -> <what was seen> (<date>)
  kinds: <a, b: the kinds of thing protected, or none>
- internals only through api.facade: Code outside shop/billing reaches the internal it protects only through api.facade.
  protects: <an internal of shop/billing that code outside it reaches only through api.facade>
  chokepoint: shop/billing/api/facade/
  from: outside the component
  because: <why this exists; what it protects against>
  crossing: <trust level> -> <trust level>
  refuted: <what was broken> -> <what was seen> (<date>)
  kinds: <a, b: the kinds of thing protected, or none>
- internals only through api\\.(alpha|beta): Code outside shop/billing reaches the internal it protects only through api\\.(alpha|beta).
  protects: <an internal of shop/billing that code outside it reaches only through api\\.(alpha|beta)>
  chokepoint: <the module or symbol 'api\\.(alpha|beta)' names under shop/billing; a pattern names no single path>
  from: outside the component
  because: <why this exists; what it protects against>
  crossing: <trust level> -> <trust level>
  refuted: <what was broken> -> <what was seen> (<date>)
  kinds: <a, b: the kinds of thing protected, or none>
`;

const ORDERS = `# Orders

<what shop.orders is for, in one line> drafted from tach module shop.orders (tach.toml:11).

## invariants
- declared dependencies only: Code in shop/orders imports another tach module only where tach.toml declares it: shop.billing, shop.stock.
  over: every import from shop/orders into another tach module that tach check reads
  via: test_tach_dependencies_shop_orders
  because: <why this exists; what it protects against>
  crossing: <trust level> -> <trust level>
  refuted: <what was broken> -> <what was seen> (<date>)
  kinds: <a, b: the kinds of thing protected, or none>
`;

test("scaffold import tach drafts each module's spec from tach.toml: its folder, its intent, an owners: line from product.yaml, its declared dependencies, and a chokepoint per exposed path that governs from outside the component", () => {
  const root = fixture();
  try {
    const result = run(root, "import", "tach", "shop.billing", "shop.orders");
    assert.equal(result.code, 0, result.err.join("\n"));
    assert.equal(result.out.join("\n"), `--- shop/billing/Billing.spec.md\n${BILLING.trimEnd()}\n\n--- shop/orders/Orders.spec.md\n${ORDERS.trimEnd()}\n`);
    const err = result.err.join("\n");
    assert.match(err, /shop\.billing: layer = "core": the spec grammar has no layers/);
    assert.match(err, /def test_tach_dependencies_shop_billing\(\):\n {4}assert _violations\("dependencies", "shop.billing"\) == \[\]/);
    assert.match(err, /def test_tach_interface_shop_billing\(\):/);
    assert.doesNotMatch(err, /def test_tach_interface_shop_orders/, "a module no interface names gets no interface test");
    assert.match(err, /"tach", "check", "--dependencies", "--interfaces", "--output", "json"/);
    const all = run(root, "import", "tach", "--all");
    assert.equal(all.out.filter((line) => line.startsWith("--- ")).length, 3);
    assert.match(all.err.join("\n"), /shop\.stock: utility = true/);
    assert.ok(!existsSync(join(root, "shop/billing/Billing.spec.md")), "printing writes nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scaffold import tach --write creates only the specs that do not exist, reports each one skipped, and what it writes parses", () => {
  const root = fixture();
  try {
    const kept = "# Stock\n\nThe stock, written by hand.\n\n## invariants\n";
    writeFileSync(join(root, "shop/stock/Stock.spec.md"), kept, "utf8");
    const first = run(root, "import", "tach", "--all", "--write");
    assert.equal(first.code, 0, first.err.join("\n"));
    assert.deepEqual(first.out.filter((line) => /^(wrote|skipped) /.test(line)), [
      "wrote shop/billing/Billing.spec.md",
      "wrote shop/orders/Orders.spec.md",
      "skipped shop.stock: shop/stock already holds Stock.spec.md",
    ]);
    assert.equal(readFileSync(join(root, "shop/stock/Stock.spec.md"), "utf8"), kept, "an existing spec is untouched");
    assert.equal(readFileSync(join(root, "shop/billing/Billing.spec.md"), "utf8"), BILLING);
    writeFileSync(join(root, "shop/orders/Orders.spec.md"), "# Orders\n\nEdited since.\n\n## invariants\n", "utf8");
    const again = run(root, "import", "tach", "shop.orders", "--write");
    assert.deepEqual(again.out.filter((line) => /^(wrote|skipped) /.test(line)), ["skipped shop.orders: shop/orders already holds Orders.spec.md"]);
    assert.equal(readFileSync(join(root, "shop/orders/Orders.spec.md"), "utf8"), "# Orders\n\nEdited since.\n\n## invariants\n");
    const model = loadSpecModel(root, { runs: false });
    const billing = model.components.find((c) => c.folder === "shop/billing");
    assert.ok(billing !== undefined, "the written draft is a component");
    assert.equal(billing.invariants.length, 4);
    assert.deepEqual(model.problems.filter((p) => p.file.includes("Billing")), [], "the written draft parses");
    assert.deepEqual(billing.owners, ["team-payments", "team-risk"], "the owners land in the owners: line, not the intent");
    assert.doesNotMatch(billing.intent, /team-payments/);
    const facade = billing.invariants.find((i) => i.name === "internals only through api.facade")!.enforcements;
    assert.equal(facade.length, 0, "the protected internal is still a placeholder, so no chokepoint is checked yet");
    const orders = model.components.find((c) => c.folder === "shop/orders");
    assert.equal(orders?.owners, undefined, "a module with no product.yaml declares no owners");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scaffold import tach refuses a malformed tach.toml with its line, and an unknown module, and drafts nothing", () => {
  const root = fixture();
  try {
    const unknown = run(root, "import", "tach", "shop.billing", "shop.nowhere");
    assert.equal(unknown.code, 1);
    assert.match(unknown.err.join("\n"), /declares no module "shop\.nowhere"/);
    assert.deepEqual(unknown.out, [], "an unknown module refuses the whole command");
    writeFileSync(join(root, "tach.toml"), TACH.replace('path = "shop.orders"', "path = shop.orders"), "utf8");
    const malformed = run(root, "import", "tach", "--all", "--write");
    assert.equal(malformed.code, 1);
    assert.match(malformed.err.join("\n"), /tach\.toml:12: "shop\.orders" is not a TOML value; quote a string/);
    assert.deepEqual(malformed.out, []);
    assert.ok(!existsSync(join(root, "shop/billing/Billing.spec.md")), "nothing is written");
    writeFileSync(join(root, "tach.toml"), '[[modules]]\npath = "a"\n\n[[interfaces]]\nexpose = "api"\nfrom = ["a"]\n', "utf8");
    assert.match(run(root, "import", "tach", "a").err.join("\n"), /tach\.toml:4: expose must be an array/);
    const neither = run(root, "import", "tach");
    assert.match(neither.err.join("\n"), /takes module names, or --all/);
    assert.match(run(root, "import", "nx", "--all").err.join("\n"), /no boundary source is named "nx"; the sources are tach/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
