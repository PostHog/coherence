/**
 * What the hooks last said, kept so a person can read it: Scope's Home shows,
 * under each moment of a session, the last thing Coherence told the agent (or,
 * at a stop, the user) at that moment, rather than a description of it.
 *
 * A hook that says nothing keeps nothing, so the call that stays silent, as
 * most tool calls do, writes no file. One that speaks keeps its words under
 * .coherence/hook-said/<event>.json, the last SAID_KEPT per event, newest
 * first, with when, the session, and for a tool moment which tool and which
 * file. A command's text is never kept: it can carry what was never meant to
 * be written down. The store is transient, ignored with the rest of
 * .coherence, and written whole through a rename, so two tool hooks answering
 * at once leave one of their records, never a torn file.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export const HOOK_SAID_DIR = join(".coherence", "hook-said");
/** How many of an event's last words are kept. */
export const SAID_KEPT = 3;

export interface HookSaid {
  at: string;
  session: string;
  /** What reached the host: the agent's added context, or a stop's message to the user. */
  text: string;
  /** Who it was said to: the agent, through its context, or the user, as a message the agent never sees. */
  to: "agent" | "user";
  /** For a tool moment, the tool that was about to run or had run. */
  tool?: string;
  /** For a tool moment, the file it was about, relative to the project. */
  file?: string;
}

/** The words a hook's answer carries, from its stdout, and who they reach: the added context or a blocking reason reach the agent, a message reaches the user; none when it says nothing. */
export function saidIn(stdout: string): { text: string; to: "agent" | "user" } | undefined {
  const out = stdout.trim();
  if (out === "") return undefined;
  const said = (text: unknown): text is string => typeof text === "string" && text.trim() !== "";
  try {
    const answer = JSON.parse(out) as { hookSpecificOutput?: { additionalContext?: unknown }; systemMessage?: unknown; reason?: unknown };
    if (said(answer.hookSpecificOutput?.additionalContext)) return { text: answer.hookSpecificOutput.additionalContext, to: "agent" };
    if (said(answer.reason)) return { text: answer.reason, to: "agent" };
    if (said(answer.systemMessage)) return { text: answer.systemMessage, to: "user" };
    return undefined;
  } catch {
    // A plain-text answer is added context as it stands.
    return { text: out, to: "agent" };
  }
}

/** The tool and the file a tool moment was about; a command's text is left out. */
export function toolOf(root: string, input: Record<string, unknown>): { tool?: string; file?: string } {
  const tool = typeof input["tool_name"] === "string" ? input["tool_name"] : undefined;
  const args = (input["tool_input"] ?? {}) as Record<string, unknown>;
  const path = [args["file_path"], args["notebook_path"], args["path"]].find((p): p is string => typeof p === "string" && p !== "");
  const file = path === undefined ? undefined : isAbsolute(path) ? relative(root, path) : path;
  return { ...(tool === undefined ? {} : { tool }), ...(file === undefined || file.startsWith("..") ? {} : { file }) };
}

function eventFile(root: string, event: string): string {
  return join(root, HOOK_SAID_DIR, `${event.replace(/[^\w.-]/g, "_")}.json`);
}

/** One event's kept words, newest first; none when nothing was kept or the file cannot be read. */
export function readSaid(root: string, event: string): HookSaid[] {
  try {
    const kept = JSON.parse(readFileSync(eventFile(root, event), "utf8")) as unknown;
    return Array.isArray(kept) ? kept.filter((s): s is HookSaid => typeof s?.at === "string" && typeof s?.text === "string") : [];
  } catch {
    return [];
  }
}

/** Every event's kept words, by event. */
export function readAllSaid(root: string): Record<string, HookSaid[]> {
  let names: string[] = [];
  try {
    names = readdirSync(join(root, HOOK_SAID_DIR)).filter((n) => n.endsWith(".json"));
  } catch {
    return {};
  }
  return Object.fromEntries(names.map((n) => n.slice(0, -5)).flatMap((event) => { const said = readSaid(root, event); return said.length > 0 ? [[event, said] as const] : []; }));
}

/** Keep what a hook said at an event, when it said anything; a failure to keep it never reaches the hook's answer. */
export function keepSaid(root: string, event: string, said: HookSaid): void {
  if (said.text.trim() === "") return;
  try {
    mkdirSync(join(root, HOOK_SAID_DIR), { recursive: true });
    const file = eventFile(root, event);
    const next = [said, ...readSaid(root, event)].slice(0, SAID_KEPT);
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, JSON.stringify(next, null, 1));
    renameSync(temp, file);
  } catch {
    // Keeping what was said is for a person reading later; the session it was said to never waits on it.
  }
}
