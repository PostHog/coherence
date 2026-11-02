/**
 * The replay record: every tool call a session made, in the order its hook
 * saw them, so Scope can play the session back on the relief. One JSONL file
 * per session under .coherence/replay, append only; a subagent's calls go
 * into its coordinator's file, each line naming the session and agent that
 * made it, so one session's record holds everything done under it.
 *
 *   call   one line per PostToolUse: the time, the session and agent, the
 *          tool, a short summary of what it did, and the files it read or
 *          wrote, when there were any
 *
 * It sits beside the read trace rather than replacing its read and write
 * lines: the trace also holds the stop's snapshots, which are machine-local
 * and never committed, while this record is what the config's commitReplay
 * may commit, and git keeps or ignores a whole file, never some of its lines.
 *
 * A summary is bounded and never holds the tool's output: a shell command
 * gives its first line, with words shaped like a secret masked; a file its
 * project path; a search its pattern; a fetch only its URL's host.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPLAY_FOLDER } from "../lifecycle/project.ts";
import { shellCommandOf } from "../lifecycle/shell-writes.ts";
import { toRelative } from "./source.ts";
import { TRACES_DIR } from "./trace.ts";

export const REPLAY_DIR = join(".coherence", REPLAY_FOLDER);

/** The longest summary a call line holds, in characters. */
export const SUMMARY_MAX = 160;

/** The longest description (a shell call's own account of itself) a call line holds. */
const DESCRIPTION_MAX = 100;

const SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Whether a session id can name a record file. */
export function sessionName(session: string): boolean {
  return SESSION_TOKEN.test(session);
}

/** One tool call, as the replay record keeps it. */
export interface CallLine {
  kind: "call";
  at: string;
  /** The session the call is attributed to: a subagent's own, inside its coordinator's file. */
  session: string;
  agent: string;
  tool: string;
  summary: string;
  /** A shell call's own account of what it does, when the host gave one. */
  description?: string;
  read?: string[];
  wrote?: string[];
}

export function replayFile(root: string, session: string): string {
  if (!sessionName(session)) throw new Error(`session "${session}" cannot name a file; use letters, digits, dot, dash, or underscore`);
  return join(root, REPLAY_DIR, `${session}.jsonl`);
}

/** Text cut to `max` characters, an ellipsis standing for the rest. */
function bounded(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Words shaped like a secret, masked: the value of an assignment or flag
 * whose name says token, secret, password, key or auth; a bearer or basic
 * credential; a URL's user and password; and any run of 32 or more letters
 * and digits holding both, which is how keys look. What it cannot see, it
 * cannot mask: the bound on length and the first line alone are the rest of
 * the guard.
 */
export function maskSecrets(text: string): string {
  const name = String.raw`(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|cookie|auth(?:orization)?(?![a-z]))`;
  // A credential's scheme stays and its value goes, before the assignments, which would otherwise take the scheme for the value.
  const value = String.raw`(?!(?:Bearer|Basic)\s)("[^"]*"|'[^']*'|[^\s"'…][^\s"']*)`;
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 …")
    .replace(new RegExp(String.raw`(\b[A-Za-z0-9_]*${name}[A-Za-z0-9_]*\s*[=:]\s*)${value}`, "gi"), "$1…")
    .replace(new RegExp(String.raw`(--?[A-Za-z0-9-]*${name}[A-Za-z0-9-]*(?:=|\s+))(?!-)${value}`, "gi"), "$1…")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1…@")
    .replace(/(?<![A-Za-z0-9_+=])(?=[A-Za-z0-9_+=]*\d)(?=[A-Za-z0-9_+=]*[A-Za-z])[A-Za-z0-9_+=]{32,}/g, "…");
}

/** A path as the summary names it: from the project root when it lies inside, else as given. */
function pathOf(root: string, path: string): string {
  return toRelative(root, path) ?? path;
}

/**
 * What a tool call did, in a short line, from its input alone: a shell
 * command's first line, a file's path, a search's pattern and where it
 * looked, a URL's host, a query, a skill, or a subagent's task. Any tool
 * spelling one of these fields is summarised the same way, whatever host
 * runs it; one that spells none has an empty summary, and the tool's name
 * says the rest.
 */
export function summaryOf(root: string, toolInput: unknown): { summary: string; description?: string } {
  if (typeof toolInput !== "object" || toolInput === null) return { summary: "" };
  const record = toolInput as Record<string, unknown>;
  const text = (key: string): string | undefined => (typeof record[key] === "string" && record[key] !== "" ? (record[key] as string) : undefined);
  const said = (summary: string): string => bounded(maskSecrets(summary.replace(/\s+/g, " ").trim()), SUMMARY_MAX);
  const command = shellCommandOf(record);
  if (command !== undefined) {
    const lines = command.split("\n").filter((line) => line.trim() !== "");
    const description = text("description");
    return { summary: said(`${lines[0] ?? ""}${lines.length > 1 ? " …" : ""}`), ...(description === undefined ? {} : { description: bounded(maskSecrets(description.replace(/\s+/g, " ").trim()), DESCRIPTION_MAX) }) };
  }
  const file = text("file_path") ?? text("notebook_path");
  if (file !== undefined) return { summary: said(pathOf(root, file)) };
  const pattern = text("pattern");
  const where = text("path");
  if (pattern !== undefined) return { summary: said(where === undefined ? pattern : `${pattern} in ${pathOf(root, where)}`) };
  if (where !== undefined) return { summary: said(pathOf(root, where)) };
  const url = text("url");
  if (url !== undefined) {
    try {
      return { summary: new URL(url).host };
    } catch {
      return { summary: "" };
    }
  }
  const asked = text("query") ?? text("skill");
  if (asked !== undefined) return { summary: said(asked) };
  const task = text("description");
  if (task !== undefined) return { summary: said(text("subagent_type") === undefined ? task : `${text("subagent_type")}: ${task}`) };
  return { summary: "" };
}

/** One PostToolUse, as the hook hands it over: who made the call, what the tool was given, and what the hook already read it read and wrote. */
export interface CallEvent {
  session: string;
  agent: string;
  tool: unknown;
  toolInput: unknown;
  read?: string | undefined;
  wrote: readonly string[];
  now?: (() => Date) | undefined;
}

/**
 * Append one call line to the record of `record`, the coordinator's session.
 * Nothing is read and nothing is asked: the hook has already read what the
 * call read and wrote, so this costs one append whatever the tool was.
 */
export function recordCall(root: string, record: string, event: CallEvent): CallLine | undefined {
  if (!sessionName(record) || !sessionName(event.session)) return undefined;
  const tool = typeof event.tool === "string" && event.tool !== "" ? bounded(event.tool, 80) : "unknown";
  const line: CallLine = {
    kind: "call",
    at: (event.now ?? (() => new Date()))().toISOString(),
    session: event.session,
    agent: bounded(event.agent, 80),
    tool,
    ...summaryOf(root, event.toolInput),
    ...(event.read === undefined ? {} : { read: [event.read] }),
    ...(event.wrote.length === 0 ? {} : { wrote: [...event.wrote] }),
  };
  mkdirSync(join(root, REPLAY_DIR), { recursive: true });
  appendFileSync(replayFile(root, record), `${JSON.stringify(line)}\n`, "utf8");
  return line;
}

/** A session Scope can play back: where its record is, when it last grew, and how large it is. */
export interface ReplaySession {
  session: string;
  /** "replay" for a replay record; "trace" for a session older than it, whose read trace holds only its reads and writes. */
  from: "replay" | "trace";
  at: string;
  bytes: number;
}

function listed(dir: string, from: ReplaySession["from"]): ReplaySession[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const session = name.slice(0, -".jsonl".length);
    if (!sessionName(session)) return [];
    try {
      const stat = statSync(join(dir, name));
      return stat.isFile() && stat.size > 0 ? [{ session, from, at: stat.mtime.toISOString(), bytes: stat.size }] : [];
    } catch {
      return [];
    }
  });
}

/**
 * The sessions there are to play back, latest first: every replay record,
 * and every read trace of a session with none, which plays its reads and
 * writes alone. Read from the folders' listings and each file's size and
 * time; no record is opened.
 */
export function replaySessions(root: string, limit = 60): ReplaySession[] {
  const replays = listed(join(root, REPLAY_DIR), "replay");
  const held = new Set(replays.map((s) => s.session));
  const traces = listed(join(root, TRACES_DIR), "trace").filter((s) => !held.has(s.session));
  return [...replays, ...traces].sort((a, b) => (a.at === b.at ? a.session.localeCompare(b.session) : a.at < b.at ? 1 : -1)).slice(0, limit);
}

/** A string list from a parsed field, or undefined when it holds none. */
function strings(value: unknown): string[] | undefined {
  const list = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return list.length === 0 ? undefined : list;
}

/** A call line read back, or undefined for a line that is none: a damaged line plays nothing. */
function callOf(value: Record<string, unknown>): CallLine | undefined {
  if (value["kind"] !== "call" || typeof value["at"] !== "string" || Number.isNaN(Date.parse(value["at"]))) return undefined;
  const text = (key: string): string => (typeof value[key] === "string" ? (value[key] as string) : "");
  const read = strings(value["read"]), wrote = strings(value["wrote"]);
  return { kind: "call", at: value["at"], session: text("session"), agent: text("agent"), tool: text("tool"), summary: text("summary"), ...(text("description") === "" ? {} : { description: text("description") }), ...(read ? { read } : {}), ...(wrote ? { wrote } : {}) };
}

/** A read trace's read and write line as a call, for a session older than the replay record: the tool is not known, only what it read or wrote. */
function traceCallOf(value: Record<string, unknown>): CallLine | undefined {
  if (typeof value["at"] !== "string" || Number.isNaN(Date.parse(value["at"]))) return undefined;
  const session = typeof value["session"] === "string" ? value["session"] : "";
  if (value["kind"] === "read" && typeof value["file"] === "string") return { kind: "call", at: value["at"], session, agent: "", tool: "read", summary: bounded(value["file"], SUMMARY_MAX), read: [value["file"]] };
  const files = strings(value["files"]);
  if (value["kind"] === "write" && files !== undefined) return { kind: "call", at: value["at"], session, agent: "", tool: "write", summary: bounded(files.join(", "), SUMMARY_MAX), wrote: files };
  return undefined;
}

/**
 * One session's calls in the order they were made: by time, and by line
 * where two share a time, so a union merge's reordering of lines changes
 * nothing; a line merged in twice plays once. A session with no replay
 * record plays its read trace's reads and writes. Undefined when the session
 * has neither.
 */
export function readReplay(root: string, session: string): { session: string; from: ReplaySession["from"]; calls: CallLine[] } | undefined {
  if (!sessionName(session)) return undefined;
  const own = replayFile(root, session), trace = join(root, TRACES_DIR, `${session}.jsonl`);
  const from: ReplaySession["from"] | undefined = existsSync(own) ? "replay" : existsSync(trace) ? "trace" : undefined;
  if (from === undefined) return undefined;
  let text: string;
  try {
    text = readFileSync(from === "replay" ? own : trace, "utf8");
  } catch {
    return undefined;
  }
  const seen = new Set<string>();
  const calls: { call: CallLine; index: number }[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "" || seen.has(line)) return;
    seen.add(line);
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const call = from === "replay" ? callOf(value as Record<string, unknown>) : traceCallOf(value as Record<string, unknown>);
    if (call !== undefined) calls.push({ call, index });
  });
  calls.sort((a, b) => Date.parse(a.call.at) - Date.parse(b.call.at) || a.index - b.index);
  return { session, from, calls: calls.map((c) => c.call) };
}
