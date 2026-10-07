/**
 * The file system, counted below the work meter: every call this process
 * makes to node:fs's reading and listing functions, synchronous, callback
 * and promise forms, while a count is open. The meter counts the work
 * Coherence routes through its own doors; this counts what reaches the file
 * system whether or not it was routed, so a read that slipped past the
 * meter's door still shows in a test.
 *
 * Named exports of a built-in are live bindings: the functions are replaced
 * on the module objects and syncBuiltinESMExports carries the replacement to
 * every module that imported them by name.
 */

import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const fs = require("node:fs") as Record<string, unknown>;
const promises = require("node:fs/promises") as Record<string, unknown>;

/** The functions counted: what reads a file's bytes, lists a folder, or asks after a path. */
export const COUNTED_SYNC = ["readFileSync", "readdirSync", "statSync", "lstatSync", "existsSync", "openSync", "readSync", "accessSync", "realpathSync"] as const;
export const COUNTED_ASYNC = ["readFile", "readdir", "stat", "lstat", "open", "access", "realpath"] as const;

export interface FsCount {
  /** Calls per function, "promises.readFile" for the promise forms. */
  calls: Record<string, number>;
  /** The paths each reading call named, as "<function> <path>". */
  paths: string[];
}

let open: FsCount | undefined;

function wrap(target: Record<string, unknown>, name: string, label: string): void {
  const original = target[name] as ((...args: unknown[]) => unknown) | undefined;
  if (typeof original !== "function" || (original as { counted?: boolean }).counted) return;
  const counted = function (this: unknown, ...args: unknown[]): unknown {
    if (open !== undefined) {
      open.calls[label] = (open.calls[label] ?? 0) + 1;
      if (typeof args[0] === "string") open.paths.push(`${label} ${args[0]}`);
    }
    return original.apply(this, args);
  };
  Object.assign(counted, original, { counted: true });
  target[name] = counted;
}

let installed = false;

/** Replace the counted functions once for this process; they count only while a count is open. */
function install(): void {
  if (installed) return;
  installed = true;
  for (const name of COUNTED_SYNC) wrap(fs, name, name);
  for (const name of COUNTED_ASYNC) wrap(fs, name, `callback.${name}`);
  for (const name of COUNTED_ASYNC) wrap(promises, name, `promises.${name}`);
  syncBuiltinESMExports();
}

/** Count every file system call `body` makes, and return the count with its result. */
export async function countingFs<T>(body: () => Promise<T>): Promise<{ value: T; fs: FsCount }> {
  install();
  const outer = open;
  const count: FsCount = { calls: {}, paths: [] };
  open = count;
  try {
    return { value: await body(), fs: count };
  } finally {
    open = outer;
  }
}
