/**
 * The relief's layout: files that land together stand side by side, a kept
 * order survives a landing and a restart, and components open where the kept
 * layout left them.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileOrder, placeComponents } from "./layout.ts";
import { LayoutKeeper, layoutPath, readLayout } from "./layout-store.ts";

const file = (name: string, lines: number, landed: number[]) => ({ file: name, lines, reached: 0, l: landed.map((li) => [li, 1] as [number, number]) });
const landings = (count: number, n = 3) => Array.from({ length: count }, () => ({ n }));

test("files that land together stand side by side in the order, whatever their size; a file sharing no landing pairs with the rest last", () => {
  // a1 and a2 always land together, as do b1 and b2; a big file between them in size lands with neither.
  const files = [file("a1.ts", 10, [0, 1, 2]), file("big.ts", 900, [5]), file("b1.ts", 12, [3, 4]), file("a2.ts", 11, [0, 1, 2]), file("b2.ts", 300, [3, 4]), file("lone.ts", 50, [])];
  const order = fileOrder(files, landings(6));
  assert.equal(order.length, files.length);
  assert.deepEqual(new Set(order), new Set(files.map((f) => f.file)), "every file once");
  const next = (a: string, b: string) => Math.abs(order.indexOf(a) - order.indexOf(b)) === 1;
  assert.ok(next("a1.ts", "a2.ts"), `a1 and a2 side by side: ${order.join(" ")}`);
  assert.ok(next("b1.ts", "b2.ts"), `b1 and b2 side by side: ${order.join(" ")}`);
  assert.deepEqual(fileOrder(files, landings(6)), order, "the same files give the same order");
  // A landing of more than 40 files is a bulk move: it joins nothing.
  const bulk = [file("x.ts", 10, [0]), file("y.ts", 10, [0]), file("z.ts", 10, [1]), file("w.ts", 10, [1])];
  const spread = fileOrder(bulk, [{ n: 41 }, { n: 2 }]);
  assert.ok(Math.abs(spread.indexOf("z.ts") - spread.indexOf("w.ts")) === 1, "a small landing joins its files");
});

test("a kept order survives a landing: a new file goes in after the file it lands with most, a gone file drops out, nothing else moves", () => {
  const kept = ["a.ts", "b.ts", "c.ts", "d.ts"];
  // A landing now joins d with a: unseeded, that could pull d beside a; seeded, d stays where the reader learned it.
  const files = [file("a.ts", 10, [0, 9]), file("b.ts", 10, [1]), file("d.ts", 10, [2, 9]), file("new.ts", 5, [1]), file("lone.ts", 5, [])];
  assert.deepEqual(fileOrder(files, landings(10), kept), ["a.ts", "b.ts", "new.ts", "d.ts", "lone.ts"]);
});

test("thousands of files are ordered in well under a second, with no square table", () => {
  const N = 4000, L = 1500;
  const files = Array.from({ length: N }, (_, i) => file(`f${i}.ts`, 10 + (i % 300), [(i * 7) % L, (i * 7 + 131) % L, (i * 7 + 262) % L]));
  const start = performance.now();
  const order = fileOrder(files, landings(L, 10));
  assert.equal(new Set(order).size, N);
  assert.ok(performance.now() - start < 1000, `ordered in ${Math.round(performance.now() - start)} ms`);
});

test("components open where the kept layout left them: placed again from their own places, none moves more than a hair", () => {
  const C = [
    { folder: ".", v: { lines: 100 } },
    { folder: "src", v: { lines: 400 } },
    { folder: "src/a", v: { lines: 300 } },
    { folder: "src/b", v: { lines: 200 } },
    { folder: "docs", v: { lines: 50 } },
  ];
  const landed = [{ n: 2, c: [[2, 1], [3, 1]] as [number, number][] }, { n: 2, c: [[1, 1], [4, 1]] as [number, number][] }];
  const first = placeComponents(C, landed);
  const again = placeComponents(C, landed, first.layout);
  const moved = Math.max(...again.P.map((p, i) => Math.hypot(p[0] - first.P[i]![0], p[1] - first.P[i]![1])));
  assert.ok(moved < 0.5, `moved ${moved}`);
  // Laid out afresh, with nothing kept, the same inputs land where they did the first time.
  assert.deepEqual(placeComponents(C, landed).P, first.P);
});

test("the keeper keeps the order in .coherence, a restart lays out from it, and a snapshot's keeper writes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-relief-layout-"));
  try {
    const files = [file("a1.ts", 10, [0, 1]), file("b1.ts", 10, [2]), file("a2.ts", 10, [0, 1]), file("b2.ts", 10, [2])];
    const first = new LayoutKeeper(root).files("src", files, landings(4)).map((f) => f.file);
    assert.deepEqual(readLayout(root)["src"]?.files, first, "kept as laid out");
    // After a restart a landing joins a1 with b2; the kept order holds, and the order sent is the order kept.
    const later = files.map((f) => (f.file === "a1.ts" || f.file === "b2.ts" ? { ...f, l: [...f.l, [3, 1] as [number, number]] } : f));
    assert.deepEqual(new LayoutKeeper(root).files("src", later, landings(4)).map((f) => f.file), first);
    // A snapshot reads what is kept and keeps nothing of its own.
    const before = readFileSync(layoutPath(root), "utf8");
    new LayoutKeeper(root, false).files("lib", files, landings(4));
    assert.equal(readFileSync(layoutPath(root), "utf8"), before);
    // A kept file of another shape is read as far as it holds: what is malformed is dropped, the rest kept.
    mkdirSync(join(root, ".coherence"), { recursive: true });
    writeFileSync(layoutPath(root), JSON.stringify({ src: { files: ["a.ts", 3], own: [1, 2] }, docs: "no", ".": { sub: [0, Number.MAX_VALUE * 2] } }));
    assert.deepEqual(readLayout(root), { src: { own: [1, 2] } });
    writeFileSync(layoutPath(root), "{ not json");
    assert.deepEqual(readLayout(root), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
