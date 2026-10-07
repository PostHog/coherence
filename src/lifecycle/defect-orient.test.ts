/**
 * What the gyroscope carries of the defect floor and the convergence reading:
 * orient names each guard failure, and a hook call's kept time says which
 * Coherence version answered it.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { journalVerbs, type Io } from "../journal/cli.ts";
import { specBlock } from "./hook.ts";
import { HOOK_TIMES_DIR, hookTimes, recordHookTime } from "./hook-latency.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = "# Widget\n\nWidgets turn.\n\n## invariants\n- knob turns: The knob turns.\n  over: every knob\n  via: the knob turns\n  because: a stuck knob is a broken widget\n  kinds: none\n";

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-defect-orient-"));
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
  appendFileSync(join(runs, "w.jsonl"), JSON.stringify({ at: "2026-10-02T00:00:01.000Z", session: "w", agent: "w", commit: null, dirty: false, invariants: [{ component: "widget", name: "knob turns", form: "totality oracle", verdict: "pass", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], reason: "green" }] }) + "\n");
  const j = journal(root);
  const who = ["--session", "s1", "--agent", "alpha"];
  const first = j("defect", "the knob stuck", "--evidence", "turned it", "--class", "path-identity", ...who);
  assert.equal(specBlock(root), "", "a defect with no guard yet is no guard failure");
  const close = j("resolved", first, "--because", "oiled, every knob checked", "--guard", "widget/knob turns", ...who);
  assert.equal(specBlock(root), "", "the guarded defect itself is none");
  const repeat = j("defect", "another knob stuck", "--evidence", "turned it", "--class", "path-identity", ...who);
  const block = specBlock(root);
  assert.match(block, /^Guard failures \(1\): a defect arrived in a class a guard already covered, so the guard was weaker than claimed/m);
  assert.match(block, new RegExp(`✕ ${repeat} in class path-identity, guarded by widget/knob turns since ${close}`));
});

test("a hook call's kept time carries the Coherence version that answered it", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-hook-version-"));
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
