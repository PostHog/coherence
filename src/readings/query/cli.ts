/**
 * The agent query's command surface:
 *
 *   node src/cli.ts query <question> [args...] [--session <id>] [--root <project>]
 *
 * The state comes from the Scope builder through its one chokepoint,
 * `buildScopePage`, so the answer draws on exactly the state the page would
 * embed for the same project; the document it also renders is dropped. The
 * lexicon question reads the same authoritative coverage without the page
 * projection. The economy question needs the instrument: it goes to the
 * economy's own exported closure, which reaches the warm server as the run
 * does, and never to the page state.
 */

import { basename, resolve } from "node:path";
import type { Io } from "../../journal/cli.ts";
import { economyFor, queryEconomyCommand, type EconomyOf } from "../../economy/cli.ts";
import { lexiconCoverage } from "../../lifecycle/lexicon-coverage.ts";
import { COHERENCE_LEXICON } from "../../lifecycle/project.ts";
import { buildScopePage } from "../scope/build.ts";
import { readComponentInterfaces } from "../scope/component-interfaces.ts";
import { observedCommand } from "../../observation/observed.ts";
import { answer, answerLexicon, QUERY_USAGE } from "./query.ts";

export { QUERY_USAGE };

/** What the command line reaches beyond the page state; a test hands in a closure that needs no instrument. */
export interface QueryDependencies {
  economy: EconomyOf;
  /** Injectable so the full-reading route can be proved without constructing a giant fixture tree. */
  lexicon?: typeof lexiconCoverage;
  /** Injectable so the Structure question can be answered without an instrument. */
  interfaces?: typeof readComponentInterfaces;
}

export const QUERY_DEPENDENCIES: QueryDependencies = { economy: economyFor };

interface Parsed {
  positionals: string[];
  session: string | undefined;
  root: string | undefined;
}

function parse(argv: string[]): Parsed {
  const parsed: Parsed = { positionals: [], session: undefined, root: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--session" || arg === "--root") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === "--session") parsed.session = value;
      else parsed.root = value;
      i += 1;
    } else if (arg.startsWith("--session=")) parsed.session = arg.slice("--session=".length);
    else if (arg.startsWith("--root=")) parsed.root = arg.slice("--root=".length);
    else if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}`);
    else parsed.positionals.push(arg);
  }
  return parsed;
}

export async function queryCommand(argv: string[], io: Io, deps: QueryDependencies = QUERY_DEPENDENCIES): Promise<number> {
  // The observed question reads the observation store, never the page state, and takes its own flags.
  if (argv[0] === "observed") return observedCommand(io.cwd, argv.slice(1), io);
  // The economy question reads the instrument and git, never the page state, and takes its own flags (--changed, --since).
  if (argv[0] === "economy") return queryEconomyCommand(argv.slice(1), io, deps.economy);
  let parsed: Parsed;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.err(`query: ${error instanceof Error ? error.message : String(error)}\n${QUERY_USAGE}`);
    return 64;
  }
  const [question, ...args] = parsed.positionals;
  if (question === undefined) {
    io.err(`query: which question?\n${QUERY_USAGE}`);
    return 64;
  }
  const root = resolve(parsed.root ?? io.cwd);
  // Reached when --root or --session came before the question; the economy's own flags must follow it.
  if (question === "economy") return queryEconomyCommand([...args, "--root", root], io, deps.economy);
  if (question === "lexicon") {
    // Never go through buildScopePage: an omitted page term still needs full CLI access.
    const result = args.length !== 1 || args[0]!.trim() === ""
      ? { text: "query lexicon needs one term", code: 64 }
      : answerLexicon(await (deps.lexicon ?? lexiconCoverage)(root), args);
    if (result.code === 0) io.out(result.text);
    else io.err(result.text);
    return result.code;
  }
  // The page embeds a bounded window of runs and journal records; an answer reads every one.
  const { state } = await buildScopePage({
    root,
    lexiconPath: COHERENCE_LEXICON,
    project: basename(root),
    window: false,
    // Only the Structure question needs every component interface, read through the language adapter.
    ...(question === "structure" ? { componentInterfaces: await (deps.interfaces ?? readComponentInterfaces)(root) } : {}),
  });
  const result = answer(state, question, args, { session: parsed.session });
  if (result.code === 0) io.out(result.text);
  else io.err(result.text);
  return result.code;
}
