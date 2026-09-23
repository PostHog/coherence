import assert from "node:assert/strict";
import test from "node:test";
import { answerGlossary } from "../query/query.ts";
import { renderGlossaryView } from "./glossary-view.ts";
import type { Coverage } from "../../lifecycle/glossary-coverage.ts";
import { projectGlossaryCoverage } from "./glossary-projection.ts";
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

/** A full reading with two recurring undefined terms, one sense at risk, and an ordinary use of a defined word. */
function signalCoverage(): Coverage {
  const plain = (name: string) => [{ component: "books", fingerprint: `plain-${name}`, disposition: "unreviewed", because: null }];
  const use = (name: string) => [{ file: "books/notes.md", line: 1, component: "books", text: `the ${name}`, kind: "prose", fingerprint: `use-${name}` }];
  const base = { concept: null, layer: null, definition: null, properties: {}, confusables: [], count: 3 };
  return {
    version: 1,
    projectGlossary: "glossary.json",
    fingerprint: "signal",
    population: { files: [{ file: "books/notes.md", kind: "prose", lines: 9 }], excluded: [], unreadable: [], extraction: "fixture", limits: [] },
    totals: { terms: 4, uses: 12, known: 2, rejected: 0, unresolved: 2, unreviewedContexts: 1 },
    terms: [
      { ...base, term: "rebate", state: "unresolved", fingerprint: "rebate", contexts: plain("rebate"), uses: use("rebate"), recurrence: { prose: 3, components: 1 } },
      { ...base, term: "premium", state: "unresolved", fingerprint: "premium", contexts: plain("premium"), uses: use("premium"), recurrence: { prose: 6, components: 3 } },
      { ...base, term: "exposure", state: "concept", concept: "exposure", layer: "project", definition: "Money at risk.", fingerprint: "exposure", uses: use("exposure"),
        contexts: [{ component: "sales", fingerprint: "exposure-sales", disposition: "unreviewed", because: null, risk: "the rejected name hazard is beside this use" }] },
      { ...base, term: "allocation", state: "concept", concept: "allocation", layer: "project", definition: "A share.", fingerprint: "allocation", uses: use("allocation"), contexts: plain("allocation") },
    ],
  };
}

test("Scope leads its glossary with the ranked signal and keeps totals in the population disclosure; query shows recurrence and each context's risk", () => {
  const coverage = projectGlossaryCoverage(signalCoverage());
  const rendered = renderGlossaryView({ coverage, layers: [], query: "" }).text;
  const at = (needle: string | RegExp): number => {
    const index = typeof needle === "string" ? rendered.indexOf(needle) : rendered.search(needle);
    assert.ok(index >= 0, `the view shows ${String(needle)}`);
    return index;
  };
  const disclosure = at("<summary>Population and limits</summary>");
  assert.ok(at("<strong>premium</strong>") < at("<strong>rebate</strong>"), "the recurring terms are ranked, most recurring first");
  assert.ok(at("<strong>rebate</strong>") < at("Senses at risk"), "the ranked terms come before the senses at risk");
  assert.ok(at("Senses at risk") < at("<strong>exposure</strong> in sales"));
  assert.ok(at(/Recurring terms that lack a definition/) < at("Full observed population"), "the signal leads the section");
  assert.ok(at("Full observed population") > disclosure, "the population's totals wait in the disclosure");
  assert.ok(at("Page evidence:") > disclosure, "the page's embedded counts wait in the disclosure");
  assert.ok(!/<summary>allocation/.test(rendered), "an ordinary use of a defined word awaits no review and is not listed");
  assert.equal(coverage.terms.find((t) => t.term === "allocation")?.unreviewedContextCount, 0);

  const premium = answerGlossary(coverage, ["premium"]).text;
  assert.match(premium, /^premium \[unresolved\]; recurs on 6 prose lines across 3 components/);
  const exposure = answerGlossary(coverage, ["exposure"]).text;
  assert.match(exposure, /sales: unreviewed; sense at risk: the rejected name hazard is beside this use/);
  const allocation = answerGlossary(coverage, ["allocation"]).text;
  assert.match(allocation, /books: unreviewed; no risk to its sense/);
  assert.ok(exposure.indexOf("Bounded page evidence") > exposure.indexOf("sense at risk"), "the term's reading leads the answer");
});

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
