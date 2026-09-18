/**
 * Hook wiring for a host, written into the project and never over anyone
 * else's hooks.
 *
 * Claude Code reads `.claude/settings.json`; Codex reads `.codex/hooks.json`.
 * Both use the same shape: `hooks -> EventName -> [{ matcher?, hooks: [{ type:
 * "command", command, timeout }] }]` (Claude Code: https://code.claude.com/docs/en/hooks;
 * Codex: https://learn.chatgpt.com/docs/hooks). Install merges: an existing
 * entry for another command is kept; a command Coherence wrote earlier is
 * replaced, and only a command that names this tool's binary or its own cli
 * path counts as Coherence's; everything outside `hooks` is untouched. No
 * hook that is not ours is ever deleted.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { HOOK_EVENTS, type HookEvent } from "./hook.ts";
import { HOSTS, SETTINGS_FILE, isHost, type Host } from "./project.ts";

// Where each host keeps its settings, and which hosts there are, live in the project
// layer: the hook reads them to know which tree it was installed for.
export { HOSTS, SETTINGS_FILE, isHost, type Host };

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

/**
 * A command is Coherence's when the program it runs is this tool's binary
 * (`coherence`, bare or at the end of a path such as node_modules/.bin) or
 * this tool's own cli path (`src/cli.ts`, as Coherence's own checkout wires
 * it), followed by `hook <Event>`. A stranger's cli.ts, or a program whose
 * name merely contains "coherence", is never ours and is never touched.
 */
const MINE = new RegExp(`(?:^|[\\s"'/])(?:coherence|src/cli\\.ts)"?\\s+hook\\s+(?:${HOOK_EVENTS.join("|")})\\s*$`);

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
    // Our own command leaves every entry it is in; an entry that still holds another tool's hook stays, as it was, without ours.
    const kept = existing.flatMap((entry) => {
      if (!isCoherenceEntry(entry)) return [entry];
      const theirs = entry.hooks.filter((h) => !isMine(h.command));
      return theirs.length === 0 ? [] : [{ ...entry, hooks: theirs }];
    });
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
