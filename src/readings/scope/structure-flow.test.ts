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
import { CORE_RULE, FLOW_CHANGE_ID, FLOW_HEALTH_KINDS, FLOW_NONE_ID, compareFlows, flowBrokenId, flowHealthId, flowHealthMembers, flowDefaultSelection, flowEdgeId, flowEntranceId, flowKeyAction, flowLabelLines, flowNodeId, flowOf, flowSelected, flowSelection, type FlowEntrance, type FlowModel, type FlowRoute } from "./structure-flow.ts";

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



/** What the map should open on, by the rule's own words: nothing, unless a component is broken, then the one with the most broken chokepoints, then the first in folder order. */
function opening(model: FlowModel): string | undefined {
  const broken = model.nodes.filter((n) => n.defects.length > 0);
  if (broken.length === 0) return undefined;
  const most = Math.max(...broken.map((n) => n.defects.length));
  return broken.find((n) => n.defects.length === most)!.id;
}














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


test("links into the retired Reliance view and the security spine land on the one map's selections", () => {
  const state = projectState();
  assert.deepEqual(resolveHash(state, `#${relianceId("src/store", "single writer")}`), { view: "structure", id: flowChokepointId("src/store", "single writer") });
  assert.deepEqual(resolveHash(state, `#${structureId("src/store", "single writer")}`), { view: "structure", id: flowChokepointId("src/store", "single writer") });
  assert.deepEqual(resolveHash(state, "#reliance"), { view: "structure", id: undefined });
  assert.deepEqual(resolveHash(state, `#${flowEntranceId(".", "run")}`), { view: "structure", id: flowEntranceId(".", "run") });
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



/** Whether a component is covered, by the rule's own words (decision d-a02f255c). */
function coveredByRule(model: FlowModel, state: ShellState, folder: string): boolean {
  const exposed = model.edges.some((e) => e.to === folder && e.chokepoints.length > 0);
  const entered = model.identifiers.some((i) => i.routes.length > 0 && i.component === folder);
  const verifiedTotality = allInvariants(state.spec.components).some((i) => i.component === folder && i.enforcements.some((e) => e.form === "totality oracle") && invariantVerdict(i, state.runs.records).state === "verified");
  return exposed || entered || verifiedTotality;
}




/** Every selection of a model, as the motion check walks them. */
function motionSelections(model: FlowModel): (string | undefined)[] {
  return [undefined, ...model.routes.map((r) => r.id), ...model.entrances.map((e) => e.id), ...model.nodes.map((n) => n.id), ...model.levels.map((l) => l.id), ...model.chokepoints.map((c) => c.id), ...model.edges.map((e) => e.id)];
}


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
