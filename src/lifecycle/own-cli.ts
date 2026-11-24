/**
 * How Coherence runs itself again: the cli beside this module (cli.ts in a
 * checkout, cli.js compiled) and the node arguments every background child
 * starts with (the warm-up, the economy snapshot, the mirror refresh, the
 * telemetry flush, the version refresh, the warm server). One place, so a flag
 * a child needs, or where the cli lives, changes once. Only node: imports, so
 * any module may take it, telemetry.ts included, which version.ts imports.
 */

import { extname } from "node:path";
import { fileURLToPath } from "node:url";

/** This copy's cli, by the path this module is at; version.ts's OWN_CLI prefers the path it was invoked by when that is the same file. */
export const CLI_BESIDE = fileURLToPath(new URL(`../cli${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

/** The arguments to node that run `cli` with `args`, as every child Coherence starts runs it. */
export function cliArgs(cli: string, ...args: string[]): string[] {
  return ["--disable-warning=ExperimentalWarning", cli, ...args];
}
