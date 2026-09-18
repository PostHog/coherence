/**
 * The scaffold commands:
 *
 *   node src/cli.ts scaffold component <folder> "<intent>"
 *   node src/cli.ts scaffold invariant <componentFolder> "<sentence>" [--name "<name>"] --kinds a,b [--chokepoint|--totality-oracle] [--crossing "a -> b"] [--preview] [--write]
 *
 * The invariant bullet prints on stdout with every absent slot as a
 * placeholder; the applicable checklist shapes print on stderr as guidance.
 * --preview writes an ephemeral Scope page in the system temporary directory;
 * --write independently appends the bullet to the component's spec.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { JournalError, parseFlags } from "../journal/args.ts";
import type { Io } from "../journal/cli.ts";
import { writeStructurePreview } from "../readings/scope/build.ts";
import type { StructurePreview } from "../readings/scope/derive.ts";
import { loadSeed } from "../spec/seed.ts";
import { appendInvariant, componentDir, parseCrossing, renderGuidance, renderInvariant, scaffoldComponent, ScaffoldError, specsIn, type Form } from "./scaffold.ts";

export const SCAFFOLD_USAGE = [
  '  scaffold component <folder> "<intent>"',
  '  scaffold invariant <componentFolder> "<sentence>" [--name "<name>"] --kinds <a,b|none> [--chokepoint|--totality-oracle] [--crossing "<level> -> <level>"] [--preview] [--write]',
].join("\n");

function usage(message: string): never {
  throw new ScaffoldError(`${message}\n${SCAFFOLD_USAGE}`);
}

function componentVerb(argv: string[], io: Io): void {
  const parsed = parseFlags(argv, {});
  const [folder, intent, ...rest] = parsed.positionals;
  if (folder === undefined || intent === undefined) usage("scaffold component takes a folder and an intent");
  if (rest.length > 0) usage(`unexpected argument "${rest[0]}"; quote the intent`);
  const result = scaffoldComponent(io.cwd, folder, intent);
  io.out(`wrote ${result.path}`);
  if (resolve(io.cwd, folder) === resolve(io.cwd)) {
    io.err("this is the entry spec: add ## trust levels (one bullet per level, name: meaning) before the invariants so crossings can name them");
  }
}

function previewPath(): string {
  return join(mkdtempSync(join(tmpdir(), "coherence-scaffold-preview-")), "scope.html");
}

function invariantVerb(argv: string[], io: Io): void | Promise<void> {
  const parsed = parseFlags(argv, {
    name: "one",
    kinds: "one",
    crossing: "one",
    chokepoint: "switch",
    "totality-oracle": "switch",
    preview: "switch",
    write: "switch",
  });
  const [folder, sentence, ...rest] = parsed.positionals;
  if (folder === undefined || sentence === undefined) usage("scaffold invariant takes a component folder and a sentence");
  if (rest.length > 0) usage(`unexpected argument "${rest[0]}"; quote the sentence`);
  if (parsed.switches.has("chokepoint") && parsed.switches.has("totality-oracle")) usage("--chokepoint or --totality-oracle, not both");
  const form: Form = parsed.switches.has("totality-oracle") ? "totality oracle" : "chokepoint";
  const dir = componentDir(io.cwd, folder);
  const component = relative(resolve(io.cwd), dir).split(sep).join("/") || ".";
  const specs = specsIn(dir);
  if (specs.length === 0) throw new ScaffoldError(`${folder} holds no spec; scaffold component ${folder} "<intent>" first`);
  const crossingText = parsed.one.get("crossing");
  if (parsed.switches.has("preview") && crossingText === undefined) usage('--preview requires --crossing "<trust level> -> <trust level>"');
  const crossing = crossingText === undefined ? undefined : parseCrossing(crossingText);
  const kindsText = parsed.one.get("kinds");
  const kinds =
    kindsText === undefined
      ? undefined
      : kindsText.trim() === "none"
        ? "none"
        : kindsText.split(",").map((kind) => kind.trim()).filter((kind) => kind !== "");
  const seed = loadSeed();
  const name = parsed.one.get("name") ?? "<name>";
  const { bullet, shapes } = renderInvariant(seed, { sentence, name: parsed.one.get("name"), kinds, form, crossing });

  const finish = (outPath?: string): void => {
    if (parsed.switches.has("write")) {
      const specPath = join(dir, specs[0]!);
      appendInvariant(specPath, bullet);
      io.out(bullet.trimEnd());
      io.out(`appended to ${specPath}`);
    } else {
      io.out(bullet.trimEnd());
    }
    if (outPath !== undefined) io.out(`preview wrote ${outPath}`);
    if (kinds === undefined) io.err(`no --kinds given: name the kinds of thing protected (${Object.keys(seed.kinds).join(", ")}) or none, and the checklist follows`);
    const guidance = renderGuidance(shapes);
    if (guidance !== "") io.err(guidance.trimEnd());
  };

  if (!parsed.switches.has("preview")) {
    finish();
    return;
  }

  // Preview validation and rendering happen before the optional spec write, so
  // an invalid component or trust-level endpoint cannot leave a partial edit.
  const proposal: StructurePreview = { component, name, crossing: crossing! };
  const outPath = previewPath();
  return writeStructurePreview(io.cwd, proposal, outPath).then(
    () => finish(outPath),
    (error: unknown) => {
      throw new ScaffoldError(error instanceof Error ? error.message : String(error));
    },
  );
}

function scaffoldFailure(error: unknown, io: Io): number {
  if (error instanceof ScaffoldError || error instanceof JournalError) {
    io.err(`scaffold: ${error.message}`);
    return 1;
  }
  throw error;
}

/** Synchronous shapes return a number; preview returns the rendering promise. */
export function scaffoldCommand(argv: string[], io: Io): number | Promise<number> {
  const [shape, ...rest] = argv;
  try {
    if (shape === "component") {
      componentVerb(rest, io);
      return 0;
    }
    if (shape === "invariant") {
      const result = invariantVerb(rest, io);
      return result === undefined ? 0 : result.then(() => 0, (error: unknown) => scaffoldFailure(error, io));
    }
    usage('scaffold takes "component" or "invariant"');
  } catch (error) {
    return scaffoldFailure(error, io);
  }
}
