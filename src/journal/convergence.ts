/**
 * The convergence reading: whether discoveries are repaying, over a window
 * (14 days by default), per day and per release tag.
 *
 *   defects arriving, split by where they came in (fix-induced: a commit or a
 *     pull request; pre-existing; unknown) and by what caught them;
 *   escapes per release: defects whose introduced points into a release's
 *     range and that were recorded after the release's tag;
 *   the share of closed defects closed with a guard;
 *   repeats per class: guard failures, which should fall to zero;
 *   bullets over time, from the specs at each day and tag;
 *   hotspot churn: the files most often changed;
 *   hook latency p50 and p95 per event per Coherence version.
 *
 * Computed from the journal, the spec model (which reads the runs), git and
 * .coherence/hook-times. A field an old record lacks is counted as unknown,
 * never inferred: a defect with no introduced is neither fix-induced nor
 * pre-existing, and a hook time with no version is version unknown.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec } from "../spec/grammar.ts";
import { guardStanding, loadSpecModel } from "../spec/model.ts";
import { HOOK_TIMES_DIR, parseHookTimes } from "../lifecycle/hook-latency.ts";
import { defectStates, type DefectFloor, type DefectState } from "./defects.ts";
import { loadJournal } from "./store.ts";

export const DEFAULT_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN = "unknown";

export type Origin = "fix-induced" | "pre-existing" | "unknown";

/** Where a defect came in, as its introduced field says: a commit or a pull request is fix-induced; nothing given is unknown. */
export function originOf(introduced: string | undefined): Origin {
  if (introduced === undefined || introduced === UNKNOWN) return "unknown";
  if (introduced === "pre-existing") return "pre-existing";
  return "fix-induced";
}

export interface Arrivals {
  total: number;
  byOrigin: Record<Origin, number>;
  /** By what caught them; "unknown" where no record says. */
  byCaught: Record<string, number>;
  /** By class; "unknown" where no record says. */
  byClass: Record<string, number>;
}

export interface Day extends Arrivals {
  date: string;
  /** Bullets in the specs at the last commit of the day, or undefined when git has none by then. */
  bullets?: BulletCount;
}

export interface BulletCount {
  commit: string;
  bullets: number;
  /**
   * Bullets that declare an enforcement and kinds. Whether each refutation was
   * witnessed lives in the run store, which is not read at a past commit, so
   * this is an upper bound on the invariants then, never a count of them.
   */
  enforced: number;
  /** Bullets with no enforcement or no kinds: requirements whatever the runs said. */
  requirements: number;
}

export interface Release {
  tag: string;
  at: string;
  /** The tag before it, whose range ends where this one's starts; undefined for the first tag git has. */
  since?: string;
  /** Defects recorded between the previous tag and this one. */
  arrived: number;
  /** Defects whose introduced names a commit or pull request inside this release's range. */
  introducedHere: string[];
  /** Of those, the ones recorded after this tag: they escaped the release. */
  escapes: string[];
  bullets?: BulletCount;
}

export interface Convergence {
  window: { days: number; from: string; to: string };
  arrivals: Arrivals;
  days: Day[];
  releases: Release[];
  closing: { recordedInWindow: number; closed: number; guarded: number; decided: number; neither: number; guardedShare: number | null; allTime: Pick<DefectFloor, "recorded" | "closed" | "guarded" | "decided"> };
  /** Guard failures by class, all time and in the window. */
  repeats: { class: string; allTime: number; inWindow: number }[];
  /** Defects whose introduced names a commit or pull request git could not place in any release range. */
  unplaced: string[];
  churn: { file: string; commits: number }[];
  hookLatency: { event: string; version: string; count: number; p50: number; p95: number }[];
}

function git(root: string, args: readonly string[], input?: string): string | undefined {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...(input === undefined ? {} : { input }) });
  return result.status === 0 ? result.stdout : undefined;
}

function emptyArrivals(): Arrivals {
  return { total: 0, byOrigin: { "fix-induced": 0, "pre-existing": 0, unknown: 0 }, byCaught: {}, byClass: {} };
}

function count(into: Arrivals, d: DefectState): void {
  into.total += 1;
  into.byOrigin[originOf(d.introduced)] += 1;
  const caught = d.caught ?? UNKNOWN;
  into.byCaught[caught] = (into.byCaught[caught] ?? 0) + 1;
  const cls = d.class ?? UNKNOWN;
  into.byClass[cls] = (into.byClass[cls] ?? 0) + 1;
}

/** The bullets in every spec git tracks at a commit, read in one batch. */
function bulletsAt(root: string, commit: string): BulletCount | undefined {
  const listed = git(root, ["ls-tree", "-r", "--name-only", commit]);
  if (listed === undefined) return undefined;
  const specs = listed.split("\n").filter((p) => p.endsWith(".spec.md") && !p.split("/").includes("node_modules"));
  const counted: BulletCount = { commit: commit.slice(0, 7), bullets: 0, enforced: 0, requirements: 0 };
  if (specs.length === 0) return counted;
  const out = spawnSync("git", ["cat-file", "--batch"], { cwd: root, input: specs.map((p) => `${commit}:${p}`).join("\n") + "\n", maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) return undefined;
  const buffer = out.stdout as Buffer;
  let offset = 0;
  for (const path of specs) {
    const end = buffer.indexOf(10, offset);
    const header = buffer.subarray(offset, end).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size)) return undefined;
    const text = buffer.subarray(end + 1, end + 1 + size).toString("utf8");
    offset = end + 1 + size + 1;
    for (const bullet of parseSpec(text, path).invariants) {
      counted.bullets += 1;
      if (bullet.enforcements.length > 0 && bullet.kinds !== undefined) counted.enforced += 1;
      else counted.requirements += 1;
    }
  }
  return counted;
}

/** The commit HEAD's history had reached by an instant, or undefined before the first. */
function commitBy(root: string, iso: string): string | undefined {
  const sha = git(root, ["rev-list", "-1", `--before=${iso}`, "HEAD"])?.trim();
  return sha === undefined || sha === "" ? undefined : sha;
}

/** A release tag: v and a semantic version. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** The release tags, oldest first, with their dates. */
function tags(root: string): { tag: string; at: string }[] {
  const out = git(root, ["for-each-ref", "--sort=creatordate", "--format=%(refname:short) %(creatordate:iso-strict)", "refs/tags"]);
  if (out === undefined) return [];
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [tag, at] = l.split(" ");
      return { tag: tag!, at: new Date(at!).toISOString() };
    })
    .filter((t) => RELEASE_TAG.test(t.tag));
}

/** The commit a pull request merged as, read from the merge or squash subject git records; never guessed. */
function pullCommits(root: string): Map<string, string> {
  const out = git(root, ["log", "--format=%H %s", "HEAD"]) ?? "";
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const space = line.indexOf(" ");
    const sha = line.slice(0, space);
    const subject = line.slice(space + 1);
    const merged = /^Merge pull request #(\d+) /.exec(subject) ?? /\(#(\d+)\)$/.exec(subject);
    if (merged !== null && !map.has(merged[1]!)) map.set(merged[1]!, sha);
  }
  return map;
}

/** Nearest-rank percentile of sorted values. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export interface ConvergenceOptions {
  days?: number;
  now?: () => Date;
}

export function convergence(root: string, options: ConvergenceOptions = {}): Convergence {
  const days = options.days ?? DEFAULT_WINDOW_DAYS;
  const now = (options.now ?? (() => new Date()))();
  const toDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fromDay = new Date(toDay.getTime() - (days - 1) * DAY_MS);
  const from = fromDay.toISOString();
  const states = defectStates(loadJournal(root).records);
  const inWindow = states.filter((d) => d.at >= from);

  const arrivals = emptyArrivals();
  for (const d of inWindow) count(arrivals, d);

  const dayList: Day[] = [];
  for (let i = 0; i < days; i += 1) {
    const start = new Date(fromDay.getTime() + i * DAY_MS);
    const end = new Date(start.getTime() + DAY_MS);
    const day: Day = { date: start.toISOString().slice(0, 10), ...emptyArrivals() };
    for (const d of inWindow) if (d.at >= start.toISOString() && d.at < end.toISOString()) count(day, d);
    const commit = commitBy(root, end.toISOString());
    const bullets = commit === undefined ? undefined : bulletsAt(root, commit);
    if (bullets !== undefined) day.bullets = bullets;
    dayList.push(day);
  }

  // Releases: every tag in the window, each with the range from the tag before it.
  const allTags = tags(root);
  const pulls = pullCommits(root);
  const resolveIntroduced = (introduced: string): string | undefined => {
    const pr = /^PR #(\d+)$/.exec(introduced);
    const name = pr === null ? introduced : pulls.get(pr[1]!);
    if (name === undefined) return undefined;
    return git(root, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`])?.trim() || undefined;
  };
  const introducedAt = new Map<string, string>();
  for (const d of states) {
    if (originOf(d.introduced) !== "fix-induced") continue;
    const sha = resolveIntroduced(d.introduced!);
    if (sha !== undefined) introducedAt.set(d.id, sha);
  }
  const placed = new Set<string>();
  const releases: Release[] = [];
  allTags.forEach((t, index) => {
    const prior = index === 0 ? undefined : allTags[index - 1];
    const range = new Set((git(root, ["rev-list", prior === undefined ? t.tag : `${prior.tag}..${t.tag}`]) ?? "").split("\n").filter((l) => l !== ""));
    const introducedHere = states.filter((d) => range.has(introducedAt.get(d.id) ?? "")).map((d) => d.id);
    for (const id of introducedHere) placed.add(id);
    if (t.at < from) return;
    const arrived = states.filter((d) => (prior === undefined || d.at > prior.at) && d.at <= t.at).length;
    const escapes = introducedHere.filter((id) => states.find((d) => d.id === id)!.at > t.at);
    const bullets = bulletsAt(root, t.tag);
    releases.push({ tag: t.tag, at: t.at, ...(prior === undefined ? {} : { since: prior.tag }), arrived, introducedHere, escapes, ...(bullets === undefined ? {} : { bullets }) });
  });
  const unplaced = states.filter((d) => originOf(d.introduced) === "fix-induced" && !placed.has(d.id)).map((d) => d.id);

  // Closing and repeats come from the same floor spec --check reports, so the two never disagree.
  const model = loadSpecModel(root);
  const floor = model.defects;
  const closedInWindow = inWindow.filter((d) => d.resolution !== undefined);
  const standing = guardStanding(model.components);
  const guarded = closedInWindow.filter((d) => d.resolution!.guard !== undefined && standing(d.resolution!.guard) === "witnessed").length;
  const decided = closedInWindow.filter((d) => d.resolution!.decision !== undefined).length - closedInWindow.filter((d) => d.resolution!.decision !== undefined && d.resolution!.guard !== undefined && standing(d.resolution!.guard) === "witnessed").length;
  const neither = closedInWindow.length - guarded - decided;
  const repeatMap = new Map<string, { allTime: number; inWindow: number }>();
  for (const g of floor?.guardFailures ?? []) {
    const entry = repeatMap.get(g.class) ?? { allTime: 0, inWindow: 0 };
    entry.allTime += 1;
    if (inWindow.some((d) => d.id === g.id)) entry.inWindow += 1;
    repeatMap.set(g.class, entry);
  }

  // Churn: commits in the window touching each file, records of the journal and runs left out.
  const churnCount = new Map<string, number>();
  for (const line of (git(root, ["log", `--since=${from}`, "--name-only", "--format=", "HEAD"]) ?? "").split("\n")) {
    if (line === "" || line.startsWith(".coherence/")) continue;
    churnCount.set(line, (churnCount.get(line) ?? 0) + 1);
  }
  const churn = [...churnCount.entries()].map(([file, commits]) => ({ file, commits })).sort((a, b) => b.commits - a.commits || a.file.localeCompare(b.file)).slice(0, 10);

  // Hook latency per event and version, from every session's kept times in the window.
  const groups = new Map<string, number[]>();
  let names: string[] = [];
  try {
    names = readdirSync(join(root, HOOK_TIMES_DIR)).filter((n) => n.endsWith(".jsonl"));
  } catch {
    names = [];
  }
  for (const name of names) {
    let text: string;
    try {
      text = readFileSync(join(root, HOOK_TIMES_DIR, name), "utf8");
    } catch {
      continue;
    }
    for (const t of parseHookTimes(text)) {
      if (t.at < from) continue;
      const key = `${t.event}\u0000${t.version ?? UNKNOWN}`;
      const list = groups.get(key) ?? [];
      list.push(t.ms);
      groups.set(key, list);
    }
  }
  const hookLatency = [...groups.entries()]
    .map(([key, ms]) => {
      const [event, version] = key.split("\u0000") as [string, string];
      const sorted = [...ms].sort((a, b) => a - b);
      return { event, version, count: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
    })
    .sort((a, b) => a.event.localeCompare(b.event) || a.version.localeCompare(b.version, undefined, { numeric: true }));

  return {
    window: { days, from: from.slice(0, 10), to: toDay.toISOString().slice(0, 10) },
    arrivals,
    days: dayList,
    releases,
    closing: {
      recordedInWindow: inWindow.length,
      closed: closedInWindow.length,
      guarded,
      decided,
      neither,
      guardedShare: closedInWindow.length === 0 ? null : guarded / closedInWindow.length,
      allTime: { recorded: floor?.recorded ?? states.length, closed: floor?.closed ?? 0, guarded: floor?.guarded ?? 0, decided: floor?.decided ?? 0 },
    },
    repeats: [...repeatMap.entries()].map(([cls, n]) => ({ class: cls, ...n })).sort((a, b) => b.allTime - a.allTime),
    unplaced,
    churn,
    hookLatency,
  };
}

function tally(record: Record<string, number>): string {
  const entries = Object.entries(record).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length === 0 ? "none" : entries.map(([k, n]) => `${k} ${n}`).join(", ");
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)} s`;

/** The reading as a compact summary. */
export function convergenceText(c: Convergence): string {
  const lines: string[] = [];
  const a = c.arrivals;
  lines.push(`Convergence over ${c.window.days} days (${c.window.from} to ${c.window.to})`);
  lines.push(`defects arriving: ${a.total}; fix-induced ${a.byOrigin["fix-induced"]}, pre-existing ${a.byOrigin["pre-existing"]}, unknown ${a.byOrigin.unknown}`);
  lines.push(`  caught by: ${tally(a.byCaught)}`);
  lines.push(`  by class: ${tally(a.byClass)}`);
  const active = c.days.filter((d) => d.total > 0);
  lines.push(`per day (with arrivals): ${active.length === 0 ? "none" : active.map((d) => `${d.date.slice(5)} ${d.total} (${d.byOrigin["fix-induced"]} fix-induced, ${d.byOrigin["pre-existing"]} pre-existing, ${d.byOrigin.unknown} unknown)`).join("; ")}`);
  if (c.releases.length === 0) lines.push("releases in the window: none");
  for (const r of c.releases) {
    const b = r.bullets === undefined ? "" : `; bullets ${r.bullets.bullets} (${r.bullets.enforced} enforced, ${r.bullets.requirements} requirements)`;
    lines.push(`release ${r.tag} ${r.at.slice(0, 10)}${r.since === undefined ? "" : ` (since ${r.since})`}: ${r.arrived} arrived, ${r.introducedHere.length} introduced in its range, ${r.escapes.length} escaped${r.escapes.length === 0 ? "" : ` (${r.escapes.join(", ")})`}${b}`);
  }
  if (c.unplaced.length > 0) lines.push(`fix-induced but placed in no release range (after the latest tag, or a commit git cannot resolve): ${c.unplaced.join(", ")}`);
  const k = c.closing;
  const share = k.guardedShare === null ? "no close yet" : `${Math.round(k.guardedShare * 100)}% guarded`;
  lines.push(`closing: ${k.closed} of ${k.recordedInWindow} closed in the window (${k.guarded} guarded, ${k.decided} decided, ${k.neither} with neither; ${share}); all time ${k.allTime.closed} of ${k.allTime.recorded} closed, ${k.allTime.guarded} guarded`);
  lines.push(`repeats (guard failures, should fall to zero): ${c.repeats.length === 0 ? "none" : c.repeats.map((r) => `${r.class} ${r.allTime} (${r.inWindow} in the window)`).join(", ")}`);
  const first = c.days.find((d) => d.bullets !== undefined)?.bullets;
  const last = [...c.days].reverse().find((d) => d.bullets !== undefined)?.bullets;
  if (first !== undefined && last !== undefined) lines.push(`bullets: ${first.bullets} at ${first.commit} -> ${last.bullets} at ${last.commit}; enforced (enforcement and kinds; refutation is in the run store, not read at a past commit) ${first.enforced} -> ${last.enforced}, requirements ${first.requirements} -> ${last.requirements}`);
  lines.push(`hotspot churn: ${c.churn.length === 0 ? "none" : c.churn.slice(0, 5).map((f) => `${f.file} ${f.commits}`).join(", ")}`);
  if (c.hookLatency.length === 0) lines.push("hook latency: no hook times kept in the window");
  for (const h of c.hookLatency) lines.push(`hook latency ${h.event} ${h.version}: p50 ${seconds(h.p50)}, p95 ${seconds(h.p95)} over ${h.count} calls`);
  lines.push("A field an old record lacks counts as unknown; nothing is inferred. --json carries every day, release and class.");
  return lines.join("\n");
}

export const CONVERGENCE_USAGE = "  query convergence [--days <n>] [--json]   defects arriving by origin and catch, escapes per release, closes with a guard, repeats per class, bullets over time, churn and hook latency per version";

/** query convergence [--days <n>] [--json] */
export function convergenceCommand(root: string, argv: readonly string[], io: { out: (line: string) => void; err: (line: string) => void }): number {
  let json = false;
  let days = DEFAULT_WINDOW_DAYS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--days" || arg.startsWith("--days=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) {
        io.err(`query convergence: --days takes a whole number of days, at least 1\n${CONVERGENCE_USAGE}`);
        return 64;
      }
      days = n;
    } else {
      io.err(`query convergence: unknown argument ${arg}\n${CONVERGENCE_USAGE}`);
      return 64;
    }
  }
  const reading = convergence(root, { days });
  io.out(json ? JSON.stringify(reading, null, 2) : convergenceText(reading));
  return 0;
}
