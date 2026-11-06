import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HOOK_SAID_DIR, SAID_KEPT, keepSaid, readAllSaid, readSaid, saidIn, toolOf } from "./hook-said.ts";

test("what a hook said is read from its answer with whom it reached, and silence is nothing", () => {
  assert.equal(saidIn(""), undefined);
  assert.equal(saidIn("\n"), undefined);
  assert.equal(saidIn(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "" } })), undefined);
  assert.deepEqual(saidIn(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "a practice" } })), { text: "a practice", to: "agent" });
  assert.deepEqual(saidIn(JSON.stringify({ decision: "block", reason: "record what this session owes" })), { text: "record what this session owes", to: "agent" });
  assert.deepEqual(saidIn(JSON.stringify({ systemMessage: "Regulate (Stop): all said" })), { text: "Regulate (Stop): all said", to: "user" });
  assert.deepEqual(saidIn("plain context\n"), { text: "plain context", to: "agent" });
});

test("a tool moment keeps the tool and the file inside the project, never a command's text", () => {
  const root = "/p";
  assert.deepEqual(toolOf(root, { tool_name: "Edit", tool_input: { file_path: "/p/src/a.ts" } }), { tool: "Edit", file: "src/a.ts" });
  assert.deepEqual(toolOf(root, { tool_name: "Bash", tool_input: { command: "TOKEN=secret deploy" } }), { tool: "Bash" });
  assert.deepEqual(toolOf(root, { tool_name: "Read", tool_input: { file_path: "/elsewhere/b.ts" } }), { tool: "Read" });
});

test("each event keeps its last few words, newest first, and keeping nothing writes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-hook-said-"));
  try {
    keepSaid(root, "Stop", { at: "2026-11-05T10:00:00.000Z", session: "s", text: "  ", to: "user" });
    assert.equal(existsSync(join(root, HOOK_SAID_DIR)), false, "silence leaves no file");
    for (let i = 0; i < SAID_KEPT + 2; i++) keepSaid(root, "PreToolUse", { at: `2026-11-05T10:0${i}:00.000Z`, session: "s", text: `said ${i}`, to: "agent", tool: "Bash" });
    keepSaid(root, "Stop", { at: "2026-11-05T11:00:00.000Z", session: "s", text: "owed", to: "agent" });
    const pre = readSaid(root, "PreToolUse");
    assert.equal(pre.length, SAID_KEPT);
    assert.deepEqual(pre.map((s) => s.text), [`said ${SAID_KEPT + 1}`, `said ${SAID_KEPT}`, `said ${SAID_KEPT - 1}`]);
    assert.deepEqual(Object.keys(readAllSaid(root)).sort(), ["PreToolUse", "Stop"]);
    assert.deepEqual(readdirSync(join(root, HOOK_SAID_DIR)).filter((n) => n.endsWith(".tmp")), [], "no write is left half-done");
    assert.deepEqual(readSaid(root, "UserPromptSubmit"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
