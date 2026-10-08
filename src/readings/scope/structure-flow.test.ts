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
import { COHERENCE_LEXICON } from "../../lifecycle/project.ts";
import { loadSpecModel } from "../../spec/model.ts";
import { answer, answerStructure } from "../query/query.ts";
import { buildScopePage } from "./build.ts";
import { makeFixture, type Fixture } from "./check-fixture.ts";
import { readComponentInterfaces } from "./component-interfaces.ts";
import { gapsOf, orientGapText, structureState } from "./gaps.ts";
import { ADOPTER_ENTRANCES, APPLE, adopterFiles } from "../../spec/covers-fixture.ts";
import { allInvariants, flowChokepointId, flowLevelId, invariantVerdict, relianceId, resolveHash, structureId } from "./derive.ts";
import type { EntranceGuard, InterfaceReading, InterfaceSymbol, ReachReference, RecordedSite, RunEntry, ShellState, SpecComponent, SpecEntrance, SpecInvariant } from "./model.ts";
import { renderView } from "./shell.ts";
import { CORE_RULE, FLOW_CHANGE_ID, FLOW_HEALTH_KINDS, FLOW_NONE_ID, compareFlows, flowBrokenId, flowHealthId, flowHealthMembers, flowDefaultSelection, flowEdgeId, flowEntranceId, flowKeyAction, flowLabelLines, flowNodeId, flowOf, flowSelected, flowSelection, type FlowEntrance, type FlowModel, type FlowRoute } from "./structure-flow.ts";
import { FLOW_HOP_DELAY, FLOW_NEUTRAL_ROUTE, FLOW_PULSE_PERIOD, FLOW_PULSE_SPEED, FLOW_RAIL_COLORS, FLOW_ROUTE_COLORS, contrast, flowLayout, flowPulses, polylineLength, renderFlowSvg } from "./structure-flow-view.ts";
import { measureSvg, textWidth } from "./structure-measure.ts";

let fixture: Fixture;
let base: ShellState;

before(async () => {
  fixture = makeFixture();
  ({ state: base } = await buildScopePage({ root: fixture.root, lexiconPath: COHERENCE_LEXICON, project: "Flow" }));
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

test("the map's type is a product UI scale: one system family, three sizes, two weights, sentence case, no tracking, and metrics that never undershoot the face", () => {
  const sizes = new Set<string>();
  const weights = new Set<string>();
  for (const state of [projectState(), crowdedState(), derivedState()]) {
    const model = flowOf(state);
    for (const selected of everySelection(model)) {
      const svg = renderFlowSvg(model, selected).text;
      for (const m of svg.matchAll(/<text\b([^>]*)>/g)) {
        sizes.add(/font-size="([^"]+)"/.exec(m[1]!)?.[1] ?? "none");
        weights.add(/font-weight="([^"]+)"/.exec(m[1]!)?.[1] ?? "400");
      }
    }
  }
  assert.deepEqual([...sizes].sort(), ["11", "12", "13"], "three sizes: 13 for a component's name, 12 for the caption, 11 for folders, column captions, rails and tokens");
  assert.deepEqual([...weights].sort(), ["400", "500"], "regular and medium on the canvas: the owner found semibold too heavy there");
  const style = /<style>([^]*?)<\/style>/.exec(renderFlowSvg(flowOf(projectState()), undefined).text)![1]!;
  assert.match(style, /\.flow-svg text \{ font-family: system-ui, -apple-system/, "the map is set in the page's system family");
  assert.doesNotMatch(style, /text-transform|letter-spacing|font-style: italic|font-weight: 700/, "no capitals, tracking, italics or heavy weight on the map");
  // Widths Chrome reported for the system face on macOS (SF Pro, tabular numerals): the embedded metrics must never be narrower.
  for (const [text, size, bold, measured] of [["Coherence (root)", 13, true, 108.5], ["src/readings/scope", 11, false, 99.96], ["X13", 11, true, 22.5], ["Adapters: core dependency, called by 5 of 9", 12, false, 249.55]] as const) {
    assert.ok(textWidth(text, size, bold) >= measured, `${text} at ${size}px: ${textWidth(text, size, bold).toFixed(1)} covers the rendered ${measured}`);
  }
});

test("the Structure page's own type has no tracked capitals and no stacked header counts", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const structure = css.slice(css.indexOf("/* Structure: one map */"), css.indexOf("/* Runs */"));
  assert.doesNotMatch(structure, /text-transform:\s*uppercase|letter-spacing:\s*0\.\d+em/, "sentence case, no tracked capitals");
  const state = projectState();
  const page = renderView(state, "structure").text;
  assert.doesNotMatch(page, /class="eyebrow"/, "no eyebrow labels in the Structure view");
  assert.doesNotMatch(page, /class="quiet flow-legend"><p|<p class="quiet flow-legend"/, "the legend is a key, not a paragraph");
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
    assert.deepEqual(terminusLines(svg, route.id).map((l) => l.text), [`via ${via.name}`, "reference weight"], "the terminus says it is reference weight in words, not only by a mark");
  }
  for (const route of flowOf(projectState()).routes) assert.equal(route.derived, false, "a route an entrance starts is not derived");
});

/** What the map should open on, by the rule's own words: nothing, unless a component is broken, then the one with the most broken chokepoints, then the first in folder order. */
function opening(model: FlowModel): string | undefined {
  const broken = model.nodes.filter((n) => n.defects.length > 0);
  if (broken.length === 0) return undefined;
  const most = Math.max(...broken.map((n) => n.defects.length));
  return broken.find((n) => n.defects.length === most)!.id;
}

test("the map opens on the whole system, every route drawn, unless something is broken, when the broken component opens selected; a deep link selects anything", () => {
  for (const state of [projectState(), crowdedState(), sharedState(), derivedState(), healthState()]) {
    const model = flowOf(state);
    const expected = opening(model);
    assert.equal(flowDefaultSelection(model), expected, "the default is nothing, or the broken component");
    assert.match(renderView(state, "structure").text, /The map opens on nothing selected, every route drawn and the whole system in view; when something is broken, the component with the most broken chokepoints/, "the key states the rule");
    assert.doesNotMatch(renderView(state, "structure").text, /busiest route/, "no word of the old default survives");
    delete state.structure.selected;
    const opened = renderView(state, "structure").text;
    assert.match(opened, new RegExp(`data-selected="${expected ?? ""}"`), "the page opens on that");
    const classes = [...opened.matchAll(/<g class="flow-route-group ?([^"]*)" id="([^"]+)"/g)].map((m) => [m[2]!, m[1]!.split(" ").filter(Boolean)] as const);
    assert.ok(classes.length > 0);
    if (expected === undefined) {
      for (const [id, cls] of classes) assert.deepEqual(cls, [], `${id} at rest is drawn whole: neither muted nor dimmed`);
      assert.match(opened, /<aside class="flow-inspector"[^>]*data-open="false"/, "nothing selected: the summary, not an inspector");
    } else {
      assert.match(opened, new RegExp(`<g class="flow-station[^"]*\\bis-selected\\b[^"]*" id="${expected}"`), "the broken component is selected");
      assert.match(opened, /<aside class="flow-inspector"[^>]*data-selection="component"[^>]*data-open="true" data-default="true"/, "its inspector is open, marked as the default story");
    }
    state.structure.selected = FLOW_NONE_ID;
    const cleared = renderView(state, "structure").text;
    assert.match(cleared, /data-selected=""/);
    for (const m of cleared.matchAll(/<g class="flow-route-group ?([^"]*)" id="([^"]+)"/g)) assert.deepEqual(m[1]!.split(" ").filter(Boolean), [], `${m[2]} is drawn whole once cleared`);
    const other = model.routes[0];
    if (other !== undefined) {
      state.structure.selected = other.id;
      assert.match(renderView(state, "structure").text, new RegExp(`<g class="flow-route-group is-lit[^"]*" id="${other.id}"`), "a deep link still selects any route");
    }
  }
  assert.ok(opening(flowOf(healthState()))!.endsWith("src-store"), "the fixture opens on its broken store");
  assert.match(answerStructure(healthState()).text, /the map opens on: src\/store, broken/, "the query says what the map opens on");
  assert.match(answerStructure(projectState()).text, /the map opens on: nothing selected, the whole system/);
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
  const target = new RegExp(`<g class="flow-tag[^"]*" data-edge="${flowEdgeId("src/core", "src/store")}" data-identifier="${writer.text}" data-state="verified" data-structure-select="${writer.chokepoint}" role="button" tabindex="0" aria-label="${writer.text}: single writer, verified 2026-09-20"`);
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
  assert.match(desktop, /\.flow-map\s*\{[^}]*grid-column:\s*1/, "the map (its health strip and canvas) has the other");
  const phone = block(/@media \(max-width: 63\.99rem\)/);
  assert.match(phone, /\.flow-inspector\[data-open="true"\]:not\(\[data-default="true"\]\)\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/, "below desktop width an inspector the reader opened is a sheet over the bottom of the screen; the default story's never is");
  const outside = css.replace(desktop, "").replace(phone, "");
  assert.doesNotMatch(outside, /\.flow-inspector[^{]*\{[^}]*position:\s*(fixed|absolute)/, "nowhere else does the inspector float over the map");
  assert.doesNotMatch(desktop, /\.flow-inspector[^{]*\{[^}]*position:\s*(fixed|absolute)/, "at desktop width it never floats");
  const page = renderView(projectState(), "structure").text;
  assert.match(page, /<div class="flow-stage">\s*<div class="flow-map">[^]*<div class="flow-canvas"[^]*<\/svg><\/div>[^]*?<\/div>\s*<\/div>\s*<\/div>\s*<aside class="flow-inspector"/, "the map and the inspector are siblings in the stage");
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
  assert.match(svg, new RegExp(`<g class="flow-route-group is-lit[^"]*" id="${route.id}"`), "the route is lit");
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
  assert.match(lit, new RegExp(`<g class="flow-tag [^"]*\\bis-lit\\b[^"]*" data-edge="${flowEdgeId("src/core", "src/store")}"`), "selecting a trust level lights its boundary crossings");
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
  assert.match(record, /<g class="flow-tag [^"]*\bis-lit\b[^"]*" data-rail="src\/journal" data-identifier="X2"/, "the boundary crossing on the stubs to the journal lights, on its rail");
  assert.match(record, new RegExp(`<g class="flow-tag [^"]*\\bis-dim\\b[^"]*" data-edge="${flowEdgeId("src/core", "src/store")}"`), "a crossing that does not carry record dims");
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
      return on.filter((pair) => pair.includes(" -> ")).map((pair) => `${text} ${pair}`);
    }).sort();
    const model = flowOf(state);
    const drawnIds = [...svg.matchAll(/<g class="flow-tag[^"]*" (?:data-edge="([^"]+)"|data-rail="[^"]+") data-identifier="([CX]\d+)" data-state="[a-z]+"(?: data-edges="([^"]+)")?/g)].flatMap((m) =>
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
  const { state } = await buildScopePage({ root: fixture.root, lexiconPath: COHERENCE_LEXICON, project: "Fixture", componentInterfaces: { kind: "read", language: "typescript", declarations: 3, symbols: [sym("src/api", "src/store", "write", "src/store/write.ts", 2), sym("src/api", "src/store", "writeRow", "src/store/rows.ts")], entrances: [], unowned: { files: 0, lines: 0 } } });
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
    assert.deepEqual(read.entrances, [{ component: ".", name: "go", file: "src/api/api.ts", reach: [{ from: "src/api", to: "src/store", symbol: "write", file: "src/store/rows.ts", sites: 2 }] }], "the handler's reach: its two calls into the store, not the import, which no declaration encloses");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------ health, trust, routes, inspector (the 2026-09-22 review) */

/** The flow fixture with every state: the journal's append a requirement, the store's writer a structural defect bypassed from the reader, and one crossing on an invariant with only a totality oracle. */
function healthState(): ShellState {
  const state = projectState({ states: { "append-only store": "requirement", "single writer": "structural defect" }, bypasses: { "single writer": [{ file: "src/reader/look.ts", line: 9, symbol: "peek" }, { file: "src/store/inner.ts", line: 4, symbol: "raw" }] } });
  const core = state.spec.components.find((c) => c.folder === "src/core")!;
  core.invariants.push({ ...core.invariants[0]!, name: "rows stay typed", sentence: "rows stay typed.", enforcements: [{ form: "totality oracle", over: "every row", via: "rows stay typed", line: 9 }] as SpecInvariant["enforcements"], crossing: { from: "outside", to: "record", line: 10 }, state: "invariant" });
  return state;
}

test("the health strip counts are the spec model's, each a selection whose inspector lists its set", async () => {
  const { state } = await buildScopePage({ root: fixture.root, lexiconPath: COHERENCE_LEXICON, project: "Fixture" });
  state.activeView = "structure";
  const model = flowOf(state);
  const page = renderView(state, "structure").text;
  const count = (kind: string): number => Number(new RegExp(`data-health="${kind}" data-count="(\\d+)"`).exec(page)![1]);
  assert.equal(count("verified"), state.spec.counts.invariants, "enforced and verified: the spec model's invariants");
  assert.equal(count("requirements"), state.spec.counts.requirements, "requirements: the spec model's");
  assert.equal(count("defects"), state.spec.counts.structuralDefects, "structural defects: the spec model's");
  for (const kind of FLOW_HEALTH_KINDS.filter((k) => k !== "escalations")) {
    const members = flowHealthMembers(model, kind);
    const inspector = renderView({ ...state, structure: { ...state.structure, selected: flowHealthId(kind) } }, "structure").text;
    assert.match(inspector, new RegExp(`data-kind="health" data-health="${kind}"`), `${kind} opens its inspector`);
    for (const member of members) assert.ok(inspector.includes(`data-invariant="${member.name.replace(/"/g, "&quot;")}"`), `${kind} lists ${member.name}`);
  }
  // Nothing enforced says so on the map, not in grey header text.
  const none = healthState();
  for (const c of none.spec.components) for (const i of c.invariants) i.state = "requirement";
  none.runs.records = [];
  assert.match(renderView(none, "structure").text, /data-field="nothing-enforced">Nothing is enforced yet/);
});

test("every identifier and every component is drawn in its invariant's state by fill: solid verified, hollow and hatched requirement, red broken, and a requirement reads not enforced first", () => {
  const state = healthState();
  const model = flowOf(state);
  const svg = renderFlowSvg(model, undefined).text;
  const drawn = [...svg.matchAll(/data-identifier="([CX]\d+)" data-state="([a-z]+)"/g)].map((m) => [m[1]!, m[2]!] as const);
  assert.ok(drawn.length > 0);
  for (const [text, drawnState] of drawn) {
    const identifier = model.identifiers.find((i) => i.text === text)!;
    assert.equal(drawnState, identifier.verdict.state, `${text} is drawn ${identifier.verdict.state}`);
    assert.match(svg, new RegExp(`<g class="flow-tag flow-tag-${drawnState}[^"]*"[^>]*data-identifier="${text}"`), `${text} wears the ${drawnState} style`);
  }
  assert.deepEqual([...new Set(drawn.map(([, s]) => s))].sort(), ["broken", "requirement", "verified"], "the fixture shows all three");
  const style = /<style>([^]*?)<\/style>/.exec(svg)![1]!;
  const rule = (selector: string): string => new RegExp(`${selector.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`).exec(style)?.[1] ?? "";
  assert.match(rule(".flow-svg .flow-tag-verified .flow-tag-shape"), /fill: var\(--flow-verified\)/, "verified is a solid fill");
  assert.match(rule(".flow-svg .flow-tag-requirement .flow-tag-shape"), /fill: url\(#flow-tag-hatch\)/, "a requirement is hollow and hatched");
  assert.doesNotMatch(rule(".flow-svg .flow-tag-requirement .flow-tag-shape"), /dasharray/, "the state is in the fill, not in a dashed outline's weight");
  assert.match(rule(".flow-svg .flow-tag-broken .flow-tag-shape"), /fill: var\(--flow-defect(?:-fill)?\)/, "broken is a red fill");
  assert.match(svg, /<pattern id="flow-tag-hatch"/, "the hatch is drawn");
  for (const node of model.nodes.filter((n) => !n.core && n.state !== undefined)) {
    assert.match(svg, new RegExp(`id="${node.id}"[^>]*data-state="${node.state}"[^]*?data-state-bar="${node.state}"`), `${node.folder} carries its worst verdict, ${node.state}, as a drawn bar`);
  }
  // A requirement's words never read as a pass: "not enforced" leads, on the map's title and in the inspector.
  const requirement = model.identifiers.find((i) => i.verdict.state === "requirement")!;
  assert.match(requirement.verdict.label, /^not enforced · requirement/);
  state.structure.selected = requirement.chokepoint;
  assert.match(renderView(state, "structure").text, /data-field="verdict"><span class="flow-verdict" data-verdict-state="requirement"><span class="flow-verdict-swatch" aria-hidden="true"><\/span>not enforced · requirement/, "the inspector's label leads with not enforced");
  for (const i of allInvariants(state.spec.components)) {
    const label = invariantVerdict(i, state.runs.records).label;
    assert.ok(invariantVerdict(i, state.runs.records).state !== "requirement" || label.startsWith("not enforced"), `${i.name}: "${label}"`);
  }
});

test("a component with a broken chokepoint carries a broken mark on its box that lists every bypass site, inside ones named as inside", () => {
  const state = healthState();
  const model = flowOf(state);
  const store = model.nodes.find((n) => n.folder === "src/store")!;
  const layout = flowLayout(model);
  const mark = layout.tags.find((t) => t.kind === "broken" && t.node === "src/store");
  assert.ok(mark !== undefined, "the store's broken mark is drawn");
  const station = layout.stations.get("src/store")!;
  const touches = mark.box.x <= station.x + station.w + 0.5 && mark.box.x + mark.box.w >= station.x - 0.5 && mark.box.y <= station.y + station.h + 0.5 && mark.box.y + mark.box.h >= station.y - 0.5;
  assert.ok(touches, "attached to its box, not floating");
  assert.match(renderFlowSvg(model, undefined).text, new RegExp(`data-mark="broken" data-state="broken" data-structure-select="${flowBrokenId("src/store")}" role="button"`), "the mark is a button");
  state.structure.selected = flowBrokenId("src/store");
  const inspector = renderView(state, "structure").text;
  assert.match(inspector, /data-kind="broken"/);
  for (const site of store.defects[0]!.sites) assert.ok(inspector.includes(`<code>${site.file}:${site.line}</code>`), `${site.file}:${site.line} is listed`);
  assert.match(inspector, /data-inside="true"[^]*<span class="label">inside<\/span>/, "a bypass inside the component is listed and named as inside");
  const allInside = projectState({ states: { "single writer": "structural defect" }, bypasses: { "single writer": [{ file: "src/store/inner.ts", line: 4, symbol: "raw" }] } });
  allInside.structure.selected = flowBrokenId("src/store");
  assert.match(renderView(allInside, "structure").text, /All 1 bypass sit inside Store, so no component interface carries them; they are listed here/);
});

test("every crossing is drawn: on its interface, on the entrance line it guards, or on its component's boundary mark", () => {
  for (const state of [healthState(), projectState(), crowdedState(), trustState()]) {
    const model = flowOf(state);
    const svg = renderFlowSvg(model, undefined).text;
    assert.equal(model.crossings.length, allInvariants(state.spec.components).filter((i) => i.crossing !== undefined).length, "every crossing-bearing invariant is placed");
    for (const crossing of model.crossings) {
      const identifier = model.identifiers.find((i) => i.component === crossing.component && i.name === crossing.name);
      const onInterface = identifier !== undefined && (svg.includes(`data-identifier="${identifier.text}"`));
      const onEntrance = identifier !== undefined && crossing.routes.some((id) => svg.includes(`data-entry="${id}" data-identifier="${identifier.text}"`));
      const onComponent = crossing.on === "component" && svg.includes(`data-node="${crossing.component}" data-mark="boundary"`);
      assert.ok(onInterface || onEntrance || onComponent, `${crossing.component}/${crossing.name} (${crossing.from} -> ${crossing.to}) is drawn (${crossing.on})`);
      if (crossing.on === "component") assert.ok(onComponent, `${crossing.name} stands on no interface, so its component carries it on its boundary mark`);
    }
    for (const level of model.levels) assert.deepEqual(level.unplaced, [], `${level.name}: no crossing stands nowhere`);
  }
  const model = flowOf(healthState());
  assert.equal(model.crossings.find((c) => c.name === "rows stay typed")!.on, "component", "a crossing whose invariant has only a totality oracle has no chokepoint to stand on an interface");
});

test("selecting any trust level lights at least one drawn thing, and only the identifiers whose crossing carries it", () => {
  for (const state of [healthState(), projectState(), crowdedState(), trustState()]) {
    const model = flowOf(state);
    for (const level of model.levels) {
      if (!model.crossings.some((c) => c.from === level.name || c.to === level.name)) continue;
      const svg = renderFlowSvg(model, level.id).text;
      const lit = [...svg.matchAll(/<g class="flow-tag [^"]*\bis-lit\b[^"]*"[^>]*?(?:data-identifier="([CX]\d+)"|data-mark="boundary")/g)];
      assert.ok(lit.length > 0, `${level.name} lights something`);
      for (const m of lit) {
        if (m[1] === undefined) continue;
        const crossing = model.identifiers.find((i) => i.text === m[1])!.crossing;
        assert.ok(crossing !== undefined && (crossing.from === level.name || crossing.to === level.name), `${m[1]} lights only because its crossing carries ${level.name}`);
      }
    }
  }
});

/** The flow fixture's hooks handler is itself a chokepoint with a crossing: entrances it handles carry that trust in; another handled beside it does not. */
function trustState(): ShellState {
  const state = projectState({ symbols: [...SYMBOLS, sym(".", "src/hooks", "tickHooks", "src/hooks/run.ts", 1)] });
  const hooks = state.spec.components.find((c) => c.folder === "src/hooks")!;
  hooks.entrances = [
    { name: "hook event", meaning: "the host sends an event", handler: "runHooks in run.ts", line: 3, handlerLine: 4, component: "src/hooks", file: "src/hooks/run.ts" },
    { name: "tick", meaning: "a timer fires", handler: "tickHooks in run.ts", line: 5, handlerLine: 6, component: "src/hooks", file: "src/hooks/run.ts" },
  ];
  hooks.invariants = [{ ...state.spec.components.find((c) => c.folder === "src/store")!.invariants[0]!, component: "src/hooks", name: "the hook answers one project", enforcements: [{ form: "chokepoint", chokepoint: "runHooks", protects: "cwd", line: 6 }], crossing: { from: "outside", to: "inside", line: 7 } }];
  if (state.componentInterfaces.kind === "read") state.componentInterfaces.entrances = [...state.componentInterfaces.entrances, { component: "src/hooks", name: "hook event", file: "src/hooks/run.ts" }, { component: "src/hooks", name: "tick", file: "src/hooks/run.ts" }];
  state.runs.records[0]!.invariants.push({ component: "src/hooks", name: "the hook answers one project", form: "chokepoint", verdict: "pass", grade: "reference-choked", refutation: "automatic", bypasses: [], testReferences: 0, files: [], latency: 1, reason: "fixture" });
  return state;
}

test("entrances whose trust differs get their own routes, and an entrance's own chokepoint crosses on the line where work enters", () => {
  const model = flowOf(trustState());
  const event = model.entrances.find((e) => e.name === "hook event")!;
  const tick = model.entrances.find((e) => e.name === "tick")!;
  assert.deepEqual(event.trust, ["outside"], "the handler is the chokepoint of a crossing from outside");
  assert.deepEqual(tick.trust, []);
  const eventRoute = model.routes.find((r) => r.entrances.includes(event.id))!;
  const tickRoute = model.routes.find((r) => r.entrances.includes(tick.id))!;
  assert.deepEqual(eventRoute.stops, tickRoute.stops, "the same path");
  assert.notEqual(eventRoute.id, tickRoute.id, "different trust, different routes");
  const identifier = model.identifiers.find((i) => i.name === "the hook answers one project")!;
  assert.deepEqual(eventRoute.entry, [identifier.text]);
  const svg = renderFlowSvg(model, flowLevelId("outside")).text;
  assert.match(svg, new RegExp(`<g class="flow-tag [^"]*\\bis-lit\\b[^"]*" data-entry="${eventRoute.id}" data-identifier="${identifier.text}"[^>]*>[^]*?class="flow-boundary"`), "the outside trust level visibly crosses on the entrance line, with its boundary");
  // Entrances that share both path and trust share a route.
  const shared = flowOf(sharedState()).routes.find((r) => r.entrances.includes(flowEntranceId(".", "run")))!;
  assert.equal(shared.entrances.length, 2);
});

test("with the handler's reach read, a route follows the handler and stops where its work ends: never through a utility another component calls, never a type", () => {
  const withReach = (reach: ReachReference[]): ShellState => {
    const state = projectState({ symbols: [...SYMBOLS, sym("src/hooks", "src/core", "hookCore", "src/core/hook.ts", 2)] });
    if (state.componentInterfaces.kind === "read") state.componentInterfaces.entrances = state.componentInterfaces.entrances.map((e) => (e.name === "run" ? { ...e, reach } : e));
    return state;
  };
  // door is also called by the reader: a utility, so the route ends at the hooks.
  const utility = flowOf(withReach([{ from: "src/hooks", to: "src/core", symbol: "door", file: "src/core/door.ts", sites: 3 }])).routes.find((r) => r.entrances.includes(flowEntranceId(".", "run")))!;
  assert.deepEqual(utility.stops, [".", "src/hooks"]);
  assert.equal(utility.followed, "reach");
  // hookCore only the hooks call; write only the core calls: the route follows both, and no further.
  const dedicated = flowOf(withReach([{ from: "src/hooks", to: "src/core", symbol: "hookCore", file: "src/core/hook.ts", sites: 2 }, { from: "src/core", to: "src/store", symbol: "write", file: "src/store/write.ts", sites: 1 }])).routes.find((r) => r.entrances.includes(flowEntranceId(".", "run")))!;
  assert.deepEqual(dedicated.stops, [".", "src/hooks", "src/core", "src/store"]);
  // Without a reach the route is reference weight, and says so.
  assert.equal(flowOf(projectState()).routes[0]!.followed, "weight");
  assert.match(renderView({ ...projectState(), structure: { selected: flowOf(projectState()).routes[0]!.id, preview: [] } } as ShellState, "structure").text, /By <[^>]+>reference weight<\/[a-z]+>, not flow/);
});

test("an origin token shows at most four entrance names and a count of the rest; the route's inspector lists every one", () => {
  const state = projectState();
  const root = state.spec.components.find((c) => c.folder === ".")!;
  const extra = ["replay", "rewind", "resume", "retry", "rerun"];
  root.entrances = [...root.entrances, ...extra.map((name, i): SpecEntrance => ({ name, meaning: `${name} enters`, handler: "runHooks in src/hooks/run.ts", line: 20 + i, handlerLine: 21 + i, component: ".", file: "src/hooks/run.ts" }))];
  if (state.componentInterfaces.kind === "read") state.componentInterfaces.entrances = [...state.componentInterfaces.entrances, ...extra.map((name) => ({ component: ".", name, file: "src/hooks/run.ts" }))];
  const model = flowOf(state);
  const route = model.routes.find((r) => r.entrances.includes(flowEntranceId(".", "run")))!;
  assert.equal(route.names.length, 6);
  assert.deepEqual(terminusLines(renderFlowSvg(model, undefined).text, route.id).map((l) => l.text), ["run", "replay", "rewind", "resume", "+2 more"]);
  state.structure.selected = route.id;
  const inspector = renderView(state, "structure").text;
  for (const name of route.names) assert.match(inspector, new RegExp(`data-field="entrances"[^]*>${name}</button>`), `${name} is listed when the route is selected`);
});

test("a selected component shows direction: its callers and callees are drawn apart, and its inspector gives its verdict, then who depends on it and what it uses, then its invariants, the first few shown and the rest folded", () => {
  const state = healthState();
  const model = flowOf(state);
  const core = flowSelection(model, flowNodeId("src/core"));
  assert.deepEqual([...core.into].sort(), model.edges.filter((e) => e.to === "src/core").map((e) => e.id).sort(), "into: every interface whose callee is the core");
  assert.deepEqual([...core.outOf].sort(), model.edges.filter((e) => e.from === "src/core").map((e) => e.id).sort(), "out of: every interface whose caller is the core");
  const svg = renderFlowSvg(model, flowNodeId("src/core")).text;
  for (const id of core.into) {
    const caller = model.edges.find((e) => e.id === id)!.from;
    const station = model.nodes.find((n) => n.folder === caller)!;
    if (!station.core) assert.match(svg, new RegExp(`<g class="flow-station[^"]*\\bis-caller\\b[^"]*" id="${station.id}"[^>]*data-standing="caller"`), `${caller} is drawn as a caller`);
  }
  for (const id of core.outOf) {
    const callee = model.nodes.find((n) => n.folder === model.edges.find((e) => e.id === id)!.to)!;
    if (!callee.core) assert.match(svg, new RegExp(`<g class="flow-station[^"]*\\bis-callee\\b[^"]*" id="${callee.id}"[^>]*data-standing="callee"`), `${callee.folder} is drawn as a callee`);
  }
  const reader = renderFlowSvg(flowOf(projectState()), flowNodeId("src/reader")).text;
  assert.match(reader, /class="flow-line flow-faint is-lit is-out"/, "a faint line to a callee is dashed out");
  const hooks = renderFlowSvg(flowOf(projectState()), flowNodeId("src/core")).text;
  assert.match(hooks, /<g class="flow-station[^"]*\bis-caller\b/, "a caller station");
  const style = /<style>([^]*?)<\/style>/.exec(svg)![1]!;
  assert.match(style, /\.flow-station\.is-callee \.flow-box \{[^}]*stroke-dasharray/, "callees are dashed, callers solid: a static distinction with or without motion");
  // The inspector: verdict, callers, callees, then invariants with the rest folded.
  const many = healthState();
  const store = many.spec.components.find((c) => c.folder === "src/store")!;
  store.invariants.push(...["a", "b", "c", "d", "e"].map((suffix, i) => ({ ...store.invariants[0]!, name: `store rule ${suffix}`, line: 20 + i, enforcements: [{ form: "totality oracle", over: "rows", via: "x", line: 21 + i }] as SpecInvariant["enforcements"], crossing: undefined, state: "invariant" as const })));
  many.structure.selected = flowNodeId("src/store");
  const inspector = /<aside class="flow-inspector"[^>]*>([^]*?)<\/aside>/.exec(renderView(many, "structure").text)![1]!;
  const at = (field: string): number => inspector.indexOf(`data-field="${field}"`);
  assert.ok(at("own-verdicts") > 0, "a verdict summary");
  assert.ok(at("own-verdicts") < at("callers") && at("callers") < at("callees") && at("callees") < at("own-invariants") && at("own-invariants") < at("routes"), "verdict, callers, callees, invariants, then routes");
  assert.match(inspector, /data-field="own-verdicts">1 broken, 5 verified/, "broken first in the summary");
  assert.match(inspector, /Who depends on it <span class="flow-count">2<\/span>[^]*← src\/core/, "who depends on it: its callers, by name");
  const shown = /data-field="invariants">([^]*?)<\/ul>/.exec(inspector)![1]!;
  assert.equal([...shown.matchAll(/data-invariant=/g)].length, 4, "the first four invariants are shown");
  assert.match(shown, /data-invariant="single writer" data-verdict-state="broken"/, "broken first");
  assert.match(inspector, /<details class="flow-more flow-invariants-more"><summary>\+2 more<\/summary>/, "the rest are folded, counted");
});

test("one verdict per invariant: the inspector shows one dated state, and every per-enforcement record and test command is folded", () => {
  const state = projectState();
  state.runs.records.push({ ...state.runs.records[0]!, at: "2026-09-21T10:00:00.000Z", invariants: [] });
  state.structure.selected = flowChokepointId("src/store", "single writer");
  const inspector = /<aside class="flow-inspector"[^>]*>([^]*?)<\/aside>/.exec(renderView(state, "structure").text)![1]!;
  assert.equal([...inspector.matchAll(/data-field="verdict"/g)].length, 1);
  assert.match(inspector, /data-field="verdict"><span class="flow-verdict" data-verdict-state="verified">[^]*?verified 2026-09-20/);
  const unfolded = inspector.replace(/<details[^]*?<\/details>/g, "");
  assert.doesNotMatch(unfolded, /kept from an earlier run|not run|data-verdict="/, "no second verdict outside the folds");
  assert.doesNotMatch(inspector, /<details[^>]*\bopen\b/, "every fold starts closed");
});

test("below the side-by-side width the default story's inspector never opens over the map", () => {
  const state = healthState();
  delete state.structure.selected;
  assert.match(renderView(state, "structure").text, /<aside class="flow-inspector"[^>]*data-open="true" data-default="true"/, "the default story (the broken component) is marked");
  state.structure.selected = flowNodeId("src/core");
  assert.match(renderView(state, "structure").text, /<aside class="flow-inspector"[^>]*data-open="true" data-default="false"/, "a reader's choice is not");
});

test("token text clears 4.5:1 against the token's own tinted fill for every route color, light and dark, and white clears it on the broken fill", () => {
  const svg = renderFlowSvg(flowOf(healthState()), undefined).text;
  const style = /<style>([^]*?)<\/style>/.exec(svg)![1]!;
  // The two themes as the map's own style paints them: the light rules, and the dark ones inside the dark media query.
  let light = "";
  let dark = "";
  for (let at = 0; at < style.length;) {
    const media = style.indexOf("@media (prefers-color-scheme: dark)", at);
    if (media === -1) {
      light += style.slice(at);
      break;
    }
    light += style.slice(at, media);
    let depth = 0;
    let end = style.indexOf("{", media);
    for (let i = end; i < style.length; i++) {
      if (style[i] === "{") depth += 1;
      if (style[i] === "}") depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    dark += style.slice(media, end + 1);
    at = end + 1;
  }
  const value = (css: string, name: string): string => {
    const found = new RegExp(`${name}: (#[0-9a-f]{6});`).exec(css);
    assert.ok(found !== null, `${name} is painted as an opaque color`);
    return found[1]!;
  };
  // The ink is what the token's text is filled with; the fill is what the token's outline is filled with.
  assert.match(style, /\.flow-svg \.flow-origin, \.flow-svg \.flow-origin-more \{ fill: var\(--flow-token-ink\); \}/, "token text is the token ink");
  for (const m of svg.matchAll(/<path class="flow-origin-token" d="[^"]+" fill="var\((--flow-token-[a-z0-9]+)\)"/g)) assert.ok(style.includes(`${m[1]}:`), `${m[1]} is defined`);
  assert.ok(/<path class="flow-origin-token"/.test(svg), "tokens are drawn");
  const slots = [...FLOW_ROUTE_COLORS.map((_, i) => String(i)), "neutral"];
  for (const [theme, css] of [["light", light], ["dark", dark]] as const) {
    const ink = value(css, "--flow-token-ink");
    for (const slot of slots) {
      const fill = value(css, `--flow-token-${slot}`);
      const ratio = contrast(ink, fill);
      assert.ok(ratio >= 4.5, `${theme} route ${slot}: ${ink} on its token fill ${fill} at ${ratio.toFixed(2)}:1`);
    }
    const broken = value(css, "--flow-defect-fill");
    assert.ok(contrast("#ffffff", broken) >= 4.5, `${theme}: white on the broken fill ${broken} at ${contrast("#ffffff", broken).toFixed(2)}:1`);
  }
  assert.match(style, /\.flow-tag-broken \.flow-tag-shape \{ fill: var\(--flow-defect-fill\);[^}]*\}\s*\.flow-svg \.flow-tag-broken text \{ fill: #ffffff; \}/, "a broken mark is white on the broken fill");
  assert.doesNotMatch(style, /--flow-route-ink/, "no per-color ink");
});

test("jargon links to its definition where the key and the inspector first show it", () => {
  const state = projectState();
  const page = renderView(state, "structure").text;
  const key = /data-field="key"[^]*/.exec(page)![0]!;
  for (const term of ["chokepoint", "crossing", "core-dependency", "requirement"]) assert.match(key, new RegExp(`<a class="flow-term" href="#coherence-${term}" title="[^"]+">`), `${term} links to the lexicon`);
  for (const term of ["bypass", "derived"]) assert.match(key, new RegExp(`<dfn class="flow-term" title="[^"]+">`), `${term} is defined in place`);
});

/* ------------------------------------------------ the clarity pass (the 2026-09-23 review) */

/** The flow fixture with one more entrance, handled in the reader: its route (root, reader, store) has no identifier on it anywhere. */
function untracedState(): ShellState {
  const state = projectState({ symbols: [...SYMBOLS, sym(".", "src/reader", "lookup", "src/reader/look.ts", 1)] });
  const root = state.spec.components.find((c) => c.folder === ".")!;
  root.entrances = [...root.entrances, { name: "look", meaning: "a reader looks", handler: "lookup in src/reader/look.ts", line: 12, handlerLine: 13, component: ".", file: "src/reader/look.ts" }];
  if (state.componentInterfaces.kind === "read") state.componentInterfaces.entrances = [...state.componentInterfaces.entrances, { component: ".", name: "look", file: "src/reader/look.ts" }];
  return state;
}

/** The hue (0 to 360) and HSL saturation of a #rrggbb color. */
function hueOf(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { hue: 0, saturation: 0 };
  const saturation = d / (1 - Math.abs(2 * l - 1));
  const hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { hue: (hue + 360) % 360, saturation };
}

test("red means broken: no route or rail color reads as red, orange or amber, the selection is a neutral halo no route wears, and nothing enforced, crossing counts and trust boundaries never use the broken color", () => {
  for (const [light, dark] of [...FLOW_ROUTE_COLORS, ...FLOW_RAIL_COLORS, FLOW_NEUTRAL_ROUTE]) {
    for (const color of [light, dark]) {
      const { hue, saturation } = hueOf(color);
      const red = (hue >= 340 || hue <= 20) && saturation > 0.3;
      const orange = hue > 20 && hue <= 65 && saturation > 0.45;
      assert.ok(!red && !orange, `${color} (hue ${hue.toFixed(0)}, saturation ${saturation.toFixed(2)}) reads as red, orange or amber`);
    }
  }
  const svg = renderFlowSvg(flowOf(healthState()), flowNodeId("src/core")).text;
  const style = /<style>([^]*?)<\/style>/.exec(svg)![1]!;
  assert.doesNotMatch(style, /--flow-lit/, "no orange selection color");
  const value = (name: string): string => new RegExp(`${name}: ([^;]+);`).exec(style)![1]!;
  const colors = new Set([...FLOW_ROUTE_COLORS.flat(), ...FLOW_RAIL_COLORS.flat(), ...FLOW_NEUTRAL_ROUTE]);
  assert.ok(!colors.has(value("--flow-select")) && value("--flow-select") === value("--flow-ink"), "the selection is the ink, a color no route wears");
  assert.match(style, /\.flow-station\.is-selected \.flow-box \{ stroke: var\(--flow-select\)/);
  assert.match(style, /\.flow-halo \{ fill: none; stroke: var\(--flow-halo\)/, "and a halo");
  assert.match(svg, /<(?:rect|path) class="flow-halo"/, "the selected component wears its halo");
  assert.ok(!["#b3261e", "#c32836", "#e5484d", "#ff8a80"].includes(value("--flow-boundary")), "a trust boundary is not drawn red");
  // A component whose crossings inside it include a broken one: its count is neutral, never red.
  const brokenInside = healthState();
  brokenInside.spec.components.find((c) => c.folder === "src/core")!.invariants.find((i) => i.name === "rows stay typed")!.state = "structural defect";
  const chip = /<g class="flow-tag ([^"]*)" data-node="src\/core" data-mark="boundary"/.exec(renderFlowSvg(flowOf(brokenInside), flowNodeId("src/core")).text);
  assert.ok(chip !== null, "the core's crossing count shows while it is selected");
  assert.match(chip[1]!, /flow-tag-boundary/);
  assert.doesNotMatch(chip[1]!, /flow-tag-broken|flow-tag-mark/, "never red");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = (selector: string): string => new RegExp(`\\n${selector.replace(/[.[\]"=]/g, (c) => `\\${c}`)} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  assert.match(block(".flow-health-note"), /var\(--flow-key-attention\)/, "nothing enforced is amber attention");
  assert.doesNotMatch(block(".flow-health-note"), /--fail/, "never red");
  assert.doesNotMatch(renderView(healthState(), "structure").text.replace(/<svg[^]*?<\/svg>/g, ""), /stroke="var\(--fail\)"/, "the key draws no trust boundary in red");
});

test("the masthead leads with health: one verdict in large type that links to its set, with the counts demoted beneath it", () => {
  const verdictOf = (state: ShellState): { kind: string; href: string; text: string; page: string } => {
    const page = renderView(state, "lexicon").text;
    const m = /<a class="verdict" data-field="verdict" data-verdict="([a-z]+)" href="#([^"]+)">([^<]+)<\/a>/.exec(page);
    assert.ok(m !== null, "the masthead carries a verdict");
    return { kind: m[1]!, href: m[2]!, text: m[3]!, page };
  };
  const healthy = verdictOf(projectState());
  assert.deepEqual([healthy.kind, healthy.text, healthy.href], ["verified", "All 3 invariants verified", flowHealthId("verified")]);
  assert.ok(healthy.page.indexOf('data-field="verdict"') < healthy.page.indexOf('data-field="model-counts"'), "the verdict comes before the counts");
  assert.doesNotMatch(/<div class="masthead">[^]*?<\/div>/.exec(healthy.page)![0], /bullets?\b/, "no implementation noun in the masthead");
  const none = projectState({ states: { "one door": "requirement", "append-only store": "requirement", "single writer": "requirement" } });
  none.runs.records = [];
  const nothing = verdictOf(none);
  assert.deepEqual([nothing.kind, nothing.text, nothing.href], ["nothing", "Nothing is enforced yet", flowHealthId("requirements")]);
  const broken = verdictOf(healthState());
  assert.deepEqual([broken.kind, broken.text, broken.href], ["broken", "1 broken", flowBrokenId("src/store")], "one broken component: the verdict opens its broken mark");
  assert.match(broken.page, /data-field="verdict-detail">1 requirement not enforced yet/);
  assert.deepEqual(resolveHash(healthState(), `#${broken.href}`), { view: "structure", id: broken.href }, "the link lands on the map's selection");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const size = (selector: string): string => new RegExp(`\\n${selector.replace(/\./g, "\\.")} \\{[^}]*font-size: ([^;]+);`).exec(css)![1]!;
  assert.match(size(".masthead .verdict"), /clamp\(1\.375rem/, "large type");
  assert.equal(size(".masthead .meta-counts"), "0.8125rem", "the counts are small");
});

/** The vertices of a path of absolute M and L commands. */
function pointsOfPath(d: string): [number, number][] {
  const n = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return n.flatMap((_, i) => (i % 2 === 0 ? [[n[i]!, n[i + 1]!] as [number, number]] : []));
}

/** The box a path of absolute M and L commands spans: a cut-corner token's or station's outline. */
function spanOfPath(d: string): { x: number; y: number; w: number; h: number } {
  const pts = pointsOfPath(d);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** An origin token's body: the box its front card spans without the tip of its point. */
function bodyOfPath(d: string): { x: number; y: number; w: number; h: number } {
  const pts = pointsOfPath(d);
  const right = Math.max(...pts.map((p) => p[0]));
  const xs = pts.map((p) => p[0]).filter((x) => x < right - 0.05);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Every card of a route group's origin token, back to front: the outlines of its back cards, then its front card's. */
function cardsOf(group: string): string[] {
  return [...group.matchAll(/<path class="flow-origin-(?:card flow-origin-card-\d|token)" d="([^"]+)"/g)].map((m) => m[1]!);
}

test("the trust tag sits outside its token, right-aligned beneath it, and never overlaps", () => {
  const apart = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
  let checked = 0;
  // Two stations one above the other whose blocks of tokens would meet: the hooks' two routes and the reader's own, each
  // with more names than a token shows.
  const packed = trustState();
  const entering = (folder: string, names: string[], handler: string, file: string): void => {
    const component = packed.spec.components.find((c) => c.folder === folder)!;
    component.entrances = [...component.entrances, ...names.map((name, i): SpecEntrance => ({ name, meaning: `${name} enters`, handler, line: 20 + i, handlerLine: 21 + i, component: folder, file }))];
    if (packed.componentInterfaces.kind === "read") packed.componentInterfaces.entrances = [...packed.componentInterfaces.entrances, ...names.map((name) => ({ component: folder, name, file }))];
  };
  entering("src/hooks", ["hook replay", "hook retry", "hook drain", "hook flush"], "runHooks in run.ts", "src/hooks/run.ts");
  entering("src/hooks", ["tick fast", "tick slow", "tick idle", "tick burst"], "tickHooks in run.ts", "src/hooks/run.ts");
  entering("src/hooks", ["drain", "drain fast", "drain slow", "drain idle", "drain burst"], "drainHooks in run.ts", "src/hooks/run.ts");
  const drain = packed.spec.components.find((c) => c.folder === "src/hooks")!;
  drain.invariants = [...drain.invariants, { ...drain.invariants[0]!, name: "the drain answers one queue", enforcements: [{ form: "chokepoint", chokepoint: "drainHooks", protects: "queue", line: 30 }], crossing: { from: "record", to: "inside", line: 31 } }];
  entering("src/reader", ["read one", "read many", "read all", "read tail", "read head"], "lookup in look.ts", "src/reader/look.ts");
  for (const state of [projectState(), trustState(), untracedState(), crowdedState(), sharedState(), healthState(), packed]) {
    const model = flowOf(state);
    const selections = [undefined, ...model.routes.map((r) => r.id), ...model.nodes.map((n) => n.id), ...model.levels.map((l) => l.id)];
    for (const selected of selections) {
      const svg = renderFlowSvg(model, selected).text;
      const layout = flowLayout(model, flowSelection(model, selected));
      const measured = measureSvg(svg);
      const drawn: { what: string; box: { x: number; y: number; w: number; h: number } }[] = [];
      for (const route of model.routes.filter((r) => r.derived)) {
        const group = new RegExp(`<g class="flow-route-group[^"]*" id="${route.id}"[^>]*>([^]*?)</g>\\s*</g>`).exec(svg)![1]!;
        for (const card of cardsOf(group)) drawn.push({ what: `${route.id} token`, box: spanOfPath(card) });
      }
      for (const route of model.routes.filter((r) => !r.derived)) {
        const group = new RegExp(`<g class="flow-route-group[^"]*" id="${route.id}"[^>]*>([^]*?)</g>\\s*</g>`).exec(svg)![1]!;
        // The token's body: its front card without its point, whose base is the edge the tag is right-aligned under.
        const token = bodyOfPath(/<path class="flow-origin-token" d="([^"]+)"/.exec(group)![1]!);
        const tag = /<g class="flow-trust[^"]*" data-trust-tag="([^"]+)"[^>]*>[^]*?<text class="flow-trust-text flow-mono" x="([\d.]+)" y="([\d.]+)" font-size="(\d+)">([^<]+)<\/text>/.exec(group);
        assert.ok(tag !== null, `${route.id}: its trust tag is placed`);
        const size = Number(tag[4]);
        const box = { x: Number(tag[2]), y: Number(tag[3]) - size * 0.78, w: textWidth(tag[5]!, size, false, 0, true), h: size };
        assert.ok(!group.slice(0, group.indexOf("<g class=\"flow-trust")).includes("flow-trust-text"), `${route.id}: no tag inside the token`);
        assert.ok(box.y >= token.y + token.h, `${route.id}: the tag is beneath its token, outside it (tag top ${box.y}, token bottom ${token.y + token.h})`);
        assert.ok(box.y - (token.y + token.h) <= 4, `${route.id}: and hangs from it`);
        assert.ok(Math.abs(box.x + box.w - (token.x + token.w)) <= 0.5, `${route.id}: right-aligned under the base of the token's point (${box.x + box.w} against ${token.x + token.w})`);
        for (const station of layout.stations.values()) assert.ok(apart(box, station), `${route.id}: the tag overlaps the station ${station.folder}`);
        const others = measured.texts.filter((t) => !(Math.abs(t.x - box.x) < 0.05 && Math.abs(t.y - box.y) < 0.05 && t.text === tag[5]));
        for (const other of others) assert.ok(apart(box, other), `${route.id}: the tag overlaps "${other.text}"`);
        for (const card of cardsOf(group)) drawn.push({ what: `${route.id} token`, box: spanOfPath(card) });
        drawn.push({ what: `${route.id} tag`, box });
        checked += 1;
      }
      // No token (any card of its stack, its point included) or tag touches another, whichever station's routes they begin.
      for (let a = 0; a < drawn.length; a++) for (let b = a + 1; b < drawn.length; b++) assert.ok(drawn[a]!.what === drawn[b]!.what ||apart(drawn[a]!.box, drawn[b]!.box), `${drawn[a]!.what} and ${drawn[b]!.what} overlap`);
    }
  }
  assert.ok(checked > 40, `tags checked: ${checked}`);
  // A tag wider than the margin never widens the map: it is dropped, and the route's inspector still states the trust.
  const long = "a-trust-level-whose-name-is-far-wider-than-the-margin-holds";
  const wide = trustState();
  wide.spec.components.find((c) => c.folder === "src/hooks")!.invariants[0]!.crossing = { from: long, to: "inside", line: 7 };
  const before = flowLayout(flowOf(trustState()));
  const model = flowOf(wide);
  const after = flowLayout(model);
  const route = model.routes.find((r) => r.trust.includes(long))!;
  assert.equal(after.width, before.width, "the map is no wider");
  assert.equal(route.trustSource, "derived");
  assert.ok(!after.dropped.includes(`trust ${route.id}`) && after.texts.some((t) => t.key === `trust ${route.id}` && t.text === "derived"), "a derived level that does not fit still says it is derived");
  const page = renderView({ ...wide, structure: { selected: route.id, preview: [] } } as ShellState, "structure").text;
  assert.match(page, new RegExp(`data-field="trust">${long}</span> <span class="flow-meta" data-field="trust-source">\\(derived\\)`), "and the route's inspector states it");
  // A declared level too wide for the margin is dropped, and the inspector still states it.
  const declared = trustState();
  declared.spec.components.find((c) => c.folder === "src/hooks")!.entrances[0]!.trust = long;
  declared.spec.components.find((c) => c.folder === "src/hooks")!.invariants[0]!.crossing = { from: long, to: "inside", line: 7 };
  const declaredModel = flowOf(declared);
  const declaredLayout = flowLayout(declaredModel);
  const declaredRoute = declaredModel.routes.find((r) => r.names.includes("hook event"))!;
  assert.equal(declaredRoute.trustSource, "declared");
  assert.equal(declaredLayout.width, before.width, "the map is no wider");
  assert.ok(declaredLayout.dropped.includes(`trust ${declaredRoute.id}`), "the declared tag that does not fit is dropped");
  assert.match(renderView({ ...declared, structure: { selected: declaredRoute.id, preview: [] } } as ShellState, "structure").text, new RegExp(`data-field="trust">${long}</span> <span class="flow-meta" data-field="trust-source">\\(declared\\)`));
});

/** Routes whose tokens stand for one, two, three and six entrances, stacked at one station and at the next. */
function stackState(): ShellState {
  const state = trustState();
  const entering = (folder: string, names: string[], handler: string, file: string): void => {
    const component = state.spec.components.find((c) => c.folder === folder)!;
    component.entrances = [...component.entrances, ...names.map((name, i): SpecEntrance => ({ name, meaning: `${name} enters`, handler, line: 40 + i, handlerLine: 41 + i, component: folder, file }))];
    if (state.componentInterfaces.kind === "read") state.componentInterfaces.entrances = [...state.componentInterfaces.entrances, ...names.map((name) => ({ component: folder, name, file }))];
  };
  entering("src/hooks", ["tick slow"], "tickHooks in run.ts", "src/hooks/run.ts");
  entering("src/hooks", ["drain", "drain fast", "drain slow", "drain idle", "drain burst", "drain all"], "drainHooks in run.ts", "src/hooks/run.ts");
  entering("src/reader", ["read one", "read many", "read all"], "lookup in look.ts", "src/reader/look.ts");
  return state;
}

test("origin tokens point into the system and stack by entrance count: one card per entrance up to three, the route leaves from the point's tip, a station never points, and no card overlaps anything", () => {
  const apart = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
  const within = (inner: { x: number; y: number; w: number; h: number }, outer: { x: number; y: number; w: number; h: number }): boolean => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;
  const counts = new Set<number>();
  let checked = 0;
  for (const state of [projectState(), trustState(), untracedState(), crowdedState(), sharedState(), healthState(), derivedState(), stackState()]) {
    const model = flowOf(state);
    for (const selected of [undefined, ...model.routes.map((r) => r.id), ...model.nodes.map((n) => n.id), ...model.levels.map((l) => l.id)]) {
      const svg = renderFlowSvg(model, selected).text;
      const selection = flowSelection(model, selected);
      const layout = flowLayout(model, selection);
      const measured = measureSvg(svg);
      const every: { route: string; box: { x: number; y: number; w: number; h: number } }[] = [];
      for (const route of model.routes) {
        const group = new RegExp(`<g class="flow-route-group[^"]*" id="${route.id}"[^>]*>([^]*?)</g>\\s*</g>`).exec(svg)![1]!;
        const cards = cardsOf(group);
        // One card per entrance, up to three; a derived route stands for no entrance, one card.
        const expected = route.derived ? 1 : Math.min(3, route.names.length);
        assert.equal(cards.length, expected, `${route.id}: ${route.names.length} entrances, ${expected} cards`);
        assert.match(group, new RegExp(`class="flow-origin-token"[^>]*data-cards="${expected}"`), `${route.id}: its front card says how many cards it stacks`);
        counts.add(cards.length);
        // Every card points: exactly one vertex at its right edge, the tip, midway down it.
        const front = pointsOfPath(cards[cards.length - 1]!);
        const right = Math.max(...front.map((p) => p[0]));
        const tips = front.filter((p) => Math.abs(p[0] - right) < 0.05);
        assert.equal(tips.length, 1, `${route.id}: the token's right edge is a point`);
        const tip = tips[0]!;
        const body = bodyOfPath(cards[cards.length - 1]!);
        assert.ok(Math.abs(tip[1] - (body.y + body.h / 2)) <= 0.1, `${route.id}: the tip is midway down the token`);
        assert.ok(tip[0] - (body.x + body.w) > 1 && tip[0] - (body.x + body.w) <= 9.05,`${route.id}: the point reaches past the body, at most 9 px (tip ${tip[0]}, body right ${body.x + body.w})`);
        // The back cards are the front card stepped up and to the left, never toward the tag beneath or the line.
        cards.slice(0, -1).forEach((card, i) => {
          const back = pointsOfPath(card);
          const k = cards.length - 1 - i;
          assert.equal(back.length, front.length);
          back.forEach((p, j) => assert.ok(Math.abs(p[0] - (front[j]![0] - 3 * k)) <= 0.11 && Math.abs(p[1] - (front[j]![1] - 2.5 * k)) <= 0.11, `${route.id}: card ${k} behind is the front card stepped up and left`));
        });
        // The route's line, and its motion, start at the tip.
        const line = new RegExp(`<path class="flow-line flow-route" data-line="${route.id}" d="M ([\\d.]+) ([\\d.]+)`).exec(group)!;
        assert.deepEqual([Number(line[1]), Number(line[2])], tip, `${route.id}: the route's line leaves from the tip`);
        if (selection.routes.has(route.id)) {
          const pulse = flowPulses(model, selection, layout).find((p) => p.on === route.id);
          if (pulse !== undefined) assert.deepEqual(pulse.points[0], tip, `${route.id}: its motion starts at the tip`);
        }
        // Selected, one halo follows the whole stack.
        const halo = new RegExp(`<path class="flow-token-halo" data-halo="${route.id}" d="([^"]+)"`).exec(svg);
        assert.equal(halo !== null, selection.id === route.id, `${route.id}: a halo exactly when it is the selection`);
        if (halo !== null) for (const card of cards) assert.ok(within(spanOfPath(card), spanOfPath(halo[1]!)), `${route.id}: the halo surrounds every card`);
        // No card covers text but its own names, which sit inside its front card, or any station or tag on the map.
        const own = terminusLines(svg, route.id);
        for (const card of cards) {
          const span = spanOfPath(card);
          assert.ok(span.x >= 2, `${route.id}: its cards stay inside the canvas, in the token column's left pad`);
          for (const text of measured.texts) {
            if (apart(span, text)) continue;
            const mine = own.some((l) => l.text === text.text && Math.abs(l.y - (text.y + text.h * 0.78)) < 0.2);
            assert.ok(mine && within(text, body), `${route.id}: a card overlaps "${text.text}"`);
          }
          for (const station of layout.stations.values()) assert.ok(apart(span, station), `${route.id}: a card overlaps the station ${station.folder}`);
          for (const tag of layout.tags) assert.ok(apart(span, tag.box), `${route.id}: a card overlaps the tag ${tag.text}`);
          every.push({ route: route.id, box: span });
        }
        checked += 1;
      }
      for (let a = 0; a < every.length; a++) for (let b = a + 1; b < every.length; b++) if (every[a]!.route !== every[b]!.route) assert.ok(apart(every[a]!.box, every[b]!.box), `${every[a]!.route} and ${every[b]!.route}: their tokens touch`);
      // A station never points: its right edge is flat.
      for (const m of svg.matchAll(/<path class="flow-box" id="[^"]+" d="([^"]+)"/g)) {
        const pts = pointsOfPath(m[1]!);
        const right = Math.max(...pts.map((p) => p[0]));
        assert.ok(pts.filter((p) => Math.abs(p[0] - right) < 0.05).length >= 2, "a station's right edge is flat");
      }
    }
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3], "one, two and three cards are all drawn");
  assert.ok(checked > 100, `tokens checked: ${checked}`);
  // Dimmed, every card of a stack dims with its front card.
  const style = /<style>([^]*?)<\/style>/.exec(renderFlowSvg(flowOf(stackState()), undefined).text)![1]!;
  assert.match(style, /\.flow-route-group\.is-dim \.flow-origin-token, \.flow-svg \.flow-route-group\.is-dim \.flow-origin-card \{ opacity: 0\.8;/, "a dimmed route dims every card");
});

test("trust shows where work enters: each entrance route's token carries the trust its entrances carry in, or unknown, or no traced control when no control is traced on it, and a trust-level key sits with the health strip", () => {
  for (const state of [projectState(), trustState(), untracedState(), crowdedState(), sharedState()]) {
    const model = flowOf(state);
    const svg = renderFlowSvg(model, undefined).text;
    for (const route of model.routes) {
      const railStub = route.rail === undefined ? undefined : model.edges.find((e) => e.from === route.stops[route.stops.length - 1] && e.to === route.rail);
      const expected = [...new Set([...route.entry, ...route.edges.flatMap((id) => model.edges.find((e) => e.id === id)!.identifiers), ...(railStub?.identifiers ?? [])])];
      assert.deepEqual(route.controls, expected, `${route.id}: its controls are every identifier on it`);
      const checks = (text: string): boolean => {
        const crossing = model.identifiers.find((i) => i.text === text)!.crossing;
        return crossing !== undefined && (route.trust.includes(crossing.from) || route.trust.includes(crossing.to));
      };
      assert.deepEqual(route.traced.filter((c) => c.kind === "interface").map((c) => c.identifier), expected.filter(checks), `${route.id}: each identifier on it whose crossing enters from its trust or enters it is a traced control`);
      assert.equal(route.noTracedControl, !route.derived && route.traced.length === 0 && untrustedByRule(state, route.trust), `${route.id}: no traced control exactly when it is untrusted and nothing is traced on it`);
      if (route.derived) continue;
      const group = new RegExp(`<g class="flow-route-group[^"]*" id="${route.id}"[^>]*>([^]*?)</g>\\s*</g>`).exec(svg)![1]!;
      const tag = /<g class="flow-trust[^"]*" data-trust-tag="([^"]+)" data-no-traced-control="(true|false)"[^>]*>/.exec(group);
      assert.ok(tag !== null, `${route.id} carries a trust tag`);
      assert.equal(tag[1], route.noTracedControl ? "no traced control" : route.trust.length === 0 ? "unknown" : `${route.trust.join(", ")}${route.trustSource === "derived" ? " (derived)" : ""}`);
      assert.equal(tag[2], String(route.noTracedControl));
    }
  }
  const trusted = flowOf(trustState());
  const event = trusted.routes.find((r) => r.trust.length > 0)!;
  assert.match(renderFlowSvg(trusted, undefined).text, new RegExp(`data-trust-tag="outside \\(derived\\)" data-no-traced-control="false" data-structure-select="${flowLevelId("outside")}"`), "a derived trust level is a selection");
  assert.ok(event.controls.length > 0, "a route with derived trust always carries its handler's identifier");
  const look = flowOf(untracedState()).routes.find((r) => r.names.includes("look"))!;
  assert.equal(look.noTracedControl, true, "the reader's route crosses no identifier");
  const page = renderView({ ...untracedState(), structure: { selected: look.id, preview: [] } } as ShellState, "structure").text;
  assert.match(page, /data-field="trust">unknown<\/span>[^]*data-field="controls">no traced control<\/span>/, "its inspector says so");
  const key = /data-field="trust-key">([^]*?)<\/div>/.exec(renderView(projectState(), "structure").text)![1]!;
  const pattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "(?:'|&#39;)");
  for (const level of projectState().spec.trustLevels) assert.match(key, new RegExp(`data-structure-select="${flowLevelId(level.name)}"[^>]*title="${pattern(level.meaning)}"><code>${level.name}</code></button> <span>${pattern(level.meaning.split(/[.:;]\s|\.$/)[0]!)}</span>`), `${level.name}: a selection, defined in one line`);
  assert.match(key, /<code>unknown<\/code>[^]*<code>no traced control<\/code>/, "the key says what unknown and no traced control mean");
  assert.match(answerStructure(untracedState()).text, /look {2}\. -> src\/reader -> src\/store {2}trust unknown {2}no traced control/, "the query says the same");
});

/** Whether trust carried in is untrusted, by the ruling's own words (d-ba18b0fd, d-6df8d09a): unknown, undeclared, or from outside the system's control. */
function untrustedByRule(state: ShellState, trust: readonly string[]): boolean {
  if (trust.length === 0) return true;
  return trust.some((name) => {
    const level = state.spec.trustLevels.find((l) => l.name === name);
    return level === undefined || level.outside === true;
  });
}

/** The trust fixture with its entrances declaring trust: the hook event declares record against its handler's crossing from outside, the tick declares outside. */
function declaredTrustState(): ShellState {
  const state = trustState();
  const hooks = state.spec.components.find((c) => c.folder === "src/hooks")!;
  hooks.entrances = hooks.entrances.map((e) => ({ ...e, trust: e.name === "hook event" ? "record" : "outside", trustLine: e.handlerLine + 1 }));
  return state;
}

test("an entrance's declared trust level is its route's trust, even where a crossing on its handler would derive another", () => {
  const derived = flowOf(trustState());
  const declared = flowOf(declaredTrustState());
  const event = (model: FlowModel): FlowEntrance => model.entrances.find((e) => e.name === "hook event")!;
  assert.deepEqual([event(derived).trust, event(derived).trustSource], [["outside"], "derived"], "without a trust: line, the crossing on its handler derives it");
  assert.deepEqual([event(declared).trust, event(declared).trustSource], [["record"], "declared"], "with one, the declaration wins");
  const tick = declared.entrances.find((e) => e.name === "tick")!;
  assert.deepEqual([tick.trust, tick.trustSource], [["outside"], "declared"], "a handler with no crossing carries its declared level, not unknown");
  const route = declared.routes.find((r) => r.entrances.includes(event(declared).id))!;
  assert.deepEqual([route.trust, route.trustSource], [["record"], "declared"]);
  // A declared level and the same level derived are told apart: they never share a route.
  const same = trustState();
  same.spec.components.find((c) => c.folder === "src/hooks")!.entrances[1]!.trust = "outside";
  const split = flowOf(same);
  const ids = split.entrances.filter((e) => e.declaredBy === "src/hooks").map((e) => split.routes.find((r) => r.entrances.includes(e.id))!.id);
  assert.equal(new Set(ids).size, 2, "declared outside and derived outside take their own routes");
});

test("trust derived from a crossing is labeled derived in the tag, the inspector and the query, and declared trust is labeled declared in the inspector", () => {
  for (const [state, source] of [[trustState(), "derived"], [declaredTrustState(), "declared"]] as const) {
    const model = flowOf(state);
    const route = model.routes.find((r) => r.names.includes("hook event"))!;
    assert.equal(route.trustSource, source);
    const level = route.trust.join(", ");
    const svg = renderFlowSvg(model, undefined).text;
    const tag = new RegExp(`id="${route.id}"[^]*?<g class="flow-trust[^"]*" data-trust-tag="([^"]+)"[^>]*data-trust-source="(declared|derived|unknown)"[^>]*><title>([^<]*)</title>[^]*?<text class="flow-trust-text flow-mono"[^>]*>([^<]+)</text>`).exec(svg);
    assert.ok(tag !== null, `${route.id}: its tag is drawn`);
    assert.equal(tag[1], source === "derived" ? `${level} (derived)` : level, "the tag's words");
    assert.ok(tag[4] === tag[1] || (source === "derived" && tag[4] === "derived"), `its drawn text is its words, or for a derived level too wide for the margin, derived (drew ${tag[4]})`);
    assert.equal(tag[2], source);
    assert.match(tag[3]!, source === "derived" ? /\(derived\)/ : /declared/, "the tooltip says where the trust came from");
    const page = renderView({ ...state, structure: { selected: route.id, preview: [] } } as ShellState, "structure").text;
    assert.match(page, new RegExp(`data-field="trust">${level}</span> <span class="flow-meta" data-field="trust-source">\\(${source}\\)`), "the inspector labels it");
    assert.match(answerStructure(state).text, new RegExp(`hook event {2}[^\\n]*trust ${level}${source === "derived" ? " \\(derived\\)" : "(?! \\(derived\\))"}`), "the query says the same");
  }
  const key = /data-field="trust-key">([^]*?)<\/div>/.exec(renderView(trustState(), "structure").text)![1]!;
  assert.match(key, /<li data-level="derived">[^]*?<code>\(derived\)<\/code>/, "the key says what derived means");
});

test("no traced control marks only an untrusted route with nothing traced on it: unknown trust or a level from outside the system's control, never a trusted one", () => {
  // The reader's route (no identifier anywhere on it) carrying each kind of trust in.
  const look = (trust: string | undefined, outside: boolean): FlowRoute => {
    const state = untracedState();
    state.spec.trustLevels = state.spec.trustLevels.map((level) => ({ ...level, outside: level.name === "outside" ? outside : false }));
    const root = state.spec.components.find((c) => c.folder === ".")!;
    root.entrances = root.entrances.map((e) => (e.name === "look" ? { ...e, trust, trustLine: e.handlerLine + 1 } : e));
    const route = flowOf(state).routes.find((r) => r.names.includes("look"))!;
    assert.deepEqual(route.controls, [], "nothing stands on the reader's route");
    return route;
  };
  assert.equal(look(undefined, true).noTracedControl, true, "unknown trust is untrusted (d-6df8d09a)");
  assert.equal(look("outside", true).noTracedControl, true, "a level from outside the system's control is untrusted");
  assert.equal(look("not-declared", false).noTracedControl, true, "a level no entry spec declares is untrusted");
  const inside = look("inside", false);
  assert.equal(inside.noTracedControl, false, "a level inside the system's control is not marked");
  assert.equal(look("outside", false).noTracedControl, false, "nor is outside when the entry spec does not mark it outside");
  const state = untracedState();
  const root = state.spec.components.find((c) => c.folder === ".")!;
  root.entrances = root.entrances.map((e) => (e.name === "look" ? { ...e, trust: "inside", trustLine: e.handlerLine + 1 } : e));
  const model = flowOf(state);
  const route = model.routes.find((r) => r.names.includes("look"))!;
  const svg = renderFlowSvg(model, undefined).text;
  assert.match(svg, new RegExp(`id="${route.id}"[^]*?data-trust-tag="inside" data-no-traced-control="false"`), "the trusted route's tag shows its level, neutral");
  const page = renderView({ ...state, structure: { selected: route.id, preview: [] } } as ShellState, "structure").text;
  assert.match(page, /data-field="controls">none<\/span>/, "its inspector says nothing stands on it");
  // What the inspector says, not the definitions its term links carry in their titles.
  assert.doesNotMatch(/<aside class="flow-inspector"[^>]*>([^]*?)<\/aside>/.exec(page)![1]!.replace(/ title="[^"]*"/g, ""), /no traced control/, "and never says no traced control");
  assert.doesNotMatch(answerStructure(state).text, /look {2}[^\n]*no traced control/, "nor does the query");
  // The key says which levels come from outside the system's control.
  const marked = untracedState();
  marked.spec.trustLevels = marked.spec.trustLevels.map((level) => ({ ...level, outside: level.name === "outside" }));
  const key = /data-field="trust-key">([^]*?)<\/div>/.exec(renderView(marked, "structure").text)![1]!;
  assert.match(key, /<code>outside<\/code><\/button> <span>[^<]*<\/span> <span class="flow-meta" data-outside="true">outside the system's control<\/span>/);
  assert.doesNotMatch(key, /<code>inside<\/code><\/button> <span>[^<]*<\/span> <span class="flow-meta" data-outside/);
});

/** Whether a component is covered, by the rule's own words (decision d-a02f255c). */
function coveredByRule(model: FlowModel, state: ShellState, folder: string): boolean {
  const exposed = model.edges.some((e) => e.to === folder && e.chokepoints.length > 0);
  const entered = model.identifiers.some((i) => i.routes.length > 0 && i.component === folder);
  const verifiedTotality = allInvariants(state.spec.components).some((i) => i.component === folder && i.enforcements.some((e) => e.form === "totality oracle") && invariantVerdict(i, state.runs.records).state === "verified");
  return exposed || entered || verifiedTotality;
}

test("the unenforced is visible: a component no enforcement covers carries a hollow state bar and a not-covered mark, and the health strip counts and lists them", () => {
  const withTotality = projectState();
  withTotality.spec.components.find((c) => c.folder === "src/hooks")!.invariants.push({ ...withTotality.spec.components.find((c) => c.folder === "src/store")!.invariants[0]!, component: "src/hooks", name: "hooks stay whole", enforcements: [{ form: "totality oracle", over: "every hook", via: "hooks stay whole", line: 9 }] as SpecInvariant["enforcements"], crossing: undefined, state: "invariant" });
  const railless = projectState();
  railless.spec.components.find((c) => c.folder === "src/journal")!.invariants = [];
  for (const state of [projectState(), healthState(), trustState(), withTotality, railless]) {
    const model = flowOf(state);
    const svg = renderFlowSvg(model, undefined).text;
    for (const node of model.nodes) {
      assert.equal(node.covered, coveredByRule(model, state, node.folder), `${node.folder}: covered by the rule`);
      if (node.core) {
        assert.equal(svg.includes(`data-node="${node.folder}" data-mark="uncovered"`), !node.covered, `${node.folder}: the rail carries the mark exactly when not covered`);
        continue;
      }
      const station = new RegExp(`<g class="flow-station[^"]*" id="${node.id}"[^>]*data-covered="(true|false)"[^>]*>([^]*?)</g>\\n`).exec(svg)!;
      assert.equal(station[1], String(node.covered));
      if (!node.covered && node.state !== "broken") assert.match(station[2]!, /class="flow-state-bar flow-state-hollow"/, `${node.folder}: a hollow bar`);
      assert.equal(svg.includes(`data-node="${node.folder}" data-mark="uncovered"`), !node.covered, `${node.folder}: a not-covered mark exactly when not covered`);
    }
    assert.deepEqual(model.health.uncovered, model.nodes.filter((n) => !n.covered).map((n) => n.folder));
  }
  assert.deepEqual(flowOf(projectState()).health.uncovered, [".", "src/hooks", "src/reader"], "the root, the hooks and the reader: nothing stands on a surface they expose");
  assert.ok(flowOf(withTotality).nodes.find((n) => n.folder === "src/hooks")!.covered, "a verified totality oracle of its own covers a component");
  assert.ok(!flowOf(railless).nodes.find((n) => n.folder === "src/journal")!.covered, "a core dependency called by many, with nothing standing on its stubs, is not covered");
  const page = renderView(projectState(), "structure").text;
  assert.match(page, new RegExp(`data-health="uncovered" data-count="3" data-structure-select="${flowHealthId("uncovered")}"[^>]*>[^]*?3</strong> components not covered`), "a clickable count in the strip");
  const listed = renderView({ ...projectState(), structure: { selected: flowHealthId("uncovered"), preview: [] } } as ShellState, "structure").text;
  for (const folder of [".", "src/hooks", "src/reader"]) assert.match(listed, new RegExp(`data-kind="health" data-health="uncovered"[^]*data-component="${folder.replace(/[./]/g, (c) => `\\${c}`)}"`), `${folder} is listed`);
  assert.match(renderView({ ...projectState(), structure: { selected: flowNodeId("src/hooks"), preview: [] } } as ShellState, "structure").text, /data-field="uncovered">Not covered/, "and the component's inspector says so");
});

test("each identifier is drawn once in full and as a dot wherever it stands again, a crossing's with pointed ends and a chokepoint's rounded, and a component's crossing count shows only while a trust level, the component or its boundary is selected", () => {
  for (const state of [projectState(), crowdedState(), trustState(), healthState()]) {
    const model = flowOf(state);
    for (const selected of [undefined, ...model.levels.map((l) => l.id), ...model.nodes.map((n) => n.id)]) {
      const svg = renderFlowSvg(model, selected).text;
      const tags = [...svg.matchAll(/<g class="flow-tag[^"]*"[^>]*data-identifier="([CX]\d+)"[^>]*data-shape="(crossing|chokepoint)" data-repeat="(true|false)"[^>]*>([^]*?)<\/g>/g)];
      const texts = new Set(tags.map((m) => m[1]!));
      for (const text of texts) {
        const full = tags.filter((m) => m[1] === text && m[3] === "false");
        assert.equal(full.length, 1, `${selected ?? "at rest"}: ${text} is drawn in full once (${full.length})`);
      }
      for (const m of tags) {
        assert.equal(m[2], m[1]!.startsWith("X") ? "crossing" : "chokepoint", `${m[1]}: its shape follows its letter`);
        const body = m[4]!;
        if (m[3] === "true") {
          assert.doesNotMatch(body, /<text/, `${m[1]}: a repeat is a dot, with no text`);
          assert.match(body, m[2] === "crossing" ? /<path class="flow-tag-shape" d="M [^"]+Z"/ : /<circle class="flow-tag-shape"/, `${m[1]}: a diamond for a crossing, a round dot for a chokepoint`);
        } else assert.match(body, m[2] === "crossing" ? /<path class="flow-tag-shape"/ : /<rect class="flow-tag-shape"[^>]*rx="3"/, `${m[1]}: pointed ends for a crossing, rounded for a chokepoint`);
      }
      const selection = flowSelection(model, selected);
      for (const m of svg.matchAll(/<g class="flow-tag ([^"]*)" data-node="([^"]+)" data-mark="boundary"[^>]*>([^]*?)<\/g>/g)) {
        const shown = (selection.kind === "level" || selection.kind === "component") && selection.marks.has(m[2]!);
        assert.equal(/<text/.test(m[3]!), shown, `${selected ?? "at rest"}: ${m[2]}'s crossing count ${shown ? "shows" : "is a tick"}`);
        assert.equal(m[1]!.includes("flow-tag-tick"), !shown);
      }
    }
  }
  const crowded = measureSvg(renderFlowSvg(flowOf(crowdedState()), undefined).text);
  assert.ok(crowded.texts.length > 0);
  assert.ok([...renderFlowSvg(flowOf(crowdedState()), undefined).text.matchAll(/data-repeat="true"/g)].length > 0, "the crowded fixture repeats identifiers, so drawing each in full twice would show");
  const hooks = renderFlowSvg(flowOf(trustState()), undefined).text;
  const entry = flowOf(trustState()).routes.find((r) => r.entry.length > 0)!;
  assert.match(hooks, new RegExp(`data-entry="${entry.id}" data-identifier="${entry.entry[0]}"[^>]*data-repeat="false"`), "where work enters, an identifier is drawn in full first");
  const key = /data-field="key"[^]*/.exec(renderView(projectState(), "structure").text)![0]!;
  assert.match(key, /C = <a class="flow-term" href="#coherence-chokepoint"[^>]*>chokepoint<\/a>, rounded: the one site every reference to a protected thing passes\. X = <a class="flow-term" href="#coherence-crossing"[^>]*>crossing<\/a>, pointed:/, "the legend spells both out");
});

test("roles are never cut mid-phrase: a component's role wraps to three lines at most, or ends at a clause, and a narrow window says the map scrolls, keeps its last tab, and reaches the broken mark from the health strip", () => {
  const intents = [
    "A prosthetic for proprioception: specs, invariants, and the readings that keep an agent balanced.",
    "The context closure of a change, the read traces that calibrate it, and the mass no invariant reaches.",
    "Per-feature manifests that feed the scattered registries from one declaration; composers derive each registry from the FEATURES array.",
    "The single per-user Durable Object that owns all SQLite data and funnels every agent write through one kernel-enforced chokepoint.",
    "Credential primitives, multi-member passkeys, and scoped access tokens minted under consent for every agent and every browser session the hive serves over time.",
  ];
  const state = projectState();
  state.spec.components.forEach((component, i) => (component.intent = intents[i % intents.length]!));
  const model = flowOf(state);
  const layout = flowLayout(model);
  const boundary = /^(?:[:;,]\s| — | (?:and|that|with|through|for|whose|where|which) )/;
  for (const node of model.nodes.filter((n) => !n.core)) {
    const lines = layout.texts.filter((t) => t.key.startsWith(`role ${node.folder} `)).sort((a, b) => a.y - b.y).map((t) => t.text);
    const whole = node.intent.trim().replace(/[.:;,]+$/, "");
    const shown = lines.join(" ");
    assert.ok(lines.length >= 1 && lines.length <= 3, `${node.folder}: ${lines.length} role lines`);
    assert.ok(whole.startsWith(shown), `${node.folder}: "${shown}" is the start of its role`);
    assert.ok(shown === whole || boundary.test(whole.slice(shown.length)), `${node.folder}: "${shown}" ends at a clause, not mid-phrase`);
    assert.doesNotMatch(shown, /…/);
  }
  assert.deepEqual(measureSvg(renderFlowSvg(model, undefined).text).clipped, [], "every role line sits inside its box, which grew to hold it");
  // Narrow windows.
  const page = renderView(healthState(), "structure").text;
  const width = /<svg class="flow-svg"[^>]*width="(\d+)"/.exec(page)![1]!;
  assert.match(page, new RegExp(`@container flow-canvas \\(max-width: ${Number(width) - 1}px\\) \\{ \\.flow-scroll-hint \\{ display: block; \\} \\.flow-fade-end \\{ display: block; \\} \\}`), "the hint and the fade show exactly when the map is wider than its room");
  assert.match(page, /<p class="flow-scroll-hint" data-field="scroll-hint">[^<]*scroll it sideways/);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.flow-canvas-wrap \{\s*container: flow-canvas \/ inline-size;/);
  assert.match(css, /@media \(max-width: 40rem\) \{\s*\.views ul \{\s*flex-wrap: wrap;/, "the view strip wraps rather than clip its last tab");
  assert.match(page, new RegExp(`data-health="defects" data-count="1" data-structure-select="${flowBrokenId("src/store")}"`), "the broken count selects the one broken component's mark");
  const script = readFileSync(new URL("./page.ts", import.meta.url), "utf8");
  assert.match(script, /canvas\.scrollLeft \+=/, "and the page scrolls the canvas to what is selected");
});

/** Every selection of a model, as the motion check walks them. */
function motionSelections(model: FlowModel): (string | undefined)[] {
  return [undefined, ...model.routes.map((r) => r.id), ...model.entrances.map((e) => e.id), ...model.nodes.map((n) => n.id), ...model.levels.map((l) => l.id), ...model.chokepoints.map((c) => c.id), ...model.edges.map((e) => e.id)];
}

test("motion runs caller to callee while selected: every drawn line runs from caller to callee, only a selected route or component moves, every line flows at one slow speed for as long as the selection holds, and reduced motion shows chevrons instead", () => {
  const near = (p: readonly number[], box: { x: number; y: number; w: number; h: number }): boolean => p[0]! >= box.x - 1 && p[0]! <= box.x + box.w + 1 && p[1]! >= box.y - 1 && p[1]! <= box.y + box.h + 1;
  for (const state of [projectState(), crowdedState(), healthState(), trustState()]) {
    const model = flowOf(state);
    for (const selected of motionSelections(model)) {
      const selection = flowSelection(model, selected);
      const layout = flowLayout(model, selection);
      // Every line's points run from its caller to its callee.
      for (const draw of layout.routes) {
        const first = layout.stations.get(draw.route.stops[0]!)!;
        const last = layout.stations.get(draw.route.stops[draw.route.stops.length - 1]!)!;
        assert.ok(draw.path[0]![0] < first.x, `${draw.route.id}: starts at its origin, left of its first stop`);
        assert.ok(near(draw.path[draw.path.length - 1]!, last), `${draw.route.id}: ends in its last stop`);
      }
      for (const draw of layout.lines) {
        const from = layout.stations.get(draw.edge.from);
        const to = layout.stations.get(draw.edge.to)!;
        const pts = draw.line.points;
        assert.ok(from === undefined ? layout.rails.some((r) => r.folder === draw.edge.from && Math.abs(r.y - pts[0]![1]) < 0.6) : near(pts[0]!, from), `${draw.edge.id}: starts at its caller`);
        assert.ok(near(pts[pts.length - 1]!, to), `${draw.edge.id}: ends at its callee`);
      }
      for (const stub of layout.stubs) {
        const from = layout.stations.get(stub.edge.from);
        const rail = layout.rails.find((r) => r.folder === stub.edge.to)!;
        if (from !== undefined) assert.ok(near(stub.points[0]!, from), `${stub.edge.id}: starts at its caller`);
        assert.ok(Math.abs(stub.points[stub.points.length - 1]![1] - rail.y) < 0.6, `${stub.edge.id}: ends on its callee's rail`);
      }
      // Only the direction of work moves, and only on what is selected.
      const pulses = flowPulses(model, selection, layout);
      const svg = renderFlowSvg(model, selected).text;
      const moving = selection.kind === "route" || selection.kind === "entrance" || selection.kind === "component";
      if (!moving) {
        assert.equal(pulses.length, 0, `${selected ?? "at rest"}: nothing moves`);
        assert.doesNotMatch(svg, /class="flow-pulse|class="[^"]*flow-tick/, `${selected ?? "at rest"}: nothing moves`);
        continue;
      }
      for (const p of pulses) {
        assert.ok(Math.abs(p.duration * FLOW_PULSE_SPEED - FLOW_PULSE_PERIOD) <= 0.1, `${p.on}: its cycle ${p.duration}s is one period ${FLOW_PULSE_PERIOD}px over ${FLOW_PULSE_SPEED}px/s, the same on every line`);
        assert.ok(Math.abs(p.length - polylineLength(p.points)) <= 0.1);
        const onRoute = layout.routes.find((d) => d.route.id === p.on);
        if (onRoute !== undefined) assert.deepEqual(p.points, onRoute.path, `${p.on}: the pulse runs the route's own path, origin to end`);
        else {
          assert.ok(selection.into.has(p.on) || selection.outOf.has(p.on), `${p.on} is one of the component's interfaces`);
          const drawn = layout.routes.find((d) => d.segments.has(p.on))?.segments.get(p.on)?.points ?? layout.lines.find((l) => l.edge.id === p.on)?.line.points ?? layout.stubs.find((s) => s.edge.id === p.on)!.points;
          assert.deepEqual(p.points, drawn.filter((pt, i) => i === 0 || Math.abs(pt[0] - drawn[i - 1]![0]) > 0.01 || Math.abs(pt[1] - drawn[i - 1]![1]) > 0.01), `${p.on}: the pulse runs its line's own points, caller to callee`);
          assert.equal(p.delay, FLOW_HOP_DELAY, "one hop after the component lights");
        }
        assert.match(svg, new RegExp(`<path class="flow-pulse" data-pulse="${p.on}" data-pulse-length="${p.length}" data-pulse-duration="${p.duration}" data-pulse-period="${FLOW_PULSE_PERIOD}"[^>]*stroke="color-mix\\(in srgb, [^,]+ 45%, #ffffff\\)" style="stroke-dasharray: \\d+ \\d+; stroke-dashoffset: 0; --pulse-end: -${FLOW_PULSE_PERIOD}px; animation-duration: ${p.duration}s; animation-delay: ${p.delay}s"`), `${p.on}: faint dashes in a lighter tint of its line, one period apart`);
        assert.match(svg, new RegExp(`<path class="flow-chevron" data-chevrons="${p.on}"`), `${p.on}: chevrons for reduced motion`);
      }
      assert.ok(pulses.length > 0 || selection.kind === "component" || selection.routes.size === 0, `${selected}: a selected route moves`);
      for (const m of svg.matchAll(/<g class="([^"]*)"[^>]*(?:data-mark="broken"|data-state="broken")/g)) assert.doesNotMatch(m[1]!, /flow-tick/, "broken marks never animate");
      for (const m of svg.matchAll(/<g class="flow-tag[^"]*\bflow-tick\b[^"]*"[^>]*data-identifier="([CX]\d+)"[^>]*style="animation-duration: ([\d.]+)s; animation-delay: ([\d.]+)s/g)) {
        const pulse = pulses.find((p) => Math.abs(p.duration - Number(m[2])) < 0.0005);
        assert.ok(pulse !== undefined && Number(m[3]) >= pulse.delay && Number(m[3]) <= pulse.delay + pulse.duration + 0.001, `${m[1]} ticks while a pulse passes it`);
      }
    }
  }
  const run = flowOf(projectState()).routes.find((r) => r.names.includes("run"))!;
  assert.match(renderFlowSvg(flowOf(projectState()), run.id).text, /class="flow-tag flow-tag-verified[^"]*\bflow-tick\b"/, "a control on the route ticks as the pulse passes");
  const look = flowOf(untracedState()).routes.find((r) => r.names.includes("look"))!;
  assert.doesNotMatch(renderFlowSvg(flowOf(untracedState()), look.id).text, /class="[^"]*flow-tick/, "a route with no traced control shows no tick at all");
  assert.ok(FLOW_PULSE_SPEED <= 60 && FLOW_PULSE_PERIOD / FLOW_PULSE_SPEED >= 1.5, "slow enough to follow: at most 60 px/s, a cycle of at least 1.5 s");
  const style = /<style>([^]*?)<\/style>/.exec(renderFlowSvg(flowOf(projectState()), run.id).text)![1]!;
  assert.match(style, /\.flow-svg \.flow-pulse \{[^}]*animation-iteration-count: infinite;/, "the flow continues while the selection holds");
  assert.doesNotMatch(renderFlowSvg(flowOf(projectState()), undefined).text, /class="flow-pulse|class="[^"]*flow-tick/, "clearing the selection stops all motion");
  assert.doesNotMatch(readFileSync(new URL("./styles.css", import.meta.url), "utf8"), /infinite/, "nothing on the page outside a selection loops");
  assert.match(style, /@media \(prefers-reduced-motion: reduce\) \{\s*\.flow-svg \.flow-pulse \{ display: none; animation: none; \}\s*\.flow-svg \.flow-tick, \.flow-svg \.flow-station\.is-reach \.flow-box \{ animation: none; \}\s*\.flow-svg \.flow-chevron \{ display: inline; \}/, "with reduced motion nothing animates and the chevrons show");
});

/* ------------------------------------------------ traced controls (d-127ab8e4) */

/** The untraced fixture's reader route carrying outside in, with the reading's guards on its entrance and an invariant enforced by a totality oracle alone in the reader. */
function tracedState(options: { guards?: EntranceGuard[]; totality?: { from: string; to?: string; chokepoint?: boolean; state?: SpecInvariant["state"]; in?: string; entrances?: string[] | null }; states?: Record<string, SpecInvariant["state"]>; crossings?: Record<string, [string, string] | null>; guard?: string; unconfirmed?: string } = {}): ShellState {
  const state = untracedState();
  state.spec.trustLevels = state.spec.trustLevels.map((level) => ({ ...level, outside: level.name === "outside" }));
  for (const component of state.spec.components) for (const invariant of component.invariants) invariant.state = options.states?.[invariant.name] ?? invariant.state;
  for (const component of state.spec.components) {
    for (const invariant of component.invariants) {
      const crossing = options.crossings?.[invariant.name];
      if (crossing !== undefined) invariant.crossing = crossing === null ? undefined : { from: crossing[0], to: crossing[1], line: 7 };
    }
  }
  const root = state.spec.components.find((c) => c.folder === ".")!;
  root.entrances = root.entrances.map((e) => (e.name === "look" ? { ...e, trust: "outside", trustLine: e.handlerLine + 1, ...(options.guard === undefined ? {} : { guard: options.guard, guardLine: e.handlerLine + 2 }) } : e));
  if (state.componentInterfaces.kind === "read") {
    state.componentInterfaces.entrances = state.componentInterfaces.entrances.map((e) => (e.name === "look" ? { ...e, ...(options.guards === undefined ? {} : { guards: options.guards }), ...(options.unconfirmed === undefined ? {} : { guardUnconfirmed: options.unconfirmed }) } : e));
  }
  if (options.totality !== undefined) {
    const owner = options.totality.in ?? "src/reader";
    const reader = state.spec.components.find((c) => c.folder === owner)!;
    const enforcements: SpecInvariant["enforcements"] = [{ form: "totality oracle", over: "every look", via: "looks stay scoped", line: 9 }, ...(options.totality.chokepoint === true ? [{ form: "chokepoint" as const, chokepoint: "peekAt", protects: "peek", line: 10 }] : [])];
    reader.invariants.push({ ...state.spec.components.find((c) => c.folder === "src/core")!.invariants[0]!, component: owner, name: "looks stay scoped", sentence: "looks stay scoped.", enforcements, crossing: { from: options.totality.from, to: options.totality.to ?? "inside", line: 11 }, ...(options.totality.entrances === null ? {} : { entrances: { names: options.totality.entrances ?? ["look"], line: 12 } }), state: options.totality.state ?? "invariant" });
  }
  return state;
}

test("a test-backed control counts on the entrances its invariant names and on no other: neither owning the component that declares or handles an entrance nor standing further along its route covers it", () => {
  const look = (state: ShellState): FlowRoute => flowOf(state).routes.find((r) => r.names.includes("look"))!;
  const own = look(tracedState({ totality: { from: "outside" } }));
  assert.ok(own.stops.includes("src/store"), "the route passes the store");
  assert.deepEqual(own.traced.map((c) => `${c.kind} ${c.component}`), ["totality src/reader"], "named by the reader's totality oracle, look counts it");
  assert.deepEqual(look(tracedState({ totality: { from: "outside", in: "src/store" } })).traced.map((c) => `${c.kind} ${c.component}`), ["totality src/store"], "named, it counts wherever it is owned: the line is the evidence");
  const unnamed = tracedState({ totality: { from: "outside", entrances: null } });
  assert.deepEqual([look(unnamed).traced, look(unnamed).noTracedControl], [[], true], "owned by the reader, which handles look, and naming no entrance: it covers none");
  assert.deepEqual(flowOf(unnamed).entrances.find((e) => e.name === "look")!.unnamed, [{ component: "src/reader", name: "looks stay scoped" }], "and look says which invariant covered it by its crossing alone");
  const further = look(tracedState({ totality: { from: "outside", in: "src/store", entrances: null } }));
  assert.deepEqual([further.traced, further.noTracedControl], [[], true], "further along the route and naming none, it never did and does not now");
  const other = look(tracedState({ totality: { from: "outside", entrances: ["run"] } }));
  assert.deepEqual([other.traced, other.noTracedControl], [[], true], "naming another entrance covers that one, not look");
});

/** The adopter's shape (covers-fixture.ts) as the state Structure derives from: its files read, a reading resolving each entrance, its two test-backed invariants verified. */
function adopterState(files: Record<string, string>): ShellState {
  const root = mkdtempSync(join(tmpdir(), "coherence-covers-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const read: InterfaceReading = { kind: "read", language: "typescript", declarations: 5, symbols: [sym("src/routes", "src/server", "listRosters", "src/server/rosters.ts")], entrances: ADOPTER_ENTRANCES.map((e) => ({ ...e })), unowned: { files: 0, lines: 0 } };
    const state = structureState(root, read);
    for (const component of state.spec.components) for (const invariant of component.invariants) invariant.state = "invariant";
    return state;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("an invariant covers the entrances it names: the adopter's apple signature check controls its notification route alone, and the auth, crawler and preview routes beside it and a server function sharing src/server stay uncontrolled", () => {
  const model = flowOf(adopterState(adopterFiles()));
  const routeOf = (name: string): FlowRoute => model.routes.find((r) => r.names.includes(name))!;
  const apple = routeOf(APPLE);
  assert.deepEqual([apple.traced.map((c) => `${c.kind} ${c.name}`), apple.noTracedControl], [["totality signed apple notifications"], false], "named, its test controls the notification route");
  assert.deepEqual(apple.names, [APPLE], "a route of its own: entrances an invariant names never share a line with ones it does not, so its control counts for those it names");
  for (const name of ["route api/auth.$", "route robots[.]txt", "route api/previews/battles.$token", "server fn listRosters"]) {
    const route = routeOf(name);
    assert.deepEqual([route.traced, route.partial, route.noTracedControl], [[], [], true], `${name}: the same crossing, visitor -> account store, covers nothing it does not name`);
  }
  assert.deepEqual(model.entrances.find((e) => e.name === "server fn listRosters")!.owners, ["src/routes", "src/server"], "the server function is declared among the routes and handled in src/server, which owns a test-backed invariant of its own, and still gets nothing");
  assert.deepEqual(model.entrances.flatMap((e) => e.unnamed), [{ component: "src/server", name: "session-scoped rosters" }], "only the server's own invariant, which names no entrance, says it covered one by its crossing alone");
});

test("an invariant that covered entrances by its crossing alone covers none, and each entrance that lost it says so: its gap and orient's line name the invariant and the entrances: line", () => {
  const state = adopterState(adopterFiles({ named: false }));
  const model = flowOf(state);
  assert.ok(model.routes.every((r) => r.traced.length === 0 && r.noTracedControl), "unnamed, the signature check controls no route, its own included");
  const lost = (name: string): string[] => model.entrances.find((e) => e.name === name)!.unnamed.map((u) => u.name);
  assert.deepEqual(lost(APPLE), ["signed apple notifications"]);
  assert.deepEqual(lost("route robots[.]txt"), ["signed apple notifications"], "the crawler file lost a control it never had in fact: the over-claim, now said");
  assert.deepEqual(lost("server fn listRosters"), ["signed apple notifications", "session-scoped rosters"]);
  assert.deepEqual(lost("route api/previews/battles.$token"), [], "the previews' own spec owns neither, so it was never credited");
  const gaps = gapsOf(state, model);
  assert.deepEqual(gaps.gaps.find((g) => g.name === APPLE)!.unnamed, ["signed apple notifications"]);
  const line = orientGapText(gaps, undefined, "coherence");
  assert.match(line, /4 of them lost the control an invariant gave by its crossing alone, which no longer counts \(most: signed apple notifications, on 4\); name each one its test checks on its entrances: line \(coherence scaffold control "route api\/apple-notifications" proposes it\)\./);
  assert.ok(line.length < 900, "still one bounded line");
});

test("a route's controls are traced four ways, verified only: an identifier on its lines, a chokepoint its handler is registered through, a chokepoint inside a component on it whose protected thing its reach reaches, and a totality oracle on it, each but the wrapper only when its crossing enters from the route's trust or enters it", () => {
  const look = (state: ShellState): FlowRoute => flowOf(state).routes.find((r) => r.names.includes("look"))!;
  const kinds = (route: FlowRoute): string[] => route.traced.map((c) => `${c.kind} ${c.name}${c.declared ? " (declared)" : ""}`);
  const bare = look(tracedState());
  assert.deepEqual([bare.stops, bare.controls, bare.traced], [[".", "src/reader", "src/store"], [], []], "nothing stands on the reader's route");
  assert.equal(bare.noTracedControl, true, "untrusted, and nothing traced: no traced control");
  // A wrapper: the handler's own declaration references a verified chokepoint, wherever it stands.
  const wrapped = look(tracedState({ guards: [{ component: "src/core", name: "one door", how: "wrapper" }] }));
  assert.deepEqual(kinds(wrapped), ["wrapper one door"]);
  assert.equal(wrapped.noTracedControl, false);
  assert.deepEqual(kinds(look(tracedState({ guards: [{ component: "src/core", name: "one door", how: "declared" }] }))), ["wrapper one door (declared)"], "a guard: line the reading confirmed is a wrapper, marked declared");
  assert.deepEqual(kinds(look(tracedState({ guards: [{ component: "src/core", name: "one door", how: "wrapper" }], states: { "one door": "requirement" } }))), [], "an unverified chokepoint is no control");
  // Inside: a chokepoint the reach passes counts only in a component on the route.
  assert.deepEqual(kinds(look(tracedState({ guards: [{ component: "src/store", name: "single writer", how: "reach" }] }))), ["inside single writer"], "the store is on the route");
  assert.deepEqual(kinds(look(tracedState({ guards: [{ component: "src/journal", name: "append-only store", how: "reach" }] }))), [], "the journal is not");
  // A control checks what crosses from the route's trust (c-9941b95e): a chokepoint the reach passes whose crossing guards
  // another boundary (a data-write log, a migration registry: inside -> record) or declares none is no check on this caller.
  const writeLog = look(tracedState({ guards: [{ component: "src/store", name: "single writer", how: "reach" }], crossings: { "single writer": ["inside", "record"] } }));
  assert.deepEqual([kinds(writeLog), writeLog.noTracedControl], [[], true], "a chokepoint inside whose crossing neither enters from outside nor enters it is nominal: the route reads no traced control");
  assert.deepEqual(kinds(look(tracedState({ guards: [{ component: "src/store", name: "single writer", how: "reach" }], crossings: { "single writer": null } }))), [], "one that declares no crossing checks no trust");
  assert.deepEqual(kinds(look(tracedState({ guards: [{ component: "src/store", name: "single writer", how: "reach" }], crossings: { "single writer": ["record", "outside"] } }))), ["inside single writer"], "one whose crossing enters the route's trust decides what reaches this caller, and counts");
  // A wrapper is exempt: the handler is registered through it, whatever boundary its crossing names (one door declares none).
  assert.deepEqual(kinds(look(tracedState({ guards: [{ component: "src/store", name: "single writer", how: "wrapper" }], crossings: { "single writer": ["inside", "record"] } }))), ["wrapper single writer"], "a wrapper counts whatever its crossing");
  // Test-backed: an invariant enforced by a totality oracle alone on the route whose crossing enters from the trust the route carries in.
  assert.deepEqual(kinds(look(tracedState({ totality: { from: "outside" } }))), ["totality looks stay scoped"]);
  assert.deepEqual(kinds(look(tracedState({ totality: { from: "inside" } }))), [], "a crossing entering from another level");
  assert.deepEqual(kinds(look(tracedState({ totality: { from: "record", to: "outside" } }))), ["totality looks stay scoped"], "a crossing entering the route's trust");
  assert.deepEqual(kinds(look(tracedState({ totality: { from: "outside", state: "requirement" } }))), [], "an unverified totality");
  assert.deepEqual(kinds(look(tracedState({ totality: { from: "outside", chokepoint: true } }))), [], "an invariant with a chokepoint is traced by its chokepoint, never as an totality");
  // Every kind at once, in order, and the route is controlled.
  const all = look(tracedState({ totality: { from: "outside" }, guards: [{ component: "src/store", name: "single writer", how: "reach" }, { component: "src/core", name: "one door", how: "wrapper" }] }));
  assert.deepEqual(kinds(all), ["wrapper one door", "inside single writer", "totality looks stay scoped"]);
  // The inspector names each control, its kind and its invariant; the query says the same.
  const state = tracedState({ totality: { from: "outside" }, guards: [{ component: "src/store", name: "single writer", how: "reach" }, { component: "src/core", name: "one door", how: "declared" }], guard: "door" });
  const page = renderView({ ...state, structure: { selected: all.id, preview: [] } } as ShellState, "structure").text;
  const controls = /<ul class="flow-rows" data-field="controls">([^]*?)<\/ul>/.exec(page)![1]!;
  assert.match(controls, /data-control="wrapper" data-invariant="one door" data-declared="true">[^]*structural chokepoint wrapping its handler, declared by its guard: line/);
  assert.match(controls, /data-control="inside" data-invariant="single writer">[^]*structural chokepoint inside a component on it/);
  assert.match(controls, /data-control="totality" data-invariant="looks stay scoped">[^]*test-backed totality oracle/);
  assert.match(answerStructure(state).text, /look {2}[^\n]*traced: structural chokepoint wrapping its handler \(declared by guard:\): one door \(src\/core\); structural chokepoint inside a component on it: single writer \(src\/store\); test-backed totality oracle: looks stay scoped \(src\/reader\)/);
  assert.doesNotMatch(answerStructure(state).text, /look {2}[^\n]*no traced control/);
  // A control beyond the lines is each entrance's own: one only some entrances on the route pass is listed apart, never counted.
  const twins = tracedState({ guards: [{ component: "src/core", name: "one door", how: "wrapper" }] });
  const rootSpec = twins.spec.components.find((c) => c.folder === ".")!;
  rootSpec.entrances = [...rootSpec.entrances, { ...rootSpec.entrances.find((e) => e.name === "look")!, name: "glance", meaning: "a reader glances" }];
  if (twins.componentInterfaces.kind === "read") twins.componentInterfaces.entrances = [...twins.componentInterfaces.entrances, { component: ".", name: "glance", file: "src/reader/look.ts" }];
  const shared = look(twins);
  assert.deepEqual([shared.names, shared.traced, shared.partial.map((c) => `${c.kind} ${c.name} ${c.entrances}`), shared.noTracedControl], [["look", "glance"], [], ["wrapper one door 1"], true], "one of two entrances wrapped: listed, not counted");
  assert.match(renderView({ ...twins, structure: { selected: shared.id, preview: [] } } as ShellState, "structure").text, /data-field="partial-controls">[^]*data-control="wrapper" data-invariant="one door" data-entrances="1">[^]*on 1 of its 2 entrances; not counted/);
  // An identifier on its lines counts the same way: the run route, carrying outside in, crosses one door (no crossing) and the writer.
  const lined = (crossing: [string, string] | null): ShellState => {
    const s = projectState();
    s.spec.trustLevels = s.spec.trustLevels.map((level) => ({ ...level, outside: level.name === "outside" }));
    const root = s.spec.components.find((c) => c.folder === ".")!;
    root.entrances = root.entrances.map((e) => (e.name === "run" ? { ...e, trust: "outside", trustLine: e.handlerLine + 1 } : e));
    const writer = s.spec.components.find((c) => c.folder === "src/store")!.invariants.find((i) => i.name === "single writer")!;
    writer.crossing = crossing === null ? undefined : { from: crossing[0], to: crossing[1], line: 7 };
    return s;
  };
  const run = (s: ShellState): FlowRoute => flowOf(s).routes.find((r) => r.names.includes("run"))!;
  const onLine = (s: ShellState): string[] => {
    const model = flowOf(s);
    return run(s).controls.map((text) => model.identifiers.find((i) => i.text === text)!.name).sort();
  };
  const interfaces = (route: FlowRoute): string[] => route.traced.filter((c) => c.kind === "interface").map((c) => c.name);
  assert.deepEqual(onLine(lined(["outside", "inside"])), ["one door", "single writer"], "both chokepoints stand on the run route's lines");
  assert.deepEqual(interfaces(run(lined(["outside", "inside"]))), ["single writer"], "the writer's crossing enters from outside, the route's trust: it counts; one door declares no crossing and does not");
  assert.deepEqual(interfaces(run(lined(["record", "outside"]))), ["single writer"], "a crossing entering outside counts too");
  const other = run(lined(["inside", "record"]));
  assert.deepEqual([interfaces(other), other.noTracedControl], [[], true], "a crossing between two other levels checks nothing that enters from outside: the route reads no traced control");
  assert.deepEqual(run(lined(["inside", "record"])).controls.length, 2, "the identifiers still stand on its lines");
  // A declared guard the reading could not confirm says why in the entrance's inspector, and counts for nothing.
  const unconfirmed = tracedState({ guard: "door", unconfirmed: "no registration of the handler spells door" });
  const entrance = flowOf(unconfirmed).entrances.find((e) => e.name === "look")!;
  assert.equal(look(unconfirmed).noTracedControl, true);
  assert.match(renderView({ ...unconfirmed, structure: { selected: entrance.id, preview: [] } } as ShellState, "structure").text, /data-field="guard">declared, not counted: no registration of the handler spells door/);
});

test("the reading traces the chokepoints a handler passes: a wrapper around it, one further along its reach, a declared guard at its registration, and a module handler's top-level script", { timeout: 120_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "coherence-guards-"));
  try {
    writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "guards", entryDir: ".", language: "typescript" }));
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["**/*.ts"] }));
    writeFileSync(
      join(root, "Root.spec.md"),
      [
        "# Root", "", "The root.", "", "## entrances",
        "- save: a wrapped handler", "  handler: save in src/api/api.ts",
        "- post: a handler registered through the guard elsewhere", "  handler: post in src/api/api.ts", "  guard: guard",
        "- plain: a handler no registration guards", "  handler: plain in src/api/api.ts", "  guard: guard",
        "- job: a script", "  handler: src/api/job.ts",
        "- deep: a handler that reaches the writer through another", "  handler: deep in src/api/api.ts",
        "- mutate: a handler inside a factory's guarded product", "  handler: mutate in src/api/api.ts", "  guard: guardedRpc",
        "", "## invariants", "",
      ].join("\n"),
    );
    for (const folder of ["src/api", "src/store", "src/guard"]) mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, "src/api/Api.spec.md"), "# Api\n\nTakes requests.\n\n## invariants\n");
    writeFileSync(join(root, "src/store/Store.spec.md"), "# Store\n\nHolds rows.\n\n## invariants\n- single writer: rows are written in one place.\n  protects: writeRow in rows.ts\n  chokepoint: write in write.ts\n");
    writeFileSync(join(root, "src/guard/Guard.spec.md"), "# Guard\n\nChecks origins.\n\n## invariants\n- origin checked: every guarded call checks its origin.\n  protects: checkOrigin in origin.ts\n  chokepoint: guard in guard.ts\n- rpc origin: every guarded rpc checks its origin.\n  protects: checkRpcOrigin in origin.ts\n  chokepoint: src/guard/rpc.ts\n");
    writeFileSync(join(root, "src/guard/rpc.ts"), "import { checkRpcOrigin } from \"./origin.ts\";\nfunction makeRpc(check: () => void) {\n  return { plainRpc: <T>(work: () => T): T => work(), guardedRpc: <T>(work: () => T): T => {\n    check();\n    return work();\n  } };\n}\nexport const { plainRpc, guardedRpc } = makeRpc(checkRpcOrigin);\n");
    writeFileSync(join(root, "src/store/rows.ts"), "export function writeRow(value: string): string {\n  return value;\n}\n");
    writeFileSync(join(root, "src/store/write.ts"), "import { writeRow } from \"./rows.ts\";\nexport function write(value: string): string {\n  return writeRow(value);\n}\n");
    writeFileSync(join(root, "src/guard/origin.ts"), "export function checkOrigin(): void {}\nexport function checkRpcOrigin(): void {}\n");
    writeFileSync(join(root, "src/guard/guard.ts"), "import { checkOrigin } from \"./origin.ts\";\nexport function guard<T>(work: () => T): () => T {\n  return () => {\n    checkOrigin();\n    return work();\n  };\n}\n");
    writeFileSync(
      join(root, "src/api/api.ts"),
      "import { guard } from \"../guard/guard.ts\";\nimport { guardedRpc } from \"../guard/rpc.ts\";\nimport { write } from \"../store/write.ts\";\nexport const save = guard(() => write(\"a\"));\nexport function post(): string {\n  return write(\"b\");\n}\nexport function plain(): number {\n  return 1;\n}\nexport function deep(): string {\n  return post();\n}\nexport const mutate = (): string =>\n  guardedRpc(() => write(\"m\"));\n",
    );
    writeFileSync(join(root, "src/api/routes.ts"), "import { guard } from \"../guard/guard.ts\";\nimport { post, plain } from \"./api.ts\";\nexport const routes = [\n  guard(post),\n];\nexport const open = [plain];\n");
    writeFileSync(join(root, "src/api/job.ts"), "import { write } from \"../store/write.ts\";\nconst stamp = \"c\";\ntry {\n  const done = write(stamp);\n  console.log(done);\n} finally {\n  console.log(stamp);\n}\n");
    const model = loadSpecModel(root, { runs: false });
    assert.deepEqual(model.problems.filter((p) => /entrance|guard|handler/.test(p.message)), [], "a module handler and a guard naming a declared chokepoint are well formed");
    const read = await readComponentInterfaces(root);
    if (read.kind === "unread") {
      t.skip(`no instrument on this machine: ${read.because}`);
      return;
    }
    const of = (name: string) => read.entrances.find((e) => e.name === name)!;
    const guards = (name: string): string[] => (of(name).guards ?? []).map((g) => `${g.how} ${g.name}`).sort();
    assert.deepEqual(guards("save"), ["wrapper origin checked", "wrapper single writer"], "save is wrapped by the guard, and its own code calls the store's writer");
    assert.deepEqual(guards("post"), ["declared origin checked", "wrapper single writer"], "post's guard: line is confirmed where routes.ts registers it");
    assert.deepEqual([guards("plain"), of("plain").guardUnconfirmed], [[], "no registration of the handler spells guard: no statement referencing it calls the guard"], "plain's registration spells no guard");
    assert.equal(of("job").file, "src/api/job.ts", "the module handler resolves to its file");
    assert.deepEqual(of("job").reach?.map((r) => `${r.from} -> ${r.to} ${r.symbol}`), ["src/api -> src/store write"], "the script's top-level call is its reach; its import is not a use");
    assert.deepEqual(guards("job"), ["wrapper single writer"], "the script calls the writer at its top level");
    assert.deepEqual(guards("deep"), ["reach single writer"], "deep reaches the writer through post: further along its reach");
    assert.deepEqual(guards("mutate"), ["declared rpc origin", "wrapper single writer"], "a factory's destructured product no declaration line names: its guard: line is confirmed by the handler's own declaration");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a reference inside a multi-line top-level initializer is that declaration's own use, so a handler's reach follows a registry to the guard inside", { timeout: 300_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "coherence-registry-"));
  try {
    const files: Record<string, string> = {
      "coherence.config.json": JSON.stringify({ name: "registry", entryDir: ".", language: "python" }),
      "Root.spec.md": "# Root\n\nThe root.\n\n## invariants\n",
      "app/App.spec.md": "# App\n\nDispatches through a registry.\n\n## entrances\n- start: work arrives\n  handler: start in app/main.py\n\n## invariants\n",
      "lib/Lib.spec.md": "# Lib\n\nThe guard.\n\n## invariants\n- team guard: every printed query is scoped to its team.\n  protects: team_guard in guard.py\n  chokepoint: guarded in guard.py\n",
      "app/__init__.py": "",
      "lib/__init__.py": "",
      "lib/guard.py": "def team_guard():\n    return 1\n\n\ndef guarded():\n    return team_guard()\n",
      "app/registry.py": "from lib.guard import guarded\n\nPRINTERS = {\n    \"x\": guarded,\n}\n",
      "app/main.py": "from app.registry import PRINTERS\n\n\ndef start():\n    return PRINTERS[\"x\"]()\n",
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const read = await readComponentInterfaces(root);
    if (read.kind === "unread") {
      t.skip(`no Python instrument on this machine: ${read.because}`);
      return;
    }
    const start = read.entrances.find((e) => e.name === "start")!;
    assert.deepEqual(start.reach?.map((r) => `${r.from} -> ${r.to} ${r.symbol}`), ["app -> lib guarded"], "the registry's entry is the registry's own use");
    assert.deepEqual(start.guards, [{ component: "lib", name: "team guard", how: "reach" }], "and the guard behind it is on the reach");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------ control: none (d-a1095ef2) */

test("an entrance that declares control: none with its reason is never marked no traced control: its route and tag say no control needed, neutral, the inspector and the query give the reason, the trust key lists every one, and it never shares a line with an entrance that does not declare it", () => {
  const reason = "static files, the same bytes for every caller";
  const waive = (state: ShellState, names: string[]): ShellState => {
    const root = state.spec.components.find((c) => c.folder === ".")!;
    root.entrances = root.entrances.map((e) => (names.includes(e.name) ? { ...e, noControl: reason, controlLine: e.handlerLine + 2 } : e));
    return state;
  };
  const look = (state: ShellState): FlowRoute => flowOf(state).routes.find((r) => r.names.includes("look"))!;
  assert.equal(look(tracedState()).noTracedControl, true, "untrusted and untraced: marked");
  const state = waive(tracedState(), ["look"]);
  const route = look(state);
  assert.deepEqual([route.noControl, route.noTracedControl], [true, false], "declared: not marked");
  const svg = renderFlowSvg(flowOf(state), undefined).text;
  const tag = new RegExp(`id="${route.id}"[^]*?<g class="flow-trust([^"]*)" data-trust-tag="([^"]+)"[^>]*data-no-control="(true)"`).exec(svg);
  assert.ok(tag !== null, "its tag is drawn");
  assert.deepEqual([tag[1], tag[2], tag[3]], [" flow-trust-unneeded", "no control needed", "true"], "neutral words, never the attention class");
  const page = renderView({ ...state, structure: { selected: route.id, preview: [] } } as ShellState, "structure").text;
  const controls = /<dt>Controls on it<\/dt>\s*<dd>([^]*?)<\/dd>/.exec(page)?.[1] ?? /data-field="controls" data-no-control="true">[^]*?<\/ul>/.exec(page)?.[0] ?? "";
  assert.match(controls, /no control needed[^]*data-field="no-control-reason">static files, the same bytes for every caller</, "the route inspector gives the reason");
  assert.doesNotMatch(controls, /flow-attention/, "and nothing in its controls is amber");
  assert.match(renderView(state, "structure").text, /data-level="no-control-needed" data-count="1">[^]*1 entrance needs no control[^]*data-entrance="look">[^]*the root: static files, the same bytes for every caller/, "the trust key lists it where a human reads the map's words");
  const query = answerStructure(state).text;
  assert.match(query, /look {2}[^\n]*no control needed/, "the query says the same of the route");
  assert.doesNotMatch(query, /look {2}[^\n]*no traced control/);
  assert.match(query, /\.\/look {2}[^\n]*no control needed: static files, the same bytes for every caller/, "and of the entrance, with its reason");
  // A twin on the same stops and trust that declares nothing takes its own line, which stays marked.
  const twins = tracedState();
  const rootSpec = twins.spec.components.find((c) => c.folder === ".")!;
  rootSpec.entrances = [...rootSpec.entrances, { ...rootSpec.entrances.find((e) => e.name === "look")!, name: "glance", meaning: "a reader glances" }];
  if (twins.componentInterfaces.kind === "read") twins.componentInterfaces.entrances = [...twins.componentInterfaces.entrances, { component: ".", name: "glance", file: "src/reader/look.ts" }];
  assert.deepEqual(look(twins).names, ["look", "glance"], "undeclared, they share a line");
  const split = flowOf(waive(twins, ["look"]));
  const lookRoute = split.routes.find((r) => r.names.includes("look"))!;
  const glanceRoute = split.routes.find((r) => r.names.includes("glance"))!;
  assert.notEqual(lookRoute.id, glanceRoute.id, "declared differently, they never share a line");
  assert.deepEqual([lookRoute.noControl, lookRoute.noTracedControl, glanceRoute.noControl, glanceRoute.noTracedControl], [true, false, false, true]);
});

test("entrances that declare different guard: lines never share a line, so a guard declared on some of a route's entrances counts for those it names", () => {
  const twins = tracedState({ guards: [{ component: "src/core", name: "one door", how: "declared" }], guard: "door" });
  const rootSpec = twins.spec.components.find((c) => c.folder === ".")!;
  rootSpec.entrances = [...rootSpec.entrances, { ...rootSpec.entrances.find((e) => e.name === "look")!, name: "glance", meaning: "a reader glances", guard: undefined, guardLine: undefined }];
  if (twins.componentInterfaces.kind === "read") twins.componentInterfaces.entrances = [...twins.componentInterfaces.entrances, { component: ".", name: "glance", file: "src/reader/look.ts" }];
  const model = flowOf(twins);
  const guarded = model.routes.find((r) => r.names.includes("look"))!;
  const bare = model.routes.find((r) => r.names.includes("glance"))!;
  assert.notEqual(guarded.id, bare.id);
  assert.deepEqual([guarded.traced.map((c) => `${c.kind} ${c.name}`), guarded.noTracedControl, bare.noTracedControl], [["wrapper one door"], false, true]);
});
