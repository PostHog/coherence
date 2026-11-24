// Kept apart from gaps.ts, which re-exports it, so a hook that only starts a background run loads none of the structure reading.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn } from "../../lifecycle/work-meter.ts";
import { writeAtomically } from "./shared-structure.ts";

export const STRUCTURE_DIR = join(".coherence", "structure");

interface RefreshMark {
  pid: number;
  at: string;
  fingerprint: string;
  /** Set by a run that found no language server loaded: the same fingerprint is tried again only when its slot's retry says a server now is. */
  noServer?: boolean;
  /** With noServer: the warm servers recorded when the run found the one it needed missing, so a retry asks for one recorded since. */
  servers?: number[];
}

/** How long a refresh may run before another may start in its place. */
const REFRESH_STALE_MS = 30 * 60 * 1000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function refreshPath(root: string): string {
  return join(root, STRUCTURE_DIR, "refresh.json");
}

/** Where a background run keeps its mark, and the end of the command line that runs it: one slot per kind of run. */
export interface RefreshSlot {
  path: string;
  command: RegExp;
  /** Whether a run of the same fingerprint that found no server loaded is worth starting again, asked only then with its mark; never, when absent. */
  retry?: ((mark: { servers?: number[] | undefined }) => boolean) | undefined;
}

// The question ends the command line, as refreshInBackground spawns it: a test runner whose name pattern merely spells it is no structure query.
const STRUCTURE_QUERY = /(?:^|\s)query\s+structure(?:\s+--warm-only)?\s*$/;

function readMark(path: string): RefreshMark | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RefreshMark;
  } catch {
    return undefined;
  }
}

function markUnderWay(mark: RefreshMark | undefined, now: () => number): RefreshMark | undefined {
  if (mark === undefined) return undefined;
  return alive(mark.pid) && now() - Date.parse(mark.at) < REFRESH_STALE_MS ? mark : undefined;
}

/** Give up the slot a run held, so the same tree or patch is tried again: a warm-only run that found no server loaded read nothing it should be refused a retry for. */
export function releaseRefresh(pid: number, slotPath: string): void {
  try {
    if (readMark(slotPath)?.pid === pid) rmSync(slotPath, { force: true });
  } catch {
    return;
  }
}

/**
 * Keep the slot a run held, marked as having found no language server
 * loaded: the same fingerprint is not started again while none is, and is
 * once its slot's retry says one is.
 */
export function refreshFoundNoServer(pid: number, slotPath: string, servers?: readonly number[]): void {
  try {
    const mark = readMark(slotPath);
    if (mark?.pid === pid) writeAtomically(slotPath, JSON.stringify({ ...mark, noServer: true, ...(servers === undefined ? {} : { servers: [...servers] }) } satisfies RefreshMark));
  } catch {
    return;
  }
}

/** Keep the structure refresh's slot, marked as having found a server it needed missing while these warm servers were recorded. */
export function structureRefreshFoundNoServer(root: string, pid: number, servers: readonly number[]): void {
  refreshFoundNoServer(pid, refreshPath(root), servers);
}

/**
 * The structure refresh's slot, tried again for the same tree once a warm
 * server is recorded that was not when a run found the one it needed
 * missing: a stop on an unchanged tree with no new server starts nothing.
 */
export function structureRefreshSlot(root: string, recorded: () => readonly number[]): RefreshSlot {
  return { path: refreshPath(root), command: STRUCTURE_QUERY, retry: (mark) => recorded().some((pid) => !(mark.servers ?? []).includes(pid)) };
}

/** The refresh under way, when one is alive and young enough to still count; undefined otherwise. */
export function refreshUnderWay(root: string, now: () => number = Date.now): RefreshMark | undefined {
  return markUnderWay(readMark(refreshPath(root)), now);
}

/**
 * Stop a refresh reading a tree that is no longer the tree: its reading could
 * never be kept (recordReading refuses a tree that moved), so it only holds
 * the one slot. Only a process whose command line ends as the slot's own
 * run does is signalled, so a reused pid is never touched; its whole group
 * goes, the language server with it.
 */
function supersede(pid: number, ownCommand: RegExp): boolean {
  try {
    const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 });
    if (!ownCommand.test(command)) return false;
  } catch {
    return false;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Start one reading in the background so a later session has the gaps:
 * detached, its output discarded, never waited on. One at a time: nothing
 * starts while a refresh of this same tree is alive, and a live refresh of an
 * older tree is superseded (df-84db9e4f: the tree a session leaves at its stop
 * is the one the next session starts on). Never twice for the same tree (a
 * reading that could not finish is not retried until the tree changes).
 * `command` is the argv that records a reading (the CLI's query structure);
 * `slot` is the structure refresh's own unless another kind of run passes its
 * mark and command line. A run that found no server loaded is started again
 * for the same tree only when the slot's retry says one now is. Returns
 * whether one started.
 */
export function refreshInBackground(root: string, command: readonly string[], fingerprint: string, now: () => number = Date.now, slot: RefreshSlot = { path: refreshPath(root), command: STRUCTURE_QUERY }): boolean {
  try {
    const mark = readMark(slot.path);
    if (mark !== undefined) {
      if (mark.fingerprint === fingerprint && !(mark.noServer === true && slot.retry?.(mark) === true)) return false;
      // A run that marked its slot as having found no server has finished reading, so it holds the slot no longer while it exits.
      if (mark.noServer !== true && markUnderWay(mark, now) !== undefined && !supersede(mark.pid, slot.command)) return false;
    }
    const [program, ...args] = command;
    if (program === undefined) return false;
    const child = spawn(program, args, { cwd: root, detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    if (child.pid === undefined) return false;
    writeAtomically(slot.path, JSON.stringify({ pid: child.pid, at: new Date(now()).toISOString(), fingerprint } satisfies RefreshMark));
    return true;
  } catch {
    return false;
  }
}
