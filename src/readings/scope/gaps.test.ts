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
import { CLOSE_WAYS, STRUCTURE_DIR, currentGaps, freshReading, gapsOf, orientGapText, readAndRecord, readGapBaseline, recordGapBaseline, recordReading, structureFingerprint, type GapState } from "./gaps.ts";
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

test("orient's gap line is one bounded line naming the count, the busiest route by entrance count and the three ways to close one; nothing when none is outside the baseline", () => {
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
  assert.equal(orientGapText(state, baseline, "coherence"), "", "nothing when every gap predates the adoption");
  const fresh = orientGapText({ ...state, gaps: [...state.gaps, gap("new", "r3", 1)] }, baseline, "coherence");
  assert.match(fresh, /^Spec gaps: 1 entrance carries [^]*beyond the adoption baseline; busiest: new \(/, "a new uncontrolled entrance is always named");
  assert.equal(gapsOf({ spec: { components: [], trustLevels: [] } } as never, { routes: [], entrances: [] } as never).gaps.length, 0);
});
