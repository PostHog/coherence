import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogSchema, type Asset, type Catalog, type Relation, type SourceReading } from "../src/readings/scope/catalog.ts";
import { buildStructureModel } from "../src/readings/scope/structure-model.ts";

const asset = (id: string, kind: string, label: string, attributes: Asset["attributes"] = {}, source = "structure"): Asset =>
  ({ id, kind, label, attributes, source });

test("Structure projection — declared promises and only meaningful edges retain catalog identity and evidence limits", () => {
  const assets = [
    asset("component:.", "component", "Project", { intent: "Owns the whole.", why: "Keeps ownership explicit." }),
    asset("component:src", "component", "Core", { intent: "Runs commands.", parent: "c:." }),
    asset("component:test", "component", "Evidence", { intent: "Exercises promises.", parent: "c:." }),
    asset("description:architecture:.:purpose", "description", "Project purpose", { category: "project-purpose", text: "Tell the project story." }, "architecture"),
    asset("entrance:.:cli", "entrance", "Use the CLI", { component: "src", description: "Command entrance." }, "architecture"),
    asset("architectural-link:.:checks", "architectural-link", "Exercises promises", {}, "architecture"),
    asset("invariant:anchored", "invariant", "commands are attributable", { owner: "src", anchored: true }, "specs"),
    asset("invariant:unanchored", "invariant", "all paths are explained", { owner: "src", anchored: false }, "specs"),
    asset("guarantee:g", "guarantee", "commands are attributable", { component: "src", invariant: "commands are attributable", oracle: "command test", verdict: "pass" }),
    asset("claim:c", "claim", "boundary", {}), asset("refutation:r", "refutation", "observed failure", {}),
    asset("assessment:a", "assessment", "src/cli.ts", { status: "stale", snapshot: { subject: { owner: "c:src" } }, classification: { roles: ["role:orchestrator"], facets: ["facet:boundary"] } }, "taxonomy"),
  ];
  const relations: Relation[] = [
    { id: "import", kind: "imports", source: "component:src", target: "component:test", attributes: {} },
    { id: "architecture", kind: "architecture", source: "component:test", target: "component:src", attributes: { label: "Exercises promises", because: "Tests execute named oracles.", declaration: "architectural-link:.:checks" } },
    { id: "relies", kind: "relies", source: "component:test", target: "component:src", attributes: { kind: "relies", claim: "g", because: "Evidence consumes the promise.", declaration: "guarantee-link:declared" } },
    { id: "anchor", kind: "anchors", source: "claim:c", target: "invariant:anchored", attributes: {} },
    { id: "refutes", kind: "refutes", source: "refutation:r", target: "invariant:anchored", attributes: {} },
  ];
  const sources: SourceReading[] = [{ id: "taxonomy", status: "available", count: 1, message: "read" }];
  const catalog: Catalog = { version: 1, project: "Fixture", assets, relations, sources, schema: catalogSchema(assets), limits: [] };
  const model = buildStructureModel(catalog);
  assert.equal(model.project.purposes.length, 1); assert.equal(model.project.entrances.length, 1);
  assert.deepEqual(model.relationships.map(row => row.kind), ["architecture", "guarantee-reliance"]);
  const core = model.components.find(component => component.id === "component:src")!;
  assert.deepEqual(core.guarantees.map(guarantee => [guarantee.label, guarantee.verdict]), [
    ["commands are attributable", "pass"], ["all paths are explained", "unanchored"],
  ]);
  assert.equal(core.guarantees[0].id, "invariant:anchored"); assert.equal(core.guarantees[0].owner, "component:src");
  assert.deepEqual(core.guarantees[0].anchors, ["claim:c"]); assert.deepEqual(core.guarantees[0].refutations, ["observed failure"]);
  assert.deepEqual(core.guarantees[0].evidence.map(row => row.id), ["guarantee:g"]);
  assert.deepEqual(core.taxonomy, { labels: ["facet:boundary", "role:orchestrator"], subjects: 1, stale: 1, unavailable: false, states: { stale: 1 } });
  const reliance = model.relationships.find(row => row.kind === "guarantee-reliance")!;
  assert.equal(reliance.label, "commands are attributable"); assert.equal(reliance.declarationId, "guarantee-link:declared");
  assert.deepEqual(reliance.guaranteeIds, ["invariant:anchored"]);
});

test("Structure semantics — unavailable sources and unresolved architecture stay explicit", () => {
  const assets = [asset("component:.", "component", "Project"),
    asset("architecture-issue:x", "architecture-issue", "Architecture issue", { message: "component absent is unresolved" }, "architecture")];
  const sources: SourceReading[] = [{ id: "taxonomy", status: "unavailable", count: 0, message: "damaged taxonomy" }];
  const catalog: Catalog = { version: 1, project: "Fixture", assets, relations: [], sources, schema: catalogSchema(assets), limits: [] };
  const model = buildStructureModel(catalog);
  assert.deepEqual(model.issues, [{ source: "architecture", message: "component absent is unresolved" }, { source: "taxonomy", message: "damaged taxonomy" }]);
  assert.deepEqual(model.components[0].taxonomy, { labels: [], subjects: 0, stale: 0, unavailable: true, states: {} });
});
