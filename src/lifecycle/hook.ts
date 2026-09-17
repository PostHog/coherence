/**
 * The hook: what each harness event injects or answers.
 *
 * SessionStart and SubagentStart carry the compact glossary and a short fixed
 * instruction; both hosts read it from `hookSpecificOutput.additionalContext`.
 * Stop and SubagentStop run the glossary check over the files changed in the
 * working tree. On Stop the findings are shown to the human and the session
 * ends. On SubagentStop findings refuse the stop: exit 2 with the reason on
 * stderr, which both hosts read as "continue, and here is why" (Claude Code:
 * https://code.claude.com/docs/en/hooks; Codex: https://learn.chatgpt.com/docs/hooks).
 * A stop hook that is already active (`stop_hook_active`) never refuses again,
 * so a subagent cannot be held forever. UserPromptSubmit and PostToolUse
 * print nothing yet; the peer feed is a later slice.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { formatReport, hasFindings, runCheck, type CheckReport } from "./check.ts";
import { renderCompactWithin } from "./glossary.ts";
import { loadProjectGlossaries } from "./project.ts";

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

/** Under 80 words; the vocabulary above it is the state, this is the rule. */
export const INSTRUCTION = [
  "Use these names. A rejected name in prose, a spec, a journal record, or an",
  "identifier is a defect: replace it. A new noun that names something the",
  "glossary lacks must be declared there as a concept, or mapped as an alias of",
  "an existing concept, before this session ends. Coherence's names describe",
  "the tool; the project's names describe its domain, and inside the project",
  "the project's sense wins.",
].join(" ");

export interface HookInput {
  cwd?: string;
  session_id?: string;
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

export async function startContext(root: string): Promise<string> {
  const { coherence, project } = await loadProjectGlossaries(root);
  const tail = `\n${INSTRUCTION}\n`;
  const { text } = renderCompactWithin(coherence, project, CONTEXT_BUDGET - tail.length);
  return text + tail;
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
      const context = await startContext(root);
      const stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
      return { stdout: stdout + "\n", stderr: "", exit: 0 };
    }
    case "UserPromptSubmit":
    case "PostToolUse":
      return { stdout: "", stderr: "", exit: 0 };
    case "Stop":
    case "SubagentStop": {
      const report = await checkChanged(root);
      if (report === undefined || !hasFindings(report)) return { stdout: "", stderr: "", exit: 0 };
      const text = formatReport(report);
      const refuse = event === "SubagentStop" && input.stop_hook_active !== true;
      if (refuse) {
        return { stdout: "", stderr: `Glossary check found defects in the files this session changed; fix them before stopping.\n${text}`, exit: REFUSE_EXIT };
      }
      const message = `Glossary check (${event}):\n${text}`;
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
