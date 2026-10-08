/**
 * What the gyroscope carries of the defect floor and the convergence reading:
 * orient names each guard failure, and a hook call's kept time says which
 * Coherence version answered it.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { journalVerbs, type Io } from "../journal/cli.ts";
import { specBlock } from "./hook.ts";
import { HOOK_TIMES_DIR, hookTimes, recordHookTime } from "./hook-latency.ts";

// Every fixture folder this file makes is removed when the file is done; the leak guard fails a file that leaves one.
const madeFolders: string[] = [];
const made = (folder: string): string => (madeFolders.push(folder), folder);
after(() => {
  for (const folder of madeFolders) rmSync(folder, { recursive: true, force: true });
});

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = "# Widget\n\nWidgets turn.\n\n## invariants\n- knob turns: The knob turns.\n  over: every knob\n  via: the knob turns\n  because: a stuck knob is a broken widget\n  kinds: none\n";

/** When the guard-failure fixture is read: a day after its run, so the floor's quiet line stays out of it. */
const ORIENT_AT = Date.parse("2026-10-03T00:00:00.000Z");

function project(): string {
  const root = made(mkdtempSync(join(tmpdir(), "coherence-defect-orient-")));
  mkdirSync(join(root, "widget"), { recursive: true });
  writeFileSync(join(root, "widget", "Widget.spec.md"), SPEC);
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function journal(root: string): (...argv: string[]) => string {
  let tick = Date.parse("2026-10-03T00:00:00.000Z");
  const now = (): Date => new Date((tick += 1000));
  return (...argv) => {
    const [verb, ...rest] = argv;
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { cwd: root, now, out: (l) => out.push(l), err: (l) => err.push(l) };
    assert.equal(journalVerbs[verb!]!(rest, io), 0, err.join("\n"));
    return out[0]!.split(/\s+/)[0]!;
  };
}

test("orient names each guard failure under the spec block", () => {
  const root = project();
  const runs = join(root, ".coherence", "runs");
  mkdirSync(runs, { recursive: true });
  appendFileSync(join(runs, "w.jsonl"), JSON.stringify({ kind: "refutation", at: "2026-10-02T00:00:00.000Z", session: "w", agent: "w", component: "widget", name: "knob turns", form: "totality oracle", broke: "a break", verdict: "fail", reason: "red", commit: null, dirty: false }) + "\n");
  appendFileSync(join(runs, "w.jsonl"), JSON.stringify({ at: "2026-10-02T00:00:01.000Z", session: "w", agent: "w", commit: null, dirty: false, full: true, invariants: [{ component: "widget", name: "knob turns", form: "totality oracle", verdict: "pass", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], reason: "green" }] }) + "\n");
  const j = journal(root);
  const who = ["--session", "s1", "--agent", "alpha"];
  const first = j("defect", "the knob stuck", "--evidence", "turned it", "--class", "path-identity", ...who);
  assert.equal(specBlock(root, ORIENT_AT), "", "a defect with no guard yet is no guard failure");
  const close = j("resolved", first, "--because", "oiled, every knob checked", "--guard", "widget/knob turns", ...who);
  assert.equal(specBlock(root, ORIENT_AT), "", "the guarded defect itself is none");
  const repeat = j("defect", "another knob stuck", "--evidence", "turned it", "--class", "path-identity", ...who);
  const block = specBlock(root, ORIENT_AT);
  assert.match(block, /^Guard failures \(1\): a defect arrived in a class a guard already covered, so the guard was weaker than claimed/m);
  assert.match(block, new RegExp(`✕ ${repeat} in class path-identity, guarded by widget/knob turns since ${close}`));
});

test("a hook call's kept time carries the Coherence version that answered it", () => {
  const root = made(mkdtempSync(join(tmpdir(), "coherence-hook-version-")));
  const version = (JSON.parse(readFileSync(resolve(here, "..", "..", "package.json"), "utf8")) as { version: string }).version;
  recordHookTime(root, "s1", { at: "2026-10-07T10:00:00.000Z", event: "PreToolUse", ms: 120 });
  const kept = hookTimes(root, "s1");
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.version, version);
  assert.match(readFileSync(join(root, HOOK_TIMES_DIR, "s1.jsonl"), "utf8"), new RegExp(`"version":"${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  // A time kept before versions were written still reads, as unknown.
  appendFileSync(join(root, HOOK_TIMES_DIR, "s1.jsonl"), JSON.stringify({ at: "2026-10-01T10:00:00.000Z", event: "Stop", ms: 900 }) + "\n");
  assert.equal(hookTimes(root, "s1")[1]!.version, undefined);
});

test("orient names an invariant floor no full run has graded in fourteen days; a scoped run and a run dated in the future move nothing", () => {
  const root = project();
  const runs = join(root, ".coherence", "runs");
  mkdirSync(runs, { recursive: true });
  const entry = { component: "widget", name: "knob turns", form: "totality oracle", verdict: "pass", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], reason: "green" };
  // An edit's check (ungraded), a scoped run (graded, not full), or a full run (graded, every bullet).
  const run = (at: string, kind: "edit" | "scoped" | "full"): void =>
    appendFileSync(join(runs, "w.jsonl"), JSON.stringify({ at, session: "w", agent: "w", commit: null, dirty: false, ...(kind === "full" ? { full: true } : {}), invariants: [kind === "edit" ? { ...entry, ungraded: true } : { ...entry, state: "invariant" }] }) + "\n");
  appendFileSync(join(runs, "w.jsonl"), JSON.stringify({ kind: "refutation", at: "2026-08-31T00:00:00.000Z", session: "w", agent: "w", component: "widget", name: "knob turns", form: "totality oracle", broke: "a break", verdict: "fail", reason: "red", commit: null, dirty: false }) + "\n");
  const day = 86_400_000;
  const graded = Date.parse("2026-09-01T00:00:00.000Z");
  const FLOOR = /^Invariant floor:/m;
  assert.doesNotMatch(specBlock(root, graded), FLOOR, "no run, no floor to name");
  run("2026-09-01T00:00:00.000Z", "edit");
  assert.match(specBlock(root, graded + day), /^Invariant floor: no full run has graded every bullet; a scoped run moves only its own bullets and an edit's check records its entries ungraded, so the rest of the floor stands where that run left it\. Run: run$/m, "only edit checks: the floor was never moved");
  run("2026-09-01T00:00:00.500Z", "scoped");
  assert.match(specBlock(root, graded + day), /^Invariant floor: no full run has graded every bullet/m, "a run scoped by --invariant or --form is no full run");
  run("2026-09-01T00:00:01.000Z", "full");
  assert.doesNotMatch(specBlock(root, graded + 14 * day), FLOOR, "a full run fourteen days ago still holds the floor");
  // Edit checks and scoped runs since the full run, the latest of all the runs, move nothing; nor does a full run dated in the future.
  run("2026-09-20T00:00:00.000Z", "edit");
  run("2026-09-20T00:00:01.000Z", "scoped");
  run("2099-01-01T00:00:00.000Z", "full");
  assert.match(specBlock(root, graded + 20 * day), /^Invariant floor: the last full run that graded every bullet was 19 days ago \(2026-09-01T00:00:01\.000Z\)/m, "neither a scoped run nor a future one moves it");
  run("2026-09-21T00:00:00.000Z", "full");
  assert.doesNotMatch(specBlock(root, graded + 21 * day), FLOOR, "a full run moves it again");
});
