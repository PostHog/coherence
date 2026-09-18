/**
 * The shape of a journal record.
 *
 * The journal is compression: a session's work, however long, leaves a
 * handful of durable outcomes. Every record carries the same head (id, kind,
 * time, attribution, commit) and then the fields its kind needs. Nothing here
 * is ever edited; a later record points at an earlier one instead.
 */

import { createHash } from "node:crypto";

/** Every kind the journal records, with the id prefix that marks it. */
export const KINDS = {
  decision: "d",
  retraction: "rt",
  conjecture: "c",
  resolution: "rs",
  dismissal: "dm",
  defect: "df",
  experiment: "x",
  close: "xc",
  unable: "u",
  escalation: "e",
  acknowledgement: "ak",
} as const;

export type Kind = keyof typeof KINDS;

export const KIND_NAMES: readonly Kind[] = Object.keys(KINDS) as Kind[];

export function isKind(value: string): value is Kind {
  return Object.hasOwn(KINDS, value);
}

/** The glyph each kind prints in the timeline. */
export const GLYPH: Record<Kind, string> = {
  decision: "◆",
  retraction: "↺",
  conjecture: "?",
  resolution: "✓",
  dismissal: "−",
  defect: "!",
  experiment: "▷",
  close: "▶",
  unable: "⊘",
  escalation: "▲",
  acknowledgement: "△",
};

/** The candidate every conjecture carries whether or not the caller named it. */
export const INSTRUMENT_IS_WRONG = "the instrument is wrong";

/**
 * The kinds the work store records, with their id prefixes. Work orders live
 * in their own files under .coherence/work; these kinds never appear in the
 * journal, but their ids come from the same minter.
 */
export const WORK_KINDS = {
  order: "w",
  move: "wm",
  owner: "wo",
  completion: "wc",
} as const;

export type WorkKind = keyof typeof WORK_KINDS;

export function isWorkKind(value: string): value is WorkKind {
  return Object.hasOwn(WORK_KINDS, value);
}

/** What every record carries. Session is the key; agent is the readable name. */
export interface Attribution {
  session: string;
  agent: string;
  /** The work order the caller named with --work; absent when binding is inferred at the append. */
  work?: string;
}

/** The head every record in either store shares: id, kind, time, attribution, commit. */
export interface Stamp<K extends string> {
  id: string;
  kind: K;
  /** ISO time of the write. */
  at: string;
  session: string;
  agent: string;
  /** Short sha of HEAD at the write, or null when there is no git to ask. */
  commit: string | null;
  /** Whether the working tree had uncommitted changes at the write. */
  dirty: boolean;
}

export interface Head extends Stamp<Kind> {
  /** The work order this record binds to, when it binds to one. */
  work?: string;
  /**
   * How the binding was settled at the append: "flag" when --work named the
   * order, "inferred" when the session owned exactly one active order, or
   * "none: <reason>" when nothing binds. Absent on records older than binding.
   */
  binding?: string;
}

export interface Decision extends Head {
  kind: "decision";
  chose: string;
  /**
   * What was rejected. An empty list means the caller never said; the string
   * "none" means the caller said nothing was rejected. The two are different
   * facts and the record keeps them apart.
   */
  over: string[] | "none";
  because: string;
}

export interface Retraction extends Head {
  kind: "retraction";
  /** The id of the record this retracts. */
  of: string;
  because: string;
}

export interface Conjecture extends Head {
  kind: "conjecture";
  observation: string;
  couldBe: string[];
  discriminatedBy: string;
}

export interface Resolution extends Head {
  kind: "resolution";
  of: string;
  because: string;
  /** Which candidate won, when the caller named one. */
  as?: string;
}

export interface Dismissal extends Head {
  kind: "dismissal";
  of: string;
  because: string;
}

export interface Defect extends Head {
  kind: "defect";
  what: string;
  evidence: string;
  files: string[];
}

/** One planned action or one observable criterion, with the id its result binds to. */
export interface Step {
  id: string;
  text: string;
}

export interface Experiment extends Head {
  kind: "experiment";
  expectation: string;
  context: string[];
  actions: Step[];
  criteria: Step[];
}

export type StepResult = "pass" | "fail" | "unknown";
export type Outcome = "success" | "failure" | "inconclusive";

export interface Close extends Head {
  kind: "close";
  of: string;
  results: Record<string, StepResult>;
  outcome: Outcome;
}

export interface Unable extends Head {
  kind: "unable";
  what: string;
  because: string;
}

export interface Escalation extends Head {
  kind: "escalation";
  what: string;
  because: string;
}

export interface Acknowledgement extends Head {
  kind: "acknowledgement";
  of: string;
  because: string;
}

export type JournalRecord =
  | Decision
  | Retraction
  | Conjecture
  | Resolution
  | Dismissal
  | Defect
  | Experiment
  | Close
  | Unable
  | Escalation
  | Acknowledgement;

/**
 * An id is the kind's prefix and eight hex digits of a hash over session,
 * time, and text. Two writers in different sessions never collide; one writer
 * never collides with itself unless it writes the same text twice in the same
 * millisecond, which is the same record.
 */
export function recordId(kind: Kind | WorkKind, session: string, at: string, text: string): string {
  const digest = createHash("sha256").update(`${session}\n${at}\n${text}`).digest("hex");
  const prefix = isKind(kind) ? KINDS[kind] : WORK_KINDS[kind];
  return `${prefix}-${digest.slice(0, 8)}`;
}

/** The outcome an experiment's close derives from its results. */
export function deriveOutcome(results: readonly StepResult[]): Outcome {
  if (results.includes("fail")) return "failure";
  if (results.every((result) => result === "pass")) return "success";
  return "inconclusive";
}

/** The one line that stands for a record in the peer feed. */
export function subjectOf(record: JournalRecord): string {
  switch (record.kind) {
    case "decision":
      return record.chose;
    case "conjecture":
      return record.observation;
    case "defect":
    case "unable":
    case "escalation":
      return record.what;
    case "experiment":
      return record.expectation;
    case "retraction":
      return `retracted ${record.of}`;
    case "resolution":
      return `resolved ${record.of}`;
    case "dismissal":
      return `dismissed ${record.of}`;
    case "close":
      return `closed ${record.of}: ${record.outcome}`;
    case "acknowledgement":
      return `acknowledged ${record.of}`;
  }
}

/** The states a work order moves through; completed and cancelled end it. */
export const WORK_STATES = ["open", "active", "waiting", "completed", "cancelled"] as const;
export type WorkState = (typeof WORK_STATES)[number];
export const TERMINAL_STATES: readonly WorkState[] = ["completed", "cancelled"];

export function isWorkState(value: string): value is WorkState {
  return (WORK_STATES as readonly string[]).includes(value);
}

/** The order itself: its content and the owner session it starts with. */
export interface WorkOrderRecord extends Stamp<"order"> {
  objective: string;
  success: string;
  boundary: string;
  /** The session that owns the order at creation; the creating session by default. */
  owner: string;
}

/** A move to another state; never to completed, which only close records. */
export interface WorkMove extends Stamp<"move"> {
  of: string;
  state: Exclude<WorkState, "completed">;
  because: string;
}

/** A change of owner session, by anyone, recorded. */
export interface WorkOwner extends Stamp<"owner"> {
  of: string;
  owner: string;
  because: string;
}

/** The close: the only path to completed. */
export interface WorkCompletion extends Stamp<"completion"> {
  of: string;
  state: "completed";
  because: string;
}

export type WorkRecord = WorkOrderRecord | WorkMove | WorkOwner | WorkCompletion;

/** Records that point at an earlier record carry its id in `of`. */
export function pointsAt(record: JournalRecord): string | null {
  switch (record.kind) {
    case "retraction":
    case "resolution":
    case "dismissal":
    case "close":
    case "acknowledgement":
      return record.of;
    default:
      return null;
  }
}
