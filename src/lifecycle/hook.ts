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
 * ends. On SubagentStop findings refuse the stop: exit 2 with the reason on
 * stderr, which both hosts read as "continue, and here is why" (Claude Code:
 * https://code.claude.com/docs/en/hooks; Codex: https://learn.chatgpt.com/docs/hooks).
 * A stop hook that is already active (`stop_hook_active`) never refuses again,
 * so a subagent cannot be held forever. UserPromptSubmit and PostToolUse
 * print nothing yet; the peer feed is a later slice.
 */

import { sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { formatReport, hasFindings, runCheck, type CheckReport } from "./check.ts";
import { openEscalations } from "../journal/read.ts";
import { loadSpecModel, type SpecModel } from "../spec/model.ts";
import { loadJournal } from "../journal/store.ts";
import { renderCompactWithin } from "./glossary.ts";
import { isCoherenceItself, loadProjectGlossaries } from "./project.ts";

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
}

/** Files changed in the working tree at `root`: modified against HEAD plus untracked. Empty outside git. */
export async function changedFiles(root: string): Promise<string[]> {
  try {
    const diff = await run("git", ["diff", "--name-only", "HEAD"], { cwd: root });
    const untracked = await run("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root });
    const all = `${diff.stdout}\n${untracked.stdout}`.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    return [...new Set(all)];
  } catch {
    return [];
  }
}

/** Escalations no human has acknowledged, under a heading, or nothing. Never shortened: a human must see them whole. */
export function escalationBlock(root: string): string {
  const open = openEscalations(loadJournal(root).records);
  if (open.length === 0) return "";
  const lines = [`Escalations awaiting a human (${open.length}); answer one with: acknowledge <id> --because "<what the human decided>"`];
  for (const e of open) lines.push(`▲ ${e.id}  ${e.agent}  ${e.what} — ${e.because}`);
  return lines.join("\n") + "\n\n";
}

/** The session id as the exact --session value, a decide template, and the rule. */
export async function sessionBlock(root: string, input: HookInput): Promise<string> {
  const session = typeof input.session_id === "string" && input.session_id !== "" ? input.session_id : undefined;
  const agent = typeof input.agent_type === "string" && input.agent_type !== "" ? input.agent_type : MAIN_AGENT;
  const cli = (await isCoherenceItself(root)) ? "node src/cli.ts" : "node_modules/.bin/coherence";
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

/** What the spec owes at stop: problems refuse a subagent stop; open requirements are advisory. */
export function specStopText(root: string, changed: readonly string[] = []): { text: string; problems: number } {
  const model = specModelOrNull(root);
  if ("error" in model) return { text: `Spec: not readable (${model.error})`, problems: 0 };
  if (model.components.length === 0) return { text: "", problems: 0 };
  const touched = new Set(changed.map((p) => p.split(sep).join("/")));
  const open = model.components.flatMap((c) => c.invariants.filter((i) => i.state === "requirement").map((i) => ({ c, i })));
  const mine = open.filter(({ c }) => touched.has(c.specPath));
  const lines: string[] = [];
  for (const p of model.problems) lines.push(`PROBLEM  ${p.file}:${p.line}  ${p.message}`);
  for (const { c, i } of mine.slice(0, OPEN_REQUIREMENT_LINES)) lines.push(`○ ${c.folder}/${i.name} — still a requirement; lacks: ${i.lacks.join(", ")}`);
  if (mine.length > OPEN_REQUIREMENT_LINES) lines.push(`  and ${mine.length - OPEN_REQUIREMENT_LINES} more in specs this session changed`);
  if (open.length > 0) lines.push(`${open.length} requirement${open.length === 1 ? "" : "s"} open in the project${mine.length > 0 ? `, ${mine.length} in specs this session changed` : ""}; run: spec --check`);
  return { text: lines.join("\n"), problems: model.problems.length };
}

export async function startContext(root: string, input: HookInput = {}): Promise<string> {
  const { coherence, project } = await loadProjectGlossaries(root);
  const head = escalationBlock(root) + specBlock(root);
  const tail = `\n${await sessionBlock(root, input)}`;
  const { text } = renderCompactWithin(coherence, project, CONTEXT_BUDGET - head.length - tail.length);
  return head + text + tail;
}

async function checkChanged(root: string): Promise<CheckReport | undefined> {
  const paths = await changedFiles(root);
  if (paths.length === 0) return undefined;
  const { coherence, project } = await loadProjectGlossaries(root);
  return runCheck({ root, paths, coherence, project });
}

/** Run one event. `input` is the parsed stdin the host sent; `root` defaults to its cwd. */
export async function runHook(event: HookEvent, input: HookInput, fallbackRoot: string): Promise<HookResult> {
  const root = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : fallbackRoot;
  switch (event) {
    case "SessionStart":
    case "SubagentStart": {
      const context = await startContext(root, input);
      const stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
      return { stdout: stdout + "\n", stderr: "", exit: 0 };
    }
    case "UserPromptSubmit":
    case "PostToolUse":
      return { stdout: "", stderr: "", exit: 0 };
    case "Stop":
    case "SubagentStop": {
      const report = await checkChanged(root);
      const spec = specStopText(root, await changedFiles(root));
      const glossaryText = report !== undefined && hasFindings(report) ? formatReport(report) : "";
      if (glossaryText === "" && spec.text === "") return { stdout: "", stderr: "", exit: 0 };
      const parts: string[] = [];
      if (glossaryText !== "") parts.push(`Glossary check:\n${glossaryText}`);
      if (spec.text !== "") parts.push(`Spec:\n${spec.text}`);
      const text = parts.join("\n");
      const refuse = event === "SubagentStop" && input.stop_hook_active !== true && (glossaryText !== "" || spec.problems > 0);
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
