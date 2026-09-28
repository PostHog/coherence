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
 *
 * Uninstall is the same ownership rule run the other way: every command that
 * is ours leaves, and an entry, an event list, or a `hooks` object that this
 * removal emptied goes with it; everything else stays where it was. The check
 * compares what is installed with what install would write, event by event,
 * and names each drift: missing, stale, or an extra entry of ours. Install
 * and uninstall keep the file's indentation and final newline and write
 * nothing when nothing changed, so a round trip gives back the adopter's file.
 *
 * An adopter's hook finds Coherence rather than depending on it: Coherence is
 * a checkout run from outside the project, never a package in the project's
 * node_modules, so a pnpm lockfile and its tree are never touched (an `npm
 * link` there installed a second dependency tree and broke a pnpm build).
 * The command walks up to the project root and looks, in order, at
 * $COHERENCE_HOME, a `coherence` folder beside the project, one beside the
 * main checkout when the project is a git worktree, and last the project's
 * node_modules/.bin/coherence. The committed command names no one's absolute
 * path, so it is the same on every teammate's machine and the check agrees
 * across them. When nothing is found, or node is not on the PATH, the hook
 * prints one line as a systemMessage (both hosts show it to the user), exits
 * 0, and does nothing else.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { HOOK_EVENTS, type HookEvent } from "./hook.ts";
import { HOSTS, PACKAGE_NAME, SETTINGS_FILE, isHost, type Host } from "./project.ts";

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
 * (`coherence`, bare, at the end of a path such as node_modules/.bin, or the
 * `$coherence` the located command runs) or this tool's own cli path
 * (`src/cli.ts`, as Coherence's own checkout wires it), followed by `hook
 * <Event>`. A stranger's cli.ts, or a program whose name merely contains
 * "coherence", is never ours and is never touched.
 */
const MINE = new RegExp(`(?:^|[\\s"'/$])(?:coherence|src/cli\\.ts)"?\\s+hook\\s+(?:${HOOK_EVENTS.join("|")})\\s*$`);

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

/** The variable that names a checkout of Coherence outside the default places. */
export const HOME_VAR = "COHERENCE_HOME";

/** The folder name the hooks look for beside the project. */
export const SIBLING = "coherence";

/** Walk up from the host's project dir (or cwd) to the folder that holds a host's settings. */
const ROOT_WALK =
  'root="${CLAUDE_PROJECT_DIR:-$PWD}"; while [ "$root" != / ] && [ ! -f "$root/.claude/settings.json" ] && [ ! -f "$root/.codex/hooks.json" ]; do root=$(dirname "$root"); done';

/**
 * Shell that sets `$coherence` to the cli to run, or to nothing: $COHERENCE_HOME,
 * the sibling folder, the sibling of a worktree's main checkout, the installed
 * package's own cli, then the project's own bin. The package's cli comes
 * before the bin because a package manager may write the bin as a shell shim
 * that node cannot run. Nothing here names a path on one machine.
 */
export const LOCATE = [
  ROOT_WALK,
  'main=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)',
  "coherence=",
  `for c in "\${${HOME_VAR}:+\$${HOME_VAR}/src/cli.ts}" "$root/../${SIBLING}/src/cli.ts" "\${main:+\${main%/*}/../${SIBLING}/src/cli.ts}" "$root/node_modules/${PACKAGE_NAME}/dist/cli.js" "$root/node_modules/.bin/coherence"; do if [ -n "$c" ] && [ -f "$c" ]; then coherence=$c; break; fi; done`,
].join("; ");

/** The one line a hook prints when it cannot reach Coherence. No apostrophes: it sits in single quotes. */
export const NOT_INSTALLED = `Coherence is not installed for this project, so this hook did nothing. To install it, run npm install -D github:PostHog/coherence in the project, clone the repository beside the project as ../${SIBLING} and run npm ci in the clone, or set ${HOME_VAR} to a checkout.`;

/** The one line a hook prints when Coherence is there but node is not. */
export const NO_NODE = "Coherence was found but node is not on the PATH this hook runs with, so this hook did nothing. Install Node 22.18 or newer.";

function softExit(message: string): string {
  return `printf '%s\\n' '${JSON.stringify({ systemMessage: message })}'; exit 0`;
}

/**
 * The default prefix for an adopter: locate Coherence, fail softly when it is
 * not there, and otherwise run it as before (`hook <Event>` follows), so a
 * found Coherence answers, and refuses, exactly as a direct command would.
 */
export const LOCATED_PREFIX = `${LOCATE}; if [ -z "$coherence" ]; then ${softExit(NOT_INSTALLED)}; fi; if ! command -v node >/dev/null 2>&1; then ${softExit(NO_NODE)}; fi; exec node "$coherence"`;

/** Where the located command would find Coherence from `root`, under `env`; undefined when it would find nothing. */
export function locate(root: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const run = spawnSync("sh", ["-c", `${LOCATE}; printf '%s' "$coherence"`], { cwd: root, env: { ...env, CLAUDE_PROJECT_DIR: root }, encoding: "utf8" });
  const found = run.status === 0 ? run.stdout : "";
  return found === "" ? undefined : found;
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

/** A settings file as read: its value, and the layout a rewrite keeps. */
interface SettingsFile {
  exists: boolean;
  value: Record<string, unknown>;
  indent: string | number;
  trailingNewline: boolean;
}

/** The indentation of the first indented key, or two spaces for a file that has none. */
function indentationOf(text: string): string | number {
  return text.match(/^([\t ]+)"/m)?.[1] ?? 2;
}

async function readSettingsFile(path: string): Promise<SettingsFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { exists: false, value: {}, indent: 2, trailingNewline: true };
  }
  const layout = { exists: true, indent: indentationOf(text), trailingNewline: text === "" || text.endsWith("\n") };
  if (text.trim() === "") return { ...layout, value: {} };
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error(`${path}: expected a JSON object`);
  return { ...layout, value: parsed };
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  return (await readSettingsFile(path)).value;
}

/** Write `value` in the file's own layout, and only when it differs from what is there. */
async function writeSettings(path: string, file: SettingsFile, value: Record<string, unknown>): Promise<boolean> {
  if (file.exists && isDeepStrictEqual(file.value, value)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, file.indent) + (file.trailingNewline ? "\n" : ""));
  return true;
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

/** The one entry install writes for an event: the merge writes it and the check compares against it. */
export function installedEntry(options: Pick<InstallOptions, "command" | "host">, event: HookEvent): HookEntry {
  const handler: HookCommand = { type: "command", command: hookCommand(options.command, event), timeout: TIMEOUT_SECONDS };
  if (options.host === "codex" && START_EVENTS.has(event)) handler["additionalContextLimit"] = CODEX_CONTEXT_LIMIT;
  return { hooks: [handler] };
}

/** The merged settings: pure, so the merge can be tested without a disk. */
export function mergeHooks(settings: Record<string, unknown>, options: Pick<InstallOptions, "command" | "host">): Record<string, unknown> {
  const hooks = hooksOf(settings);
  for (const event of HOOK_EVENTS) {
    const mine = installedEntry(options, event);
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
  /** False when the file already held exactly what install writes. */
  changed: boolean;
}

export async function install(options: InstallOptions): Promise<InstallResult> {
  const path = resolve(options.root, SETTINGS_FILE[options.host]);
  const file = await readSettingsFile(path);
  const merged = mergeHooks(file.value, options);
  const changed = await writeSettings(path, file, merged);
  return { path, events: [...HOOK_EVENTS], changed };
}

/** One command of ours, by the event it sits under. */
export interface OwnedCommand {
  event: string;
  command: string;
}

/**
 * The settings with every command of ours removed: pure. An entry, an event
 * list, or the `hooks` object goes only when this removal emptied it; one
 * that was empty before stays, and so does every hook that is not ours, in
 * its place and with its matcher. Ownership is the command, wherever it sits.
 */
export function stripHooks(settings: Record<string, unknown>): { settings: Record<string, unknown>; removed: OwnedCommand[] } {
  const removed: OwnedCommand[] = [];
  if (settings["hooks"] === undefined) return { settings, removed };
  const hooks = hooksOf(settings);
  const next: HooksByEvent = {};
  for (const [event, entries] of Object.entries(hooks)) {
    let emptiedByUs = false;
    const kept = entries.flatMap((entry) => {
      if (!isCoherenceEntry(entry)) return [entry];
      for (const h of entry.hooks) if (isMine(h.command)) removed.push({ event, command: h.command });
      const theirs = entry.hooks.filter((h) => !isMine(h.command));
      if (theirs.length === 0) emptiedByUs = true;
      return theirs.length === 0 ? [] : [{ ...entry, hooks: theirs }];
    });
    if (emptiedByUs && kept.length === 0) continue;
    next[event] = kept;
  }
  if (removed.length === 0) return { settings, removed };
  const rest = { ...settings };
  if (Object.keys(next).length === 0) delete rest["hooks"];
  else rest["hooks"] = next;
  return { settings: rest, removed };
}

export interface UninstallResult {
  path: string;
  /** The commands of ours that were removed; empty when there were none. */
  removed: OwnedCommand[];
  changed: boolean;
}

/** Remove what install wrote for a host, and nothing else; a second pass changes nothing. */
export async function uninstall(root: string, host: Host): Promise<UninstallResult> {
  const path = resolve(root, SETTINGS_FILE[host]);
  const file = await readSettingsFile(path);
  if (!file.exists) return { path, removed: [], changed: false };
  const { settings, removed } = stripHooks(file.value);
  const changed = removed.length > 0 && (await writeSettings(path, file, settings));
  return { path, removed, changed };
}

export function formatUninstall(host: Host, result: UninstallResult): string {
  if (result.removed.length === 0) return `${host}: ${result.path}: no Coherence hook installed; nothing changed\n`;
  const events = [...new Set(result.removed.map((r) => r.event))];
  return `${host}: removed ${result.removed.length} Coherence hook${result.removed.length === 1 ? "" : "s"} from ${result.path}: ${events.join(", ")}\n`;
}

/** One way the installed hooks differ from what install would write. */
export type Drift =
  | { event: string; kind: "missing"; expected: string }
  | { event: string; kind: "stale"; expected: string; found: string; differences: string[] }
  | { event: string; kind: "extra"; found: string; reason: string };

export interface CheckResult {
  host: Host;
  path: string;
  present: boolean;
  drift: Drift[];
}

function show(value: unknown): string {
  return value === undefined ? "absent" : JSON.stringify(value);
}

/** What differs between an installed entry of ours and the entry install writes, field by field. */
function differences(found: HookEntry, expected: HookEntry): string[] {
  const out: string[] = [];
  const ours = found.hooks.filter((h) => isMine(h.command));
  const handler = ours[0]!;
  const want = expected.hooks[0]!;
  for (const key of new Set([...Object.keys(want), ...Object.keys(handler)])) {
    if (!isDeepStrictEqual(handler[key], want[key])) out.push(`${key}: installed ${show(handler[key])}; install would write ${show(want[key])}`);
  }
  if (ours.length > 1) out.push(`the entry holds ${ours.length} commands of ours; install writes one`);
  if (found.hooks.length > ours.length) out.push(`the entry is shared with ${found.hooks.length - ours.length} other hook${found.hooks.length - ours.length === 1 ? "" : "s"}; install writes an entry of its own`);
  for (const key of Object.keys(found)) {
    if (key !== "hooks") out.push(`entry field ${key}: installed ${show(found[key])}; install writes none`);
  }
  return out;
}

/**
 * The drift between a settings value and what install would write: pure.
 * Every event install wires must hold exactly one entry of ours, equal to the
 * entry install writes; anything else of ours is named: missing, stale (each
 * field that differs), or extra (a second entry of ours for an event, or one
 * under an event install never wires).
 */
export function driftOf(settings: Record<string, unknown>, options: Pick<InstallOptions, "command" | "host">): Drift[] {
  const hooks = hooksOf(settings);
  const drift: Drift[] = [];
  const wired: ReadonlySet<string> = new Set(HOOK_EVENTS);
  for (const event of HOOK_EVENTS) {
    const expected = installedEntry(options, event);
    const want = expected.hooks[0]!.command;
    const ours = (hooks[event] ?? []).filter(isCoherenceEntry);
    if (ours.length === 0) {
      drift.push({ event, kind: "missing", expected: want });
      continue;
    }
    const exact = ours.findIndex((entry) => isDeepStrictEqual(entry, expected));
    const primary = exact === -1 ? 0 : exact;
    ours.forEach((entry, index) => {
      const found = entry.hooks.find((h) => isMine(h.command))!.command;
      if (index !== primary) drift.push({ event, kind: "extra", found, reason: "a second entry of ours for this event" });
      else if (exact === -1) drift.push({ event, kind: "stale", expected: want, found, differences: differences(entry, expected) });
    });
  }
  for (const [event, entries] of Object.entries(hooks)) {
    if (wired.has(event)) continue;
    for (const entry of entries.filter(isCoherenceEntry)) {
      for (const h of entry.hooks.filter((h) => isMine(h.command))) {
        drift.push({ event, kind: "extra", found: h.command, reason: "install wires no hook for this event" });
      }
    }
  }
  return drift;
}

/** Compare one host's installed hooks with what install would write with this command prefix. */
export async function check(root: string, host: Host, command: string): Promise<CheckResult> {
  const path = resolve(root, SETTINGS_FILE[host]);
  const file = await readSettingsFile(path);
  return { host, path, present: file.exists, drift: driftOf(file.value, { command, host }) };
}

export function formatCheck(result: CheckResult): string {
  if (result.drift.length === 0) {
    return `${result.host}: ${result.path}: all ${HOOK_EVENTS.length} events match what install would write\n`;
  }
  const events = new Set(result.drift.map((d) => d.event)).size;
  const lines = [`${result.host}: ${result.path}${result.present ? "" : " (absent)"}: ${events} event${events === 1 ? "" : "s"} drifted from what install would write`];
  for (const d of result.drift) {
    if (d.kind === "missing") lines.push(`  ${d.event}: missing; install would write: ${d.expected}`);
    else if (d.kind === "stale") lines.push(`  ${d.event}: stale`, ...d.differences.map((line) => `    ${line}`));
    else lines.push(`  ${d.event}: extra Coherence entry (${d.reason}): ${d.found}`);
  }
  lines.push(`converge with: hooks install --host ${result.host}`);
  return lines.join("\n") + "\n";
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
