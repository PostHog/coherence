/**
 * The file system, counted below the work meter: every call this process
 * makes to node:fs's reading and listing functions, in synchronous, callback
 * and promise form, while a count is open. The meter counts the work
 * Coherence routes through its own doors; this counts what reaches the file
 * system whether or not it was routed, so a read that slipped past the
 * meter's door still shows in a test.
 *
 * A call that lists (readdir, recursive or not; glob; an opened directory's
 * reads) is weighed by the entries it returned, and a call that reads a
 * file's bytes (readFile in each form, readSync) by the bytes it returned,
 * not counted once: a walk of the whole project is one call and thousands of
 * entries, and a read of a growing file is one call and ever more bytes.
 *
 * Named exports of a built-in are live bindings: the functions are replaced
 * on the module objects and syncBuiltinESMExports carries the replacement to
 * every module that imported them by name.
 */

import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const fs = require("node:fs") as Record<string, unknown>;
const promises = require("node:fs/promises") as Record<string, unknown>;

/** The functions counted once per call: what reads a file's bytes or asks after a path. */
const ONCE_SYNC = ["readFileSync", "statSync", "lstatSync", "existsSync", "openSync", "readSync", "accessSync", "realpathSync"] as const;
const ONCE_ASYNC = ["readFile", "stat", "lstat", "open", "access", "realpath"] as const;
/** The functions weighed by the entries they return. */
const LISTING_SYNC = ["readdirSync", "globSync", "opendirSync"] as const;
const LISTING_ASYNC = ["readdir", "glob", "opendir"] as const;

export interface FsCount {
  /** Weight per function: calls, or for a listing the entries it returned. "promises.readdir" for the promise forms. */
  calls: Record<string, number>;
  /** The weight of each call by the path it named, as "<function> <path>". */
  paths: Record<string, number>;
}

let open: FsCount | undefined;

function tally(label: string, path: unknown, weight: number): void {
  if (open === undefined) return;
  open.calls[label] = (open.calls[label] ?? 0) + weight;
  const key = `${label} ${typeof path === "string" ? path : path instanceof URL ? path.pathname : Array.isArray(path) ? path.join(",") : "(no path)"}`;
  open.paths[key] = (open.paths[key] ?? 0) + weight;
}

/** An opened directory whose reads, each way, tally the entries they return. */
function countedDir(dir: Record<string | symbol, unknown>, label: string, path: unknown): unknown {
  const readSync = dir["readSync"] as (() => unknown) | undefined;
  if (readSync !== undefined) dir["readSync"] = function (this: unknown) {
    const entry = readSync.call(dir);
    if (entry !== null) tally(label, path, 1);
    return entry;
  };
  const read = dir["read"] as ((cb?: (e: unknown, entry: unknown) => void) => unknown) | undefined;
  if (read !== undefined) dir["read"] = function (this: unknown, cb?: (e: unknown, entry: unknown) => void) {
    if (typeof cb === "function") return read.call(dir, (e, entry) => {
      if (entry !== null && entry !== undefined) tally(label, path, 1);
      cb(e, entry);
    });
    return (read.call(dir) as Promise<unknown>).then((entry) => {
      if (entry !== null) tally(label, path, 1);
      return entry;
    });
  };
  const iterate = dir[Symbol.asyncIterator] as (() => AsyncIterator<unknown>) | undefined;
  if (iterate !== undefined) dir[Symbol.asyncIterator] = function () {
    const inner = iterate.call(dir);
    return {
      next: async () => {
        const step = await inner.next();
        if (step.done !== true) tally(label, path, 1);
        return step;
      },
      return: async (value?: unknown) => (inner.return ? inner.return(value) : { done: true, value }),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
  return dir;
}

/** The entries a listing returned, whatever its form: an array, an async iterable, or an opened directory. */
function weighed(result: unknown, label: string, path: unknown): unknown {
  if (Array.isArray(result)) {
    tally(label, path, Math.max(1, result.length));
    return result;
  }
  if (result !== null && typeof result === "object" && typeof (result as { readSync?: unknown }).readSync === "function") {
    tally(label, path, 1);
    return countedDir(result as Record<string | symbol, unknown>, label, path);
  }
  if (result !== null && typeof result === "object" && Symbol.asyncIterator in (result as object)) {
    tally(label, path, 1);
    const inner = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    return {
      next: async () => {
        const step = await inner.next();
        if (step.done !== true) tally(label, path, 1);
        return step;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
  tally(label, path, 1);
  return result;
}

type Fn = (...args: unknown[]) => unknown;

function replace(target: Record<string, unknown>, name: string, make: (original: Fn) => Fn): void {
  const original = target[name] as (Fn & { counted?: boolean }) | undefined;
  if (typeof original !== "function" || original.counted) return;
  const counted = make(original);
  Object.assign(counted, original, { counted: true });
  target[name] = counted;
}

let installed = false;

/** The paths file descriptors were opened on, so a read by descriptor is weighed under its file. */
const opened = new Map<number, string>();

function bytesOf(data: unknown): number {
  return typeof data === "string" ? Buffer.byteLength(data) : Buffer.isBuffer(data) ? data.length : 1;
}

/** Replace the counted functions once for this process; they count only while a count is open. */
function installCounting(): void {
  if (installed) return;
  installed = true;
  for (const name of ONCE_SYNC) replace(fs, name, (original) => function (this: unknown, ...args: unknown[]) {
    const result = original.apply(this, args);
    // A read is weighed by the bytes it returned, under the path it read: a read by descriptor under the path the descriptor was opened on.
    if (name === "readFileSync") tally(name, args[0], bytesOf(result));
    else if (name === "readSync") tally(name, opened.get(args[0] as number) ?? args[0], typeof result === "number" ? result : 0);
    else tally(name, args[0], 1);
    if (name === "openSync" && typeof result === "number" && typeof args[0] === "string") opened.set(result, args[0]);
    return result;
  });
  for (const name of ONCE_ASYNC) {
    replace(fs, name, (original) => function (this: unknown, ...args: unknown[]) {
      const last = args.length - 1;
      const cb = args[last];
      if (name === "readFile" && typeof cb === "function") {
        args[last] = (error: unknown, data: unknown) => {
          tally(`callback.${name}`, args[0], error ? 1 : bytesOf(data));
          (cb as Fn)(error, data);
        };
      } else tally(`callback.${name}`, args[0], 1);
      return original.apply(this, args);
    });
    replace(promises, name, (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (name === "readFile" && result instanceof Promise) return result.then((data) => (tally(`promises.${name}`, args[0], bytesOf(data)), data));
      tally(`promises.${name}`, args[0], 1);
      return result;
    });
  }
  for (const name of LISTING_SYNC) replace(fs, name, (original) => function (this: unknown, ...args: unknown[]) {
    return weighed(original.apply(this, args), name, args[0]);
  });
  for (const name of LISTING_ASYNC) {
    replace(fs, name, (original) => function (this: unknown, ...args: unknown[]) {
      const last = args.length - 1;
      const cb = args[last];
      if (typeof cb === "function") args[last] = (error: unknown, result: unknown) => (cb as Fn)(error, error ? result : weighed(result, `callback.${name}`, args[0]));
      return original.apply(this, args);
    });
    replace(promises, name, (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      return result instanceof Promise ? result.then((value) => weighed(value, `promises.${name}`, args[0])) : weighed(result, `promises.${name}`, args[0]);
    });
  }
  syncBuiltinESMExports();
}

/** Count every file system call `body` makes, and return the count with its result. */
export async function countingFs<T>(body: () => Promise<T>): Promise<{ value: T; fs: FsCount }> {
  installCounting();
  const outer = open;
  const count: FsCount = { calls: {}, paths: {} };
  open = count;
  try {
    return { value: await body(), fs: count };
  } finally {
    open = outer;
  }
}
