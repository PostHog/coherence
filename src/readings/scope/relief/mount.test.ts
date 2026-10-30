/**
 * The relief on a live page: a snapshot carries a newly read relief in, the
 * scene is built again only when what it draws changed (the old one disposed,
 * its view carried over), and open defects are counted from the journal the
 * page holds. The scene needs WebGL, so its maker is given here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReliefReading } from "../../relief/relief.ts";
import type { JournalRecord, ShellState } from "../model.ts";
import { mergeSnapshot } from "../updates.ts";
import { reliefData, type ReliefData } from "./data.ts";
import { filesCache, mountRelief, reliefStep } from "./mount.ts";
import { WebGLUnavailable, type Relief, type ReliefView } from "./scene.ts";

function reading(storeLines = 40): ReliefReading {
  return {
    kind: "read",
    head: "abc1234 2026-10-30",
    leftOut: [],
    stamp: `stamp-${storeLines}`,
    landings: [{ sha: "abc1234", date: "2026-10-30", subject: "land", n: 1, c: [[1, 3]] }],
    components: [
      { folder: ".", name: "root", files: 1, lines: 10, unreached: 10 },
      { folder: "src", name: "Src", files: 1, lines: 5, unreached: 5 },
      { folder: "src/lib", name: "lib/", district: true, files: 1, lines: 7, unreached: 7 },
      { folder: "src/store", name: "Store", files: 1, lines: storeLines, unreached: 0 },
    ],
  };
}

const head = (id: string, at: string) => ({ id, at, session: "s", agent: "a", commit: null, dirty: false });
const defect = (id: string, at: string, files: string[]): JournalRecord => ({ ...head(id, at), kind: "defect", what: id, evidence: "seen", files });

function stateOf(relief: ReliefReading | undefined, records: JournalRecord[] = []): ShellState {
  const state = {
    project: "fixture",
    views: [{ id: "structure", label: "Structure" }],
    activeView: "structure",
    lexicon: { query: "", layers: [] },
    spec: { components: [{ folder: "src/store", name: "Store", specPath: "src/store/Store.spec.md", intent: "Holds the records.", invariants: [] }], trustLevels: [] },
    runs: { records: [], damaged: [] },
    journal: { records, damaged: [], work: { kind: "absent", because: "none" } },
    componentInterfaces: { kind: "unread", because: "not read in this test" },
    structure: { preview: [] },
    ...(relief === undefined ? {} : { relief }),
  };
  return state as unknown as ShellState;
}

test("a snapshot carries a newly read relief into an open page", () => {
  const page = stateOf({ kind: "unread", because: "the warm server has not read it yet" });
  assert.ok("absent" in reliefData(page), "the page opened before the relief was read");
  const incoming = stateOf(reading());
  mergeSnapshot(page, incoming);
  assert.equal(page.relief, incoming.relief, "the snapshot's relief replaces the page's");
  assert.ok(!("absent" in reliefData(page)), "the Structure view now has a relief to draw");
});

test("open defects are counted from the journal the page holds, each once toward the deepest component holding one of its files", () => {
  const records: JournalRecord[] = [
    defect("df-1", "2026-10-01T00:00:00.000Z", ["src/store/store.ts", "src/store/other.ts", "src/lib/a.ts"]),
    defect("df-2", "2026-10-02T00:00:00.000Z", ["src/store/store.ts"]),
    defect("df-3", "2026-10-03T00:00:00.000Z", ["src/store/store.ts"]),
    defect("df-4", "2026-10-04T00:00:00.000Z", ["docs/x.md"]),
    defect("df-5", "2026-10-05T00:00:00.000Z", []),
    { ...head("rs-1", "2026-10-06T00:00:00.000Z"), kind: "resolution", of: "df-2", because: "fixed" },
    { ...head("rt-1", "2026-10-07T00:00:00.000Z"), kind: "retraction", of: "df-3", because: "not a defect" },
  ];
  const data = reliefData(stateOf(reading(), records)) as ReliefData;
  const counts = Object.fromEntries(data.components.map((c) => [c.folder, c.v.defects]));
  // df-1 counts once in the store and once in the lib district; a resolved or retracted defect counts nowhere; one naming no file counts nowhere.
  assert.deepEqual(counts, { ".": 1, src: 0, "src/lib": 1, "src/store": 1 });
  // The journal moves on and the counts follow, with no new reading.
  const later = reliefData(stateOf(reading(), [...records, { ...head("rs-2", "2026-10-08T00:00:00.000Z"), kind: "resolution", of: "df-1", because: "fixed" }])) as ReliefData;
  assert.deepEqual(Object.fromEntries(later.components.map((c) => [c.folder, c.v.defects])), { ".": 1, src: 0, "src/lib": 0, "src/store": 0 });
});

test("the relief is built again only when what it draws changed, the old scene disposed and its view carried over", () => {
  const view = { scope: "src", camera: { view: "top", position: [1, 2, 3], target: [0, 0, 0] } } as unknown as ReliefView;
  const made: { data: ReliefData; carried: ReliefView | undefined; disposed: number }[] = [];
  const create = (data: ReliefData, _io: unknown, carried?: ReliefView): Relief => {
    const entry = { data, carried, disposed: 0 };
    made.push(entry);
    return { root: { parentElement: null } as unknown as HTMLElement, resume() {}, touch() {}, view: () => view, dispose: () => void (entry.disposed += 1) };
  };
  const host = { replaceChildren(child: { parentElement: unknown }) { child.parentElement = host; } };
  const root = { querySelector: () => host } as unknown as HTMLElement;

  const page = stateOf(reading());
  mountRelief(root, page, {}, create);
  assert.equal(made.length, 1, "the first render builds the scene");
  mountRelief(root, page, {}, create);
  assert.equal(reliefStep(undefined, page).kind, "build", "with nothing built, a render builds");

  // A spec edit's snapshot replaces the spec, the interfaces and the relief with equal ones: nothing drawn changed.
  mergeSnapshot(page, structuredClone(stateOf(reading())));
  mountRelief(root, page, {}, create);
  assert.equal(made.length, 1, "an unchanged drawing keeps the scene");
  assert.equal(made[0]!.disposed, 0);

  // A landed change moves the lines the relief draws.
  mergeSnapshot(page, stateOf(reading(55)));
  mountRelief(root, page, {}, create);
  assert.equal(made.length, 2, "a changed drawing builds the scene again");
  assert.equal(made[0]!.disposed, 1, "the old scene is disposed");
  assert.equal(made[1]!.carried, view, "the new scene opens on the old one's view");

  // A relief that can no longer be read leaves nothing alive.
  mergeSnapshot(page, stateOf({ kind: "unread", because: "mass could not be read" }));
  mountRelief(root, page, {}, create);
  assert.equal(made[1]!.disposed, 1, "the scene is disposed when there is nothing to draw");
});

test("the page fetches a folder's files once per reading, again after a reread changed the reading, and again after a fetch failed", async () => {
  const asked: string[][] = [];
  let stamp = "one";
  let failing = false;
  const get = async (path: string): Promise<unknown> => {
    const url = new URL(path, "http://scope");
    assert.equal(url.pathname, "/api/relief/files");
    const folders = url.searchParams.getAll("folder");
    asked.push(folders);
    if (failing) throw new Error("the server went away");
    return { stamp, folders: Object.fromEntries(folders.map((folder) => [folder, [{ file: `${folder}/a.ts`, lines: stamp.length, reached: 0 }]])) };
  };
  const files = filesCache(get);
  assert.deepEqual(Object.keys(await files("one", ["src", "src/store"])), ["src", "src/store"]);
  assert.deepEqual(asked, [["src", "src/store"]], "one fetch carries every folder asked for at once");
  await Promise.all([files("one", ["src"]), files("one", ["src/store", "src"])]);
  assert.equal(asked.length, 1, "a folder fetched under the same reading is never fetched again");
  await files("one", ["src", "."]);
  assert.deepEqual(asked.at(-1), ["."], "only the folder not yet fetched goes out");

  // A reread that changed the reading gives the scene built from it another stamp: everything fetched under the last is dropped.
  stamp = "three";
  const again = await files("three", ["src"]);
  assert.deepEqual(asked.at(-1), ["src"], "the folder is fetched again under the new reading");
  assert.equal(again["src"]![0]!.lines, 5);

  // An answer from another reading belongs to it, and a failed fetch is forgotten: both answer nothing, and the next ask fetches again.
  assert.deepEqual(await files("four", ["src"]), {}, "an answer stamped by another reading is no answer");
  failing = true;
  assert.deepEqual(await files("four", ["src"]), {}, "a failed fetch answers nothing");
  failing = false;
  stamp = "four";
  const before = asked.length;
  assert.deepEqual(Object.keys(await files("four", ["src"])), ["src"]);
  assert.equal(asked.length, before + 1, "and the next ask fetches it again");

  // Hundreds of folders go out in several fetches, each address short enough for any server.
  const many = Array.from({ length: 400 }, (_, i) => `products/a-rather-long-product-name-${i}/frontend`);
  assert.equal(Object.keys(await files("four", many)).length, 400);
  const batches = asked.slice(before + 1);
  assert.ok(batches.length > 1 && batches.every((b) => b.map((f) => `folder=${encodeURIComponent(f)}&`).join("").length <= 4000), `${batches.length} fetches, each short`);
});

test("a relief that cannot be built gets a line in its place saying why, blaming WebGL only when the browser could not start it, the page standing, and no second try until what it draws changes", () => {
  let tries = 0;
  const create = (): Relief => {
    tries += 1;
    throw new WebGLUnavailable("Error creating WebGL context");
  };
  const said: { className: string; textContent: string }[] = [];
  const host = {
    ownerDocument: { createElement: () => ({ className: "", textContent: "" }) },
    replaceChildren(line: { className: string; textContent: string }) { said.push(line); },
  };
  const root = { querySelector: () => host } as unknown as HTMLElement;
  const page = stateOf(reading());
  assert.doesNotThrow(() => mountRelief(root, page, {}, create), "the failure stays in the relief's host");
  assert.equal(said.at(-1)?.className, "absence");
  assert.match(said.at(-1)!.textContent, /relief could not be drawn in this browser: Error creating WebGL context\. It needs WebGL; every other view works without it/);
  mountRelief(root, page, {}, create);
  mergeSnapshot(page, structuredClone(stateOf(reading())));
  mountRelief(root, page, {}, create);
  assert.equal(tries, 1, "an unchanged drawing does not try the browser again");
  assert.equal(said.length, 3, "and every render still says why");
  mergeSnapshot(page, stateOf(reading(55)));
  mountRelief(root, page, {}, create);
  assert.equal(tries, 2, "a changed drawing tries again");
  // Nothing to draw clears the failure with the scene.
  mergeSnapshot(page, stateOf({ kind: "unread", because: "mass could not be read" }));
  mountRelief(root, page, {}, create);

  // A scene that fails on its data is the relief's failure, not the browser's: said with its error, WebGL never blamed.
  const failing = (): Relief => {
    throw new TypeError("Cannot read properties of undefined (reading 'date')");
  };
  mergeSnapshot(page, stateOf(reading(77)));
  assert.doesNotThrow(() => mountRelief(root, page, {}, failing), "the failure stays in the relief's host");
  assert.equal(said.at(-1)?.className, "absence");
  assert.equal(said.at(-1)!.textContent, "The relief failed while it was built: Cannot read properties of undefined (reading 'date'). Every other view works without it, and Connections shows how the components connect.");
  assert.doesNotMatch(said.at(-1)!.textContent, /WebGL|in this browser/, "a failure of the relief's own is never put on the browser");
  mergeSnapshot(page, stateOf({ kind: "unread", because: "mass could not be read" }));
  mountRelief(root, page, {}, failing);
});

test("a project with no commits has a relief to draw: every component's footprint, no landing, and the snapshot empty", () => {
  const unborn: ReliefReading = { ...(reading() as Extract<ReliefReading, { kind: "read" }>), head: "", landings: [] };
  const data = reliefData(stateOf(unborn));
  assert.ok(!("absent" in data), "no commit is no reason to draw nothing: the footprints stand");
  assert.deepEqual(data.landings, []);
  assert.equal(data.snapshot, "");
  assert.deepEqual(data.components.map((c) => c.v.lines), [10, 5, 7, 40]);
});
