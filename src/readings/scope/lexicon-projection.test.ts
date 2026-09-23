import assert from "node:assert/strict";
import test from "node:test";
import type { Coverage, VocabularyTerm } from "../../lifecycle/lexicon-coverage.ts";
import {
  embeddedLexiconBytes,
  LEXICON_PAGE_LIMITS,
  projectLexiconCoverage,
  type LexiconProjectionLimits,
} from "./lexicon-projection.ts";

function term(
  name: string,
  state: VocabularyTerm["state"] = "concept",
  count = 2,
): VocabularyTerm {
  return {
    term: name,
    state,
    concept: state === "unresolved" || state === "rejected" ? null : `concept-${name}`,
    layer: state === "unresolved" ? null : "project",
    definition: `definition <${name}>`,
    properties: { invariant: `<${name}> remains whole`, nested: { rank: 3 } },
    confusables: [`${name}-other <not the same>`],
    fingerprint: `term-fingerprint-${name}`,
    count,
    contexts: [
      { component: "review-me", fingerprint: `context-review-${name}`, disposition: "unreviewed", because: "sense <unclear>", risk: "a rejected name <beside> the use" },
      { component: "settled", fingerprint: `context-settled-${name}`, disposition: "confirmed", because: null },
    ],
    uses: [
      { file: `src/${name}<one>.ts`, line: 1, component: "review-me", text: `const ${name} = "<one>"`, kind: "code", fingerprint: `use-one-${name}` },
      { file: `src/${name}-two.ts`, line: 2, component: "settled", text: `// ${name} <two>`, kind: "code", fingerprint: `use-two-${name}` },
    ],
  };
}

function coverage(terms: VocabularyTerm[]): Coverage {
  return {
    version: 1,
    projectLexicon: "lexicon.json",
    fingerprint: "authoritative-fingerprint",
    population: {
      files: Array.from({ length: 20 }, (_, i) => ({ file: `src/file-${i}<x>.ts`, kind: "code", lines: i + 1 })),
      excluded: Array.from({ length: 20 }, (_, i) => ({ file: `excluded-${i}<x>`, reason: "excluded <reason>" })),
      unreadable: Array.from({ length: 20 }, (_, i) => ({ file: `unreadable-${i}<x>`, reason: "unreadable <reason>" })),
      extraction: "identifiers and prose <escaped>",
      limits: ["not semantic coverage", "<limit>"],
    },
    terms,
    totals: {
      terms: terms.length,
      uses: terms.reduce((n, item) => n + item.count, 0),
      known: terms.filter((item) => item.state !== "unresolved").length,
      rejected: terms.filter((item) => item.state === "rejected").length,
      unresolved: terms.filter((item) => item.state === "unresolved").length,
      unreviewedContexts: terms.reduce((n, item) => n + item.contexts.filter((context) => context.disposition === "unreviewed").length, 0),
    },
  };
}

const compact: LexiconProjectionLimits = {
  bytes: 32 * 1024,
  terms: 4,
  contextsPerTerm: 1,
  usesPerTerm: 1,
  populationEntries: 3,
};

test("projection uses the builder's exact escaped JSON byte count and never weakens the budget", () => {
  const source = coverage([term("<script>"), term("ordinary")]);
  const projected = projectLexiconCoverage(source, compact);
  const escaped = JSON.stringify(projected).replace(/</g, "\\u003c");
  assert.equal(embeddedLexiconBytes(projected), Buffer.byteLength(escaped, "utf8"));
  assert.ok(embeddedLexiconBytes(projected) <= compact.bytes);
  assert.equal(projected.projection?.byteLimit, compact.bytes);
  assert.equal(LEXICON_PAGE_LIMITS.bytes, 256 * 1024, "the production ceiling remains 256 KiB");
});

test("projection is deterministic, leads with the ranked signal, counts only at-risk contexts as awaiting review, and caps population records across all categories", () => {
  const unreviewed = (name: string) => [{ component: "anywhere", fingerprint: `plain-${name}`, disposition: "unreviewed", because: null }];
  const source = coverage([
    { ...term("reviewed", "concept", 99), contexts: [{ component: "settled", fingerprint: "reviewed-context", disposition: "confirmed", because: null }] },
    { ...term("no-risk", "alias", 60), contexts: unreviewed("no-risk") },
    { ...term("unresolved", "unresolved", 50), contexts: unreviewed("unresolved") },
    { ...term("ranked-low", "unresolved", 1), contexts: unreviewed("ranked-low"), recurrence: { prose: 3, components: 1 } },
    { ...term("ranked-high", "unresolved", 1), contexts: unreviewed("ranked-high"), recurrence: { prose: 5, components: 3 } },
    term("awaiting", "declared", 2),
    { ...term("rejected", "rejected", 1), contexts: unreviewed("rejected") },
  ]);
  const limits = { ...compact, terms: 7 };
  const first = projectLexiconCoverage(source, limits);
  const second = projectLexiconCoverage(source, limits);
  assert.deepEqual(first, second);
  assert.deepEqual(first.terms.map((item) => item.term), ["ranked-high", "ranked-low", "awaiting", "rejected", "unresolved", "reviewed", "no-risk"],
    "recurring undefined terms by recurrence, then at-risk senses, rejected spellings, other unresolved terms, and the rest");
  assert.deepEqual(first.attention?.undefinedTerms.map((t) => t.term), ["ranked-high", "ranked-low"]);
  assert.deepEqual(first.attention?.senses.map((s) => s.term), ["awaiting"]);
  assert.equal(first.terms.find((t) => t.term === "no-risk")?.unreviewedContextCount, 0, "an unreviewed context with nothing at risk awaits no review");
  assert.equal(first.terms.find((t) => t.term === "awaiting")?.unreviewedContextCount, 1);
  assert.equal(first.population.files.length + first.population.excluded.length + first.population.unreadable.length, 3);
  assert.deepEqual([first.population.files.length, first.population.excluded.length, first.population.unreadable.length], [1, 1, 1], "each populated category remains represented");
});

test("authoritative totals and fingerprint remain whole and the source reading is never mutated", () => {
  const source = coverage(Array.from({ length: 8 }, (_, i) => term(`term-${i}`)));
  const before = structuredClone(source);
  const projected = projectLexiconCoverage(source, compact);
  assert.deepEqual(source, before);
  assert.deepEqual(projected.totals, source.totals);
  assert.notEqual(projected.totals, source.totals, "the projected state cannot mutate authoritative totals by alias");
  assert.equal(projected.fingerprint, source.fingerprint);
  assert.equal(projected.projection?.contexts, source.terms.reduce((n, item) => n + item.contexts.length, 0));
  assert.deepEqual(projected.projection?.population, { files: 20, excluded: 20, unreadable: 20 });
  assert.equal(projected.terms.length, compact.terms);
});

test("selected entries preserve definitions, properties, confusables, instance identity, and evidence fingerprints while labeling omitted evidence", () => {
  const instance = term("instance-name", "instance", 9);
  const source = coverage([instance]);
  const projected = projectLexiconCoverage(source, compact);
  const selected = projected.terms[0]!;
  assert.equal(selected.state, "instance");
  assert.equal(selected.definition, instance.definition);
  assert.deepEqual(selected.properties, instance.properties);
  assert.deepEqual(selected.confusables, instance.confusables);
  assert.equal(selected.fingerprint, instance.fingerprint);
  assert.equal(selected.contextCount, 2);
  assert.equal(selected.unreviewedContextCount, 1);
  assert.equal(selected.contexts[0]?.fingerprint, "context-review-instance-name");
  assert.equal(selected.uses[0]?.fingerprint, "use-one-instance-name");
  assert.equal(selected.uses.length, 1);
  assert.equal(selected.count, 9, "the full use total is retained when excerpts are omitted");
  assert.match(projected.projection?.selection ?? "", /omitted whole/);
});

test("projection preserves every applicable property meaning for an ambiguous spelling", () => {
  const ambiguous: VocabularyTerm = {
    ...term("unit-basis", "declared"),
    concept: null,
    layer: null,
    definition: null,
    properties: {},
    meaningAlternatives: [
      { concept: "exposure", layer: "project", definition: "The amount subject to loss.", properties: { unit_basis: "percentage" }, confusables: ["allocation"] },
      { concept: "allocation", layer: "project", definition: "The amount assigned to a strategy.", properties: { unit_basis: "percentage" }, confusables: ["exposure"] },
    ],
  };
  const projected = projectLexiconCoverage(coverage([ambiguous]), compact);
  assert.deepEqual(projected.terms[0]?.meaningAlternatives, ambiguous.meaningAlternatives);
  assert.equal(projected.terms[0]?.concept, null);
  assert.equal(projected.terms[0]?.definition, null);
  assert.deepEqual(projected.terms[0]?.properties, {});
});

test("an entry that would cross the exact escaped-byte ceiling is omitted whole", () => {
  const first = term("small");
  const huge = { ...term("huge"), definition: `<${"x".repeat(20_000)}>` };
  const source = coverage([first, huge]);
  const metadataOnly = projectLexiconCoverage(source, { ...compact, bytes: 8 * 1024, terms: 0, populationEntries: 0 });
  const limit = embeddedLexiconBytes(metadataOnly) + embeddedLexiconBytes({
    ...first,
    contextCount: 2,
    unreviewedContextCount: 1,
    contexts: [first.contexts[0]],
    uses: [first.uses[0]],
  });
  const projected = projectLexiconCoverage(source, { ...compact, bytes: limit, populationEntries: 0 });
  assert.deepEqual(projected.terms.map((item) => item.term), ["small"]);
  assert.equal(embeddedLexiconBytes(projected), limit, "the projection may fill the exact escaped-byte ceiling");
});
