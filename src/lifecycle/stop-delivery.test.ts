/**
 * Regulate reaching the agent: a practice fires on a command's own words in
 * the project the command runs in, a stop says each line once, blocks once
 * for what is owed and carries the rest into the next prompt, and a tool hook
 * over the latency budget says so.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { journalVerbs, type Io } from "../journal/cli.ts";
import { runHook, type HookResult } from "./hook.ts";
import { HOOK_TIMES_DIR, hookLatencyOrientText, hookLatencyStopText, recordHookTime } from "./hook-latency.ts";
import { firings, practiceContext, practiceStopText, toolUseOf } from "./practice-delivery.ts";

const PRACTICE = "- oil the knob: A knob is oiled before it turns.\n  when: command turn-knob\n  step: oil the knob\n  step: turn it once\n  because: a dry knob seizes\n";

function repo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-stop-"));
  const all: Record<string, string> = { "coherence.config.json": JSON.stringify({ name: "p" }), "src/widget/Widget.spec.md": "# Widget\n\nWidgets turn.\n", "src/widget/Widget.practice.md": PRACTICE, ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return root;
}

function enact(root: string, session: string): void {
  const io: Io = { cwd: root, now: () => new Date(Date.now() + 1000), out: () => {}, err: () => {} };
  const code = journalVerbs["enact"]!(["oil the knob", "--step", "1=done", "--step", "2=done", "--session", session, "--agent", "main"], io);
  assert.equal(code, 0, "the enactment is recorded");
}

const contextOf = (result: HookResult): string => {
  if (result.stdout.trim() === "") return "";
  const parsed = JSON.parse(result.stdout) as { hookSpecificOutput?: { additionalContext?: string } };
  return parsed.hookSpecificOutput?.additionalContext ?? "";
};

test("a practice fires on a command's own words, in the project the command runs in, and its enactment counts there", () => {
  const home = repo();
  const other = repo();
  try {
    const fire = (command: string) => practiceContext(home, "s1", toolUseOf({ tool_input: { command } }, []), "node src/cli.ts", "main", () => new Date(), home);
    assert.equal(fire(`node src/cli.ts enact "oil the knob" --trigger "command turn-knob"`).text, "", "a trigger's words inside a quoted argument are no command");
    assert.equal(fire("cat > notes.md <<'EOF'\nturn-knob\nEOF").text, "", "a heredoc's body is text, not a command");
    assert.match(fire("./bin/turn-knob --hard").text, /fires a practice/, "a program named by its path is the command");
    const away = fire(`cd ${other} && turn-knob`);
    assert.match(away.text, new RegExp(`in ${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "the practice is the other project's, and the delivery says where");
    away.commit();
    const fired = firings(home, "s1").filter((f) => f.root === other);
    assert.equal(fired.length, 1, "the firing keeps the project its command ran in");
    assert.match(practiceStopText(home, "s1", "node src/cli.ts", "main"), new RegExp(`fired \\(command turn-knob, from ${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\) and has no enactment since`));
    enact(other, "s1");
    assert.doesNotMatch(practiceStopText(home, "s1", "node src/cli.ts", "main"), /fired \(command turn-knob, from/, "the enactment recorded in the other project's journal settles the firing there");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("a stop says each line once, blocks once for a practice owed, and carries the rest into the next prompt", async () => {
  const root = repo();
  const session = "s2";
  const quiet = { refresh: () => {}, door: async <T>(_root: string, fn: (a: undefined, s: undefined, r: string) => Promise<T>) => fn(undefined, undefined, "no instrument in this test") };
  try {
    const pre = await runHook("PreToolUse", { cwd: root, session_id: session, tool_name: "Bash", tool_input: { command: "turn-knob" } }, root, quiet);
    pre.commit?.();
    const first = await runHook("Stop", { cwd: root, session_id: session }, root, quiet);
    const refusal = JSON.parse(first.stdout) as { decision?: string; reason?: string };
    assert.equal(refusal.decision, "block", "a practice owed blocks the stop, which puts the reason in front of the agent");
    assert.match(refusal.reason ?? "", /Practice src\/widget\/oil the knob fired \(command turn-knob\) and has no enactment since/);
    assert.doesNotMatch(refusal.reason ?? "", /--step 1=/, "one line per practice, never its enact template");
    first.commit?.();
    const again = await runHook("Stop", { cwd: root, session_id: session, stop_hook_active: true }, root, quiet);
    assert.equal(again.stdout, "", "the stop the block caused has nothing new to say");

    // An advisory line: shown to the user, never a block, and carried to the next prompt.
    recordHookTime(root, session, { at: new Date().toISOString(), event: "PostToolUse", ms: 4200 });
    const advisory = await runHook("Stop", { cwd: root, session_id: session }, root, quiet);
    const shown = JSON.parse(advisory.stdout) as { decision?: string; systemMessage?: string };
    assert.equal(shown.decision, undefined, "advice never blocks");
    assert.match(shown.systemMessage ?? "", /Hook latency: 1 tool hook call this session took longer than the 3 s latency budget/);
    assert.doesNotMatch(shown.systemMessage ?? "", /oil the knob/, "a line said at an earlier stop is not said again");
    advisory.commit?.();
    const prompt = await runHook("UserPromptSubmit", { cwd: root, session_id: session, prompt: "next" }, root, quiet);
    assert.match(contextOf(prompt), /^At your last stop \(shown to the user, not to you\), regulate said:\nHook latency: 1 tool hook call/, "the prompt after the stop is where the agent reads it");
    prompt.commit?.();
    const later = await runHook("UserPromptSubmit", { cwd: root, session_id: session, prompt: "and then" }, root, quiet);
    assert.doesNotMatch(contextOf(later), /At your last stop/, "carried once");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a tool hook over the latency budget says so in its own answer, and regulate and orient name the calls over it", async () => {
  const root = repo();
  try {
    const input = { cwd: root, session_id: "s3", tool_name: "Read", tool_input: { file_path: join(root, "coherence.config.json") } };
    const slow = await runHook("PreToolUse", input, root, { startedAt: Date.now() - 4000 });
    assert.match(contextOf(slow), /^Hook latency: this PreToolUse took [4-9]\.\d s, over the 3 s latency budget for a tool hook/);
    const fast = await runHook("PreToolUse", input, root, {});
    assert.equal(contextOf(fast), "", "a hook within the budget says nothing of its time");
    assert.match(hookLatencyStopText(root, "s3"), /^Hook latency: 1 tool hook call this session took longer than the 3 s latency budget \(slowest PreToolUse [4-9]\.\d s\); the 2 tool hook calls took/);
    assert.equal(hookLatencyStopText(root, "nobody"), "");
    recordHookTime(root, "old", { at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), event: "PostToolUse", ms: 9000 });
    const stale = join(root, HOOK_TIMES_DIR, "old.jsonl");
    utimesSync(stale, new Date(Date.now() - 10 * 24 * 3600 * 1000), new Date(Date.now() - 10 * 24 * 3600 * 1000));
    assert.match(hookLatencyOrientText(root), /^Hook latency: 1 tool hook call in the last 7 days took longer than the 3 s latency budget \(slowest PreToolUse/, "orient reads the last week, not older");
    writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "p", latencyBudget: 10 }));
    const allowed = await runHook("PreToolUse", input, root, { startedAt: Date.now() - 4000 });
    assert.equal(contextOf(allowed), "", "the config's own budget holds");
    assert.equal(hookLatencyStopText(root, "s3"), "", "and regulate reads the calls against it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
