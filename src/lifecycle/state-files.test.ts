import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadRuns, type RunRecord } from "../enforcement/record.ts";
import { appendWhole } from "../journal/append.ts";
import { loadJournal } from "../journal/store.ts";
import { storeDir } from "../journal/stores.ts";
import { loadWork } from "../journal/work.ts";
import type { Decision, WorkOrderRecord } from "../journal/record.ts";
import { RECORD_STORES } from "./project.ts";
import { ATTRIBUTES_FILE, ATTRIBUTES_TEXT, ATTRIBUTE_LINES, EARLIER_ATTRIBUTES_TEXTS, EARLIER_IGNORE_TEXTS, IGNORE_FILE, IGNORE_TEXT, keepAttributes, keepIgnore, keepStateFiles, removeStateFiles, REPLAY_IGNORE_TEXT, replayIgnoreDisagreement } from "./state-files.ts";
import { replayBlock } from "./hook.ts";

const fixtures: string[] = [];

after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `coherence-${name}-`)));
  fixtures.push(dir);
  return dir;
}

function git(root: string, ...args: string[]): { status: number; out: string } {
  const run = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: root, encoding: "utf8" });
  return { status: run.status ?? 1, out: `${run.stdout}${run.stderr}` };
}

function ok(root: string, ...args: string[]): void {
  const run = git(root, ...args);
  assert.equal(run.status, 0, `git ${args.join(" ")}: ${run.out}`);
}

const SESSION = "stacked-session";

function decision(n: string, at: string): Decision {
  return { id: `d-${n.padStart(8, "0")}`, kind: "decision", at, session: SESSION, agent: "tester", commit: null, dirty: false, chose: `choice ${n}`, over: [`not ${n}`], because: `reason ${n}` } as Decision;
}

function order(n: string, at: string): WorkOrderRecord {
  return { id: `wo-${n.padStart(8, "0")}`, kind: "order", at, session: SESSION, agent: "tester", commit: null, dirty: false, objective: `objective ${n}`, success: "done", boundary: "here", owner: SESSION };
}

function run(at: string, name: string): RunRecord {
  return {
    at,
    session: SESSION,
    agent: "tester",
    commit: null,
    dirty: false,
    instrument: { language: "typescript", server: "none" },
    latency: 1,
    invariants: [{ component: "src/a", name, form: "totality oracle", verdict: "pass", refutation: "missing", bypasses: [], testReferences: 0, files: [], latency: 1, reason: "passed" }],
  };
}

/** A store's legacy session file, the one file per session releases before sealed shards append to (journal/shards.ts). */
function legacy(root: string, store: "journal" | "work" | "runs"): string {
  mkdirSync(join(root, storeDir(store)), { recursive: true });
  return join(root, storeDir(store), `${SESSION}.jsonl`);
}

/** One record in every record store, all under the one session, appended to its legacy session file as a release before sealed shards appends it. */
function appendAll(root: string, n: string, at: string): void {
  appendWhole(legacy(root, "journal"), `${JSON.stringify(decision(n, at))}\n`);
  appendWhole(legacy(root, "work"), `${JSON.stringify(order(n, at))}\n`);
  appendWhole(legacy(root, "runs"), `${JSON.stringify(run(at, `invariant ${n}`))}\n`);
}

/**
 * The stack: a base with one record per store, then two branches from it
 * that each append different records to the same session's file in every
 * store, as two stacked branches of one session do.
 */
function stack(withAttributes: boolean): string {
  const root = fixture("stack");
  ok(root, "init", "-q", "-b", "main");
  // As install leaves a project: regenerated state ignored, and the attributes unless this is the control.
  keepIgnore(root, true);
  if (withAttributes) keepAttributes(root);
  appendAll(root, "1", "2026-10-01T10:00:00.000Z");
  ok(root, "add", "-A");
  ok(root, "commit", "-q", "-m", "base");
  ok(root, "switch", "-q", "-c", "lower");
  appendAll(root, "2", "2026-10-01T11:00:00.000Z");
  ok(root, "commit", "-q", "-am", "lower");
  ok(root, "switch", "-q", "-c", "upper", "main");
  appendAll(root, "3", "2026-10-01T12:00:00.000Z");
  appendAll(root, "4", "2026-10-01T12:30:00.000Z");
  ok(root, "commit", "-q", "-am", "upper");
  return root;
}

/** Every record of both branches loads, from every store, with nothing damaged. */
function assertAllLoad(root: string, how: string): void {
  const journal = loadJournal(root);
  assert.deepEqual(journal.damaged, [], `${how}: the journal reads whole`);
  assert.deepEqual(journal.records.map((r) => r.id), ["1", "2", "3", "4"].map((n) => `d-${n.padStart(8, "0")}`), `${how}: every decision of both branches loads, in time order`);
  const work = loadWork(root);
  assert.deepEqual(work.damaged, [], `${how}: the work orders read whole`);
  assert.deepEqual(work.records.map((r) => r.id), ["1", "2", "3", "4"].map((n) => `wo-${n.padStart(8, "0")}`), `${how}: every work order of both branches loads`);
  const runs = loadRuns(root);
  assert.deepEqual(runs.damaged, [], `${how}: the runs read whole`);
  assert.deepEqual(runs.records.map((r) => r.invariants[0]!.name), ["1", "2", "3", "4"].map((n) => `invariant ${n}`), `${how}: every run of both branches loads`);
}

test("two branches that append different records to one session's file in every record store merge and rebase with no conflict, and every record of both loads", () => {
  // Every store the attributes name is one the stack writes, and every store it writes is named.
  assert.deepEqual([...RECORD_STORES].sort(), ["journal", "runs", "work"]);
  const merged = stack(true);
  const merge = git(merged, "merge", "-q", "--no-edit", "lower");
  assert.equal(merge.status, 0, `the merge conflicts: ${merge.out}`);
  assertAllLoad(merged, "merged");

  const rebased = stack(true);
  const rebase = git(rebased, "rebase", "-q", "lower");
  assert.equal(rebase.status, 0, `the rebase conflicts: ${rebase.out}`);
  assertAllLoad(rebased, "rebased");

  // The control: without the attributes the same stack conflicts, so the merge above is the attributes' doing.
  const bare = stack(false);
  const conflicted = git(bare, "merge", "-q", "--no-edit", "lower");
  assert.notEqual(conflicted.status, 0, "without .coherence/.gitattributes the stack conflicts");
  for (const store of RECORD_STORES) assert.match(git(bare, "diff", "--name-only", "--diff-filter=U").out, new RegExp(`\\.coherence/${store}/${SESSION}\\.jsonl`), `${store} conflicts without the attributes`);
});

test("a torn last line a union merge keeps stays one damaged line, the record appended after it reads whole, and a line kept twice is read once", () => {
  const root = fixture("torn");
  appendAll(root, "1", "2026-10-01T10:00:00.000Z");
  const files = { journal: join(root, ".coherence", "journal", `${SESSION}.jsonl`), work: join(root, ".coherence", "work", `${SESSION}.jsonl`), runs: join(root, ".coherence", "runs", `${SESSION}.jsonl`) };
  // What a union merge can leave: one side's line twice, and a write that crashed partway with no newline after it.
  for (const file of Object.values(files)) {
    const first = readFileSync(file, "utf8");
    appendFileSync(file, `${first}{"id":"torn`);
  }
  appendAll(root, "2", "2026-10-01T11:00:00.000Z");

  const journal = loadJournal(root);
  assert.deepEqual(journal.records.map((r) => r.id), ["d-00000001", "d-00000002"], "the duplicate is read once and the record after the torn line reads whole");
  assert.deepEqual(journal.damaged.map((d) => d.line), [3], "the torn line is one damaged line, at its own place");
  const work = loadWork(root);
  assert.deepEqual(work.records.map((r) => r.id), ["wo-00000001", "wo-00000002"]);
  assert.deepEqual(work.damaged.map((d) => d.line), [3]);
  const runs = loadRuns(root);
  assert.deepEqual(runs.records.map((r) => r.invariants[0]!.name), ["invariant 1", "invariant 2"]);
  assert.deepEqual(runs.damaged.map((d) => d.line), [3]);
  for (const file of Object.values(files)) assert.ok(readFileSync(file, "utf8").endsWith("\n"), `${file} ends whole`);
});

test("install and every session start keep .coherence/.gitattributes: written where absent, an adopter's lines kept with only missing attributes added, and an earlier release's ignore file brought up so git commits it", () => {
  // Absent: written whole, and git applies it to every store's session files.
  const fresh = fixture("attributes");
  ok(fresh, "init", "-q");
  assert.equal(keepIgnore(fresh, true), "wrote");
  assert.equal(keepAttributes(fresh), "wrote");
  assert.equal(readFileSync(join(fresh, ATTRIBUTES_FILE), "utf8"), ATTRIBUTES_TEXT);
  assert.equal(keepAttributes(fresh), "unchanged", "a second keep writes nothing");
  for (const store of RECORD_STORES) {
    const attrs = git(fresh, "check-attr", "merge", "linguist-generated", "--", `.coherence/${store}/s.jsonl`).out;
    assert.match(attrs, /merge: union/, `${store} merges by union`);
    assert.match(attrs, /linguist-generated: true/, `${store} reads as generated`);
  }
  mkdirSync(join(fresh, ".coherence", "feed"), { recursive: true });
  writeFileSync(join(fresh, ".coherence", "feed", "cursor"), "x");
  assert.deepEqual(git(fresh, "status", "--porcelain", "--untracked-files=all").out.split("\n").filter(Boolean).map((l) => l.slice(3)).sort(), [".coherence/.gitattributes", ".coherence/.gitignore"], "git commits both files and still ignores regenerated state");

  // The adopter's own file: every line kept, and only an attribute it does not set for that pattern added.
  const theirs = fixture("their-attributes");
  const own = "# ours\n*.png binary\njournal/*.jsonl merge=binary\nruns/** -linguist-generated";
  mkdirSync(join(theirs, ".coherence"), { recursive: true });
  writeFileSync(join(theirs, ATTRIBUTES_FILE), own);
  assert.equal(keepAttributes(theirs), "added");
  const kept = readFileSync(join(theirs, ATTRIBUTES_FILE), "utf8");
  assert.ok(kept.startsWith(`${own}\n`), "every line the adopter wrote stays, in place");
  const added = kept.slice(own.length + 1).split("\n").filter((l) => l !== "" && !l.startsWith("#"));
  assert.deepEqual(added, ATTRIBUTE_LINES.filter((l) => l !== "journal/*.jsonl merge=union" && l !== "runs/** linguist-generated=true"), "only what the adopter does not set is added");
  assert.equal(keepAttributes(theirs), "kept", "a second keep adds nothing");

  // An adopter of an earlier release: its ignore file, which ignored the attributes file, is brought up at the session start.
  const earlier = fixture("earlier");
  ok(earlier, "init", "-q");
  mkdirSync(join(earlier, ".coherence"), { recursive: true });
  writeFileSync(join(earlier, IGNORE_FILE), EARLIER_IGNORE_TEXTS[0]!);
  keepStateFiles(earlier);
  assert.equal(readFileSync(join(earlier, IGNORE_FILE), "utf8"), IGNORE_TEXT);
  assert.equal(readFileSync(join(earlier, ATTRIBUTES_FILE), "utf8"), ATTRIBUTES_TEXT);
  assert.equal(git(earlier, "check-ignore", "-q", ATTRIBUTES_FILE).status, 1, "git no longer ignores the attributes file");

  // A session start never creates an ignore file install did not write, and never rewrites the adopter's.
  const none = fixture("no-ignore");
  keepStateFiles(none);
  assert.equal(existsSync(join(none, IGNORE_FILE)), false);
  assert.equal(readFileSync(join(none, ATTRIBUTES_FILE), "utf8"), ATTRIBUTES_TEXT);
  writeFileSync(join(none, IGNORE_FILE), "*.log\n");
  assert.equal(keepIgnore(none, true), "kept");
  assert.equal(readFileSync(join(none, IGNORE_FILE), "utf8"), "*.log\n");
});

test("a command that makes .coherence writes its git files with it, so a project without hooks commits only its records; one already there keeps what its adopter left", async () => {
  const { cli } = await import("./cli-fixture.ts");
  const root = fixture("first-command");
  ok(root, "init", "-q");
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ language: "typescript" }));
  const decide = (n: string) => cli(["decide", `chose ${n}`, "--over", "the other", "--because", "a test", "--session", SESSION, "--agent", "test"], { cwd: root });
  const first = await decide("one");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(join(root, IGNORE_FILE), "utf8"), IGNORE_TEXT, "the first record wrote the ignore file beside it");
  assert.equal(readFileSync(join(root, ATTRIBUTES_FILE), "utf8"), ATTRIBUTES_TEXT);
  rmSync(join(root, IGNORE_FILE));
  assert.equal((await decide("two")).status, 0);
  assert.ok(!existsSync(join(root, IGNORE_FILE)), "a folder that was already there is its adopter's: a removed ignore file stays removed");
});

/** The files under .coherence git would commit now. */
function committable(root: string): string[] {
  return git(root, "status", "--porcelain", "--untracked-files=all").out.split("\n").filter(Boolean).map((l) => l.slice(3)).filter((p) => p.startsWith(".coherence/")).sort();
}

const config = (root: string, value: Record<string, unknown>): void => writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "p", ...value }));

test("the replay record is committed only when the config says so: Coherence's ignore file keeps it out by default, keeps it in with commitReplay, and follows the key at every session start, while an adopter's file is never rewritten", () => {
  const root = fixture("replay-commit");
  ok(root, "init", "-q");
  config(root, {});
  assert.equal(keepIgnore(root, true), "wrote");
  assert.equal(readFileSync(join(root, IGNORE_FILE), "utf8"), IGNORE_TEXT, "the default text is the one earlier releases' upgrades reach");
  keepAttributes(root);
  mkdirSync(join(root, ".coherence", "replay"), { recursive: true });
  writeFileSync(join(root, ".coherence", "replay", "s.jsonl"), "{}\n");
  mkdirSync(join(root, ".coherence", "traces"), { recursive: true });
  writeFileSync(join(root, ".coherence", "traces", "s.jsonl"), "{}\n");
  assert.deepEqual(committable(root), [".coherence/.gitattributes", ".coherence/.gitignore"], "by default the replay record stays on the machine");

  config(root, { commitReplay: true });
  keepStateFiles(root);
  assert.equal(readFileSync(join(root, IGNORE_FILE), "utf8"), REPLAY_IGNORE_TEXT, "a session start switches Coherence's file to the key");
  assert.deepEqual(committable(root), [".coherence/.gitattributes", ".coherence/.gitignore", ".coherence/replay/s.jsonl"], "the replay record is committed, and the trace with its snapshots never");
  const attrs = git(root, "check-attr", "merge", "linguist-generated", "--", ".coherence/replay/s.jsonl").out;
  assert.match(attrs, /merge: union/, "a session's record merges by union, as the stores do");
  assert.match(attrs, /linguist-generated: true/);
  assert.equal(replayIgnoreDisagreement(root), undefined, "Coherence's own file agrees with the key");

  config(root, { commitReplay: "yes" });
  assert.equal(keepIgnore(root, false), "upgraded", "only a literal true commits; the file goes back");
  assert.equal(readFileSync(join(root, IGNORE_FILE), "utf8"), IGNORE_TEXT);
  assert.equal(removeStateFiles(root), true, "either text is Coherence's to remove");

  // An earlier release's attributes, exactly as written, are brought up to this one's; the adopter's own ignore file is left byte for byte.
  writeFileSync(join(root, ATTRIBUTES_FILE), EARLIER_ATTRIBUTES_TEXTS[0]!);
  assert.equal(keepAttributes(root), "added");
  assert.equal(readFileSync(join(root, ATTRIBUTES_FILE), "utf8"), ATTRIBUTES_TEXT);
  const theirs = "/*\n!/journal/\n";
  writeFileSync(join(root, IGNORE_FILE), theirs);
  config(root, { commitReplay: true });
  assert.equal(keepIgnore(root, true), "kept");
  keepStateFiles(root);
  assert.equal(readFileSync(join(root, IGNORE_FILE), "utf8"), theirs);
});

test("where the adopter's ignore files and the config disagree on the replay record, the session start and the hook check say which rule decides and what to change, and edit nothing", async () => {
  const { cli } = await import("./cli-fixture.ts");
  const root = fixture("replay-disagree");
  ok(root, "init", "-q");
  // This repository's own way: a root .gitignore that keeps .coherence out but for its record folders, and no .coherence/.gitignore.
  const rootIgnore = ".coherence/*\n!.coherence/journal/\n";
  writeFileSync(join(root, ".gitignore"), rootIgnore);
  config(root, {});
  assert.equal(replayIgnoreDisagreement(root), undefined, "kept on the machine, and git ignores it: they agree");
  assert.equal(replayBlock(root), "");

  config(root, { commitReplay: true });
  const said = replayIgnoreDisagreement(root)!;
  assert.match(said, /sets commitReplay, but git ignores \.coherence\/replay\/ \(\.gitignore:1:\.coherence\/\*\)/, "the rule that decides is named");
  assert.match(said, /add !\.coherence\/replay\//);
  assert.equal(replayBlock(root), `${said}\n\n`, "the session start says it");
  const checked = await cli(["hooks", "--check", "--host", "codex", "--command", "npx coherence"], { cwd: root });
  assert.ok(checked.stdout.includes(said), `the hook check says it: ${checked.stdout}`);
  assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), rootIgnore, "and nothing of the adopter's is edited");
  assert.equal(existsSync(join(root, IGNORE_FILE)), false);

  writeFileSync(join(root, ".gitignore"), `${rootIgnore}!.coherence/replay/\n`);
  assert.equal(replayIgnoreDisagreement(root), undefined, "once the adopter keeps it, they agree");
  config(root, {});
  assert.match(replayIgnoreDisagreement(root)!, /does not set commitReplay, so the replay record is meant to stay on this machine, but git does not ignore \.coherence\/replay\//);

  const outside = fixture("replay-no-git");
  config(outside, { commitReplay: true });
  assert.equal(replayIgnoreDisagreement(outside), undefined, "outside git there is nothing to commit and nothing to say");
});
