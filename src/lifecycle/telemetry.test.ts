/**
 * Fleet telemetry: off until opted in, refused by a project or the
 * environment, only the fields its schema allows, no defect text, and never
 * a hook's wait. No test reaches the network: every send is captured.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runHook } from "./hook.ts";
import { HOOK_TIMES_DIR } from "./hook-latency.ts";
import {
  DEFECT_EVENT,
  SESSION_EVENT,
  collectSessions,
  defectEvent,
  enqueue,
  eventSchema,
  flushQueue,
  hookSummary,
  optIn,
  optOut,
  queuePath,
  readQueue,
  readSettings,
  recordDefectTelemetry,
  resetId,
  schemaProblems,
  sessionEvent,
  startTelemetry,
  telemetryState,
  type Env,
  type QueuedEvent,
  type Sender,
  type Spawner,
} from "./telemetry.ts";
import { telemetryCommand } from "./telemetry-cli.ts";
import { TELEMETRY_TARGET } from "./telemetry-config.ts";

function project(config: Record<string, unknown> = { name: "p" }): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-telemetry-"));
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify(config));
  writeFileSync(join(root, "README.md"), "x\n");
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return root;
}

/** A user's environment of its own: a config folder in a temp directory, nothing inherited, so nothing reaches the real one. */
function userEnv(extra: Record<string, string> = {}): Env {
  return { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "coherence-telemetry-home-")), ...extra };
}

function capturing(ok = true): { send: Sender; sent: { url: string; body: string }[] } {
  const sent: { url: string; body: string }[] = [];
  return { sent, send: async (url, body) => (sent.push({ url, body }), ok) };
}

function spawnRecorder(): { spawner: Spawner; spawned: { command: string; args: string[]; options: object; unref: boolean }[] } {
  const spawned: { command: string; args: string[]; options: object; unref: boolean }[] = [];
  const spawner: Spawner = (command, args, options) => {
    const entry = { command, args, options, unref: false };
    spawned.push(entry);
    return { on: () => undefined, unref: () => void (entry.unref = true) };
  };
  return { spawner, spawned };
}

function hookTimes(root: string, session: string, lines: { event: string; ms: number }[], ageMs: number): void {
  const path = join(root, HOOK_TIMES_DIR, `${session}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const at = new Date(Date.now() - ageMs).toISOString();
  writeFileSync(path, lines.map((l) => JSON.stringify({ at, event: l.event, ms: l.ms })).join("\n") + "\n");
  const when = (Date.now() - ageMs) / 1000;
  utimesSync(path, when, when);
}

const ID = "0b7c1f5e-2d3a-4c4b-9e8f-1a2b3c4d5e6f";
const facts = { languages: ["typescript"], files: "<1k" as const, components: "<10" as const, registry: false };

test("nothing is queued or sent unless the user opted in, and a project's refusal or the environment always wins", async () => {
  const root = project();
  const refusing = project({ name: "q", telemetry: false });
  try {
    const env = userEnv();
    const { send, sent } = capturing();
    const { spawner, spawned } = spawnRecorder();
    // Off by default: no settings file, nothing queued, nothing started, nothing sent.
    assert.equal(telemetryState(root, env).on, false);
    recordDefectTelemetry(root, { what: "x", class: "path-escape" }, env);
    assert.equal(readQueue(env).length, 0, "a defect while off queues nothing");
    hookTimes(root, "old", [{ event: "PostToolUse", ms: 300 }], 2 * 60 * 60 * 1000);
    assert.equal(collectSessions(root, undefined, "claude", env), 0, "a session while off is never summarized");
    assert.equal(startTelemetry(root, "SessionStart", { session_id: "s" }, env, spawner), false);
    assert.equal((await flushQueue(env, send)).sent, 0);

    optIn(env);
    assert.equal(telemetryState(root, env).on, true, "on once the user opts in");
    assert.match(readSettings(env).id ?? "", /^[0-9a-f-]{36}$/);
    // Each override wins over the opt-in.
    assert.equal(telemetryState(refusing, env).on, false, 'a project\'s "telemetry": false refuses');
    for (const over of [{ DO_NOT_TRACK: "1" }, { COHERENCE_TELEMETRY: "0" }]) {
      const overEnv = { ...env, ...over };
      assert.equal(telemetryState(root, overEnv).on, false, `${JSON.stringify(over)} refuses`);
      recordDefectTelemetry(root, { class: "x" }, overEnv);
      assert.equal(startTelemetry(root, "SessionStart", { session_id: "s" }, overEnv, spawner), false);
    }
    assert.equal(telemetryState(root, env, { ...TELEMETRY_TARGET, key: "" }).on, false, "a build without a key sends nothing");
    recordDefectTelemetry(refusing, { class: "x" }, env);
    assert.equal(collectSessions(refusing, undefined, "claude", env), 0);
    assert.equal(readQueue(env).length, 0, "nothing was queued under any override");
    // Something queued while on, then the environment refuses: the flush sends nothing.
    recordDefectTelemetry(root, { class: "x" }, env);
    assert.equal(readQueue(env).length, 1);
    assert.equal((await flushQueue({ ...env, DO_NOT_TRACK: "1" }, send)).sent, 0);
    // Off drops the queue: what waited never leaves.
    optOut(env);
    assert.equal(readQueue(env).length, 0);
    assert.equal((await flushQueue(env, send)).sent, 0);
    assert.deepEqual(sent, [], "nothing was ever sent");
    assert.deepEqual(spawned, [], "no flush was ever started");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(refusing, { recursive: true, force: true });
  }
});

test("every telemetry event carries only the fields its schema allows, and a field outside it is refused", async () => {
  const times = [
    { at: "2026-10-07T00:00:00.000Z", event: "PostToolUse", ms: 310 },
    { at: "2026-10-07T00:00:01.000Z", event: "PostToolUse", ms: 290 },
    { at: "2026-10-07T00:00:02.000Z", event: "Stop", ms: 1200 },
  ];
  const events: QueuedEvent[] = [sessionEvent(ID, "2026-10-07T00:00:02.000Z", "claude", facts, times), defectEvent(ID, "2026-10-07T00:00:02.000Z", "codex", "1k-10k", { class: "path-escape", introduced: "fix", caught: "review" })];
  for (const event of events) {
    assert.deepEqual(schemaProblems(event), [], event.event);
    const allowed = new Set(Object.keys(eventSchema(event.event)!));
    for (const key of Object.keys(event.properties)) assert.ok(allowed.has(key), `${event.event} carries ${key}, which its schema does not list`);
    assert.equal(event.properties["$process_person_profile"], false, "no person profile");
    assert.equal(event.properties["team"], TELEMETRY_TARGET.team);
  }
  assert.deepEqual(Object.keys(events[0]!.properties).sort(), ["$process_person_profile", "PostToolUse_count", "PostToolUse_max_ms", "PostToolUse_p50_ms", "PostToolUse_p95_ms", "Stop_count", "Stop_max_ms", "Stop_p50_ms", "Stop_p95_ms", "components", "files", "host", "languages", "node", "platform", "registry", "team", "version"].sort());
  // A new field, a value outside its schema, or an extra top-level key is a problem, and is never queued or sent.
  const added = { ...events[1]!, properties: { ...events[1]!.properties, repository: "acme/secret" } };
  const prose = { ...events[1]!, properties: { ...events[1]!.properties, class: "the path /Users/someone/acme escaped" } };
  const topLevel = { ...events[0]!, $set: { email: "a@b.c" } };
  for (const bad of [added, prose, topLevel]) assert.notDeepEqual(schemaProblems(bad), []);
  const env = userEnv();
  optIn(env);
  assert.equal(enqueue(added, env), false, "an event outside the schema is never queued");
  const id = readSettings(env).id!;
  appendFileSync(queuePath(env), JSON.stringify({ ...added, distinct_id: id }) + "\n");
  const { send, sent } = capturing();
  assert.equal((await flushQueue(env, send)).sent, 0, "nor sent, when one reached the queue some other way");
  assert.deepEqual(sent, []);
});

test("a defect's telemetry event carries its class, origin and catch, never its text", () => {
  const root = project();
  try {
    const env = userEnv();
    optIn(env);
    const secret = "SECRET-what-/Users/someone/acme/src/billing.ts";
    recordDefectTelemetry(root, { kind: "defect", what: secret, evidence: `${secret} evidence`, files: [secret], class: "Path-Escape", introduced: "fix:abc1234 (PR #12)", caught: "review" }, env);
    recordDefectTelemetry(root, { what: secret, class: "a long prose class naming acme", introduced: "deadbeefcafe", caught: "slack thread" }, env);
    recordDefectTelemetry(root, { what: secret }, env);
    const queued = readQueue(env);
    assert.equal(queued.length, 3);
    assert.ok(!readFileSync(queuePath(env), "utf8").includes("SECRET"), "no defect text, path or file in the queue");
    assert.ok(!readFileSync(queuePath(env), "utf8").includes("acme"));
    assert.ok(!readFileSync(queuePath(env), "utf8").includes("abc1234"), "never the commit a fix names");
    assert.deepEqual(queued.map((e) => [e.event, e.properties["class"], e.properties["introduced"], e.properties["caught"]]), [
      [DEFECT_EVENT, "path-escape", "fix", "review"],
      [DEFECT_EVENT, "other", "fix", "unknown"],
      [DEFECT_EVENT, "unclassified", "unknown", "unknown"],
    ]);
    for (const e of queued) assert.deepEqual(schemaProblems(e), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("telemetry adds no wait to a hook: the flush starts detached at a session start or a stop, and queuing is one appended line", async () => {
  const root = project();
  try {
    const env = userEnv();
    optIn(env, () => new Date(Date.now() - 24 * 60 * 60 * 1000));
    const { spawner, spawned } = spawnRecorder();
    assert.equal(startTelemetry(root, "Stop", { session_id: "s" }, env, spawner), false, "an empty queue starts nothing");
    recordDefectTelemetry(root, { class: "x" }, env);
    for (const event of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SubagentStop"]) assert.equal(startTelemetry(root, event, { session_id: "s" }, env, spawner), false, `${event} starts nothing`);
    const started = startTelemetry(root, "Stop", { session_id: "s", transcript_path: "/x/.claude/projects/p/s.jsonl" }, env, spawner);
    assert.equal(started, true, "a stop with something queued starts the flush");
    assert.equal(typeof started, "boolean", "it returns at once, no promise to wait on");
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0]!.options, { cwd: root, detached: true, stdio: "ignore" });
    assert.equal(spawned[0]!.unref, true, "the hook never holds the child");
    assert.deepEqual(spawned[0]!.args.slice(2), ["telemetry", "flush", "--root", root, "--host", "claude"]);
    // A session start with a session that is over starts the collecting flush, which excludes the starting session.
    hookTimes(root, "old", [{ event: "PostToolUse", ms: 300 }], 2 * 60 * 60 * 1000);
    startTelemetry(root, "SessionStart", { session_id: "new" }, env, spawner);
    assert.deepEqual(spawned[1]!.args.slice(-3), ["--collect", "--current", "new"]);
    // Queuing appends one line and reads nothing back: the queue's earlier bytes are untouched whatever its length.
    for (let i = 0; i < 500; i++) recordDefectTelemetry(root, { class: "x" }, env);
    const before = readFileSync(queuePath(env), "utf8");
    const event = defectEvent(readSettings(env).id!, new Date().toISOString(), "claude", "<1k", { class: "y" });
    enqueue(event, env);
    const after = readFileSync(queuePath(env), "utf8");
    assert.equal(after, before + JSON.stringify(event) + "\n");
    // The hook calls telemetry at a session start and a stop alone, and neither waits on it.
    const calls: string[] = [];
    const options = { telemetry: (_r: string, e: string) => void calls.push(e) };
    for (const e of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"] as const) {
      await runHook(e, { cwd: root, session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } }, root, options);
    }
    assert.deepEqual(calls, ["SessionStart", "Stop"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a flush sends the queue in one POST to the batch endpoint and drops it, sent or not", async () => {
  const env = userEnv();
  optIn(env);
  const id = readSettings(env).id!;
  const event = defectEvent(id, "2026-10-07T00:00:00.000Z", "claude", "<1k", { class: "x" });
  enqueue(event, env);
  enqueue(event, env);
  const { send, sent } = capturing();
  const target = { host: "https://ingest.example", key: "k-test", team: TELEMETRY_TARGET.team };
  assert.deepEqual(await flushQueue(env, send, target), { sent: 2, dropped: 0, ok: true });
  assert.equal(sent.length, 1, "one request for the whole queue");
  assert.equal(sent[0]!.url, "https://ingest.example/batch/");
  assert.deepEqual(JSON.parse(sent[0]!.body), { api_key: "k-test", batch: [event, event] });
  assert.equal(readQueue(env).length, 0, "what was sent is dropped");
  enqueue(event, env);
  const failing = capturing(false);
  assert.deepEqual(await flushQueue(env, failing.send, target), { sent: 0, dropped: 1, ok: false });
  assert.equal(readQueue(env).length, 0, "a failed send drops the batch: one attempt");
  // A reset id drops the queue, and an event under an old id is never sent under the new one.
  enqueue(event, env);
  resetId(env);
  assert.equal(readQueue(env).length, 0);
  appendFileSync(queuePath(env), JSON.stringify(event) + "\n");
  const after = capturing();
  assert.equal((await flushQueue(env, after.send, target)).sent, 0);
  assert.deepEqual(after.sent, []);
});

test("a session's hook cost is summarized once, after the session is over, per hook event", () => {
  const root = project();
  try {
    const env = userEnv();
    optIn(env, () => new Date(Date.now() - 24 * 60 * 60 * 1000));
    const lines = [100, 200, 300, 400, 1000].map((ms) => ({ event: "PostToolUse", ms }));
    hookTimes(root, "over", [...lines, { event: "Stop", ms: 2500 }], 2 * 60 * 60 * 1000);
    hookTimes(root, "running", lines, 60 * 1000);
    hookTimes(root, "current", lines, 2 * 60 * 60 * 1000);
    hookTimes(root, "before-opt-in", lines, 3 * 24 * 60 * 60 * 1000);
    assert.equal(collectSessions(root, "current", "codex", env), 1, "only the session that is over, not the running or current one, nor one before the opt-in");
    assert.equal(collectSessions(root, "current", "codex", env), 0, "once");
    const [event] = readQueue(env);
    assert.equal(event!.event, SESSION_EVENT);
    assert.deepEqual(schemaProblems(event), []);
    assert.equal(event!.properties["host"], "codex");
    assert.equal(event!.properties["files"], "<1k");
    assert.deepEqual(event!.properties["languages"], ["typescript"]);
    assert.ok(!JSON.stringify(event).includes(root) && !JSON.stringify(event).includes("over"), "no path, no session id");
    assert.deepEqual(hookSummary(lines.map((l) => ({ ...l, at: "2026-10-07T00:00:00.000Z" }))), { PostToolUse_count: 5, PostToolUse_p50_ms: 300, PostToolUse_p95_ms: 1000, PostToolUse_max_ms: 1000 });
    assert.equal(event!.properties["Stop_max_ms"], 2500);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("telemetry on, off, status, show and reset-id say what they did, and show prints the queue as it would be sent", async () => {
  const root = project();
  try {
    const env = userEnv();
    const out: string[] = [];
    const io = { cwd: root, out: (l: string) => void out.push(l), err: (l: string) => void out.push(l) };
    await telemetryCommand(["status"], io, env);
    assert.match(out.join("\n"), /telemetry: off/);
    out.length = 0;
    assert.equal(await telemetryCommand(["on"], io, env), 0);
    const id = readSettings(env).id!;
    assert.match(out.join("\n"), new RegExp(`installation id ${id}`));
    assert.match(out.join("\n"), /coherence defect recorded/);
    recordDefectTelemetry(root, { class: "x" }, env);
    out.length = 0;
    await telemetryCommand(["show"], io, env);
    assert.deepEqual(JSON.parse(out.join("\n")), { api_key: TELEMETRY_TARGET.key, batch: readQueue(env) });
    await telemetryCommand(["reset-id"], io, env);
    assert.notEqual(readSettings(env).id, id);
    out.length = 0;
    await telemetryCommand(["off"], io, env);
    assert.equal(readSettings(env).enabled, false);
    assert.equal(readSettings(env).id, undefined);
    assert.equal(statSync(env["XDG_CONFIG_HOME"]!).isDirectory(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
