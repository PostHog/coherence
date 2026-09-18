/** Node-only evidence projection. Definitions stay whole; oversized entries are omitted, not rewritten. */
import type { Coverage, VocabularyTerm } from "../../lifecycle/glossary-coverage.ts";
import type { GlossaryCoverage, GlossaryEvidenceTerm } from "./model.ts";

export const GLOSSARY_PAGE_LIMITS = {
  bytes: 256 * 1024,
  terms: 120,
  contextsPerTerm: 6,
  usesPerTerm: 8,
  populationEntries: 30,
} as const;

export interface GlossaryProjectionLimits {
  bytes: number;
  terms: number;
  contextsPerTerm: number;
  usesPerTerm: number;
  populationEntries: number;
}

function needsReview(disposition: string): boolean {
  return disposition !== "confirmed" && disposition !== "not-domain";
}

function reviewPriority(term: VocabularyTerm): number {
  if (term.state === "rejected") return 0;
  if (term.contexts.some((c) => needsReview(c.disposition))) return 1;
  if (term.state === "unresolved") return 2;
  return 3;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function termEvidence(term: VocabularyTerm, limits: GlossaryProjectionLimits): GlossaryEvidenceTerm {
  const contexts = [...term.contexts]
    .sort((a, b) => Number(needsReview(b.disposition)) - Number(needsReview(a.disposition)))
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
    unreviewedContextCount: term.contexts.filter((c) => needsReview(c.disposition)).length,
    contexts,
    uses,
  };
}

/** Exact UTF-8 bytes used by the builder's escaped application/json payload. */
export function embeddedGlossaryBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value).replace(/</g, "\\u003c"), "utf8");
}

export function projectGlossaryCoverage(
  report: Coverage,
  limits: GlossaryProjectionLimits = GLOSSARY_PAGE_LIMITS,
): GlossaryCoverage {
  const projected: GlossaryCoverage = {
    ...report,
    totals: { ...report.totals },
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
      selection: "Rejected spellings, then terms with contexts awaiting sense review, unresolved terms, and reviewed terms; ties by use count and code-point name order. Awaiting-review contexts come first. Oversized entries are omitted whole.",
      contexts: report.terms.reduce((n, t) => n + t.contexts.length, 0),
      population: {
        files: report.population.files.length,
        excluded: report.population.excluded.length,
        unreadable: report.population.unreadable.length,
      },
    },
  };
  let bytes = embeddedGlossaryBytes(projected);
  if (bytes > limits.bytes) throw new Error("Scope: glossary reading metadata exceeds the page evidence budget");
  function append<T>(into: T[], entry: T, limit: number): boolean {
    if (into.length >= limit) return false;
    const extra = embeddedGlossaryBytes(entry) + (into.length === 0 ? 0 : 1);
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
  const ordered = [...report.terms].sort((a, b) =>
    reviewPriority(a) - reviewPriority(b) || b.count - a.count || compareText(a.term, b.term));
  for (const term of ordered) {
    if (projected.terms.length >= limits.terms) break;
    append(projected.terms, termEvidence(term, limits), limits.terms);
  }
  const actual = embeddedGlossaryBytes(projected);
  if (actual !== bytes) throw new Error(`Scope: glossary projection byte accounting drifted (${bytes} counted, ${actual} embedded)`);
  if (actual > limits.bytes) throw new Error(`Scope: glossary projection is ${actual} bytes, over its ${limits.bytes}-byte budget`);
  return projected;
}
