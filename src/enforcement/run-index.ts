/**
 * The latest chokepoint verdict's files, indexed so an edit never reads the
 * run history. The run store is append-only: one JSONL file per session
 * under .coherence/runs. The index keeps, per run file, the byte offset it
 * has read to, and, per chokepoint enforcement, the files its latest run saw,
 * sharded two ways under .coherence/cache/run-index:
 *
 *   key/<hash>.json    one enforcement's latest: when, from which line, its files
 *   file/<hash>.json   the enforcements whose latest run saw one file
 *   seen/<hash>.json   one run file's inode and the offset read to
 *   folder.json        the runs folder's identity when the index last held it whole
 *   names.json         the run files it held then, read only to reconcile
 *
 * An edit reads folder.json, stats the runs folder, and reads one file/
 * shard per file it wrote: never a run file, never the whole index. Every
 * append through appendRun or appendRefutation brings the index up to date
 * at once, reading only the bytes appended since. When the runs folder is not
 * the one folder.json names (a file arrived from git, or was replaced or
 * removed), the next reader reconciles: each run file is stat'd and only its
 * new bytes are read, or, when a file was replaced, truncated or removed,
 * the index is rebuilt from every file. An append made in place by
 * something other than those two (an older release, a hand edit) changes
 * no folder and is read at the next append or reconcile.
 *
 * Latest means what latestByEnforcement means: the last record in the
 * order loadRuns sorts them, by time, then by file and line.
 */

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, storeVersion, withLock, writeKept } from "../lifecycle/kept-parse.ts";

/** The shape of the index; one of another shape, or one other code made, is rebuilt. */
const INDEX_SHAPE = "run-index-1";

const RUN_FILES = join(".coherence", "runs");

interface Latest {
  at: string;
  /** The run file and the byte offset of the line, the order loadRuns breaks a tie in. */
  file: string;
  offset: number;
  files: string[];
}

interface Seen {
  ino: number;
  offset: number;
}

function hashed(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 20);
}

function indexDir(root: string): string {
  return join(cacheDir(root), "run-index");
}

function shard(root: string, kind: "key" | "file" | "seen", name: string): string {
  return join(indexDir(root), kind, `${hashed(name)}.json`);
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function folderIdentity(root: string): string | undefined {
  try {
    const s = statSync(join(root, RUN_FILES));
    return `${s.dev}:${s.ino}:${s.mtimeMs}:${s.ctimeMs}`;
  } catch {
    return undefined;
  }
}

/** Run `fn` holding the index's lock, which sits beside the index: a rebuild removes the index's folder while holding it. */
function locked<T>(root: string, fn: () => T): T | undefined {
  return withLock(join(cacheDir(root), "run-index.lock"), fn);
}

/** Whether `a` comes after `b` in loadRuns' order. */
function later(a: Latest, b: Latest | undefined): boolean {
  if (b === undefined) return true;
  if (a.at !== b.at) return a.at > b.at;
  if (a.file !== b.file) return a.file > b.file;
  return a.offset > b.offset;
}

/** Fold one line's chokepoint entries into the index: a later latest replaces the earlier, and the file shards follow. */
function fold(root: string, file: string, offset: number, line: string, parse: (line: string) => unknown): void {
  const record = parse(line) as { at?: string; kind?: string; invariants?: { component: string; name: string; form: string; files?: string[] }[] } | string;
  if (typeof record === "string" || record.kind !== undefined || !Array.isArray(record.invariants) || typeof record.at !== "string") return;
  for (const entry of record.invariants) {
    if (entry.form !== "chokepoint") continue;
    // entryKey's spelling (record.ts), which a lookup is made by.
    const key = `${entry.component}\0${entry.name}\0${entry.form}`;
    const next: Latest = { at: record.at, file, offset, files: [...new Set(entry.files ?? [])].sort() };
    const keyPath = shard(root, "key", key);
    const was = readJson<Latest>(keyPath);
    if (!later(next, was)) continue;
    writeKept(keyPath, next);
    const before = new Set(was?.files ?? []);
    const after = new Set(next.files);
    for (const seen of new Set([...before, ...after])) {
      if (before.has(seen) && after.has(seen)) continue;
      const filePath = shard(root, "file", seen);
      const keys = readJson<Record<string, true>>(filePath) ?? {};
      if (after.has(seen)) keys[key] = true;
      else delete keys[key];
      writeKept(filePath, keys);
    }
  }
}

/** Read one run file from `from` to its end, folding each whole line; the offset read to. */
function readFrom(root: string, name: string, from: number, size: number, parse: (line: string) => unknown): number {
  if (size <= from) return from;
  const fd = openSync(join(root, RUN_FILES, name), "r");
  let text: string;
  try {
    const buffer = Buffer.alloc(size - from);
    readSync(fd, buffer, 0, buffer.length, from);
    text = buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
  let offset = from;
  // Only whole lines: a line still being written is read at the next look.
  const end = text.lastIndexOf("\n");
  if (end < 0) return from;
  for (const line of text.slice(0, end + 1).split("\n")) {
    if (line.trim() !== "") fold(root, name, offset, line, parse);
    offset += Buffer.byteLength(line, "utf8") + 1;
  }
  return from + Buffer.byteLength(text.slice(0, end + 1), "utf8");
}

/**
 * Bring the index up to date with every run file: only new bytes are read,
 * unless a file was replaced, truncated or removed, or the index is of
 * another shape, when it is rebuilt from every file. Holds the lock.
 */
export function reconcileRunIndex(root: string, parse: (line: string) => unknown): void {
  locked(root, () => {
    const version = storeVersion(root, INDEX_SHAPE);
    const folder = readJson<{ version: string; identity: string | undefined }>(join(indexDir(root), "folder.json"));
    const held = readJson<string[]>(join(indexDir(root), "names.json")) ?? [];
    let names: string[];
    try {
      names = readdirSync(join(root, RUN_FILES)).filter((n) => n.endsWith(".jsonl")).sort();
    } catch {
      names = [];
    }
    const sizes = new Map<string, { ino: number; size: number }>();
    for (const name of names) {
      try {
        const s = statSync(join(root, RUN_FILES, name));
        sizes.set(name, { ino: s.ino, size: s.size });
      } catch {
        // Gone since the listing.
      }
    }
    const seen = new Map(names.map((name) => [name, readJson<Seen>(shard(root, "seen", name))]));
    const gone = held.some((name) => !sizes.has(name));
    const replaced = [...sizes].some(([name, s]) => {
      const was = seen.get(name);
      return was !== undefined && (was.ino !== s.ino || was.offset > s.size);
    });
    if (folder?.version !== version || gone || replaced) {
      rmSync(indexDir(root), { recursive: true, force: true });
      mkdirSync(indexDir(root), { recursive: true });
      seen.clear();
    }
    for (const [name, s] of sizes) {
      const from = seen.get(name)?.offset ?? 0;
      const to = readFrom(root, name, from, s.size, parse);
      if (to !== from || seen.get(name) === undefined) writeKept(shard(root, "seen", name), { ino: s.ino, offset: to } satisfies Seen);
    }
    writeKept(join(indexDir(root), "names.json"), [...sizes.keys()]);
    writeKept(join(indexDir(root), "folder.json"), { version, identity: folderIdentity(root) });
  });
}

/**
 * The chokepoint enforcements whose latest run saw each of `files`, by
 * entryKey: a stat of the runs folder, one small read to know the index
 * holds it, and one shard read per file; a reconcile first when it does not.
 */
export function latestSeeing(root: string, files: readonly string[], parse: (line: string) => unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const identity = folderIdentity(root);
  if (identity === undefined) return out;
  const folder = readJson<{ version: string; identity: string | undefined }>(join(indexDir(root), "folder.json"));
  if (folder?.identity !== identity || folder.version !== storeVersion(root, INDEX_SHAPE)) reconcileRunIndex(root, parse);
  for (const file of files) out.set(file, new Set(Object.keys(readJson<Record<string, true>>(shard(root, "file", file)) ?? {})));
  return out;
}

/** Forget the index: a test that rewrites the run files under it. */
export function dropRunIndex(root: string): void {
  rmSync(indexDir(root), { recursive: true, force: true });
}

