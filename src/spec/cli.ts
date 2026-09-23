/**
 * The spec command:
 *
 *   node src/cli.ts spec --check [root]   every component, its invariants with state, every problem; exit 1 on problems
 *   node src/cli.ts spec --json [root]    the model
 *
 * Without a flag, --check.
 */

import type { Io } from "../journal/cli.ts";
import { loadSpecModel } from "./model.ts";
import { formatReport, hasProblems } from "./report.ts";

export const SPEC_USAGE = ["  spec [--check] [root]   components, invariants with state, problems; exit 1 on problems", "  spec --json [root]      the model"].join("\n");

export function specCommand(argv: string[], io: Io): number {
  let json = false;
  let check = false;
  const positionals: string[] = [];
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg === "--check") check = true;
    else if (arg.startsWith("--")) {
      io.err(`spec: unknown flag ${arg}\n${SPEC_USAGE}`);
      return 64;
    } else positionals.push(arg);
  }
  if (positionals.length > 1) {
    io.err(`spec: one root at most; got "${positionals[1]}"\n${SPEC_USAGE}`);
    return 64;
  }
  if (json && check) {
    io.err("spec: --json or --check, not both");
    return 64;
  }
  const model = loadSpecModel(positionals[0] ?? io.cwd);
  if (json) {
    io.out(JSON.stringify(model, null, 2));
    return hasProblems(model) ? 1 : 0;
  }
  io.out(formatReport(model).trimEnd());
  return hasProblems(model) ? 1 : 0;
}
