import { test } from "node:test";
import assert from "node:assert/strict";
import { getViewportForBounds } from "@xyflow/react";
import { DEFAULT_STRUCTURE_OPTIONS } from "../src/readings/scope/structure-contract.ts";

const component = (id: string, detail = 0) => ({ id, label: id, guarantees: Array.from({ length: detail }, (_, i) => ({ id: `${id}:g${i}` })), boundaries: [], resources: [], entrances: [] });

test("Structure layout — opening a stack reserves local detail without moving its anchor or colliding with peers", async () => {
  const { structureLayout } = await import(new URL("../src/readings/scope/structure-layout.mjs", import.meta.url).href);
  const components = [component("component:a", 3), component("component:b"), component("component:c"), component("component:d")];
  const closed = structureLayout(components, new Set(), { ...DEFAULT_STRUCTURE_OPTIONS, columns: 2 });
  const opened = structureLayout(components, new Set(["component:a"]), { ...DEFAULT_STRUCTURE_OPTIONS, columns: 2 });
  assert.deepEqual(opened.positions["component:a"].x, closed.positions["component:a"].x);
  assert.deepEqual(opened.positions["component:a"].y, closed.positions["component:a"].y);
  assert.ok(opened.positions["component:a"].height > closed.positions["component:a"].height);
  assert.ok(opened.positions["component:c"].y > closed.positions["component:c"].y, "later rows yield space to expansion");
  assert.ok(opened.regions["component:a"], "opened ownership region is explicit");
  for (const [leftId, left] of Object.entries(opened.positions) as Array<[string, { x: number; y: number; width: number; height: number }]>) for (const [rightId, right] of Object.entries(opened.positions) as Array<[string, { x: number; y: number; width: number; height: number }]>) {
    if (leftId >= rightId) continue;
    assert.ok(left.x + left.width + 19 < right.x || right.x + right.width + 19 < left.x || left.y + left.height + 19 < right.y || right.y + right.height + 19 < left.y, `${leftId} clears ${rightId}`);
  }
});

test("Structure layout — twelve opening stacks fit with readable titles at a conventional desktop viewport", async () => {
  const { structureLayout } = await import(new URL("../src/readings/scope/structure-layout.mjs", import.meta.url).href);
  const opening = structureLayout(Array.from({ length: 12 }, (_, index) => component(`component:${index}`, index % 3)), new Set(), DEFAULT_STRUCTURE_OPTIONS);
  const viewport = getViewportForBounds(opening.bounds, 1384, 660, 0.12, 1, 0.12);
  assert.ok(17 * viewport.zoom >= 14, `opening title size ${17 * viewport.zoom}px`);
  assert.equal(opening.columns, 3);
});
