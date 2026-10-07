/**
 * Where the journal lives and how it is read back.
 *
 * One JSONL file per session under .coherence/journal. A write appends one
 * line and never rewrites; a read merges every session file into one timeline
 * ordered by time. A line that will not parse is reported with its file and
 * line number and skipped, never silently dropped: a crashed write leaves a
 * partial last line, and the reader must say so rather than hide it.
 */

import { execFileSync } from "../lifecycle/work-meter.ts";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JournalError } from "./args.ts";
import { isKind, type JournalRecord } from "./record.ts";
import { SESSION_TOKEN, workBinding } from "./work.ts";

export const JOURNAL_DIR = join(".coherence", "journal");

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
  const file = sessionFile(cwd, record.session);
  const bound: JournalRecord = { ...record, ...workBinding(cwd, record.session, record.work) };
  mkdirSync(journalDir(cwd), { recursive: true });
  appendFileSync(file, `${JSON.stringify(bound)}\n`, "utf8");
  return bound;
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
  const dir = journalDir(cwd);
  const loaded: Loaded = { records: [], damaged: [] };
  if (!existsSync(dir)) return loaded;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  for (const name of files) {
    const file = join(dir, name);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (line.trim() === "") return;
      const verdict = parseLine(line);
      if (typeof verdict === "string") {
        loaded.damaged.push({ file: join(JOURNAL_DIR, name), line: index + 1, reason: verdict });
      } else {
        loaded.records.push(verdict);
      }
    });
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
  const status = git(cwd, ["status", "--porcelain"]);
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
