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
 */

import { JournalError } from "./args.ts";
import { GLYPH, isKind, pointsAt, subjectOf, type Escalation, type JournalRecord, type Kind } from "./record.ts";
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

/** One record as its timeline lines: the head line, then indented detail. */
export function renderRecord(record: JournalRecord, status: string | undefined): string[] {
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
function escalationHeading(records: readonly JournalRecord[], status: Map<string, string>): string[] {
  const open = openEscalations(records);
  if (open.length === 0) return [];
  return [
    `awaiting a human (${open.length}):`,
    ...open.flatMap((record) => renderRecord(record, status.get(record.id))),
    "",
  ];
}

export function renderTimeline(loaded: Loaded, filters: Filters): string[] {
  const status = statuses(loaded.records);
  const shown = applyFilters(loaded.records, filters);
  const body = shown.length === 0 ? ["nothing recorded"] : shown.flatMap((record) => renderRecord(record, status.get(record.id)));
  return [...escalationHeading(loaded.records, status), ...body];
}

export function renderJson(loaded: Loaded, filters: Filters, branch: string | null): string {
  const envelope = {
    branch,
    escalations: openEscalations(loaded.records).map((record) => record.id),
    records: applyFilters(loaded.records, filters),
    damaged: loaded.damaged,
  };
  return JSON.stringify(envelope, null, 2);
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

export function renderSubjects(loaded: Loaded, since: Cursor | null, filters: Filters): string[] {
  const fresh = applyFilters(loaded.records, filters).filter((record) => since === null || after(record, since));
  const open = openEscalations(loaded.records);
  const heading =
    open.length === 0
      ? []
      : [
          `awaiting a human (${open.length}):`,
          ...open.map((record) => `${GLYPH.escalation} ${record.id} ${record.agent}: ${truncateSubject(record.what)}`),
          "",
        ];
  const lines = fresh.map(
    (record) => `${GLYPH[record.kind]} ${record.id} ${record.agent}: ${truncateSubject(subjectOf(record))}`,
  );
  const last = fresh.at(-1);
  const next = last === undefined ? since : { at: last.at, id: last.id };
  const cursorLine = next === null ? "cursor: (none; nothing recorded)" : `cursor: ${formatCursor(next)}`;
  return [...heading, ...(lines.length === 0 ? ["nothing new"] : lines), cursorLine];
}
