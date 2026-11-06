/**
 * What the project carries into a session that it did not see happen: the
 * decisions recorded lately, the conjectures nobody has settled, and the work
 * orders no one in this session holds. The journal is where sessions leave
 * what they settled; this is how the next session hears of it.
 *
 * At a start, a short block: the last week's decisions, newest first, the
 * open conjectures and the orders this session does not hold, each a line
 * with its id, capped, so the block never crowds out what the start must say
 * whole. Before an edit, the decisions about the component the edit lands in, each
 * with its because, said once per session: a decision names its components
 * (Decision.about), so a session that never ran the journal command is still
 * told what was settled where it is about to work.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Conjecture, Decision, JournalRecord } from "../journal/record.ts";
import { isTerminal, type WorkOrder } from "../journal/work.ts";

/** How far back a start looks for decisions. */
export const RECENT_DAYS = 7;
/** The most lines each component of the start block gives. */
export const CARRIED_DECISIONS = 5;
export const CARRIED_CONJECTURES = 3;
export const CARRIED_ORDERS = 3;
/** The most placed decisions a session's start keeps for its edits, the newest: older ones stay a journal command away. */
export const PLACED_KEPT = 200;
/** The most decisions told about one component in one session, before the rest are counted. */
export const NEAR_PER_COMPONENT = 3;
/** A line's most characters before it is cut. */
const LINE = 115;

const DAY = 24 * 60 * 60 * 1000;

const cut = (text: string, max = LINE): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
};

/** The records some later record withdrew, answered or settled: a retraction's, a resolution's, a dismissal's target. */
function settled(records: readonly JournalRecord[]): Set<string> {
  return new Set(records.flatMap((r) => (r.kind === "retraction" || r.kind === "resolution" || r.kind === "dismissal" ? [r.of] : [])));
}

/** Decisions that still stand, newest first: neither retracted nor a defect's classification, which is bookkeeping of its own. */
export function standingDecisions(records: readonly JournalRecord[]): Decision[] {
  const gone = settled(records);
  return records
    .filter((r): r is Decision => r.kind === "decision" && !gone.has(r.id) && r.classifies === undefined)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Conjectures nobody has resolved, dismissed or retracted, newest first. */
export function openConjectures(records: readonly JournalRecord[]): Conjecture[] {
  const gone = settled(records);
  return records.filter((r): r is Conjecture => r.kind === "conjecture" && !gone.has(r.id)).sort((a, b) => (a.at < b.at ? 1 : -1));
}

/**
 * The start's block: the last RECENT_DAYS days' decisions, the open conjectures, and the work orders still open or
 * under way that this session does not hold. Empty when there is none of any.
 */
export function carryBlock(records: readonly JournalRecord[], orders: readonly WorkOrder[], session: string | undefined, cli: string, now = new Date()): string {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY).toISOString();
  const decisions = standingDecisions(records).filter((d) => d.at >= since);
  const conjectures = openConjectures(records);
  const held = orders.filter((o) => !isTerminal(o.state) && o.owner !== session).sort((a, b) => (a.at < b.at ? 1 : -1));
  const lines: string[] = [];
  const more = (n: number, shown: number): string => (n > shown ? `, the newest ${shown}` : "");
  if (decisions.length > 0) {
    lines.push(`Decided in the last ${RECENT_DAYS} days (${decisions.length}${more(decisions.length, CARRIED_DECISIONS)}; one whole, with why: ${cli} journal <id>):`);
    for (const d of decisions.slice(0, CARRIED_DECISIONS)) lines.push(`  ${d.id} ${d.at.slice(0, 10)} ${cut(d.chose)}`);
  }
  if (conjectures.length > 0) {
    lines.push(`Open conjectures (${conjectures.length}${more(conjectures.length, CARRIED_CONJECTURES)}; settle one with: ${cli} resolved <id> --because "<what the test showed>"):`);
    for (const c of conjectures.slice(0, CARRIED_CONJECTURES)) lines.push(`  ${c.id} ${c.at.slice(0, 10)} ${cut(c.observation)}`);
  }
  if (held.length > 0) {
    lines.push(`Work orders this session does not hold (${held.length}${more(held.length, CARRIED_ORDERS)}; ${cli} work inspect <id>):`);
    for (const o of held.slice(0, CARRIED_ORDERS)) lines.push(`  ${o.id} ${o.state}, held by ${o.owner.slice(0, 8)} since ${o.at.slice(0, 10)}: ${cut(o.objective, LINE - 40)}`);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n\n`;
}

const TOLD_DIR = join(".coherence", "decisions-told");

/** A decision as a session's start kept it for telling before an edit: only what the telling says. */
export interface PlacedDecision {
  id: string;
  at: string;
  chose: string;
  because: string;
  about: string[];
}

/**
 * What a session keeps for telling decisions before an edit: the placed decisions standing when it started, and the
 * ones it was told since. Kept at the start, which reads the journal anyway, so an edit reads this one small file and
 * never the journal or the spec: a hook that runs before every edit pays nothing for the project's history. A decision
 * another session records after this one started reaches it through the peer feed instead.
 */
interface Told {
  placed: PlacedDecision[];
  told: string[];
}

function toldFile(root: string, session: string): string {
  return join(root, TOLD_DIR, `${session.replace(/[^\w.-]/g, "_")}.json`);
}

function readTold(root: string, session: string): Told | undefined {
  try {
    const kept = JSON.parse(readFileSync(toldFile(root, session), "utf8")) as Partial<Told>;
    return { placed: Array.isArray(kept.placed) ? kept.placed : [], told: Array.isArray(kept.told) ? kept.told.filter((id): id is string => typeof id === "string") : [] };
  } catch {
    return undefined;
  }
}

function writeTold(root: string, session: string, told: Told): void {
  try {
    mkdirSync(join(root, TOLD_DIR), { recursive: true });
    const file = toldFile(root, session);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(told));
    renameSync(temp, file);
  } catch {
    // Telling a decision twice, or not before an edit, is the cost of a store that would not write; nothing waits on it.
  }
}

/** At a start: keep the standing decisions that name a component, other than the root, for this session's edits; what it was already told stays told. */
export function keepPlaced(root: string, session: string, records: readonly JournalRecord[]): void {
  const placed = standingDecisions(records)
    .filter((d) => d.session !== session && (d.about ?? []).some((a) => a !== "."))
    .slice(0, PLACED_KEPT)
    .map((d) => ({ id: d.id, at: d.at, chose: d.chose, because: d.because, about: d.about!.filter((a) => a !== ".") }));
  const told = readTold(root, session)?.told ?? [];
  // A project with no placed decision keeps no file for the session: an edit then reads one missing file and says nothing.
  if (placed.length === 0 && told.length === 0) return;
  writeTold(root, session, { placed, told });
}

/** Whether a file lies in a decision's component. */
const under = (file: string, about: string): boolean => file.startsWith(`${about}/`);

/**
 * Before an edit: the decisions kept at this session's start about the components holding the files it writes, that it was
 * not yet told, newest first, NEAR_PER_COMPONENT a component. `commit` marks them told once the text reached the host.
 */
export function decisionsNear(root: string, session: string | undefined, files: readonly string[], cli: string): { text: string; commit: () => void } {
  const none = { text: "", commit: () => {} };
  if (session === undefined || files.length === 0) return none;
  const kept = readTold(root, session);
  if (kept === undefined || kept.placed.length === 0) return none;
  const told = new Set(kept.told);
  const lines: string[] = [];
  const ids: string[] = [];
  // Each component a written file lies in that a decision names, the deepest first, with the decisions about it.
  const components = [...new Set(files.flatMap((f) => kept.placed.flatMap((d) => d.about.filter((a) => under(f, a)))))].sort((a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b));
  for (const component of components) {
    const here = kept.placed.filter((d) => d.about.includes(component)).sort((a, b) => (a.at < b.at ? 1 : -1));
    const fresh = here.filter((d) => !told.has(d.id) && !ids.includes(d.id));
    const room = Math.max(0, NEAR_PER_COMPONENT - here.filter((d) => told.has(d.id)).length);
    if (fresh.length === 0 || room === 0) continue;
    const shown = fresh.slice(0, room);
    lines.push(`Decided before about ${component}, where this edit lands:`);
    for (const d of shown) lines.push(`  ${d.id} ${d.at.slice(0, 10)} ${cut(d.chose, 120)}: because ${cut(d.because, 200)}`);
    if (fresh.length > shown.length) lines.push(`  ${fresh.length - shown.length} more decided there: ${cli} journal --kind decision`);
    ids.push(...shown.map((d) => d.id));
  }
  if (lines.length === 0) return none;
  lines.push(`  One whole, with what it rejected: ${cli} journal <id>. A decision that no longer fits is retracted (retract <id> --because "<what changed>"), never quietly worked around.`);
  return { text: lines.join("\n"), commit: () => { const now = readTold(root, session) ?? kept; writeTold(root, session, { ...now, told: [...new Set([...now.told, ...ids])] }); } };
}
