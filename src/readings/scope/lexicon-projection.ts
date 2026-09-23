/** Node-only evidence projection. Definitions stay whole; oversized entries are omitted, not rewritten. */
import { attention, awaitsReview, type Coverage, type VocabularyTerm } from "../../lifecycle/lexicon-coverage.ts";
import type { LexiconCoverage, LexiconEvidenceTerm } from "./model.ts";

export const LEXICON_PAGE_LIMITS = {
  bytes: 256 * 1024,
  terms: 120,
  contextsPerTerm: 6,
  usesPerTerm: 8,
  populationEntries: 30,
  /** Entries of each attention list the page leads with; the rest are one command away. */
  attentionEntries: 12,
} as const;

export interface LexiconProjectionLimits {
  bytes: number;
  terms: number;
  contextsPerTerm: number;
  usesPerTerm: number;
  populationEntries: number;
  attentionEntries?: number;
}

/**
 * Where a term stands in the page's selection: the recurring terms that lack
 * a definition first, in the attention order (most recurring first), then
 * terms with a context whose sense is at risk and unreviewed, then rejected
 * spellings, then every other unresolved term, then the rest.
 */
function reviewPriority(term: VocabularyTerm, ranked: ReadonlyMap<string, number>): number {
  const rank = ranked.get(term.term);
  if (rank !== undefined) return rank;
  const after = ranked.size;
  if (term.contexts.some(awaitsReview)) return after;
  if (term.state === "rejected") return after + 1;
  if (term.state === "unresolved") return after + 2;
  return after + 3;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function termEvidence(term: VocabularyTerm, limits: LexiconProjectionLimits): LexiconEvidenceTerm {
  const contexts = [...term.contexts]
    .sort((a, b) => Number(awaitsReview(b)) - Number(awaitsReview(a)))
    .slice(0, limits.contextsPerTerm);
  // Show at least one use of each sampled component, then fill the remaining excerpt slots.
  const uses = contexts.flatMap((c) => {
    const first = term.uses.find((u) => u.component === c.component);
    return first === undefined ? [] : [first];
  });
  for (const use of term.uses) {
    if (uses.length >= limits.usesPerTerm) break;
    if (!uses.includes(use)) uses.push(use);
  }
  return {
    ...term,
    contextCount: term.contexts.length,
    unreviewedContextCount: term.contexts.filter(awaitsReview).length,
    contexts,
    uses,
  };
}

/** Exact UTF-8 bytes used by the builder's escaped application/json payload. */
export function embeddedLexiconBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value).replace(/</g, "\\u003c"), "utf8");
}

export function projectLexiconCoverage(
  report: Coverage,
  limits: LexiconProjectionLimits = LEXICON_PAGE_LIMITS,
): LexiconCoverage {
  const signal = attention(report);
  const head = limits.attentionEntries ?? LEXICON_PAGE_LIMITS.attentionEntries;
  const projected: LexiconCoverage = {
    ...report,
    totals: { ...report.totals },
    attention: {
      undefinedTerms: signal.undefinedTerms.slice(0, head),
      senses: signal.senses.slice(0, head),
      more: { undefinedTerms: signal.undefinedTerms.length > head, senses: signal.senses.length > head },
    },
    population: {
      ...report.population,
      files: [],
      excluded: [],
      unreadable: [],
      limits: [...report.population.limits],
    },
    terms: [],
    projection: {
      byteLimit: limits.bytes,
      selection: "Recurring terms that lack a definition, most recurring first; then terms with a context whose sense is at risk and unreviewed; then rejected spellings, other unresolved terms, and the rest; ties by use count and code-point name order. Contexts awaiting review come first. Oversized entries are omitted whole.",
      contexts: report.terms.reduce((n, t) => n + t.contexts.length, 0),
      population: {
        files: report.population.files.length,
        excluded: report.population.excluded.length,
        unreadable: report.population.unreadable.length,
      },
    },
  };
  let bytes = embeddedLexiconBytes(projected);
  if (bytes > limits.bytes) throw new Error("Scope: lexicon reading metadata exceeds the page evidence budget");
  function append<T>(into: T[], entry: T, limit: number): boolean {
    if (into.length >= limit) return false;
    const extra = embeddedLexiconBytes(entry) + (into.length === 0 ? 0 : 1);
    if (bytes + extra > limits.bytes) return false;
    into.push(entry);
    bytes += extra;
    return true;
  }
  let populationEntries = 0;
  const populationKinds = ["files", "excluded", "unreadable"] as const;
  const populationLength = Math.max(...populationKinds.map((kind) => report.population[kind].length));
  // Round-robin prevents a long file list from hiding every exclusion or unreadable record.
  for (let index = 0; index < populationLength && populationEntries < limits.populationEntries; index += 1) {
    for (const kind of populationKinds) {
      if (populationEntries >= limits.populationEntries) break;
      const entry = report.population[kind][index];
      if (entry !== undefined && append(projected.population[kind], entry, limits.populationEntries)) populationEntries += 1;
    }
  }
  const ranked = new Map(signal.undefinedTerms.map((t, i) => [t.term, i]));
  const ordered = [...report.terms].sort((a, b) =>
    reviewPriority(a, ranked) - reviewPriority(b, ranked) || b.count - a.count || compareText(a.term, b.term));
  for (const term of ordered) {
    if (projected.terms.length >= limits.terms) break;
    append(projected.terms, termEvidence(term, limits), limits.terms);
  }
  const actual = embeddedLexiconBytes(projected);
  if (actual !== bytes) throw new Error(`Scope: lexicon projection byte accounting drifted (${bytes} counted, ${actual} embedded)`);
  if (actual > limits.bytes) throw new Error(`Scope: lexicon projection is ${actual} bytes, over its ${limits.bytes}-byte budget`);
  return projected;
}
