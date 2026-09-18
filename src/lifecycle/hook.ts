/**
 * The hook: what each harness event injects or answers.
 *
 * SessionStart and SubagentStart carry orient's first slice: any escalation
 * awaiting a human first (an escalation heads every read), then the compact
 * glossary, then the session id as the exact --session value every journal
 * write must carry, a decide template, and a short fixed instruction. Both
 * hosts read it from `hookSpecificOutput.additionalContext`.
 * Stop and SubagentStop run the glossary check over the files changed in the
 * working tree. On Stop the findings are shown to the human and the session
 * ends. On SubagentStop a rejected name in a changed file, a spec problem, or
 * a structural defect refuses the stop: exit 2 with the reason on stderr,
 * which both hosts read as "continue, and here is why" (Claude Code:
 * https://code.claude.com/docs/en/hooks; Codex: https://learn.chatgpt.com/docs/hooks).
 * An unknown noun is a nomination, reported and never refused. A debt the
 * session has recorded as unable, naming the file, the name, or the
 * invariant, is advisory: the wall is on record and the reader decides.
 * A stop hook that is already active (`stop_hook_active`) never refuses again,
 * so a subagent cannot be held forever.
 * The Stop snapshot of the read trace reaches the instrument the same way the
 * run does, through enforcement's one door to the warm server, so a
 * production snapshot carries hops rather than a hop-less closure.
 * PostToolUse for a file-writing tool is revelation at the edit: the
 * chokepoint invariants that may involve the written file are re-checked
 * through the warm server, and a bypass is printed as additionalContext so
 * the agent sees the structural defect in the same turn, with the two
 * honest options. Stop and SubagentStop also carry the structural defects
 * the latest run left; one refuses a subagent stop.
 * The session's work order rides with orient and regulate: the start prints
 * the active order the session owns (objective, success, boundary) and the
 * rule that maintenance outside the boundary is not this session's to do;
 * the stop says the order is still active and how it is closed.
 * UserPromptSubmit and PostToolUse carry the peer feed: the subjects of what
 * other sessions recorded since this session's cursor, never full records.
 * The cursor advances only after the feed was handed to the host: runHook
 * renders and returns the advance as `commit`, and the command line calls it
 * once its stdout write has succeeded, never before.
 * The root of every event is confined to the project the hook was installed
 * for: the harness names the working directory on stdin, and a cwd outside
 * that tree is refused with exit 78 rather than read or written.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { formatReport, hasFindings, runCheck, type CheckReport } from "./check.ts";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import { mayTouch, performRun, withWarmAdapter } from "../enforcement/run.ts";
import { openFeed, peerFeed } from "../journal/feed.ts";
import { openEscalations } from "../journal/read.ts";
import { recordReadTrace, snapshotTrace } from "../economy/trace.ts";
import { loadSpecModel, type SpecModel } from "../spec/model.ts";
import { loadJournal } from "../journal/store.ts";
import type { Unable } from "../journal/record.ts";
import { loadOrders, ownedIn, type WorkOrder } from "../journal/work.ts";
import { renderCompactWithin } from "./glossary.ts";
import { installedRoot, isCoherenceItself, loadProjectGlossaries, within } from "./project.ts";

const run = promisify(execFile);

export const HOOK_EVENTS = [
  "SessionStart",
  "SubagentStart",
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
  "SubagentStop",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(name: string): name is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(name);
}

/** The exit code both hosts read as a refusal with the reason on stderr. */
export const REFUSE_EXIT = 2;

/**
 * The exit code for an event whose cwd is not inside the project root this
 * hook was installed for (sysexits EX_CONFIG). Not the refusal code: the
 * agent is told nothing and held on nothing, because the event was not this
 * project's to answer.
 */
export const OUTSIDE_ROOT_EXIT = 78;

/**
 * The most characters a start injection may carry. Claude Code replaces hook
 * output over 10,000 characters with a file preview; Codex spills context over
 * a default 2,500-token threshold (about 10,000 characters at four per token).
 * The instruction rides inside this budget.
 */
export const CONTEXT_BUDGET = 9_500;

/** The rule; with the session block above it the whole tail stays under 120 words. */
export const INSTRUCTION = [
  "Use these names. A rejected name in prose, a spec, a journal record, or an",
  "identifier is a defect: replace it. A new noun the glossary lacks must be",
  "declared there as a concept, or mapped as an alias of an existing concept,",
  "before this session ends. Coherence's names describe the tool; the",
  "project's names describe its domain, and inside the project its sense wins.",
].join(" ");

/** The agent name a journal write carries when the harness names none: the main thread. */
const MAIN_AGENT = "main";

export interface HookInput {
  cwd?: string;
  session_id?: string;
  agent_type?: string;
  stop_hook_active?: boolean;
  [key: string]: unknown;
}

export interface HookResult {
  stdout: string;
  stderr: string;
  exit: number;
  /**
   * The advance to make once `stdout` has reached the host: the feed cursor
   * moves past what the text covered. Present only when a feed was rendered;
   * the caller that prints is the one that commits, after its write succeeded.
   */
  commit?: () => void;
}

export interface ChangedFiles {
  /** Modified against HEAD plus untracked; empty when git could not answer. */
  files: string[];
  /** Why git could not answer, when it could not: the command and git's own reason. Absent when it answered. */
  failure?: string;
}

/** The most bytes one git listing may carry before it is a failure worth reporting rather than a truncated answer. */
const GIT_LISTING_LIMIT = 64 * 1024 * 1024;

/**
 * Files changed in the working tree at `root`: modified against HEAD plus
 * untracked. Outside a repository the answer is no files, since there is no
 * tree to be clean or dirty; any other failure is reported, never read as a
 * clean tree.
 */
export async function changedFiles(root: string): Promise<ChangedFiles> {
  const listings: string[] = [];
  for (const args of [["diff", "--name-only", "HEAD"], ["ls-files", "--others", "--exclude-standard"]]) {
    try {
      listings.push((await run("git", args, { cwd: root, maxBuffer: GIT_LISTING_LIMIT })).stdout);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (/not a git repository/i.test(raw)) return { files: [] };
      const reason = raw.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("Command failed")) ?? raw;
      return { files: [], failure: `git ${args.join(" ")} failed: ${reason}` };
    }
  }
  const all = listings.join("\n").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return { files: [...new Set(all)] };
}

/** Escalations no human has acknowledged, under a heading, or nothing. Never shortened: a human must see them whole. */
export function escalationBlock(root: string): string {
  const open = openEscalations(loadJournal(root).records);
  if (open.length === 0) return "";
  const lines = [`Escalations awaiting a human (${open.length}); answer one with: acknowledge <id> --because "<what the human decided>"`];
  for (const e of open) lines.push(`▲ ${e.id}  ${e.agent}  ${e.what} — ${e.because}`);
  return lines.join("\n") + "\n\n";
}

function sessionOf(input: HookInput): string | undefined {
  return typeof input.session_id === "string" && input.session_id !== "" ? input.session_id : undefined;
}

function agentOf(input: HookInput): string {
  return typeof input.agent_type === "string" && input.agent_type !== "" ? input.agent_type : MAIN_AGENT;
}

/** The walls this session recorded as unable: a debt one of them names is advisory at the stop, never refused. */
function unableWalls(root: string, input: HookInput): Unable[] {
  const session = sessionOf(input);
  if (session === undefined) return [];
  return loadJournal(root).records.filter((r): r is Unable => r.kind === "unable" && r.session === session);
}

/** The unable record whose text names one of the keys, when one does: the wall that stands between the session and this debt. */
function excusedBy(walls: readonly Unable[], keys: readonly string[]): Unable | undefined {
  const wanted = keys.map((k) => k.toLowerCase()).filter((k) => k !== "");
  return walls.find((wall) => {
    const text = `${wall.what}\n${wall.because}`.toLowerCase();
    return wanted.some((k) => text.includes(k));
  });
}

const ADVISORY = (wall: Unable): string => `advisory: recorded unable ${wall.id} (${wall.what})`;

/** The rule an owning session reads at orient. */
export const BOUNDARY_RULE = "Maintenance outside the boundary is not this session's to do: record it (unable, defect, conjecture) and leave it.";

function orderLines(order: WorkOrder): string[] {
  return [`  objective: ${order.objective}`, `  success:   ${order.success}`, `  boundary:  ${order.boundary}`];
}

/** The work orders the session owns, for orient: the active one it binds to, or why nothing binds, and an open one it has not taken up. */
export function workBlock(root: string, input: HookInput): string {
  const session = sessionOf(input);
  if (session === undefined) return "";
  const orders = loadOrders(root);
  const active = ownedIn(orders, session, "active");
  const open = ownedIn(orders, session, "open");
  if (active.length === 0 && open.length === 0) return "";
  const agent = agentOf(input);
  const lines: string[] = [];
  if (active.length === 1) {
    const order = active[0]!;
    lines.push(`Work order ${order.id} (active; every journal write and run this session makes binds to it):`, ...orderLines(order), `  ${BOUNDARY_RULE}`);
  } else if (active.length > 1) {
    lines.push(`This session owns ${active.length} active work orders, so nothing binds by inference; pass --work <id> on each write:`);
    for (const order of active) lines.push(`  ${order.id}  ${order.objective}`);
    lines.push(`  ${BOUNDARY_RULE}`);
  }
  for (const order of open) {
    lines.push(`Work order ${order.id} is open, not active; nothing binds to it until: work move ${order.id} active --because "<taking it up>" --session ${session} --agent ${agent}`, ...orderLines(order));
  }
  return lines.join("\n") + "\n\n";
}

/** What regulate says about an order still active at the stop: it is closed with work close, and nothing else closes it. */
export function workStopText(root: string, input: HookInput): string {
  const session = sessionOf(input);
  if (session === undefined) return "";
  const active = ownedIn(loadOrders(root), session, "active");
  if (active.length === 0) return "";
  const agent = agentOf(input);
  return active
    .map((order) => `Work order ${order.id} is still active (${order.objective}). When its success criterion holds, close it: work close ${order.id} --because "<what was done>" --session ${session} --agent ${agent}`)
    .join("\n");
}

/** How a session at this root invokes the tool: its own source tree, or the installed bin. */
async function cliName(root: string): Promise<string> {
  return (await isCoherenceItself(root)) ? "node src/cli.ts" : "node_modules/.bin/coherence";
}

/** The session id as the exact --session value, a decide template, and the rule. */
export async function sessionBlock(root: string, input: HookInput): Promise<string> {
  const session = sessionOf(input);
  const agent = agentOf(input);
  const cli = await cliName(root);
  const id = session ?? "<the id your harness shows>";
  return [
    `Session: ${session ?? "unknown"}`,
    `Every journal write needs --session ${id} --agent ${agent}. Record a choice as:`,
    `  ${cli} decide "<chose>" --over "<rejected>" --because "<why>" --session ${id} --agent ${agent}`,
    INSTRUCTION,
  ].join("\n") + "\n";
}

const OPEN_REQUIREMENT_LINES = 12;

function specModelOrNull(root: string): SpecModel | { error: string } {
  try {
    return loadSpecModel(root);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Requirements still short of invariant, and grammar problems, for orient. */
export function specBlock(root: string): string {
  const model = specModelOrNull(root);
  if ("error" in model) return `Spec: not readable (${model.error})\n\n`;
  if (model.components.length === 0) return "";
  const open = model.components.flatMap((c) => c.invariants.filter((i) => i.state === "requirement").map((i) => ({ c, i })));
  const lines: string[] = [];
  if (model.problems.length > 0) lines.push(`Spec problems (${model.problems.length}); run: spec --check`);
  if (open.length > 0) {
    lines.push(`Open requirements (${open.length} of ${model.counts.bullets} bullets). A requirement becomes an invariant when it has enforcement, a witnessed refutation, and its checklist; scaffold prints the shape.`);
    for (const { c, i } of open.slice(0, OPEN_REQUIREMENT_LINES)) lines.push(`○ ${c.folder}/${i.name} — lacks: ${i.lacks.join(", ")}`);
    if (open.length > OPEN_REQUIREMENT_LINES) lines.push(`  and ${open.length - OPEN_REQUIREMENT_LINES} more; run: spec --check`);
  }
  return lines.length === 0 ? "" : lines.join("\n") + "\n\n";
}

export interface SpecDebt {
  text: string;
  problems: number;
  defects: number;
  /** Problems and structural defects no unable record of the session names: what a subagent stop is refused for. */
  owed: number;
}

/**
 * What the spec owes at stop: problems and structural defects refuse a
 * subagent stop, unless the session recorded unable naming the spec file or
 * the invariant, which makes that item advisory; open requirements are shown
 * and left to the human.
 */
export function specStopText(root: string, changed: readonly string[] = [], walls: readonly Unable[] = []): SpecDebt {
  const model = specModelOrNull(root);
  if ("error" in model) return { text: `Spec: not readable (${model.error})`, problems: 0, defects: 0, owed: 0 };
  if (model.components.length === 0) return { text: "", problems: 0, defects: 0, owed: 0 };
  const touched = new Set(changed.map((p) => p.split(sep).join("/")));
  const open = model.components.flatMap((c) => c.invariants.filter((i) => i.state === "requirement").map((i) => ({ c, i })));
  const broken = model.components.flatMap((c) => c.invariants.filter((i) => i.state === "structural defect").map((i) => ({ c, i })));
  const mine = open.filter(({ c }) => touched.has(c.specPath));
  const lines: string[] = [];
  let owed = 0;
  for (const p of model.problems) {
    const wall = excusedBy(walls, [p.file]);
    if (wall === undefined) owed += 1;
    lines.push(`PROBLEM  ${p.file}:${p.line}  ${p.message}${wall === undefined ? "" : `\n         ${ADVISORY(wall)}`}`);
  }
  for (const { c, i } of broken) {
    const wall = excusedBy(walls, [`${c.folder}/${i.name}`, i.name]);
    if (wall === undefined) owed += 1;
    for (const d of i.defects) lines.push(`✕ ${c.folder}/${i.name} — structural defect (${d.form}, run ${d.at.slice(0, 10)}): ${d.reason}${wall === undefined ? "" : `\n  ${ADVISORY(wall)}`}`);
  }
  if (broken.length > 0) lines.push(`A structural defect stands until the reference is routed through the chokepoint or a human acknowledges a retirement (escalate, then acknowledge).`);
  for (const { c, i } of mine.slice(0, OPEN_REQUIREMENT_LINES)) lines.push(`○ ${c.folder}/${i.name} — still a requirement; lacks: ${i.lacks.join(", ")}`);
  if (mine.length > OPEN_REQUIREMENT_LINES) lines.push(`  and ${mine.length - OPEN_REQUIREMENT_LINES} more in specs this session changed`);
  if (open.length > 0) lines.push(`${open.length} requirement${open.length === 1 ? "" : "s"} open in the project${mine.length > 0 ? `, ${mine.length} in specs this session changed` : ""}; run: spec --check`);
  return { text: lines.join("\n"), problems: model.problems.length, defects: broken.length, owed };
}

/**
 * The glossary check over the changed files at stop, as text, and what of it
 * is owed: a rejected name refuses a subagent stop unless the session
 * recorded unable naming the file or the name; an unknown noun is a
 * nomination the tool cannot prove, so it is reported and never refused.
 */
export function glossaryStopText(report: CheckReport | undefined, walls: readonly Unable[] = []): { text: string; owed: number } {
  if (report === undefined || !hasFindings(report)) return { text: "", owed: 0 };
  const lines = formatReport(report).trimEnd().split("\n");
  let owed = 0;
  const out: string[] = [];
  let next = 0;
  for (const line of lines) {
    out.push(line);
    if (!line.startsWith("REJECTED NAME")) continue;
    const finding = report.rejected[next];
    next += 1;
    if (finding === undefined) continue;
    const wall = excusedBy(walls, [finding.file, finding.name]);
    if (wall === undefined) owed += 1;
    else out.push(`               ${ADVISORY(wall)}`);
  }
  return { text: out.join("\n") + "\n", owed };
}

/** Tools that read a file and name it the same way a writing tool does. */
const READING_TOOLS: ReadonlySet<string> = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "read_file", "list_files", "search"]);

/** The project-relative path a tool event wrote, or undefined when the event wrote no file under the root. */
export function writtenFile(root: string, input: HookInput): string | undefined {
  if (typeof input.tool_name === "string" && READING_TOOLS.has(input.tool_name)) return undefined;
  const toolInput = input.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const record = toolInput as Record<string, unknown>;
  const path = [record["file_path"], record["notebook_path"], record["path"]].find((v): v is string => typeof v === "string" && v !== "");
  if (path === undefined) return undefined;
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const rel = relative(resolve(root), absolute).split(sep).join("/");
  if (rel === "" || rel.startsWith("../") || rel === "..") return undefined;
  return rel;
}

/**
 * Revelation at the edit: re-check the chokepoint invariants the written file
 * may involve and describe any structural defect, or nothing.
 */
export async function editContext(root: string, input: HookInput, options: HookOptions = {}): Promise<string> {
  const file = writtenFile(root, input);
  if (file === undefined) return "";
  const model = specModelOrNull(root);
  if ("error" in model || model.components.length === 0) return "";
  const absolute = resolve(root, file);
  const text = existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
  const touched = model.components.flatMap((c) => c.invariants.filter((i) => i.enforcements.some((e) => e.form === "chokepoint") && mayTouch(i, file, text)).map((i) => i.name));
  if (touched.length === 0) return "";
  const session = sessionOf(input) ?? "unknown-session";
  const agent = agentOf(input);
  const outcome = await performRun(root, { session, agent, form: "chokepoint", invariants: touched, model, adapter: options.adapter, refresh: [file] });
  if (outcome.instrumentReason !== undefined) return `Coherence could not check ${touched.length} chokepoint invariant${touched.length === 1 ? "" : "s"} at this edit: ${outcome.instrumentReason}\n`;
  const failed = outcome.details.filter((d) => d.entry.verdict === "fail");
  if (failed.length === 0) return "";
  const cli = (await isCoherenceItself(root)) ? "node src/cli.ts" : "node_modules/.bin/coherence";
  const lines = [`Structural defect revealed at this edit (${file}); recorded in ${outcome.file ?? "the run"}:`];
  for (const d of failed) {
    const e = d.entry;
    const here = e.bypasses.filter((b) => b.file === file);
    const elsewhere = e.bypasses.length - here.length;
    lines.push(`✕ ${e.component}/${e.name} — chokepoint ${d.chokepoint?.input.chokepoint ?? ""} protects ${d.chokepoint?.input.protects ?? ""}: ${e.grade ?? "broken"}`);
    for (const b of here) lines.push(`    bypass ${b.file}:${b.line} in ${b.symbol} (this edit)`);
    if (elsewhere > 0) lines.push(`    ${elsewhere} bypass${elsewhere === 1 ? "" : "es"} elsewhere: ${e.bypasses.filter((b) => b.file !== file).map((b) => `${b.file}:${b.line} in ${b.symbol}`).join(", ")}`);
    if (e.bypasses.length === 0) lines.push(`    ${e.reason}`);
  }
  lines.push("Two honest options: route the reference through the chokepoint, or escalate a retirement for a human, who must acknowledge it:");
  lines.push(`  ${cli} escalate "retire <invariant>" --because "<what changed and why the chokepoint no longer holds>" --session ${session} --agent ${agent}`);
  lines.push("The invariant stays in force, and alarming, until a person acknowledges.");
  return lines.join("\n") + "\n";
}

/**
 * The start injection: escalations (never shortened), what the spec and the
 * work orders owe, the vocabulary at the richest level that leaves the whole
 * under the budget, and the session block. When the escalations alone crowd
 * the budget, the vocabulary steps down to names and then to one line that
 * points at the glossary command.
 */
export async function startContext(root: string, input: HookInput = {}): Promise<string> {
  const { coherence, project } = await loadProjectGlossaries(root);
  const head = escalationBlock(root) + specBlock(root) + workBlock(root, input);
  const tail = `\n${await sessionBlock(root, input)}`;
  const { text } = renderCompactWithin(coherence, project, CONTEXT_BUDGET - head.length - tail.length, await cliName(root));
  return head + text + tail;
}

/** The feed for a boundary event: the text to inject and the advance to commit once it is in the host's hands. */
export function feedContext(root: string, input: HookInput): { text: string; commit: () => void } {
  const session = sessionOf(input);
  if (session === undefined) return { text: "", commit: () => {} };
  return peerFeed(root, session);
}

async function checkChanged(root: string, paths: readonly string[]): Promise<CheckReport | undefined> {
  if (paths.length === 0) return undefined;
  const { coherence, project } = await loadProjectGlossaries(root);
  return runCheck({ root, paths: [...paths], coherence, project });
}

/**
 * The one door to the warm instrument, as enforcement exports it. The hook
 * holds it as a value so a test can stand a fake in its place; production
 * never passes one and gets the real door.
 */
export type WarmDoor = typeof withWarmAdapter;

export const WARM_DOOR: WarmDoor = withWarmAdapter;

export interface HookOptions {
  /** An adapter to check with instead of the warm server (tests). */
  adapter?: LanguageAdapter | undefined;
  /** The door to the warm instrument; enforcement's own by default. */
  door?: WarmDoor | undefined;
}

/**
 * The read-trace snapshot at a stop, with an instrument. A test hands its own
 * adapter in; production has none of its own, so the snapshot goes through
 * enforcement's one door to the warm server and the closure it predicts is
 * computed through references rather than skipped. A door that cannot connect
 * hands back its reason, which the snapshot records as the instrument it had.
 */
async function snapshotAtStop(root: string, session: string, changed: readonly string[], options: HookOptions): Promise<void> {
  if (options.adapter !== undefined) {
    await snapshotTrace(root, session, { adapter: options.adapter, changed });
    return;
  }
  const door = options.door ?? WARM_DOOR;
  await door(root, (adapter, server, reason) => snapshotTrace(root, session, { adapter, server, instrumentReason: reason, changed }));
}

/** Run one event. `input` is the parsed stdin the host sent; `root` defaults to its cwd. */
export async function runHook(event: HookEvent, input: HookInput, fallbackRoot: string, options: HookOptions = {}): Promise<HookResult> {
  const project = installedRoot(fallbackRoot);
  const given = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : fallbackRoot;
  // The cwd arrives on stdin from the harness; a tree that is not the one this hook was installed for is none of its business.
  if (project !== undefined && !within(project, given)) {
    return { stdout: "", stderr: `hook ${event}: the working directory "${given}" is not inside the project root this hook was installed for (${project}); nothing was read and nothing was written\n`, exit: OUTSIDE_ROOT_EXIT };
  }
  const root = given;
  switch (event) {
    case "SessionStart":
    case "SubagentStart": {
      const context = await startContext(root, input);
      const session = sessionOf(input);
      if (session !== undefined) openFeed(root, session);
      const stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
      return { stdout: stdout + "\n", stderr: "", exit: 0 };
    }
    case "UserPromptSubmit":
    case "PostToolUse": {
      const feed = feedContext(root, input);
      if (event === "PostToolUse" && typeof input.session_id === "string" && input.session_id !== "") recordReadTrace(root, input.session_id, input);
      const edit = event === "PostToolUse" ? await editContext(root, input, options) : "";
      const context = feed.text + (feed.text !== "" && edit !== "" ? "\n" : "") + edit;
      if (context === "") return { stdout: "", stderr: "", exit: 0 };
      const stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
      return feed.text === "" ? { stdout: stdout + "\n", stderr: "", exit: 0 } : { stdout: stdout + "\n", stderr: "", exit: 0, commit: feed.commit };
    }
    case "Stop":
    case "SubagentStop": {
      const changed = await changedFiles(root);
      const report = await checkChanged(root, changed.files);
      if (typeof input.session_id === "string" && input.session_id !== "") await snapshotAtStop(root, input.session_id, changed.files, options);
      const walls = unableWalls(root, input);
      const spec = specStopText(root, changed.files, walls);
      const glossary = glossaryStopText(report, walls);
      const workText = workStopText(root, input);
      const changedText = changed.failure === undefined ? "" : `Changed files: not known (${changed.failure}); the glossary check ran over nothing`;
      if (glossary.text === "" && spec.text === "" && workText === "" && changedText === "") return { stdout: "", stderr: "", exit: 0 };
      const parts: string[] = [];
      if (changedText !== "") parts.push(changedText);
      if (glossary.text !== "") parts.push(`Glossary check:\n${glossary.text}`);
      if (spec.text !== "") parts.push(`Spec:\n${spec.text}`);
      if (workText !== "") parts.push(`Work:\n${workText}`);
      const text = parts.join("\n");
      // A refusal is spent only on what the tool can prove is owed and no recorded wall excuses: a rejected name in a changed file, a spec problem, a structural defect.
      const refuse = event === "SubagentStop" && input.stop_hook_active !== true && glossary.owed + spec.owed > 0;
      if (refuse) {
        return { stdout: "", stderr: `Regulate found what this session owes; settle it before stopping.\n${text}`, exit: REFUSE_EXIT };
      }
      const message = `Regulate (${event}):\n${text}`;
      return { stdout: JSON.stringify({ systemMessage: message }) + "\n", stderr: "", exit: 0 };
    }
  }
}

/** Read and parse the event JSON the host writes to stdin; an empty or malformed stdin is an empty event. */
export async function readStdinJson(stream: NodeJS.ReadableStream): Promise<HookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as HookInput) : {};
  } catch {
    return {};
  }
}
