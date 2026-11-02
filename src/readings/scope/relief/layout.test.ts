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
import { fileOrder, MOVES_PER_LANDING, placeComponents } from "./layout.ts";
import { LayoutKeeper, layoutPath, readLayout, writeLayout } from "./layout-store.ts";
import type { ReliefReading } from "../../relief/relief.ts";
import type { ShellState } from "../model.ts";

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
  // A landing now joins d with a: unseeded, that could pull d beside a; seeded, with no landing new to the order, d stays where the reader learned it.
  const files = [file("a.ts", 10, [0, 9]), file("b.ts", 10, [1]), file("d.ts", 10, [2, 9]), file("new.ts", 5, [1]), file("lone.ts", 5, [])];
  assert.deepEqual(fileOrder(files, landings(10), kept), ["a.ts", "b.ts", "new.ts", "d.ts", "lone.ts"]);
  // A path kept twice is kept once.
  assert.deepEqual(fileOrder(files, landings(10), [...kept, "a.ts"]), ["a.ts", "b.ts", "new.ts", "d.ts", "lone.ts"]);
});

test("each new landing moves a few of the files it touched beside the file each now lands with most, and nothing else", () => {
  const kept = ["a.ts", "b.ts", "new.ts", "d.ts", "lone.ts"];
  const files = [file("a.ts", 10, [0, 9]), file("b.ts", 10, [1]), file("d.ts", 10, [2, 9]), file("new.ts", 5, [1]), file("lone.ts", 5, [])];
  // Landing 9 is new to the order: a now lands with d and shares nothing with its neighbour, so a, the first it touched, moves beside d.
  assert.deepEqual(fileOrder(files, landings(10), kept, new Set([9])), ["b.ts", "new.ts", "d.ts", "a.ts", "lone.ts"]);
  // A landing that touched b only moves nothing: b already stands beside new.ts, the file it lands with most.
  assert.deepEqual(fileOrder(files, landings(10), kept, new Set([1])), kept);
  // One landing moves at most MOVES_PER_LANDING files, however many it pulled away from their neighbours: ten x files that
  // land together stand each between two y files that never land; the fewest moves that turn one order into another is
  // its length less the longest run it keeps in order.
  const xs = Array.from({ length: 10 }, (_, i) => file(`x${i}.ts`, 10, [0]));
  const ys = Array.from({ length: 11 }, (_, i) => file(`y${i}.ts`, 10, []));
  const order = ys.flatMap((y, i) => (i < xs.length ? [y.file, xs[i]!.file] : [y.file]));
  const movesBetween = (from: string[], to: string[]) => {
    const rank = to.map((f) => from.indexOf(f)), tails: number[] = [];
    for (const r of rank) { let lo = 0, hi = tails.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid]! < r) lo = mid + 1; else hi = mid; } tails[lo] = r; }
    return from.length - tails.length;
  };
  const one = fileOrder([...xs, ...ys], landings(2, 10), order, new Set([0]));
  assert.equal(new Set(one).size, order.length, "every file once");
  assert.equal(movesBetween(order, one), MOVES_PER_LANDING, "one landing moves its share, and no more");
  // Two landings, each its own ten, move a share each: a budget never pools across landings.
  const zs = Array.from({ length: 10 }, (_, i) => file(`z${i}.ts`, 10, [1]));
  const both = [...order, ...zs.flatMap((z, i) => [z.file, `w${i}.ts`])];
  const ws = Array.from({ length: 10 }, (_, i) => file(`w${i}.ts`, 10, []));
  const two = fileOrder([...xs, ...ys, ...zs, ...ws], landings(2, 10), both, new Set([0, 1]));
  assert.equal(movesBetween(both.filter((f) => f.startsWith("x") || f.startsWith("y")), two.filter((f) => f.startsWith("x") || f.startsWith("y"))), MOVES_PER_LANDING);
  assert.equal(movesBetween(both.filter((f) => f.startsWith("z") || f.startsWith("w")), two.filter((f) => f.startsWith("z") || f.startsWith("w"))), MOVES_PER_LANDING);
  // A kept order that holds fewer than half the files is another checkout's: the files are laid out afresh, by co-change.
  assert.deepEqual(fileOrder(files, landings(10), ["a.ts", "gone1.ts", "gone2.ts"]), fileOrder(files, landings(10)));
});

test("thousands of files are ordered in well under a second, with no square table, and thousands new to a kept order are put in as fast", () => {
  const N = 4000, L = 1500;
  const files = Array.from({ length: N }, (_, i) => file(`f${i}.ts`, 10 + (i % 300), [(i * 7) % L, (i * 7 + 131) % L, (i * 7 + 262) % L]));
  let start = performance.now();
  const order = fileOrder(files, landings(L, 10));
  assert.equal(new Set(order).size, N);
  assert.ok(performance.now() - start < 1000, `ordered in ${Math.round(performance.now() - start)} ms`);
  // Half of them kept, half new to the order, each new file landing twenty times with others.
  const dense = Array.from({ length: N }, (_, i) => file(`g${i}.ts`, 10, Array.from({ length: 20 }, (_, k) => (i * 3 + k * 97) % L)));
  start = performance.now();
  const seededOrder = fileOrder(dense, landings(L, 10), dense.slice(0, N / 2).map((f) => f.file), new Set([0, 1, 2]));
  assert.equal(new Set(seededOrder).size, N);
  assert.ok(performance.now() - start < 1000, `put in order in ${Math.round(performance.now() - start)} ms`);
});

test("components held stand exactly where they were kept however often they are placed again, and a nudge moves them no more than a hair", () => {
  const C = [
    { folder: ".", v: { lines: 100 } },
    { folder: "src", v: { lines: 400 } },
    { folder: "src/a", v: { lines: 300 } },
    { folder: "src/b", v: { lines: 200 } },
    { folder: "docs", v: { lines: 50 } },
  ];
  const landed = [{ n: 2, c: [[2, 1], [3, 1]] as [number, number][] }, { n: 2, c: [[1, 1], [4, 1]] as [number, number][] }];
  const first = placeComponents(C, landed);
  const once = placeComponents(C, landed, first.layout);
  assert.deepEqual(once.layout, first.layout, "placed from its own places, to the digit");
  let held = once;
  for (let i = 0; i < 400; i++) held = placeComponents(C, landed, held.layout);
  assert.deepEqual(held.layout, first.layout, "400 placements later, to the digit");
  assert.deepEqual(held.P, once.P);
  // A nudge by landing 0, which touched src/a and src/b, moves what it touched a hair and leaves docs, which it did not touch, to the digit.
  const nudged = placeComponents(C, landed, first.layout, new Set([0]));
  const moved = Math.max(...nudged.P.map((p, i) => Math.hypot(p[0] - first.P[i]![0], p[1] - first.P[i]![1])));
  assert.ok(moved < 0.5, `moved ${moved}`);
  assert.deepEqual(nudged.layout["docs"], first.layout["docs"]);
  // A landing that touched nothing moves nothing, however many land.
  let quiet = first;
  const busy = [...landed, ...Array.from({ length: 200 }, () => ({ n: 1, c: [] as [number, number][] }))];
  for (let i = 0; i < 200; i++) quiet = placeComponents(C, busy, quiet.layout, new Set([landed.length + i]));
  assert.deepEqual(quiet.layout, first.layout);
  // Laid out afresh, with nothing kept, the same inputs land where they did the first time.
  assert.deepEqual(placeComponents(C, landed).P, first.P);
  // A new component is placed beside what it lands with; what was kept stays put, its platform only centred again round the newcomer.
  const grown = [...C, { folder: "src/c", v: { lines: 80 } }];
  const withNew = placeComponents(grown, [...landed, { n: 2, c: [[5, 1], [2, 1]] }], first.layout);
  const offset = (l: typeof first.layout, x: string, y: string) => [l[x]!.sub![0]! - l[y]!.sub![0]!, l[x]!.sub![1]! - l[y]!.sub![1]!];
  const [dx, dz] = offset(withNew.layout, "src/a", "src/b"), [kx, kz] = offset(first.layout, "src/a", "src/b");
  assert.ok(Math.abs(dx! - kx!) < 0.01 && Math.abs(dz! - kz!) < 0.01, "src/a and src/b keep where they stand to each other");
  assert.deepEqual(withNew.layout["docs"]!.sub, first.layout["docs"]!.sub, "a platform the newcomer is not on is untouched");
  // A place kept on another platform is no place for it: src/a kept on the ground is placed again on src.
  const moved2 = placeComponents(C, landed, { ...first.layout, "src/a": { sub: [500, 500], on: "" } });
  assert.ok(Math.abs(moved2.layout["src/a"]!.sub![0]!) < 100, "placed on its platform, not 500 away");
});

/** The least of a state the relief's data reads: a read relief of three components, no spec, runs, records or interfaces. */
function stateOf(landings: { n: number; c: [number, number][] }[]): ShellState {
  const relief: ReliefReading = {
    kind: "read", head: "abc1234 2026-11-02", leftOut: [], stamp: `stamp-${landings.length}`,
    // Newest first, as the relief reads them: the oldest keeps its sha as more land.
    landings: landings.map((l, i) => ({ sha: `s${landings.length - 1 - i}`, date: "2026-11-02", subject: "land", ...l })),
    components: [{ folder: ".", name: "root", files: 4, lines: 100, unreached: 0 }, { folder: "src", name: "Src", files: 4, lines: 400, unreached: 0 }, { folder: "docs", name: "Docs", files: 1, lines: 50, unreached: 0 }],
  };
  return { project: "p", spec: { components: [], trustLevels: [] }, runs: { records: [], damaged: [] }, journal: { records: [], damaged: [], work: { kind: "absent", because: "none" } }, componentInterfaces: { kind: "unread", because: "test" }, relief } as unknown as ShellState;
}

test("the relief's layout is kept in .coherence and laid out from: files keep their order through a landing and a restart, components their places, and a snapshot writes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-relief-layout-"));
  try {
    const lands = (count: number) => Array.from({ length: count }, (_, i) => ({ n: 3, sha: `s${count - 1 - i}` }));
    const files = [file("src/a1.ts", 10, [0, 1]), file("src/b1.ts", 10, [2]), file("src/a2.ts", 10, [0, 1]), file("src/b2.ts", 10, [2])];
    const keeper = new LayoutKeeper(root);
    const first = keeper.files("src", files, lands(4)).map((f) => f.file);
    assert.equal(readLayout(root).folders["src"], undefined, "nothing is written until the request's flush");
    keeper.flush();
    assert.deepEqual(readLayout(root).folders["src"]?.files, first, "kept as laid out");
    // After a restart b1 is gone and new.ts lands with a1 and a2, with no landing new to the order: the kept order holds around them.
    const later = [...files.filter((f) => f.file !== "src/b1.ts"), file("src/new.ts", 5, [0])];
    const expected = first.filter((f) => f !== "src/b1.ts");
    expected.splice(expected.indexOf("src/a1.ts") + 1, 0, "src/new.ts");
    const restarted = new LayoutKeeper(root);
    assert.deepEqual(restarted.files("src", later, lands(4)).map((f) => f.file), expected);
    restarted.flush();
    assert.deepEqual(readLayout(root).folders["src"]?.files, expected, "the order sent is the order kept");
    // Components: placed and kept; placed again from new objects of the same content, by the same keeper and after a restart, they stand to the digit and nothing is written.
    const placed = new LayoutKeeper(root).components(stateOf([{ n: 2, c: [[1, 1], [2, 1]] }, { n: 1, c: [[0, 1]] }]))!;
    assert.deepEqual(readLayout(root).folders["docs"]?.sub, placed["docs"]?.sub, "the places are kept");
    const text = readFileSync(layoutPath(root), "utf8");
    const again = new LayoutKeeper(root);
    for (let i = 0; i < 50; i++) assert.deepEqual(again.components(stateOf([{ n: 2, c: [[1, 1], [2, 1]] }, { n: 1, c: [[0, 1]] }])), placed, "rebuilt, they stand where they were kept");
    assert.equal(readFileSync(layoutPath(root), "utf8"), text, "and nothing is written");
    // A checkout to a branch whose landings the places were not laid out against is no landing: nothing moves.
    const branch = stateOf([{ n: 2, c: [[1, 1], [2, 1]] }, { n: 1, c: [[0, 1]] }]);
    if (branch.relief?.kind === "read") branch.relief.landings = branch.relief.landings.map((l, i) => ({ ...l, sha: `b${i}` }));
    assert.deepEqual(new LayoutKeeper(root).components(branch), placed, "a checkout moves nothing");
    // Back on the branch kept, one more landing nudges what it touched, docs, a hair, and nothing else; the files' order is untouched by it.
    writeFileSync(layoutPath(root), text);
    const nudged = new LayoutKeeper(root).components(stateOf([{ n: 1, c: [[2, 1]] }, { n: 2, c: [[1, 1], [2, 1]] }, { n: 1, c: [[0, 1]] }]))!;
    const [a, b] = [placed["docs"]!.sub!, nudged["docs"]!.sub!];
    assert.ok(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 0.5, `docs stayed close: ${a} then ${b}`);
    assert.deepEqual(nudged["src"], placed["src"], "what the landing did not touch stands to the digit");
    assert.equal(readLayout(root).at, "s2", "laid out against the newest landing");
    assert.deepEqual(readLayout(root).folders["src"]?.files, expected, "placing components keeps the files' order");
    // A snapshot reads what is kept and keeps nothing of its own.
    const before = readFileSync(layoutPath(root), "utf8");
    const snapshot = new LayoutKeeper(root, false);
    assert.deepEqual(snapshot.files("src", later, lands(4)).map((f) => f.file), expected, "a snapshot's files stand in the order kept");
    snapshot.files("lib", files, lands(4));
    assert.deepEqual(snapshot.components(stateOf([{ n: 1, c: [[2, 1]] }, { n: 2, c: [[1, 1], [2, 1]] }, { n: 1, c: [[0, 1]] }])), nudged, "and its components where they were kept");
    snapshot.flush();
    assert.equal(readFileSync(layoutPath(root), "utf8"), before);
    // One request's folders are kept in one write, and a request that changes nothing writes nothing.
    let writes = 0;
    const counted = new LayoutKeeper(root, true, () => {}, (r, l) => { writes++; writeLayout(r, l); });
    counted.files("lib", files, lands(4));
    counted.files("tests", files, lands(4));
    counted.flush();
    counted.files("lib", files, lands(4));
    counted.flush();
    assert.equal(writes, 1);
    // Removing the kept file resets the layout: the keeper reads it again and lays the components out afresh.
    rmSync(layoutPath(root));
    const reset = counted.components(stateOf([{ n: 1, c: [[2, 1]] }, { n: 2, c: [[1, 1], [2, 1]] }, { n: 1, c: [[0, 1]] }]))!;
    assert.deepEqual(reset, new LayoutKeeper(join(root, "elsewhere"), false).components(stateOf([{ n: 1, c: [[2, 1]] }, { n: 2, c: [[1, 1], [2, 1]] }, { n: 1, c: [[0, 1]] }])), "laid out afresh");
    assert.equal(readLayout(root).folders["lib"], undefined, "with nothing of what was removed");
    // A kept file of another shape is read as far as it holds: what is malformed is dropped, a path kept twice is kept once, the rest kept.
    mkdirSync(join(root, ".coherence"), { recursive: true });
    writeFileSync(layoutPath(root), JSON.stringify({ at: 3, folders: { src: { files: ["a.ts", 3], own: [1, 2] }, lib: { files: ["x.ts", "x.ts"], filesAt: "s1" }, docs: "no", ".": { sub: [0, Number.MAX_VALUE * 2], on: "" }, tests: { sub: [1, 1] } } }));
    assert.deepEqual(readLayout(root), { folders: { src: { own: [1, 2] }, lib: { files: ["x.ts"], filesAt: "s1" } } });
    writeFileSync(layoutPath(root), "{ not json");
    assert.deepEqual(readLayout(root), { folders: {} });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
