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
 *   spawn output       the bytes a child wrote to its standard output, for
 *                      the synchronous forms and a promised execFile (a
 *                      streamed spawn, the language servers' and the warm
 *                      server's, is not counted)
 *   coverage reading   one vocabulary coverage reading (lexiconCoverage)
 *   spec model         one spec model load (loadSpecModel)
 *   server request     one request to a language server or to the warm
 *                      server (JsonRpcClient.request, LineClient.request)
 *   phrase comparison  one test of a line against one lexicon phrase in the
 *                      coverage scan, added once per reading
 *
 * Not counted here: a stat, a directory walk, a git listing's own length, and
 * Coherence's own state under .coherence (feed cursors, traces, the kept
 * parses and indexes, run records, the journal). The size tests count those
 * too, below the meter, at the file system (fs-count-fixture.ts), so a read
 * that slips past these doors still shows there.
 *
 * runHook opens the scope and closes it; a count outside any scope is one
 * comparison against undefined, so the meter costs nothing a hook can feel.
 */

import * as childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

export type { ChildProcess } from "node:child_process";

export const WORK_KINDS = ["file read", "spawn", "spawn output", "coverage reading", "spec model", "server request", "phrase comparison"] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

/** What one scope counted: a number per kind, and, for reads and spawns, what each was. */
export interface Work {
  counts: Record<WorkKind, number>;
  /** Each file read, as "<what> <path>", in order. */
  reads: string[];
  /** Each spawn, as its command line, in order. */
  spawns: string[];
  /** The bytes each command line's spawns wrote to standard output, summed by command line. */
  outputs: Record<string, number>;
}

function emptyWork(): Work {
  return { counts: Object.fromEntries(WORK_KINDS.map((k) => [k, 0])) as Record<WorkKind, number>, reads: [], spawns: [], outputs: {} };
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

/**
 * Close a scope, restore the one it replaced, and keep it as the last hook
 * call's work. The work an inner scope counted is the outer scope's too, so
 * a scope opened inside another never hides work from it.
 */
export function closeWork(scope: WorkScope): Work {
  current = scope.outer;
  if (scope.outer !== undefined) {
    for (const kind of WORK_KINDS) scope.outer.counts[kind] += scope.work.counts[kind];
    scope.outer.reads.push(...scope.work.reads);
    scope.outer.spawns.push(...scope.work.spawns);
    for (const [line, bytes] of Object.entries(scope.work.outputs)) scope.outer.outputs[line] = (scope.outer.outputs[line] ?? 0) + bytes;
  }
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

function commandLine(args: readonly unknown[]): string {
  const argv = Array.isArray(args[1]) ? (args[1] as unknown[]).map(String) : [];
  return [String(args[0]), ...argv].join(" ");
}

function countSpawn(args: readonly unknown[]): void {
  if (current === undefined) return;
  current.counts.spawn += 1;
  current.spawns.push(commandLine(args));
}

type Callable = (...args: unknown[]) => unknown;

/** The bytes a child wrote to its standard output, counted: a listing that grows with the project is work the hook pays to read. */
function countOutput(args: readonly unknown[], stdout: unknown): void {
  if (current === undefined || stdout === undefined || stdout === null) return;
  const bytes = typeof stdout === "string" ? Buffer.byteLength(stdout) : Buffer.isBuffer(stdout) ? stdout.length : 0;
  current.counts["spawn output"] += bytes;
  const line = commandLine(args);
  current.outputs[line] = (current.outputs[line] ?? 0) + bytes;
}

/** child_process.spawnSync, counted, with its output. */
export const spawnSync = ((...args: unknown[]) => {
  countSpawn(args);
  const result = (childProcess.spawnSync as Callable)(...args) as { stdout?: unknown };
  countOutput(args, result?.stdout);
  return result;
}) as typeof childProcess.spawnSync;

/** child_process.execFileSync, counted, with its output. */
export const execFileSync = ((...args: unknown[]) => {
  countSpawn(args);
  const out = (childProcess.execFileSync as Callable)(...args);
  countOutput(args, out);
  return out;
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
    value: async (...args: unknown[]) => {
      countSpawn(args);
      const result = (await promisedExecFile(...args)) as { stdout?: unknown };
      countOutput(args, result?.stdout);
      return result;
    },
  },
) as unknown as typeof childProcess.execFile;
