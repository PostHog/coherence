/**
 * Timing debt in the tests, read from the run store: a test that has grown
 * slower than its own history. (What the hooks cost, which the latency budget
 * holds, is src/lifecycle/hook-latency.ts.)
 *
 * A test is read only against itself: its latest runner-measured time against
 * the median of its previous timed runs, so one slow test among fast ones is
 * never measured against them. A ratio with a floor keeps small jitter quiet,
 * and the ratio grows with how much busier the machine was than it usually is
 * for that test, so a run beside four other suites does not alarm.
 */

import { entryKey, type RunRecord } from "./record.ts";

/** How many previous timed runs of a test its median is taken over. */
export const LATENCY_HISTORY = 10;
/** Fewer previous timed runs than this, and a test has no history to be slower than. */
export const LATENCY_MIN_HISTORY = 3;
/** A test is slower when its time passes this multiple of its median... */
export const LATENCY_RATIO = 2;
/** ...and this many milliseconds: below it, a doubling is jitter nobody waits on. */
export const LATENCY_FLOOR_MS = 2000;

export interface SlowerTest {
  component: string;
  name: string;
  at: string;
  session: string;
  testMs: number;
  /** The median of its previous timed runs. */
  medianMs: number;
  /** How many previous timed runs the median is over. */
  history: number;
  /** The latest run's load per core over the median of the previous runs', at least 1: the ratio the alarm allowed for. */
  loadRatio: number;
}

export interface LatencyReading {
  slower: SlowerTest[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function perCore(run: RunRecord): number | undefined {
  return run.load === undefined || run.load.cores <= 0 ? undefined : run.load.average / run.load.cores;
}

/** The timing debt in `runs` (oldest first, as loadRuns gives them); with `session`, only the slower tests whose latest timed run was that session's. */
export function readLatency(runs: readonly RunRecord[], options: { session?: string } = {}): LatencyReading {
  const timelines = new Map<string, { component: string; name: string; at: string; session: string; testMs: number; load: number | undefined }[]>();
  for (const run of runs) {
    const load = perCore(run);
    for (const entry of run.invariants) {
      if (entry.form !== "totality oracle" || entry.testMs === undefined) continue;
      const key = entryKey(entry.component, entry.name, entry.form);
      const timeline = timelines.get(key) ?? [];
      timeline.push({ component: entry.component, name: entry.name, at: run.at, session: run.session, testMs: entry.testMs, load });
      timelines.set(key, timeline);
    }
  }
  const slower: SlowerTest[] = [];
  for (const timeline of timelines.values()) {
    const latest = timeline[timeline.length - 1]!;
    if (options.session !== undefined && latest.session !== options.session) continue;
    const previous = timeline.slice(-1 - LATENCY_HISTORY, -1);
    if (previous.length < LATENCY_MIN_HISTORY) continue;
    const medianMs = median(previous.map((p) => p.testMs));
    const loads = previous.flatMap((p) => (p.load === undefined ? [] : [p.load]));
    const usual = loads.length === 0 ? undefined : median(loads);
    const loadRatio = latest.load === undefined || usual === undefined || usual <= 0 ? 1 : Math.max(1, latest.load / usual);
    if (latest.testMs >= LATENCY_FLOOR_MS && latest.testMs > LATENCY_RATIO * medianMs * loadRatio) {
      slower.push({ component: latest.component, name: latest.name, at: latest.at, session: latest.session, testMs: latest.testMs, medianMs, history: previous.length, loadRatio });
    }
  }
  slower.sort((a, b) => b.testMs / Math.max(b.medianMs, 1) - a.testMs / Math.max(a.medianMs, 1));

  return { slower };
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** The reading as the lines a run prints; empty when there is no timing debt. */
export function latencyLines(reading: LatencyReading, limit = 5): string[] {
  const lines: string[] = [];
  if (reading.slower.length > 0) {
    const shown = reading.slower.slice(0, limit).map((s) => `${s.component}/${s.name} ${seconds(s.testMs)} against ${seconds(s.medianMs)}${s.loadRatio > 1 ? ` (machine ${s.loadRatio.toFixed(1)}× busier, allowed for)` : ""}`);
    const more = reading.slower.length > limit ? `; and ${reading.slower.length - limit} more (run --json)` : "";
    lines.push(`Latency: ${reading.slower.length} test${reading.slower.length === 1 ? "" : "s"} ran over ${LATENCY_RATIO}× the median of ${reading.slower.length === 1 ? "its" : "their"} own last runs: ${shown.join("; ")}${more}. Find what each now does per item that it did once, before it becomes the suite's cost.`);
  }
  return lines;
}

