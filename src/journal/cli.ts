/**
 * The journal's command surface: one command per verb plus the reader.
 *
 *   node src/cli.ts decide "<chose>" [--over "<rejected>"]... --because "<why>"
 *   node src/cli.ts retract <id> --because "<what refuted it>"
 *   node src/cli.ts conjecture "<observation>" [--could-be "<candidate>"]... --discriminated-by "<test>"
 *   node src/cli.ts resolved <id> --because "<what the test showed>" [--as "<candidate>"]
 *   node src/cli.ts dismiss <id> --because "<why nobody will chase it>"
 *   node src/cli.ts defect "<what failed>" --evidence "<reproducer or report>" [--file <path>]...
 *   node src/cli.ts experiment create "<expectation>" [--context <file>]... --action "<step>"... --success "<criterion>"...
 *   node src/cli.ts experiment close <id> --result <stepId>=<pass|fail|unknown>...
 *   node src/cli.ts unable "<what you could not do>" --because "<the wall>"
 *   node src/cli.ts escalate "<what a human must see>" --because "<why a human>"
 *   node src/cli.ts acknowledge <id> --because "<what the human decided>"
 *   node src/cli.ts journal [--session <id>] [--agent <name>] [--kind <kind>] [--since <cursorOrIso>] [--json]
 *   node src/cli.ts journal --subjects [--since <cursorOrIso>]
 *   node src/cli.ts work create | move | close | owner | inspect   (see WORK_USAGE)
 *
 * Every writing verb takes --session and --agent (required). A write binds
 * to the one active work order its session owns; --work <id> names another.
 * The commands take an `Io` so tests can run them in a temporary directory
 * with a fixed clock and capture what they print.
 */

import { JournalError, parseFlags } from "./args.ts";
import { KIND_NAMES } from "./record.ts";
import { parseCursor, parseKind, renderDamaged, renderJson, renderSubjects, renderTimeline, type Filters } from "./read.ts";
import { gitBranch, loadJournal } from "./store.ts";
import {
  acknowledge,
  conjecture,
  decide,
  defect,
  dismiss,
  escalate,
  experiment,
  resolved,
  retract,
  unable,
  type Context,
  type Written,
} from "./verbs.ts";
import { WORK_USAGE, work } from "./workVerbs.ts";

export interface Io {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  now?: () => Date;
}

/** A command prints through its Io and returns the exit code. */
export type Command = (argv: string[], io: Io) => number;

function context(io: Io): Context {
  return { cwd: io.cwd, now: io.now ?? (() => new Date()) };
}

function guarded(run: (argv: string[], io: Io) => void): Command {
  return (argv, io) => {
    try {
      run(argv, io);
      return 0;
    } catch (error) {
      if (error instanceof JournalError) {
        io.err(`journal: ${error.message}`);
        return 1;
      }
      throw error;
    }
  };
}

function writing(verb: (argv: string[], ctx: Context) => Written): Command {
  return guarded((argv, io) => {
    for (const line of verb(argv, context(io)).lines) io.out(line);
  });
}

const read: Command = guarded((argv, io) => {
  const parsed = parseFlags(argv, {
    session: "one",
    agent: "one",
    kind: "one",
    json: "switch",
    subjects: "switch",
    since: "one",
  });
  if (parsed.positionals.length > 0) throw new JournalError(`journal takes no positional; got "${parsed.positionals[0]}"`);
  const filters: Filters = {};
  const session = parsed.one.get("session");
  const agent = parsed.one.get("agent");
  const kind = parsed.one.get("kind");
  if (session !== undefined) filters.session = session;
  if (agent !== undefined) filters.agent = agent;
  if (kind !== undefined) filters.kind = parseKind(kind);
  const loaded = loadJournal(io.cwd);
  const sinceText = parsed.one.get("since");
  const since = sinceText === undefined ? null : parseCursor(sinceText);
  let lines: string[];
  if (parsed.switches.has("subjects")) {
    lines = renderSubjects(loaded, since, filters);
  } else if (parsed.switches.has("json")) {
    if (since !== null) throw new JournalError("--since goes with the timeline or --subjects, not --json");
    lines = [renderJson(loaded, filters, gitBranch(io.cwd))];
  } else {
    lines = renderTimeline(loaded, filters, since);
  }
  for (const line of lines) io.out(line);
  for (const line of renderDamaged(loaded.damaged)) io.err(line);
});

const workCommand: Command = guarded((argv, io) => {
  for (const line of work(argv, context(io)).lines) io.out(line);
});

export const journalVerbs: Record<string, Command> = {
  work: workCommand,
  decide: writing(decide),
  retract: writing(retract),
  conjecture: writing(conjecture),
  resolved: writing(resolved),
  dismiss: writing(dismiss),
  defect: writing(defect),
  experiment: writing(experiment),
  unable: writing(unable),
  escalate: writing(escalate),
  acknowledge: writing(acknowledge),
  journal: read,
};

export const JOURNAL_USAGE = [
  WORK_USAGE,
  "journal verbs (each needs --session <id> --agent <name>; a write binds to the one active order its session owns, or to --work <id>):",
  '  decide "<chose>" [--over "<rejected>"]... --because "<why>"',
  '  retract <id> --because "<what refuted it>"',
  '  conjecture "<observation>" [--could-be "<candidate>"]... --discriminated-by "<test>"',
  '  resolved <id> --because "<what the test showed>" [--as "<candidate>"]',
  '  dismiss <id> --because "<why nobody will chase it>"',
  '  defect "<what failed>" --evidence "<reproducer or report>" [--file <path>]...',
  '  experiment create "<expectation>" [--context <file>]... --action "<step>"... --success "<criterion>"...',
  "  experiment close <id> --result <stepId>=<pass|fail|unknown>...",
  '  unable "<what you could not do>" --because "<the wall>"',
  '  escalate "<what a human must see>" --because "<why a human>"',
  '  acknowledge <id> --because "<what the human decided>"',
  `  journal [--session <id>] [--agent <name>] [--kind <${KIND_NAMES.join("|")}>] [--since <cursorOrIso>] [--json]`,
  "  journal --subjects [--since <cursorOrIso>]",
].join("\n");
