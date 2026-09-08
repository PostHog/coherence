import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.ts";
import { buildGraph } from "../src/derivation/derive.ts";
import { parseBoundary } from "../src/verification/boundary.ts";

test("repository assemblies — contracts follow their chokepoint owners and composition stays thin", async () => {
  const graph = await buildGraph(await loadConfig(fileURLToPath(new URL("../", import.meta.url))));
  const files = new Map(graph.nodes.filter(n => n.kind === "file").map(n => [n.id, n]));
  const symbols = graph.nodes.filter(n => n.kind === "symbol" && n.path?.startsWith("src/"));
  const components = graph.nodes.filter(n => n.kind === "component");
  const assemblies = components.filter(n => n.parent === "c:src");
  assert.ok(assemblies.length >= 8, "the implementation must not collapse back into one source bucket");
  assert.deepEqual([...files.values()].filter(n => n.parent === "c:src").map(n => n.label).sort(),
    ["cli.ts", "commands.ts", "config.ts", "hook-cli.ts", "scaffold.ts", "types.ts"]);
  let anchors = 0;
  for (const component of components) for (const claim of component.claims ?? []) {
    const boundary = parseBoundary(claim);
    if (!boundary) continue;
    anchors++;
    const owners = new Set(symbols.filter(n => n.label === boundary.chokepoint).map(n => files.get(n.parent!)?.parent));
    assert.ok(owners.has(component.id), `${component.label}: ${boundary.chokepoint} belongs to ${[...owners].join(", ")}`);
  }
  assert.ok(anchors > 0, "ownership reconciliation must examine live contracts");
  const normalize = (text: string) => text.toLowerCase().replace(/[\/\-_]+/g, " ").replace(/\s+/g, " ").trim();
  for (const component of components) for (const invariant of component.invariants ?? []) {
    assert.ok(normalize(component.why ?? "").includes(normalize(invariant)),
      `${component.label}: rationale for ${invariant} must travel with its owner`);
  }
});
