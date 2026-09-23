/**
 * The economy commands:
 *
 *   node src/cli.ts economy <path>... [--changed [--since <commit>]] [--json] [--limit <n>]
 *       the context closure of a change to the given files, with why each
 *       file is in it and a token estimate (bytes / 4); --changed adds the
 *       working change read from git (change.ts), --since widens it to
 *       everything from the merge base of <commit> and HEAD
 *   node src/cli.ts calibrate [--json]
 *       every read trace with a snapshot against its prediction, labeled
 *       automatically, with the aggregate by outcome
 *   node src/cli.ts mass [--json]
 *       total and unreached mass per component and for the project,
 *       unreached first
 *
 * Economy reaches the language server through the warm server, as the run
 * does, and through the same door: enforcement's withWarmAdapter. There is no
 * in-process mode on this command. Calibrate and mass need no instrument.
 */

import { resolve } from "node:path";
import { withWarmAdapter } from "../enforcement/run.ts";
import { ChangeError, workingChange, type WorkingChange } from "./change.ts";
import { JournalError, parseFlags } from "../journal/args.ts";
import type { Io } from "../journal/cli.ts";
import { calibrate, formatCalibration } from "./calibrate.ts";
import { DEFAULT_LIMIT, formatClosure, predictClosure, type Closure } from "./closure.ts";
import { computeMass, formatMass } from "./mass.ts";

export const ECONOMY_USAGE = [
  "  economy <path>... [--changed [--since <commit>]] [--json] [--limit <n>]   the context closure of a change to the given files, with a token estimate",
  "      --changed   add the working change from git: staged, unstaged, and untracked files not ignored, against HEAD",
  "      --since <commit>   add everything changed from the merge base of <commit> and HEAD to the working tree (implies --changed);",
  "                         an ancestor commit is its own merge base, and --since main is the whole change set of this branch",
  "  calibrate [--json]   read traces against the economy prediction, labeled automatically, with the aggregate by outcome",
  "  mass [--json]   total and unreached mass per component and for the project, unreached first",
].join("\n");

/**
 * The closure for a root and paths, through the warm instrument: enforcement's
 * one door (withWarmAdapter) hands the adapter over, or the reason there is
 * none; the hook's snapshot passes the adapter it already holds.
 */
export async function economyFor(root: string, paths: readonly string[], change?: WorkingChange): Promise<Closure> {
  return withWarmAdapter(root, (adapter, server, reason) => predictClosure(root, paths, { adapter, server, instrumentReason: reason, change }));
}

/** The closure the economy and query economy commands both ask for: named paths, the working change, or both. */
export type EconomyOf = (root: string, paths: readonly string[], change?: WorkingChange) => Promise<Closure>;

/**
 * The working change when --changed or --since asked for it, or the reason
 * it cannot be read. --since implies --changed: it widens the working change,
 * it never replaces it.
 */
function changeRequested(root: string, parsed: { switches: Set<string>; one: Map<string, string> }): { change: WorkingChange | undefined } | { error: string } {
  const since = parsed.one.get("since");
  if (!parsed.switches.has("changed") && since === undefined) return { change: undefined };
  try {
    return { change: workingChange(root, { since }) };
  } catch (error) {
    if (error instanceof ChangeError) return { error: error.message };
    throw error;
  }
}

export async function economyCommand(argv: string[], io: Io, economy: EconomyOf = economyFor): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(argv, { json: "switch", limit: "one", changed: "switch", since: "one" });
  } catch (error) {
    if (error instanceof JournalError) {
      io.err(`economy: ${error.message}\n${ECONOMY_USAGE}`);
      return 64;
    }
    throw error;
  }
  const fromGit = parsed.switches.has("changed") || parsed.one.has("since");
  if (parsed.positionals.length === 0 && !fromGit) {
    io.err(`economy: name at least one file, or --changed for the working change\n${ECONOMY_USAGE}`);
    return 64;
  }
  const limitText = parsed.one.get("limit");
  const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1) {
    io.err("economy: --limit takes a whole number of entries");
    return 64;
  }
  const requested = changeRequested(io.cwd, parsed);
  if ("error" in requested) {
    io.err(`economy: ${requested.error}`);
    return 1;
  }
  const closure = await economy(io.cwd, parsed.positionals, requested.change);
  io.out(parsed.switches.has("json") ? JSON.stringify(closure, null, 2) : formatClosure(closure, { limit }));
  return 0;
}

export const QUERY_ECONOMY_USAGE = "  query economy <path...> | --changed [--since <commit>]   what must be loaded to change these files, or the working change from git, safely: the economy prediction, through the instrument";

/**
 * `query economy`, answered here rather than from the page state: the named
 * paths, the working change (--changed, --since as for economy), or both, in
 * plain text. Takes the query's own --root and --session.
 */
export async function queryEconomyCommand(argv: string[], io: Io, economy: EconomyOf): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(argv, { root: "one", session: "one", changed: "switch", since: "one" });
  } catch (error) {
    if (error instanceof JournalError) {
      io.err(`query economy: ${error.message}\n${QUERY_ECONOMY_USAGE}`);
      return 64;
    }
    throw error;
  }
  if (parsed.positionals.length === 0 && !parsed.switches.has("changed") && !parsed.one.has("since")) {
    io.err(`query economy: give at least one path, or --changed for the working change\n${QUERY_ECONOMY_USAGE}`);
    return 64;
  }
  const root = resolve(parsed.one.get("root") ?? io.cwd);
  const requested = changeRequested(root, parsed);
  if ("error" in requested) {
    io.err(`query economy: ${requested.error}`);
    return 1;
  }
  io.out(formatClosure(await economy(root, parsed.positionals, requested.change)));
  return 0;
}

export function calibrateCommand(argv: string[], io: Io): number {
  let parsed;
  try {
    parsed = parseFlags(argv, { json: "switch" });
  } catch (error) {
    if (error instanceof JournalError) {
      io.err(`calibrate: ${error.message}\n${ECONOMY_USAGE}`);
      return 64;
    }
    throw error;
  }
  if (parsed.positionals.length > 0) {
    io.err(`calibrate: unexpected argument "${parsed.positionals[0]}"\n${ECONOMY_USAGE}`);
    return 64;
  }
  const report = calibrate(io.cwd);
  io.out(parsed.switches.has("json") ? JSON.stringify(report, null, 2) : formatCalibration(report));
  return 0;
}

export function massCommand(argv: string[], io: Io): number {
  let parsed;
  try {
    parsed = parseFlags(argv, { json: "switch" });
  } catch (error) {
    if (error instanceof JournalError) {
      io.err(`mass: ${error.message}\n${ECONOMY_USAGE}`);
      return 64;
    }
    throw error;
  }
  if (parsed.positionals.length > 0) {
    io.err(`mass: unexpected argument "${parsed.positionals[0]}"\n${ECONOMY_USAGE}`);
    return 64;
  }
  const report = computeMass(io.cwd);
  io.out(parsed.switches.has("json") ? JSON.stringify(report, null, 2) : formatMass(report));
  return 0;
}
