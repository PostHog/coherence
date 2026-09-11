import { test } from "node:test";
import assert from "node:assert/strict";
import { renderScope } from "../src/readings/render-scope.ts";
import { AssetCatalog } from "../src/readings/scope/capture.ts";
import { resolveScopeConfiguration } from "../src/readings/scope/configuration.ts";

test("scope renderer — one self-contained bundle preserves data without admitting markup", async () => {
  const catalog = new AssetCatalog();
  catalog.add("component", "core", '</script><img src=x onerror=alert(1)>', { why: "Full authored text", verdict: "unknown" }, "fixture");
  const snapshot = { version: 1 as const, catalog: catalog.finish("fixture"), configuration: resolveScopeConfiguration() };
  const first = await renderScope(snapshot);
  assert.equal(first, await renderScope(structuredClone(snapshot)));
  assert.match(first, /^<!doctype html>/);
  assert.doesNotMatch(first, /<img src=x/);
  assert.doesNotMatch(first, /<(script|link)[^>]+(?:src|href)=/);
  const embedded = first.match(/<script type="application\/json" id="scope-data">(.*?)<\/script>/s)![1];
  assert.deepEqual(JSON.parse(embedded), snapshot);
  assert.match(first, /Full authored text/);
});
