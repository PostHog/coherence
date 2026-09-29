/**
 * The flag parser the journal verbs share.
 *
 * Each verb declares its flags with a shape: `one` takes a single value and
 * is refused if given twice, `many` collects every value in order, `switch`
 * takes no value. A value may be given as `--flag value` or `--flag=value`.
 * Anything not a flag is a positional. An unknown flag is refused rather than
 * ignored, so a typo cannot silently drop a because.
 *
 * Every flag that takes a value also takes it from a file: `--because-file
 * <path>` reads the because from that file, and `-` reads standard input, so
 * long text with quotes, apostrophes and dollar signs never meets the shell.
 * One trailing newline is dropped.
 */

import { readFileSync } from "node:fs";

export class JournalError extends Error {}

export type FlagShape = "one" | "many" | "switch";

export interface Parsed {
  positionals: string[];
  one: Map<string, string>;
  many: Map<string, string[]>;
  switches: Set<string>;
}

export function parseFlags(argv: readonly string[], spec: Record<string, FlagShape>): Parsed {
  const parsed: Parsed = { positionals: [], one: new Map(), many: new Map(), switches: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("--")) {
      parsed.positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const given = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const fromFile = spec[given] === undefined && given.endsWith("-file") && (spec[given.slice(0, -5)] === "one" || spec[given.slice(0, -5)] === "many");
    const name = fromFile ? given.slice(0, -5) : given;
    const shape = spec[name];
    if (shape === undefined) throw new JournalError(`unknown flag --${name}`);
    if (shape === "switch") {
      if (equals !== -1) throw new JournalError(`--${name} takes no value`);
      parsed.switches.add(name);
      continue;
    }
    let value: string;
    if (equals !== -1) {
      value = arg.slice(equals + 1);
    } else {
      index += 1;
      const next = argv[index];
      if (next === undefined || next.startsWith("--")) throw new JournalError(`--${given} needs a value`);
      value = next;
    }
    if (fromFile) value = readValueFile(given, value);
    if (shape === "one") {
      if (parsed.one.has(name)) throw new JournalError(`--${name} given twice; it takes one value`);
      parsed.one.set(name, value);
    } else {
      const list = parsed.many.get(name) ?? [];
      list.push(value);
      parsed.many.set(name, list);
    }
  }
  return parsed;
}

/** The text a `--<flag>-file` names: the file, or standard input for `-`, less one trailing newline. */
function readValueFile(flag: string, path: string): string {
  let text: string;
  try {
    text = readFileSync(path === "-" ? 0 : path, "utf8");
  } catch (error) {
    throw new JournalError(`--${flag} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return text.replace(/\r?\n$/, "");
}

/** A required single-value flag, refused when absent or blank. */
export function required(parsed: Parsed, name: string, meaning: string): string {
  const value = parsed.one.get(name);
  if (value === undefined || value.trim() === "") {
    throw new JournalError(`--${name} is required: ${meaning}`);
  }
  return value;
}

/** The one positional a verb takes, refused when absent or when more were given. */
export function onePositional(parsed: Parsed, meaning: string): string {
  const [first, ...rest] = parsed.positionals;
  if (first === undefined || first.trim() === "") throw new JournalError(`missing ${meaning}`);
  if (rest.length > 0) throw new JournalError(`unexpected argument "${rest[0]}"; quote the ${meaning}`);
  return first;
}
