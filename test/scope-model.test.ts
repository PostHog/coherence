import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScopeModel } from "../src/readings/scope-model.ts";
import type { PromiseComponent, PromiseGate, PromiseModel } from "../src/readings/promise-model.ts";
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

test("scope model — original spec explanation and unanchored declarations survive projection", () => {
  const input = fixture([component("api")]);
  const spec = {
    prose: "An architectural paragraph.\n\nAnother paragraph, unchanged.",
    why: "**authenticate.** Because access matters.\n\nUnmatched rationale remains available.",
    invariants: ["authenticate", "unanchored"],
    refutations: ["authenticate: removed check; test red", "unmatched observation"],
    claims: ['boundary "authenticate" at auth via guard "auth test"', "config exists at this node"],
    claimKinds: { "config exists at this node": "structural" },
  };
  Object.assign(input.graph.nodes[0], spec);
  const scope = buildScopeModel(input.graph, input.promise);
  for (const key of Object.keys(spec) as (keyof typeof spec)[])
    assert.deepEqual(scope.nodes[0][key], spec[key], key);
  assert.equal(scope.nodes[0].intent, input.promise.components[0].intent);
  assert.deepEqual(scope.guarantees, [], "authored declarations never manufacture evidence");
  const empty = fixture([component("empty")]);
  const emptyScope = buildScopeModel(empty.graph, empty.promise);
  assert.deepEqual(JSON.parse(JSON.stringify(emptyScope)), emptyScope, "absent spec fields survive JSON transport unchanged");
});

test("scope model — graph/promise population mismatch refuses rather than drawing partial truth", () => {
  const input = fixture([component("api"), component("core")]);
  input.graph.nodes.pop();
  assert.throws(() => buildScopeModel(input.graph, input.promise), /scope component parity failed/);

  const dangling = fixture([component("api", { relies: [{ to: "missing", crossing: null, via: null }] })]);
  assert.throws(() => buildScopeModel(dangling.graph, dangling.promise), /reliance target is not a component/);
});

test("scope semantics — containment and atlas meanings preserve ownership without inventing dependencies or verdicts", () => {
  const input = fixture([component("."), component("core", { gates: [gate("checked")] }), component("other")]);
  input.graph.nodes.find(n => n.id === "c:core")!.parent = "c:.";
  input.graph.nodes.push(
    { id: "f:core.ts", kind: "file", label: "core.ts", parent: "c:core" },
    { id: "s:core.ts#checkedAt", kind: "symbol", label: "checkedAt", parent: "f:core.ts" },
    { id: "f:other.ts", kind: "file", label: "other.ts", parent: "c:other" },
    { id: "s:core.ts#ambiguous", kind: "symbol", label: "ambiguous", parent: "f:core.ts" },
    { id: "s:other.ts#ambiguous", kind: "symbol", label: "ambiguous", parent: "f:other.ts" },
  );
  const atlas = { charts: { source: "Untrusted text", verdict: "Permitted conclusion" }, transitions: {
    checkedAt: { from: "source", to: "verdict", translates: "Exact authored meaning.", security: true },
    ambiguous: { from: "source", to: "verdict", translates: "Do not guess an owner." },
    absent: { from: "source", to: "verdict", translates: "Keep unresolved declarations." },
  } };
  const model = buildScopeModel(input.graph, input.promise, { atlas });
  assert.deepEqual(model.containment, [{ parent: ".", child: "core" }]);
  assert.deepEqual(model.charts, atlas.charts);
  const declared = model.transitions.find(t => t.symbol === "checkedAt")!;
  assert.equal(declared.component, "core");
  assert.equal(declared.translates, atlas.transitions.checkedAt.translates);
  assert.deepEqual(declared.guarantees, [model.guarantees[0].id]);
  assert.equal(model.transitions.find(t => t.symbol === "ambiguous")!.component, null);
  assert.match(model.transitions.find(t => t.symbol === "ambiguous")!.ownerWhy!, /AMBIGUOUS/);
  assert.equal(model.transitions.find(t => t.symbol === "absent")!.component, null);
  assert.deepEqual(model.relations, [], "neither containment nor atlas charts fabricate an import");
  assert.equal(model.guarantees.length, 1, "declared semantics do not manufacture guarantees");
  input.graph.nodes.find(n => n.id === "c:core")!.parent = "c:missing";
  assert.throws(() => buildScopeModel(input.graph, input.promise, { atlas }), /containment parent/);
});

test("scope roles — declared test imports are not runtime gravity or proof of a named oracle", () => {
  const input = fixture([component(".", { mass: { files: 0, lines: 0 } }),
    component("core"), component("test", { mass: { files: 100, lines: 10000 }, relies: [{ to: "core", crossing: null, via: null }] })]);
  input.graph.nodes.find(n => n.id === "c:core")!.parent = "c:.";
  const model = buildScopeModel(input.graph, input.promise, { testDir: "test" });
  assert.equal(model.nodes.find(n => n.id === ".")!.role, "project");
  assert.equal(model.nodes.find(n => n.id === "test")!.role, "evidence");
  assert.equal(model.center, "core");
  assert.equal(model.relations[0].kind, "evidence-import");
  assert.deepEqual(model.guarantees, [], "importing an implementation proves no guarantee");
  assert.equal(buildScopeModel(input.graph, input.promise).nodes.find(n => n.id === "test")!.role, "assembly", "without testDir, the name is not a classification");
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
    root: "fixture", center: null, nodes: [], relations: [], guarantees: [], containment: [], charts: null, transitions: [],
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
