import { test } from "node:test";
import assert from "node:assert/strict";
import { getViewportForBounds } from "@xyflow/react";
import { resolveScopeConfiguration } from "../src/readings/scope/configuration.ts";
import { valueAt } from "../src/readings/scope/catalog.ts";

test("Scope layout — configured twelve-component graph remains readable and every supported layout clears rectangles", async () => {
  const graph = resolveScopeConfiguration({ version: 1, extends: false, views: [{
    id: "graph", title: "Graph fixture", renderer: "graph", kinds: ["component"], fields: [{ field: "attributes.intent", label: "Purpose" }],
    graph: { relations: ["contains"], layout: "grid", width: 330, height: 220, gap: 48 },
  }] }).views[0].graph;
  const { layoutProjection } = await import(new URL("../src/readings/scope/layout.mjs", import.meta.url).href);
  const assets = Array.from({ length: 12 }, (_, i) => ({ id: `component:${i}`, attributes: { mass: { total: i === 0 ? 1 : 20 + i * 13 } } }));
  const relations = assets.slice(1).map((a, i) => ({ id: `edge:${i}`, source: assets[i].id, target: a.id }));
  const opening = layoutProjection(assets, relations, graph, valueAt);
  const viewport = getViewportForBounds(opening.bounds, 1384, 660, 0.12, 1, 0.12);
  assert.ok(19 * viewport.zoom >= 14, `opening title size ${19 * viewport.zoom}px`);
  for (const layout of ["concentric", "grid", "breadthfirst", "circle"]) {
    const result = layoutProjection(assets, relations, { ...graph, layout }, valueAt);
    const positions = Object.values(result.positions) as Array<{ x: number; y: number }>;
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      assert.ok(Math.abs(positions[i].x - positions[j].x) + 1e-7 >= result.width + 48 || Math.abs(positions[i].y - positions[j].y) + 1e-7 >= result.height + 48, `${layout} lost rectangular clearance`);
    }
  }
});
