/**
 * scaffold import <source> [<module>...] | --all [--write]
 *
 * Drafts a spec per module from a boundary declaration file the repository
 * already keeps (boundaries.ts). Printed by default; --write creates a spec
 * only where the module's folder holds none and reports every one skipped.
 * The via: tests the drafts name print on stderr, for a human to place.
 */

import { parseFlags } from "../journal/args.ts";
import type { Io } from "../journal/cli.ts";
import { findUpward, readTach, renderDraft, renderTachTests, writeDrafts, type BoundaryModule } from "./boundaries.ts";
import { ScaffoldError } from "./scaffold.ts";

export const IMPORT_USAGE =
  "  scaffold import tach [<module>...] | --all [--write]   a draft spec per module from tach.toml (nearest at or above the root): folder, intent with product.yaml owners, a bullet per declared boundary; printed, and --write creates only specs that do not exist";

interface Source {
  file: string;
  read: (root: string, file: string) => BoundaryModule[];
  tests: (modules: readonly BoundaryModule[]) => string;
}

/** Each source a boundary draft reads, named for the tool whose file it is. */
const SOURCES: Record<string, Source> = {
  tach: {
    file: "tach.toml",
    read: readTach,
    tests: (modules) =>
      renderTachTests(
        modules.map((m) => m.id),
        new Set(modules.filter((m) => m.exposes !== undefined).map((m) => m.id)),
        new Set(modules.filter((m) => m.dependsOn !== undefined).map((m) => m.id)),
      ),
  },
};

export function importVerb(argv: string[], io: Io): void {
  const parsed = parseFlags(argv, { all: "switch", write: "switch" });
  const [sourceName, ...named] = parsed.positionals;
  if (sourceName === undefined) throw new ScaffoldError(`scaffold import takes a source: ${Object.keys(SOURCES).join(", ")}\n${IMPORT_USAGE}`);
  const source = SOURCES[sourceName];
  if (source === undefined) throw new ScaffoldError(`no boundary source is named ${JSON.stringify(sourceName)}; the sources are ${Object.keys(SOURCES).join(", ")}`);
  const all = parsed.switches.has("all");
  if (all === named.length > 0) throw new ScaffoldError(`scaffold import ${sourceName} takes module names, or --all\n${IMPORT_USAGE}`);
  const file = findUpward(io.cwd, source.file);
  if (file === undefined) throw new ScaffoldError(`no ${source.file} at or above ${io.cwd}`);
  const modules = source.read(io.cwd, file);
  const byId = new Map(modules.map((m) => [m.id, m]));
  const unknown = named.filter((n) => !byId.has(n));
  if (unknown.length > 0) throw new ScaffoldError(`${file} declares no module ${unknown.map((u) => JSON.stringify(u)).join(", ")}; it declares ${modules.length} (${modules.slice(0, 5).map((m) => m.id).join(", ")}${modules.length > 5 ? ", ..." : ""})`);
  // The root module is tach's name for code in no module: no folder of its own to draft.
  const chosen = all ? modules.filter((m) => m.id !== "<root>") : named.map((n) => byId.get(n)!);
  const drafts = chosen.map((m) => renderDraft(io.cwd, m, sourceName));
  for (const d of drafts) {
    io.out(`--- ${d.specPath ?? `${d.module.id} (outside the project)`}`);
    io.out(d.text.trimEnd());
    io.out("");
    for (const note of d.module.notes) io.err(`${d.module.id}: ${note}`);
  }
  io.err(`${drafts.length} draft${drafts.length === 1 ? "" : "s"} from ${file}. Fill every <placeholder>: the intent, because, crossing and kinds, and each protected internal. The via: tests they name:`);
  io.err(source.tests(chosen).trimEnd());
  if (!parsed.switches.has("write")) return;
  const { wrote, skipped } = writeDrafts(io.cwd, drafts);
  for (const path of wrote) io.out(`wrote ${path}`);
  for (const s of skipped) io.out(`skipped ${s.module}: ${s.because}`);
}
