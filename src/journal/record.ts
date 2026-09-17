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

/** What every record carries. Session is the key; agent is the readable name. */
export interface Attribution {
  session: string;
  agent: string;
  /** A work order binding, stored only when the caller passed --work. */
  work?: string;
}

export interface Head extends Attribution {
  id: string;
  kind: Kind;
  /** ISO time of the write. */
  at: string;
  /** Short sha of HEAD at the write, or null when there is no git to ask. */
  commit: string | null;
  /** Whether the working tree had uncommitted changes at the write. */
  dirty: boolean;
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
export function recordId(kind: Kind, session: string, at: string, text: string): string {
  const digest = createHash("sha256").update(`${session}\n${at}\n${text}`).digest("hex");
  return `${KINDS[kind]}-${digest.slice(0, 8)}`;
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
