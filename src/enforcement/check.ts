/**
 * The chokepoint check: for one chokepoint-form enforcement, resolve the
 * protected thing and the chokepoint, collect every reference to the
 * protected thing, and classify each site.
 *
 *   inside   within the chokepoint symbol's range, or within its module when
 *            the chokepoint is a module; for a protected module, within the
 *            module itself
 *   import   an import or export specifier: brings the name into scope, no use
 *   test     under a test folder or a test file by name; reported, never a bypass
 *   bypass   any other site
 *
 * The grade follows: visibility-choked when the protected thing is not
 * visible outside its module and nothing bypasses (the adapter says whether
 * its language can reach this rung); reference-choked when visible and
 * nothing bypasses; broken when a bypass exists or the chokepoint cannot be
 * resolved; not chokeable when the protected thing cannot be resolved as a
 * symbol or a module. The refutation is automatic: the adapter opens a
 * synthetic reference and the instrument must report it, or the check is
 * vacuous and says so.
 */

import { isTestPath, rangeContains, type Definition, type LanguageAdapter, type ReferenceSite } from "../adapters/adapter.ts";
import type { Bypass, Grade, RefutationState, Verdict } from "./record.ts";

export type SiteClass = "inside" | "import" | "test" | "bypass";

export interface ClassifiedSite extends ReferenceSite {
  class: SiteClass;
}

export interface ChokepointResult {
  /** The values as the spec wrote them. */
  input: ChokepointInput;
  verdict: Verdict;
  grade: Grade;
  refutation: RefutationState;
  /** What the refutation did and saw. */
  refutationAccount: string;
  protectedThing: Definition | undefined;
  chokepoint: Definition | undefined;
  sites: ClassifiedSite[];
  bypasses: Bypass[];
  counts: Record<SiteClass, number>;
  visibility: string | undefined;
  files: string[];
  reason: string;
}

export interface ChokepointInput {
  protects: string;
  chokepoint: string;
  component: string;
  testFolders: readonly string[];
}

export function classifySite(site: ReferenceSite, protectedThing: Definition, chokepoint: Definition, testFolders: readonly string[]): SiteClass {
  if (site.isImport) return "import";
  const position = { line: site.line - 1, character: site.character };
  if (chokepoint.kind === "module" ? site.file === chokepoint.file : site.file === chokepoint.file && rangeContains(chokepoint.range, position)) return "inside";
  if (protectedThing.kind === "module" && site.file === protectedThing.file) return "inside";
  if (isTestPath(site.file, testFolders)) return "test";
  return "bypass";
}

const NOT_CHOKEABLE_NOTE = "the totality oracle form (over + via) is the compromise where structure is unavailable";

export async function checkChokepoint(adapter: LanguageAdapter, input: ChokepointInput): Promise<ChokepointResult> {
  const hint = { component: input.component, testFolders: input.testFolders };
  const empty: Record<SiteClass, number> = { inside: 0, import: 0, test: 0, bypass: 0 };
  const base = { input, sites: [], bypasses: [], counts: empty, visibility: undefined, files: [] as string[], refutation: "missing" as RefutationState, refutationAccount: "not attempted" };

  const protectedResolved = await adapter.resolve(input.protects, hint);
  if (!protectedResolved.ok) {
    const where = protectedResolved.candidates === undefined ? "" : ` (${protectedResolved.candidates.join(", ")})`;
    return {
      ...base,
      verdict: "not run",
      grade: "not chokeable",
      protectedThing: undefined,
      chokepoint: undefined,
      reason: `protected thing ${protectedResolved.reason}${where}; ${NOT_CHOKEABLE_NOTE}`,
    };
  }
  const protectedThing = protectedResolved.definition;
  const chokepointResolved = await adapter.resolve(input.chokepoint, hint);
  if (!chokepointResolved.ok) {
    const where = chokepointResolved.candidates === undefined ? "" : ` (${chokepointResolved.candidates.join(", ")})`;
    return {
      ...base,
      verdict: "fail",
      grade: "broken",
      protectedThing,
      chokepoint: undefined,
      files: [protectedThing.file],
      reason: `chokepoint ${chokepointResolved.reason}${where}; the protected thing stands with no chokepoint`,
    };
  }
  const chokepoint = chokepointResolved.definition;

  const references = await adapter.references(protectedThing);
  const sites: ClassifiedSite[] = references.map((site) => ({ ...site, class: classifySite(site, protectedThing, chokepoint, input.testFolders) }));
  const counts: Record<SiteClass, number> = { inside: 0, import: 0, test: 0, bypass: 0 };
  for (const site of sites) counts[site.class] += 1;
  const bypasses: Bypass[] = sites.filter((s) => s.class === "bypass").map((s) => ({ file: s.file, line: s.line, symbol: s.symbol ?? "module top level" }));
  const files = [...new Set([protectedThing.file, chokepoint.file, ...sites.map((s) => s.file)])].sort();

  const visibility = await adapter.visibility(protectedThing);
  const refutation = await adapter.refute(protectedThing, chokepoint);
  const refutationState: RefutationState = refutation.seen ? "automatic" : "missing";

  if (bypasses.length > 0) {
    return {
      input,
      verdict: "fail",
      grade: "broken",
      refutation: refutationState,
      refutationAccount: refutation.account,
      protectedThing,
      chokepoint,
      sites,
      bypasses,
      counts,
      visibility: visibility.evidence,
      files,
      reason: `${bypasses.length} reference${bypasses.length === 1 ? "" : "s"} to ${protectedThing.name} outside ${chokepoint.name}: ${bypasses.map((b) => `${b.file}:${b.line} in ${b.symbol}`).join(", ")}`,
    };
  }
  const choked: Grade = visibility.enforced && !visibility.visible && adapter.ladder.top === "visibility-choked" ? "visibility-choked" : "reference-choked";
  const rung = choked === "visibility-choked" ? "not visible outside its module and every reference inside the chokepoint" : `visible outside its module (${visibility.evidence}); every reference in the project is inside the chokepoint`;
  const vacuous = refutation.seen ? "" : `; refutation missing: ${refutation.account}`;
  return {
    input,
    verdict: refutation.seen ? "pass" : "not run",
    grade: choked,
    refutation: refutationState,
    refutationAccount: refutation.account,
    protectedThing,
    chokepoint,
    sites,
    bypasses,
    counts,
    visibility: visibility.evidence,
    files,
    reason: `${protectedThing.name} is ${rung}${counts.test > 0 ? `; ${counts.test} test reference${counts.test === 1 ? "" : "s"}` : ""}${vacuous}`,
  };
}
