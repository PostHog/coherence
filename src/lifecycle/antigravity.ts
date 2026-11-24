/** Antigravity CLI's hook protocol (agy 1.5.14, its bundled hooks.md) translated to Coherence's at the CLI edge, so runHook answers every host in one shape. */

import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { runHook, type HookInput, type HookOptions, type HookResult } from "./hook.ts";
import type { AntigravityEvent, HookEvent } from "./hook-events.ts";
import { installedRoot } from "./project.ts";
import { fileStemOf } from "../journal/session-token.ts";

type Payload = Record<string, unknown>;

interface InjectStep {
  systemMessage: { systemMessage: string; metadata?: { user_markdown: string } };
}

const ARGUMENT_NAMES: Readonly<Record<string, string>> = { Path: "path", CommandLine: "command" };

const PENDING_SEPARATOR = "\n\u0000\n";

/** Whether the agent ended its turn on its own: agy's hooks.md names NO_TOOL_CALL for that, and every other reason (a cancel, an error, a cap, a terminal step) is the host ending it, which no refusal sends back to work. */
function stoppedOnItsOwn(payload: Payload): boolean {
  const reason = payload["terminationReason"];
  return reason === undefined || reason === "" || reason === "NO_TOOL_CALL";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The Coherence event an agy event is; a PreInvocation past a turn's first model call is none, and only delivers what waits. */
export function coherenceEventOf(event: AntigravityEvent, payload: Payload): HookEvent | undefined {
  if (event !== "PreInvocation") return event;
  return payload["invocationNum"] === 0 ? "UserPromptSubmit" : undefined;
}

function toolInputOf(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) return {};
  return Object.fromEntries(Object.entries(args).map(([name, value]) => [ARGUMENT_NAMES[name] ?? name, value]));
}

export function hookInputOf(event: AntigravityEvent, payload: Payload): HookInput {
  const toolCall = isRecord(payload["toolCall"]) ? payload["toolCall"] : undefined;
  const input: HookInput = { hook_event_name: coherenceEventOf(event, payload) ?? event };
  if (typeof payload["conversationId"] === "string") input.session_id = payload["conversationId"];
  if (typeof payload["cwd"] === "string") input.cwd = payload["cwd"];
  if (typeof payload["transcriptPath"] === "string") input["transcript_path"] = payload["transcriptPath"];
  if (toolCall !== undefined) {
    input["tool_name"] = toolCall["name"];
    input["tool_input"] = toolInputOf(toolCall["args"]);
  }
  // agy keeps continuationActive false through forced continuations; executionNum is what counts them.
  if (event === "Stop") input.stop_hook_active = typeof payload["executionNum"] === "number" && payload["executionNum"] > 0;
  return input;
}

function pendingPath(holder: string, session: string): string {
  return join(holder, ".coherence", "antigravity", `${fileStemOf(session)}.pending`);
}

function appendPending(holder: string, session: string, context: string): void {
  const path = pendingPath(holder, session);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, context + PENDING_SEPARATOR);
}

function readPending(holder: string, session: string): string[] {
  try {
    return readFileSync(pendingPath(holder, session), "utf8").split(PENDING_SEPARATOR).filter((context) => context !== "");
  } catch {
    return [];
  }
}

interface ClaudeShapedReply {
  context?: string | undefined;
  userLine?: string | undefined;
  decision?: string | undefined;
  reason?: string | undefined;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function claudeShapedReplyOf(stdout: string): ClaudeShapedReply {
  if (stdout.trim() === "") return {};
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed)) return {};
  const specific = isRecord(parsed["hookSpecificOutput"]) ? parsed["hookSpecificOutput"] : {};
  return { context: nonEmptyText(specific["additionalContext"]), userLine: nonEmptyText(parsed["systemMessage"]), decision: nonEmptyText(parsed["decision"]), reason: nonEmptyText(parsed["reason"]) };
}

/** A step agy injects for the model to read. */
export function modelStep(text: string): InjectStep {
  return { systemMessage: { systemMessage: text } };
}

/** A step agy shows the user as markdown, with nothing for the model. */
export function userStep(line: string): InjectStep {
  return { systemMessage: { systemMessage: "", metadata: { user_markdown: line } } };
}

/** Run one agy event through runHook and answer in agy's shape; agy reads only stdout, so the exit is always 0. */
export async function runAntigravityHook(event: AntigravityEvent, payload: Payload, fallbackRoot: string, options: HookOptions = {}): Promise<HookResult> {
  const input = hookInputOf(event, payload);
  const coherenceEvent = coherenceEventOf(event, payload);
  const coherenceAnswer: HookResult = coherenceEvent === undefined ? { stdout: "", stderr: "", exit: 0 } : await runHook(coherenceEvent, input, fallbackRoot, options);
  const reply = claudeShapedReplyOf(coherenceAnswer.stdout);
  const session = input.session_id;
  const holder = installedRoot(fallbackRoot) ?? input.cwd ?? fallbackRoot;
  const answered = (stdout: string, commit = coherenceAnswer.commit): HookResult => ({ stdout, stderr: coherenceAnswer.stderr, exit: 0, ...(commit === undefined ? {} : { commit }) });

  // agy drops a PostToolUse injection, and a PreToolUse allow would skip its permission prompt: tool-time context waits for the next model call.
  if (event === "PreToolUse" || event === "PostToolUse") {
    if (reply.context !== undefined && session !== undefined) appendPending(holder, session, reply.context);
    return answered("");
  }
  if (event === "Stop") {
    if (reply.decision !== "block" || !stoppedOnItsOwn(payload)) return answered("");
    return answered(JSON.stringify({ decision: "continue", reason: reply.reason ?? "" }) + "\n");
  }
  const pending = session === undefined ? [] : readPending(holder, session);
  const steps = [...pending, ...(reply.context === undefined ? [] : [reply.context])].map(modelStep);
  if (reply.userLine !== undefined) steps.push(userStep(reply.userLine));
  if (steps.length === 0) return answered("");
  const commit = (): void => {
    coherenceAnswer.commit?.();
    if (pending.length > 0 && session !== undefined) rmSync(pendingPath(holder, session), { force: true });
  };
  return answered(JSON.stringify({ injectSteps: steps }) + "\n", commit);
}
