/**
 * The peer feed: what other sessions recorded since this session last looked.
 *
 * Subjects only, never full records: the glyph, the id, the agent, and the
 * subject truncated to 120 characters, capped at twelve lines with a count of
 * the rest and the one command that shows them whole. The cursor is per
 * session, in .coherence/feed/<session>.cursor (ignored by git), and it moves
 * only after the text was handed to the host: the caller commits the advance
 * once the print succeeded, so a feed that failed to reach the agent is
 * shown again next time.
 *
 * A session that meets the feed for the first time has no cursor. The cursor
 * is set to the latest record then and nothing is printed: the feed is the
 * delta since the last look, and what came before is the journal, one
 * command away.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SESSION_TOKEN } from "./work.ts";
import { cursorAfter, formatCursor, parseCursor, recordsAfter, subjectLine, type Cursor } from "./read.ts";
import { loadJournal, type Loaded } from "./store.ts";

export const FEED_DIR = join(".coherence", "feed");

/** The most subject lines one injection carries. */
export const FEED_CAP = 12;

export function cursorFile(root: string, session: string): string | undefined {
  return SESSION_TOKEN.test(session) ? join(root, FEED_DIR, `${session}.cursor`) : undefined;
}

export function readCursor(root: string, session: string): Cursor | null {
  const file = cursorFile(root, session);
  if (file === undefined || !existsSync(file)) return null;
  const text = readFileSync(file, "utf8").trim();
  if (text === "") return null;
  try {
    return parseCursor(text);
  } catch {
    return null;
  }
}

export function writeCursor(root: string, session: string, cursor: Cursor): void {
  const file = cursorFile(root, session);
  if (file === undefined) return;
  mkdirSync(join(root, FEED_DIR), { recursive: true });
  writeFileSync(file, `${formatCursor(cursor)}\n`, "utf8");
}

/** The latest record of all, as a cursor, or null when nothing is recorded. */
function latestCursor(loaded: Loaded): Cursor | null {
  return cursorAfter(loaded.records, null);
}

/**
 * A session's first meeting with the feed: the cursor is set to the latest
 * record when none exists yet. Returns whether it was set.
 */
export function openFeed(root: string, session: string): boolean {
  if (readCursor(root, session) !== null) return false;
  const latest = latestCursor(loadJournal(root));
  if (latest === null) return false;
  writeCursor(root, session, latest);
  return true;
}

export interface Feed {
  /** The injection, or "" when there is nothing new. */
  text: string;
  /** Moves the cursor past everything the text covered; called once the print succeeded. */
  commit: () => void;
}

/** What other sessions recorded since this session's cursor, as subjects, and the advance to commit after printing. */
export function peerFeed(root: string, session: string): Feed {
  const none: Feed = { text: "", commit: () => {} };
  if (cursorFile(root, session) === undefined) return none;
  const loaded = loadJournal(root);
  const since = readCursor(root, session);
  if (since === null) {
    openFeed(root, session);
    return none;
  }
  const all = recordsAfter(loaded, since, {});
  const fresh = all.filter((record) => record.session !== session);
  const next = cursorAfter(all, since);
  if (fresh.length === 0 || next === null) return none;
  const shown = fresh.slice(0, FEED_CAP);
  const lines = [
    `Peers recorded ${fresh.length} since your last look (subjects only; whole records: journal --since ${formatCursor(since)}):`,
    ...shown.map(subjectLine),
  ];
  if (fresh.length > shown.length) lines.push(`and ${fresh.length - shown.length} more; run: journal --since ${formatCursor(since)}`);
  return { text: lines.join("\n") + "\n", commit: () => writeCursor(root, session, next) };
}
