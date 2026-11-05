/**
 * The relief scene's pure parts, which need no WebGL: the windows as dates,
 * with and without landings, and the turns that keep a stale diff answer from
 * winning over a later one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { turns, windowsOf } from "./scene.ts";

const WINDOWS = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "all", label: "All loaded", days: null },
];

test("with no landing the relief has no latest date, and every window starts at the start of history", () => {
  const none = windowsOf({ windows: WINDOWS, landings: [] });
  assert.equal(none.latest, undefined);
  assert.deepEqual(none.windows.map((w) => [w.key, w.from]), [["7", "0000"], ["30", "0000"], ["all", "0000"]]);
  const some = windowsOf({ windows: WINDOWS, landings: [{ sha: "abc1234", date: "2026-10-30", subject: "land", n: 1, c: [[0, 3]] }] });
  assert.equal(some.latest, "2026-10-30");
  assert.deepEqual(some.windows.map((w) => [w.key, w.from]), [["7", "2026-10-24"], ["30", "2026-10-01"], ["all", "0000"]], "a window of n days ends on the latest landing's day");
});

test("a diff answer to an earlier ask that lands after a later ask is stale, and only the latest ask's answer is current", async () => {
  const turn = turns();
  const answers: string[] = [];
  const ask = async (name: string, ms: number): Promise<void> => {
    const current = turn();
    await new Promise((done) => setTimeout(done, ms));
    if (current()) answers.push(name);
  };
  // The first ask is slow and the second fast: the first answer arrives last and must not win.
  await Promise.all([ask("older", 20), ask("newer", 1)]);
  assert.deepEqual(answers, ["newer"]);
  const first = turn();
  assert.equal(first(), true, "a lone ask is current");
  turn();
  assert.equal(first(), false, "and stale once another is made");
});
