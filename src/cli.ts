/**
 * The command line: `node src/cli.ts <verb> ...`.
 *
 * Each area of the tool exports its verbs as a record of commands; this file
 * merges them and dispatches on the first word. A command prints through the
 * process streams and returns the exit code.
 */

import { JOURNAL_USAGE, journalVerbs, type Command, type Io } from "./journal/cli.ts";

const commands: Record<string, Command> = { ...journalVerbs };

function main(argv: string[]): number {
  const [verb, ...rest] = argv;
  const io: Io = {
    cwd: process.cwd(),
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
  const command = verb === undefined ? undefined : commands[verb];
  if (command === undefined) {
    io.err(verb === undefined ? "usage: node src/cli.ts <verb> ..." : `unknown verb "${verb}"`);
    io.err(JOURNAL_USAGE);
    return 2;
  }
  return command(rest, io);
}

process.exitCode = main(process.argv.slice(2));
