import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { journalVerbs } from "../journal/cli.ts";
import { openEscalations } from "../journal/read.ts";
import { loadJournal } from "../journal/store.ts";
import { CONTEXT_BUDGET, INSTRUCTION, REFUSE_EXIT, changedFiles, readStdinJson, runHook, sessionBlock } from "./hook.ts";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cli.ts");

let root: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "coherence-hook-"));
  await writeFile(join(root, "coherence.config.json"), JSON.stringify({ glossary: "vocab/glossary.json" }));
  await mkdir(join(root, "vocab"));
  await writeFile(
    join(root, "vocab", "glossary.json"),
    JSON.stringify({
      project: "widgetry",
      version: 0,
      concepts: [{ name: "widget", definition: "A thing with a knob.", aliases: ["gadget"] }],
      rejected: [{ concept: "doohickey", because: "retired surface" }],
    }),
  );
  await writeFile(join(root, "clean.md"), "The widget is fine.\n");
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "seed");
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("the block after the glossary is under 120 words: session, decide template, and the rule", async () => {
  const block = await sessionBlock(root, { session_id: "abc123", agent_type: "Explore" });
  assert.ok(block.split(/\s+/).filter((w) => w !== "").length < 120, block);
  assert.match(block, /^Session: abc123\n/);
  assert.match(block, /Every journal write needs --session abc123 --agent Explore\./);
  assert.match(block, /\n  node_modules\/\.bin\/coherence decide "<chose>" --over "<rejected>" --because "<why>" --session abc123 --agent Explore\n/);
  assert.ok(block.endsWith(`${INSTRUCTION}\n`));
  assert.match(INSTRUCTION, /rejected name .* defect/);
  assert.match(INSTRUCTION, /declared .* concept/);
  assert.match(INSTRUCTION, /alias of an existing concept/);
  assert.match(INSTRUCTION, /before this session ends/);

  const main = await sessionBlock(root, {});
  assert.match(main, /^Session: unknown\n/);
  assert.match(main, /--session <the id your harness shows> --agent main/);
});

test("SessionStart and SubagentStart inject both glossaries and the instruction as additionalContext", async () => {
  for (const event of ["SessionStart", "SubagentStart"] as const) {
    const result = await runHook(event, { cwd: root, session_id: "s1" }, "/nowhere");
    assert.equal(result.exit, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    assert.equal(parsed.hookSpecificOutput.hookEventName, event);
    const context = parsed.hookSpecificOutput.additionalContext;
    assert.match(context, /^Coherence vocabulary \(\d+ concepts/, "no escalation: the glossary comes first");
    assert.match(context, /\n\nSession: s1\nEvery journal write needs --session s1 --agent main\./);
    assert.match(context, /\nWidgetry vocabulary \(1 concept/);
    assert.match(context, /- widget: A thing with a knob\. \(also: gadget\)/);
    assert.match(context, /- rejected names: doohickey/);
    assert.ok(context.endsWith(`${INSTRUCTION}\n`));
    assert.ok(context.length <= CONTEXT_BUDGET);
  }
});

test("UserPromptSubmit and PostToolUse print nothing", async () => {
  for (const event of ["UserPromptSubmit", "PostToolUse"] as const) {
    assert.deepEqual(await runHook(event, { cwd: root }, root), { stdout: "", stderr: "", exit: 0 });
  }
});

test("Stop and SubagentStop with a clean working tree are silent", async () => {
  assert.deepEqual(await changedFiles(root), []);
  assert.deepEqual(await runHook("Stop", { cwd: root }, root), { stdout: "", stderr: "", exit: 0 });
  assert.deepEqual(await runHook("SubagentStop", { cwd: root }, root), { stdout: "", stderr: "", exit: 0 });
});

test("with defects in changed files: Stop reports and exits 0; SubagentStop refuses with exit 2 and the reason on stderr", async () => {
  await writeFile(join(root, "clean.md"), "The doohickey is back.\n");
  await writeFile(join(root, "new.md"), "The Sprocket Wheel turns. It turns the Sprocket Wheel again.\n");
  assert.deepEqual((await changedFiles(root)).sort(), ["clean.md", "new.md"]);

  const stop = await runHook("Stop", { cwd: root }, root);
  assert.equal(stop.exit, 0);
  assert.equal(stop.stderr, "");
  const message = (JSON.parse(stop.stdout) as { systemMessage: string }).systemMessage;
  assert.match(message, /REJECTED NAME  clean\.md:1  "doohickey"  rejected for widgetry: retired surface/);
  assert.match(message, /UNKNOWN NOUN   "sprocket wheel" \(2\)  new\.md:1, new\.md:1/);
  assert.match(message, /1 rejected name, 1 unknown noun \(2 files\)/);

  const subagent = await runHook("SubagentStop", { cwd: root, stop_hook_active: false }, root);
  assert.equal(subagent.exit, REFUSE_EXIT);
  assert.equal(subagent.stdout, "");
  assert.match(subagent.stderr, /^Regulate found what this session owes/);
  assert.match(subagent.stderr, /REJECTED NAME  clean\.md:1/);

  const again = await runHook("SubagentStop", { cwd: root, stop_hook_active: true }, root);
  assert.equal(again.exit, 0, "a stop hook already active never refuses twice");
  assert.match(again.stdout, /systemMessage/);
});

test("an unacknowledged escalation heads the start output; an acknowledged one does not", async () => {
  const printed: string[] = [];
  const io = { cwd: root, out: (line: string) => printed.push(line), err: (line: string) => printed.push(line) };
  const wrote = journalVerbs["escalate"]!(
    ["the widget's name is contested", "--because", "only the owner can settle a name", "--session", "s1", "--agent", "main"],
    io,
  );
  assert.equal(wrote, 0, printed.join("\n"));
  const open = openEscalations(loadJournal(root).records);
  assert.equal(open.length, 1);

  const before = await runHook("SubagentStart", { cwd: root, session_id: "s1", agent_type: "Plan" }, root);
  const context = (JSON.parse(before.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
  assert.match(context, /^Escalations awaiting a human \(1\); answer one with: acknowledge <id> --because/);
  assert.match(context, new RegExp(`^▲ ${open[0]!.id}  main  the widget's name is contested — only the owner can settle a name\n\nCoherence vocabulary`, "m"));
  assert.match(context, /--session s1 --agent Plan/);
  assert.ok(context.length <= CONTEXT_BUDGET);

  const answered = journalVerbs["acknowledge"]!([open[0]!.id, "--because", "call it a widget", "--session", "s1", "--agent", "main"], io);
  assert.equal(answered, 0, printed.join("\n"));
  const after = await runHook("SessionStart", { cwd: root, session_id: "s1" }, root);
  assert.match((JSON.parse(after.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext, /^Coherence vocabulary/);
});

test("readStdinJson tolerates empty and malformed input", async () => {
  assert.deepEqual(await readStdinJson(Readable.from([""])), {});
  assert.deepEqual(await readStdinJson(Readable.from(["not json"])), {});
  assert.deepEqual(await readStdinJson(Readable.from(['{"cwd":"/x",', '"stop_hook_active":true}'])), { cwd: "/x", stop_hook_active: true });
});

test("the CLI reads the event from stdin and uses its cwd", () => {
  const run = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hook", "SessionStart"], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: root, source: "startup" }),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout) as { hookSpecificOutput: { additionalContext: string } };
  assert.match(parsed.hookSpecificOutput.additionalContext, /Widgetry vocabulary/);

  const bad = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hook", "NoSuchEvent"], { input: "{}", encoding: "utf8" });
  assert.equal(bad.status, 64);
  assert.match(bad.stderr, /expected one of/);
});

test("orient lists open requirements and regulate reports them; only spec problems refuse a subagent stop", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { specBlock, specStopText } = await import("./hook.ts");
  const root = mkdtempSync(join(tmpdir(), "coherence-spec-hook-"));
  writeFileSync(join(root, "Root.spec.md"), "# Root\n\nA fixture project.\n\n## invariants\n- secure access: Only a member with permission reads a secured resource.\n  because: the resource is private to its member.\n");
  const start = specBlock(root);
  assert.match(start, /^Open requirements \(1 of 1 bullets\)/);
  assert.match(start, /○ \.\/secure access — lacks: enforcement, refutation, kinds/);
  const stop = specStopText(root);
  assert.equal(stop.problems, 0, "an open requirement is not a grammar problem");
  assert.match(stop.text, /^1 requirement still short of invariant: \.\/secure access \(lacks enforcement, refutation, kinds\)/);
  writeFileSync(join(root, "Root.spec.md"), "# Root\n\nA fixture project.\n\n## works when\n- typechecks\n");
  const broken = specStopText(root);
  assert.ok(broken.problems > 0, "a retired section is a problem and refuses a subagent stop");
});
