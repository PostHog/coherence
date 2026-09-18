import assert from "node:assert/strict";
import test from "node:test";
import { answerGlossary } from "../query/query.ts";
import { renderGlossaryView } from "./glossary-view.ts";
import type { GlossaryCoverage, GlossaryViewState } from "./model.ts";

function ambiguousMeaningCoverage(): GlossaryCoverage {
  return {
    version: 1,
    projectGlossary: "glossary.json",
    fingerprint: "ambiguous-meaning",
    population: { files: [], excluded: [], unreadable: [], extraction: "fixture", limits: [] },
    totals: { terms: 1, uses: 1, known: 1, rejected: 0, unresolved: 0, unreviewedContexts: 1 },
    terms: [{
      term: "unit basis",
      state: "declared",
      concept: null,
      layer: null,
      definition: null,
      properties: {},
      confusables: [],
      meaningAlternatives: [
        { concept: "exposure", layer: "project", definition: "The amount subject to loss.", properties: { unit_basis: "percentage" }, confusables: ["allocation"] },
        { concept: "allocation", layer: "project", definition: "The amount assigned to a strategy.", properties: { unit_basis: "percentage" }, confusables: ["exposure"] },
      ],
      fingerprint: "unit-basis",
      count: 1,
      contexts: [{ component: "money", fingerprint: "money-unit-basis", disposition: "unreviewed", because: null }],
      uses: [{ file: "src/money.ts", line: 4, component: "money", text: "unit_basis", kind: "code", fingerprint: "unit-basis-use" }],
    }],
  };
}

test("Scope and query glossary readings display every applicable property meaning instead of a false missing-definition line", () => {
  const coverage = ambiguousMeaningCoverage();
  const query = answerGlossary(coverage, ["unit basis"]).text;
  assert.match(query, /2 applicable property meanings; spelling alone does not select an owner/);
  assert.match(query, /applicable property meaning: exposure \(project\) — The amount subject to loss/);
  assert.match(query, /applicable property meaning: allocation \(project\) — The amount assigned to a strategy/);
  assert.doesNotMatch(query, /No settled definition/);

  const state: GlossaryViewState = {
    coverage,
    layers: [],
    query: "unit basis",
  };
  const rendered = renderGlossaryView(state).text;
  assert.match(rendered, /2 applicable property meanings; this spelling alone does not select an owner/);
  assert.match(rendered, /exposure[\s\S]*The amount subject to loss/);
  assert.match(rendered, /allocation[\s\S]*The amount assigned to a strategy/);
  assert.doesNotMatch(rendered, /No settled definition/);
});
