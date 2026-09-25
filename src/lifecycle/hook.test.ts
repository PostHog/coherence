import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { journalVerbs } from "../journal/cli.ts";
import { openEscalations } from "../journal/read.ts";
import { loadJournal } from "../journal/store.ts";
import { FEED_CAP, FEED_DIR, readCursor } from "../journal/feed.ts";
import { BOUNDARY_RULE, CONTEXT_BUDGET, HOOK_EVENTS, INSTRUCTION, OUTSIDE_ROOT_EXIT, REFUSE_EXIT, WARM_DOOR, changedFiles, cliName, feedContext, readStdinJson, adopterExample, adopterInstruction, runHook, sessionBlock, type WarmDoor } from "./hook.ts";
import { withWarmAdapter } from "../enforcement/run.ts";
import { TRACES_DIR, recordReadTrace } from "../economy/trace.ts";
import { COHERENCE_LEXICON, installedRoot } from "./project.ts";
import { loadLexicon, rejectedNames } from "./lexicon.ts";

/** Coherence's own rejected names, drawn from its lexicon so this file never spells one. */
async function coherenceRejected(concept: string): Promise<string> {
  return rejectedNames(await loadLexicon(COHERENCE_LEXICON)).find((n) => n.concept === concept && !n.name.includes(" "))!.name;
}
async function adopterRule(): Promise<string> {
  return adopterInstruction(adopterExample(await loadLexicon(COHERENCE_LEXICON)));
}

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cli.ts");

let root: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "coherence-hook-"));
  await writeFile(join(root, "coherence.config.json"), JSON.stringify({ lexicon: "vocab/lexicon.json" }));
  await mkdir(join(root, "vocab"));
  await writeFile(
    join(root, "vocab", "lexicon.json"),
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
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

test("the block after the lexicon is under 120 words: session, decide template, and the rule", async () => {
  const block = await sessionBlock(root, { session_id: "abc123", agent_type: "Explore" });
  assert.ok(block.split(/\s+/).filter((w) => w !== "").length < 120, block);
  assert.match(block, /^Session: abc123\n/);
  assert.match(block, /Every journal write needs --session abc123 --agent Explore\./);
  const cli = await cliName(root);
  assert.match(cli, /^node \S*src\/cli\.ts$/, "an adopter is told the checkout the hook ran from, never a path into its node_modules");
  assert.ok(block.includes(`\n  ${cli} decide "<chose>" --over "<rejected>" --because "<why>" --session abc123 --agent Explore\n`), block);
  assert.ok(block.includes(`Read the project journal from the project root:\n  ${cli} journal\n`), block);
  const rule = await adopterRule();
  assert.ok(block.endsWith(`${rule}\n`), "an adopter is given the rule its check enforces");
  assert.ok(rule.includes(`say invariant, not ${await coherenceRejected("invariant")}`), "the example swap comes from the lexicon");
  assert.match(rule, /project's rejected names are defects/);
  assert.match(rule, /adoption baseline/);
  const own = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  assert.ok((await sessionBlock(own, { session_id: "abc123" })).endsWith(`${INSTRUCTION}\n`), "Coherence's own repository keeps the strict rule");
  assert.match(INSTRUCTION, /rejected name .* defect/);
  assert.match(INSTRUCTION, /declared .* concept/);
  assert.match(INSTRUCTION, /alias of an existing concept/);
  assert.match(INSTRUCTION, /before this session ends/);

  const main = await sessionBlock(root, {});
  assert.match(main, /^Session: unknown\n/);
  assert.match(main, /--session <the id your harness shows> --agent main/);
});

test("SessionStart and SubagentStart inject both lexicons and the instruction as additionalContext", async () => {
  for (const event of ["SessionStart", "SubagentStart"] as const) {
    const result = await runHook(event, { cwd: root, session_id: "s1" }, tmpdir());
    assert.equal(result.exit, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    assert.equal(parsed.hookSpecificOutput.hookEventName, event);
    const context = parsed.hookSpecificOutput.additionalContext;
    assert.match(context, /^Coherence vocabulary \(\d+ concepts/, "no escalation: the lexicon comes first");
    assert.match(context, /\n\nSession: s1\nEvery journal write needs --session s1 --agent main\./);
    assert.match(context, /\nWidgetry vocabulary \(1 concept/);
    assert.match(context, /- widget: A thing with a knob\. \(also: gadget\)/);
    assert.match(context, /- rejected names: doohickey/);
    assert.ok(context.includes(`Read the project journal from the project root:\n  ${await cliName(root)} journal\n`));
    assert.ok(context.endsWith(`${await adopterRule()}\n`));
    assert.match(context, /^Coherence vocabulary \(\d+ concepts; use these names when you mean Coherence's concepts\):/m, "an adopter's header does not call Coherence's rejected names defects");
    assert.ok(context.length <= CONTEXT_BUDGET);
  }
});

test("Coherence's own start hooks name its source-tree journal command", async () => {
  const dir = await freshRoot();
  try {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "coherence" }));
    for (const event of ["SessionStart", "SubagentStart"] as const) {
      const result = await runHook(event, { cwd: dir, session_id: "s-journal" }, dir);
      assert.equal(result.exit, 0);
      const context = contextOf(result);
      assert.match(context, /Read the project journal from the project root:\n  node src\/cli\.ts journal\n/);
      assert.doesNotMatch(context, /node_modules\/\.bin\/coherence/);
      assert.ok(context.length <= CONTEXT_BUDGET);
    }
    const block = await sessionBlock(dir, { session_id: "s-journal" });
    assert.ok(block.split(/\s+/).filter((w) => w !== "").length < 120, block);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("UserPromptSubmit and PostToolUse print nothing", async () => {
  for (const event of ["UserPromptSubmit", "PostToolUse"] as const) {
    assert.deepEqual(await runHook(event, { cwd: root }, root), { stdout: "", stderr: "", exit: 0 });
  }
});

test("Stop and SubagentStop with a clean working tree are silent", async () => {
  assert.deepEqual(await changedFiles(root), { files: [] });
  assert.deepEqual(await runHook("Stop", { cwd: root }, root), { stdout: "", stderr: "", exit: 0 });
  assert.deepEqual(await runHook("SubagentStop", { cwd: root }, root), { stdout: "", stderr: "", exit: 0 });
});

test("with defects in changed files: Stop reports and exits 0; SubagentStop refuses with exit 2 and the reason on stderr", async () => {
  await writeFile(join(root, "clean.md"), "The doohickey is back.\n");
  await writeFile(join(root, "new.md"), "The Sprocket Wheel turns.\nIt turns the Sprocket Wheel again.\nAsk the Sprocket Wheel.\n");
  assert.deepEqual((await changedFiles(root)).files.sort(), ["clean.md", "new.md"]);

  const stop = await runHook("Stop", { cwd: root }, root);
  assert.equal(stop.exit, 0);
  assert.equal(stop.stderr, "");
  const message = (JSON.parse(stop.stdout) as { systemMessage: string }).systemMessage;
  assert.match(message, /REJECTED NAME  clean\.md:1  "doohickey"  rejected for widgetry: retired surface/);
  assert.match(message, /UNKNOWN NOUN   "sprocket wheel" \(3\)  new\.md:1, new\.md:2, new\.md:3/);
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

test("an unknown noun in a changed file is advisory: Stop reports it and SubagentStop never refuses on it", async () => {
  // Its own starting tree: a totality oracle must hold when its test runs alone.
  await writeFile(join(root, "clean.md"), "The widget is fine.\n");
  await writeFile(join(root, "new.md"), "The Sprocket Wheel turns.\nIt turns the Sprocket Wheel again.\nAsk the Sprocket Wheel.\n");
  assert.deepEqual((await changedFiles(root)).files, ["new.md"], "only the file with the unknown noun is changed");
  const subagent = await runHook("SubagentStop", { cwd: root, stop_hook_active: false }, root);
  assert.equal(subagent.exit, 0, `an unknown noun is a nomination, not a proof: ${subagent.stderr}`);
  const message = (JSON.parse(subagent.stdout) as { systemMessage: string }).systemMessage;
  assert.match(message, /UNKNOWN NOUN   "sprocket wheel" \(3\)/, "it is still reported");
  await writeFile(join(root, "clean.md"), "The doohickey is back.\n");
});

test("in an adopter, Coherence's rejected names in the project's own code and prose never refuse a subagent stop", async () => {
  // Its own starting tree: only the files that use Coherence's rejected names in the project's sense are changed.
  await writeFile(join(root, "clean.md"), "The widget is fine.\n");
  const place = await coherenceRejected("trust level");
  const surface = await coherenceRejected("scope");
  await writeFile(join(root, "places.ts"), `export const ${place} = 'loading dock';\nexport const ${surface} = ${place};\n`);
  await writeFile(join(root, "floor.md"), `The ${place} by the ${surface} holds the widget.\n`);
  try {
    const subagent = await runHook("SubagentStop", { cwd: root, stop_hook_active: false }, root);
    assert.equal(subagent.exit, 0, `the project's own words never refuse: ${subagent.stderr}`);
    assert.doesNotMatch(subagent.stdout + subagent.stderr, /REJECTED NAME/, "and nothing reports them as rejected names");
  } finally {
    await rm(join(root, "places.ts"), { force: true });
    await rm(join(root, "floor.md"), { force: true });
    await writeFile(join(root, "clean.md"), "The doohickey is back.\n");
  }
});

test("an unable record from the session turns the debt it names advisory: SubagentStop reports it and exits 0, and another session is still refused", async () => {
  const io = { cwd: root, out: () => {}, err: () => {} };
  // Its own starting tree: a totality oracle must hold when its test runs alone.
  await writeFile(join(root, "clean.md"), "The doohickey is back.\n");
  const refused = await runHook("SubagentStop", { cwd: root, session_id: "s-unable", stop_hook_active: false }, root);
  assert.equal(refused.exit, REFUSE_EXIT, "the rejected name in clean.md refuses the stop");
  assert.equal(journalVerbs["unable"]!(["cannot rename doohickey in clean.md", "--because", "the owner keeps that fixture text; the rename is theirs", "--session", "s-unable", "--agent", "Plan"], io), 0);
  const excused = await runHook("SubagentStop", { cwd: root, session_id: "s-unable", stop_hook_active: false }, root);
  assert.equal(excused.exit, 0, `the wall was recorded, so the debt is advisory: ${excused.stderr}`);
  const message = (JSON.parse(excused.stdout) as { systemMessage: string }).systemMessage;
  assert.match(message, /REJECTED NAME  clean\.md:1  "doohickey"/, "the finding is still shown");
  assert.match(message, /advisory: recorded unable u-[0-9a-f]{8}/, "and says which record made it advisory");
  const other = await runHook("SubagentStop", { cwd: root, session_id: "s-other", stop_hook_active: false }, root);
  assert.equal(other.exit, REFUSE_EXIT, "an unable is this agent's, in this session; it clears nothing for another");

  const specRoot = await mkdtemp(join(tmpdir(), "coherence-unable-spec-"));
  try {
    await writeFile(join(specRoot, "Root.spec.md"), "# Root\n\nA fixture project.\n\n## works when\n- typechecks\n");
    const problem = await runHook("SubagentStop", { cwd: specRoot, session_id: "s-spec", stop_hook_active: false }, specRoot);
    assert.equal(problem.exit, REFUSE_EXIT, "a spec problem refuses the subagent stop");
    assert.equal(journalVerbs["unable"]!(["cannot repair Root.spec.md", "--because", "the retired section is the owner's to rewrite", "--session", "s-spec", "--agent", "Plan"], { ...io, cwd: specRoot }), 0);
    const allowed = await runHook("SubagentStop", { cwd: specRoot, session_id: "s-spec", stop_hook_active: false }, specRoot);
    assert.equal(allowed.exit, 0, `the recorded wall names the spec file: ${allowed.stderr}`);
    assert.match((JSON.parse(allowed.stdout) as { systemMessage: string }).systemMessage, /PROBLEM  Root\.spec\.md:.*\n.*advisory: recorded unable/);
  } finally {
    await rm(specRoot, { recursive: true, force: true });
  }
});

test("changedFiles reports a git failure instead of answering a clean tree; outside git the answer is no files", async () => {
  const outside = await mkdtemp(join(tmpdir(), "coherence-nogit-"));
  const broken = await mkdtemp(join(tmpdir(), "coherence-badgit-"));
  try {
    assert.deepEqual(await changedFiles(outside), { files: [] }, "no repository: nothing is changed and nothing failed");
    await writeFile(join(broken, ".git"), "this is not a gitfile\n");
    await writeFile(join(broken, "coherence.config.json"), JSON.stringify({ lexicon: "lexicon.json" }));
    await writeFile(join(broken, "lexicon.json"), JSON.stringify({ project: "widgetry", version: 0, concepts: [], rejected: [] }));
    const failed = await changedFiles(broken);
    assert.deepEqual(failed.files, []);
    assert.match(failed.failure ?? "", /git diff --name-only HEAD failed: .*gitfile/, "the failure names the command and git's reason");
    const stop = await runHook("Stop", { cwd: broken, session_id: "s-git" }, broken);
    assert.equal(stop.exit, 0);
    const message = (JSON.parse(stop.stdout) as { systemMessage: string }).systemMessage;
    assert.match(message, /Changed files: not known \(git diff --name-only HEAD failed: .*\); the lexicon check ran over nothing/);
    const subagent = await runHook("SubagentStop", { cwd: broken, session_id: "s-git", stop_hook_active: false }, broken);
    assert.equal(subagent.exit, 0, "what the tool cannot see it cannot prove owed, so it reports and never refuses");
  } finally {
    await rm(outside, { recursive: true, force: true });
    await rm(broken, { recursive: true, force: true });
  }
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

test("an open escalation that cites a decision and a work order names each by id, kind and subject in the start output", async () => {
  const printed: string[] = [];
  const io = { cwd: root, out: (line: string) => printed.push(line), err: (line: string) => printed.push(line) };
  const who = ["--session", "s1", "--agent", "main"];
  assert.equal(journalVerbs["decide"]!(["the widget keeps one name", "--because", "two names split the docs", ...who], io), 0, printed.join("\n"));
  const decision = printed.at(-2)!.split(/\s+/)[0]!;
  assert.equal(journalVerbs["work"]!(["create", "rename the widget", "--success", "one name in docs", "--boundary", "docs", ...who], io), 0, printed.join("\n"));
  const order = printed.at(-2)!.split(/\s+/)[0]!;
  assert.equal(journalVerbs["escalate"]!(["may the widget be renamed", "--because", "only the owner renames", "--cite", decision, "--cite", order, ...who], io), 0, printed.join("\n"));
  const escalation = openEscalations(loadJournal(root).records).find((e) => e.what === "may the widget be renamed")!;

  const start = await runHook("SessionStart", { cwd: root, session_id: "s1" }, root);
  const context = (JSON.parse(start.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
  assert.match(context, new RegExp(`▲ ${escalation.id}  main  may the widget be renamed — only the owner renames\\n  about ${decision}  decision  main: the widget keeps one name\\n  about ${order}  work order  main: rename the widget\\n`));
  assert.ok(context.length <= CONTEXT_BUDGET);

  assert.equal(journalVerbs["acknowledge"]!([escalation.id, "--because", "renamed", ...who], io), 0, printed.join("\n"));
});

test("the start injection stays under the budget with escalations present: the vocabulary steps down to names and then to a pointer, and no escalation is shortened", async () => {
  const dir = await freshRoot();
  try {
    const io = { cwd: dir, out: () => {}, err: () => {} };
    const ids: string[] = [];
    const what = (n: number): string => `retire invariant ${n}: ${"the chokepoint no longer reflects how the store is reached and a human must weigh the reliance listing ".repeat(4)}`;
    for (let n = 0; n < 8; n += 1) {
      const printed: string[] = [];
      assert.equal(journalVerbs["escalate"]!([what(n), "--because", `only the owner can retire a vertebra, and this is the ${n}th`, "--session", `peer-${n}`, "--agent", "scope"], { ...io, out: (l) => printed.push(l) }), 0);
      ids.push(printed[0]!.split(/\s+/)[0]!);
    }
    const context = contextOf(await runHook("SessionStart", { cwd: dir, session_id: "s-budget" }, dir));
    assert.ok(context.length <= CONTEXT_BUDGET, `${context.length} characters against a budget of ${CONTEXT_BUDGET}`);
    for (let n = 0; n < 8; n += 1) assert.ok(context.includes(`▲ ${ids[n]}  scope  ${what(n)} — only the owner can retire a vertebra, and this is the ${n}th`), `escalation ${n} is shown whole`);
    assert.doesNotMatch(context, /^- invariant: /m, "the vocabulary stepped down: no full concept line");
    assert.match(context, /^Coherence vocabulary \(\d+ concepts; names only here, use these names when you mean Coherence's concepts; full entries: coherence lexicon\):\n/m, "Coherence's layer at names only");
    assert.match(context, /\nSession: s-budget\n/, "the session block still rides along");

    // More escalations, until even the names do not fit: the vocabulary gives way to one line that points at the lexicon command.
    let pointed = context;
    for (let n = 8; n < 40 && /^Coherence vocabulary/m.test(pointed); n += 1) {
      const printed: string[] = [];
      assert.equal(journalVerbs["escalate"]!([what(n), "--because", `only the owner can retire a vertebra, and this is the ${n}th`, "--session", `peer-${n}`, "--agent", "scope"], { ...io, out: (l) => printed.push(l) }), 0);
      ids.push(printed[0]!.split(/\s+/)[0]!);
      pointed = contextOf(await runHook("SessionStart", { cwd: dir, session_id: "s-budget" }, dir));
    }
    assert.doesNotMatch(pointed, /^Coherence vocabulary/m, "the names no longer fit");
    assert.ok(pointed.includes(`\n  ${await cliName(dir)} journal\n`), "the journal command survives the reduced vocabulary");
    assert.ok(pointed.includes(`\nVocabulary omitted to stay under the host budget; full entries: ${await cliName(dir)} lexicon\n`), "one line points at the lexicon command instead");
    assert.ok(pointed.length <= CONTEXT_BUDGET, `${pointed.length} characters against a budget of ${CONTEXT_BUDGET}`);
    ids.forEach((id, n) => assert.ok(pointed.includes(`▲ ${id}  scope  ${what(n)} — only the owner`), `escalation ${n} is still shown whole`));

    const one = await freshRoot();
    try {
      assert.equal(journalVerbs["escalate"]!(["one question", "--because", "a human decides", "--session", "peer", "--agent", "scope"], { ...io, cwd: one }), 0);
      const light = contextOf(await runHook("SessionStart", { cwd: one, session_id: "s-light" }, one));
      assert.ok(light.length <= CONTEXT_BUDGET);
      assert.match(light, /^Escalations awaiting a human \(1\)/);
      assert.match(light, /^- invariant: /m, "with room to spare the vocabulary is injected in full");
    } finally {
      await rm(one, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the hook refuses a cwd from stdin that is not inside the project root it was installed for", async () => {
  const installed = await freshRoot();
  const stranger = await freshRoot();
  try {
    await mkdir(join(installed, ".claude"), { recursive: true });
    await writeFile(join(installed, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));
    await writeFile(join(stranger, "notes.md"), "The stranger's tree.\n");
    assert.equal(installedRoot(installed, {}), realpathSync(installed), "the settings file names the tree the hook was installed for");
    assert.equal(installedRoot(stranger, {}), undefined, "no settings file anywhere above it: no installation to defend");

    const inside = join(installed, "src", "deep");
    await mkdir(inside, { recursive: true });
    assert.equal(installedRoot(inside, { CLAUDE_PROJECT_DIR: installed }), realpathSync(installed), "the harness's own name for the project is honored");
    assert.equal(installedRoot(inside, { CLAUDE_PROJECT_DIR: stranger }), realpathSync(installed), "a name that does not contain where the process runs was inherited from elsewhere");
    for (const event of HOOK_EVENTS) {
      const ok = await runHook(event, { cwd: inside, session_id: "child" }, installed);
      assert.notEqual(ok.exit, OUTSIDE_ROOT_EXIT, `${event}: a cwd under the installed root is the project's own`);
    }

    for (const event of HOOK_EVENTS) {
      const out = await runHook(event, { cwd: stranger, session_id: "child" }, installed);
      assert.equal(out.exit, OUTSIDE_ROOT_EXIT, `${event}: a cwd outside the installed root is refused`);
      assert.equal(out.stdout, "", `${event}: nothing is injected from a tree that is not ours`);
      assert.match(out.stderr, /is not inside the project root this hook was installed for/);
      assert.match(out.stderr, new RegExp(stranger.replace(/[/\\.]/g, "\\$&")), "the refusal names the cwd it was handed");
    }
    assert.equal(existsSync(join(stranger, ".coherence")), false, "the stranger's tree was never written to");
  } finally {
    await rm(installed, { recursive: true, force: true });
    await rm(stranger, { recursive: true, force: true });
  }
});

test("the Stop snapshot reaches the instrument through enforcement's one door, in production as in a test", async () => {
  assert.equal(WARM_DOOR, withWarmAdapter, "the door the hook holds is enforcement's own; a production stop passes none of its own");
  const dir = await freshRoot();
  try {
    const seed = (...args: string[]): void => void execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir });
    seed("init", "-q");
    seed("add", ".");
    seed("commit", "-q", "-m", "seed");
    // One untracked file is the patch the snapshot predicts a closure for.
    await writeFile(join(dir, "note.md"), "A file this session changed.\n");
    recordReadTrace(dir, "child", { tool_name: "Read", tool_input: { file_path: join(dir, "note.md") } });

    // A door that hands back an adapter, as the warm server does when one answers.
    let asked: string | undefined;
    const door: WarmDoor = async (root, fn) => {
      asked = root;
      return fn({ language: "typescript" } as never, "warm", undefined);
    };
    const stop = await runHook("Stop", { cwd: dir, session_id: "child" }, dir, { door });
    assert.equal(stop.exit, 0, stop.stderr);
    assert.equal(asked, dir, "the stop asked the door for this project's instrument");
    const lines = readFileSync(join(dir, TRACES_DIR, "child.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { kind: string; instrument?: { language: string; server: string; reason?: string } });
    const snapshot = lines.find((l) => l.kind === "snapshot");
    assert.ok(snapshot !== undefined, "the stop wrote a snapshot");
    assert.equal(snapshot.instrument?.server, "warm", "the snapshot records the instrument the door handed over, not a hop-less closure");
    assert.equal(snapshot.instrument?.reason, undefined, "a door that answered leaves no reason");

    // A door that cannot connect hands back its reason, and the snapshot says so rather than "no adapter".
    const shut: WarmDoor = async (root, fn) => fn(undefined, undefined, "no server answered and none could be spawned");
    await runHook("Stop", { cwd: dir, session_id: "child2" }, dir, { door: shut });
    const second = readFileSync(join(dir, TRACES_DIR, "child2.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { kind: string; instrument?: { reason?: string } });
    assert.equal(second.find((l) => l.kind === "snapshot")?.instrument?.reason, "no server answered and none could be spawned");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readStdinJson tolerates empty and malformed input", async () => {
  assert.deepEqual(await readStdinJson(Readable.from([""])), {});
  assert.deepEqual(await readStdinJson(Readable.from(["not json"])), {});
  assert.deepEqual(await readStdinJson(Readable.from(['{"cwd":"/x",', '"stop_hook_active":true}'])), { cwd: "/x", stop_hook_active: true });
});

test("the CLI reads the event from stdin and uses its cwd", () => {
  // Started in the temp root's parent and told about the temp root on stdin: only the stdin cwd reaches Widgetry.
  const run = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hook", "SessionStart"], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: root, source: "startup" }),
    encoding: "utf8",
    cwd: tmpdir(),
  });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout) as { hookSpecificOutput: { additionalContext: string } };
  assert.match(parsed.hookSpecificOutput.additionalContext, /Widgetry vocabulary/);

  const bad = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "hook", "NoSuchEvent"], { input: "{}", encoding: "utf8", cwd: tmpdir() });
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
  assert.match(stop.text, /^1 requirement open in the project; run: spec --check$/);
  const mine = specStopText(root, ["Root.spec.md"]);
  assert.match(mine.text, /^○ \.\/secure access — still a requirement; lacks: enforcement, refutation, kinds\n1 requirement open in the project, 1 in specs this session changed/);
  writeFileSync(join(root, "Root.spec.md"), "# Root\n\nA fixture project.\n\n## works when\n- typechecks\n");
  const brokenText = specStopText(root);
  assert.ok(brokenText.problems > 0, "a retired section is a problem and refuses a subagent stop");
  const { runHook: hook, REFUSE_EXIT: refuseExit } = await import("./hook.ts");
  const refused = await hook("SubagentStop", { cwd: root, stop_hook_active: false }, root);
  assert.equal(refused.exit, refuseExit, "a spec problem refuses the subagent stop");
  writeFileSync(join(root, "Root.spec.md"), "# Root\n\nA fixture project.\n\n## invariants\n- secure access: Only a member with permission reads a secured resource.\n  because: the resource is private to its member.\n");
  const allowed = await hook("SubagentStop", { cwd: root, stop_hook_active: false }, root);
  assert.equal(allowed.exit, 0, "an open requirement never refuses a subagent stop");
  assert.match(allowed.stdout, /1 requirement open in the project/, "the open requirement is still reported");
});

/** A project of its own for the work and feed tests, so the shared root's journal stays as the earlier tests left it. */
async function freshRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "coherence-hook-work-"));
  await writeFile(join(dir, "coherence.config.json"), JSON.stringify({ lexicon: "lexicon.json" }));
  await writeFile(join(dir, "lexicon.json"), JSON.stringify({ project: "widgetry", version: 0, concepts: [], rejected: [] }));
  return dir;
}

function verb(cwd: string, name: string, ...argv: string[]): string[] {
  const printed: string[] = [];
  const io = { cwd, out: (line: string) => printed.push(line), err: (line: string) => printed.push(line) };
  const code = journalVerbs[name]!(argv, io);
  assert.equal(code, 0, printed.join("\n"));
  return printed;
}

function idOf(printed: string[]): string {
  return printed[0]!.split(/\s+/)[0]!;
}

function contextOf(result: { stdout: string }): string {
  return (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
}

test("orient prints the active order a session owns with the boundary rule, nudges an open one, and regulate reminds that work close ends it", async () => {
  const dir = await freshRoot();
  try {
    const silent = await runHook("SubagentStart", { cwd: dir, session_id: "child", agent_type: "Plan" }, dir);
    assert.doesNotMatch(contextOf(silent), /Work order/, "no order, no block");

    const id = idOf(verb(dir, "work", "create", "ship the feed", "--success", "hook.test.ts covers the feed", "--boundary", "src/journal only", "--owner-session", "child", "--session", "main-1", "--agent", "main"));
    const open = contextOf(await runHook("SubagentStart", { cwd: dir, session_id: "child", agent_type: "Plan" }, dir));
    assert.match(open, new RegExp(`Work order ${id} is open, not active; nothing binds to it until: work move ${id} active --because "<taking it up>" --session child --agent Plan\n  objective: ship the feed`));
    assert.doesNotMatch(open, /every journal write and run this session makes binds/);
    assert.deepEqual(await runHook("Stop", { cwd: dir, session_id: "child" }, dir), { stdout: "", stderr: "", exit: 0 }, "an open order owes nothing at the stop");

    verb(dir, "work", "move", id, "active", "--because", "taking it up", "--session", "child", "--agent", "Plan");
    const active = contextOf(await runHook("SessionStart", { cwd: dir, session_id: "child", agent_type: "Plan" }, dir));
    const rule = BOUNDARY_RULE.replace(/[().:]/g, "\\$&");
    assert.match(active, new RegExp(`^Work order ${id} \\(active; every journal write and run this session makes binds to it\\):\n  objective: ship the feed\n  success:   hook.test.ts covers the feed\n  boundary:  src/journal only\n  ${rule}\n\nCoherence vocabulary`));
    assert.ok(active.length <= CONTEXT_BUDGET);
    const other = contextOf(await runHook("SessionStart", { cwd: dir, session_id: "main-1" }, dir));
    assert.doesNotMatch(other, /Work order/, "the order is the owner's, not the creator's");

    for (const event of ["Stop", "SubagentStop"] as const) {
      const stop = await runHook(event, { cwd: dir, session_id: "child", agent_type: "Plan", stop_hook_active: false }, dir);
      assert.equal(stop.exit, 0, "an active order is a reminder, never a refusal");
      const message = (JSON.parse(stop.stdout) as { systemMessage: string }).systemMessage;
      assert.match(message, new RegExp(`^Regulate \\(${event}\\):\nWork:\nWork order ${id} is still active \\(ship the feed\\)\\. When its success criterion holds, close it: work close ${id} --because "<what was done>" --session child --agent Plan$`));
    }

    const second = idOf(verb(dir, "work", "create", "another", "--success", "s", "--boundary", "b", "--session", "child", "--agent", "Plan"));
    verb(dir, "work", "move", second, "active", "--because", "also", "--session", "child", "--agent", "Plan");
    const several = contextOf(await runHook("SessionStart", { cwd: dir, session_id: "child" }, dir));
    assert.match(several, /^This session owns 2 active work orders, so nothing binds by inference; pass --work <id> on each write:\n/);

    verb(dir, "work", "close", id, "--because", "done", "--session", "child", "--agent", "Plan");
    verb(dir, "work", "close", second, "--because", "done", "--session", "child", "--agent", "Plan");
    assert.deepEqual(await runHook("Stop", { cwd: dir, session_id: "child" }, dir), { stdout: "", stderr: "", exit: 0 }, "closed orders owe nothing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the peer feed injects a peer's decisions and escalations and no other kind", async () => {
  const dir = await freshRoot();
  try {
    verb(dir, "decide", "before the child began", "--because", "old", "--session", "main-1", "--agent", "main");
    await runHook("SubagentStart", { cwd: dir, session_id: "child", agent_type: "Plan" }, dir);

    // One record of every other kind a peer can write, between two the feed must carry.
    const decision = idOf(verb(dir, "decide", "a peer chose the store", "--because", "b", "--session", "peer-1", "--agent", "scope"));
    const conjecture = idOf(verb(dir, "conjecture", "a peer noticed something", "--could-be", "one", "--discriminated-by", "a test", "--session", "peer-1", "--agent", "scope"));
    const defect = idOf(verb(dir, "defect", "a peer saw a deviation", "--evidence", "a report", "--session", "peer-1", "--agent", "scope"));
    const wall = idOf(verb(dir, "unable", "a peer hit a wall", "--because", "no password", "--session", "peer-1", "--agent", "scope"));
    const retraction = idOf(verb(dir, "retract", decision, "--because", "the test said otherwise", "--session", "peer-1", "--agent", "scope"));
    const resolution = idOf(verb(dir, "resolved", conjecture, "--because", "the test showed one", "--session", "peer-1", "--agent", "scope"));
    const escalation = idOf(verb(dir, "escalate", "a peer needs a human", "--because", "only a human decides", "--session", "peer-2", "--agent", "economy"));

    const feed = contextOf(await runHook("UserPromptSubmit", { cwd: dir, session_id: "child" }, dir));
    const lines = feed.trimEnd().split("\n");
    assert.match(lines[0]!, /^Peers recorded 2 since your last look/, "two records of the two kinds the feed carries, not seven");
    assert.deepEqual(lines.slice(1), [
      `\u25c6 ${decision} scope: a peer chose the store`,
      `\u25b2 ${escalation} economy: a peer needs a human  [escalation: a human must answer]`,
    ]);
    for (const [kind, id] of [["conjecture", conjecture], ["defect", defect], ["unable", wall], ["retraction", retraction], ["resolution", resolution]] as const) {
      assert.doesNotMatch(feed, new RegExp(id), `a peer's ${kind} is the journal's, not the feed's`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the peer feed injects subjects of other sessions' records since the cursor, capped, never full records", async () => {
  const dir = await freshRoot();
  try {
    verb(dir, "decide", "before the child began", "--because", "old", "--session", "main-1", "--agent", "main");
    const start = await runHook("SubagentStart", { cwd: dir, session_id: "child", agent_type: "Plan" }, dir);
    assert.equal(start.exit, 0);
    assert.notEqual(readCursor(dir, "child"), null, "the start sets the cursor at the latest record");
    assert.deepEqual(await runHook("UserPromptSubmit", { cwd: dir, session_id: "child" }, dir), { stdout: "", stderr: "", exit: 0 }, "nothing new since the start");

    const mine = idOf(verb(dir, "decide", "my own", "--because", "b", "--session", "child", "--agent", "Plan"));
    const subject = "peer chose JSONL because it needs no dependencies and the reference proved a native module is a wall for a subagent in a fresh worktree";
    assert.ok(subject.length > 120);
    const peer = idOf(verb(dir, "decide", subject, "--over", "sqlite", "--because", "the long because that must never be injected", "--session", "peer-1", "--agent", "scope"));
    const escalation = idOf(verb(dir, "escalate", "retire an invariant", "--because", "only a human", "--session", "peer-2", "--agent", "economy"));

    const prompt = await runHook("UserPromptSubmit", { cwd: dir, session_id: "child" }, dir);
    assert.equal(prompt.exit, 0);
    prompt.commit?.(); // the command line commits once its print succeeded; here the print is the assertion below
    const parsed = JSON.parse(prompt.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    const feed = parsed.hookSpecificOutput.additionalContext;
    const lines = feed.trimEnd().split("\n");
    assert.match(lines[0]!, /^Peers recorded 2 since your last look \(subjects only; whole records: journal --since \S+\):$/);
    assert.equal(lines[1], `◆ ${peer} scope: ${subject.slice(0, 119)}…`, "the subject is truncated to 120 characters");
    assert.equal(lines[2], `▲ ${escalation} economy: retire an invariant  [escalation: a human must answer]`);
    assert.equal(lines.length, 3);
    assert.doesNotMatch(feed, /the long because|over:|sqlite/, "subjects only, never a full record");
    assert.doesNotMatch(feed, new RegExp(mine), "a session's own records are not its peers'");

    assert.deepEqual(await runHook("PostToolUse", { cwd: dir, session_id: "child", tool_name: "Read", tool_input: { file_path: "x" } }, dir), { stdout: "", stderr: "", exit: 0 }, "the cursor advanced: the same records are not shown twice");

    for (let n = 0; n < FEED_CAP + 3; n += 1) verb(dir, "decide", `peer decision ${n}`, "--because", "b", "--session", "peer-1", "--agent", "scope");
    const tool = await runHook("PostToolUse", { cwd: dir, session_id: "child", tool_name: "Read", tool_input: { file_path: "x" } }, dir);
    tool.commit?.();
    const capped = contextOf(tool).trimEnd().split("\n");
    assert.match(capped[0]!, new RegExp(`^Peers recorded ${FEED_CAP + 3} since your last look`));
    assert.equal(capped.length, FEED_CAP + 2, "a header, the cap, and the count of the rest");
    assert.match(capped.at(-1)!, /^and 3 more; run: journal --since \S+$/);
    const since = /journal --since (\S+)\)/.exec(capped[0]!)![1]!;
    const whole: string[] = [];
    journalVerbs["journal"]!(["--since", since], { cwd: dir, out: (l) => whole.push(l), err: () => {} });
    assert.equal(whole.filter((l) => /peer decision/.test(l)).length, FEED_CAP + 3, "the named command shows every record the cap hid");
    assert.deepEqual(await runHook("UserPromptSubmit", { cwd: dir, session_id: "child" }, dir), { stdout: "", stderr: "", exit: 0 });
    assert.deepEqual(await runHook("UserPromptSubmit", { cwd: dir }, dir), { stdout: "", stderr: "", exit: 0 }, "no session, no cursor, no feed");
    assert.ok(!existsSync(join(dir, ".coherence", "journal", "child.cursor")), "the cursor lives under the feed directory, not the journal");
    assert.ok(existsSync(join(dir, FEED_DIR, "child.cursor")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Run the hook CLI on an event; with `closePipe` the host's end of stdout is closed before the hook can write, as a host that died would leave it. */
function spawnHook(dir: string, event: string, input: object, closePipe: boolean): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--disable-warning=ExperimentalWarning", CLI, "hook", event], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    if (closePipe) child.stdout.destroy();
    else {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
    }
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test("the feed cursor advances only after the feed is printed: rendering moves nothing, and the CLI commits only once its stdout write succeeded", async () => {
  const dir = await freshRoot();
  try {
    await runHook("SubagentStart", { cwd: dir, session_id: "child" }, dir);
    verb(dir, "decide", "seed", "--because", "b", "--session", "main-1", "--agent", "main");
    await runHook("UserPromptSubmit", { cwd: dir, session_id: "child" }, dir);
    const before = readCursor(dir, "child");
    verb(dir, "decide", "peer wrote", "--because", "b", "--session", "peer-1", "--agent", "scope");
    const first = feedContext(dir, { session_id: "child" });
    assert.match(first.text, /peer wrote/);
    assert.deepEqual(readCursor(dir, "child"), before, "rendering the feed moves nothing");
    const again = feedContext(dir, { session_id: "child" });
    assert.equal(again.text, first.text, "an uncommitted feed is shown again");
    const rendered = await runHook("UserPromptSubmit", { cwd: dir, session_id: "child" }, dir);
    assert.match(rendered.stdout, /peer wrote/);
    assert.deepEqual(readCursor(dir, "child"), before, "runHook renders the feed and hands the advance back; it commits nothing itself");
    assert.equal(typeof rendered.commit, "function", "the advance rides with the result for the caller that prints");

    // The CLI boundary: the host's end of the pipe is gone, so the write fails and the cursor must stay.
    const lost = await spawnHook(dir, "UserPromptSubmit", { session_id: "child", cwd: dir }, true);
    assert.notEqual(lost.status, 0, `a hook whose output never reached the host does not exit 0: ${lost.stderr}`);
    assert.deepEqual(readCursor(dir, "child"), before, "the cursor did not move: the feed the host never received is shown again");

    const printed = await spawnHook(dir, "UserPromptSubmit", { session_id: "child", cwd: dir }, false);
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /peer wrote/, "the unprinted feed is shown again");
    assert.notDeepEqual(readCursor(dir, "child"), before, "the commit after the print moves the cursor");
    assert.equal(feedContext(dir, { session_id: "child" }).text, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
