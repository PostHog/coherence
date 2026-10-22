/**
 * Entrance coverage (c-3760638e): how much of the surface the reading
 * detected the declared entrances cover, so a spec-gap count can be read
 * against it. A project that declares 14 coarse entrances and one that
 * declares 94 fine ones over the same code have gap counts that cannot be
 * compared; their coverage can.
 *
 * A detected entrance is covered when a declared entrance
 *   names it     the handler is its symbol, in its file (a symbol registered
 *                in a route table or a URL pattern is matched by name, since
 *                it is declared elsewhere); a file-grain one (a script, a
 *                package bin) is named by any handler in that file
 *   or, when the handler names no detected entrance, stands for it:
 *     through    its own statement calls the handler (every server function
 *                wrapped in mutationRpc, for "server function mutations",
 *                handled by mutationRpc)
 *     module     it is detected in the handler's own file (a registry: a
 *                urls.py whose urlpatterns is the handler)
 * It is covered individually when some entrance covering it covers nothing
 * else, and by a grouped entrance otherwise. Pure, and browser-safe: the view,
 * the query and orient read the same derivation.
 */

import type { EntranceCandidate } from "../../adapters/entrance-candidates.ts";
import { derived, type CandidateRule } from "./language-data.ts";
import type { SpecComponent } from "./model.ts";

/**
 * The rules, per language, each with its plural and what it detects: the
 * documentation the query prints and the spec states, and the one place a
 * rule's plural is said. Each language plugin's manifest declares its own
 * (its `entrances`); a language whose plugin lists none detects nothing, and
 * NOT_DETECTED says so.
 */
export const CANDIDATE_RULES: Readonly<Record<string, readonly CandidateRule[]>> = derived((data) => Object.fromEntries(Object.entries(data).map(([language, said]) => [language, said.rules])));

/** What the rules do not see, per language: said wherever the coverage is, so an absence is never read as none. */
export const NOT_DETECTED: Readonly<Record<string, string>> = derived((data) => Object.fromEntries(Object.entries(data).flatMap(([language, said]) => (said.notDetected === undefined ? [] : [[language, said.notDetected]]))));

/** A recorded reading's language, by name: its rules, or none for a name no language goes by. */
export function candidateRulesOf(language: string): readonly { rule: string; plural: string; detects: string }[] {
  const rules: Partial<Record<string, readonly { rule: string; plural: string; detects: string }[]>> = CANDIDATE_RULES;
  return rules[language] ?? [];
}

/** A recorded reading's language, by name: what its rules do not see, or nothing for a name no language goes by. */
export function notDetectedOf(language: string): string | undefined {
  const said: Partial<Record<string, string>> = NOT_DETECTED;
  return said[language];
}

export interface CoverageGroup {
  /** The folder of the component whose spec declares it. */
  component: string;
  name: string;
  handler: string;
  /** How many detected entrances it stands for. */
  covers: number;
  /** The rules of the detected entrances it stands for, most frequent first, for "stands for 36 server functions". */
  rules: string[];
}

export interface EntranceCoverage {
  /** Every detected entrance. */
  detected: number;
  /** Every declared entrance. */
  declared: number;
  /** Detected entrances some declared entrance covers alone. */
  individually: number;
  /** Detected entrances covered only by an entrance that stands for more than one. */
  grouped: number;
  /** The entrances that stand for more than one detected entrance, largest first. */
  groups: CoverageGroup[];
  /** Detected entrances no declared entrance covers, in file order. */
  uncovered: EntranceCandidate[];
  /** Declared entrances that cover no detected entrance: declared where the rules do not reach, or declared at a finer grain than they detect. */
  beyond: number;
}

const COVERAGE_NAMED = /^([A-Za-z_$][\w$]*)(?:\s+in\s+(\S+))?$/;

/** Whether a file the spec model resolved is the candidate's file; the spec model gives project-relative paths. */
function coverageSameFile(a: string | undefined, b: string): boolean {
  return a !== undefined && (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`));
}

/** The coverage of `candidates` by every entrance the spec declares. Undefined when nothing was detected by an older reading (no candidates recorded). */
export function coverageOf(components: readonly Pick<SpecComponent, "folder" | "entrances">[], candidates: readonly EntranceCandidate[] | undefined): EntranceCoverage | undefined {
  if (candidates === undefined) return undefined;
  const symbols = new Set(candidates.map((c) => c.symbol).filter((s) => s !== ""));
  const coveredBy = new Map<EntranceCandidate, number[]>();
  const groups: CoverageGroup[] = [];
  const sizes: number[] = [];
  let beyond = 0;
  let declared = 0;
  for (const component of components) {
    for (const e of component.entrances) {
      declared += 1;
      const handler = e.handler?.trim() ?? "";
      const named = COVERAGE_NAMED.exec(handler);
      const symbol = named?.[1];
      const file = e.file;
      let set = candidates.filter((c) => (c.symbol === "" ? coverageSameFile(file, c.file) : symbol !== undefined && symbol === c.symbol && (c.registered === true || file === undefined || coverageSameFile(file, c.file))));
      if (set.length === 0) {
        // The handler names no detected entrance: it may be what they are registered through.
        const wrapper = symbol !== undefined && !symbols.has(symbol) ? symbol : undefined;
        set = candidates.filter((c) => (wrapper !== undefined && c.through?.includes(wrapper) === true) || (file !== undefined && c.symbol !== "" && coverageSameFile(file, c.file) && (symbol === undefined || !symbols.has(symbol))));
      }
      if (set.length === 0) {
        beyond += 1;
        continue;
      }
      const index = sizes.length;
      sizes.push(set.length);
      for (const c of set) coveredBy.set(c, [...(coveredBy.get(c) ?? []), index]);
      if (set.length > 1) {
        const tally = new Map<string, number>();
        for (const c of set) tally.set(c.rule, (tally.get(c.rule) ?? 0) + 1);
        groups.push({ component: component.folder, name: e.name, handler, covers: set.length, rules: [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([rule]) => rule) });
      }
    }
  }
  let individually = 0;
  let grouped = 0;
  const uncovered: EntranceCandidate[] = [];
  for (const c of candidates) {
    const by = coveredBy.get(c);
    if (by === undefined) uncovered.push(c);
    else if (by.some((i) => sizes[i] === 1)) individually += 1;
    else grouped += 1;
  }
  groups.sort((a, b) => b.covers - a.covers || a.name.localeCompare(b.name));
  return { detected: candidates.length, declared, individually, grouped, groups, uncovered, beyond };
}

function coveragePlural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The one-line summary the health strip, the query and orient share: "entrances: 94 declared, covering 118 of 124 detected; 6 undeclared". */
export function coverageLine(coverage: EntranceCoverage): string {
  const covered = coverage.individually + coverage.grouped;
  const grouping = coverage.groups.length === 0 ? "" : ` (${coverage.individually} individually, ${coverage.grouped} through ${coveragePlural(coverage.groups.length, "grouped entrance")})`;
  return `entrances: ${coverage.declared} declared, covering ${covered} of ${coveragePlural(coverage.detected, "detected entrance")}${grouping}; ${coverage.uncovered.length} undeclared`;
}

/** Each rule's plural, read off the rules themselves, so a rule added there is never counted as "<rule>s" (df-5c6288f3). */
export const RULE_PLURALS: Readonly<Record<string, string>> = derived((data) => Object.fromEntries(Object.values(data).flatMap((said) => said.rules.map((r) => [r.rule, r.plural]))));

/** A count of entrances detected by one rule, in words: "1 request proxy", "3 request proxies". */
export function ruleCount(n: number, rule: string): string {
  return `${n} ${n === 1 ? rule : (RULE_PLURALS[rule] ?? "detected entrances")}`;
}

/** One grouped entrance in words: `"server function mutations" (mutationRpc) stands for 36 server functions`. */
export function groupLine(group: CoverageGroup): string {
  const rule = group.rules.length === 1 ? ` ${RULE_PLURALS[group.rules[0]!] ?? "detected entrances"}` : " detected entrances";
  return `"${group.name}" (${group.handler}) stands for ${group.covers}${rule}`;
}
