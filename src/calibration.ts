// calibration.ts — test economy's predicted context against what agents actually read.
//
// `economy` measures a structural neighbourhood, not cognition. Calling that neighbourhood
// "what a reader must load" remains a conjecture until observed read sets and outcomes can
// disagree with it. Host PostToolUse hooks append explicit file reads to a
// TRANSIENT trace; Stop snapshots the trace against the patch and its predicted one-hop
// closure. `coherence calibrate --outcome clean|defect` labels the same sample later.
//
// This is deliberately a LOWER BOUND. Shell pipelines, editor buffers and remembered
// context are not guessed from command strings. A narrow honest observation is more useful
// than a complete-looking fiction.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Config, Graph } from "./types.ts";
import { buildGraph } from "./derive.ts";
import { changedBetween } from "./structural.ts";
import { importAdjacency } from "./economy.ts";
import { patchFingerprint } from "./signal.ts";
import { readTraceDetailed, type ReadEvent as TraceEvent } from "./read-trace.ts";
export { hookReadCandidates, recordHookReads, readTrace, readTraceDetailed, type ReadEvent } from "./read-trace.ts";

export type CalibrationOutcome = "unknown" | "clean" | "defect";
export type CalibrationAttribution =
  | "session-writes"
  | "parent-session-aggregate"
  | "legacy-unscoped"
  | "worktree-union";

export interface CalibrationSample {
  id: string;
  at: string;
  session: string;
  patch: string;
  changed: string[];
  predicted: string[];
  observed: string[];
  outcome: CalibrationOutcome;
  attribution?: CalibrationAttribution; // absent in pre-attribution samples = worktree union
}

export interface CalibrationStats {
  samples: number;
  labeled: number;
  defects: number;
  meanPredictedCoverage: number;
  meanObservedOutside: number;
  defectRateWithMisses: number | null;
  defectRateWithoutMisses: number | null;
  sharedWorktreeSamples: number;
  parentAggregateSamples: number;
  legacyUnscopedSamples: number;
}

const samplesDir = (cfg: Config) => join(cfg.root, ".coherence", "calibration");
const samplesPath = (cfg: Config, session: string) => join(samplesDir(cfg), `${slug(session)}.jsonl`);
const slug = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "unknown";

/** Economy's code-file prediction, made explicit and independently testable. Specs are
 * omitted from calibration until hook traces can distinguish reading a spec from receiving
 * its generated projection; counting either as the other would manufacture misses. */
export function predictedReadSet(graph: Graph, changed: Iterable<string>): Set<string> {
  const files = new Set(graph.nodes.filter((n) => n.kind === "file").map((n) => n.path ?? n.label));
  const adj = importAdjacency(graph);
  const out = new Set<string>();
  for (const path of changed) {
    if (!files.has(path)) continue;
    out.add(path);
    for (const n of adj.get(path) ?? []) if (files.has(n)) out.add(n);
  }
  return out;
}

const sampleId = (session: string, patch: string) =>
  "r-" + createHash("sha256").update(`${session}\0${patch}`).digest("hex").slice(0, 12);

/** Invalid evidence cannot enter a denominator through either disk or the public API. */
export function validateCalibrationSample(value: unknown): CalibrationSample {
  const fail = (): never => { throw new Error("Calibration unavailable: malformed sample identity, time, paths, outcome or attribution"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const s = value as CalibrationSample;
  const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && !/[\x00-\x1f\x7f-\x9f]/u.test(v);
  const paths = (v: unknown): v is string[] => Array.isArray(v) && new Set(v).size === v.length
    && v.every(p => text(p) && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some(part => !part || part === "." || part === ".."));
  if (!text(s.session) || !text(s.patch) || s.id !== sampleId(s.session, s.patch)
    || typeof s.at !== "string" || !Number.isFinite(Date.parse(s.at)) || new Date(s.at).toISOString() !== s.at
    || !paths(s.changed) || !paths(s.predicted) || !paths(s.observed)
    || !["unknown", "clean", "defect"].includes(s.outcome)
    || (s.attribution !== undefined && !["session-writes", "parent-session-aggregate", "legacy-unscoped", "worktree-union"].includes(s.attribution))) return fail();
  return s;
}

/** Separate the host observation from git fallback so the attribution rule is a pure,
 * testable contract. Writes win whenever the host supplies them; mixing them with the
 * worktree union would silently charge one agent for another agent's patch. */
export function calibrationPaths(
  trace: TraceEvent[],
  worktreeChanged: Iterable<string>,
): { changed: string[]; observed: string[]; attribution: CalibrationAttribution } {
  const recordedWrites = [...new Set(trace.filter((e) => e.mode === "write").map((e) => e.path))].sort();
  const worktree = [...new Set(worktreeChanged)].sort();
  // A PostToolUse event proves that a write tool ran, not that its requested edit landed.
  // Intersect its paths with Git's live change set before calling them this agent's patch.
  // Crucially, a host that supplied write attribution but landed nothing does NOT fall
  // back to the shared union—that would charge another concurrent agent's work to it.
  const changed = recordedWrites.length
    ? recordedWrites.filter((path) => worktree.includes(path))
    : worktree;
  const weakestTraceScope: CalibrationAttribution = trace.some((event) => !event.observation
    || event.observation.attribution === "unknown")
    ? "legacy-unscoped"
    : trace.some((event) => event.observation?.attribution === "parent-fallback")
      ? "parent-session-aggregate"
      : "session-writes";
  return {
    changed,
    observed: [...new Set(trace.filter((e) => e.mode !== "write").map((e) => e.path))].sort(),
    attribution: recordedWrites.length ? weakestTraceScope : "worktree-union",
  };
}

/** Append a snapshot. Re-labeling appends the same id with a new outcome; readers take the
 * latest row, preserving append-only history without reporting one patch twice. */
export async function recordCalibrationSample(
  cfg: Config,
  session: string,
  outcome: CalibrationOutcome = "unknown",
  graph?: Graph,
  now = new Date().toISOString(),
): Promise<CalibrationSample | null> {
  const trace = readTraceDetailed(cfg, session);
  // Damage cannot become a smaller, cleaner-looking observation. Status names the lost
  // rows; calibration declines to mint a sample from a window it cannot account for.
  if (trace.unreadable) return null;
  // Exact host rows, Codex parent-session aggregates, legacy rows, and the shared-worktree
  // fallback stay distinct. In particular, parent-only Codex writes are never relabeled
  // as one child's patch merely because they occupy one session file.
  const { changed, observed, attribution } = calibrationPaths(trace.rows, changedBetween(cfg, "HEAD", null));
  if (!changed.length || !observed.length) return null;
  const patch = await patchFingerprint(cfg, "HEAD", changed);
  const predicted = [...predictedReadSet(graph ?? await buildGraph(cfg), changed)].sort();
  const sample: CalibrationSample = {
    id: sampleId(session, patch), at: now, session, patch, changed, predicted, observed, outcome, attribution,
  };
  validateCalibrationSample(sample);
  readCalibrationSamples(cfg); // damage must not be buried by another successful append
  mkdirSync(samplesDir(cfg), { recursive: true });
  appendFileSync(samplesPath(cfg, session), JSON.stringify(sample) + "\n");
  return sample;
}

export function readCalibrationSamples(cfg: Config): CalibrationSample[] {
  const latest = new Map<string, CalibrationSample>();
  for (const dir of [join(cfg.root, ".coherence"), samplesDir(cfg)]) {
    try { const stat = lstatSync(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Calibration unavailable: redirected or invalid directory"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  for (const file of readdirSync(samplesDir(cfg)).sort()) {
    const path = join(samplesDir(cfg), file), stat = lstatSync(path);
    if (!file.endsWith(".jsonl") || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`Calibration unavailable: unexpected entry ${JSON.stringify(file)}`);
    const bytes = readFileSync(path, "utf8");
    if (!bytes || !bytes.endsWith("\n")) throw new Error(`Calibration unavailable: torn or empty file ${JSON.stringify(file)}`);
    for (const [index, line] of bytes.slice(0, -1).split("\n").entries()) {
      try {
        const s = validateCalibrationSample(JSON.parse(line));
        if (file !== `${slug(s.session)}.jsonl`) throw new Error("displaced session record");
          const previous = latest.get(s.id);
          // Stop is a recurring observation tick. It may snapshot the same patch after a
          // human has already labeled that patch clean or defective, and "looked again"
          // is not evidence that the label became unknown. Preserve a real verdict across
          // later unknown snapshots; another explicit label may still replace it.
          if (!previous || s.outcome !== "unknown" || previous.outcome === "unknown") latest.set(s.id, s);
      } catch (error) { throw new Error(`Calibration unavailable: ${JSON.stringify(file)} row ${index + 1}: ${(error as Error).message}`); }
    }
  }
  return [...latest.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

const ratio = (n: number, d: number) => d ? n / d : 0;
export function calibrationStats(samples: CalibrationSample[]): CalibrationStats {
  samples.forEach(validateCalibrationSample);
  if (new Set(samples.map(s => s.id)).size !== samples.length) throw new Error("Calibration unavailable: duplicate sample identities in statistics input");
  const rows = samples.map((s) => {
    const predicted = new Set(s.predicted), observed = new Set(s.observed);
    const overlap = [...predicted].filter((p) => observed.has(p)).length;
    const outside = [...observed].filter((p) => !predicted.has(p)).length;
    return { s, coverage: ratio(overlap, predicted.size), outside: ratio(outside, observed.size), misses: overlap < predicted.size };
  });
  const labeled = rows.filter((r) => r.s.outcome !== "unknown");
  const withMisses = labeled.filter((r) => r.misses), withoutMisses = labeled.filter((r) => !r.misses);
  const defectRate = (r: typeof rows): number | null => r.length ? r.filter((x) => x.s.outcome === "defect").length / r.length : null;
  return {
    samples: rows.length,
    labeled: labeled.length,
    defects: labeled.filter((r) => r.s.outcome === "defect").length,
    meanPredictedCoverage: rows.length ? rows.reduce((n, r) => n + r.coverage, 0) / rows.length : 0,
    meanObservedOutside: rows.length ? rows.reduce((n, r) => n + r.outside, 0) / rows.length : 0,
    defectRateWithMisses: defectRate(withMisses),
    defectRateWithoutMisses: defectRate(withoutMisses),
    sharedWorktreeSamples: samples.filter((x) => !x.attribution || x.attribution === "worktree-union").length,
    parentAggregateSamples: samples.filter((x) => x.attribution === "parent-session-aggregate").length,
    legacyUnscopedSamples: samples.filter((x) => x.attribution === "legacy-unscoped").length,
  };
}

const pct = (n: number | null) => n === null ? "—" : `${Math.round(n * 100)}%`;
export function formatCalibration(samples: CalibrationSample[]): string[] {
  const s = calibrationStats(samples);
  const lines = ["ECONOMY CALIBRATION — predicted one-hop context vs observed explicit file reads"];
  if (!s.samples) return [...lines, "  no samples yet — the PostToolUse hook supplies reads; label an outcome with `coherence calibrate --outcome clean|defect`."];
  lines.push(`  ${s.samples} patch sample(s) · ${s.labeled} labeled · ${s.defects} defect(s)`);
  lines.push(`  mean predicted closure observed: ${pct(s.meanPredictedCoverage)}`);
  lines.push(`  mean observed reads outside prediction: ${pct(s.meanObservedOutside)}`);
  lines.push(`  defect rate with predicted files unread: ${pct(s.defectRateWithMisses)}`);
  lines.push(`  defect rate with full predicted coverage: ${pct(s.defectRateWithoutMisses)}`);
  const exact = s.samples - s.sharedWorktreeSamples - s.parentAggregateSamples - s.legacyUnscopedSamples;
  lines.push(`  attribution: ${exact} exact-session · ${s.parentAggregateSamples} parent-session aggregate ·`
    + ` ${s.legacyUnscopedSamples} legacy unscoped · ${s.sharedWorktreeSamples} shared-worktree sample(s).`);
  lines.push("  lower bound: shell/editor/remembered reads are not inferred; correlation is not causation.");
  return lines;
}

export async function calibrate(
  cfg: Config,
  opts: { outcome?: CalibrationOutcome; session?: string; graph?: Graph } = {},
): Promise<number> {
  try {
  if (opts.outcome) {
    const session = opts.session ?? process.env.COHERENCE_SESSION ?? "unknown";
    const sample = await recordCalibrationSample(cfg, session, opts.outcome, opts.graph);
    if (!sample) {
      console.error(`no calibration sample recorded for session ${session}: this patch has no captured explicit file reads`);
      return 2;
    }
    console.log(`${sample.id}  ${sample.outcome} outcome for patch ${sample.patch}\n`);
  }
  for (const line of formatCalibration(readCalibrationSamples(cfg))) console.log(line);
  return 0;
  } catch (error) {
    console.error(`Calibration unavailable: ${(error as Error).message}`);
    return 2;
  }
}
