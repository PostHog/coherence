import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSET_KINDS, valueAt } from "../src/readings/scope/catalog.ts";
import { AssetCatalog } from "../src/readings/scope/capture.ts";
import { DEFAULT_SCOPE, projectView, resolveScopeConfiguration } from "../src/readings/scope/configuration.ts";

test("Scope configuration — every default is ordinary project configuration and every asset family is selectable", () => {
  assert.deepEqual(resolveScopeConfiguration({ ...DEFAULT_SCOPE, extends: false }), DEFAULT_SCOPE);
  const c = new AssetCatalog();
  for (const kind of Object.keys(ASSET_KINDS)) c.add(kind, "fixture", kind, { preserved: { arbitrary: ["value", 1, false] } }, "fixture");
  const catalog = c.finish("fixture");
  for (const kind of Object.keys(ASSET_KINDS)) {
    const config = resolveScopeConfiguration({ version: 1, extends: false, views: [{ id: "custom", title: kind, kinds: [kind], renderer: "table", fields: [{ field: "attributes.preserved" }] }] });
    const p = projectView(catalog, config.views[0]);
    assert.equal(p.assets.length, 1, kind);
    assert.deepEqual(valueAt(p.assets[0], "attributes.preserved.arbitrary"), ["value", 1, false]);
    assert.deepEqual(catalog.schema[kind]["attributes.preserved.arbitrary"], ["array"]);
  }
});

test("Scope configuration — projects replace views by identity, add projections and remove defaults without renderer code", () => {
  const custom = { id: "structure", title: "Work map", kinds: ["work"], renderer: "graph", fields: [{ field: "attributes.owner" }], graph: { relations: ["depends-on"], layout: "breadthfirst" } };
  const config = resolveScopeConfiguration({ version: 1, removeViews: ["hooks"], views: [custom] });
  assert.deepEqual(config.views[0], custom);
  assert.ok(config.views.some(v => v.id === "journal"));
  assert.ok(!config.views.some(v => v.id === "hooks"));
  assert.equal(DEFAULT_SCOPE.views[0].title, "Structure", "project resolution does not mutate the shipped default");
});

test("Scope configuration — malformed, ambiguous and executable-looking declarations refuse with a field address", () => {
  const valid = { version: 1, extends: false, views: [{ id: "custom", title: "Custom", kinds: ["work"], renderer: "table", fields: [{ field: "label" }] }] };
  const cases = [
    { ...valid, version: 2 }, { ...valid, source: "execute.js" }, { ...valid, initialView: "absent" },
    { ...valid, views: [valid.views[0], valid.views[0]] }, { ...valid, views: [] },
    ...[{ kinds: ["typo"] }, { renderer: "code" }, { pageSize: 0 }, { groupBy: "kind" }, { where: [{ field: "label", op: "eval", value: "1" }] },
      { fields: [{ field: "attributes.__proto__.polluted" }] }, { fields: [{ field: "label", format: "html" }] },
      { where: [{ field: "label", op: "in", value: "x" }] }, { sort: [{ field: "label", direction: "up" }] },
      { graph: { layout: "grid", relations: [] } }, { renderer: "graph", graph: { layout: "random", relations: [] } },
    ].map(change => ({ ...valid, views: [{ ...valid.views[0], ...change }] })),
  ];
  for (const value of cases) assert.throws(() => resolveScopeConfiguration(value), /Scope configuration/, JSON.stringify(value));
  assert.equal(valueAt({}, "constructor"), undefined);
});

test("Scope configuration — Structure is an ordinary configured renderer with bounded declarative detail options", () => {
  const structure = DEFAULT_SCOPE.views.find(view => view.id === "structure")!;
  assert.equal(structure.renderer, "structure");
  assert.deepEqual(structure.structure, {
    rankingWeights: { peers: 3, guarantees: 2, security: 1, consumers: 2 }, downtownCount: 3, downtownThreshold: 0.65,
    spacing: { x: 480, y: 420 }, shortTerminalNames: {}, cardFields: ["intent"], promisePreviewCount: 3,
    initialRelationshipLayer: "opening", tileZoom: 0.46, detailZoom: 0.50,
    implementations: { rank: "default", layout: "default", route: "default", card: "default", view: "default" }, extensionOptions: {},
  });
  const config = resolveScopeConfiguration({ version: 1, extends: false, views: [{
    id: "architecture", title: "Architecture", kinds: ["component"], renderer: "structure", fields: [], structure: { downtownCount: 4, promisePreviewCount: 1, tileZoom: 0.4, detailZoom: 1.1 },
  }] });
  assert.deepEqual(config.views[0].structure, { ...structuredClone(structure.structure), downtownCount: 4, promisePreviewCount: 1, tileZoom: 0.4, detailZoom: 1.1 });
  const valid = { version: 1, extends: false, views: [{ id: "architecture", title: "Architecture", kinds: ["component"], renderer: "structure", fields: [] }] };
  for (const structure of [{ tileZoom: 1, detailZoom: 0.8 }, { downtownCount: 0 }, { promisePreviewCount: -1 }, { arbitrary: true }, { columns: 3 }, { summaryGuarantees: 2 }]) {
    assert.throws(() => resolveScopeConfiguration({ ...valid, views: [{ ...valid.views[0], structure }] }), /Scope configuration/);
  }
  assert.throws(() => resolveScopeConfiguration({ ...valid, views: [{ ...valid.views[0], fields: [{ field: "label" }] }] }), /does not accept generic fields/);
  assert.throws(() => resolveScopeConfiguration({ ...valid, views: [{ ...valid.views[0], renderer: "table", fields: [{ field: "label" }], structure: {} }] }), /only structure views/);
});

test("Scope configuration — extension modules and named Structure implementations are declarative and bounded", () => {
  const config = resolveScopeConfiguration({ version: 1, extensions: ["./scope/presentation.jsx"], views: [{
    ...DEFAULT_SCOPE.views[0], structure: { implementations: { rank: "project.rank", card: "project.card" },
      rankingWeights: { peers: 7 }, spacing: { x: 600 }, shortTerminalNames: { "Long promise": "Short" },
      cardFields: ["intent", "rationale"], extensionOptions: { project: { accent: "blue" } } },
  }] });
  assert.deepEqual(config.extensions, ["./scope/presentation.jsx"]);
  assert.equal(config.views[0].structure!.implementations.rank, "project.rank");
  assert.equal(config.views[0].structure!.implementations.route, "default");
  assert.deepEqual(config.views[0].structure!.spacing, { x: 600, y: 420 });
  for (const value of [
    { version: 1, extensions: ["../outside.jsx"] }, { version: 1, extensions: ["/absolute.jsx"] },
    { version: 1, extensions: ["./same.jsx", "./same.jsx"] },
  ]) assert.throws(() => resolveScopeConfiguration(value), /Scope configuration extensions/);
  for (const structure of [{ implementations: { rank: "bare" } }, { cardFields: ["html"] },
    { rankingWeights: { peers: -1 } }, { spacing: { y: 20 } }, { shortTerminalNames: { label: "" } }, { extensionOptions: [] },
    { extensionOptions: { run: () => "code" } }, { extensionOptions: { value: Infinity } }]) {
    assert.throws(() => resolveScopeConfiguration({ version: 1, views: [{ ...DEFAULT_SCOPE.views[0], structure }] }), /Scope configuration/);
  }
});

test("Scope projections — filtering, typed sorting and pagination conserve assets and disclose omitted edges", () => {
  const c = new AssetCatalog();
  for (const [id, n] of [["a", 2], ["b", 10], ["c", 3]] as const) c.add("work", id, id, { n, state: "active" }, "work");
  c.link("depends-on", "work:b", "work:a"); c.link("depends-on", "work:b", "work:c");
  const catalog = c.finish("fixture");
  const config = resolveScopeConfiguration({ version: 1, extends: false, views: [{ id: "work", title: "Work", kinds: ["work"], renderer: "graph", fields: [{ field: "attributes.n" }],
    where: [{ field: "attributes.n", op: "gte", value: 3 }], sort: [{ field: "attributes.n", direction: "desc" }], pageSize: 1, graph: { layout: "grid", relations: ["depends-on"] } }] });
  const first = projectView(catalog, config.views[0]);
  assert.deepEqual(first.assets.map(a => a.id), ["work:b"]); assert.equal(first.matched, 2); assert.equal(first.total, 3);
  assert.equal(first.withheld, 1); assert.equal(first.withheldRelations, 2); assert.equal(first.relations.length, 0);
  assert.deepEqual(projectView(catalog, config.views[0], "", 1).assets.map(a => a.id), ["work:c"]);
  assert.equal(projectView(catalog, config.views[0], "active").matched, 2);
  assert.equal(projectView(catalog, config.views[0], "missing").matched, 0);
});

test("Scope catalog — failed sources publish no partial assets and unresolved relationships remain explicitly unresolved", async () => {
  const c = new AssetCatalog();
  await c.read("damaged", () => { c.add("work", "partial", "partial", {}, "damaged"); throw new Error("torn row"); });
  c.add("work", "valid", "valid", {}, "work"); c.link("depends-on", "work:valid", "work:missing");
  const result = c.finish("fixture");
  assert.ok(!result.assets.some(a => a.id === "work:partial"));
  assert.equal(result.sources[0].status, "unavailable"); assert.match(result.sources[0].message, /torn row/);
  assert.equal(result.assets.find(a => a.id === "work:missing")!.kind, "reference");
  assert.equal(result.assets.find(a => a.id === "work:missing")!.attributes.status, "unresolved");
});
