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
import { mountRelief, reliefStep } from "./mount.ts";
import type { Relief, ReliefView } from "./scene.ts";

function reading(storeLines = 40): ReliefReading {
  return {
    kind: "read",
    head: "abc1234 2026-10-30",
    leftOut: [],
    landings: [{ sha: "abc1234", date: "2026-10-30", subject: "land", n: 1, c: [[1, 3]], f: [[1, 0, 3]] }],
    components: [
      { folder: ".", name: "root", files: [{ file: "cli.ts", lines: 10, reached: 0 }], lines: 10, unreached: 10 },
      { folder: "src", name: "Src", files: [{ file: "src/main.ts", lines: 5, reached: 0 }], lines: 5, unreached: 5 },
      { folder: "src/lib", name: "lib/", district: true, files: [{ file: "src/lib/a.ts", lines: 7, reached: 0 }], lines: 7, unreached: 7 },
      { folder: "src/store", name: "Store", files: [{ file: "src/store/store.ts", lines: storeLines, reached: 1 }], lines: storeLines, unreached: 0 },
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
