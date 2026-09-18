/**
 * The chokepoint check: for one chokepoint-form enforcement, resolve the
 * protected thing and the chokepoint, collect every reference to the
 * protected thing, and classify each site.
 *
 *   inside   within the chokepoint symbol's range, or within its module when
 *            the chokepoint is a module; for a protected module, within the
 *            module itself
 *   test     under a test folder or a test file by name; reported, never a bypass
 *   bypass   any other site, an import or re-export specifier included: an
 *            import of the protected thing outside the chokepoint reaches it,
 *            and a re-export widens its reach with no call at all
 *
 * The grade follows: visibility-choked when the protected thing is not
 * visible outside its module and nothing bypasses (the adapter says whether
 * its language can reach this rung); reference-choked when visible and
 * nothing bypasses; broken when a bypass exists or the chokepoint cannot be
 * resolved; not chokeable when the protected thing cannot be resolved as a
 * symbol or a module.
 *
 * The refutation is automatic, and it must prove that this check would fire:
 * the adapter opens a synthetic reference and reports the site the instrument
 * named, and the site is then classified by the same function every other
 * site goes through. Only a synthetic site classified `bypass` refutes. A
 * synthetic site the check would call `inside` (the chokepoint covers
 * everywhere the language lets the thing be named) or `test` (the protected
 * thing lives under a test folder, so nothing can ever be a bypass) proves
 * only that the instrument answers, and the check says so and records not run.
 */

import { isTestPath, rangeContains, type Definition, type LanguageAdapter, type ReferenceSite, type Rung, type Visibility } from "../adapters/adapter.ts";
import type { Bypass, Grade, RefutationState, Verdict } from "./record.ts";

export type SiteClass = "inside" | "test" | "bypass";

export interface ClassifiedSite extends ReferenceSite {
  class: SiteClass;
}

export interface ChokepointResult {
  /** The values as the spec wrote them. */
  input: ChokepointInput;
  verdict: Verdict;
  grade: Grade;
  /** Who refuses a bypass at the graded rung, for a choked grade. */
  enforcer?: string;
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
  const position = { line: site.line - 1, character: site.character };
  // A re-export widens the thing's reach with no call at all, so it is a bypass wherever it stands.
  if (site.form === "re-export") return "bypass";
  // A plain import specifier is how the chokepoint's own module reaches the thing, not a place the thing is used.
  const inChokepointModule = chokepoint.kind === "module" ? withinModule(site.file, chokepoint.file) : site.file === chokepoint.file;
  if (site.form === "import" && inChokepointModule) return "inside";
  if (chokepoint.kind === "module" ? inChokepointModule : site.file === chokepoint.file && rangeContains(chokepoint.range, position)) return "inside";
  if (protectedThing.kind === "module" && withinModule(site.file, protectedThing.file)) return "inside";
  if (isTestPath(site.file, testFolders)) return "test";
  return "bypass";
}

/** Whether a file is the module, or, when the module is a package's __init__, one of the package's own files. */
function withinModule(file: string, moduleFile: string): boolean {
  if (file === moduleFile) return true;
  const init = /^(.*)\/__init__\.py$/.exec(moduleFile);
  return init !== null && file.startsWith(init[1] + "/");
}

const NOT_CHOKEABLE_NOTE = "the totality oracle form (over + via) is the compromise where structure is unavailable";

/** The rungs whose enforcer is the language itself, where a refusal is the refutation (ruling rs-e93ecdd6). */
const LANGUAGE_ENFORCED = new Set<Grade>(["visibility-choked", "closure-choked"]);

function nameOf(site: SiteClass | undefined): string {
  return site === undefined ? "as unreported" : site === "test" ? "a test reference" : "a reference inside the chokepoint";
}

export async function checkChokepoint(adapter: LanguageAdapter, input: ChokepointInput): Promise<ChokepointResult> {
  const hint = { component: input.component, testFolders: input.testFolders };
  const empty: Record<SiteClass, number> = { inside: 0, test: 0, bypass: 0 };
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
  const counts: Record<SiteClass, number> = { inside: 0, test: 0, bypass: 0 };
  for (const site of sites) counts[site.class] += 1;
  const bypasses: Bypass[] = sites.filter((s) => s.class === "bypass").map((s) => ({ file: s.file, line: s.line, symbol: s.symbol ?? "module top level" }));
  const files = [...new Set([protectedThing.file, chokepoint.file, ...sites.map((s) => s.file)])].sort();

  const visibility = await adapter.visibility(protectedThing, chokepoint);
  const earned = rungFor(adapter, visibility);
  const refutation = await adapter.refute(protectedThing, chokepoint);
  const classified = refutation.staged.map((staged) => ({
    what: staged.what,
    class: staged.site === undefined ? undefined : classifySite(staged.site, protectedThing, chokepoint, input.testFolders),
  }));
  // The rung whose enforcer is the language refutes itself: a synthetic reference the compiler or the interpreter
  // refuses is the proof, and Coherence's own check never has to be made to fire (ruling rs-e93ecdd6).
  const languageRefused = refutation.refused !== undefined && LANGUAGE_ENFORCED.has(earned.grade);
  // Otherwise every staged site must be one this check's own classification calls a bypass (ruling d-7abd1ba8).
  const short = classified.filter((site) => site.class !== "bypass");
  const fired = classified.length > 0 && refutation.seen && short.length === 0;
  const refutationState: RefutationState = languageRefused ? "refused by the language" : fired ? "automatic" : "missing";
  const refutationAccount = languageRefused
    ? `${refutation.account}; the ${earned.grade} rung is enforced by ${earned.enforcer}, and its refusal is the refutation`
    : !refutation.seen || classified.length === 0
      ? refutation.account
      : fired
        ? `${refutation.account}, and the check classified each one a bypass`
        : `${refutation.account}, but the check classified ${short.map((s) => `${s.what} ${nameOf(s.class)}`).join(" and ")}, not a bypass; the refutation is vacuous`;

  if (bypasses.length > 0) {
    return {
      input,
      verdict: "fail",
      grade: "broken",
      refutation: refutationState,
      refutationAccount,
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
  // When the instrument could not see the synthetic site, Coherence's own check enforces nothing: a ladder may name the rung that is left.
  // A site the instrument saw but the check would not call a bypass leaves the earned rung's fact standing; only the verdict drops.
  const vacuousRung = !languageRefused && !refutation.seen && adapter.ladder.whenVacuous !== undefined ? rungsOf(adapter).find((r) => r.grade === adapter.ladder.whenVacuous) : undefined;
  const graded: Rung = vacuousRung === undefined ? earned : { ...vacuousRung, fact: `the instrument could not see the synthetic reference, so Coherence's check enforces nothing here and only the convention stands (${visibility.evidence})` };
  const tests = counts.test > 0 ? `; ${counts.test} test reference${counts.test === 1 ? "" : "s"}` : "";
  const proved = languageRefused || fired;
  const vacuous = proved ? "" : `; refutation missing: ${refutationAccount}`;
  return {
    input,
    verdict: proved ? "pass" : "not run",
    grade: graded.grade,
    enforcer: graded.enforcer,
    refutation: refutationState,
    refutationAccount,
    protectedThing,
    chokepoint,
    sites,
    bypasses,
    counts,
    visibility: visibility.evidence,
    files,
    reason: `${protectedThing.name} is ${graded.grade}, enforced by ${graded.enforcer}: ${graded.fact}${tests}${vacuous}`,
  };
}

/** The ladder's rungs; a warm server started before ladders carried rungs answers with none, and the check must not crash on it. */
function rungsOf(adapter: LanguageAdapter): readonly Rung[] {
  return adapter.ladder.rungs ?? [];
}

/** The rung a clean chokepoint earns: the adapter's own verdict when its visibility carries one, else the two-rung rule over exportedness. */
function rungFor(adapter: LanguageAdapter, visibility: Visibility): Rung {
  if (visibility.rung !== undefined) return visibility.rung;
  const listed = (grade: Grade): Rung | undefined => rungsOf(adapter).find((r) => r.grade === grade);
  if (visibility.enforced && !visibility.visible && adapter.ladder.top === "visibility-choked") {
    return { grade: "visibility-choked", enforcer: listed("visibility-choked")?.enforcer ?? "the compiler", fact: `not visible outside its module (${visibility.evidence}) and every reference inside the chokepoint` };
  }
  return { grade: "reference-choked", enforcer: listed("reference-choked")?.enforcer ?? "Coherence's check at the edit and in CI", fact: `visible outside its module (${visibility.evidence}); every reference in the project is inside the chokepoint` };
}
