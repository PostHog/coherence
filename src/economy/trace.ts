/**
 * Read traces: the files a session explicitly read, recorded at tool
 * boundaries, and snapshotted at Stop against the patch and the economy
 * prediction. One JSONL file per session under .coherence/traces, append
 * only; it exists only as calibrate's input.
 *
 *   read      one line per PostToolUse of a reading tool that named a file
 *             under the root
 *   snapshot  one line at Stop: the files the session changed (the working
 *             tree against HEAD, plus untracked), the distinct files it read,
 *             and the closure predicted for the changed files
 *
 * The hook calls recordReadTrace on PostToolUse and snapshotTrace on Stop;
 * the two call sites live in the hook, not here. Traces are not committed:
 * git ignores .coherence/* except the listed record folders, and traces are
 * per session and larger than a journal, so they stay on the machine the
 * session ran on.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import type { HookInput } from "../lifecycle/hook.ts";
import type { SpecModel } from "../spec/model.ts";
import { predictClosure, type Instrument } from "./closure.ts";
import { toRelative } from "./source.ts";

export const TRACES_DIR = join(".coherence", "traces");

/** Tools that read a file and name it the same way a writing tool does; the hook's set, kept here so the trace can be recorded without it. */
export const READING_TOOLS: ReadonlySet<string> = new Set(["Read", "NotebookRead", "read_file"]);

const SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface ReadLine {
  kind: "read";
  at: string;
  session: string;
  file: string;
}

export interface Snapshot {
  kind: "snapshot";
  at: string;
  session: string;
  commit: string | null;
  /** The patch: files changed in the working tree against HEAD, plus untracked. */
  changed: string[];
  /** The distinct files the session read before this snapshot. */
  read: string[];
  /** The closure predicted for the changed files. */
  predicted: string[];
  tokens: number;
  instrument: Instrument;
}

export type TraceLine = ReadLine | Snapshot;

export function tracesDir(root: string): string {
  return join(root, TRACES_DIR);
}

export function traceFile(root: string, session: string): string {
  if (!SESSION_TOKEN.test(session)) throw new Error(`session "${session}" cannot name a file; use letters, digits, dot, dash, or underscore`);
  return join(tracesDir(root), `${session}.jsonl`);
}

function append(root: string, line: TraceLine): string {
  const file = traceFile(root, line.session);
  mkdirSync(tracesDir(root), { recursive: true });
  appendFileSync(file, `${JSON.stringify(line)}\n`, "utf8");
  return file;
}

/** The project-relative file a reading tool event read, or undefined when the event read no file under the root. */
export function readFileOf(root: string, input: HookInput): string | undefined {
  if (typeof input.tool_name !== "string" || !READING_TOOLS.has(input.tool_name)) return undefined;
  const toolInput = input.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const record = toolInput as Record<string, unknown>;
  const path = [record["file_path"], record["notebook_path"], record["path"]].find((v): v is string => typeof v === "string" && v !== "");
  if (path === undefined) return undefined;
  const rel = toRelative(root, path);
  if (rel === undefined || rel.startsWith(".git/") || rel.startsWith("node_modules/")) return undefined;
  try {
    if (!statSync(resolve(root, rel)).isFile()) return undefined;
  } catch {
    return undefined;
  }
  return rel;
}

export interface TraceOptions {
  now?: (() => Date) | undefined;
}

/**
 * Record one read from a PostToolUse event. Returns the file recorded, or
 * undefined when the event was not a read of a file under the root.
 */
export function recordReadTrace(root: string, session: string, input: HookInput, options: TraceOptions = {}): string | undefined {
  const file = readFileOf(root, input);
  if (file === undefined) return undefined;
  const at = (options.now ?? (() => new Date()))().toISOString();
  append(root, { kind: "read", at, session, file });
  return file;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Files changed in the working tree at `root`: modified against HEAD plus untracked. Empty outside git. */
export function patchFiles(root: string): string[] {
  const diff = git(root, ["diff", "--name-only", "HEAD"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (diff === null && untracked === null) return [];
  const all = `${diff ?? ""}\n${untracked ?? ""}`.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return [...new Set(all)].sort();
}

export interface SessionTrace {
  session: string;
  reads: ReadLine[];
  snapshots: Snapshot[];
}

export interface LoadedTraces {
  sessions: SessionTrace[];
  damaged: { file: string; line: number; reason: string }[];
}

export function loadTraces(root: string): LoadedTraces {
  const dir = tracesDir(root);
  const loaded: LoadedTraces = { sessions: [], damaged: [] };
  if (!existsSync(dir)) return loaded;
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
    const session: SessionTrace = { session: name.slice(0, -".jsonl".length), reads: [], snapshots: [] };
    readFileSync(join(dir, name), "utf8").split("\n").forEach((line, index) => {
      if (line.trim() === "") return;
      const parsed = parseLine(line);
      if (typeof parsed === "string") loaded.damaged.push({ file: join(TRACES_DIR, name), line: index + 1, reason: parsed });
      else if (parsed.kind === "read") session.reads.push(parsed);
      else session.snapshots.push(parsed);
    });
    loaded.sessions.push(session);
  }
  return loaded;
}

function parseLine(line: string): TraceLine | string {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return `not JSON (${error instanceof Error ? error.message : String(error)})`;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not a trace line";
  const record = value as Record<string, unknown>;
  for (const field of ["kind", "at", "session"]) if (typeof record[field] !== "string") return `missing ${field}`;
  if (Number.isNaN(Date.parse(record["at"] as string))) return `unreadable time "${String(record["at"])}"`;
  if (record["kind"] === "read") return typeof record["file"] === "string" ? (value as ReadLine) : "read line names no file";
  if (record["kind"] === "snapshot") {
    for (const field of ["changed", "read", "predicted"]) if (!Array.isArray(record[field])) return `snapshot missing ${field}`;
    return value as Snapshot;
  }
  return `unknown kind "${String(record["kind"])}"`;
}

/** The distinct files a session's trace says it read, sorted. */
export function filesRead(root: string, session: string): string[] {
  const file = traceFile(root, session);
  if (!existsSync(file)) return [];
  const found = new Set<string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const parsed = parseLine(line);
    if (typeof parsed !== "string" && parsed.kind === "read") found.add(parsed.file);
  }
  return [...found].sort();
}

export interface SnapshotOptions extends TraceOptions {
  adapter?: LanguageAdapter | undefined;
  server?: "cold" | "warm" | undefined;
  instrumentReason?: string | undefined;
  model?: SpecModel | undefined;
  /** The patch, when the caller already has it. */
  changed?: readonly string[] | undefined;
}

/**
 * Snapshot a session at Stop: the patch, what was read, and the closure
 * predicted for the patch. Nothing is written when the session neither read
 * nor changed a file; the snapshot is returned otherwise.
 */
export async function snapshotTrace(root: string, session: string, options: SnapshotOptions = {}): Promise<Snapshot | undefined> {
  const changed = [...(options.changed ?? patchFiles(root))].filter((f) => {
    try {
      return statSync(resolve(root, f)).isFile();
    } catch {
      return false;
    }
  });
  const read = filesRead(root, session);
  if (changed.length === 0 && read.length === 0) return undefined;
  let predicted: string[] = [];
  let tokens = 0;
  let instrument: Instrument = { language: "unknown", server: "none", reason: options.instrumentReason ?? "no adapter" };
  if (changed.length > 0) {
    try {
      const closure = await predictClosure(root, changed, { adapter: options.adapter, server: options.server, instrumentReason: options.instrumentReason, model: options.model });
      predicted = closure.entries.map((e) => e.file);
      tokens = closure.tokens;
      instrument = closure.instrument;
    } catch (error) {
      instrument = { language: "unknown", server: "none", reason: `prediction failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const at = (options.now ?? (() => new Date()))().toISOString();
  const snapshot: Snapshot = { kind: "snapshot", at, session, commit: git(root, ["rev-parse", "--short", "HEAD"]), changed, read, predicted, tokens, instrument };
  append(root, snapshot);
  return snapshot;
}
