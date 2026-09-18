/**
 * The economy commands:
 *
 *   node src/cli.ts economy <path>... [--json] [--limit <n>] [--no-server]
 *       the context closure of a change to the given files, with why each
 *       file is in it and a token estimate (bytes / 4)
 *   node src/cli.ts calibrate [--json]
 *       every read trace with a snapshot against its prediction, labeled
 *       automatically, with the aggregate by outcome
 *   node src/cli.ts mass [--json]
 *       total and unreached mass per component and for the project,
 *       unreached first
 *
 * Economy reaches the language server through the warm server, as the run
 * does; --no-server drives the adapter in this process. Calibrate and mass
 * need no instrument.
 */

import { adapterFor } from "../adapters/index.ts";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { JournalError, parseFlags } from "../journal/args.ts";
import type { Io } from "../journal/cli.ts";
import { calibrate, formatCalibration } from "./calibrate.ts";
import { DEFAULT_LIMIT, formatClosure, predictClosure, type Closure } from "./closure.ts";
import { computeMass, formatMass } from "./mass.ts";

export const ECONOMY_USAGE = [
  "  economy <path>... [--json] [--limit <n>]   the context closure of a change to the given files, with a token estimate",
  "  calibrate [--json]   read traces against the economy prediction, labeled automatically, with the aggregate by outcome",
  "  mass [--json]   total and unreached mass per component and for the project, unreached first",
].join("\n");

interface Instrument {
  adapter: LanguageAdapter | undefined;
  server: "cold" | "warm" | undefined;
  reason: string | undefined;
  close: () => Promise<void>;
}

/**
 * The adapter a command reads references through. The warm server is reached
 * only through performRun (the enforcement component's chokepoint over
 * connectAdapter), which economy cannot use, so economy drives the adapter in
 * this process until enforcement opens a door for readings beside the run;
 * the hook's snapshot passes the adapter it already holds.
 */
async function instrumentFor(root: string): Promise<Instrument> {
  const direct = adapterFor(readEnforcementConfig(root).language, root);
  const state = await direct.ready();
  if (!state.ok) {
    await direct.close();
    return { adapter: undefined, server: undefined, reason: state.reason, close: async () => {} };
  }
  return { adapter: direct, server: "cold", reason: undefined, close: () => direct.close() };
}

/** The closure for a root and paths, through whichever instrument answers. */
export async function economyFor(root: string, paths: readonly string[]): Promise<Closure> {
  const instrument = await instrumentFor(root);
  try {
    return await predictClosure(root, paths, { adapter: instrument.adapter, server: instrument.server, instrumentReason: instrument.reason });
  } finally {
    await instrument.close();
  }
}

export async function economyCommand(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(argv, { json: "switch", limit: "one" });
  } catch (error) {
    if (error instanceof JournalError) {
      io.err(`economy: ${error.message}\n${ECONOMY_USAGE}`);
      return 64;
    }
    throw error;
  }
  if (parsed.positionals.length === 0) {
    io.err(`economy: name at least one file\n${ECONOMY_USAGE}`);
    return 64;
  }
  const limitText = parsed.one.get("limit");
  const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1) {
    io.err("economy: --limit takes a whole number of entries");
    return 64;
  }
  const closure = await economyFor(io.cwd, parsed.positionals);
  io.out(parsed.switches.has("json") ? JSON.stringify(closure, null, 2) : formatClosure(closure, { limit }));
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
