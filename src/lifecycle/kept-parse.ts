/**
 * Parses kept across hook calls. A hook is a fresh process each time, so a
 * parse it needs of every spec or practice file would read every one of them
 * at every tool call. Kept here, a file's parse is reused while its content
 * is the same, and only a file whose content changed is read again, through
 * the work meter's door.
 *
 * What the content is comes from git, not from a stat: a file git tracks
 * and reports clean is named by its blob id, and a file git reports
 * modified, deleted or untracked is read and named by the hash of its text.
 * git decides clean the way it decides for a commit, comparing the change
 * time and the content where a stat could lie, so a file rewritten to the
 * same size with its modification time set back is read again. Outside git
 * every file is read and hashed.
 *
 * Every store is keyed by Coherence's code identity (code-fingerprint.ts),
 * so a release that changes a parser never serves a parse the old one made.
 * Stores are transient state under .coherence/cache, regenerated whenever
 * missing or torn; each is written aside and renamed into place, so two
 * hooks at once never leave a torn one, and an aside a crash left behind is
 * removed by the next write.
 */

import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { codeIdentity } from "../enforcement/code-fingerprint.ts";
import { readProjectText, spawnSync, type ReadKind } from "./work-meter.ts";

/** Where Coherence keeps what it can regenerate: never committed, never read as the project's. */
export function cacheDir(root: string): string {
  return join(root, ".coherence", "cache");
}

/** The hash a text is named by when git cannot name it. */
export function textId(text: string): string {
  return "sha256:" + createHash("sha256").update(text).digest("hex");
}

/** One listed file: its project-relative path, what its content is named, and its text when it had to be read to name it. */
export interface Listed {
  rel: string;
  id: string;
  text?: string;
}

/**
 * The files git lists under `pathspecs` (tracked, and untracked but not
 * ignored), each named by its content: two git spawns, and a read of each
 * file git reports changed, unless `named` says only its presence is asked.
 * Undefined when git cannot answer (no repository).
 */
export function listedContent(root: string, pathspecs: readonly string[], what: ReadKind, named: (rel: string) => boolean = () => true): Listed[] | undefined {
  const staged = spawnSync("git", ["ls-files", "--stage", "-z", "--", ...pathspecs], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (staged.status !== 0) return undefined;
  const changed = spawnSync("git", ["ls-files", "--modified", "--deleted", "--others", "--exclude-standard", "-z", "--", ...pathspecs], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (changed.status !== 0) return undefined;
  const dirty = new Set(changed.stdout.split("\0").filter((f) => f !== ""));
  const blobs = new Map<string, string>();
  for (const entry of staged.stdout.split("\0")) {
    const match = /^(\d+) ([0-9a-f]+) (\d)\t(.+)$/s.exec(entry);
    if (match === null) continue;
    // A gitlink is a nested checkout, not a file of this project; an unmerged path is read.
    if (match[1] === "160000") continue;
    if (match[3] !== "0") dirty.add(match[4]!);
    else blobs.set(match[4]!, `blob:${match[2]}`);
  }
  const out: Listed[] = [];
  for (const rel of [...new Set([...blobs.keys(), ...dirty])].sort()) {
    if (!dirty.has(rel)) {
      out.push({ rel, id: blobs.get(rel)! });
      continue;
    }
    // A file only its presence is asked of is never read.
    if (!named(rel)) {
      if (existsSync(join(root, rel))) out.push({ rel, id: "present" });
      continue;
    }
    try {
      const text = readProjectText(join(root, rel), what);
      out.push({ rel, id: textId(text), text });
    } catch {
      // Deleted, or no longer a file: not listed.
    }
  }
  return out;
}

/** Every file in `rels`, read and named by its text: the answer outside git. */
export function readContent(root: string, rels: readonly string[], what: ReadKind): Listed[] {
  return rels.flatMap((rel) => {
    try {
      const text = readProjectText(join(root, rel), what);
      return [{ rel, id: textId(text), text }];
    } catch {
      return [];
    }
  });
}

interface Kept<T> {
  version: string;
  files: Record<string, { id: string; value: T }>;
}

/** Where a store is kept. */
export function keptParsePath(root: string, store: string): string {
  return join(cacheDir(root), `${store}.json`);
}

/**
 * The version a store is written under: its parse's shape and the identity
 * of the code that made it, the modules `entries` (paths under src) import
 * and this one, so an edit to a parser discards what it parsed.
 */
export function storeVersion(root: string, shape: string, entries: readonly string[]): string {
  return `${shape}@${codeIdentity(cacheDir(root), ["lifecycle/kept-parse.ts", ...entries])}`;
}

function loadKept<T>(path: string, version: string): Kept<T> {
  try {
    const kept = JSON.parse(readFileSync(path, "utf8")) as Kept<T>;
    if (kept.version === version && typeof kept.files === "object" && kept.files !== null) return kept;
  } catch {
    // Missing or torn: every file is read again, and the store is written whole.
  }
  return { version, files: {} };
}

/** An aside older than this was left by a process that died before its rename. */
const ASIDE_AGE_MS = 60_000;

/** How long a writer waits for another's lock before taking it as abandoned. */
const LOCK_STALE_MS = 10_000;

/**
 * Run `fn` holding the lock file at `lock`: one writer at a time, created
 * exclusively, and a lock a dead writer left is taken once it is old.
 * Undefined, and `fn` not run, when the lock could not be had in that time.
 */
export function withLock<T>(lock: string, fn: () => T): T | undefined {
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + LOCK_STALE_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true });
      } catch {
        // Released meanwhile.
      }
      if (Date.now() > deadline) return undefined;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Write `value` at `path` aside and rename it into place; with `sweep`, also remove asides a crash left in that folder. */
export function writeKept(path: string, value: unknown, sweep = false): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const aside = `${path}.${process.pid}.tmp`;
    writeFileSync(aside, typeof value === "string" ? value : JSON.stringify(value));
    renameSync(aside, path);
    if (!sweep) return;
    const now = Date.now();
    for (const name of readdirSync(dirname(path))) {
      if (!name.startsWith(basename(path) + ".") || !name.endsWith(".tmp")) continue;
      const left = join(dirname(path), name);
      try {
        if (now - statSync(left).mtimeMs > ASIDE_AGE_MS) rmSync(left, { force: true });
      } catch {
        // Already gone.
      }
    }
  } catch {
    // Without the store the next call reads again; nothing is lost but time.
  }
}

/**
 * The parse of each listed file, reused from the store while its content id
 * is the one the parse was made from, and made now from the file's text
 * otherwise (the text the listing read, or read now). The store keeps
 * exactly the files listed. `shape` names the parse's shape and `code` the
 * modules (paths under src) whose import closure makes it.
 */
export function keptParses<T>(root: string, store: string, shape: string, code: readonly string[], listed: readonly Listed[], what: ReadKind, parse: (text: string, rel: string) => T): Map<string, T> {
  const path = keptParsePath(root, store);
  const version = storeVersion(root, shape, code);
  const kept = loadKept<T>(path, version);
  const out = new Map<string, T>();
  const next: Kept<T> = { version, files: {} };
  let moved = Object.keys(kept.files).length !== listed.length;
  for (const file of listed) {
    const held = kept.files[file.rel];
    if (held !== undefined && held.id === file.id) {
      out.set(file.rel, held.value);
      next.files[file.rel] = held;
      continue;
    }
    let value: T;
    try {
      value = parse(file.text ?? readProjectText(join(root, file.rel), what), file.rel);
    } catch {
      moved = true;
      continue;
    }
    // Kept as JSON gives it back, so a parse read from the store and one made now are the same value.
    value = JSON.parse(JSON.stringify(value)) as T;
    out.set(file.rel, value);
    next.files[file.rel] = { id: file.id, value };
    moved = true;
  }
  if (moved) writeKept(path, next, true);
  return out;
}
