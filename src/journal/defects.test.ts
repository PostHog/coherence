/**
 * Defects that repay: the class, origin and catch a defect carries, the
 * classification that folds into it later, the close that names a guard or a
 * decision, the floor spec --check reads from them, and the convergence
 * reading. Every test runs in its own temporary project.
 */

import assert from "node:assert/strict";
import { sessionText } from "./shard-fixture.ts";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { journalVerbs, type Io } from "./cli.ts";
import { defectStates } from "./defects.ts";
import { convergence, convergenceText } from "./convergence.ts";
import type { Decision, Defect, Resolution } from "./record.ts";
import { loadJournal, loadJournalAcrossWorktrees } from "./store.ts";
import { loadSpecModel } from "../spec/model.ts";
import { specCommand } from "../spec/cli.ts";
import { firedBy, parsePractices } from "../spec/practice.ts";
import { toolUseOf } from "../lifecycle/practice-delivery.ts";
import { escalationBlock, specBlock } from "../lifecycle/hook.ts";
import { deadEndLine, deadEnds, readDeadEnds } from "./dead-ends.ts";

// Every fixture folder this file makes is removed when the file is done; the leak guard fails a file that leaves one.
const madeFolders: string[] = [];
const made = (folder: string): string => (madeFolders.push(folder), folder);
after(() => {
  for (const folder of madeFolders) rmSync(folder, { recursive: true, force: true });
});

const SPEC = [
  "# Widget",
  "",
  "Widgets turn.",
  "",
  "## invariants",
  "- knob turns: The knob turns.",
  "  over: every knob",
  "  via: the knob turns",
  "  because: a stuck knob is a broken widget",
  "  kinds: none",
  "- dial clicks: The dial clicks.",
  "  over: every dial",
  "  via: the dial clicks",
  "  because: a silent dial is a broken widget",
  "  kinds: none",
  "",
].join("\n");

const WHO = ["--session", "s1", "--agent", "alpha"];

function project(files: Record<string, string> = {}): string {
  const root = made(mkdtempSync(join(tmpdir(), "coherence-defects-")));
  for (const [path, text] of Object.entries({ "widget/Widget.spec.md": SPEC, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function clock(start: string): () => Date {
  let tick = Date.parse(start);
  return () => new Date((tick += 1000));
}

function journal(root: string, now: () => Date): (...argv: string[]) => { code: number; out: string[]; err: string[] } {
  return (...argv) => {
    const [verb, ...rest] = argv;
    const run = { code: 0, out: [] as string[], err: [] as string[] };
    const io: Io = { cwd: root, now, out: (l) => run.out.push(l), err: (l) => run.err.push(l) };
    run.code = journalVerbs[verb!]!(rest, io);
    return run;
  };
}

function idOf(run: { code: number; out: string[]; err: string[] }): string {
  assert.equal(run.code, 0, run.err.join("\n"));
  return run.out[0]!.split(/\s+/)[0]!;
}

/** A refutation of the bullet and a later passing run: the run store's witness. */
function witness(root: string, component: string, name: string, at: string): void {
  mkdirSync(join(root, ".coherence", "runs"), { recursive: true });
  const file = join(root, ".coherence", "runs", "w.jsonl");
  const later = new Date(Date.parse(at) + 1000).toISOString();
  appendFileSync(file, JSON.stringify({ kind: "refutation", at, session: "w", agent: "w", component, name, form: "totality oracle", broke: "a break", verdict: "fail", reason: "red", commit: null, dirty: false }) + "\n");
  appendFileSync(file, JSON.stringify({ at: later, session: "w", agent: "w", commit: null, dirty: false, invariants: [{ component, name, form: "totality oracle", verdict: "pass", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], reason: "green" }] }) + "\n");
}

function commitAll(root: string, message: string, date: string): string {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["add", "-A", "--", ".", ":!.coherence"], { cwd: root, env });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", message], { cwd: root, env });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

test("a defect carries a declared class, where it came in and what caught it, and a value outside each vocabulary is refused before anything is written", () => {
  const root = project({ "lexicon.json": JSON.stringify({ concepts: [{ name: "defect", definition: "d", properties: { "class widget-spin": "a widget spins forever" } }] }) });
  const sha = commitAll(root, "first", "2026-10-01T10:00:00Z");
  const j = journal(root, clock("2026-10-03T00:00:00Z"));
  const full = idOf(j("defect", "the knob stuck", "--evidence", "turned it", "--class", "path-identity", "--introduced", sha.slice(0, 7), "--caught", "review", ...WHO));
  const own = idOf(j("defect", "the widget spun", "--evidence", "watched it", "--class", "widget-spin", "--introduced", "PR #12", "--caught", "adopter", ...WHO));
  const bare = idOf(j("defect", "the dial was silent", "--evidence", "listened", ...WHO));
  const records = loadJournal(root).records;
  const read = (id: string): Defect => records.find((r) => r.id === id) as Defect;
  assert.deepEqual([read(full).class, read(full).introduced, read(full).caught], ["path-identity", sha.slice(0, 7), "review"]);
  assert.deepEqual([read(own).class, read(own).introduced, read(own).caught], ["widget-spin", "PR #12", "adopter"], "a class the project's own lexicon declares");
  assert.ok(!("class" in read(bare)) && !("introduced" in read(bare)) && !("caught" in read(bare)), "a defect without them is written as before");
  const before = loadJournal(root).records.length;
  const refused = [
    j("defect", "x", "--evidence", "y", "--class", "made-up-class", ...WHO),
    j("defect", "x", "--evidence", "y", "--class", "Not Kebab", ...WHO),
    j("defect", "x", "--evidence", "y", "--introduced", "yesterday", ...WHO),
    j("defect", "x", "--evidence", "y", "--introduced", "abcdef1234", ...WHO),
    j("defect", "x", "--evidence", "y", "--caught", "luck", ...WHO),
  ];
  for (const run of refused) assert.equal(run.code, 1, run.out.join("\n"));
  assert.match(refused[0]!.err.join("\n"), /declared nowhere; declare it once as the property "class made-up-class" of defect/);
  assert.match(refused[3]!.err.join("\n"), /no commit by that name/);
  assert.match(refused[4]!.err.join("\n"), /review, ci, probe, adopter, self, test/);
  assert.equal(loadJournal(root).records.length, before, "nothing was written");
  assert.match(j("journal", bare).out.join("\n"), /the dial was silent/);
  assert.match(j("journal", full).out.join("\n"), /class path-identity, introduced [0-9a-f]{7}, caught review/);
});

describe("a shallow clone refuses only an --introduced git can tell is no commit", () => {
  for (const { introduced, refused } of [
    { introduced: "an older commit its depth cut off", refused: false },
    { introduced: "a file it holds", refused: true },
  ] as const) {
    test(`${introduced} is ${refused ? "refused" : "written"}`, () => {
      const origin = project({ "knob.ts": "export const knob = 1;\n" });
      const older = commitAll(origin, "first", "2026-10-01T10:00:00Z");
      commitAll(origin, "second", "2026-10-02T10:00:00Z");
      const blob = execFileSync("git", ["rev-parse", "HEAD:knob.ts"], { cwd: origin, encoding: "utf8" }).trim();
      const root = made(mkdtempSync(join(tmpdir(), "coherence-defects-shallow-")));
      execFileSync("git", ["clone", "-q", "--depth", "1", `file://${origin}`, root]);
      const run = journal(root, clock("2026-10-03T00:00:00Z"))("defect", "the knob stuck", "--evidence", "turned it", "--introduced", refused ? blob : older, ...WHO);
      assert.equal(run.code, refused ? 1 : 0, run.err.join("\n"));
    });
  }
});

test("classify folds into the defect without editing it: a later classification overrides, a retracted one gives nothing, and a field nobody gave stays unknown", () => {
  const root = project();
  const j = journal(root, clock("2026-10-03T00:00:00Z"));
  const d = idOf(j("defect", "the knob stuck", "--evidence", "turned it", "--caught", "self", ...WHO));
  const line = sessionText(join(root, ".coherence", "journal"), "s1");
  const first = idOf(j("classify", d, "--class", "cost", "--introduced", "pre-existing", "--because", "the first reading", ...WHO));
  const second = idOf(j("classify", d, "--class", "silent-skip", "--because", "a closer reading", ...WHO));
  const wrong = idOf(j("classify", d, "--caught", "probe", "--because", "misread", ...WHO));
  idOf(j("retract", wrong, "--because", "the session that made it caught it", ...WHO));
  assert.ok(sessionText(join(root, ".coherence", "journal"), "s1").startsWith(line), "the defect's line is untouched");
  const records = loadJournal(root).records;
  const decision = records.find((r) => r.id === first) as Decision;
  assert.equal(decision.kind, "decision");
  assert.deepEqual(decision.cites, [d]);
  assert.deepEqual(decision.classifies, { of: d, class: "cost", introduced: "pre-existing" });
  assert.ok(second !== first);
  const state = defectStates(records).find((s) => s.id === d)!;
  assert.deepEqual([state.class, state.introduced, state.caught], ["silent-skip", "pre-existing", "self"], "the later class wins, the retracted catch gives nothing, the defect's own catch stands");
  const other = idOf(j("defect", "the dial was silent", "--evidence", "listened", ...WHO));
  const blank = defectStates(loadJournal(root).records).find((s) => s.id === other)!;
  assert.deepEqual([blank.class, blank.introduced, blank.caught], [undefined, undefined, undefined], "nothing is inferred");
  assert.equal(j("classify", d, "--because", "nothing given", ...WHO).code, 1, "a classification gives at least one field");
  assert.equal(j("classify", first, "--class", "cost", "--because", "not a defect", ...WHO).code, 1, "only a defect is classified");
});

test("resolved closes a defect with a guard a spec declares or a decision, refuses a guard or decision that names nothing, and a retracted close can be closed again", () => {
  const root = project();
  const j = journal(root, clock("2026-10-03T00:00:00Z"));
  const d = idOf(j("defect", "the knob stuck", "--evidence", "turned it", ...WHO));
  const c = idOf(j("conjecture", "the knob is cold", "--discriminated-by", "warm it", ...WHO));
  const why = idOf(j("decide", "fix the one knob", "--over", "none", "--because", "no other knob has the shape", ...WHO));
  assert.match(j("resolved", d, "--because", "oiled", "--guard", "widget/no such bullet", ...WHO).err.join("\n"), /declares no invariant named "no such bullet"/);
  assert.match(j("resolved", d, "--because", "oiled", "--guard", "nowhere/knob turns", ...WHO).err.join("\n"), /reads <component folder>\/<invariant name>/);
  assert.match(j("resolved", d, "--because", "oiled", "--decision", c, ...WHO).err.join("\n"), /is a conjecture, not a decision/);
  assert.match(j("resolved", d, "--because", "oiled", "--as", "cold", ...WHO).err.join("\n"), /--as names a conjecture's winning candidate/);
  assert.match(j("resolved", c, "--because", "warmed", "--guard", "widget/knob turns", ...WHO).err.join("\n"), /close a defect; .* is a conjecture/);
  const bare = j("resolved", d, "--because", "oiled", ...WHO);
  const closeId = idOf(bare);
  assert.match(bare.out.join("\n"), /closed with neither a guard nor a decision: spec --check names it/);
  assert.equal(j("resolved", d, "--because", "again", "--decision", why, ...WHO).code, 1, "a defect closes once");
  idOf(j("retract", closeId, "--because", "closed without a guard", ...WHO));
  const guarded = idOf(j("resolved", d, "--because", "oiled, and every knob is checked", "--guard", "widget/knob turns", "--decision", why, "--class", "cost", ...WHO));
  const record = loadJournal(root).records.find((r) => r.id === guarded) as Resolution;
  assert.deepEqual([record.of, record.guard, record.decision, record.class], [d, "widget/knob turns", why, "cost"]);
  assert.equal(defectStates(loadJournal(root).records).find((s) => s.id === d)!.resolution!.id, guarded, "the retracted close no longer closes it");
  assert.equal(idOf(j("resolved", c, "--because", "warmed", "--as", "cold", ...WHO)).startsWith("rs-"), true, "a conjecture resolves as before");
});

test("spec --check names a defect closed with neither a guard nor a decision and a defect in an already guarded class as a guard failure, without counting either as a problem", () => {
  const root = project();
  const j = journal(root, clock("2026-10-03T00:00:00Z"));
  witness(root, "widget", "knob turns", "2026-10-02T00:00:00.000Z");
  const why = idOf(j("decide", "fix the one dial", "--over", "none", "--because", "no sibling has the shape", ...WHO));
  const first = idOf(j("defect", "the knob stuck", "--evidence", "turned it", "--class", "path-identity", ...WHO));
  const guard = idOf(j("resolved", first, "--because", "oiled", "--guard", "widget/knob turns", ...WHO));
  const repeat = idOf(j("defect", "another knob stuck", "--evidence", "turned it", ...WHO));
  idOf(j("classify", repeat, "--class", "path-identity", "--because", "the same shape", ...WHO));
  const neither = idOf(j("defect", "a lever stuck", "--evidence", "pulled it", ...WHO));
  const neitherClose = idOf(j("resolved", neither, "--because", "greased", ...WHO));
  const unwitnessed = idOf(j("defect", "the dial was silent", "--evidence", "listened", ...WHO));
  idOf(j("resolved", unwitnessed, "--because", "tightened", "--guard", "widget/dial clicks", ...WHO));
  const decided = idOf(j("defect", "a dial rattled", "--evidence", "shook it", ...WHO));
  idOf(j("resolved", decided, "--because", "tightened", "--decision", why, ...WHO));
  const out: string[] = [];
  const code = specCommand([root], { cwd: root, out: (l) => out.push(l), err: (l) => out.push(l) });
  const text = out.join("\n");
  assert.match(text, new RegExp(`GUARD FAILURE  ${repeat} in class path-identity, which widget/knob turns has guarded since ${guard} closed ${first}`));
  assert.match(text, new RegExp(`ADVISORY  ${neither} closed by ${neitherClose} names neither a guard nor a decision`));
  assert.match(text, new RegExp(`ADVISORY  ${unwitnessed} closed by rs-[0-9a-f]{8} names guard widget/dial clicks, whose refutation is not witnessed, and no decision`));
  assert.match(text, /defects: 5 recorded, 4 closed \(1 guarded, 1 decided, 2 with neither\); 1 guard failure/);
  assert.doesNotMatch(text, new RegExp(`ADVISORY  ${decided}|ADVISORY  ${first}`));
  const model = loadSpecModel(root);
  assert.equal(model.problems.length, 0, "advisory, never a problem");
  assert.equal(code, 0);
  assert.deepEqual(model.defects!.guardFailures.map((g) => g.id), [repeat], "the guarded defect itself is no repeat");
});

test("query convergence counts arrivals by origin and catch, escapes per release, closes and repeats, bullets at each tag and hook latency per version, and says unknown wherever a record does not say", () => {
  const root = project({ "widget/Widget.spec.md": SPEC.split("- dial clicks")[0]! });
  commitAll(root, "first", "2026-10-01T10:00:00Z");
  execFileSync("git", ["tag", "v0.1.0"], { cwd: root });
  writeFileSync(join(root, "widget/Widget.spec.md"), SPEC);
  const feature = commitAll(root, "Merge pull request #7 from team/dial", "2026-10-02T10:00:00Z");
  execFileSync("git", ["tag", "v0.2.0"], { cwd: root });
  witness(root, "widget", "knob turns", "2026-10-02T12:00:00.000Z");
  const j = journal(root, clock("2026-10-03T00:00:00Z"));
  const byCommit = idOf(j("defect", "the dial skipped", "--evidence", "e", "--class", "overmatch", "--introduced", feature.slice(0, 9), "--caught", "review", ...WHO));
  const byPull = idOf(j("defect", "the dial stuck", "--evidence", "e", "--introduced", "PR #7", "--caught", "test", ...WHO));
  idOf(j("defect", "the knob was always loose", "--evidence", "e", "--introduced", "pre-existing", "--caught", "adopter", ...WHO));
  const bare = idOf(j("defect", "something rattled", "--evidence", "e", ...WHO));
  idOf(j("resolved", byCommit, "--because", "fixed, every dial checked", "--guard", "widget/knob turns", ...WHO));
  idOf(j("resolved", bare, "--because", "tightened", ...WHO));
  const repeat = idOf(j("defect", "another dial skipped", "--evidence", "e", "--class", "overmatch", ...WHO));
  mkdirSync(join(root, ".coherence", "hook-times"), { recursive: true });
  writeFileSync(
    join(root, ".coherence", "hook-times", "s.jsonl"),
    [
      { at: "2026-10-03T01:00:00.000Z", event: "PreToolUse", ms: 100 },
      { at: "2026-10-03T01:00:01.000Z", event: "PreToolUse", ms: 300 },
      { at: "2026-10-03T01:00:02.000Z", event: "PreToolUse", ms: 200, version: "1.6.0" },
      { at: "2026-09-01T01:00:00.000Z", event: "PreToolUse", ms: 9000, version: "1.6.0" },
    ].map((t) => JSON.stringify(t)).join("\n") + "\n",
  );
  const c = convergence(root, { now: () => new Date("2026-10-04T12:00:00Z") });
  assert.equal(c.window.days, 14);
  assert.equal(c.arrivals.total, 5);
  assert.deepEqual(c.arrivals.byOrigin, { "fix-induced": 2, "pre-existing": 1, unknown: 2 });
  assert.deepEqual(c.arrivals.byCaught, { review: 1, test: 1, adopter: 1, unknown: 2 });
  assert.equal(c.arrivals.byClass["unknown"], 3);
  const release = c.releases.find((r) => r.tag === "v0.2.0")!;
  assert.equal(release.since, "v0.1.0");
  assert.deepEqual([...release.escapes].sort(), [byCommit, byPull].sort(), "a commit and a pull request, each placed in the range by git");
  assert.deepEqual(release.bullets && [release.bullets.bullets, release.bullets.enforced], [2, 2]);
  assert.deepEqual(c.releases.find((r) => r.tag === "v0.1.0")!.bullets!.bullets, 1);
  assert.deepEqual([c.closing.closed, c.closing.guarded, c.closing.neither], [2, 1, 1]);
  assert.deepEqual(c.repeats, [{ class: "overmatch", allTime: 1, inWindow: 1 }]);
  assert.ok(c.repeats.length === 1 && repeat.startsWith("df-"));
  assert.deepEqual(
    c.hookLatency.map((h) => [h.event, h.version, h.count, h.p50, h.p95]),
    [
      ["PreToolUse", "1.6.0", 1, 200, 200],
      ["PreToolUse", "unknown", 2, 100, 300],
    ],
  );
  assert.ok(c.churn.some((f) => f.file === "widget/Widget.spec.md" && f.commits === 2));
  const text = convergenceText(c);
  assert.match(text, /defects arriving: 5; fix-induced 2, pre-existing 1, unknown 2/);
  assert.match(text, /release v0\.2\.0 .*2 escaped/);
  assert.match(text, /hook latency PreToolUse unknown: p50 0\.10 s, p95 0\.30 s over 2 calls/);
});

test("close a defect fires on resolving a defect and never a conjecture, nor on a quoted argument or a heredoc's body", () => {
  const text = readFileSync(join(import.meta.dirname, "Journal.practice.md"), "utf8");
  const practice = parsePractices(text, "src/journal/Journal.practice.md").practices.find((p) => p.name === "close a defect")!;
  const fires = (command: string) => firedBy(practice, toolUseOf({ tool_input: { command } }, []));
  assert.equal(fires(`node src/cli.ts resolved df-1a2b3c4d --because "x" --guard src/journal/a`), "command resolved df-*", "resolving a defect fires it");
  assert.equal(fires(`node src/cli.ts resolved c-ad47425a --because "the test showed it"`), undefined, "resolving a conjecture is no defect's close");
  assert.equal(fires(`node src/cli.ts decide "y" --because "resolved df-1"`), undefined, "a quoted argument is no command");
  assert.equal(fires(`node src/cli.ts resolved c-1 --because "resolved df-1"`), undefined, "a quoted because naming a defect does not make a conjecture's close one");
  assert.equal(fires("cat > notes.md <<'EOF'\nnode src/cli.ts resolved df-1\nEOF"), undefined, "a heredoc's body is text");
  assert.equal(fires(`node src/cli.ts defect "x" --evidence "y" --class overmatch`), "command cli.* defect", "recording a defect fires it: classifying is its first step");
  assert.equal(fires(`npx coherence defect "x" --evidence "y"`), "command coherence defect", "the installed CLI records one too");
  assert.equal(fires(`node node_modules/@posthog/coherence/dist/cli.js defect "x" --evidence "y"`), "command cli.* defect", "and the built one by its path");
  for (const read of ["node src/cli.ts journal --kind defect", "coherence query defect", "coherence lexicon review defect"]) assert.equal(fires(read), undefined, `${read} reads defects and closes none`);
  assert.equal(fires(`node src/cli.ts classify df-1a2b3c4d --class overmatch --because "z"`), "command classify", "classifying one fires it");
});

test("a family's guard answers only for its own defect, so a later defect in the family is no guard failure, while a class keeps the rule", () => {
  const root = project();
  const j = journal(root, clock("2026-10-03T00:00:00Z"));
  witness(root, "widget", "knob turns", "2026-10-02T00:00:00.000Z");
  // audience is a family in Coherence's lexicon: too broad for one guard.
  const first = idOf(j("defect", "the label named the wrong knob", "--evidence", "read it", "--class", "audience", ...WHO));
  idOf(j("resolved", first, "--because", "renamed", "--guard", "widget/knob turns", ...WHO));
  const later = idOf(j("defect", "the manual omits the dial", "--evidence", "read it", "--class", "audience", ...WHO));
  // The same sequence in a class is still a guard failure.
  const classFirst = idOf(j("defect", "the knob stuck", "--evidence", "turned it", "--class", "path-identity", ...WHO));
  idOf(j("resolved", classFirst, "--because", "oiled", "--guard", "widget/knob turns", ...WHO));
  const classRepeat = idOf(j("defect", "another knob stuck", "--evidence", "turned it", "--class", "path-identity", ...WHO));
  const model = loadSpecModel(root);
  assert.deepEqual(model.defects!.guardFailures.map((g) => g.id), [classRepeat], `a later audience defect (${later}) is no guard failure; a later path-identity one is`);
});

/** A clock two days back from the real now, so the dead-end window, which the model reads from the wall clock, holds the fixture. */
const RECENT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

test("spec --check and orient name a subsystem whose defects keep arriving after its first guard across classes, families and rounds, however they closed, and only a human's acknowledgement answers it", () => {
  const root = project({ "gadget/Gadget.spec.md": SPEC.replace("# Widget", "# Gadget").replace("Widgets turn.", "Gadgets hum.") });
  commitAll(root, "first", RECENT);
  witness(root, "widget", "knob turns", "2026-10-01T00:00:00.000Z");
  witness(root, "widget", "dial clicks", "2026-10-01T00:00:00.000Z");
  witness(root, "gadget", "knob turns", "2026-10-01T00:00:00.000Z");
  const j = journal(root, clock(RECENT));
  const defect = (what: string, cls: string | undefined, ...more: string[]) => idOf(j("defect", what, "--evidence", "seen", ...(cls === undefined ? [] : ["--class", cls]), ...more, ...WHO));
  const close = (id: string, guard: string) => idOf(j("resolved", id, "--because", "a check at the site", "--guard", guard, ...WHO));
  const FILE = ["--file", "widget/knob.ts"];
  // Another component guarded first: its guard and its defect are no part of widget's count.
  const elsewhere = defect("the gadget hummed off key", "cost", "--file", "gadget/hum.ts");
  close(elsewhere, "gadget/knob turns");
  // Round 0: the first guard. Nothing before it counts.
  const first = defect("the knob slipped", "path-identity", ...FILE);
  const firstClose = close(first, "widget/knob turns");
  commitAll(root, "round 1", RECENT);
  // Round 1: a class closed by the guard the knob already had, and a family left open.
  const r1 = [defect("the knob cost a second a turn", "cost"), defect("the knob's label named the dial", "audience", ...FILE)];
  close(r1[0]!, "widget/knob turns");
  commitAll(root, "round 2", RECENT);
  // Round 2: each closed under a guard the subsystem never named before, or left open: none of it comes back through an old guard.
  const r2 = [defect("the knob's check claimed every knob", "over-claim"), defect("the dial cost a second", "cost"), defect("a linked knob slipped", "path-identity", ...FILE)];
  close(r2[0]!, "widget/dial clicks");
  close(r2[1]!, "widget/dial clicks");
  commitAll(root, "round 3", RECENT);
  // Round 3: still more, one with no class at all and two left open.
  const r3 = [defect("the manual omits the knob", "audience"), defect("the dial's check claimed every dial", undefined, ...FILE), defect("the knob read a half turn", "parse-gap", ...FILE)];
  close(r3[0]!, "widget/dial clicks");
  const counted = [...r1, ...r2, ...r3];

  const out: string[] = [];
  const code = specCommand([root], { cwd: root, out: (l) => out.push(l), err: (l) => out.push(l) });
  const text = out.join("\n");
  const line = text.split("\n").find((l) => l.startsWith("DEAD END  widget:"));
  assert.ok(line !== undefined, text);
  assert.match(line, /widget: 8 defects across 6 classes \(audience 2, cost 2, over-claim 1, parse-gap 1, path-identity 1, 1 unclassified, each a class of its own\) over 3 rounds whose arrivals rise \(2, 3, 3 a round; 3 in the later half against 2 in the earlier\), open or closed alike/);
  assert.match(line, new RegExp(`since its first guard, "widget/knob turns" \\(${firstClose} closed ${first} on `));
  const window = readDeadEnds(root, loadSpecModel(root).components).window;
  assert.match(line, new RegExp(`in the 14 days from ${window.from} to ${window.to}: `));
  // Every counted defect by id, oldest first: the first guard's own defect starts the count and another component's is no part of it.
  assert.deepEqual(/ to \d{4}-\d{2}-\d{2}: ([^.]*)\. /.exec(line)![1]!.split(", "), counted);
  assert.ok(!line.includes(elsewhere));
  assert.match(line, /Stop adding guards to widget and review its representation/);
  assert.match(line, new RegExp(`escalate "widget is at a dead end: redesign it or keep guarding\\?" --because "<what its defects share>" --cite ${r3[2]}`));
  const model = loadSpecModel(root);
  assert.equal(model.problems.length, 0, "advisory, never a problem");
  assert.equal(code, 0);
  const reading = readDeadEnds(root, model.components);
  assert.deepEqual(reading.deadEnds.map((d) => d.subsystem), ["widget"], "gadget has one defect, closed by its first guard");
  assert.deepEqual(reading.deadEnds[0]!.trend, { earlier: 2, later: 3 });
  assert.deepEqual(reading.placement, { recorded: 6, files: 0, guard: 4, unplaced: 0 }, "a defect written with a file names its component; the closed rest are placed by their guard, and counted so");
  assert.deepEqual(reading.unclassified, [r3[1]], "the reading names the defect that carries no class");
  // The unclassified count as a class of their own: at a threshold of six classes it is the sixth.
  assert.deepEqual(readDeadEnds(root, model.components, new Date(), { classes: 6 }).deadEnds.map((d) => d.subsystem), ["widget"], "the unclassified defect is the sixth class");
  assert.deepEqual(readDeadEnds(root, model.components, new Date(), { classes: 7 }).deadEnds, []);
  // With every class taken away, each defect is a class of its own: leaving --class off never silences it.
  const unlabelled = loadJournal(root).records;
  const bare = defectStates(unlabelled).map(({ class: _class, ...rest }) => rest);
  const options = { folders: ["widget", "gadget"], holding: (f: string) => f.split("/")[0], root, standing: () => "witnessed" as const, now: new Date() };
  assert.deepEqual(deadEnds(unlabelled, bare, options).map((d) => [d.subsystem, d.classes.length, d.unclassified]), [["widget", 0, 8]]);
  assert.match(text, new RegExp(`^dead ends: 1; read the journals of 1 worktree; defects placed by the component their record names 6, derived from their files 0, from their guard 4, unplaced 0; unclassified in the 14 days from ${window.from} to ${window.to} 1 \\(${r3[1]}\\): each counts toward a dead end as a class of its own`, "m"));
  const orient = specBlock(root);
  assert.match(orient, /^Dead ends \(1\): /m);
  assert.match(orient, /^⚠ widget: 8 defects across 6 classes/m);
  assert.match(orient, new RegExp(`unclassified in the 14 days from ${window.from} to ${window.to} 1 \\(${r3[1]}\\)`));
  const reported = convergence(root, { now: () => new Date() });
  assert.deepEqual(reported.deadEnds.deadEnds.map((d) => d.subsystem), ["widget"], "the convergence reading reads the same one");
  assert.deepEqual([reported.deadEnds.window.from, reported.deadEnds.window.to], [reported.window.from, reported.window.to], "over the convergence reading's own window");
  assert.match(convergenceText(reported), /^dead ends .*: 1; read the journals of 1 worktree;/m);
  const short = convergence(root, { days: 1, now: () => new Date() });
  assert.deepEqual([short.deadEnds.window, short.deadEnds.deadEnds], [{ days: 1, from: short.window.from, to: short.window.to }, []], "--days narrows the dead ends' window too, and two days back lies outside one day");

  // A human's answer about another component restarts nothing here.
  const aside = idOf(j("escalate", "the gadget hums: retune it?", "--because", "one defect", "--cite", elsewhere, ...WHO));
  idOf(j("acknowledge", aside, "--human", "retune it", "--because", "the owner chose a retune", ...WHO));
  assert.deepEqual(readDeadEnds(root, model.components).deadEnds.map((d) => [d.subsystem, d.answered, d.escalation]), [["widget", undefined, undefined]]);
  // Asked of a human: an escalation citing one of its defects waits, named in the line and above every read.
  const asked = idOf(j("escalate", "widget is at a dead end: redesign it or keep guarding?", "--because", "its guards keep failing", "--cite", r3[2]!, ...WHO));
  const waiting = readDeadEnds(root, model.components).deadEnds[0]!;
  assert.equal(waiting.escalation, asked);
  assert.match(specBlock(root), new RegExp(`escalated as ${asked}, awaiting a human \\(acknowledge ${asked} --human`));
  assert.match(escalationBlock(root), new RegExp(`▲ ${asked}`));
  // An agent's acknowledgement carries no human's words: it restarts nothing, and the reading asks again.
  idOf(j("acknowledge", asked, "--because", "keep guarding", ...WHO));
  const still = readDeadEnds(root, model.components).deadEnds;
  assert.deepEqual(still.map((d) => [d.subsystem, d.escalation, d.answered]), [["widget", undefined, undefined]]);
  assert.match(deadEndLine(still[0]!), /ask a human whether to redesign it: escalate/);
  // A human's answer: the count starts again after it, so the dead end is gone until the subsystem fails again.
  const again = idOf(j("escalate", "widget is still at a dead end: redesign it?", "--because", "an agent answered the first", "--cite", r3[2]!, ...WHO));
  idOf(j("acknowledge", again, "--human", "redesign the knob", "--because", "the owner chose a redesign", ...WHO));
  assert.deepEqual(readDeadEnds(root, model.components).deadEnds, []);
  // Outside the window it is no dead end either: the pure reading, a month on.
  const records = loadJournal(root).records;
  const later = deadEnds(records, defectStates(records), { folders: ["widget", "gadget"], holding: (f) => f.split("/")[0], root, standing: () => "witnessed", now: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
  assert.deepEqual(later, []);
});

test("converging work is no dead end: defects across classes, families and rounds whose arrivals fall round over round are not named, however they closed", () => {
  const rules = Array.from({ length: 10 }, (_, i) => `rule ${i}`);
  const spec = ["# Gear", "", "Gears mesh.", "", "## invariants", ...rules.flatMap((r) => [`- ${r}: The gear keeps ${r}.`, "  over: every gear", `  via: the gear keeps ${r}`, "  because: a gear that slips breaks", "  kinds: none"]), ""].join("\n");
  const root = project({ "gear/Gear.spec.md": spec });
  commitAll(root, "first", RECENT);
  for (const r of rules) witness(root, "gear", r, "2026-10-01T00:00:00.000Z");
  const j = journal(root, clock(RECENT));
  let fresh = 1;
  const found = (what: string, cls: string | undefined, close: "old guard" | "new guard" | "open") => {
    const id = idOf(j("defect", what, "--evidence", "seen", ...(cls === undefined ? [] : ["--class", cls]), "--file", "gear/teeth.ts", ...WHO));
    if (close !== "open") idOf(j("resolved", id, "--because", "a door", "--guard", `gear/${close === "old guard" ? rules[0] : rules[fresh++]}`, ...WHO));
    return id;
  };
  found("a tooth slipped", "path-identity", "old guard");
  // Three rounds of three, three and two: the closes are every kind there is, and none of them decides it.
  for (const [round, batch] of [
    [1, [["a gear list was kept by hand", "hand-list", "old guard"], ["a second gear list", "hand-list", "open"], ["a slow mesh", "cost", "new guard"]]],
    [2, [["the manual named the wrong gear", "audience", "old guard"], ["the mesh claimed every tooth", "over-claim", "open"], ["a third gear list", undefined, "old guard"]]],
    [3, [["a tooth read as two", "parse-gap", "open"], ["the guide omits the ratio", "audience", "old guard"]]],
  ] as const) {
    commitAll(root, `round ${round}`, RECENT);
    for (const [what, cls, close] of batch) found(what, cls, close);
  }
  const model = loadSpecModel(root);
  assert.deepEqual(readDeadEnds(root, model.components).deadEnds, [], "the arrivals fell");
  const out: string[] = [];
  specCommand([root], { cwd: root, out: (l) => out.push(l), err: (l) => out.push(l) });
  assert.doesNotMatch(out.join("\n"), /DEAD END/);
  assert.match(out.join("\n"), /^dead ends: 0; read the journals of 1 worktree;/m);
  // Orient still says what it read, and the defect with no class, when nothing is at a dead end.
  assert.match(specBlock(root), /^Dead ends: none; the reading read the journals of 1 worktree; .*unclassified in the 14 days from \S+ to \S+ 1 \(df-[0-9a-f]{8}\)/m);
  // The other thresholds are crossed: it is the falling arrivals that tell converging work from a dead end.
  const records = loadJournal(root).records;
  const options = { folders: ["gear"], holding: (f: string) => (f.startsWith("gear/") ? "gear" : undefined), root, standing: () => "witnessed" as const, now: new Date() };
  const loose = deadEnds(records, defectStates(records), { ...options, thresholds: { rise: -Infinity } });
  assert.deepEqual(loose.map((d) => [d.subsystem, d.defects.length, d.classes.length, d.unclassified, d.rounds.map((r) => r.defects), d.trend]), [["gear", 8, 5, 1, [3, 3, 2], { earlier: 3, later: 2 }]]);
  assert.ok(loose[0]!.classes.some((c) => c.name === "hand-list") && loose[0]!.classes.some((c) => c.name === "audience"), "families count as classes do");
});

test("a defect names its component: --component, or the one component holding its files, and a reader derives one only for a record without it and says so", () => {
  const root = project({ "gadget/Gadget.spec.md": SPEC.replace("# Widget", "# Gadget").replace("Widgets turn.", "Gadgets hum.") });
  const j = journal(root, clock(RECENT));
  const record = (id: string) => loadJournal(root).records.find((r) => r.id === id) as Defect;
  const byFile = idOf(j("defect", "the knob slipped", "--evidence", "seen", "--file", "widget/knob.ts", "--file", "widget/deep/axle.ts", ...WHO));
  assert.equal(record(byFile).component, "widget", "every file in one component names it");
  const given = idOf(j("defect", "the hum drifted", "--evidence", "heard", "--component", "gadget/", ...WHO));
  assert.equal(record(given).component, "gadget", "--component names it outright");
  const split = j("defect", "two parts rattled", "--evidence", "shook", "--file", "widget/knob.ts", "--file", "gadget/hum.ts", ...WHO);
  assert.equal(record(idOf(split)).component, undefined, "files in two components name neither");
  assert.match(split.out.join("\n"), /no component: its files lie in gadget and widget, so it counts toward each/);
  const bare = j("defect", "something rattled", "--evidence", "shook", ...WHO);
  assert.match(bare.out.join("\n"), /no component: it names no file/);
  const refused = j("defect", "a ghost rattled", "--evidence", "shook", "--component", "nowhere", ...WHO);
  assert.equal(refused.code, 1);
  assert.match(refused.err.join("\n"), /--component nowhere names no component \(a folder holding a spec\); components: gadget, widget/);
  // A component that does not own every file the defect names is refused: the files decide where it counts, never the flag.
  const before = loadJournal(root).records.length;
  const moved = j("defect", "the knob slipped again", "--evidence", "seen", "--component", "gadget", "--file", "widget/knob.ts", ...WHO);
  assert.equal(moved.code, 1);
  assert.match(moved.err.join("\n"), /--component gadget does not own every file the defect names: widget\/knob\.ts \(in widget\)/);
  const narrowed = j("defect", "two parts rattled again", "--evidence", "shook", "--component", "widget", "--file", "widget/knob.ts", "--file", "gadget/hum.ts", ...WHO);
  assert.equal(narrowed.code, 1, "a defect of two components cannot be narrowed to one");
  assert.match(narrowed.err.join("\n"), /gadget\/hum\.ts \(in gadget\)/);
  const loose = j("defect", "the knob and the notes", "--evidence", "read", "--component", "widget", "--file", "widget/knob.ts", "--file", "NOTES.md", ...WHO);
  assert.equal(loose.code, 1, "a file in no component is owned by none");
  assert.match(loose.err.join("\n"), /NOTES\.md \(in no component\)/);
  assert.equal(loadJournal(root).records.length, before, "nothing was written");
  assert.equal(record(idOf(j("defect", "the axle bent", "--evidence", "seen", "--component", "widget", "--file", "widget/deep/axle.ts", ...WHO))).component, "widget", "a component that owns every file is written");
  // Without --component a file outside every component, or outside the project, leaves the record with none: the one component must own every file.
  const outside = j("defect", "the knob and the notes", "--evidence", "read", "--file", "widget/knob.ts", "--file", "NOTES.md", ...WHO);
  assert.equal(record(idOf(outside)).component, undefined);
  assert.match(outside.out.join("\n"), /no component: NOTES\.md lies in no component/);
  assert.equal(record(idOf(j("defect", "the knob and a sibling", "--evidence", "read", "--file", "widget/knob.ts", "--file", "../elsewhere/x.ts", ...WHO))).component, undefined);
  // A record written before the field: the store is append-only, so it is read as written and placed by derivation, and counted as derived.
  const old = { id: "df-01d01d00", kind: "defect", at: RECENT, session: "old", agent: "old", commit: null, dirty: false, what: "an old slip", evidence: "e", files: ["widget/knob.ts"] };
  writeFileSync(join(root, ".coherence", "journal", "old.jsonl"), JSON.stringify(old) + "\n");
  const model = loadSpecModel(root);
  const reading = readDeadEnds(root, model.components);
  assert.deepEqual(reading.placement, { recorded: 3, files: 4, guard: 0, unplaced: 1 }, "three named; the split, the two with a file in no component and the old one derived from their files; the bare one unplaced");
  assert.equal(loadJournal(root).records.find((r) => r.id === old.id)!.kind, "defect", "the old record is read as written");
});

test("the journal is read from every worktree of the repository, each record once, and a defect recorded only in another worktree reaches the dead-end reading", () => {
  const root = project();
  commitAll(root, "first", RECENT);
  const j = journal(root, clock(RECENT));
  const shared = idOf(j("decide", "a choice both checkouts hold", "--over", "none", "--because", "committed before the second worktree", ...WHO));
  execFileSync("git", ["add", "-f", ".coherence"], { cwd: root });
  commitAll(root, "the shared record", RECENT);
  const worktree = (): string => {
    const folder = made(mkdtempSync(join(tmpdir(), "coherence-worktree-")));
    rmSync(folder, { recursive: true });
    execFileSync("git", ["worktree", "add", "-q", "--detach", folder], { cwd: root });
    return folder;
  };
  const other = worktree();
  const elsewhere = idOf(journal(other, clock(RECENT))("defect", "the knob slipped in the other checkout", "--evidence", "seen", "--file", "widget/knob.ts", ...WHO));
  // A legacy store file of one name and one size in both checkouts, holding different records: neither stands for the other.
  const legacy = (id: string, chose: string) => JSON.stringify({ id, kind: "decision", at: RECENT, session: "legacy", agent: "a", commit: null, dirty: false, chose, over: [], because: "b" }) + "\n";
  writeFileSync(join(root, ".coherence", "journal", "legacy.jsonl"), legacy("d-aaaaaaaa", "made in the reading checkout"));
  writeFileSync(join(other, ".coherence", "journal", "legacy.jsonl"), legacy("d-bbbbbbbb", "made in the second checkout!"));
  assert.equal(readFileSync(join(root, ".coherence", "journal", "legacy.jsonl")).length, readFileSync(join(other, ".coherence", "journal", "legacy.jsonl")).length);
  // A store file that cannot be read in one worktree hides nothing of the same name in another, and is said.
  const third = worktree();
  mkdirSync(join(third, ".coherence", "journal", "stuck.jsonl"), { recursive: true });
  mkdirSync(join(other, ".coherence", "journal"), { recursive: true });
  writeFileSync(join(other, ".coherence", "journal", "stuck.jsonl"), legacy("d-cccccccc", "beside an unreadable twin"));
  // A worktree git calls prunable, its folder still there with a journal in it, and one whose folder is gone: neither is read.
  const prunable = worktree();
  mkdirSync(join(prunable, ".coherence", "journal"), { recursive: true });
  writeFileSync(join(prunable, ".coherence", "journal", "p.jsonl"), legacy("d-dddddddd", "in a prunable worktree"));
  rmSync(join(prunable, ".git"));
  const missing = worktree();
  execFileSync("git", ["worktree", "lock", missing], { cwd: root });
  rmSync(missing, { recursive: true });

  const snapshot = (folder: string): string => readdirSync(join(folder, ".coherence", "journal"), { recursive: true }).map(String).sort().map((name) => {
    try {
      return `${name}:${readFileSync(join(folder, ".coherence", "journal", name), "utf8")}`;
    } catch {
      return name;
    }
  }).join("\n");
  const before = [root, other, third].map(snapshot);
  const own = loadJournal(root).records.map((r) => r.id);
  assert.ok(own.includes(shared) && !own.includes(elsewhere), "a checkout's own journal holds only its own records");
  const across = loadJournalAcrossWorktrees(root);
  const ids = across.records.map((r) => r.id);
  assert.equal(ids.filter((id) => id === shared).length, 1, "the committed record both worktrees hold is read once");
  assert.ok(ids.includes(elsewhere), "the other worktree's record is read");
  assert.ok(ids.includes("d-aaaaaaaa") && ids.includes("d-bbbbbbbb"), "two files of one name and size with different records are both read");
  assert.ok(ids.includes("d-cccccccc"), "a file is not hidden by an unreadable one of its name elsewhere");
  assert.ok(across.damaged.some((d) => d.file === join(realpathSync(third), ".coherence", "journal", "stuck.jsonl") && d.line === 0 && /not read/.test(d.reason)), `the unreadable file is said: ${JSON.stringify(across.damaged)}`);
  assert.ok(!ids.includes("d-dddddddd"), "a prunable worktree is not read");
  assert.deepEqual(across.worktrees[0], { path: root, self: true, records: own.length, only: own.length });
  const read = new Map(across.worktrees.slice(1).map((w) => [realpathSync(w.path), w.only]));
  assert.deepEqual(read, new Map([[realpathSync(other), 3], [realpathSync(third), 0]]), "the other two live worktrees, the prunable and the missing one left out");
  assert.deepEqual([root, other, third].map(snapshot), before, "nothing is written into any worktree it reads, the others' included");
  const reading = readDeadEnds(root, loadSpecModel(root).components);
  assert.equal(reading.worktrees.length, 3);
  assert.equal(reading.placement.recorded, 1, "the other worktree's defect is placed by the component its record names");
  const out: string[] = [];
  specCommand([root], { cwd: root, out: (l) => out.push(l), err: (l) => out.push(l) });
  assert.match(out.join("\n"), /^dead ends: 0; read the journals of 3 worktrees, records only in .*coherence-worktree-[^ ]+ \(3\), 1 unreadable line or file;/m);
  // Orient says what it read even with no dead end.
  assert.match(specBlock(root), /^Dead ends: none; the reading read the journals of 3 worktrees, records only in /m);
  execFileSync("git", ["worktree", "unlock", missing], { cwd: root });
  for (const folder of [other, third]) execFileSync("git", ["worktree", "remove", "--force", folder], { cwd: root });
  execFileSync("git", ["worktree", "prune"], { cwd: root });

  // A bare repository's own entry is no worktree to read, even with a journal folder inside it.
  const bare = made(mkdtempSync(join(tmpdir(), "coherence-bare-")));
  execFileSync("git", ["clone", "-q", "--bare", root, join(bare, "repo.git")]);
  mkdirSync(join(bare, "repo.git", ".coherence", "journal"), { recursive: true });
  writeFileSync(join(bare, "repo.git", ".coherence", "journal", "b.jsonl"), legacy("d-eeeeeeee", "inside the bare repository"));
  execFileSync("git", ["worktree", "add", "-q", "--detach", join(bare, "checkout")], { cwd: join(bare, "repo.git") });
  const fromBare = loadJournalAcrossWorktrees(join(bare, "checkout"));
  assert.deepEqual(fromBare.worktrees.map((w) => w.self), [true], "the bare entry is left out");
  assert.ok(!fromBare.records.some((r) => r.id === "d-eeeeeeee"));
});
