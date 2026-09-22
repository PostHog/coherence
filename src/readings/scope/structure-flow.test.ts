/**
 * The Structure map check: every component interface on the map from caller
 * to callee, annotated from the invariants; structural routes, one colored
 * path each in component order; core dependencies as rails with stubs;
 * interface identifiers and trust boundaries; no text overlapped, truncated
 * or clipped; every segment at 0, 45 or 90 degrees; stable positions;
 * entrances declared and checked, zoom, selection, determinism, the text
 * form, the comparison seam, and one selection per reviewer question.
 *
 * The synthetic project: the root CLI dispatches into the hooks, the hooks
 * call the core, the core writes the store and appends to the journal, and a
 * reader calls the core, the store and the journal the way Scope reads
 * everything. The store's single writer has a chokepoint, write, with a
 * crossing from outside to inside; the journal's append has one from inside
 * to record.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { COHERENCE_GLOSSARY } from "../../lifecycle/project.ts";
import { loadSpecModel } from "../../spec/model.ts";
import { answer, answerStructure } from "../query/query.ts";
import { buildScopePage } from "./build.ts";
import { makeFixture, type Fixture } from "./check-fixture.ts";
import { readComponentInterfaces } from "./component-interfaces.ts";
import { flowChokepointId, flowLevelId, relianceId, resolveHash, structureId } from "./derive.ts";
import type { InterfaceReading, InterfaceSymbol, RecordedSite, RunEntry, ShellState, SpecComponent, SpecEntrance, SpecInvariant } from "./model.ts";
import { renderView } from "./shell.ts";
import { CORE_RULE, FLOW_CHANGE_ID, FLOW_NONE_ID, compareFlows, flowDefaultSelection, flowEdgeId, flowEntranceId, flowKeyAction, flowLabelLines, flowNodeId, flowOf, flowSelected, flowSelection, type FlowModel } from "./structure-flow.ts";
import { flowLayout, renderFlowSvg } from "./structure-flow-view.ts";
import { measureSvg } from "./structure-measure.ts";

let fixture: Fixture;
let base: ShellState;

before(async () => {
  fixture = makeFixture();
  ({ state: base } = await buildScopePage({ root: fixture.root, glossaryPath: COHERENCE_GLOSSARY, project: "Flow" }));
});

after(() => fixture.remove());

interface Declared {
  folder: string;
  name: string;
  parent?: string;
  entrances?: { name: string; handler: string; file: string }[];
  invariants: { name: string; chokepoint: string; protects: string; crossing?: [string, string]; state?: SpecInvariant["state"] }[];
}

const PROJECT: Declared[] = [
  { folder: ".", name: "Flow", entrances: [{ name: "run", handler: "runHooks in src/hooks/run.ts", file: "src/hooks/run.ts" }, { name: "stray", handler: "stray in src/store/stray.ts", file: "src/store/stray.ts" }], invariants: [] },
  { folder: "src/core", name: "Core", invariants: [{ name: "one door", chokepoint: "door", protects: "inner" }] },
  { folder: "src/hooks", name: "Hooks", invariants: [] },
  { folder: "src/journal", name: "Journal", invariants: [{ name: "append-only store", chokepoint: "append", protects: "appendLine", crossing: ["inside", "record"] }] },
  { folder: "src/reader", name: "Reader", invariants: [] },
  { folder: "src/store", name: "Store", invariants: [{ name: "single writer", chokepoint: "write", protects: "writeRow", crossing: ["outside", "inside"] }] },
  { folder: "src/store/cache", name: "Cache", parent: "src/store", invariants: [] },
];

function sym(from: string, to: string, symbol: string, file: string, sites = 1): InterfaceSymbol {
  return { from, to, symbol, file, sites };
}

/** The references the language adapter would resolve in the synthetic project. */
const SYMBOLS: InterfaceSymbol[] = [
  sym(".", "src/hooks", "runHooks", "src/hooks/run.ts", 2),
  sym("src/hooks", "src/core", "door", "src/core/door.ts", 3),
  sym("src/core", "src/store", "write", "src/store/write.ts", 4),
  sym("src/core", "src/store", "Row", "src/store/row.ts", 2),
  sym("src/core", "src/journal", "append", "src/journal/append.ts", 2),
  sym("src/reader", "src/core", "door", "src/core/door.ts"),
  sym("src/reader", "src/store", "Row", "src/store/row.ts", 5),
  sym("src/reader", "src/journal", "JournalRecord", "src/journal/types.ts", 3),
  sym("src/reader", "src/journal", "loadJournal", "src/journal/load.ts", 1),
  sym("src/store/cache", "src/journal", "append", "src/journal/append.ts"),
];

function reading(symbols: InterfaceSymbol[] = SYMBOLS): InterfaceReading {
  return { kind: "read", language: "typescript", declarations: 12, symbols, entrances: [{ component: ".", name: "run", file: "src/hooks/run.ts" }, { component: ".", name: "stray", file: "src/store/stray.ts" }], unowned: { files: 1, lines: 40 } };
}

function projectState(options: { symbols?: InterfaceSymbol[]; unread?: boolean; sites?: Record<string, RecordedSite[]>; bypasses?: Record<string, RunEntry["bypasses"]>; states?: Record<string, SpecInvariant["state"]> } = {}): ShellState {
  const state = structuredClone(base);
  state.spec.trustLevels = [{ name: "outside", meaning: "a caller beyond the store" }, { name: "inside", meaning: "the store's own code" }, { name: "record", meaning: "the durable journal" }];
  state.spec.components = PROJECT.map((declared): SpecComponent => ({
    folder: declared.folder,
    name: declared.name,
    specPath: `${declared.folder}/${declared.name}.spec.md`,
    intent: `${declared.name} does its one thing.`,
    trustLevels: undefined,
    entrances: (declared.entrances ?? []).map((e, i): SpecEntrance => ({ name: e.name, meaning: `${e.name} enters`, handler: e.handler, line: 3 + i, handlerLine: 4 + i, component: declared.folder, file: e.file })),
    parent: declared.parent ?? (declared.folder === "." ? undefined : "."),
    children: PROJECT.filter((p) => (p.parent ?? (p.folder === "." ? undefined : ".")) === declared.folder).map((p) => p.folder),
    invariants: declared.invariants.map((inv, index): SpecInvariant => ({
      name: inv.name,
      sentence: `${inv.name}.`,
      line: 5 + index,
      enforcements: [{ form: "chokepoint", chokepoint: inv.chokepoint, protects: inv.protects, line: 6 + index }],
      because: "the fixture says so",
      crossing: inv.crossing === undefined ? undefined : { from: inv.crossing[0], to: inv.crossing[1], line: 7 },
      refutations: [],
      kinds: "none",
      checklist: [],
      unfilled: [],
      component: declared.folder,
      applicable: [],
      missingShapes: [],
      state: options.states?.[inv.name] ?? "invariant",
      lacks: [],
    })),
  }));
  const entries: RunEntry[] = state.spec.components.flatMap((component) =>
    component.invariants.map((inv): RunEntry => {
      const bypasses = options.bypasses?.[inv.name] ?? [];
      const sites = options.sites?.[inv.name];
      return {
        component: component.folder,
        name: inv.name,
        form: "chokepoint",
        verdict: bypasses.length > 0 ? "fail" : "pass",
        grade: bypasses.length > 0 ? "broken" : "reference-choked",
        refutation: "automatic",
        bypasses,
        ...(sites === undefined ? {} : { sites }),
        testReferences: 0,
        files: [],
        latency: 1,
        reason: "fixture",
      };
    }),
  );
  state.runs.records = [{ at: "2026-09-20T10:00:00.000Z", session: "s-flow", agent: "fixture", commit: "abc1234", dirty: false, instrument: { language: "typescript", server: "warm" }, latency: 1, invariants: entries }];
  state.componentInterfaces = options.unread === true ? { kind: "unread", because: "no instrument was asked" } : reading(options.symbols);
  state.structure.preview = [];
  state.activeView = "structure";
  return state;
}

function pairs(state: ShellState): string[] {
  return flowOf(state).edges.map((edge) => `${edge.from} -> ${edge.to}`);
}

test("every component interface is on the map, caller to callee, and none is implied away", () => {
  const drawn = pairs(projectState());
  for (const expected of [". -> src/hooks", "src/hooks -> src/core", "src/core -> src/store", "src/core -> src/journal", "src/reader -> src/core", "src/reader -> src/store", "src/reader -> src/journal", "src/store -> src/journal"]) {
    assert.ok(drawn.includes(expected), `${expected} is in the model`);
  }
  assert.ok(drawn.includes("src/reader -> src/journal") && drawn.includes("src/reader -> src/core") && drawn.includes("src/core -> src/journal"), "an interface a path of others implies is still there: it is a real surface");
  assert.ok(!drawn.includes("src/store -> src/reader") && !drawn.includes("src/core -> src/hooks"), "interfaces run from caller to callee only");
  const model = flowOf(projectState());
  const rest = renderFlowSvg(model, undefined).text;
  for (const edge of model.edges) {
    const onMap = edge.routes.length > 0 || edge.stub || (edge.loadBearing && rest.includes(`data-edge="${edge.id}"`));
    const selectedCaller = renderFlowSvg(model, flowNodeId(edge.from)).text;
    assert.ok(onMap || selectedCaller.includes(`data-edge="${edge.id}"`), `${edge.id} is on a route, a stub, load-bearing at rest, or drawn when its caller is selected`);
    assert.ok(renderFlowSvg(model, edge.id).text.includes(edge.stub ? `data-stub="${edge.id}"` : edge.routes.length > 0 ? `data-edges="` : `data-edge="${edge.id}"`), `${edge.id} is drawn when it is selected`);
  }
});

test("a component interface is annotated from the invariants: its chokepoint, its crossing, the data that passes; a plain one by its most-referenced symbols, never a verb", () => {
  const model = flowOf(projectState());
  const store = model.edges.find((edge) => edge.id === flowEdgeId("src/core", "src/store"))!;
  assert.deepEqual(store.chokepoints.map((c) => c.name), ["single writer"]);
  assert.deepEqual(store.levels, ["outside", "inside"]);
  assert.deepEqual(flowLabelLines(store).map((line) => line.text), ["chokepoint write", "outside → inside"], "the chokepoint first, then the crossing");
  assert.ok(store.loadBearing);
  const plain = model.edges.find((edge) => edge.id === flowEdgeId("src/reader", "src/journal"))!;
  assert.equal(plain.loadBearing, false);
  assert.deepEqual(flowLabelLines(plain).map((line) => line.text), ["JournalRecord, loadJournal"], "most-referenced first");
  const readerStore = model.edges.find((edge) => edge.id === flowEdgeId("src/reader", "src/store"))!;
  assert.equal(readerStore.chokepoints.length, 0, "Row is referenced, write is not: no chokepoint stands on the reader's interface to the store");
  for (const edge of model.edges) {
    for (const line of flowLabelLines(edge)) assert.doesNotMatch(line.text, /\b(calls|uses|consumes|depends|reads|writes)\b/, `${edge.id}: no verb in "${line.text}"`);
  }
});

/** Every selection the map offers: at rest, each entrance, route, trust level, chokepoint, component and interface. */
function everySelection(model: FlowModel): (string | undefined)[] {
  return [undefined, ...model.entrances.map((e) => e.id), ...model.routes.map((r) => r.id), ...model.levels.map((l) => l.id), ...model.chokepoints.map((c) => c.id), ...model.nodes.map((n) => n.id), ...model.edges.map((e) => e.id)];
}

/** A wider synthetic project: twelve components, long names, a hub most others call, and a dense web between them. */
function crowdedState(): ShellState {
  const state = projectState();
  const names = ["Gateway", "Authorization", "Sessions", "Scheduler", "Notifications", "Billing", "Accounts", "Search", "Indexer", "Storage", "Telemetry", "Configuration"];
  const folders = names.map((name) => `src/${name.toLowerCase()}`);
  state.spec.components = [".", ...folders].map((folder, index): SpecComponent => ({
    folder,
    name: index === 0 ? "Crowd" : names[index - 1]!,
    specPath: `${folder}/X.spec.md`,
    intent: "crowded",
    trustLevels: undefined,
    entrances: index === 0
      ? ["serve", "sync", "report", "index"].map((name, i): SpecEntrance => ({ name, meaning: name, handler: `h${i} in ${folders[i * 2]}/h.ts`, line: 3 + i, handlerLine: 4 + i, component: ".", file: `${folders[i * 2]}/h.ts` }))
      : [],
    parent: index === 0 ? undefined : ".",
    children: index === 0 ? folders : [],
    // Every component guards its step-1 symbol and its step-5 symbol, half of them across a trust boundary: identifiers crowd every route.
    invariants: index === 0
      ? []
      : ["s1", "s5", "put"].map((chokepoint, k): SpecInvariant => ({ name: `${chokepoint} guard ${index}`, sentence: "guarded.", line: 5 + k, enforcements: [{ form: "chokepoint", chokepoint: `${chokepoint} in ${folder}/x.ts`, protects: `raw${k}`, line: 6 + k }], because: "x", crossing: (index + k) % 2 === 0 ? { from: "outside", to: "inside", line: 7 } : undefined, refutations: [], kinds: "none", checklist: [], unfilled: [], component: folder, applicable: [], missingShapes: [], state: "invariant", lacks: [] })),
  }));
  const symbols: InterfaceSymbol[] = [];
  folders.forEach((from, i) => {
    symbols.push(sym(from, "src/configuration", "config", "src/configuration/c.ts", 2));
    for (const step of [1, 2, 5]) {
      const to = folders[(i + step) % (folders.length - 1)]!;
      if (to !== from) symbols.push(sym(from, to, step === 2 ? "put" : `s${step}`, `${to}/x.ts`, 1 + ((i * step) % 5)));
    }
  });
  for (let i = 0; i < 4; i++) symbols.push(sym(".", folders[i * 2]!, `h${i}`, `${folders[i * 2]}/h.ts`, 3));
  state.componentInterfaces = { kind: "read", language: "typescript", declarations: 40, symbols, entrances: [0, 1, 2, 3].map((i) => ({ component: ".", name: ["serve", "sync", "report", "index"][i]!, file: `${folders[i * 2]}/h.ts` })), unowned: { files: 0, lines: 0 } };
  // Three components carry broken chokepoints: a defect mark beside each, and a broken tag on each bypassed interface.
  const broken = [1, 4, 7].map((index) => ({ folder: folders[index]!, caller: folders[(index + 3) % folders.length]! }));
  state.runs.records = [{ at: "2026-09-20T10:00:00.000Z", session: "s-crowd", agent: "fixture", commit: "abc1234", dirty: false, instrument: { language: "typescript", server: "warm" }, latency: 1, invariants: broken.map(({ folder, caller }): RunEntry => ({ component: folder, name: `s1 guard ${folders.indexOf(folder) + 1}`, form: "chokepoint", verdict: "fail", grade: "broken", refutation: "automatic", bypasses: [{ file: `${caller}/bad.ts`, line: 3, symbol: "sneak" }, { file: `${folder}/inner.ts`, line: 9, symbol: "inside" }], testReferences: 0, files: [], latency: 1, reason: "fixture" })) }];
  return state;
}

test("the map's text never overlaps, is never truncated, and never leaves its canvas or its station, under every selection", () => {
  for (const state of [projectState(), crowdedState()]) {
    const model = flowOf(state);
    for (const selected of everySelection(model)) {
      const measured = measureSvg(renderFlowSvg(model, selected).text);
      assert.ok(measured.texts.length > 0);
      assert.deepEqual(measured.overlaps, [], `${selected ?? "at rest"}: no two text boxes overlap`);
      assert.deepEqual(measured.truncated, [], `${selected ?? "at rest"}: no text is truncated`);
      assert.deepEqual(measured.clipped, [], `${selected ?? "at rest"}: no text is clipped`);
    }
    for (const node of model.nodes.filter((n) => !n.core)) assert.ok(measureSvg(renderFlowSvg(model, undefined).text).texts.some((t) => t.text === (node.folder === "." ? `${node.name} (root)` : node.name)), `${node.folder}'s name is on the map, never dropped`);
  }
  // The measure itself sees what it must: two overlapping texts, an ellipsis, and a name wider than its box.
  const bad = measureSvg('<svg viewBox="0 0 200 100"><rect id="b" x="0" y="0" width="30" height="20"/><text x="10" y="20" font-size="12">overlap</text><text x="14" y="22" font-size="12">again…</text><text x="2" y="14" font-size="12" data-within="b">Much too long</text></svg>');
  assert.equal(bad.overlaps.length, 3);
  assert.deepEqual(bad.truncated, ["again…"]);
  assert.deepEqual(bad.clipped, ["Much too long"]);
});

test("every drawn segment is horizontal, vertical, or at 45 degrees, under every selection", () => {
  for (const state of [projectState(), crowdedState()]) {
    const model = flowOf(state);
    for (const selected of everySelection(model)) {
      const measured = measureSvg(renderFlowSvg(model, selected).text);
      assert.ok(measured.segments > 0);
      assert.equal(measured.offAngle, 0, `${selected ?? "at rest"}: ${measured.offAngle} of ${measured.segments} segments are off 0, 45 and 90 degrees`);
    }
  }
  assert.equal(measureSvg('<svg viewBox="0 0 10 10"><path class="flow-line" d="M 0 0 L 3 7"/><path class="flow-line" d="M 0 0 C 1 1, 2 2, 5 5"/></svg>').offAngle, 2, "the measure counts a slanted line and a curve");
});

test("a core dependency is a rail labelled once: its callers carry a stub and no arrow or line reaches it", () => {
  const model = flowOf(projectState());
  assert.deepEqual(model.coreDependencies.map((c) => c.folder), ["src/journal"], "the journal: called by three of the five other components, and calls none");
  assert.match(CORE_RULE, /more than half of the other visible components/);
  const journal = model.coreDependencies[0]!;
  assert.deepEqual(journal.callers, ["src/core", "src/reader", "src/store"]);
  for (const selected of everySelection(model)) {
    const svg = renderFlowSvg(model, selected).text;
    for (const id of journal.stubs) {
      assert.doesNotMatch(svg, new RegExp(`class="flow-line (?:flow-route|flow-faint|flow-bearing-line)[^"]*"[^>]*data-edge="${id}"`), `${selected ?? "at rest"}: ${id} is not drawn as a line`);
      assert.match(svg, new RegExp(`data-stub="${id}"`), `${selected ?? "at rest"}: ${id} is a stub`);
    }
    for (const stub of svg.matchAll(/<g class="flow-stub-group[^"]*"[^>]*>(.*?)<\/g>/g)) assert.doesNotMatch(stub[1]!, /marker-end/, "a stub carries no arrow");
    assert.equal([...svg.matchAll(/class="flow-rail-label"[^>]*>Journal/g)].length, 1, "the rail is labelled once");
  }
  assert.ok(model.routes.every((route) => !route.stops.includes("src/journal")), "no route runs through a core dependency");
  const stubs = measureSvg(renderFlowSvg(model, undefined).text).lines.filter((line) => line.id.startsWith("stub "));
  assert.equal(stubs.length, 3, "one stub per caller");
});

test("each structural route is one colored path through its components in order", () => {
  for (const state of [projectState(), crowdedState()]) {
    const model = flowOf(state);
    const svg = renderFlowSvg(model, undefined).text;
    const layout = flowLayout(model);
    assert.ok(model.routes.length > 0);
    const colors = new Set<string>();
    for (const route of model.routes) {
      const paths = [...svg.matchAll(new RegExp(`<path class="flow-line flow-route" data-line="${route.id}" d="([^"]+)" stroke="([^"]+)"`, "g"))];
      assert.equal(paths.length, 1, `route ${route.id} is one path`);
      colors.add(paths[0]![2]!);
      const points = [...paths[0]![1]!.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
      const visited: string[] = [];
      for (const [x, y] of points) {
        const at = [...layout.stations.values()].find((s) => x >= s.x - 0.5 && x <= s.x + s.w + 0.5 && y >= s.y - 0.5 && y <= s.y + s.h + 0.5 && Math.abs(x - (s.x + s.w / 2)) < 0.6);
        if (at !== undefined && visited[visited.length - 1] !== at.folder) visited.push(at.folder);
      }
      assert.deepEqual(visited, route.stops, `route ${route.id} passes the centre of each stop, in order`);
      for (let i = 1; i < route.stops.length; i++) assert.ok(model.edges.some((edge) => edge.from === route.stops[i - 1] && edge.to === route.stops[i]), `route ${route.id}: ${route.stops[i - 1]} -> ${route.stops[i]} is a component interface, caller to callee`);
    }
    assert.equal(colors.size, Math.min(model.routes.length, 8) + (model.routes.length > 8 ? 1 : 0), "each route has its own color, up to the eight validated ones");
  }
  const run = flowOf(projectState()).routes.find((route) => route.entrances.includes(flowEntranceId(".", "run")))!;
  assert.deepEqual(run.stops, [".", "src/hooks", "src/core", "src/store"], "the root dispatches run to the hooks, then the heaviest interface onward, past the rail");
});

/** What an added interface reaches: its callee and everything the callee reaches, and all its caller reaches when it stops the caller being a core dependency. */
function reachedBy(before: FlowModel, after: FlowModel, from: string, to: string): Set<string> {
  const reach = (start: string): string[] => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const edge of after.edges) if (edge.from === at && !seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
    }
    return [...seen];
  };
  const wasCore = before.nodes.find((n) => n.folder === from)?.core === true && after.nodes.find((n) => n.folder === from)?.core !== true;
  return new Set([from, to, ...reach(to), ...(wasCore ? reach(from) : [])]);
}

test("stability: adding one component interface never reorders the components it does not touch", () => {
  const place = (model: FlowModel): Map<string, { column: number; row: number; core: boolean }> => new Map(model.nodes.map((n) => [n.folder, { column: n.column, row: n.row, core: n.core }]));
  const adding = (make: () => ShellState, from: string, to: string): ShellState => {
    const state = make();
    if (state.componentInterfaces.kind === "read") state.componentInterfaces.symbols = [...state.componentInterfaces.symbols, sym(from, to, "added", `${to}/added.ts`)];
    return state;
  };
  // The flow fixture: from an entrance's component, into a component nothing called, across a column, and two that bring a callee and all it reaches nearer.
  // The crowded fixture: columns of several components, where an order read from anything but the component itself would show.
  const cases: [() => ShellState, [string, string][]][] = [
    [projectState, [["src/journal", "src/hooks"], ["src/reader", "src/hooks"], [".", "src/store"], ["src/hooks", "src/reader"], ["src/store", "src/reader"], [".", "src/core"], ["src/reader", "src/journal"]]],
    [crowdedState, [[".", "src/indexer"], ["src/gateway", "src/telemetry"], ["src/search", "src/billing"], ["src/storage", "src/sessions"], ["src/accounts", "src/gateway"], ["src/telemetry", "src/search"]]],
  ];
  for (const [make, additions] of cases) {
    const baseline = flowOf(make());
    const before = place(baseline);
    for (const [from, to] of additions) {
      const changed = flowOf(adding(make, from, to));
      const after = place(changed);
      const touched = reachedBy(baseline, changed, from, to);
      const kept = [...before.keys()].filter((folder) => !touched.has(folder) && !before.get(folder)!.core && !after.get(folder)!.core);
      for (const folder of kept) assert.equal(after.get(folder)!.column, before.get(folder)!.column, `adding ${from} -> ${to} moved ${folder}, which it does not reach, out of its column`);
      const stayed = [...before.keys()].filter((folder) => !before.get(folder)!.core && !after.get(folder)!.core && before.get(folder)!.column === after.get(folder)!.column);
      for (const a of stayed) {
        for (const b of stayed) {
          if (a >= b || before.get(a)!.column !== before.get(b)!.column) continue;
          assert.equal(Math.sign(after.get(a)!.row - after.get(b)!.row), Math.sign(before.get(a)!.row - before.get(b)!.row), `adding ${from} -> ${to} reordered ${a} and ${b} within their column`);
        }
      }
    }
    assert.deepEqual(place(flowOf(make())), before, "the same inputs place the same components the same way");
  }
});

test("a component's column is its true distance from where work enters, uncapped, never through a core dependency; within a column rows follow folder order", () => {
  const model = flowOf(projectState());
  const column = (folder: string): number | undefined => model.nodes.find((node) => node.folder === folder)?.column;
  assert.equal(column("."), 0, "the root declares the entrances");
  assert.equal(column("src/reader"), 0, "nothing calls the reader: it stands where work enters, undeclared");
  assert.equal(column("src/hooks"), 1, "the root calls the hooks");
  assert.equal(column("src/core"), 2, "the hooks call the core");
  assert.equal(column("src/store"), 3, "the core calls the store: three interfaces from the entrance, not capped at two");
  for (const state of [projectState(), crowdedState()]) {
    const placed = flowOf(state).nodes.filter((n) => !n.core);
    for (const a of placed) {
      for (const b of placed) {
        if (a.column === b.column && placed.indexOf(a) < placed.indexOf(b)) assert.ok(a.row + a.span <= b.row, `${a.folder} stands above ${b.folder} in their column (folder order is the model's component order), clear of it`);
      }
    }
  }
});

test("no structural route doubles back to a column left of one it has visited", () => {
  // The store reaching back to the hooks, and the reader, heavily: the heaviest onward interface points left.
  const back = projectState({ symbols: [...SYMBOLS, sym("src/store", "src/hooks", "rewind", "src/hooks/rewind.ts", 40), sym("src/core", "src/reader", "peek", "src/reader/peek.ts", 40)] });
  for (const state of [projectState(), crowdedState(), back]) {
    const model = flowOf(state);
    const column = new Map(model.nodes.map((n) => [n.folder, n.column]));
    for (const route of model.routes) {
      const columns = route.stops.map((stop) => column.get(stop)!);
      columns.forEach((c, i) => assert.ok(i === 0 || c >= Math.max(...columns.slice(0, i)), `${route.names.join(", ")}: ${route.stops.join(" -> ")} doubles back at ${route.stops[i]} (columns ${columns.join(" ")})`));
    }
  }
});

/** The flow fixture with a second entrance handled by the same handler as run: the two share one route. */
function sharedState(): ShellState {
  const state = projectState();
  const root = state.spec.components.find((c) => c.folder === ".")!;
  root.entrances = [...root.entrances, { name: "replay a whole session from its journal", meaning: "replays", handler: "runHooks in src/hooks/run.ts", line: 9, handlerLine: 10, component: ".", file: "src/hooks/run.ts" }];
  if (state.componentInterfaces.kind === "read") state.componentInterfaces.entrances = [...state.componentInterfaces.entrances, { component: ".", name: "replay a whole session from its journal", file: "src/hooks/run.ts" }];
  return state;
}

/** The flow fixture with no entrance declared: every route is derived from the root's interfaces. */
function derivedState(): ShellState {
  const state = projectState();
  for (const component of state.spec.components) component.entrances = [];
  if (state.componentInterfaces.kind === "read") state.componentInterfaces.entrances = [];
  return state;
}

/** The terminus of a route as drawn: the text lines inside its terminus group, top to bottom. */
function terminusLines(svg: string, routeId: string): { text: string; y: number }[] {
  const group = new RegExp(`<g class="flow-route-group[^"]*" id="${routeId}"[^>]*>([^]*?)</g>\\s*</g>`).exec(svg);
  assert.ok(group !== null, `${routeId} is drawn`);
  const terminus = /<g class="flow-terminus[^"]*"[^>]*>([^]*)/.exec(group[1]!);
  assert.ok(terminus !== null, `${routeId} has a terminus`);
  return [...terminus[1]!.matchAll(/<text[^>]*y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ y: Number(m[1]), text: m[2]!.replace(/&amp;/g, "&") }));
}

test("every terminus names the entrances its route starts from, in full, one per line, and never truncated", () => {
  for (const state of [projectState(), crowdedState(), sharedState()]) {
    const model = flowOf(state);
    for (const selected of [undefined, FLOW_NONE_ID, ...model.routes.map((r) => r.id)]) {
      const svg = renderFlowSvg(model, flowSelected(model, selected)).text;
      const measured = measureSvg(svg);
      assert.deepEqual(measured.truncated, []);
      assert.deepEqual(measured.overlaps, [], `${selected ?? "default"}: termini never collide`);
      for (const route of model.routes.filter((r) => !r.derived)) {
        const names = route.entrances.map((id) => model.entrances.find((e) => e.id === id)!.name);
        assert.deepEqual(route.names, names, "a route is named for every entrance it starts from, in declaration order");
        const lines = terminusLines(svg, route.id);
        assert.deepEqual(lines.map((l) => l.text), names, `${route.id}: each entrance name on its own line, in full`);
        for (let i = 1; i < lines.length; i++) assert.ok(lines[i]!.y > lines[i - 1]!.y, "stacked, top to bottom");
      }
      assert.doesNotMatch(svg, /data-route="[A-Z]{1,2}"/, "no route wears a letter");
    }
  }
  const shared = flowOf(sharedState()).routes.find((r) => r.entrances.includes(flowEntranceId(".", "run")))!;
  assert.deepEqual(shared.names, ["run", "replay a whole session from its journal"], "two entrances on one route: both named, the long one whole");
});

test("a derived route is named via the first component it reaches, and marked derived", () => {
  const model = flowOf(derivedState());
  assert.equal(model.routesFrom, "root interfaces");
  assert.ok(model.routes.length > 0);
  const svg = renderFlowSvg(model, undefined).text;
  for (const route of model.routes) {
    assert.equal(route.derived, true);
    const via = model.nodes.find((n) => n.folder === route.stops[1])!;
    assert.deepEqual(route.names, [`via ${via.name}`]);
    assert.match(svg, new RegExp(`<g class="flow-route-group[^"]*" id="${route.id}"[^>]*data-derived="true"`), `${route.id} is marked derived on the map`);
    assert.deepEqual(terminusLines(svg, route.id).map((l) => l.text), [`via ${via.name}`, "derived"], "the terminus says derived in words, not only by a mark");
  }
  for (const route of flowOf(projectState()).routes) assert.equal(route.derived, false, "a route an entrance starts is not derived");
});

/** The busiest entrance's route, by the rule's own words: the most components reached, ties by name. */
function busiest(model: FlowModel): string | undefined {
  const candidates = model.routes.flatMap((route) => (route.derived ? [{ name: route.names[0]!, route }] : route.entrances.map((id) => ({ name: model.entrances.find((e) => e.id === id)!.name, route }))));
  candidates.sort((a, b) => b.route.stops.length + (b.route.rail === undefined ? 0 : 1) - (a.route.stops.length + (a.route.rail === undefined ? 0 : 1)) || a.name.localeCompare(b.name));
  return candidates[0]?.route.id;
}

test("the map opens on the busiest entrance's route, every other route muted; clearing mutes them all; a deep link selects anything", () => {
  for (const state of [projectState(), crowdedState(), sharedState(), derivedState()]) {
    const model = flowOf(state);
    const expected = busiest(model);
    assert.ok(expected !== undefined);
    assert.equal(flowDefaultSelection(model), expected, "the default is the busiest entrance's route");
    delete state.structure.selected;
    const opened = renderView(state, "structure").text;
    assert.match(opened, new RegExp(`data-selected="${expected}"`), "the page opens on that story");
    const classes = [...opened.matchAll(/<g class="flow-route-group ([^"]*)" id="([^"]+)"/g)].map((m) => [m[2]!, m[1]!.split(" ")] as const);
    for (const [id, cls] of classes) assert.ok(id === expected ? cls.includes("is-lit") : cls.includes("is-dim"), `${id} at rest: ${cls.join(" ")}`);
    state.structure.selected = FLOW_NONE_ID;
    const cleared = renderView(state, "structure").text;
    assert.match(cleared, /data-selected=""/);
    for (const m of cleared.matchAll(/<g class="flow-route-group ([^"]*)" id="([^"]+)"/g)) assert.deepEqual(m[1]!.split(" "), ["is-muted"], `${m[2]} is thin and muted with nothing selected`);
    const other = model.routes.find((r) => r.id !== expected);
    if (other !== undefined) {
      state.structure.selected = other.id;
      assert.match(renderView(state, "structure").text, new RegExp(`<g class="flow-route-group is-lit" id="${other.id}"`), "a deep link still selects any route");
    }
  }
});

test("every stub visibly meets its rail", () => {
  for (const state of [projectState(), crowdedState()]) {
    const model = flowOf(state);
    const layout = flowLayout(model);
    const svg = renderFlowSvg(model, undefined).text;
    const rails = new Map([...svg.matchAll(/<line class="flow-line flow-rail-line" data-line="rail ([^"]+)" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)"/g)].map((m) => [m[1]!, { x0: Number(m[2]), y: Number(m[3]), x1: Number(m[4]) }]));
    assert.equal(rails.size, model.coreDependencies.length);
    for (const core of model.coreDependencies) {
      for (const id of core.stubs) {
        const edge = model.edges.find((e) => e.id === id)!;
        const station = layout.stations.get(edge.from);
        const line = measureSvg(svg).lines.find((l) => l.id === `stub ${id}`);
        assert.ok(line !== undefined, `${id} is drawn as a stub`);
        const end = line.points[line.points.length - 1]!;
        const rail = rails.get(core.folder)!;
        assert.ok(Math.abs(end[1] - rail.y) < 0.6 && end[0] >= rail.x0 && end[0] <= rail.x1, `${id} ends on the ${core.folder} rail (at ${end.join(",")}, rail at y ${rail.y})`);
        if (station !== undefined) {
          const start = line.points[0]!;
          const onEdge = start[0] >= station.x - 0.6 && start[0] <= station.x + station.w + 0.6 && start[1] >= station.y - 0.6 && start[1] <= station.y + station.h + 0.6;
          assert.ok(onEdge, `${id} starts at its caller's station`);
        }
      }
    }
  }
});

test("a core dependency's interface identifiers are drawn once, on its rail, never beside each caller", () => {
  for (const state of [projectState(), crowdedState()]) {
    const model = flowOf(state);
    for (const selected of [undefined, ...model.coreDependencies.map((c) => model.nodes.find((n) => n.folder === c.folder)!.id)]) {
      const svg = renderFlowSvg(model, selected).text;
      for (const core of model.coreDependencies) {
        const expected = [...new Set(core.stubs.flatMap((id) => model.edges.find((e) => e.id === id)!.identifiers))];
        for (const id of core.stubs) assert.doesNotMatch(svg, new RegExp(`class="flow-tag[^"]*" data-edge="${id}"`), `${id}: no identifier beside the caller`);
        const onRail = [...svg.matchAll(new RegExp(`<g class="flow-tag[^"]*" data-rail="${core.folder}" data-identifier="([^"]+)"`, "g"))].map((m) => m[1]!);
        assert.deepEqual(onRail.sort(), [...expected].sort(), `${core.folder}: each identifier on its stubs once, on the rail`);
      }
    }
  }
  const journal = flowOf(projectState()).coreDependencies.find((c) => c.folder === "src/journal")!;
  assert.ok(journal.stubs.filter((id) => flowOf(projectState()).edges.find((e) => e.id === id)!.identifiers.includes("X2")).length > 1, "the fixture puts one identifier on more than one stub, so repeating it would show");
});

test("activating an interface identifier selects it and opens the inspector with its invariant", () => {
  const state = projectState({ sites: { "single writer": [{ file: "src/core/save.ts", line: 3, symbol: "save", class: "chokepoint-reference", of: "chokepoint", test: false }] } });
  state.spec.components.find((c) => c.folder === "src/store")!.invariants[0]!.refutations = [{ broke: "wrote a row outside write", saw: "the check went red", date: "2026-09-20", line: 9 }];
  const model = flowOf(state);
  const writer = model.identifiers.find((i) => i.name === "single writer")!;
  const svg = renderFlowSvg(model, undefined).text;
  const target = new RegExp(`<g class="flow-tag[^"]*" data-edge="${flowEdgeId("src/core", "src/store")}" data-identifier="${writer.text}" data-structure-select="${writer.chokepoint}" role="button" tabindex="0" aria-label="${writer.text}: single writer"`);
  assert.match(svg, target, "the identifier is its own button, named for its invariant");
  assert.deepEqual(flowKeyAction({ key: "Enter", select: writer.chokepoint, button: false }), { select: writer.chokepoint }, "Enter activates it");
  assert.deepEqual(flowKeyAction({ key: " ", select: writer.chokepoint, button: false }), { select: writer.chokepoint }, "Space activates it");
  state.structure.selected = writer.chokepoint;
  const page = renderView(state, "structure").text;
  const inspector = /<aside class="flow-inspector"([^>]*)>([^]*?)<\/aside>/.exec(page);
  assert.ok(inspector !== null);
  assert.match(inspector[1]!, /data-open="true"/, "the inspector is open");
  const body = inspector[2]!;
  for (const [what, pattern] of [
    ["the invariant's name", /single writer/],
    ["its sentence", /single writer\./],
    ["its component", /src\/store/],
    ["the enforcement form", /data-form="chokepoint"/],
    ["the chokepoint and the protected thing", /<code>write<\/code>[^]*<code>writeRow<\/code>/],
    ["the grade", /data-grade="reference-choked"/],
    ["the crossing, with both trust levels and their meanings", /outside<\/span>[^]*a caller beyond the store[^]*inside<\/span>[^]*the store(?:'|&#39;)s own code/],
    ["the refutation, dated", /data-refutation="witnessed"[^]*2026-09-20/],
    ["the latest verdict", /data-verdict="pass"/],
    ["the interface it sits on, with its symbol count", /src\/core → src\/store[^]*2 symbols/],
    ["the structural routes through it", /data-field="routes-through"[^]*run/],
    ["a close button", /data-structure-close/],
  ] as const) assert.match(body, pattern, `the inspector shows ${what}`);
  const broken = projectState({ states: { "single writer": "structural defect" }, bypasses: { "single writer": [{ file: "src/reader/look.ts", line: 9, symbol: "peek" }] } });
  broken.structure.selected = writer.chokepoint;
  const defect = renderView(broken, "structure").text;
  assert.match(defect, /<code>src\/reader\/look\.ts:9<\/code>[^]*data-option="route"[^]*data-option="retire"/, "a bypass shows its sites and both honest options");
});

test("Escape and the close button close the inspector; the selection hash reopens it", () => {
  const state = projectState();
  const model = flowOf(state);
  const writer = model.identifiers[0]!;
  assert.deepEqual(flowKeyAction({ key: "Escape", select: undefined, button: false }), { select: FLOW_NONE_ID }, "Escape clears the selection");
  assert.equal(flowKeyAction({ key: "a", select: writer.chokepoint, button: false }), undefined, "other keys do nothing");
  state.structure.selected = writer.chokepoint;
  const open = renderView(state, "structure").text;
  assert.match(open, new RegExp(`<button type="button" class="flow-close" data-structure-close data-structure-select="${FLOW_NONE_ID}" aria-label="Close the inspector"`), "the close button clears to nothing selected");
  state.structure.selected = FLOW_NONE_ID;
  assert.match(renderView(state, "structure").text, /<aside class="flow-inspector"[^>]*data-open="false"/, "closed");
  assert.deepEqual(resolveHash(state, `#${writer.chokepoint}`), { view: "structure", id: writer.chokepoint }, "the selection hash reopens it");
  assert.deepEqual(resolveHash(state, `#${FLOW_NONE_ID}`), { view: "structure", id: FLOW_NONE_ID });
});

test("at desktop width the inspector stands beside the canvas and never covers it; at phone width it is a dismissible sheet", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = (media: RegExp): string => {
    const start = css.search(media);
    assert.ok(start >= 0, `${media} is in the styles`);
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") { depth -= 1; if (depth === 0) return css.slice(start, i + 1); }
    }
    return css.slice(start);
  };
  const desktop = block(/@media \(min-width: 64rem\)/);
  assert.match(desktop, /\.flow-stage\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) [\d.]+rem/, "two columns: the canvas, then the inspector");
  assert.match(desktop, /\.flow-inspector\s*\{[^}]*grid-column:\s*2/, "the inspector has its own column");
  assert.match(desktop, /\.flow-canvas\s*\{[^}]*grid-column:\s*1/, "the canvas has the other");
  const phone = block(/@media \(max-width: 63\.99rem\)/);
  assert.match(phone, /\.flow-inspector\[data-open="true"\]\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/, "below desktop width an open inspector is a sheet over the bottom of the screen");
  const outside = css.replace(desktop, "").replace(phone, "");
  assert.doesNotMatch(outside, /\.flow-inspector[^{]*\{[^}]*position:\s*(fixed|absolute)/, "nowhere else does the inspector float over the map");
  assert.doesNotMatch(desktop, /\.flow-inspector[^{]*\{[^}]*position:\s*(fixed|absolute)/, "at desktop width it never floats");
  const page = renderView(projectState(), "structure").text;
  assert.match(page, /<div class="flow-stage">\s*<div class="flow-canvas"[^]*<\/svg><\/div>\s*<aside class="flow-inspector"/, "the canvas and the inspector are siblings in the stage");
});

test("selecting an entrance lights its structural route and dims the rest", () => {
  const state = projectState();
  const model = flowOf(state);
  const run = model.entrances.find((e) => e.name === "run")!;
  assert.equal(run.start, "src/hooks");
  assert.ok(run.reachable, "the root's interface to the hooks carries runHooks");
  const lit = flowSelection(model, run.id);
  const route = model.routes.find((r) => r.entrances.includes(run.id))!;
  assert.deepEqual([...lit.nodes].sort(), [...route.stops].sort());
  assert.deepEqual([...lit.routes], [route.id]);
  state.structure.selected = run.id;
  const svg = renderView(state, "structure").text;
  assert.match(svg, /<g class="flow-station flow-unconnected is-dim"|<g class="flow-station is-dim" id="structure--node-src-reader"/, "the reader dims");
  assert.match(svg, new RegExp(`<g class="flow-route-group is-lit" id="${route.id}"`), "the route is lit");
  assert.match(svg, /data-kind="entrance"/);
  assert.match(svg, /<strong>run<\/strong>: Flow \(root\) → Hooks → Core → Store/, "the route is named for its entrance");
});

test("selecting a component lights its direct component interfaces and keeps its routes, never everything it reaches", () => {
  const model = flowOf(projectState());
  const hooks = flowSelection(model, flowNodeId("src/hooks"));
  assert.deepEqual([...hooks.edges].sort(), [flowEdgeId(".", "src/hooks"), flowEdgeId("src/hooks", "src/core")].sort(), "its two interfaces, not the core's onward ones");
  assert.deepEqual([...hooks.nodes].sort(), [".", "src/core", "src/hooks"]);
  const reader = flowSelection(model, flowNodeId("src/reader"));
  const svg = renderFlowSvg(model, flowNodeId("src/reader")).text;
  for (const id of reader.edges) {
    const edge = model.edges.find((e) => e.id === id)!;
    if (edge.stub) assert.match(svg, new RegExp(`class="flow-stub-group is-lit" data-stub="${id}"`));
    else assert.match(svg, new RegExp(`data-drawn="(faint|bearing)"[^>]*>[^]*?data-edge="${id}"`), `${id} is drawn faint once the reader is selected`);
  }
  assert.doesNotMatch(renderFlowSvg(model, undefined).text, /data-drawn="faint"/, "at rest no plain interface off the routes is drawn");
});

test("every chokepoint and crossing on a drawn interface wears its interface identifier, a crossing with a dashed trust boundary", () => {
  const model = flowOf(projectState());
  assert.deepEqual(model.identifiers.map((i) => `${i.text} ${i.name}`), ["C1 one door", "X2 append-only store", "X3 single writer"]);
  const svg = renderFlowSvg(model, undefined).text;
  for (const identifier of model.identifiers) {
    for (const edge of identifier.edges) {
      const drawn = model.edges.find((e) => e.id === edge)!;
      if (drawn.routes.length === 0 && !drawn.stub && !drawn.loadBearing) continue;
      const where = drawn.stub ? `data-rail="${drawn.to}"` : `data-edge="${edge}"`;
      const tag = new RegExp(`<g class="flow-tag[^"]*" ${where} data-identifier="${identifier.text}"[^>]*>([^]*?)</g>`).exec(svg);
      assert.ok(tag !== null, `${identifier.text} stands on ${drawn.stub ? `the ${drawn.to} rail` : edge}`);
      assert.equal(tag[1]!.includes('class="flow-boundary"'), identifier.crossing !== undefined, `${identifier.text}: a trust boundary exactly when a crossing stands there`);
    }
  }
  const lit = renderFlowSvg(model, flowLevelId("outside")).text;
  assert.match(lit, new RegExp(`<g class="flow-tag is-lit" data-edge="${flowEdgeId("src/core", "src/store")}"`), "selecting a trust level lights its boundary crossings");
});

test("selecting a trust level lights the path its data takes; selecting a chokepoint lights where it stands and lists its reliance", () => {
  const sites: RecordedSite[] = [
    { file: "src/core/save.ts", line: 3, symbol: "save", class: "chokepoint-reference", of: "chokepoint", test: false, form: "import" },
    { file: "src/store/write.ts", line: 2, symbol: "write", class: "inside", of: "protected", test: false },
  ];
  const state = projectState({ sites: { "single writer": sites } });
  const model = flowOf(state);
  const inside = flowSelection(model, flowLevelId("inside"));
  assert.deepEqual([...inside.edges].sort(), [flowEdgeId("src/core", "src/journal"), flowEdgeId("src/core", "src/store"), flowEdgeId("src/store", "src/journal")].sort(), "every interface whose crossing touches inside");
  state.structure.selected = flowLevelId("record");
  const record = renderView(state, "structure").text;
  assert.match(record, /<g class="flow-tag is-lit" data-rail="src\/journal" data-identifier="X2"/, "the boundary crossing on the stubs to the journal lights, on its rail");
  assert.match(record, new RegExp(`<g class="flow-tag is-dim" data-edge="${flowEdgeId("src/core", "src/store")}"`), "a crossing that does not carry record dims");
  const writer = flowChokepointId("src/store", "single writer");
  assert.deepEqual([...flowSelection(model, writer).edges], [flowEdgeId("src/core", "src/store")]);
  state.structure.selected = writer;
  const rendered = renderView(state, "structure").text;
  assert.match(rendered, /data-kind="chokepoint"/);
  assert.match(rendered, /chokepoint · reference \(runtime call not established\)/);
  assert.match(rendered, /protected thing · inside chokepoint/);
});

test("the map is byte-deterministic: the same state renders the same bytes, and the state holds no position", () => {
  const state = projectState();
  state.structure.selected = flowNodeId("src/core");
  const first = renderView(state, "structure").text;
  const second = renderView(JSON.parse(JSON.stringify(state)) as ShellState, "structure").text;
  assert.equal(first, second);
  assert.deepEqual(Object.keys(state.structure).sort(), ["preview", "selected"], "selection is the only reader state; no layout is stored");
});

test("query structure prints the routes, core dependencies and interface identifiers the view draws, from the same derivation", () => {
  for (const state of [projectState(), crowdedState()]) {
    const text = answerStructure(state).text;
    const svg = renderFlowSvg(flowOf(state), undefined).text;
    assert.match(svg, /data-dropped=""/, "nothing on this map was dropped, so every identifier is drawn");
    const section = (heading: RegExp): string[] => {
      const lines = text.split("\n");
      const start = lines.findIndex((line) => heading.test(line));
      assert.ok(start >= 0, `${heading} is in the text form`);
      const out: string[] = [];
      for (const line of lines.slice(start + 1)) {
        if (!line.startsWith("  ")) break;
        out.push(line.trim());
      }
      return out;
    };
    const queriedRoutes = section(/^structural routes/).map((line) => line.split(/ {2}/).slice(0, 2).join(" | "));
    const drawnRoutes = [...svg.matchAll(/data-names="([^"]+)" data-derived="(true|false)" data-stops="([^"]+)" data-edges="[^"]*"(?: data-rail="([^"]+)")?/g)].map((m) => `${m[1]!.replace(/&amp;/g, "&")}${m[2] === "true" ? " (derived)" : ""} | ${m[3]!.split(" ").join(" -> ")}${m[4] === undefined ? "" : ` -> ${m[4]} (rail)`}`);
    assert.ok(drawnRoutes.length > 0);
    assert.deepEqual(queriedRoutes, drawnRoutes, "routes: named origin and stops in order");
    const queriedCore = section(/^core dependencies/).map((line) => line.split(/ {2}/)[0]);
    const drawnCore = [...svg.matchAll(/<g class="flow-rail[^"]*" id="[^"]+" data-folder="([^"]+)" data-core="true"/g)].map((m) => m[1]);
    assert.deepEqual(queriedCore, drawnCore, "core dependencies: one rail each");
    const queriedIds = section(/^interface identifiers/).flatMap((line) => {
      const [text, , ...rest] = line.split(/ {2}/);
      const on = rest[rest.length - 1]!.replace(/^on /, "").split(", ");
      return on.map((pair) => `${text} ${pair}`);
    }).sort();
    const model = flowOf(state);
    const drawnIds = [...svg.matchAll(/<g class="flow-tag[^"]*" (?:data-edge="([^"]+)"|data-rail="[^"]+") data-identifier="([CX]\d+)"(?: data-edges="([^"]+)")?/g)].flatMap((m) =>
      (m[1] !== undefined ? [m[1]] : m[3]!.split(" ")).map((id) => {
        const edge = model.edges.find((e) => e.id === id)!;
        return `${m[2]} ${edge.from} -> ${edge.to}`;
      }),
    );
    const offMap = model.edges.filter((e) => e.routes.length === 0 && !e.stub && !e.loadBearing && e.bypasses.length === 0);
    assert.deepEqual(queriedIds.filter((id) => !offMap.some((e) => id.endsWith(` ${e.from} -> ${e.to}`))), drawnIds.sort(), "identifiers: each on the interfaces it stands on");
  }
  assert.equal(answer(projectState(), "structure", ["extra"]).code, 64);
});

test("an interface a bypass crosses is drawn broken at rest, and the inspector names the sites and both options", () => {
  const state = projectState({ states: { "single writer": "structural defect" }, bypasses: { "single writer": [{ file: "src/reader/look.ts", line: 9, symbol: "peek" }] } });
  const model = flowOf(state);
  const edge = model.edges.find((candidate) => candidate.id === flowEdgeId("src/reader", "src/store"))!;
  assert.equal(edge.bypasses.length, 1);
  assert.ok(flowLabelLines(edge).some((line) => line.kind === "defect" && line.text === "broken: 1 bypass"));
  assert.match(renderFlowSvg(model, undefined).text, new RegExp(`class="flow-line flow-bearing-line flow-broken-line"[^>]*data-edge="${edge.id}"`), "a broken interface is drawn at rest, dashed red");
  state.structure.selected = edge.id;
  const rendered = renderView(state, "structure").text;
  assert.match(rendered, new RegExp(`<g class="flow-interface is-lit" id="${edge.id}"`));
  assert.match(rendered, /<code>src\/reader\/look\.ts:9<\/code> in <code>peek<\/code>/);
  assert.match(rendered, /data-option="route"/);
  assert.match(rendered, /data-option="retire"/);
});

test("an entrance is declared in its component's spec and checked: an unresolvable handler is a spec problem, and one no interface reaches is unreachable", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-entrance-"));
  try {
    writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "entrance", entryDir: ".", language: "typescript" }));
    writeFileSync(join(root, "Entrance.spec.md"), "# Entrance\n\nWhere work comes in.\n\n## entrances\n- serve: a request arrives\n  handler: handle in src/serve.ts\n- ghost: nothing handles this\n  handler: missing in src/serve.ts\n- bare: no handler named\n\n## invariants\n");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/serve.ts"), "export function handle() {}\n");
    const model = loadSpecModel(root, { runs: false });
    assert.deepEqual(model.components[0]!.entrances.map((e) => [e.name, e.file]), [["serve", "src/serve.ts"], ["ghost", undefined], ["bare", undefined]]);
    const problems = model.problems.map((p) => p.message);
    assert.ok(problems.some((m) => m.includes("entrance ghost: handler missing is not declared at the top level of src/serve.ts")), problems.join("\n"));
    assert.ok(problems.some((m) => m.includes("entrance bare names no handler")), problems.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const stray = flowOf(projectState()).entrances.find((e) => e.name === "stray")!;
  assert.equal(stray.reachable, false);
  assert.match(stray.reason ?? "", /no component interface from \. carries stray/);
});

test("zoom shows one level of the component tree at a time: a closed component carries its children's interfaces at its edge", () => {
  const closed = projectState();
  assert.ok(pairs(closed).includes("src/store -> src/journal"), "the cache's interface shows at the store's edge while the store is closed");
  assert.ok(!flowOf(closed).nodes.some((node) => node.folder === "src/store/cache"));
  const open = projectState();
  open.structure.expanded = [".", "src/store"];
  assert.ok(pairs(open).includes("src/store/cache -> src/journal"), "opened in place, the child carries its own interface");
  assert.ok(!pairs(open).includes("src/store -> src/journal"));
  assert.equal(flowOf(open).nodes.find((node) => node.folder === "src/store")!.expanded, true);
  assert.match(renderFlowSvg(flowOf(closed), undefined).text, /data-mass="unowned"[^]*1 file, 40 lines/, "code in no component is its own labelled mass");
});

test("the comparison seam measures what a change did: entrance, interface added, removed or widened, bypass, crossing, data path", () => {
  const before = flowOf(projectState());
  const changed = projectState({ symbols: [...SYMBOLS.filter((s) => !(s.from === "src/reader" && s.to === "src/core")), sym("src/reader", "src/journal", "journalPath", "src/journal/path.ts"), sym("src/hooks", "src/store", "write", "src/store/write.ts")], bypasses: { "single writer": [{ file: "src/core/raw.ts", line: 2, symbol: "raw" }] } });
  const after = flowOf(changed);
  const changes = compareFlows(before, after).map((c) => `${c.kind} ${"edge" in c ? c.edge : c.entrance}`);
  assert.ok(changes.includes(`interface added ${flowEdgeId("src/hooks", "src/store")}`), changes.join("\n"));
  assert.ok(changes.includes(`interface removed ${flowEdgeId("src/reader", "src/core")}`));
  assert.ok(changes.includes(`interface widened ${flowEdgeId("src/reader", "src/journal")}`));
  assert.ok(changes.includes(`chokepoint gained a bypass ${flowEdgeId("src/core", "src/store")}`));
  assert.ok(changes.includes(`crossing added ${flowEdgeId("src/hooks", "src/store")}`));
  assert.ok(changes.includes(`data path branched ${flowEdgeId("src/hooks", "src/store")}`));
  const noEntrance = projectState();
  noEntrance.spec.components[0]!.entrances = noEntrance.spec.components[0]!.entrances.slice(0, 1);
  assert.ok(compareFlows(before, flowOf(noEntrance)).some((c) => c.kind === "entrance removed"));
});

test("each reviewer question is answered by one selection on the built page", async () => {
  const { state } = await buildScopePage({ root: fixture.root, glossaryPath: COHERENCE_GLOSSARY, project: "Fixture", componentInterfaces: { kind: "read", language: "typescript", declarations: 3, symbols: [sym("src/api", "src/store", "write", "src/store/write.ts", 2), sym("src/api", "src/store", "writeRow", "src/store/rows.ts")], entrances: [], unowned: { files: 0, lines: 0 } } });
  state.activeView = "structure";
  const model = flowOf(state);
  const ask = (selected: string): string => renderView({ ...state, structure: { ...state.structure, selected } }, "structure").text;
  // Where does work enter? The summary names every entrance, each one selection away; the fixture declares none, and says so.
  assert.match(renderView(state, "structure").text, /Where work enters/);
  // What does this change touch, and what did it weaken? One selection: the comparison seam's place on the map.
  assert.match(ask(FLOW_CHANGE_ID), /data-field="change-placeholder"[^]*component interface added, removed, or widened[^]*chokepoint gaining a bypass/);
  // Where does sensitive data go? Selecting the trust level lights the interfaces its crossings cross.
  assert.match(ask(flowLevelId("inside")), new RegExp(`<g class="flow-tag flow-tag-broken is-lit" data-edge="${flowEdgeId("src/api", "src/store")}"`), "its boundary crossing lights");
  // What is load-bearing here? Selecting the component lists its load-bearing interfaces.
  assert.match(ask(flowNodeId("src/store")), /data-field="load-bearing">Load-bearing here \(1\)/);
  // And the chokepoint's reliance is one selection too.
  assert.match(ask(flowChokepointId("src/store", "single writer")), /data-kind="chokepoint"/);
  assert.ok(model.edges.length === 1);
});

test("links into the retired Reliance view and the security spine land on the one map's selections", () => {
  const state = projectState();
  assert.deepEqual(resolveHash(state, `#${relianceId("src/store", "single writer")}`), { view: "structure", id: flowChokepointId("src/store", "single writer") });
  assert.deepEqual(resolveHash(state, `#${structureId("src/store", "single writer")}`), { view: "structure", id: flowChokepointId("src/store", "single writer") });
  assert.deepEqual(resolveHash(state, "#reliance"), { view: "structure", id: undefined });
  assert.deepEqual(resolveHash(state, `#${flowEntranceId(".", "run")}`), { view: "structure", id: flowEntranceId(".", "run") });
});

test("without the adapter's reading only run-recorded references are drawn, and the evidence line says so", () => {
  const state = projectState({ unread: true, sites: { "single writer": [{ file: "src/core/save.ts", line: 3, symbol: "save", class: "chokepoint-reference", of: "chokepoint", test: false }] } });
  const model = flowOf(state);
  assert.equal(model.evidence, "run sites only");
  assert.deepEqual(pairs(state), ["src/core -> src/store"]);
  assert.match(renderView(state, "structure").text, /data-field="evidence"[^]*plain component interfaces are unknown \(no instrument was asked\)/);
});

test("the language adapter reads component interfaces from resolved references, skipping tests and a component's own code", { timeout: 120_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "coherence-interfaces-"));
  try {
    writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "interfaces", entryDir: ".", language: "typescript" }));
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["**/*.ts"] }));
    writeFileSync(join(root, "Root.spec.md"), "# Root\n\nThe root.\n\n## entrances\n- go: work arrives\n  handler: go in src/api/api.ts\n\n## invariants\n");
    mkdirSync(join(root, "src/api"), { recursive: true });
    mkdirSync(join(root, "src/store"), { recursive: true });
    writeFileSync(join(root, "src/api/Api.spec.md"), "# Api\n\nAsks the store.\n\n## invariants\n");
    writeFileSync(join(root, "src/store/Store.spec.md"), "# Store\n\nHolds rows.\n\n## invariants\n");
    writeFileSync(join(root, "src/store/rows.ts"), "export function write(value: string): string {\n  return value;\n}\nexport function unused(): void {}\n");
    writeFileSync(join(root, "src/store/self.ts"), "import { write } from \"./rows.ts\";\nexport const own = write(\"x\");\n");
    writeFileSync(join(root, "src/api/api.ts"), "import { write } from \"../store/rows.ts\";\nexport function go(): string {\n  return write(\"a\") + write(\"b\");\n}\n");
    writeFileSync(join(root, "src/api/api.test.ts"), "import { write } from \"../store/rows.ts\";\nwrite(\"t\");\n");
    const read = await readComponentInterfaces(root);
    if (read.kind === "unread") {
      t.skip(`no instrument on this machine: ${read.because}`);
      return;
    }
    assert.deepEqual(read.symbols.map((s) => `${s.from} -> ${s.to} ${s.symbol} ${s.file} ${s.sites}`), ["src/api -> src/store write src/store/rows.ts 3"], "import and two uses; the test file and the store's own use are not an interface");
    assert.deepEqual(read.entrances, [{ component: ".", name: "go", file: "src/api/api.ts" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
