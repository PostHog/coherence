/**
 * The shared mechanics of what Coherence keeps between hook calls under
 * .coherence/cache, transient state regenerated whenever missing or torn:
 * where it lives, the version it is written under, a lock for writers, and a
 * write that never leaves a torn file. What is kept is an optimization, so a
 * keeper that cannot use it falls back to the uncached computation and says
 * why; it never answers as if what it lacked were empty.
 */

import { closeSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { codeIdentity } from "../enforcement/code-fingerprint.ts";

/** Where Coherence keeps what it can regenerate: never committed, never read as the project's. */
export function cacheDir(root: string): string {
  return join(root, ".coherence", "cache");
}

/**
 * The version a store is written under: its shape and the identity of the
 * code that made it, the modules `entries` (paths under src) import, so an
 * edit to that code discards what it kept.
 */
export function storeVersion(root: string, shape: string, entries: readonly string[]): string {
  return `${shape}@${codeIdentity(cacheDir(root), ["lifecycle/kept-parse.ts", ...entries])}`;
}

/** An aside older than this was left by a process that died before its rename. */
const ASIDE_AGE_MS = 60_000;

/** How long a writer waits for another's lock before giving up; a lock older than this is taken as abandoned. */
const LOCK_STALE_MS = 10_000;

/**
 * Run `fn` holding the lock file at `lock`: one writer at a time, created
 * exclusively, and a lock a dead writer left is taken once it is old.
 * Undefined, and `fn` not run, when the lock could not be had in that time;
 * the caller then treats what it would have written as stale.
 */
export function withLock<T>(lock: string, fn: () => T): T | undefined {
  mkdirSync(dirname(lock), { recursive: true });
  // A test sets how long a writer waits, to see what a writer that gave up leaves behind without waiting the full time.
  const wait = Number(process.env["COHERENCE_LOCK_WAIT_MS"] ?? LOCK_STALE_MS);
  const deadline = Date.now() + (Number.isFinite(wait) ? wait : LOCK_STALE_MS);
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
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

/**
 * Write `value` at `path` aside and rename it into place, so a reader sees
 * the old file or the new one, never half of one. With `sweep`, also remove
 * asides a crash left in that folder. A failure throws with `strict`, and is
 * swallowed without it, for a keeper whose next reader recomputes anyway.
 */
export function writeKept(path: string, value: unknown, sweep = false, strict = false): void {
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
  } catch (error) {
    if (strict) throw error;
  }
}
