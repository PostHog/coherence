/**
 * Where the journal lives and how it is read back.
 *
 * Sealed shards per session under .coherence/journal (shards.ts), beside the
 * legacy one-file-per-session files. A write appends one record and never
 * rewrites; a read merges every store file into one timeline ordered by
 * time. A line that will not parse is reported with its file and
 * line number and skipped, never silently dropped: a crashed write leaves a
 * partial last line, and the reader must say so rather than hide it.
 */

import { execFileSync } from "../lifecycle/work-meter.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { appendWhole, storeLines } from "./append.ts";
import { JournalError } from "./args.ts";
import { isKind, type JournalRecord } from "./record.ts";
import { shardFor } from "./shards.ts";
import { isStoreFile, storeDir } from "./stores.ts";
import { SESSION_TOKEN, workBinding } from "./work.ts";

export const JOURNAL_DIR = storeDir("journal");

export function journalDir(cwd: string): string {
  return join(cwd, JOURNAL_DIR);
}

export function sessionFile(cwd: string, session: string): string {
  if (!SESSION_TOKEN.test(session)) {
    throw new JournalError(
      `session "${session}" cannot name a file; use letters, digits, dot, dash, or underscore`,
    );
  }
  return join(journalDir(cwd), `${session}.jsonl`);
}

/**
 * Append one record as one line, and settle its work order binding here,
 * where every write passes: a --work flag names the order, otherwise the one
 * active order the session owns binds, otherwise the record says why nothing
 * does. The file and directory are created on first write. Returns the
 * record as written.
 */
export function appendRecord(cwd: string, record: JournalRecord): JournalRecord {
  return appendRecordTo(cwd, record).record;
}

/** appendRecord, with the shard the record went to, relative to the project root. */
export function appendRecordTo(cwd: string, record: JournalRecord): { record: JournalRecord; file: string } {
  sessionFile(cwd, record.session);
  const bound: JournalRecord = { ...record, ...workBinding(cwd, record.session, record.work) };
  mkdirSync(journalDir(cwd), { recursive: true });
  const shard = shardFor(cwd, "journal", record.session);
  appendWhole(shard.file, `${JSON.stringify(bound)}\n`);
  shard.kept();
  return { record: bound, file: join(JOURNAL_DIR, shard.name) };
}

export interface Damaged {
  file: string;
  line: number;
  reason: string;
}

export interface Loaded {
  /** Every readable record across every session, oldest first. */
  records: JournalRecord[];
  damaged: Damaged[];
}

/** Records order by time, then id, so two writers in the same millisecond still have one order. */
export function compareRecords(a: JournalRecord, b: JournalRecord): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function loadJournal(cwd: string): Loaded {
  return loadJournalFiles(cwd);
}

/**
 * Each session file of the journal with its identity: device, inode, size,
 * modification and change time. An append changes it, and so does any other
 * write, which can set back a modification time but never a change time.
 */
export function journalFileKeys(cwd: string): Map<string, string> {
  const dir = journalDir(cwd);
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter(isStoreFile).sort()) {
    try {
      const s = statSync(join(dir, name));
      out.set(name, `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`);
    } catch {
      // Gone since the listing: no records to read.
    }
  }
  return out;
}

/** The journal's records, from every session file or only the ones `names` lists, in one timeline. */
export function loadJournalFiles(cwd: string, names?: readonly string[]): Loaded {
  const dir = journalDir(cwd);
  const loaded: Loaded = { records: [], damaged: [] };
  if (!existsSync(dir)) return loaded;
  const files = (names ?? readdirSync(dir))
    .filter(isStoreFile)
    .sort();
  const seen = new Set<string>();
  for (const name of files) {
    const file = join(dir, name);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      // A file listed and gone, or unreadable: said, never read as a file with no records.
      if (names === undefined) throw error;
      loaded.damaged.push({ file: join(JOURNAL_DIR, name), line: 0, reason: `not read: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    for (const { line, number } of storeLines(text, seen)) {
      const verdict = parseLine(line);
      if (typeof verdict === "string") {
        loaded.damaged.push({ file: join(JOURNAL_DIR, name), line: number, reason: verdict });
      } else {
        loaded.records.push(verdict);
      }
    }
  }
  loaded.records.sort(compareRecords);
  return loaded;
}

/** One worktree the journal was read from: its folder, the records read there, and how many no worktree read before it held. */
export interface WorktreeRead {
  path: string;
  /** The checkout the reading runs in. */
  self: boolean;
  records: number;
  /** Records held here and in no worktree read before it: the self first, then the others in git's order. */
  only: number;
}

export interface LoadedAcross extends Loaded {
  /** Every worktree read, the self first; just the self where git names no other. */
  worktrees: WorktreeRead[];
}

/**
 * The project's folder in each other worktree of its repository: git's
 * worktree list, the project's own prefix inside its checkout joined to each,
 * a bare entry, a worktree git calls prunable and one whose folder is gone
 * left out. Empty without git or with no other worktree.
 */
export function otherWorktrees(cwd: string): string[] {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  const listed = git(cwd, ["worktree", "list", "--porcelain"]);
  if (top === null || listed === null) return [];
  const prefix = git(cwd, ["rev-parse", "--show-prefix"]) ?? "";
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const self = real(top);
  const out: string[] = [];
  for (const block of listed.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (path === undefined || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    if (real(path) === self || !existsSync(path)) continue;
    out.push(join(path, prefix));
  }
  return out;
}

/** The bytes of each store file in a journal folder, by name; one that cannot be read is said, never taken as a file with no records. */
function storeFiles(dir: string, damaged: Damaged[], shown: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let names: string[];
  try {
    names = readdirSync(dir).filter(isStoreFile).sort();
  } catch (error) {
    // No journal folder is a worktree with no records; any other refusal is said.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") damaged.push({ file: shown, line: 0, reason: `not read: ${error instanceof Error ? error.message : String(error)}` });
    return out;
  }
  for (const name of names) {
    try {
      out.set(name, readFileSync(join(dir, name)));
    } catch (error) {
      damaged.push({ file: join(shown, name), line: 0, reason: `not read: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return out;
}

/**
 * The journal of every worktree of the repository in one timeline, each
 * record once: an agent records its defects in the checkout it works in, so
 * a reading of one checkout alone misses the worktree where the work went
 * wrong. The self is read as loadJournal reads it; every store file of each
 * other worktree is read, and one whose bytes equal a file already read is
 * the same records and is not parsed again, whatever its name; a record
 * whose text or id was already read is the same record. Nothing is
 * skipped by a file's name or size, so two worktrees' files of one name and
 * size with different records are both read, and a file that cannot be read
 * is reported as damaged, never taken to stand for another. Read only, never
 * written. A line that will not parse in another worktree is reported with
 * that worktree's path.
 */
export function loadJournalAcrossWorktrees(cwd: string): LoadedAcross {
  const own = loadJournal(cwd);
  const ids = new Set(own.records.map((r) => r.id));
  const loaded: LoadedAcross = { records: [...own.records], damaged: [...own.damaged], worktrees: [{ path: cwd, self: true, records: own.records.length, only: own.records.length }] };
  // The files already read, by length: a file is compared byte for byte only with those of its length.
  const read = new Map<number, Buffer[]>();
  const known = (bytes: Buffer): boolean => {
    const same = read.get(bytes.length) ?? [];
    if (same.some((b) => b.equals(bytes))) return true;
    read.set(bytes.length, [...same, bytes]);
    return false;
  };
  for (const bytes of storeFiles(journalDir(cwd), [], JOURNAL_DIR).values()) known(bytes);
  const seen = new Set<string>();
  for (const folder of otherWorktrees(cwd)) {
    const dir = journalDir(folder);
    const worktree: WorktreeRead = { path: folder, self: false, records: 0, only: 0 };
    for (const [name, bytes] of storeFiles(dir, loaded.damaged, dir)) {
      if (known(bytes)) continue;
      const text = bytes.toString("utf8");
      for (const { line, number } of storeLines(text, seen)) {
        const verdict = parseLine(line);
        if (typeof verdict === "string") {
          loaded.damaged.push({ file: join(dir, name), line: number, reason: verdict });
          continue;
        }
        worktree.records += 1;
        if (ids.has(verdict.id)) continue;
        ids.add(verdict.id);
        worktree.only += 1;
        loaded.records.push(verdict);
      }
    }
    loaded.worktrees.push(worktree);
  }
  loaded.records.sort(compareRecords);
  return loaded;
}

/** A record, or the reason the line is not one. */
function parseLine(line: string): JournalRecord | string {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return `not JSON (${error instanceof Error ? error.message : String(error)})`;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not a record object";
  const record = value as Record<string, unknown>;
  for (const field of ["id", "kind", "at", "session", "agent"]) {
    if (typeof record[field] !== "string" || record[field] === "") return `missing ${field}`;
  }
  const kind = record["kind"] as string;
  if (!isKind(kind)) return `unknown kind "${kind}"`;
  if (Number.isNaN(Date.parse(record["at"] as string))) return `unreadable time "${String(record["at"])}"`;
  return value as JournalRecord;
}

/** What git says about the tree at the moment of a write; null commit when there is no git to ask. */
export function gitState(cwd: string): { commit: string | null; dirty: boolean } {
  const commit = git(cwd, ["rev-parse", "--short", "HEAD"]);
  if (commit === null) return { commit: null, dirty: false };
  // --no-optional-locks: status never writes the index back, which would leave it newer than the shard and make the next append search it whole.
  const status = git(cwd, ["--no-optional-locks", "status", "--porcelain"]);
  return { commit, dirty: status !== null && status !== "" };
}

/** The branch is never stored; it is asked of git when a read wants it. */
export function gitBranch(cwd: string): string | null {
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch === "" ? null : branch;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
