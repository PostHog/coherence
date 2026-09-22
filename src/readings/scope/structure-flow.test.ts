/**
 * The Structure map check: every component interface drawn from caller to
 * callee, annotated from the invariants, stable positions, entrances
 * declared and checked, zoom, selection, determinism, the text form, the
 * comparison seam, and one selection per reviewer question.
 *
 * The synthetic project: the root CLI dispatches into the hooks, the hooks
 * call the core, the core writes the store and appends to the journal, and a
 * reader calls the core, the store and the journal the way Scope reads
 * everything. The store's single writer has a chokepoint, write, with a
 * crossing from outside to inside; the journal's append has one from inside
 * to record.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
import { FLOW_CHANGE_ID, compareFlows, flowEdgeId, flowEntranceId, flowLabelLines, flowNodeId, flowOf, flowSelection } from "./structure-flow.ts";
import { flowLayout, renderFlowSvg } from "./structure-flow-view.ts";

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

test("every component interface is drawn from caller to callee, and none is implied away", () => {
  const drawn = pairs(projectState());
  for (const expected of [". -> src/hooks", "src/hooks -> src/core", "src/core -> src/store", "src/core -> src/journal", "src/reader -> src/core", "src/reader -> src/store", "src/reader -> src/journal", "src/store -> src/journal"]) {
    assert.ok(drawn.includes(expected), `${expected} is drawn`);
  }
  assert.ok(drawn.includes("src/reader -> src/journal") && drawn.includes("src/reader -> src/core") && drawn.includes("src/core -> src/journal"), "an interface a path of others implies is still drawn: it is a real surface");
  assert.ok(!drawn.includes("src/store -> src/reader") && !drawn.includes("src/core -> src/hooks"), "arrows point from caller to callee only");
  const svg = renderFlowSvg(flowOf(projectState()), undefined).text;
  assert.equal([...svg.matchAll(/<g class="flow-edge /g)].length, drawn.length, "one arrow per component interface");
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

test("stability: adding one component interface moves only the two components it joins", () => {
  const before = flowLayout(flowOf(projectState()));
  const after = flowLayout(flowOf(projectState({ symbols: [...SYMBOLS, sym("src/journal", "src/hooks", "hookName", "src/hooks/name.ts")] })));
  const moved = [...before.boxes.keys()].filter((folder) => JSON.stringify(before.boxes.get(folder)) !== JSON.stringify(after.boxes.get(folder)));
  assert.ok(moved.every((folder) => folder === "src/journal" || folder === "src/hooks"), `only the caller and callee may move; moved: ${moved.join(", ")}`);
  for (const folder of before.boxes.keys()) {
    if (folder === "src/journal" || folder === "src/hooks") continue;
    assert.deepEqual(after.boxes.get(folder), before.boxes.get(folder), `${folder} keeps its position`);
  }
  assert.deepEqual([...before.boxes.keys()], [...flowLayout(flowOf(projectState())).boxes.keys()], "the same inputs place the same components the same way");
});

test("a reader is placed at the edge of the flow, never in its middle", () => {
  const model = flowOf(projectState());
  const band = (folder: string): number | undefined => model.nodes.find((node) => node.folder === folder)?.band;
  assert.equal(band("src/reader"), 0, "a reader calls and is called by nothing: the top band");
  assert.equal(band("."), 0, "the root declares the entrances: the top band");
  assert.equal(band("src/journal"), 4, "the journal is only called: the foundations");
  assert.ok(band("src/core") !== undefined && band("src/core")! > 0 && band("src/core")! < 4, "the core is between");
});

test("selecting an entrance lights the component interfaces reachable from it and dims the rest", () => {
  const state = projectState();
  const model = flowOf(state);
  const run = model.entrances.find((e) => e.name === "run")!;
  assert.equal(run.start, "src/hooks");
  assert.ok(run.reachable, "the root's interface to the hooks carries runHooks");
  const lit = flowSelection(model, run.id);
  assert.deepEqual([...lit.nodes].sort(), [".", "src/core", "src/hooks", "src/journal", "src/store"]);
  state.structure.selected = run.id;
  const svg = renderView(state, "structure").text;
  assert.match(svg, /<g class="flow-node is-dim" id="structure--node-src-reader"/, "the reader dims");
  assert.match(svg, new RegExp(`<g class="flow-edge flow-quiet is-dim" id="${flowEdgeId("src/reader", "src/journal")}"`), "an interface off the path dims");
  assert.match(svg, new RegExp(`<g class="flow-edge flow-bearing is-lit[^"]*" id="${flowEdgeId("src/core", "src/store")}"`), "an interface on the path is lit");
  assert.match(svg, /data-kind="entrance"/);
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
  assert.match(renderView(state, "structure").text, new RegExp(`<g class="flow-edge flow-bearing is-lit[^"]*" id="${flowEdgeId("src/core", "src/journal")}"`));
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

test("query structure prints the edge set, labels and ranks the view draws, from the same derivation", () => {
  const state = projectState();
  const text = answerStructure(state).text;
  const queried = text.split("\n").filter((line) => /^ {2}\S+ -> \S+ {2}/.test(line)).map((line) => {
    const [pair, label] = line.trim().split(/ {2}/) as [string, string];
    return `${pair}: ${label}`;
  });
  const drawn = [...renderView(state, "structure").text.matchAll(/<g class="flow-edge[^"]*" id="[^"]+" data-from="([^"]+)" data-to="([^"]+)" data-label="([^"]+)"/g)].map((m) => `${m[1]} -> ${m[2]}: ${m[3]!.replace(/&amp;/g, "&")}`);
  assert.ok(drawn.length > 0);
  assert.deepEqual(queried, drawn, "the text form equals the view's interfaces and labels");
  const model = flowOf(state);
  for (let band = 0; band < 5; band++) {
    const folders = model.nodes.filter((node) => node.band === band).map((node) => node.folder);
    assert.ok(text.includes(`  ${band}  ${folders.length === 0 ? "-" : folders.join(", ")}`), `row ${band}`);
  }
  assert.equal(answer(state, "structure", ["extra"]).code, 64);
});

test("an interface a bypass crosses is drawn broken with its count, and the inspector names the sites and both options", () => {
  const state = projectState({ states: { "single writer": "structural defect" }, bypasses: { "single writer": [{ file: "src/reader/look.ts", line: 9, symbol: "peek" }] } });
  const model = flowOf(state);
  const edge = model.edges.find((candidate) => candidate.id === flowEdgeId("src/reader", "src/store"))!;
  assert.equal(edge.bypasses.length, 1);
  assert.ok(flowLabelLines(edge).some((line) => line.kind === "defect" && line.text === "broken: 1 bypass"));
  state.structure.selected = edge.id;
  const rendered = renderView(state, "structure").text;
  assert.match(rendered, /class="flow-edge flow-defect is-lit is-selected[^"]*"/);
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
  assert.match(ask(flowLevelId("inside")), new RegExp(`class="flow-edge flow-defect is-lit[^"]*" id="${flowEdgeId("src/api", "src/store")}"`));
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
