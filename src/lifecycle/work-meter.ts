/**
 * The work meter: a count of the expensive work one hook call does, kept in
 * process and scoped to that call, so a test can hold a hook to a number of
 * reads, spawns and readings where a timing would flake and would miss scale.
 *
 * What it counts, each at the one place that work passes:
 *   file read          a project file's content read for a reading: the
 *                      corpus (readCorpus), the spec model's spec, practice
 *                      and handler files, practice delivery's practice files,
 *                      the file an edit names (readProjectText)
 *   spawn              a child process, git or any other (every module but
 *                      this one takes child_process from here)
 *   coverage reading   one vocabulary coverage reading (lexiconCoverage)
 *   spec model         one spec model load (loadSpecModel)
 *   server request     one request to a language server or to the warm
 *                      server (JsonRpcClient.request, LineClient.request)
 *   phrase comparison  one test of a line against one lexicon phrase in the
 *                      coverage scan, added once per reading
 *
 * Not counted: a stat, a directory walk, a git listing's own length, and
 * Coherence's own state under .coherence (feed cursors, traces, the kept
 * parses, run records, the journal). They are named here so a reader knows
 * what a count of zero does not say.
 *
 * runHook opens the scope and closes it; a count outside any scope is one
 * comparison against undefined, so the meter costs nothing a hook can feel.
 */

import * as childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

export type { ChildProcess } from "node:child_process";

export const WORK_KINDS = ["file read", "spawn", "coverage reading", "spec model", "server request", "phrase comparison"] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

/** What one scope counted: a number per kind, and, for reads and spawns, what each was. */
export interface Work {
  counts: Record<WorkKind, number>;
  /** Each file read, as "<what> <path>", in order. */
  reads: string[];
  /** Each spawn, as its command line, in order. */
  spawns: string[];
}

function emptyWork(): Work {
  return { counts: Object.fromEntries(WORK_KINDS.map((k) => [k, 0])) as Record<WorkKind, number>, reads: [], spawns: [] };
}

let current: Work | undefined;
let lastHook: Work | undefined;

/** A scope opened: the work it counts and the scope it replaced, restored when it closes. */
export interface WorkScope {
  work: Work;
  outer: Work | undefined;
}

/** Open a scope; work counted until it closes is its own. runHook is the one caller outside the tests. */
export function openWork(): WorkScope {
  const scope = { work: emptyWork(), outer: current };
  current = scope.work;
  return scope;
}

/** Close a scope, restore the one it replaced, and keep it as the last hook call's work. */
export function closeWork(scope: WorkScope): Work {
  current = scope.outer;
  lastHook = scope.work;
  return scope.work;
}

/** The work the last closed scope counted: the last hook call's, for a test that ran one. */
export function lastHookWork(): Work | undefined {
  return lastHook;
}

/** Count `n` of one kind in the open scope; nothing when none is open. */
export function countWork(kind: WorkKind, n = 1): void {
  if (current === undefined) return;
  current.counts[kind] += n;
}

/** Whether a scope is open, so a caller builds a label only when one will be kept. */
export function metering(): boolean {
  return current !== undefined;
}

function countRead(what: string, path: string): void {
  if (current === undefined) return;
  current.counts["file read"] += 1;
  current.reads.push(`${what} ${path}`);
}

/** What a read is for: the corpus of a reading, a spec, a practice, a source file the spec model or an edit names. */
export type ReadKind = "corpus" | "spec" | "practice" | "source" | "record";

/** The door a reading reads a project file's text through, counted. */
export function readProjectText(path: string, what: ReadKind): string {
  countRead(what, path);
  return readFileSync(path, "utf8");
}

/** The same door, asynchronous. */
export function readProjectTextAsync(path: string, what: ReadKind): Promise<string> {
  countRead(what, path);
  return readFile(path, "utf8");
}

function countSpawn(args: readonly unknown[]): void {
  if (current === undefined) return;
  current.counts.spawn += 1;
  const argv = Array.isArray(args[1]) ? (args[1] as unknown[]).map(String) : [];
  current.spawns.push([String(args[0]), ...argv].join(" "));
}

type Callable = (...args: unknown[]) => unknown;

/** child_process.spawnSync, counted. */
export const spawnSync = ((...args: unknown[]) => {
  countSpawn(args);
  return (childProcess.spawnSync as Callable)(...args);
}) as typeof childProcess.spawnSync;

/** child_process.execFileSync, counted. */
export const execFileSync = ((...args: unknown[]) => {
  countSpawn(args);
  return (childProcess.execFileSync as Callable)(...args);
}) as typeof childProcess.execFileSync;

/** child_process.spawn, counted. */
export const spawn = ((...args: unknown[]) => {
  countSpawn(args);
  return (childProcess.spawn as Callable)(...args);
}) as typeof childProcess.spawn;

const promisedExecFile = promisify(childProcess.execFile) as unknown as Callable;

/** child_process.execFile, counted; promisify of it resolves to { stdout, stderr } as the original's does. */
export const execFile = Object.defineProperty(
  (...args: unknown[]) => {
    countSpawn(args);
    return (childProcess.execFile as Callable)(...args);
  },
  promisify.custom,
  {
    value: (...args: unknown[]) => {
      countSpawn(args);
      return promisedExecFile(...args);
    },
  },
) as unknown as typeof childProcess.execFile;
