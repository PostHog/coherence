import { test } from "node:test";
import assert from "node:assert/strict";
import { renderScope } from "../src/readings/render-scope.ts";
import type { ScopeModel, ScopeNode } from "../src/readings/scope-model.ts";

const node = (id: string, x: number, y: number): ScopeNode => ({
  id, graphNodeId: `c:${id}`, label: id, intent: `${id} intent`, x, y,
  ring: id === "." ? 0 : 1, angle: 0,
  mass: { ownedFiles: 1, ownedLines: 10, ownedSurface: 5, inboundReliance: 0,
    boundaryAuthority: 0, guaranteeResponsibility: 0, total: 5 },
});

const model: ScopeModel = {
  containment: [], charts: null, transitions: [],
  root: "fixture", center: ".", nodes: [node(".", 0, 0), node("quiet", 220, 0)],
  relations: [{ id: "r:quiet->.", source: "quiet", target: ".", kind: "reliance",
    crossing: { from: "edge", to: "core" }, via: null }],
  guarantees: [{ id: "g:.", component: ".", invariant: "stays coherent",
    chokepoint: "verify", grade: "A", verdict: "pass", crossing: null, oracle: "scope fixture" }],
};

test("scope render is deterministic, self-contained, and status-honest", () => {
  const first = renderScope(model);
  assert.equal(first, renderScope(structuredClone(model)), "same model renders byte-identically");
  assert.match(first, /^<!doctype html>/);
  assert.match(first, /<svg/);
  assert.match(first, /class="node pass center"/);
  assert.match(first, /class="node unmeasured"/,
    "a component with no guarantees is visibly unlike one whose guarantees pass");
  assert.match(first, /unmeasured — no guarantees/);
  assert.match(first, /class="relation naked"/);
  assert.match(first, /project center of gravity/i);
  assert.doesNotMatch(first, /https?:|<link\b|<img\b|\bsrc=|@import|fetch\s*\(/,
    "the artifact needs no second request");
});

test("scope cards — titles have an opaque title bar and explicit contrast, with full text retained in the inspector", () => {
  const input = structuredClone(model);
  input.nodes[0].label = 'An unusually long component title with <untrusted> text';
  const html = renderScope(input);
  assert.match(html, /<rect class="card"[^>]*rx="14"/);
  assert.match(html, /class="title-bar"/);
  assert.match(html, /svg text\{[^}]*fill:#253247/);
  assert.match(html, /\.card\{fill:#fff/);
  assert.doesNotMatch(html, /<pattern/);
  assert.match(html, /<h2>An unusually long component title with &lt;untrusted&gt; text<\/h2>/);
  assert.doesNotMatch(html, /<untrusted>/);
});

test("empty scope states absence instead of drawing an authoritative empty system", () => {
  const html = renderScope({ root: "empty", center: null, nodes: [], relations: [], guarantees: [], containment: [], charts: null, transitions: [] });
  assert.match(html, /NO COMPONENTS/);
  assert.match(html, /model contains no component subjects/);
});
