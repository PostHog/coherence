/**
 * Undeclared entrances at hook time: the detected entrances no declared
 * entrance covers (entrance-coverage.ts, c-3760638e), as orient counts them
 * and regulate names the first-ranked one a session touched, and what
 * `scaffold entrances` proposes for them. Undeclared is the normal state of
 * a detected entrance, never a spec gap: only a declared entrance can be one.
 *
 * Detection is a plain scan of the tree that asks the language server
 * nothing, so unlike the spec gaps it needs no recorded Structure reading:
 * orient and regulate detect now, against the spec as it stands, and a
 * session that just declared an entrance sees it counted at once.
 *
 * No adoption baseline (the gap baseline's convention is not reused): the
 * line is one bounded line whatever the count, naming a folder rather than a
 * list, so there is nothing to silence; and in the replicated A/B adoption
 * test coverage stayed at 11 to 14 percent in both arms, so a baseline taken
 * on day one would hide exactly the surface that was never declared.
 *
 * Node-only; the browser bundle never imports it.
 */

import { posix } from "node:path";
import type { EntranceCandidate } from "../../adapters/entrance-candidates.ts";
import { scannedLanguagesRead, type LanguagesRead } from "./languages-read.ts";
import { readEnforcementConfig } from "../../enforcement/config.ts";
import { loadSpecModel, type SpecModel } from "../../spec/model.ts";
import { detectedEntrances } from "./component-interfaces.ts";
import { coverageOf, ruleCount } from "./entrance-coverage.ts";
import { FIRST_RANKED, familiesOf, rankEntrances, rankWords, skippedBy, type RankedEntrance, type SkippedGroup } from "./entrance-rank.ts";

/** The declared entrances against what the rules detect now, and the detected entrances none covers. */
export interface Undeclared {
  declared: number;
  detected: number;
  covered: number;
  /** In file order. */
  undeclared: EntranceCandidate[];
  /** Every detected entrance, declared or not, in file order: what the families declared with one bullet are read from. */
  all?: EntranceCandidate[];
  /** The undeclared entrances that skip the handler of a family declared with one bullet, with the largest such family; absent when none does. */
  skipping?: { count: number; family: SkippedGroup };
  /** Which of the project's languages detection read, each by its own rules, and each with no rules yet named as not read. */
  languages: LanguagesRead;
}

/** Detect now and measure against a spec model: undefined when nothing is detected. Throws what detection throws. */
export function undeclaredOf(root: string, model: Pick<SpecModel, "components">): Undeclared | undefined {
  const config = readEnforcementConfig(root);
  const languages = scannedLanguagesRead(config);
  const candidates = detectedEntrances(root, model, languages.read, config.testFolders);
  const coverage = coverageOf(model.components, candidates);
  if (coverage === undefined || coverage.detected === 0) return undefined;
  const families = familiesOf(model, candidates);
  const skipped = coverage.uncovered.flatMap((c) => skippedBy(c, families) ?? []);
  const skipping = skipped.length === 0 ? undefined : { count: skipped.length, family: skipped.sort((a, b) => b.members - a.members)[0]! };
  return { declared: coverage.declared, detected: coverage.detected, covered: coverage.individually + coverage.grouped, undeclared: coverage.uncovered, all: candidates, ...(skipping === undefined ? {} : { skipping }), languages };
}

/**
 * Detect now and measure against the current spec, for a hook. Undefined when
 * the spec is unreadable or declares no component yet (setup has not reached
 * specs), or when nothing is detected.
 */
export function undeclaredNow(root: string): Undeclared | undefined {
  try {
    const model = loadSpecModel(root, { runs: false });
    return model.components.length === 0 ? undefined : undeclaredOf(root, model);
  } catch {
    return undefined;
  }
}

/** The folder a detected entrance sits in, "." for the root. */
export function folderOf(candidate: Pick<EntranceCandidate, "file">): string {
  const dir = posix.dirname(candidate.file);
  return dir === "" ? "." : dir;
}

/** "86 server functions", "28 package scripts, 3 scripts": the rules of some detected entrances, most frequent first, two named at most. */
export function rulesText(candidates: readonly Pick<EntranceCandidate, "rule">[]): string {
  const tally = new Map<string, number>();
  for (const c of candidates) tally.set(c.rule, (tally.get(c.rule) ?? 0) + 1);
  const ranked = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const named = ranked.slice(0, 2).map(([rule, n]) => ruleCount(n, rule));
  const rest = ranked.slice(2).reduce((sum, [, n]) => sum + n, 0);
  return named.join(", ") + (rest > 0 ? ` and ${rest} more` : "");
}

/** The folder holding the most undeclared entrances, ties broken by name. */
export function busiestFolder(undeclared: readonly EntranceCandidate[]): { folder: string; candidates: EntranceCandidate[] } | undefined {
  const byFolder = new Map<string, EntranceCandidate[]>();
  for (const c of undeclared) byFolder.set(folderOf(c), [...(byFolder.get(folderOf(c)) ?? []), c]);
  const [folder, candidates] = [...byFolder].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0] ?? [];
  return folder === undefined ? undefined : { folder, candidates: candidates! };
}

/** The most characters a folder takes in orient's one line. */
const FOLDER_CHARS = 60;

function shortPath(path: string): string {
  return path.length <= FOLDER_CHARS ? path : `…${path.slice(path.length - FOLDER_CHARS + 1)}`;
}

function quotedPath(path: string): string {
  return /[\s$*?[\]'"`()]/.test(path) ? `'${path.replace(/'/g, "'\\''")}'` : path;
}

/**
 * Orient's coverage line: how many detected entrances the declared ones
 * cover, how many are undeclared (the normal state of a detected entrance,
 * never a spec gap, but kept in view at every start, d-a1095ef2), the folder
 * holding the most with their rules, how many skip the handler a family
 * declared with one bullet goes through, and the command that ranks them
 * and proposes the first bullets. Nothing when every detected entrance is
 * covered. Bounded: one line, one folder, one family, never a list.
 */
export function orientUndeclaredText(state: Omit<Undeclared, "languages"> | undefined, cli: string): string {
  if (state === undefined || state.undeclared.length === 0) return "";
  const busiest = busiestFolder(state.undeclared)!;
  const n = state.undeclared.length;
  const scope = busiest.candidates.length === n ? "all" : "most";
  return `Entrance coverage: ${state.declared} declared ${state.declared === 1 ? "entrance covers" : "entrances cover"} ${state.covered} of ${state.detected} detected; ${n} undeclared, the normal state of a detected entrance, never a gap; ${scope} in ${shortPath(busiest.folder)} (${rulesText(busiest.candidates)})${skipText(state.skipping)}. ${cli} scaffold entrances ranks them and proposes ${n > FIRST_RANKED ? `bullets for the first ${FIRST_RANKED}` : n === 1 ? "its bullet" : "their bullets"}; declare those that matter.`;
}

/** The clause naming how many undeclared entrances skip a family's handler, or nothing. */
function skipText(skipping: Undeclared["skipping"]): string {
  if (skipping === undefined) return "";
  const f = skipping.family;
  return `; ${skipping.count} ${skipping.count === 1 ? "skips" : "skip"} ${f.handler}, which ${f.members} under ${shortPath(f.folder)} go through, and rank first`;
}

/**
 * Regulate's line: the one undeclared entrance in the files this session
 * changed that ranks first (entrance-rank.ts), with what ranks it, how many
 * more those files hold, and the command that proposes its bullet. One
 * nudge, never a list: undeclared is the normal state of a detected
 * entrance, and the session that wrote one is the one that knows whether it
 * matters (d-a1095ef2: what the loop never names stays open). Advisory: an
 * undeclared entrance is never owed, so the caller never counts it toward a
 * refusal. Empty when the session changed no file holding one.
 */
export function regulateUndeclaredText(changed: readonly string[], state: Omit<Undeclared, "languages"> | undefined, cli: string, rank: (candidates: readonly EntranceCandidate[], detected: readonly EntranceCandidate[]) => readonly RankedEntrance[]): string {
  if (state === undefined) return "";
  const files = new Set(changed);
  const touched = state.undeclared.filter((c) => files.has(c.file));
  if (touched.length === 0) return "";
  const top = rank(touched, state.all ?? state.undeclared)[0];
  if (top === undefined) return "";
  const c = top.candidate;
  const what = c.symbol === "" ? `${c.file}:${c.line}` : `${c.symbol} (${c.file}:${c.line})`;
  const others = touched.length - 1;
  const among = others === 0 ? "the one undeclared entrance in the files this session changed" : `first of the ${touched.length} undeclared entrances in the files this session changed`;
  return [
    "Undeclared entrance this session touched; advisory, never a reason to refuse the stop:",
    `  ${what}, a ${c.rule}, ranks ${among}: ${rankWords(top)}. If it matters, declare it: ${cli} scaffold entrances ${quotedPath(c.file)} proposes its bullet${others === 0 ? "" : ", and the rest can stay undeclared"}.`,
  ].join("\n");
}

/** Rank detected entrances now, against the current spec, for a hook; none when the spec is unreadable. */
export function rankNow(root: string, candidates: readonly EntranceCandidate[], detected: readonly EntranceCandidate[] = candidates): RankedEntrance[] {
  try {
    return rankEntrances(root, loadSpecModel(root, { runs: false }), candidates, readEnforcementConfig(root).languages, detected);
  } catch {
    return [];
  }
}
