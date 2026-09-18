/**
 * The scaffold commands:
 *
 *   node src/cli.ts scaffold component <folder> "<intent>"
 *   node src/cli.ts scaffold invariant <componentFolder> "<sentence>" [--name "<name>"] --kinds a,b [--chokepoint|--totality-oracle] [--write]
 *
 * The invariant bullet prints on stdout with every slot as a placeholder;
 * the applicable checklist shapes print on stderr as guidance. --write
 * appends the bullet to the component's spec.
 */

import { join, resolve } from "node:path";
import { JournalError, parseFlags } from "../journal/args.ts";
import type { Io } from "../journal/cli.ts";
import { loadSeed } from "../spec/seed.ts";
import { appendInvariant, confineToRoot, renderGuidance, renderInvariant, scaffoldComponent, ScaffoldError, specsIn, type Form } from "./scaffold.ts";

export const SCAFFOLD_USAGE = [
  '  scaffold component <folder> "<intent>"',
  '  scaffold invariant <componentFolder> "<sentence>" [--name "<name>"] --kinds <a,b|none> [--chokepoint|--totality-oracle] [--write]',
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

function invariantVerb(argv: string[], io: Io): void {
  const parsed = parseFlags(argv, { name: "one", kinds: "one", chokepoint: "switch", "totality-oracle": "switch", write: "switch" });
  const [folder, sentence, ...rest] = parsed.positionals;
  if (folder === undefined || sentence === undefined) usage("scaffold invariant takes a component folder and a sentence");
  if (rest.length > 0) usage(`unexpected argument "${rest[0]}"; quote the sentence`);
  if (parsed.switches.has("chokepoint") && parsed.switches.has("totality-oracle")) usage("--chokepoint or --totality-oracle, not both");
  const form: Form = parsed.switches.has("totality-oracle") ? "totality oracle" : "chokepoint";
  const dir = confineToRoot(io.cwd, folder);
  const specs = specsIn(dir);
  if (specs.length === 0) throw new ScaffoldError(`${folder} holds no spec; scaffold component ${folder} "<intent>" first`);
  const kindsText = parsed.one.get("kinds");
  const kinds =
    kindsText === undefined
      ? undefined
      : kindsText.trim() === "none"
        ? "none"
        : kindsText.split(",").map((kind) => kind.trim()).filter((kind) => kind !== "");
  const seed = loadSeed();
  const { bullet, shapes } = renderInvariant(seed, { sentence, name: parsed.one.get("name"), kinds, form });
  // Slice six: the Scope preview of the proposed structure attaches here, before the write,
  // so a human can see the new vertebra in place.
  if (parsed.switches.has("write")) {
    const specPath = join(dir, specs[0]!);
    appendInvariant(specPath, bullet);
    io.out(bullet.trimEnd());
    io.out(`appended to ${specPath}`);
  } else {
    io.out(bullet.trimEnd());
  }
  if (kinds === undefined) io.err(`no --kinds given: name the kinds of thing protected (${Object.keys(seed.kinds).join(", ")}) or none, and the checklist follows`);
  const guidance = renderGuidance(shapes);
  if (guidance !== "") io.err(guidance.trimEnd());
}

export function scaffoldCommand(argv: string[], io: Io): number {
  const [shape, ...rest] = argv;
  try {
    if (shape === "component") componentVerb(rest, io);
    else if (shape === "invariant") invariantVerb(rest, io);
    else usage(`scaffold takes "component" or "invariant"`);
    return 0;
  } catch (error) {
    if (error instanceof ScaffoldError || error instanceof JournalError) {
      io.err(`scaffold: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
