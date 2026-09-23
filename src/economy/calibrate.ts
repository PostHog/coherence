/**
 * Calibrate: the economy prediction against what sessions actually read,
 * split by an outcome label nobody writes by hand.
 *
 * For every trace with a snapshot (the latest snapshot per session) the
 * sample is the predicted closure of the files the session changed, the
 * files it read, their overlap, what was read outside the prediction, and
 * what was predicted but never read. Coverage is the share of what was
 * read that the prediction named.
 *
 * The outcome label is automatic and only automatic:
 *
 *   defect   a journal defect record written after the snapshot names a file
 *            in the session's patch, or a run after the snapshot found a
 *            structural defect (a failing verdict) whose files or bypasses
 *            touch the patch
 *   clean    otherwise, a run after the snapshot checked an enforcement whose
 *            files touch the patch and every such entry passed
 *   unknown  neither has happened yet
 *
 * A defect always wins over a clean pass. The aggregate says how often the
 * prediction covered everything read, by outcome.
 */

import { loadRuns, type RunRecord } from "../enforcement/record.ts";
import { loadJournal } from "../journal/store.ts";
import type { JournalRecord } from "../journal/record.ts";
import { loadTraces, type Snapshot } from "./trace.ts";
import { toRelative } from "./source.ts";

export type Outcome = "defect" | "clean" | "unknown";

export interface Label {
  outcome: Outcome;
  /** What labeled it: the record or run entry, or why nothing has. */
  by: string;
}

export interface Sample {
  session: string;
  at: string;
  commit: string | null;
  changed: string[];
  predicted: string[];
  read: string[];
  overlap: string[];
  /** Read but not predicted. */
  readOutside: string[];
  /** Predicted but not read. */
  predictedUnread: string[];
  /** overlap / read, or null when nothing was read. */
  coverage: number | null;
  /** Whether the prediction covered everything read. */
  covered: boolean;
  outcome: Outcome;
  labeledBy: string;
}

export interface OutcomeAggregate {
  sessions: number;
  covered: number;
  meanCoverage: number | null;
}

export interface CalibrationReport {
  samples: Sample[];
  aggregate: Record<Outcome | "all", OutcomeAggregate>;
  damaged: { file: string; line: number; reason: string }[];
}

function normalize(root: string, file: string): string {
  return toRelative(root, file) ?? file;
}

/** The automatic label for one snapshot, from the journal and the runs written after it. */
export function labelSnapshot(root: string, snapshot: Snapshot, journal: readonly JournalRecord[], runs: readonly RunRecord[]): Label {
  const changed = new Set(snapshot.changed);
  const later = (at: string): boolean => at > snapshot.at;
  for (const record of journal) {
    if (record.kind !== "defect" || !later(record.at)) continue;
    const hit = record.files.map((f) => normalize(root, f)).find((f) => changed.has(f));
    if (hit !== undefined) return { outcome: "defect", by: `defect ${record.id} names ${hit}` };
  }
  let clean: string | undefined;
  for (const run of runs) {
    if (!later(run.at)) continue;
    for (const entry of run.invariants) {
      const touched = [...entry.files, ...entry.bypasses.map((b) => b.file)].find((f) => changed.has(f));
      if (touched === undefined) continue;
      if (entry.verdict === "fail") return { outcome: "defect", by: `run ${run.at} found ${entry.component}/${entry.name} failing over ${touched}` };
      if (entry.verdict === "pass" && clean === undefined) clean = `run ${run.at} passed ${entry.component}/${entry.name} over ${touched}`;
    }
  }
  if (clean !== undefined) return { outcome: "clean", by: clean };
  return { outcome: "unknown", by: "no later defect record or run touches the patch" };
}

export function sampleOf(root: string, snapshot: Snapshot, journal: readonly JournalRecord[], runs: readonly RunRecord[]): Sample {
  const predicted = new Set(snapshot.predicted);
  const read = new Set(snapshot.read);
  const overlap = snapshot.read.filter((f) => predicted.has(f)).sort();
  const readOutside = snapshot.read.filter((f) => !predicted.has(f)).sort();
  const predictedUnread = snapshot.predicted.filter((f) => !read.has(f)).sort();
  const label = labelSnapshot(root, snapshot, journal, runs);
  return {
    session: snapshot.session,
    at: snapshot.at,
    commit: snapshot.commit,
    changed: [...snapshot.changed].sort(),
    predicted: [...snapshot.predicted].sort(),
    read: [...snapshot.read].sort(),
    overlap,
    readOutside,
    predictedUnread,
    coverage: snapshot.read.length === 0 ? null : overlap.length / snapshot.read.length,
    covered: readOutside.length === 0,
    outcome: label.outcome,
    labeledBy: label.by,
  };
}

function aggregate(samples: readonly Sample[]): OutcomeAggregate {
  const withReads = samples.filter((s) => s.coverage !== null);
  return {
    sessions: samples.length,
    covered: samples.filter((s) => s.covered).length,
    meanCoverage: withReads.length === 0 ? null : withReads.reduce((sum, s) => sum + (s.coverage ?? 0), 0) / withReads.length,
  };
}

export function calibrate(root: string): CalibrationReport {
  const traces = loadTraces(root);
  const journal = loadJournal(root).records;
  const runs = loadRuns(root).records;
  const samples: Sample[] = [];
  for (const session of traces.sessions) {
    const snapshot = session.snapshots[session.snapshots.length - 1];
    if (snapshot === undefined) continue;
    samples.push(sampleOf(root, snapshot, journal, runs));
  }
  samples.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.session.localeCompare(b.session)));
  return {
    samples,
    aggregate: {
      all: aggregate(samples),
      defect: aggregate(samples.filter((s) => s.outcome === "defect")),
      clean: aggregate(samples.filter((s) => s.outcome === "clean")),
      unknown: aggregate(samples.filter((s) => s.outcome === "unknown")),
    },
    damaged: traces.damaged,
  };
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

const SHOWN = 8;

function list(files: readonly string[]): string {
  if (files.length === 0) return "none";
  const shown = files.slice(0, SHOWN).join(", ");
  return files.length > SHOWN ? `${shown}, and ${files.length - SHOWN} more` : shown;
}

export function formatCalibration(report: CalibrationReport): string {
  const lines: string[] = [];
  if (report.samples.length === 0) lines.push("no read trace with a snapshot yet; a session's Stop writes one under .coherence/traces");
  for (const s of report.samples) {
    lines.push(`${s.session} at ${s.at.slice(0, 19)} (${s.commit ?? "no commit"}) — ${s.outcome}: ${s.labeledBy}`);
    lines.push(`  changed ${s.changed.length}: ${list(s.changed)}`);
    lines.push(`  predicted ${s.predicted.length}, read ${s.read.length}, overlap ${s.overlap.length}; coverage ${percent(s.coverage)}`);
    lines.push(`  read outside the prediction (${s.readOutside.length}): ${list(s.readOutside)}`);
    lines.push(`  predicted but not read (${s.predictedUnread.length}): ${list(s.predictedUnread)}`);
  }
  const a = report.aggregate;
  const row = (name: string, agg: OutcomeAggregate): string => `${name}: ${agg.sessions} session${agg.sessions === 1 ? "" : "s"}, prediction covered everything read in ${agg.covered}; mean coverage ${percent(agg.meanCoverage)}`;
  lines.push(row("all", a.all));
  lines.push(row("defect", a.defect));
  lines.push(row("clean", a.clean));
  lines.push(row("unknown", a.unknown));
  for (const d of report.damaged) lines.push(`damaged ${d.file}:${d.line}: ${d.reason}`);
  return lines.join("\n");
}
