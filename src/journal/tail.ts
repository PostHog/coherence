/**
 * The journal's tail: what was appended since a reader last looked, read
 * without reading the journal. Every appendRecord also appends one short
 * line to a log under .coherence/cache (which journal file, at which byte,
 * how long), so a reader that keeps its offset into the log reads only the
 * log's new lines and the records they point at: the peer feed at every tool
 * call costs the records written since the last one, never the history.
 *
 * The log speaks only for appends made through appendRecord. A journal file
 * that arrives or changes any other way (a pull, a checkout, a hand edit)
 * changes the journal folder; a writer records the folder's identity after
 * its own append only when the folder was the one already recorded, so a
 * reader that finds the folder changed knows something outside the log
 * happened and reads the whole journal once. An append in place by something
 * other than appendRecord (an older release) is not seen until then.
 */

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareRecords, journalFolderIdentity, loadJournal, parseJournalLine, readJournalRange } from "./store.ts";
import type { JournalRecord } from "./record.ts";

const CACHE = join(".coherence", "cache");

function logPath(root: string): string {
  return join(root, CACHE, "journal-log");
}

function folderPath(root: string): string {
  return join(root, CACHE, "journal-folder");
}

function folderIdentity(root: string): string | undefined {
  return journalFolderIdentity(root);
}

function recordedFolder(root: string): string | undefined {
  try {
    return readFileSync(folderPath(root), "utf8");
  } catch {
    return undefined;
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** The folder's identity before an append, for noteAppend to compare with. */
export function folderBefore(root: string): string | undefined {
  return folderIdentity(root);
}

/**
 * Log one append: the journal file, the byte it began at, its length. The
 * folder's identity is recorded after it only when the folder before the
 * append was the one recorded, so a change no log line names stays visible.
 */
export function noteAppend(root: string, file: string, offset: number, length: number, before: string | undefined): void {
  try {
    mkdirSync(join(root, CACHE), { recursive: true });
    appendFileSync(logPath(root), JSON.stringify({ file, offset, length }) + "\n");
    if (before !== undefined && before === recordedFolder(root)) {
      const after = folderIdentity(root);
      if (after !== undefined) writeFileSync(folderPath(root), after);
    }
  } catch {
    // Without the log line a reader finds the folder changed or, at worst, sees the record at the next whole read.
  }
}

function tailPath(root: string, session: string): string {
  return join(root, ".coherence", "feed", `${session}.tail`);
}

export interface Tail {
  /** The records appended since the session's last look, in journal order; all of them when `whole`. */
  records: JournalRecord[];
  /** Whether the whole journal was read: no offset yet, or the folder changed outside the log. */
  whole: boolean;
  /** Keep the offset read to, so the next look starts there. */
  advance: () => void;
}

/** Read one byte range of a journal file. */
function slice(path: string, offset: number, length: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * What was appended since this session's last look: the log's new lines and
 * the records they name, or the whole journal once when the session has no
 * offset yet or the folder changed outside the log.
 */
export function journalTail(root: string, session: string): Tail {
  const log = logPath(root);
  const size = sizeOf(log);
  const keep = (to: number) => (): void => {
    try {
      mkdirSync(join(root, ".coherence", "feed"), { recursive: true });
      writeFileSync(tailPath(root, session), String(to));
    } catch {
      // The next look reads the same lines again; nothing is lost but time.
    }
  };
  let from: number | undefined;
  try {
    from = Number.parseInt(readFileSync(tailPath(root, session), "utf8"), 10);
  } catch {
    from = undefined;
  }
  const identity = folderIdentity(root);
  if (from === undefined || Number.isNaN(from) || from > size || identity !== recordedFolder(root)) {
    // The log's size is taken before the read: an append during it is read again from the log, and the cursor drops what was shown.
    const records = loadJournal(root).records;
    if (identity !== undefined) {
      try {
        mkdirSync(join(root, CACHE), { recursive: true });
        writeFileSync(folderPath(root), identity);
      } catch {
        // The next look reads the whole journal again.
      }
    }
    return { records, whole: true, advance: keep(size) };
  }
  if (size === from) return { records: [], whole: false, advance: () => {} };
  const text = slice(log, from, size - from);
  const end = text.lastIndexOf("\n");
  const lines = end < 0 ? [] : text.slice(0, end).split("\n");
  const records: JournalRecord[] = [];
  for (const line of lines) {
    try {
      const at = JSON.parse(line) as { file: string; offset: number; length: number };
      const parsed = parseJournalLine(readJournalRange(root, at.file, at.offset, at.length).trim());
      if (typeof parsed !== "string") records.push(parsed);
    } catch {
      // A torn log line or a moved file: the folder check reads the whole journal when it matters.
    }
  }
  records.sort(compareRecords);
  return { records, whole: false, advance: keep(from + Buffer.byteLength(text.slice(0, end + 1), "utf8")) };
}
