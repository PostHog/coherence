/**
 * The replay record: every tool call the hook sees is one line, in order,
 * attributed to the session and agent that made it, in the coordinator's
 * file; its summary is bounded and holds no output; and it is read back in
 * the order the calls were made, a session older than it from its trace.
 */

import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runHook } from "../lifecycle/hook.ts";
import { maskSecrets, readReplay, recordCall, replayFile, replaySessions, SUMMARY_MAX, summaryOf, type CallLine } from "./replay.ts";
import { traceFile } from "./trace.ts";

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-replay-"));
  for (const [path, text] of Object.entries({ "coherence.config.json": JSON.stringify({ name: "p" }), ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const lines = (root: string, session: string): CallLine[] =>
  readFileSync(replayFile(root, session), "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as CallLine);

test("every tool call is one line of the replay record, in order, attributed to its session and agent in the coordinator's file, its summary bounded and never the tool's output", async () => {
  const root = project({ "src/a.ts": "export const a = 1;\n" });
  try {
    const main = { cwd: root, session_id: "coord" };
    const secret = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const long = `echo ${"x".repeat(400)}`;
    const calls: [Record<string, unknown>, Record<string, unknown>][] = [
      [main, { tool_name: "Read", tool_input: { file_path: join(root, "src/a.ts") }, tool_response: { file: { content: "THE OUTPUT" } } }],
      [main, { tool_name: "Bash", tool_input: { command: `GITHUB_TOKEN=${secret} gh pr list --token ${secret}\ncat secrets.txt`, description: "List the open PRs" }, tool_response: { stdout: "THE OUTPUT" } }],
      [main, { tool_name: "Grep", tool_input: { pattern: "recordCall", path: join(root, "src") }, tool_response: "THE OUTPUT" }],
      [main, { tool_name: "WebFetch", tool_input: { url: "https://user:pw@example.com/path?q=private", prompt: "read it" }, tool_response: "THE OUTPUT" }],
      [{ ...main, agent_id: "child-1", agent_type: "Explore" }, { tool_name: "Write", tool_input: { file_path: join(root, "src/b.ts"), content: "THE OUTPUT" } }],
      [main, { tool_name: "Bash", tool_input: { command: long } }],
      [main, { tool_name: "TodoWrite", tool_input: { todos: [{ content: "THE OUTPUT" }] } }],
    ];
    for (const [who, call] of calls) {
      if (call["tool_name"] === "Write") writeFileSync(join(root, "src/b.ts"), "export const b = 1;\n");
      await runHook("PostToolUse", { ...who, hook_event_name: "PostToolUse", ...call }, root);
    }
    const record = lines(root, "coord");
    assert.deepEqual(record.map((l) => l.tool), ["Read", "Bash", "Grep", "WebFetch", "Write", "Bash", "TodoWrite"], "every call, a tool that reads and writes nothing among them, in the order the hook saw it");
    assert.ok(record.every((l) => l.kind === "call" && !Number.isNaN(Date.parse(l.at))));
    assert.deepEqual(record[0], { ...record[0], session: "coord", agent: "main", summary: "src/a.ts", read: ["src/a.ts"] });
    assert.equal(record[1]!.summary.includes(secret), false, "a token is masked wherever it stands");
    assert.match(record[1]!.summary, /^GITHUB_TOKEN=… gh pr list --token … …$/, "the first line alone, the rest said by an ellipsis");
    assert.equal(record[1]!.description, "List the open PRs");
    assert.equal(record[2]!.summary, "recordCall in src");
    assert.equal(record[3]!.summary, "example.com", "a fetch says only its host");
    assert.deepEqual({ session: record[4]!.session, agent: record[4]!.agent, wrote: record[4]!.wrote, summary: record[4]!.summary }, { session: "child-1", agent: "Explore", wrote: ["src/b.ts"], summary: "src/b.ts" }, "a subagent's call is in the coordinator's file under its own session and agent");
    assert.equal(record[5]!.summary.length, SUMMARY_MAX, "a summary is bounded");
    assert.equal(record[6]!.summary, "");
    assert.equal(JSON.stringify(record).includes("THE OUTPUT"), false, "no tool output and no file content is recorded");
    assert.equal(JSON.stringify(record).includes("cat secrets.txt"), false, "a command's later lines are not recorded");
    assert.deepEqual(readFileSync(traceFile(root, "coord"), "utf8").split("\n").filter((l) => l !== "").map((l) => (JSON.parse(l) as { kind: string }).kind), ["read"], "the read trace still records the read beside it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("words shaped like a secret are masked, and ordinary words, paths and short ids are kept", () => {
  assert.equal(maskSecrets("curl -H 'Authorization: Bearer abc.def-123' https://x"), "curl -H 'Authorization: Bearer …' https://x");
  assert.equal(maskSecrets("psql postgres://admin:hunter2@db:5432/app"), "psql postgres://…@db:5432/app");
  assert.equal(maskSecrets("API_KEY=sk-live-1234 OPENAI_API_KEY='x y' npm run x"), "API_KEY=… OPENAI_API_KEY=… npm run x");
  assert.equal(maskSecrets("tool --password=open --api-key sesame run"), "tool --password=… --api-key … run");
  assert.equal(maskSecrets("echo AKIAIOSFODNN7EXAMPLEAKIAIOSFODNN7EXAMPLE"), "echo …");
  const kept = "git log --oneline -5 -- src/readings/scope/relief/mount.ts && node src/cli.ts decide --session a8812586b7f52b39b";
  assert.equal(maskSecrets(kept), kept);
  assert.equal(summaryOf("/r", { command: ["bash", "-lc", "ls -la"] }).summary, "ls -la", "a host's command array is read as its script");
  assert.equal(summaryOf("/r", { url: "not a url" }).summary, "");
});

test("a session's calls are read back in the order they were made, a line merged twice once, and a session older than the record from its read trace", () => {
  const root = project();
  try {
    const at = (s: number) => () => new Date(Date.UTC(2026, 9, 30, 12, 0, s));
    recordCall(root, "s1", { session: "s1", agent: "main", tool: "Read", toolInput: { file_path: "b" }, wrote: [], now: at(2) });
    recordCall(root, "s1", { session: "s1", agent: "main", tool: "Edit", toolInput: { file_path: "a" }, wrote: ["a"], now: at(1) });
    const file = replayFile(root, "s1");
    const first = readFileSync(file, "utf8").split("\n")[0]!;
    appendFileSync(file, `${first}\nnot json\n{"kind":"call","at":"never"}\n`);
    const replay = readReplay(root, "s1")!;
    assert.equal(replay.from, "replay");
    assert.deepEqual(replay.calls.map((c) => c.tool), ["Edit", "Read"], "by time, whatever order the lines were left in; a doubled line plays once, a damaged one not at all");

    mkdirSync(dirname(traceFile(root, "old")), { recursive: true });
    writeFileSync(traceFile(root, "old"), [
      { kind: "write", at: "2026-10-01T00:00:02.000Z", session: "old", files: ["x.ts"] },
      { kind: "read", at: "2026-10-01T00:00:01.000Z", session: "old", file: "y.ts" },
      { kind: "snapshot", at: "2026-10-01T00:00:03.000Z", session: "old", commit: null, changed: [], read: [], predicted: [], tokens: 0, instrument: {} },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n");
    const old = readReplay(root, "old")!;
    assert.equal(old.from, "trace");
    assert.deepEqual(old.calls.map((c) => [c.tool, c.read ?? c.wrote]), [["read", ["y.ts"]], ["write", ["x.ts"]]], "its reads and writes, never its snapshot");
    assert.equal(readReplay(root, "nobody"), undefined);
    assert.equal(readReplay(root, "../etc"), undefined, "a name that could not be a session file's reads nothing");
    assert.deepEqual(replaySessions(root).map((s) => [s.session, s.from]).sort(), [["old", "trace"], ["s1", "replay"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
