/**
 * The spec command:
 *
 *   node src/cli.ts spec --check [root]   every component, its invariants with state, every problem; exit 1 on problems
 *   node src/cli.ts spec --json [root]    the model
 *
 * Without a flag, --check. In a repository whose top's config lists
 * projects (a registry), the check at the top reads each listed project and
 * the registry, and the check in a project adds the registry's problems: a
 * config the registry does not list is adopted there but not opted in.
 */

import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { Io } from "../journal/cli.ts";
import { leafOf, registryOf, registryProblems, type Registry } from "../adapters/project-config.ts";
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
  const root = positionals[0] ?? io.cwd;
  // A registry's top is no project: its check reads each listed project and the registry itself.
  const registry = registryOf(root);
  if (registry !== undefined && !json && leafOf(registry, realOr(root)) === undefined) return registryCheck(registry, io);
  const model = loadSpecModel(root);
  if (json) {
    io.out(JSON.stringify(model, null, 2));
    return hasProblems(model) ? 1 : 0;
  }
  io.out(formatReport(model).trimEnd());
  const extra = registry === undefined ? [] : registryLines(registry);
  for (const line of extra) io.out(line);
  return hasProblems(model) || extra.length > 0 ? 1 : 0;
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The registry's problems as report lines. */
function registryLines(registry: Registry): string[] {
  return registryProblems(registry.top).map((p) => `PROBLEM  ${p.file}  ${p.message}`);
}

/** The check at a registry's top: one line per listed project with its counts, then the registry's problems; exit 1 when any has a problem. */
function registryCheck(registry: Registry, io: Io): number {
  const count = registry.leaves.length;
  io.out(`registry ${registry.path}: ${count} project${count === 1 ? "" : "s"}; the rest of the repository is outside every project`);
  let failing = false;
  for (const leaf of registry.leaves) {
    const name = relative(registry.top, leaf).split(sep).join("/");
    try {
      const model = loadSpecModel(leaf);
      const c = model.counts;
      io.out(`  ${name}: ${c.components} component${c.components === 1 ? "" : "s"}, ${c.bullets} bullet${c.bullets === 1 ? "" : "s"} (${c.invariants} invariant${c.invariants === 1 ? "" : "s"}, ${c.requirements} requirement${c.requirements === 1 ? "" : "s"}), ${c.problems} problem${c.problems === 1 ? "" : "s"}; spec --check ${name} names them`);
      failing ||= hasProblems(model);
    } catch (error) {
      io.out(`  ${name}: not readable (${error instanceof Error ? error.message : String(error)})`);
      failing = true;
    }
  }
  const lines = registryLines(registry);
  for (const line of lines) io.out(line);
  return failing || lines.length > 0 ? 1 : 0;
}
