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
import { digestOf, identityOf, lineKey, WorktreeIndex, type IndexedLine } from "./worktree-index.ts";

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
  return worktreesOf(cwd).others;
}

/** The other worktrees' project folders, and the first worktree git lists (the main one, or a bare repository), which names the repository; none without git. */
function worktreesOf(cwd: string): { main?: string; others: string[] } {
  // One rev-parse answers both: the checkout's top, then the project's prefix inside it (an empty line at the top).
  const [top, prefix = ""] = (git(cwd, ["rev-parse", "--show-toplevel", "--show-prefix"]) ?? "").split("\n");
  const listed = top === undefined || top === "" ? null : git(cwd, ["worktree", "list", "--porcelain"]);
  if (top === undefined || listed === null) return { others: [] };
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const self = real(top);
  const out: string[] = [];
  let main: string | undefined;
  for (const block of listed.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (path === undefined) continue;
    main ??= real(path);
    if (lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    if (real(path) === self || !existsSync(path)) continue;
    out.push(join(path, prefix));
  }
  return main === undefined ? { others: out } : { main: join(main, prefix), others: out };
}

/** The bytes of each store file in a journal folder, by name; one that cannot be read is said, never taken as a file with no records. */
function storeFiles(dir: string, damaged: Damaged[], shown: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const name of storeNames(dir, damaged, shown)) {
    try {
      out.set(name, readFileSync(join(dir, name)));
    } catch (error) {
      damaged.push({ file: join(shown, name), line: 0, reason: `not read: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return out;
}

/** The store files' names in a journal folder, sorted; no folder is a worktree with no records, and any other refusal is said. */
function storeNames(dir: string, damaged: Damaged[], shown: string): string[] {
  try {
    return readdirSync(dir).filter(isStoreFile).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") damaged.push({ file: shown, line: 0, reason: `not read: ${error instanceof Error ? error.message : String(error)}` });
    return [];
  }
}

/** A store file's lines, each with its key and what it parses to: the whole file, every line once, whatever other files hold. */
function parsedLines(text: string): { lines: IndexedLine[]; parsed: Map<string, JournalRecord | string> } {
  const lines: IndexedLine[] = [];
  const parsed = new Map<string, JournalRecord | string>();
  for (const { line, number } of storeLines(text, new Set())) {
    const key = lineKey(line.trim());
    lines.push([key, number]);
    if (!parsed.has(key)) parsed.set(key, parseLine(line));
  }
  return { lines, parsed };
}

/**
 * The journal of every worktree of the repository in one timeline, each
 * record once: an agent records its defects in the checkout it works in, so
 * a reading of one checkout alone misses the worktree where the work went
 * wrong. The self is read as loadJournal reads it, except that a store file
 * it cannot read is reported as damaged rather than thrown; every store file
 * of each other worktree is read, and one whose bytes equal a file already
 * read (their digests agree) is the same records and is not parsed again,
 * whatever its name; a record whose text or id was already read is the same
 * record. Nothing is skipped by a file's name or size, so two worktrees'
 * files of one name and size with different records are both read, and a
 * file that cannot be read is reported as damaged, never taken to stand for
 * another. Read only, never written: what was parsed is kept in the user's
 * cache (worktree-index.ts), filed by each file's identity, so a file
 * unchanged since the last reading is not read again. A line that will not
 * parse in another worktree is reported with that worktree's path.
 */
export function loadJournalAcrossWorktrees(cwd: string): LoadedAcross {
  const loaded: LoadedAcross = { records: [], damaged: [], worktrees: [] };
  // The self, read whole each time: its bytes are the truth the others are compared with.
  const digests = new Set<string>();
  const ownSeen = new Set<string>();
  for (const [name, bytes] of storeFiles(journalDir(cwd), loaded.damaged, JOURNAL_DIR)) {
    digests.add(digestOf(bytes));
    for (const { line, number } of storeLines(bytes.toString("utf8"), ownSeen)) {
      const verdict = parseLine(line);
      if (typeof verdict === "string") loaded.damaged.push({ file: join(JOURNAL_DIR, name), line: number, reason: verdict });
      else loaded.records.push(verdict);
    }
  }
  const ids = new Set(loaded.records.map((r) => r.id));
  loaded.worktrees.push({ path: cwd, self: true, records: loaded.records.length, only: loaded.records.length });
  const { main, others } = worktreesOf(cwd);
  if (others.length === 0) {
    loaded.records.sort(compareRecords);
    return loaded;
  }
  const index = WorktreeIndex.open(main);
  const seen = new Set<string>();
  for (const folder of others) {
    const dir = journalDir(folder);
    const worktree: WorktreeRead = { path: folder, self: false, records: 0, only: 0 };
    for (const name of storeNames(dir, loaded.damaged, dir)) {
      const file = join(dir, name);
      let content: { digest: string; lines: IndexedLine[] } | undefined;
      try {
        const s = statSync(file);
        const identity = identityOf(s);
        content = s.isFile() ? index.known(dir, name, identity) : undefined;
        if (content === undefined) {
          const bytes = readFileSync(file);
          const digest = digestOf(bytes);
          const { lines, parsed } = parsedLines(bytes.toString("utf8"));
          index.record(dir, name, identity, digest, lines, parsed);
          content = { digest, lines };
        }
      } catch (error) {
        loaded.damaged.push({ file, line: 0, reason: `not read: ${error instanceof Error ? error.message : String(error)}` });
        continue;
      }
      if (digests.has(content.digest)) continue;
      digests.add(content.digest);
      for (const [key, number] of content.lines) {
        if (seen.has(key)) continue;
        seen.add(key);
        const verdict = index.line(key)!;
        if (typeof verdict === "string") {
          loaded.damaged.push({ file, line: number, reason: verdict });
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
  index.save();
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
