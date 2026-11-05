/**
 * What the reading across worktrees has already parsed, kept in the user's
 * cache (userCacheDir) so an orient or a spec --check reads only the store
 * files that changed since the last reading. The store files are the truth
 * and this is a derivation of them: a file is taken from here only while its
 * identity (device, inode, size, modification and change time) is the one
 * it had when it was parsed, so any write to it, which always moves its
 * change time, makes it read again. An index that is missing, unreadable,
 * malformed, of another version or not this user's own answers nothing, and
 * every file is read; a write that fails leaves the reading as it was.
 *
 * Kept per repository (its first listed worktree), never in a project:
 *   files     each worktree's journal folder, each store file's identity and
 *             the digest (sha256) of its bytes
 *   contents  each digest's records, as the keys of their lines, with the
 *             line or segment number each sits at
 *   lines     each line's key (sha256 of its trimmed text) with the record
 *             it parses to, or the reason it does not
 * Only what the current files name is kept, so the index never grows past
 * the journals it derives from.
 */

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { join } from "node:path";
import { userCacheDir } from "../lifecycle/user-dir.ts";
import type { JournalRecord } from "./record.ts";

const VERSION = 1;

/** One line of a store file: the key of its trimmed text, and its 1-based number in the file. */
export type IndexedLine = [key: string, number: number];

interface IndexFile {
  version: number;
  files: Record<string, Record<string, [identity: string, digest: string]>>;
  contents: Record<string, IndexedLine[]>;
  lines: Record<string, JournalRecord | string>;
}

/** The digest a store file's bytes are known by: two files of one digest hold the same bytes, so one is parsed once. */
export function digestOf(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A line's key: the digest of its trimmed text, so a line already met in any file is the same record. */
export function lineKey(trimmed: string): string {
  return digestOf(trimmed);
}

/** A store file's identity: an append changes it, and so does any other write, which can set back a modification time but never a change time. */
export function identityOf(s: Stats): string {
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
}

export class WorktreeIndex {
  private readonly path: string | undefined;
  private readonly old: IndexFile;
  private readonly next: IndexFile = { version: VERSION, files: {}, contents: {}, lines: {} };
  private changed = false;

  private constructor(path: string | undefined, old: IndexFile | undefined) {
    this.path = path;
    this.old = old ?? { version: VERSION, files: {}, contents: {}, lines: {} };
  }

  /** The index of the repository whose first listed worktree is `main`; one that cannot be read starts empty, and `path` undefined keeps nothing. */
  static open(main: string | undefined): WorktreeIndex {
    if (main === undefined) return new WorktreeIndex(undefined, undefined);
    const path = join(userCacheDir(), "journal-index", `${digestOf(main).slice(0, 32)}.json`);
    return new WorktreeIndex(path, readOwn(path));
  }

  /** The digest of a store file whose identity is the one it was parsed at, with its lines; undefined when it must be read. */
  known(dir: string, name: string, identity: string): { digest: string; lines: IndexedLine[] } | undefined {
    const entry = this.old.files[dir]?.[name];
    if (entry === undefined || entry[0] !== identity) return undefined;
    const digest = entry[1];
    const lines = this.old.contents[digest];
    if (lines === undefined) return undefined;
    // Each digest's lines are checked and carried over once, however many worktrees hold the file.
    if (!Object.hasOwn(this.next.contents, digest)) {
      if (!lines.every(([key]) => Object.hasOwn(this.old.lines, key))) return undefined;
      this.next.contents[digest] = lines;
      for (const [key] of lines) this.next.lines[key] ??= this.old.lines[key]!;
    }
    (this.next.files[dir] ??= {})[name] = [identity, digest];
    return { digest, lines };
  }

  /** What a line's key parsed to: a record, or the reason it is none. */
  line(key: string): JournalRecord | string | undefined {
    return this.next.lines[key] ?? this.old.lines[key];
  }

  /** A store file just read and parsed: kept under its identity for the next reading. */
  record(dir: string, name: string, identity: string, digest: string, lines: IndexedLine[], parsed: ReadonlyMap<string, JournalRecord | string>): void {
    this.changed = true;
    (this.next.files[dir] ??= {})[name] = [identity, digest];
    this.next.contents[digest] = lines;
    for (const [key] of lines) this.next.lines[key] ??= parsed.get(key)!;
  }

  /** Write what this reading met, when it differs from what was read: files no longer listed drop out, and with them what only they held. */
  save(): void {
    if (this.path === undefined) return;
    const dropped = Object.entries(this.old.files).some(([dir, names]) => Object.keys(names).some((name) => this.next.files[dir]?.[name] === undefined));
    if (!this.changed && !dropped) return;
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      mkdirSync(join(this.path, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(this.next), { mode: 0o600 });
      renameSync(temporary, this.path);
    } catch {
      // The index is a derivation: one that cannot be kept leaves the next reading to read every file, as this one did.
      rmSync(temporary, { force: true });
    }
  }
}

/** The index at a path, read only when it is this user's own regular file that no one else may write. */
function readOwn(path: string): IndexFile | undefined {
  try {
    const s = lstatSync(path);
    const me = process.getuid?.();
    if (!s.isFile() || (me !== undefined && s.uid !== me) || (s.mode & 0o022) !== 0) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<IndexFile>;
    if (parsed.version !== VERSION || typeof parsed.files !== "object" || typeof parsed.contents !== "object" || typeof parsed.lines !== "object") return undefined;
    if (parsed.files === null || parsed.contents === null || parsed.lines === null) return undefined;
    return parsed as IndexFile;
  } catch {
    return undefined;
  }
}
