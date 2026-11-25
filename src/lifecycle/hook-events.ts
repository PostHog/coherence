/**
 * The hook events Coherence answers, declared once. Kept apart from the hook
 * itself, with no import at all, so telemetry's session summary, the latency
 * budget and the benchmarks read these same names rather than a copy, without
 * loading every module the hook loads.
 */

export const HOOK_EVENTS = [
  "SessionStart",
  "SubagentStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(name: string): name is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(name);
}

/** The events that start a session or a subagent: where orient speaks, and where Codex's context limit applies. */
export const START_EVENTS: ReadonlySet<string> = new Set<HookEvent>(["SessionStart", "SubagentStart"]);

/** The events that run around every tool call, which the latency budget holds. */
export const TOOL_HOOKS: ReadonlySet<string> = new Set<HookEvent>(["PreToolUse", "PostToolUse"]);

/** The events Antigravity CLI runs, which its hooks file names in place of HOOK_EVENTS: it sends no prompt or subagent event. */
export const ANTIGRAVITY_EVENTS = ["SessionStart", "PreInvocation", "PreToolUse", "PostToolUse", "Stop"] as const;

export type AntigravityEvent = (typeof ANTIGRAVITY_EVENTS)[number];

export function isAntigravityEvent(name: string): name is AntigravityEvent {
  return (ANTIGRAVITY_EVENTS as readonly string[]).includes(name);
}
