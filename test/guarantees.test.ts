import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpProject, cfg, cleanup } from "./_helpers.ts";
import { buildGraph } from "../src/derivation/derive.ts";
import { parseSpec } from "../src/derivation/walk.ts";
import { parseBoundary, guaranteeRef } from "../src/verification/boundary.ts";
import { projectGuarantees, runGuaranteesCommand } from "../src/verification/guarantees-cli.ts";
import { resolveGuaranteeLinks } from "../src/verification/guarantees.ts";
import { recordTaxonomy, taxonomyView } from "../src/taxonomy/taxonomy-ledger.ts";

const claim = 'boundary "session identity survives" at session via guard "identity test"';
const base = `# Provider\n\nOwns continuity.\n\n## works when\n- ${claim}\n`;
async function fixture() {
  const root = await tmpProject({ "coherence.config.json": "{}\n", "root.spec.md": "# Root\n",
    "provider/provider.spec.md": base, "provider/session.ts": "export function session() { return 1; }\n",
    "consumer/consumer.spec.md": "# Consumer\n", "consumer/run.ts": 'import { session } from "../provider/session.ts";\nexport const run = session;\n' });
  const config = cfg(root), graph = await buildGraph(config);
  const record = recordTaxonomy(config, graph, { target: "provider/session.ts", expected: null, session: "test",
    because: "Owns continuity in this fixture", evidence: ["provider/session.ts"],
    answers: { "signal:continuity": "yes" }, roles: ["role:session-subscription-owner"], facets: ["facet:lifecycle"] });
  const ref = guaranteeRef("provider", parseBoundary(claim)!);
  const address = { claim: ref, subject: "provider/session.ts", assessment: record.id,
    obligation: "guarantee:G-SESSION", because: "The named claim addresses identity only, not every lifecycle concern." };
  const reliance = { claim: ref, provider: "provider", because: "The consumer requires stable session identity." };
  await writeFile(join(root, "provider/provider.spec.md"), `${base}\n## addresses\n- ${JSON.stringify(address)}\n`);
  await writeFile(join(root, "consumer/consumer.spec.md"), `# Consumer\n\n## relies on\n- ${JSON.stringify(reliance)}\n`);
  return { root, config, address, reliance, ref };
}

test("guarantee references — reorder is stable, contract and owner changes expire", () => {
  const boundary = parseBoundary(claim)!;
  const ref = guaranteeRef("provider", boundary);
  assert.equal(guaranteeRef("provider", { crossing: boundary.crossing, oracle: boundary.oracle, verb: boundary.verb, chokepoint: boundary.chokepoint, inv: boundary.inv }), ref);
  for (const change of [{ inv: "new" }, { chokepoint: "other" }, { oracle: "other" }, { verb: "test" as const }, { crossing: { from: "a", to: "b" } }])
    assert.notEqual(guaranteeRef("provider", { ...boundary, ...change }), ref);
  assert.notEqual(guaranteeRef("renamed", boundary), ref);
});

test("guarantee spec sections — malformed declarations stay visible and metadata is not prose", () => {
  const parsed = parseSpec('# Test\n\nDescription.\n\n## addresses\n- {"claim":"x"}\n- broken\nstray\n## relies on\n- {}\n## addresses\n- {}\n');
  assert.equal(parsed.guaranteeLinks?.addresses.length, 2);
  assert.equal(parsed.guaranteeLinks?.relies.length, 1);
  assert.equal(parsed.guaranteeLinks?.problems.length, 3);
  assert.ok(!JSON.stringify(parsed.prose).includes('claim'));
  assert.equal(parseSpec('# Test\n').guaranteeLinks, undefined);
});

test("guarantee links — expired premises never become current and passing evidence never proves satisfaction", async () => {
  const f = await fixture();
  try {
    const graph = await buildGraph(f.config), model = await projectGuarantees(f.config, graph);
    const taxonomy = { view: taxonomyView(f.config), error: null };
    const resolve = () => resolveGuaranteeLinks(graph, model.guarantees, model.relations, taxonomy);
    assert.equal(resolve().issues.length, 0);
    assert.equal(resolve().links.length, 2);
    assert.ok(resolve().obligations.some(o => o.mapping === "unlinked"));
    assert.equal(resolve().obligations.find(o => o.obligation === f.address.obligation)?.mapping, "linked");
    for (const verdict of ["pass", "fail", "stale", "unknown"] as const) {
      model.guarantees[0].verdict = verdict;
      assert.ok(resolve().links.every(l => l.status === "current"));
      assert.ok(resolve().obligations.every(o => o.satisfaction === "unverified"));
    }
    taxonomy.view.items[0].status = "stale";
    taxonomy.view.items[0].staleReasons = ["subject content changed"];
    assert.equal(resolve().links.find(l => l.kind === "addresses")?.status, "stale");
    assert.ok(resolve().obligations.every(o => o.mapping === "unlinked"));
    taxonomy.view = taxonomyView(f.config);
    taxonomy.view.items[0].record.id = `t-${"0".repeat(64)}`;
    assert.equal(resolve().links.find(l => l.kind === "addresses")?.status, "stale");
    taxonomy.view = taxonomyView(f.config);
    const provider = graph.nodes.find(n => n.id === "c:provider")!;
    const originalAddress = provider.guaranteeLinks!.addresses[0];
    for (const change of [{ obligation: "guarantee:NOT-ACTIVATED" }, { subject: "missing.ts" }, { extra: "unrecognized field" }, { because: "\u001b[31munsafe" }]) {
      provider.guaranteeLinks!.addresses[0] = { ...f.address, ...change };
      assert.equal(resolve().links.find(l => l.kind === "addresses")?.status, "invalid");
    }
    provider.guaranteeLinks!.addresses[0] = originalAddress;
    const unavailable = resolveGuaranteeLinks(graph, model.guarantees, model.relations, { view: null, error: "damaged ledger" });
    assert.equal(unavailable.taxonomy, "unavailable");
    assert.ok(unavailable.issues.some(p => p.includes("damaged ledger")));
    assert.equal(unavailable.links.find(l => l.kind === "addresses")?.status, "invalid");
    const file = graph.nodes.find(n => n.id === "f:provider/session.ts")!;
    file.parent = "c:consumer";
    assert.ok(resolve().issues.some(p => p.includes("Current subject ownership")));
    file.parent = "c:provider";
    provider.guaranteeLinks!.addresses.push(f.address);
    assert.ok(resolve().issues.some(p => p.includes("Duplicate")));
    provider.guaranteeLinks!.addresses.pop();
    model.guarantees.push(model.guarantees[0]);
    assert.ok(resolve().links.every(l => l.status === "invalid"));
    model.guarantees.pop();
    model.guarantees[0].id = `g-${"0".repeat(64)}`;
    assert.ok(resolve().links.every(l => l.status === "invalid"));
    model.guarantees[0].id = f.ref;
    model.relations.length = 0;
    assert.equal(resolve().links.find(l => l.kind === "relies")?.status, "invalid");
    graph.nodes = graph.nodes.filter(n => n.id !== "c:provider");
    assert.ok(resolve().issues.some(p => p.includes("Provider component is missing")));
  } finally { await cleanup(f.root); }
});

test("guarantees CLI — read-only integrity checks retain unmatched obligations and reject stale or damaged links", async () => {
  const f = await fixture();
  try {
    const before = await readdir(join(f.root, ".coherence"));
    const good = await runGuaranteesCommand(f.config, ["--check", "--json"]);
    assert.equal(good.code, 0);
    assert.equal(JSON.parse(good.output).guarantees[0].verdict, "unknown");
    assert.deepEqual(await readdir(join(f.root, ".coherence")), before);
    assert.equal((await runGuaranteesCommand(f.config, ["--unknown"])).code, 2);
    assert.equal((await runGuaranteesCommand(f.config, ["--json", "--json"])).code, 2);
    // Reordering the canonical population does not renumber a saved reference.
    const originalSpec = await readFile(join(f.root, "provider/provider.spec.md"), "utf8");
    await writeFile(join(f.root, "provider/provider.spec.md"), originalSpec.replace(`- ${claim}`, `- boundary "another claim" at session\n- ${claim}`));
    const reordered = await runGuaranteesCommand(f.config, ["--check", "--json"]);
    assert.equal(reordered.code, 0);
    assert.ok(JSON.parse(reordered.output).guarantees.some((g: { id: string }) => g.id === f.ref));
    await writeFile(join(f.root, "provider/session.ts"), "export function session() { return 2; }\n");
    const stale = await runGuaranteesCommand(f.config, ["--check", "--json"]);
    assert.equal(stale.code, 1);
    assert.equal(JSON.parse(stale.output).links.find((l: { kind: string }) => l.kind === "addresses").status, "stale");
    const spec = await readFile(join(f.root, "provider/provider.spec.md"), "utf8");
    await writeFile(join(f.root, "provider/provider.spec.md"), spec.replace(JSON.stringify(f.address), "torn"));
    assert.equal((await runGuaranteesCommand(f.config, ["--check"])).code, 1);
  } finally { await cleanup(f.root); }
});
