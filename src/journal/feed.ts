/**
 * The peer feed: what other sessions recorded since this session last looked.
 *
 * Two kinds only: a peer's decisions, which is what the lexicon names, and a
 * peer's escalations, because an escalation heads every read and a question
 * standing before a human changes what this session should do next. Every
 * other verb is the journal, one command away.
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
 *
 * A subagent runs inside its coordinator's session and writes under its own
 * id, so its records reach the coordinator as a peer's. When one writes under
 * the coordinator's session instead, its --agent still tells it apart: for
 * the main thread, a record of its own session under another agent's name is
 * a peer's too.
 *
 * A subagent that stops leaves a return: every record it made, whatever the
 * kind, listed once for the coordinator's next boundary, so what a subagent
 * decided reaches the thread that spawned it even when its report left it
 * out. The returns wait in .coherence/feed/<session>.returns and leave only
 * once the block that names them was handed to the host.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SESSION_TOKEN } from "./work.ts";
import { cursorAfter, formatCursor, parseCursor, recordsAfter, subjectLine, type Cursor } from "./read.ts";
import type { JournalRecord } from "./record.ts";
import { loadJournal, type Loaded } from "./store.ts";
import { journalTail } from "./tail.ts";

export const FEED_DIR = join(".coherence", "feed");

/** The most subject lines one injection carries. */
export const FEED_CAP = 12;

/** The record kinds a boundary injects: the lexicon's decisions, and the escalations that head every read. */
export const FEED_KINDS: ReadonlySet<string> = new Set(["decision", "escalation"]);

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
  // The tail starts here too: what comes after this look is read from the log, never from the whole journal again.
  const tail = journalTail(root, session);
  tail.advance();
  const latest = latestCursor(tail.whole ? { records: tail.records, damaged: [] } : loadJournal(root));
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

/**
 * What peers recorded since this session's cursor, as subjects, and the
 * advance to commit after printing. A peer is another session, or, when
 * `ownAgent` names the reader, another agent writing under this session.
 * Records in `shown` were already put before the reader and are left out.
 */
export function peerFeed(root: string, session: string, ownAgent?: string, shown: ReadonlySet<string> = new Set()): Feed {
  const none: Feed = { text: "", commit: () => {} };
  if (cursorFile(root, session) === undefined) return none;
  const since = readCursor(root, session);
  if (since === null) {
    openFeed(root, session);
    return none;
  }
  // Only what was appended since the last look (tail.ts): the feed costs the new records, never the journal's history.
  const tail = journalTail(root, session);
  const all = recordsAfter({ records: tail.records, damaged: [] }, since, {});
  const peer = (record: JournalRecord): boolean => record.session !== session || (ownAgent !== undefined && record.agent !== ownAgent);
  const fresh = all.filter((record) => peer(record) && FEED_KINDS.has(record.kind) && !shown.has(record.id));
  const next = cursorAfter(all, since);
  // Nothing to show: the lines just read are spent, so the next look does not read them again.
  if (fresh.length === 0) tail.advance();
  if (fresh.length === 0 || next === null) return { text: "", commit: next === null ? () => {} : () => writeCursor(root, session, next) };
  const first = fresh.slice(0, FEED_CAP);
  const lines = [
    `Peers recorded ${fresh.length} since your last look (subjects only; whole records: journal --since ${formatCursor(since)}):`,
    ...first.map(subjectLine),
  ];
  if (fresh.length > first.length) lines.push(`and ${fresh.length - first.length} more; run: journal --since ${formatCursor(since)}`);
  return { text: lines.join("\n") + "\n", commit: () => { writeCursor(root, session, next); tail.advance(); } };
}

/* -------------------------------------------------------------- returns */

/** One stopped subagent's records, waiting for its coordinator's next boundary. */
interface ChildReturn {
  child: string;
  agent: string;
  ids: string[];
}

function returnFile(root: string, session: string): string | undefined {
  return SESSION_TOKEN.test(session) ? join(root, FEED_DIR, `${session}.returns`) : undefined;
}

function startFile(root: string, child: string): string | undefined {
  return SESSION_TOKEN.test(child) ? join(root, FEED_DIR, `${child}.start`) : undefined;
}

/** A subagent's start: when it began, so its stop can find what it wrote under its coordinator's session. */
export function markChildStart(root: string, child: string, at: string = new Date().toISOString()): void {
  const file = startFile(root, child);
  if (file === undefined) return;
  mkdirSync(join(root, FEED_DIR), { recursive: true });
  writeFileSync(file, `${at}\n`, "utf8");
}

/**
 * A subagent's stop: every record it made, its own session's and those its
 * coordinator's session holds under another agent's name since it began, left
 * for the coordinator. Nothing is left when it recorded nothing.
 */
export function leaveReturn(root: string, parent: string, child: string, agent: string): void {
  const file = returnFile(root, parent);
  if (file === undefined || child === parent) return;
  const startPath = startFile(root, child);
  const began = startPath !== undefined && existsSync(startPath) ? readFileSync(startPath, "utf8").trim() : undefined;
  const records = loadJournal(root).records.filter(
    (record) => record.session === child || (began !== undefined && record.session === parent && record.agent !== MAIN && record.at >= began),
  );
  if (startPath !== undefined) rmSync(startPath, { force: true });
  if (records.length === 0) return;
  mkdirSync(join(root, FEED_DIR), { recursive: true });
  appendFileSync(file, JSON.stringify({ child, agent, ids: records.map((r) => r.id) } satisfies ChildReturn) + "\n", "utf8");
}

/** The main thread's agent name, which a coordinator's own records carry. */
const MAIN = "main";

/**
 * The returns waiting for this session, as one block per stopped subagent
 * (subjects, every record, uncapped: a subagent's decisions are the point),
 * the ids the block showed, and the removal to commit once it was printed.
 */
export function returnFeed(root: string, session: string): Feed & { ids: ReadonlySet<string> } {
  const file = returnFile(root, session);
  const none = { text: "", commit: () => {}, ids: new Set<string>() };
  if (file === undefined || !existsSync(file)) return none;
  const returns = readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "").flatMap((line): ChildReturn[] => {
    try {
      return [JSON.parse(line) as ChildReturn];
    } catch {
      return [];
    }
  });
  if (returns.length === 0) return none;
  const byId = new Map(loadJournal(root).records.map((record) => [record.id, record]));
  const ids = new Set<string>();
  const lines: string[] = [];
  for (const back of returns) {
    const records = back.ids.map((id) => byId.get(id)).filter((r): r is JournalRecord => r !== undefined);
    if (records.length === 0) continue;
    lines.push(`Subagent ${back.agent} (${back.child}) finished and recorded ${records.length}; review what it decided (whole records: journal <id>):`);
    for (const record of records) {
      lines.push(subjectLine(record));
      ids.add(record.id);
    }
  }
  const text = lines.length === 0 ? "" : lines.join("\n") + "\n";
  const size = readFileSync(file, "utf8").length;
  // Only the returns this block read leave: one a subagent added after the read waits for the next boundary.
  const commit = (): void => {
    const now = readFileSync(file, "utf8");
    const rest = now.slice(size);
    if (rest.trim() === "") rmSync(file, { force: true });
    else writeFileSync(file, rest, "utf8");
  };
  return { text, commit, ids };
}
