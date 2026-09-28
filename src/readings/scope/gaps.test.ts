/**
 * Spec gaps at hook time (gaps.ts): the recorded reading stands for the tree
 * only while its fingerprint holds, the gaps derive from it with the current
 * spec and runs, the adoption baseline only shrinks, and orient's line is
 * one bounded line or nothing.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLOSE_WAYS, STRUCTURE_DIR, awaitRefresh, currentGaps, freshReading, gapsOf, orientGapText, readAndRecord, readGapBaseline, recordGapBaseline, recordReading, refreshInBackground, refreshUnderWay, structureFingerprint, type GapState } from "./gaps.ts";
import type { InterfaceReading } from "./model.ts";
import { gapProject } from "./gaps-fixture.ts";


test("a recorded Structure reading stands for the tree only while its fingerprint holds: a partial one is never kept, an edit made while it ran leaves nothing, a changed source file, handler or config makes it stale, and a spec line the reading never reads leaves it standing", async () => {
  const { root, reading, remove } = gapProject();
  try {
    assert.equal(freshReading(root), undefined, "nothing recorded: unknown");
    const before = structureFingerprint(root);
    assert.equal(recordReading(root, { ...reading, partial: { limit: "time", budget: "1 s", seconds: 1, unread: ["."] } } as InterfaceReading, before), false, "a partial reading is never kept");
    assert.equal(recordReading(root, { kind: "unread", because: "no instrument" }, before), false, "nor an unread one");
    const moved = await readAndRecord(root, async () => {
      writeFileSync(join(root, "src", "look.ts"), "export function look(): void {}\nexport function peek(): void {}\nexport function ping(): void { /* edited while reading */ }\n");
      return reading;
    });
    assert.equal(moved, reading);
    assert.equal(freshReading(root), undefined, "an edit made while the reading ran leaves nothing recorded");
    await readAndRecord(root, async () => reading);
    assert.deepEqual(freshReading(root)?.reading, reading, "recorded, and fresh");
    const gaps = currentGaps(root)!;
    assert.deepEqual(gaps.gaps.map((g) => g.name).sort(), ["look", "peek"], "the untrusted, untraced entrances; ping declares control: none");
    assert.equal(gaps.noControl, 1);
    const spec = readFileSync(join(root, "Gappy.spec.md"), "utf8");
    for (const [file, text] of [["src/look.ts", "export function look(): void { return; }\n"], ["Gappy.spec.md", spec.replace("handler: peek in src/look.ts", "handler: look in src/look.ts")], ["coherence.config.json", JSON.stringify({ name: "Gappy", language: "typescript", ignore: ["x"] })]] as const) {
      const { root: other, reading: r, remove: gone } = gapProject();
      try {
        await readAndRecord(other, async () => r);
        assert.ok(freshReading(other) !== undefined);
        writeFileSync(join(other, file), text);
        assert.equal(freshReading(other), undefined, `a change to ${file} makes it stale`);
        assert.equal(currentGaps(other), undefined, "and the gaps unknown, never guessed");
      } finally {
        gone();
      }
    }
    assert.ok(existsSync(join(root, STRUCTURE_DIR, "reading.json")));
    // control: none on look is read from the spec, not the reading: the reading stands, and the gap closes at once.
    writeFileSync(join(root, "Gappy.spec.md"), spec.replace("  trust: public\n- peek", "  trust: public\n  control: none — the same page for every caller\n- peek"));
    assert.deepEqual(currentGaps(root)?.gaps.map((g) => g.name), ["peek"], "a control: none closes its gap without a new reading");
  } finally {
    remove();
  }
});

test("the gaps derive from the recorded reading with the current runs and spec, and the adoption baseline only shrinks", async () => {
  const { root, reading, remove } = gapProject();
  try {
    await readAndRecord(root, async () => reading);
    const state = currentGaps(root)!;
    const who = { session: "s-base", agent: "test" };
    assert.match(recordGapBaseline(root, state, who), /^Baseline taken \(d-[0-9a-f]+\): 2 entrances with no traced control/);
    assert.deepEqual([...readGapBaseline(root)!.entrances].map((k) => k.split("\u0000")[1]).sort(), ["look", "peek"]);
    const smaller: GapState = { ...state, gaps: state.gaps.filter((g) => g.name === "look") };
    assert.match(recordGapBaseline(root, smaller, who), /^Baseline shrunk/);
    const wider: GapState = { ...state, gaps: [...state.gaps, { ...state.gaps[0]!, name: "stare" }] };
    assert.match(recordGapBaseline(root, wider, who), /^Baseline unchanged/, "a later record never adds a gap");
    assert.deepEqual([...readGapBaseline(root)!.entrances].map((k) => k.split("\u0000")[1]), ["look"]);
  } finally {
    remove();
  }
});

test("orient's gap line is one bounded line naming the count, the busiest route by entrance count and the three ways to close one; gaps the baseline holds stay counted as open, never named; nothing when there are none", () => {
  const gap = (name: string, route: string, entrances: number): GapState["gaps"][number] => ({ component: ".", name, specPath: "Gappy.spec.md", handler: undefined, file: undefined, trust: ["public"], route: { id: route, first: name, entrances, stops: [".", "src/db"] } });
  const long = "x".repeat(200);
  const state: GapState = { gaps: [gap("a", "r1", 1), gap(long, "r2", 3), gap("c", "r2", 3), gap("d", "r2", 3)], entrances: [], noControl: 0 };
  const line = orientGapText(state, undefined, "coherence");
  assert.equal(line.split("\n").length, 1);
  assert.match(line, /^Spec gaps: 4 entrances carry outside or unknown trust in with no traced control on their route; busiest: x{39}… and 2 more \(\. -> src\/db\)/);
  assert.ok(line.includes(CLOSE_WAYS), "the three ways to close one");
  assert.match(CLOSE_WAYS, /guard:[^]*invariant whose crossing enters from its trust[^]*control: none — <reason>/);
  assert.ok(line.length < 500, `bounded (${line.length})`);
  assert.equal(orientGapText({ ...state, gaps: [] }, undefined, "coherence"), "", "nothing when there are none");
  const baseline = { id: "d-1", entrances: new Set(state.gaps.map((g) => `${g.component}\u0000${g.name}`)) };
  assert.equal(orientGapText(state, baseline, "coherence"), "Spec gaps: none new since adoption; 4 gaps baselined at adoption remain open; coherence scaffold control --all proposes how to close them.", "gaps held by the baseline stay counted, never named, when none is new");
  const fresh = orientGapText({ ...state, gaps: [...state.gaps, gap("new", "r3", 1)] }, baseline, "coherence");
  assert.match(fresh, /^Spec gaps: 1 entrance carries [^]*beyond the adoption baseline; busiest: new \(/, "a new uncontrolled entrance is always named");
  assert.match(fresh, / Also, 4 gaps baselined at adoption remain open\.$/, "and the baselined ones are still counted");
  assert.ok(!fresh.includes(long.slice(0, 39)), "a baselined gap is never named");
  assert.equal(gapsOf({ spec: { components: [], trustLevels: [] } } as never, { routes: [], entrances: [] } as never).gaps.length, 0);
});

/* ---------------------------------------- the refresh (df-84db9e4f) */

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

function mark(root: string): { pid: number; at: string; fingerprint: string } {
  return JSON.parse(readFileSync(join(root, STRUCTURE_DIR, "refresh.json"), "utf8")) as { pid: number; at: string; fingerprint: string };
}

test("one refresh at a time, started detached without waiting: never twice for one tree, a live refresh of an older tree is superseded, and a process that is not a structure query is never signalled", async () => {
  const { root, remove } = gapProject();
  // A stand-in for query structure: it sleeps, and its command line names the question as the real one does.
  const command = [process.execPath, "-e", "setTimeout(() => {}, 30000)", "query", "structure"];
  const pids: number[] = [];
  try {
    const began = Date.now();
    assert.equal(refreshInBackground(root, command, "tree-a"), true);
    assert.ok(Date.now() - began < 1000, `the start returns at once: ${Date.now() - began} ms`);
    const first = mark(root).pid;
    pids.push(first);
    assert.ok(running(first), "the reading runs on after the start returned");
    assert.ok(refreshUnderWay(root) !== undefined);
    assert.equal(refreshInBackground(root, command, "tree-a"), false, "never twice for one tree");
    assert.equal(refreshInBackground(root, command, "tree-b"), true, "a newer tree supersedes");
    const second = mark(root).pid;
    pids.push(second);
    assert.notEqual(second, first);
    assert.ok(await until(() => !running(first), 3000), "the refresh of the older tree is stopped: its reading could never be kept");
    assert.ok(running(second));
    // A mark whose pid is alive but no structure query (here, this test's own process) is never signalled, and holds the slot.
    writeFileSync(join(root, STRUCTURE_DIR, "refresh.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), fingerprint: "tree-c" }));
    assert.equal(refreshInBackground(root, command, "tree-d"), false, "an unrecognized live process is left alone");
    assert.equal(mark(root).pid, process.pid);
  } finally {
    for (const pid of pids) if (running(pid)) process.kill(pid, "SIGKILL");
    remove();
  }
});

test("a session start waits a bounded moment for a refresh of this tree the last reading's duration says is nearly done, and not at all for one that is not", async () => {
  const { root, reading, remove } = gapProject();
  try {
    await readAndRecord(root, async () => reading);
    writeFileSync(join(root, "src", "look.ts"), "export function look(): void { return; }\nexport function peek(): void {}\nexport function ping(): void {}\n");
    const fingerprint = structureFingerprint(root);
    assert.equal(currentGaps(root, fingerprint), undefined, "stale");
    // A refresh of this tree under way (this process stands for it: alive), begun just now; the last reading took moments.
    const refreshing = (tree: string): void => writeFileSync(join(root, STRUCTURE_DIR, "refresh.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), fingerprint: tree }));
    refreshing(fingerprint);
    const done = setTimeout(() => void readAndRecord(root, async () => reading), 600);
    const began = Date.now();
    const fresh = await awaitRefresh(root, fingerprint, 15_000);
    clearTimeout(done);
    assert.ok(fresh !== undefined, "the nearly done refresh was waited for");
    assert.deepEqual(fresh.gaps.map((g) => g.name).sort(), ["look", "peek"]);
    assert.ok(Date.now() - began < 5000, `and the wait ended when it finished: ${Date.now() - began} ms`);

    writeFileSync(join(root, "src", "look.ts"), "export function look(): void {}\nexport function peek(): void { return; }\nexport function ping(): void {}\n");
    const next = structureFingerprint(root);
    const recorded = join(root, STRUCTURE_DIR, "reading.json");
    writeFileSync(recorded, JSON.stringify({ ...JSON.parse(readFileSync(recorded, "utf8")), ms: 180_000 }));
    refreshing(next);
    const slow = Date.now();
    assert.equal(await awaitRefresh(root, next, 15_000), undefined, "a reading that takes three minutes is not waited on");
    assert.ok(Date.now() - slow < 500, `not at all: ${Date.now() - slow} ms`);
    refreshing("another tree");
    assert.equal(await awaitRefresh(root, next, 15_000), undefined, "nor a refresh of another tree");
  } finally {
    remove();
  }
});
