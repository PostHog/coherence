import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScopeModel } from "../src/scope-model.ts";
import type { PromiseComponent, PromiseGate, PromiseModel } from "../src/promise-model.ts";
import type { Graph } from "../src/types.ts";

const gate = (inv: string, crossing: PromiseGate["crossing"] = null): PromiseGate => ({
  inv, chokepoint: `${inv}At`, verb: "test", oracle: `${inv} test`, crossing,
  grade: "A", verdict: "pass", reliants: [],
});

const component = (dir: string, o: Partial<PromiseComponent> = {}): PromiseComponent => ({
  dir, label: dir, intent: `${dir} intent`, zone: null, gates: [], relies: [],
  mass: { files: 1, lines: 10 }, accounted: { files: 0, lines: 0 }, ...o,
});

const fixture = (components: PromiseComponent[]): { graph: Graph; promise: PromiseModel } => ({
  graph: {
    generatedAt: "ignored", root: "fixture", absRoot: "/fixture", bindings: null,
    nodes: components.map((c) => ({ id: `c:${c.dir}`, label: c.label, kind: "component" })),
    edges: [],
  },
  promise: {
    root: "fixture", intent: "", generatedAt: "ignored", head: null, dirty: false,
    zones: [], components, review: null,
  },
});

test("scope model — canonical component, reliance, and guarantee populations survive projection", () => {
  const input = fixture([
    component("api", {
      gates: [gate("authenticate", { from: "public", to: "trusted" }), gate("rate limit")],
      relies: [{ to: "core", crossing: null, via: null }],
      mass: { files: 3, lines: 120 },
    }),
    component("core", { gates: [gate("commit")], mass: { files: 2, lines: 80 } }),
  ]);
  const scope = buildScopeModel(input.graph, input.promise);

  assert.deepEqual(scope.nodes.map((n) => n.id), ["api", "core"]);
  assert.equal(scope.relations.length, 1);
  assert.deepEqual(scope.relations[0], {
    id: "r:api->core:0", source: "api", target: "core", kind: "reliance", crossing: null, via: null,
  });
  assert.deepEqual(scope.guarantees.map((g) => g.invariant), ["authenticate", "rate limit", "commit"]);
  assert.deepEqual(scope.nodes[0].mass, {
    ownedFiles: 3, ownedLines: 120, ownedSurface: 10, inboundReliance: 0,
    boundaryAuthority: 1, guaranteeResponsibility: 2, total: 13,
  });
  assert.equal(scope.nodes[1].mass.inboundReliance, 1);
});

test("scope model — graph/promise population mismatch refuses rather than drawing partial truth", () => {
  const input = fixture([component("api"), component("core")]);
  input.graph.nodes.pop();
  assert.throws(() => buildScopeModel(input.graph, input.promise), /scope component parity failed/);

  const dangling = fixture([component("api", { relies: [{ to: "missing", crossing: null, via: null }] })]);
  assert.throws(() => buildScopeModel(dangling.graph, dangling.promise), /reliance target is not a component/);
});

test("scope model — weighted graph medoid puts the project's mass at the center", () => {
  const input = fixture([
    component("a", { relies: [{ to: "b", crossing: null, via: null }], mass: { files: 0, lines: 0 } }),
    component("b", { relies: [{ to: "c", crossing: null, via: null }], mass: { files: 0, lines: 0 } }),
    component("c", { mass: { files: 40, lines: 4_000 } }),
  ]);
  const scope = buildScopeModel(input.graph, input.promise);
  assert.equal(scope.center, "c");
  assert.deepEqual(scope.nodes.map((n) => [n.id, n.ring]), [["a", 2], ["b", 1], ["c", 0]]);
  assert.deepEqual(scope.nodes.find((n) => n.id === "c") &&
    [scope.nodes.find((n) => n.id === "c")!.x, scope.nodes.find((n) => n.id === "c")!.y], [0, 0]);
});

test("scope model — empty, single, disconnected, and cyclic populations have honest stable geometry", () => {
  const empty = fixture([]);
  assert.deepEqual(buildScopeModel(empty.graph, empty.promise), {
    root: "fixture", center: null, nodes: [], relations: [], guarantees: [],
  });

  const one = fixture([component("only")]);
  const singleton = buildScopeModel(one.graph, one.promise);
  assert.equal(singleton.center, "only");
  assert.deepEqual([singleton.nodes[0].ring, singleton.nodes[0].x, singleton.nodes[0].y], [0, 0, 0]);

  const comps = [
    component("c", { relies: [{ to: "a", crossing: null, via: null }] }),
    component("a", { relies: [{ to: "b", crossing: null, via: null }] }),
    component("b", { relies: [{ to: "c", crossing: null, via: null }] }),
    component("island"),
  ];
  const forward = fixture(comps), reversed = fixture([...comps].reverse());
  const a = buildScopeModel(forward.graph, forward.promise);
  const b = buildScopeModel(reversed.graph, reversed.promise);
  assert.deepEqual(a, b, "input ordering cannot alter the serialized model");
  const island = a.nodes.find((n) => n.id === "island")!;
  assert.ok(island.ring > 0, "a disconnected component is placed on an explicit outer ring");
  for (const node of a.nodes) assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
});
