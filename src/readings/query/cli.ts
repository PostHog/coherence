/**
 * The agent query's command surface:
 *
 *   node src/cli.ts query <question> [args...] [--session <id>] [--root <project>]
 *
 * The state comes from the Scope builder through its one chokepoint,
 * `buildScopePage`, so the answer draws on exactly the state the page would
 * embed for the same project; the document it also renders is dropped.
 */

import { basename, resolve } from "node:path";
import type { Io } from "../../journal/cli.ts";
import { COHERENCE_GLOSSARY } from "../../lifecycle/project.ts";
import { buildScopePage } from "../scope/build.ts";
import { answer, QUERY_USAGE } from "./query.ts";

export { QUERY_USAGE };

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

export async function queryCommand(argv: string[], io: Io): Promise<number> {
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
  const { state } = await buildScopePage({ root, glossaryPath: COHERENCE_GLOSSARY, project: basename(root) });
  const result = answer(state, question, args, { session: parsed.session });
  if (result.code === 0) io.out(result.text);
  else io.err(result.text);
  return result.code;
}
