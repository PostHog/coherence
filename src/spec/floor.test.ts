/**
 * The invariant floor: a bullet the run store graded an invariant is not
 * demoted, removed, or stripped of an enforcement form without a decision
 * naming it (df-f3826eaa).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { loadSpecModel } from "./model.ts";
import { gradeRecord } from "../enforcement/run.ts";
import { applicableShapes, loadSeed } from "./seed.ts";
import { journalVerbs, type Io } from "../journal/cli.ts";
import { appendRefutation, appendRun, type RunEntry, type RunRecord } from "../enforcement/record.ts";

// Every fixture folder this file makes is removed when the file is done; the leak guard fails a file that leaves one.
const madeFolders: string[] = [];
const made = (folder: string): string => (madeFolders.push(folder), folder);
after(() => {
  for (const folder of madeFolders) rmSync(folder, { recursive: true, force: true });
});

const seed = loadSeed();
const WHO = ["--session", "s1", "--agent", "main"];
const SPEC_PATH = "src/widget/Widget.spec.md";

const HEAD = "# Widget\n\nWidgets turn.\n\n## invariants\n";

/** The bullet df-f3826eaa demoted: kinds that ask for a checklist, its lines after the kinds line. */
function knob(name = "the knob keeps its history", via = "the knob keeps every turn"): string {
  const checklist = applicableShapes(seed, ["revision"])
    .map((shape, index) => (index === 0 ? `  checklist: ${shape.shape} declared as ${name}\n` : `  checklist: ${shape.shape} dismissed: not this shape\n`))
    .join("");
  return `- ${name}: Every turn of the knob is kept.\n  over: every turn\n  via: ${via}\n  because: a lost turn is a lost history\n  kinds: revision\n${checklist}`;
}

const NEWCOMER = "- the knob has a stop: The knob stops at ten.\n";

function project(spec: string): string {
  const root = made(mkdtempSync(join(tmpdir(), "coherence-floor-")));
  mkdirSync(dirname(join(root, SPEC_PATH)), { recursive: true });
  writeFileSync(join(root, SPEC_PATH), spec);
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function decide(root: string, ...argv: string[]): number {
  let tick = Date.parse("2026-10-05T10:00:00.000Z");
  const io: Io = { cwd: root, now: () => new Date((tick += 1000)), out: () => {}, err: () => {} };
  return journalVerbs["decide"]!([...argv, ...WHO], io);
}

/** A refutation of the bullet's totality oracle, then a passing run at `at`: the run grades it an invariant. */
function witness(root: string, name: string, at: string, entry: Partial<RunEntry> = {}): void {
  appendRefutation(root, { kind: "refutation", at: "2026-10-05T08:00:00.000Z", session: "s0", agent: "main", component: "src/widget", name, form: "totality oracle", broke: "dropped a turn", verdict: "fail", reason: "red", commit: null, dirty: true });
  const invariants: RunEntry[] = [{ component: "src/widget", name, form: "totality oracle", verdict: "pass", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], latency: 1, reason: "green", ...entry }];
  appendRun(root, record(at, invariants));
}

function record(at: string, invariants: RunEntry[]): RunRecord {
  return { at, session: "s0", agent: "main", commit: null, dirty: true, instrument: { language: "typescript", server: "none" }, latency: 1, invariants };
}

const messages = (root: string): string[] => loadSpecModel(root, { seed }).problems.map((p) => p.message);

test("an invariant the run store graded is not demoted, removed, or renamed away without a decision naming it; a requirement never graded is free", () => {
  // df-f3826eaa: a bullet inserted between an invariant and its checklist lines takes them.
  const root = project(HEAD + knob());
  witness(root, "the knob keeps its history", "2026-10-05T09:00:00.000Z");
  assert.deepEqual(loadSpecModel(root, { seed }).components[0]!.invariants.map((i) => i.state), ["invariant"]);
  assert.deepEqual(messages(root), []);
  const [bullet, checklist] = knob().split(/(?=  checklist:)/, 2) as [string, string];
  writeFileSync(join(root, SPEC_PATH), HEAD + bullet + NEWCOMER + knob().slice(bullet.length));
  assert.ok(checklist.startsWith("  checklist:"));
  const demoted = messages(root);
  assert.equal(demoted.length, 1, demoted.join("\n"));
  assert.match(demoted[0]!, /^invariant src\/widget\/the knob keeps its history was graded an invariant by the run of 2026-10-05T09:00:00.000Z and has lost its checklist; an invariant is not demoted silently: decide "demote src\/widget\/the knob keeps its history: <retired, the code changed, or moved to where>" --because "<why>"$/);

  // A decision that does not name the bullet clears nothing; one that names it does.
  assert.equal(decide(root, "insert the stop bullet", "--because", "unrelated"), 0);
  assert.equal(messages(root).length, 1);
  assert.equal(decide(root, "demote src/widget/the knob keeps its history: its checklist moved to the stop", "--because", "the merge put it there"), 0);
  assert.deepEqual(messages(root), []);
  // A run of the demoted bullet grades it a requirement, so the floor stays and the decision keeps clearing it.
  const entry: RunEntry = { component: "src/widget", name: "the knob keeps its history", form: "totality oracle", verdict: "pass", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], latency: 1, reason: "green" };
  gradeRecord(root, record("2026-10-05T11:00:00.000Z", [entry]));
  assert.equal(entry.state, "requirement");
  assert.deepEqual(entry.enforces, ["the knob keeps every turn"]);
  witness(root, "the knob keeps its history", "2026-10-05T11:00:00.000Z", { state: entry.state, enforces: entry.enforces });
  assert.deepEqual(messages(root), []);
  // Graded an invariant again after the decision, a second demotion asks for a second one.
  witness(root, "the knob keeps its history", "2026-10-05T12:00:00.000Z", { state: "invariant" });
  assert.equal(messages(root).length, 1);

  // A newly declared requirement, never graded an invariant, is not flagged; nor is one a run graded a requirement.
  const fresh = project(HEAD + knob() + NEWCOMER);
  witness(fresh, "the knob keeps its history", "2026-10-05T09:00:00.000Z");
  // A run grades the whole bullet an invariant, its witness read from the store, and the bullet with no enforcement a requirement.
  const graded: RunEntry[] = ["the knob keeps its history", "the knob has a stop"].map((name) => ({ component: "src/widget", name, form: "totality oracle", verdict: "pass", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], latency: 1, reason: "green" }));
  gradeRecord(fresh, record("2026-10-05T10:00:00.000Z", graded));
  assert.deepEqual(graded.map((e) => e.state), ["invariant", "requirement"]);
  witness(fresh, "the knob has a stop", "2026-10-05T09:30:00.000Z", { state: "requirement" });
  assert.deepEqual(messages(fresh), []);

  // Removed: the bullet itself is what it lost.
  const removed = project(HEAD + knob());
  witness(removed, "the knob keeps its history", "2026-10-05T09:00:00.000Z", { state: "invariant", enforces: ["the knob keeps every turn"] });
  writeFileSync(join(removed, SPEC_PATH), HEAD + NEWCOMER);
  assert.match(messages(removed).join("\n"), /invariant src\/widget\/the knob keeps its history .* has lost the bullet itself/);
  // Renamed in the same edit, with the same via: still an invariant, recognized without a decision.
  writeFileSync(join(removed, SPEC_PATH), HEAD + knob("every turn is kept"));
  assert.deepEqual(messages(removed), []);
  // Renamed and demoted at once is not a rename the floor recognizes.
  writeFileSync(join(removed, SPEC_PATH), HEAD + knob("every turn is kept").replace("  kinds: revision\n", ""));
  assert.match(messages(removed).join("\n"), /the knob keeps its history .* has lost the bullet itself/);
  // An entry from before enforces was recorded names no enforcement: its rename needs the decision.
  const legacy = project(HEAD + knob());
  witness(legacy, "the knob keeps its history", "2026-10-05T09:00:00.000Z");
  writeFileSync(join(legacy, SPEC_PATH), HEAD + knob("every turn is kept"));
  assert.equal(messages(legacy).length, 1);
  // Named in what the decision turned away counts too: there a name the lexicon has rejected since may still be quoted.
  assert.equal(decide(legacy, "demote the knob's history bullet: renamed every turn is kept", "--over", "src/widget/the knob keeps its history, kept under its old name", "--because", "a shorter name"), 0);
  assert.deepEqual(messages(legacy), []);
});
