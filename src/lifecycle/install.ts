/**
 * Hook wiring for a host, written into the project and never over anyone
 * else's hooks.
 *
 * Claude Code reads `.claude/settings.json`; Codex reads `.codex/hooks.json`.
 * Both use the same shape: `hooks -> EventName -> [{ matcher?, hooks: [{ type:
 * "command", command, timeout }] }]` (Claude Code: https://code.claude.com/docs/en/hooks;
 * Codex: https://learn.chatgpt.com/docs/hooks). Install merges: an existing
 * entry for another command is kept; an entry Coherence wrote earlier is
 * replaced in place; everything outside `hooks` is untouched.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { HOOK_EVENTS, type HookEvent } from "./hook.ts";

export const HOSTS = ["claude", "codex"] as const;
export type Host = (typeof HOSTS)[number];

export function isHost(name: string): name is Host {
  return (HOSTS as readonly string[]).includes(name);
}

/** The settings file each host reads, relative to the project root. */
export const SETTINGS_FILE: Record<Host, string> = {
  claude: ".claude/settings.json",
  codex: ".codex/hooks.json",
};

/** How long a hook may run, in seconds. The check reads every changed file once. */
const TIMEOUT_SECONDS = 60;

/**
 * Codex spills a start hook's context over 2,500 tokens by default; the
 * injection is held under 9,500 characters, and this keeps a stricter
 * tokenizer from spilling it anyway.
 */
const CODEX_CONTEXT_LIMIT = 4000;

/** The events whose output is context for the model rather than a verdict. */
const START_EVENTS: ReadonlySet<string> = new Set(["SessionStart", "SubagentStart"]);

/** An entry is Coherence's when its command reaches this CLI and names one of the hook events. */
const MINE = new RegExp(`(?:coherence|cli\\.ts)"?\\s+hook\\s+(?:${HOOK_EVENTS.join("|")})\\s*$`);

function isMine(command: unknown): command is string {
  return typeof command === "string" && MINE.test(command);
}

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
  [key: string]: unknown;
}

interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
  [key: string]: unknown;
}

type HooksByEvent = Record<string, HookEntry[]>;

export interface InstallOptions {
  root: string;
  host: Host;
  /** The command prefix that reaches this CLI, e.g. "npx coherence" or "node src/cli.ts". */
  command: string;
}

export function hookCommand(prefix: string, event: HookEvent): string {
  return `${prefix} hook ${event}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoherenceEntry(entry: unknown): entry is HookEntry {
  return (
    isRecord(entry) &&
    Array.isArray(entry["hooks"]) &&
    entry["hooks"].some((h) => isRecord(h) && isMine(h["command"]))
  );
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return {};
  }
  if (text.trim() === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error(`${path}: expected a JSON object`);
  return parsed;
}

function hooksOf(settings: Record<string, unknown>): HooksByEvent {
  const hooks = settings["hooks"];
  if (hooks === undefined) return {};
  if (!isRecord(hooks)) throw new Error("settings.hooks must be an object");
  const out: HooksByEvent = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) throw new Error(`settings.hooks.${event} must be a list`);
    out[event] = entries as HookEntry[];
  }
  return out;
}

/** The merged settings: pure, so the merge can be tested without a disk. */
export function mergeHooks(settings: Record<string, unknown>, options: Pick<InstallOptions, "command" | "host">): Record<string, unknown> {
  const hooks = hooksOf(settings);
  for (const event of HOOK_EVENTS) {
    const handler: HookCommand = { type: "command", command: hookCommand(options.command, event), timeout: TIMEOUT_SECONDS };
    if (options.host === "codex" && START_EVENTS.has(event)) handler["additionalContextLimit"] = CODEX_CONTEXT_LIMIT;
    const mine: HookEntry = { hooks: [handler] };
    const existing = hooks[event] ?? [];
    const kept = existing.filter((entry) => !isCoherenceEntry(entry));
    hooks[event] = [...kept, mine];
  }
  return { ...settings, hooks };
}

export interface InstallResult {
  path: string;
  events: HookEvent[];
}

export async function install(options: InstallOptions): Promise<InstallResult> {
  const path = resolve(options.root, SETTINGS_FILE[options.host]);
  const settings = await readSettings(path);
  const merged = mergeHooks(settings, options);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(merged, null, 2) + "\n");
  return { path, events: [...HOOK_EVENTS] };
}

export interface HostStatus {
  host: Host;
  path: string;
  present: boolean;
  /** Events for which a Coherence entry exists, with its command. */
  installed: { event: string; command: string }[];
  /** Events Coherence would wire that carry no Coherence entry. */
  missing: HookEvent[];
  /** Entries by other tools, counted per event. */
  others: Record<string, number>;
}

export async function status(root: string, host: Host): Promise<HostStatus> {
  const path = resolve(root, SETTINGS_FILE[host]);
  let settings: Record<string, unknown>;
  let present = true;
  try {
    settings = await readSettings(path);
    present = Object.keys(settings).length > 0 || (await readFile(path, "utf8")).length > 0;
  } catch {
    settings = {};
    present = false;
  }
  const hooks = hooksOf(settings);
  const installed: { event: string; command: string }[] = [];
  const others: Record<string, number> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries) {
      if (isCoherenceEntry(entry)) {
        const command = entry.hooks.find((h) => isMine(h.command))?.command ?? "";
        installed.push({ event, command });
      } else {
        others[event] = (others[event] ?? 0) + 1;
      }
    }
  }
  const missing = HOOK_EVENTS.filter((e) => !installed.some((i) => i.event === e));
  return { host, path, present, installed, missing, others };
}

export function formatStatus(statuses: HostStatus[]): string {
  const lines: string[] = [];
  for (const s of statuses) {
    lines.push(`${s.host}: ${s.path}${s.present ? "" : " (absent)"}`);
    for (const i of s.installed) lines.push(`  ${i.event}: ${i.command}`);
    if (s.missing.length > 0) lines.push(`  not installed: ${s.missing.join(", ")}`);
    const otherEvents = Object.entries(s.others);
    if (otherEvents.length > 0) {
      lines.push(`  other hooks kept: ${otherEvents.map(([e, n]) => `${e} (${n})`).join(", ")}`);
    }
  }
  return lines.join("\n") + "\n";
}
