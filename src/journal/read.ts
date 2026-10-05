/**
 * The journal readers: the timeline and the subjects feed.
 *
 * The timeline is the merged record across every session, oldest first, one
 * line per record in a fixed form: date, a glyph for the kind, the id, the
 * agent, the text. Records that answer an earlier one (a retraction, a
 * resolution, a close, an acknowledgement) are folded onto the record they
 * answer as a status suffix at read time; nothing on disk changes. An
 * escalation nobody has acknowledged heads every read.
 *
 * The subjects feed is the peer feed's data source: only the subject of each
 * record after a cursor, and the cursor to pass next time.
 *
 * Citations read in both directions: a record shows the ids it cites and
 * the ids of the records, in either store, that cite it. `journal <id>`
 * shows one record of either store with each record it cites and each
 * record citing it named by kind and subject. The subjects feed never
 * carries citations: it stays subjects only.
 */

import { JournalError } from "./args.ts";
import type { Elsewhere } from "./branches.ts";
import { GLYPH, enactmentTally, anySubjectOf, citedBy, citesOf, isKind, kindLabel, pointsAt, subjectOf, type AnyRecord, type Escalation, type JournalRecord, type Kind } from "./record.ts";
import { compareRecords, type Damaged, type Loaded } from "./store.ts";

export interface Filters {
  session?: string;
  agent?: string;
  kind?: Kind;
}

export const SUBJECT_WIDTH = 120;

export function parseKind(value: string): Kind {
  if (!isKind(value)) throw new JournalError(`unknown kind "${value}"`);
  return value;
}

/** Escalations with no acknowledgement pointing at them, oldest first. */
export function openEscalations(records: readonly JournalRecord[]): Escalation[] {
  const acknowledged = new Set(
    records.filter((record) => record.kind === "acknowledgement").map((record) => pointsAt(record)),
  );
  return records.filter(
    (record): record is Escalation => record.kind === "escalation" && !acknowledged.has(record.id),
  );
}

function applyFilters(records: readonly JournalRecord[], filters: Filters): JournalRecord[] {
  return records.filter(
    (record) =>
      (filters.session === undefined || record.session === filters.session) &&
      (filters.agent === undefined || record.agent === filters.agent) &&
      (filters.kind === undefined || record.kind === filters.kind),
  );
}

/** The status each record has acquired from later records that point at it. */
function statuses(records: readonly JournalRecord[]): Map<string, string> {
  const status = new Map<string, string>();
  for (const record of records) {
    const of = pointsAt(record);
    if (of === null) continue;
    const label =
      record.kind === "close" ? `closed ${record.id}: ${record.outcome}` : `${verbPast(record.kind)} ${record.id}`;
    status.set(of, label);
  }
  return status;
}

function verbPast(kind: Kind): string {
  switch (kind) {
    case "retraction":
      return "retracted by";
    case "resolution":
      return "resolved by";
    case "dismissal":
      return "dismissed by";
    case "acknowledgement":
      return "acknowledged by";
    default:
      return kind;
  }
}

function stamp(at: string): string {
  return `${at.slice(0, 10)} ${at.slice(11, 16)}`;
}

/** The lines a record's relations add beneath it: the human's words, what it cites, and what cites it. */
function relationLines(record: JournalRecord, citers: readonly AnyRecord[]): string[] {
  const lines: string[] = [];
  const human = (record as { human?: unknown }).human;
  if (typeof human === "string") lines.push(`human (as the agent attributes): ${human}`);
  const cites = citesOf(record);
  if (cites.length > 0) lines.push(`cites: ${cites.join(", ")}`);
  if (citers.length > 0) lines.push(`cited by: ${citers.map((citer) => citer.id).join(", ")}`);
  return lines;
}

/** One record as its timeline lines: the head line, then indented detail, then its relations. */
export function renderRecord(record: JournalRecord, status: string | undefined, citers: readonly AnyRecord[] = []): string[] {
  const body = renderBody(record, status);
  const relations = relationLines(record, citers);
  return relations.length === 0 ? body : [...body, ...indent(relations)];
}

function renderBody(record: JournalRecord, status: string | undefined): string[] {
  const suffix = status === undefined ? "" : `  [${status}]`;
  const line = (text: string): string => `${stamp(record.at)} ${GLYPH[record.kind]} ${record.id}  ${record.agent}  ${text}${suffix}`;
  const detail: string[] = [];
  switch (record.kind) {
    case "decision":
      detail.push(`over: ${record.over === "none" ? "none" : record.over.length === 0 ? "(unexamined)" : record.over.join(" | ")}`);
      detail.push(`because: ${record.because}`);
      return [line(record.chose), ...indent(detail)];
    case "retraction":
      return [line(`retract ${record.of}`), ...indent([`because: ${record.because}`])];
    case "conjecture":
      detail.push(`could be: ${record.couldBe.join(" | ")}`);
      detail.push(`discriminated by: ${record.discriminatedBy}`);
      return [line(record.observation), ...indent(detail)];
    case "resolution":
      detail.push(`because: ${record.because}`);
      if (record.as !== undefined) detail.push(`as: ${record.as}`);
      return [line(`resolved ${record.of}`), ...indent(detail)];
    case "dismissal":
      return [line(`dismissed ${record.of}`), ...indent([`because: ${record.because}`])];
    case "defect":
      detail.push(`evidence: ${record.evidence}`);
      if (record.files.length > 0) detail.push(`files: ${record.files.join(", ")}`);
      return [line(record.what), ...indent(detail)];
    case "experiment":
      if (record.context.length > 0) detail.push(`context: ${record.context.join(", ")}`);
      for (const step of record.actions) detail.push(`action    ${step.id}  ${step.text}`);
      for (const step of record.criteria) detail.push(`criterion ${step.id}  ${step.text}`);
      return [line(record.expectation), ...indent(detail)];
    case "close":
      for (const [id, result] of Object.entries(record.results)) detail.push(`${id}=${result}`);
      return [line(`closed ${record.of}: ${record.outcome}`), ...indent(detail)];
    case "enactment":
      detail.push(`version ${record.version}, fired by ${record.trigger}`);
      record.steps.forEach((step, index) => {
        const outcome = record.results[String(index + 1)];
        const said = outcome === undefined ? "no outcome" : outcome.result === "done" ? `done${outcome.evidence ? `: ${outcome.evidence}` : ""}` : `${outcome.result}: ${outcome.because}`;
        detail.push(`${index + 1}. ${said}  (${step.text})`);
      });
      return [line(`enacted ${record.practice}: ${enactmentTally(record)}`), ...indent(detail)];
    case "unable":
    case "escalation":
      return [line(record.what), ...indent([`because: ${record.because}`])];
    case "acknowledgement":
      return [line(`acknowledged ${record.of}`), ...indent([`because: ${record.because}`])];
  }
}

function indent(lines: string[]): string[] {
  return lines.map((text) => `    ${text}`);
}

/** The heading every read starts with while an escalation awaits a human. */
function escalationHeading(records: readonly JournalRecord[], status: Map<string, string>, index: Map<string, AnyRecord[]>): string[] {
  const open = openEscalations(records);
  if (open.length === 0) return [];
  return [
    `awaiting a human (${open.length}):`,
    ...open.flatMap((record) => renderRecord(record, status.get(record.id), index.get(record.id))),
    "",
  ];
}

/**
 * The merged timeline. `work` is every work store record, so a record a work
 * order cites shows that order's record among what cites it.
 */
export function renderTimeline(loaded: Loaded, filters: Filters, since: Cursor | null = null, work: readonly AnyRecord[] = []): string[] {
  const status = statuses(loaded.records);
  const index = citedBy([...loaded.records, ...work]);
  const shown = applyFilters(loaded.records, filters).filter((record) => since === null || after(record, since));
  const body = shown.length === 0 ? ["nothing recorded"] : shown.flatMap((record) => renderRecord(record, status.get(record.id), index.get(record.id)));
  return [...escalationHeading(loaded.records, status, index), ...body];
}

/**
 * The JSON envelope: the records as stored (each carries what it cites),
 * and `citedBy`, the reverse direction for every shown record some record
 * of either store cites, derived at the read and stored nowhere.
 */
export function renderJson(loaded: Loaded, filters: Filters, branch: string | null, work: readonly AnyRecord[] = []): string {
  const records = applyFilters(loaded.records, filters);
  const index = citedBy([...loaded.records, ...work]);
  const reverse: Record<string, string[]> = {};
  for (const record of records) {
    const citers = index.get(record.id);
    if (citers !== undefined) reverse[record.id] = citers.map((citer) => citer.id);
  }
  const envelope = {
    branch,
    escalations: openEscalations(loaded.records).map((record) => record.id),
    records,
    citedBy: reverse,
    damaged: loaded.damaged,
  };
  return JSON.stringify(envelope, null, 2);
}

/** A record of either store named on one line: id, kind, agent, the truncated subject. */
export function namedLine(record: AnyRecord): string {
  return `${record.id}  ${kindLabel(record)}  ${record.agent}: ${truncateSubject(anySubjectOf(record))}`;
}

/**
 * One record of either store, by id, and its citations both ways: each
 * record it cites and each record citing it, named by kind and subject. A
 * journal record prints as the timeline prints it; a work record prints its
 * one line (work inspect shows an order whole). Refused for an unknown id.
 */
export function renderOne(id: string, loaded: Loaded, work: readonly AnyRecord[], elsewhere: (ids: readonly string[]) => Map<string, Elsewhere> = () => new Map()): string[] {
  const everything: AnyRecord[] = [...loaded.records, ...work];
  const local = everything.find((record) => record.id === id);
  // A record another branch committed is shown as it stands there, and said to be there.
  const away = local === undefined ? elsewhere([id]).get(id) : undefined;
  const found = local ?? (away === undefined ? undefined : (JSON.parse(away.line) as AnyRecord));
  if (found === undefined) throw new JournalError(`no journal or work record has id ${id}, here or committed on another branch`);
  const byId = new Map(everything.map((record) => [record.id, record]));
  const status = statuses(loaded.records);
  const head = isKind(found.kind) ? renderBody(found as JournalRecord, status.get(found.id)) : [`${stamp(found.at)} ${namedLine(found)}`];
  const human = (found as { human?: unknown }).human;
  const cites = citesOf(found);
  const citers = citedBy(everything).get(found.id) ?? [];
  const citedAway = elsewhere(cites.filter((cited) => !byId.has(cited)));
  return [
    ...head,
    ...(away === undefined ? [] : [`    on branch ${away.branch} (${away.file}), not in this checkout`]),
    ...(typeof human === "string" ? [`    human (as the agent attributes): ${human}`] : []),
    `  cites (${cites.length}):`,
    ...cites.map((cited) => {
      const record = byId.get(cited);
      const branch = citedAway.get(cited)?.branch;
      return `    ${record !== undefined ? namedLine(record) : branch !== undefined ? `${cited}  (on branch ${branch}, not in this checkout)` : `${cited}  (not in the stores read)`}`;
    }),
    `  cited by (${citers.length}):`,
    ...citers.map((citer) => `    ${namedLine(citer)}`),
  ];
}

/** Lines that report each damaged line and then the count, for the end of every read. */
export function renderDamaged(damaged: readonly Damaged[]): string[] {
  return [
    ...damaged.map((entry) => `damaged: ${entry.file}:${entry.line} ${entry.reason}`),
    `damaged lines: ${damaged.length}`,
  ];
}

/**
 * A cursor is `<at>~<id>` of the last record seen, so two records in the same
 * millisecond are never skipped. A bare ISO time is accepted as a cursor with
 * an empty id, meaning every record at or after that time.
 */
export interface Cursor {
  at: string;
  id: string;
}

export function parseCursor(value: string): Cursor {
  const tilde = value.indexOf("~");
  const at = tilde === -1 ? value : value.slice(0, tilde);
  const id = tilde === -1 ? "" : value.slice(tilde + 1);
  const time = Date.parse(at);
  if (Number.isNaN(time)) throw new JournalError(`--since "${value}" is neither a cursor nor an ISO time`);
  return { at: new Date(time).toISOString(), id };
}

export function formatCursor(cursor: Cursor): string {
  return `${cursor.at}~${cursor.id}`;
}

function after(record: JournalRecord, cursor: Cursor): boolean {
  const probe: JournalRecord = { ...record, at: cursor.at, id: cursor.id };
  return compareRecords(record, probe) > 0;
}

export function truncateSubject(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= SUBJECT_WIDTH ? flat : `${flat.slice(0, SUBJECT_WIDTH - 1)}…`;
}

/**
 * The one line that stands for a record in the subjects feed: glyph, id,
 * agent, the truncated subject; an escalation is marked, since it is the one
 * record that exists for a human.
 */
export function subjectLine(record: JournalRecord): string {
  const mark = record.kind === "escalation" ? "  [escalation: a human must answer]" : "";
  return `${GLYPH[record.kind]} ${record.id} ${record.agent}: ${truncateSubject(subjectOf(record))}${mark}`;
}

/** The records after a cursor that pass the filters, oldest first. */
export function recordsAfter(loaded: Loaded, since: Cursor | null, filters: Filters): JournalRecord[] {
  return applyFilters(loaded.records, filters).filter((record) => since === null || after(record, since));
}

/** The cursor that stands for the last of these records, or the one given when there are none. */
export function cursorAfter(records: readonly JournalRecord[], since: Cursor | null): Cursor | null {
  const last = records.at(-1);
  return last === undefined ? since : { at: last.at, id: last.id };
}

export function renderSubjects(loaded: Loaded, since: Cursor | null, filters: Filters): string[] {
  const fresh = recordsAfter(loaded, since, filters);
  const open = openEscalations(loaded.records);
  const heading =
    open.length === 0
      ? []
      : [
          `awaiting a human (${open.length}):`,
          ...open.map((record) => `${GLYPH.escalation} ${record.id} ${record.agent}: ${truncateSubject(record.what)}`),
          "",
        ];
  const lines = fresh.map(subjectLine);
  const next = cursorAfter(fresh, since);
  const cursorLine = next === null ? "cursor: (none; nothing recorded)" : `cursor: ${formatCursor(next)}`;
  return [...heading, ...(lines.length === 0 ? ["nothing new"] : lines), cursorLine];
}
