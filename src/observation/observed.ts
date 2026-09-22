/**
 * The observed readings in plain text: the line a run prints after an
 * observed pass, and the agent query `query observed [<component>]
 * [--failures [--since <commit>]]`. Every answer names the observation's
 * commit and whether it is fresh; a stale one is labeled STALE on every
 * fact it gives, never read as current.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Io } from "../journal/cli.ts";
import { gitState } from "../journal/store.ts";
import { freshness, freshnessLabel, loadObservations, RELATION, type ObservationRecord, type ObservedInterface } from "./record.ts";

/** Lines per list before the rest is counted, so an answer stays under a few hundred tokens. */
const LIMIT = 12;

function capped<T>(items: readonly T[], render: (item: T) => string, limit = LIMIT): string[] {
  const lines = items.slice(0, limit).map(render);
  if (items.length > limit) lines.push(`  and ${items.length - limit} more`);
  return lines;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What a run prints after an observed pass. */
export function formatObservationSummary(record: ObservationRecord): string {
  const t = record.totals;
  return [
    `observation recorded in .coherence/observations/${record.session}.jsonl: ${record.source.kind} (${record.source.runner}, ${record.source.attribution}); ${plural(t.tests, "test")}, ${t.failed} failed`,
    `  component interfaces ${RELATION}: ${t.exercised} exercised, ${t.neverObserved} never observed, ${t.noBody} with no runtime body, of ${t.interfaces}; entrances ${t.entrancesExercised} of ${t.entrances} exercised`,
    `  ${record.source.note}; pass ${Math.round(record.latency.pass / 100) / 10} s, mapping ${Math.round(record.latency.map / 100) / 10} s`,
  ].join("\n");
}

function header(record: ObservationRecord, head: string | null): string[] {
  const f = freshness(record, head);
  return [
    `observation ${record.at} by ${record.agent} (${record.session.slice(0, 8)}) at ${record.commit ?? "no commit"}: ${freshnessLabel(f)}`,
    `source: ${record.source.kind} (${record.source.runner}, ${record.source.attribution}); ${plural(record.totals.tests, "test")}, ${record.totals.failed} failed; ${RELATION}, never called`,
  ];
}

function exercisedText(i: ObservedInterface, record: ObservationRecord, label: string): string {
  if (i.exercisedBy > 0) {
    const by = record.source.attribution === "per run" ? "exercised in the run (per run: no test attributed)" : `exercised by ${plural(i.exercisedBy, "test")}`;
    return `${by} (${record.commit ?? "no commit"}, ${label})`;
  }
  if (i.noBody) return `no runtime body: ${i.typeOnly ? "types only" : "types and plain values"}, which coverage cannot observe (${record.commit ?? "no commit"}, ${label})`;
  return `never observed (${record.commit ?? "no commit"}, ${label})`;
}

/** The answer to `query observed [<component>]`. */
export function answerObserved(records: readonly ObservationRecord[], head: string | null, component?: string): string {
  const record = records[records.length - 1];
  if (record === undefined) return "no observation yet: run: run --observe";
  const f = freshness(record, head);
  const label = f.fresh ? "fresh" : "stale";
  const lines = header(record, head);
  if (record.source.attribution === "none") lines.push(`nothing observed: ${record.source.note}`);
  const mine = component === undefined ? record.interfaces : record.interfaces.filter((i) => i.from === component || i.to === component);
  const exercised = mine.filter((i) => i.exercisedBy > 0).sort((a, b) => b.exercisedBy - a.exercisedBy || a.id.localeCompare(b.id));
  const never = mine.filter((i) => i.exercisedBy === 0 && !i.noBody);
  const noBody = mine.filter((i) => i.exercisedBy === 0 && i.noBody);
  lines.push(`component interfaces${component === undefined ? "" : ` of ${component}`}: ${mine.length} known; ${exercised.length} exercised, ${never.length} never observed, ${noBody.length} with no runtime body`);
  lines.push(...capped(exercised, (i) => `  ${i.id}  ${exercisedText(i, record, label)}`));
  lines.push(...capped(never, (i) => `  ${i.id}  ${exercisedText(i, record, label)}`));
  lines.push(...capped(noBody, (i) => `  ${i.id}  ${exercisedText(i, record, label)}`, component === undefined ? 4 : LIMIT));
  const entrances = component === undefined ? record.entrances : record.entrances.filter((e) => e.component === component);
  if (entrances.length === 0) lines.push(`entrances: none declared${component === undefined ? "" : ` in ${component}`}`);
  else {
    lines.push(`entrances: ${entrances.filter((e) => e.exercisedBy > 0).length} of ${entrances.length} with a handler some test executed`);
    lines.push(
      ...capped(entrances, (e) =>
        e.exercisedBy > 0
          ? `  ${e.component}/${e.name}  handler ${e.handler ?? "?"} executed by ${plural(e.exercisedBy, "test")} (${label})`
          : `  ${e.component}/${e.name}  handler ${e.handler ?? "none named"} never observed${e.reason === undefined ? "" : `: ${e.reason}`}`,
      ),
    );
  }
  return lines.join("\n");
}

/** The answer to `query observed --failures [--since <commit>]`: each failing test's three facts, kept apart. */
export function answerFailures(records: readonly ObservationRecord[], head: string | null, since?: { commit: string; changed: readonly string[] }, component?: string): string {
  const record = records[records.length - 1];
  if (record === undefined) return "no observation yet: run: run --observe";
  const lines = header(record, head);
  const failing = record.tests.filter((t) => t.verdict === "fail" && (component === undefined || (t.components ?? []).includes(component) || t.likelySite?.component === component));
  if (failing.length === 0) {
    lines.push(`no failing test in this observation${component === undefined ? "" : ` touching ${component}`}`);
    return lines.join("\n");
  }
  const changed = new Set(since?.changed ?? []);
  if (since !== undefined) lines.push(`change set since ${since.commit}: ${plural(changed.size, "file")}`);
  for (const t of failing.slice(0, LIMIT)) {
    lines.push(`✕ ${t.fullName}${t.file === undefined ? "" : ` (${t.file})`}`);
    if (t.failure !== undefined) lines.push(`  failure: ${t.failure}`);
    lines.push(`  what broke: ${t.invariants === undefined ? "no invariant names this test as its totality oracle" : t.invariants.map((i) => `invariant ${i}`).join(", ")}`);
    const s = t.likelySite;
    lines.push(
      s === undefined
        ? "  likely site: no stack frame outside test files"
        : `  likely site (evidence, not proof): ${s.file}:${s.line}${s.symbol === undefined ? "" : ` in ${s.symbol}`}${s.component === undefined ? "" : `, component ${s.component}`}${s.interfaces.length === 0 ? "" : `, carried by ${s.interfaces.join(", ")}`}`,
    );
    if (t.components === undefined) lines.push(`  region: not attributed per test (${record.source.attribution})`);
    else lines.push(`  region: components ${t.components.join(", ") || "none"}; ${RELATION} ${(t.interfaces ?? []).join(", ") || "no component interface"}`);
    if (since !== undefined) {
      const suspects = record.interfaces.filter((i) => (t.interfaces ?? []).includes(i.id) && i.files.some((file) => changed.has(file))).map((i) => i.id);
      lines.push(`  suspects since ${since.commit}: ${suspects.length === 0 ? "none: no component interface it co-executed lies in a changed file" : suspects.join(", ")}`);
    }
  }
  if (failing.length > LIMIT) lines.push(`and ${failing.length - LIMIT} more failing tests`);
  return lines.join("\n");
}

/** Files changed since a commit: the diff to the working tree, and untracked files. */
export function changedSince(root: string, commit: string): string[] | string {
  const diff = spawnSync("git", ["diff", "--name-only", commit, "--"], { cwd: root, encoding: "utf8" });
  if (diff.status !== 0) return `git diff ${commit} failed: ${diff.stderr.trim()}`;
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  return [...new Set([...diff.stdout.split("\n"), ...(untracked.status === 0 ? untracked.stdout.split("\n") : [])].filter((l) => l.trim() !== ""))].sort();
}

/** The command line for `query observed`, from the arguments after the question. */
export function observedCommand(cwd: string, args: readonly string[], io: Io): number {
  let failures = false;
  let since: string | undefined;
  let root = cwd;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--failures") failures = true;
    else if (arg === "--root" || arg === "--session") {
      // --session is accepted as every query accepts it; an observation is read whoever asks.
      if (arg === "--root") root = resolve(cwd, args[i + 1] ?? ".");
      i += 1;
    } else if (arg.startsWith("--root=")) root = resolve(cwd, arg.slice("--root=".length));
    else if (arg === "--since") {
      since = args[i + 1];
      i += 1;
      if (since === undefined) {
        io.err("query observed: --since needs a commit");
        return 64;
      }
    } else if (arg.startsWith("--since=")) since = arg.slice("--since=".length);
    else if (arg.startsWith("--")) {
      io.err(`query observed: unknown flag ${arg}`);
      return 64;
    } else positionals.push(arg);
  }
  if (since !== undefined && !failures) {
    io.err("query observed: --since compares a change set with failing tests; add --failures");
    return 64;
  }
  const component = positionals[0]?.replace(/^\.\//, "").replace(/\/+$/, "") || undefined;
  const { records } = loadObservations(root);
  const head = gitState(root).commit;
  if (!failures) {
    io.out(answerObserved(records, head, component === "" ? "." : component));
    return 0;
  }
  let sinceSet: { commit: string; changed: string[] } | undefined;
  if (since !== undefined) {
    const changed = changedSince(root, since);
    if (typeof changed === "string") {
      io.err(`query observed: ${changed}`);
      return 64;
    }
    sinceSet = { commit: since, changed };
  }
  io.out(answerFailures(records, head, sinceSet, component));
  return 0;
}
