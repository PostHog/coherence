/**
 * The connections model: which cards, lines, doors, chips and entrance
 * tokens an origin, its spawns and a selection give, read from the flow model
 * of a synthetic project, never from this repository's tree.
 *
 * The project: the root declares two entrances, run (handled in the hooks)
 * and look (handled in the reader). The hooks pass through the core's door
 * to the store and the journal; the reader calls the core, the store and the
 * journal; the store calls a far component; and a utility every other
 * component calls is a core dependency. The store's single writer stands in
 * front of the store with a crossing from outside to inside; the core's one
 * door in front of the core; the journal's append in front of the journal.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { COHERENCE_LEXICON } from "../../../lifecycle/project.ts";
import { buildScopePage } from "../build.ts";
import { resolveHash } from "../derive.ts";
import { makeFixture, type Fixture } from "../check-fixture.ts";
import type { EntranceGuard, InterfaceSymbol, ReachReference, RunEntry, ShellState, SpecComponent, SpecInvariant } from "../model.ts";
import { flowEntranceId, flowOf, flowRouteId, type FlowModel } from "../structure-flow.ts";
import { connectionsOf, connectionsOriginId, connectionsOriginOf, type ConnectionsAsk, type ConnectionsView } from "./model.ts";

let fixture: Fixture;
let base: ShellState;

before(async () => {
  fixture = makeFixture();
  ({ state: base } = await buildScopePage({ root: fixture.root, lexiconPath: COHERENCE_LEXICON, project: "Connected" }));
});

after(() => fixture.remove());

const PROJECT: { folder: string; name: string; invariants?: { name: string; chokepoint: string; protects: string; crossing?: [string, string] }[] }[] = [
  { folder: ".", name: "Connected" },
  { folder: "src/core", name: "Core", invariants: [{ name: "one door", chokepoint: "door", protects: "inner" }] },
  { folder: "src/far", name: "Far" },
  { folder: "src/hooks", name: "Hooks" },
  { folder: "src/journal", name: "Journal", invariants: [{ name: "append-only store", chokepoint: "append", protects: "appendLine", crossing: ["inside", "record"] }] },
  { folder: "src/reader", name: "Reader" },
  { folder: "src/store", name: "Store", invariants: [{ name: "single writer", chokepoint: "write", protects: "writeRow", crossing: ["outside", "inside"] }] },
  { folder: "src/util", name: "Util" },
];

const sym = (from: string, to: string, symbol: string, sites = 1): InterfaceSymbol => ({ from, to, symbol, file: `${to}/${symbol}.ts`, sites });
const ref = (from: string, to: string, symbol: string, sites = 1): ReachReference => ({ from, to, symbol, file: `${to}/${symbol}.ts`, sites });

const SYMBOLS: InterfaceSymbol[] = [
  sym(".", "src/hooks", "runHooks", 2),
  sym(".", "src/reader", "look"),
  sym("src/hooks", "src/core", "door", 3),
  sym("src/core", "src/store", "write", 4),
  sym("src/core", "src/journal", "append", 2),
  sym("src/reader", "src/core", "door"),
  sym("src/reader", "src/store", "Row", 5),
  sym("src/reader", "src/journal", "loadJournal"),
  sym("src/store", "src/far", "farOut"),
  ...["src/hooks", "src/core", "src/reader", "src/store", "src/journal"].map((from) => sym(from, "src/util", "util")),
];

/** run's handler reaches through the core's door to the store and the journal; look's from the reader to the core and the store. */
const REACH: Record<string, ReachReference[]> = {
  run: [ref(".", "src/hooks", "runHooks", 2), ref("src/hooks", "src/core", "door", 3), ref("src/core", "src/store", "write", 4), ref("src/core", "src/journal", "append", 2), ref("src/hooks", "src/util", "util")],
  look: [ref(".", "src/reader", "look"), ref("src/reader", "src/core", "door"), ref("src/core", "src/store", "write")],
};

function connectedState(options: { guards?: EntranceGuard[]; bypassed?: string } = {}): ShellState {
  const state = structuredClone(base);
  state.spec.trustLevels = [{ name: "outside", meaning: "a caller beyond the store" }, { name: "inside", meaning: "the store's own code" }, { name: "record", meaning: "the durable journal" }];
  const handlers: Record<string, string> = { run: "src/hooks", look: "src/reader" };
  const symbols: Record<string, string> = { run: "runHooks", look: "look" };
  state.spec.components = PROJECT.map((declared): SpecComponent => ({
    folder: declared.folder,
    name: declared.name,
    specPath: `${declared.folder}/${declared.name}.spec.md`,
    intent: `${declared.name} does its one thing.`,
    trustLevels: undefined,
    entrances: declared.folder !== "." ? [] : Object.entries(handlers).map(([name, folder], i) => ({ name, meaning: `${name} enters`, handler: `${symbols[name]} in ${folder}/${name}.ts`, line: 3 + i, handlerLine: 4 + i, component: ".", file: `${folder}/${name}.ts` })),
    parent: declared.folder === "." ? undefined : ".",
    children: declared.folder === "." ? PROJECT.slice(1).map((p) => p.folder) : [],
    invariants: (declared.invariants ?? []).map((inv, index): SpecInvariant => ({
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
      state: "invariant",
      lacks: [],
    })),
  }));
  const entries: RunEntry[] = state.spec.components.flatMap((component) =>
    component.invariants.map((inv): RunEntry => {
      const bypasses = options.bypassed === inv.name ? [{ file: "src/reader/sneak.ts", line: 3, symbol: "writeRow" }] : [];
      return { component: component.folder, name: inv.name, form: "chokepoint", verdict: bypasses.length > 0 ? "fail" : "pass", grade: bypasses.length > 0 ? "broken" : "reference-choked", refutation: "automatic", bypasses, testReferences: 0, files: [], latency: 1, reason: "fixture" };
    }),
  );
  state.runs.records = [{ at: "2026-10-30T10:00:00.000Z", session: "s-connected", agent: "fixture", commit: "abc1234", dirty: false, instrument: { language: "typescript", server: "warm" }, latency: 1, invariants: entries }];
  state.componentInterfaces = {
    kind: "read",
    language: "typescript",
    declarations: 12,
    symbols: SYMBOLS,
    entrances: Object.entries(handlers).map(([name, folder]) => ({ component: ".", name, file: `${folder}/${name}.ts`, reach: REACH[name]!, ...(name === "run" && options.guards !== undefined ? { guards: options.guards } : {}) })),
    unowned: { files: 0, lines: 0 },
  };
  state.structure.preview = [];
  return state;
}

const RUN = { kind: "route" as const, id: flowRouteId({ entrance: flowEntranceId(".", "run") }) };
const CORE = { kind: "component" as const, folder: "src/core" };

function view(model: FlowModel, ask: ConnectionsAsk): ConnectionsView {
  const drawn = connectionsOf(model, ask);
  assert.ok(drawn !== undefined, "the origin is in the model");
  return drawn;
}
const columns = (v: ConnectionsView): Record<string, number> => Object.fromEntries(v.cards.map((c) => [c.folder, c.column]));
const pairs = (v: ConnectionsView): string[] => v.lines.map((l) => `${l.from} -> ${l.to}`).sort();

test("connections: columns are hops from the origin, callees right and callers left of a component, along the handler's reach from a route", () => {
  const model = flowOf(connectedState({ guards: [{ component: "src/journal", name: "append-only store", how: "reach" }] }));
  assert.ok(model.coreDependencies.some((c) => c.folder === "src/util"), "the utility every component calls is a core dependency");
  assert.deepEqual(columns(view(model, { origin: CORE })), { "src/hooks": -1, "src/reader": -1, "src/core": 0, "src/journal": 1, "src/store": 1 }, "the core's callers left, its callees right, the core dependency no card");
  // From run: the root declares it and the hooks handle it (both column 1), the core is one hop along its reach, and
  // the journal, whose chokepoint the work passes, is drawn from the start at one plus its two hops; the store waits for a spawn.
  assert.deepEqual(columns(view(model, { origin: RUN })), { ".": 1, "src/hooks": 1, "src/core": 2, "src/journal": 3 });
  const plain = view(flowOf(connectedState()), { origin: RUN });
  assert.deepEqual(columns(plain), { ".": 1, "src/hooks": 1, "src/core": 2 }, "with no chokepoint traced, only the reach out of the starts is drawn");
  assert.deepEqual(plain.entry, { to: "src/hooks", identifiers: plain.route!.entry }, "the work enters at its handler's component");
  assert.equal(connectionsOf(model, { origin: { kind: "component", folder: "src/gone" } }), undefined, "an origin the model lacks draws nothing");
});

test("connections: +N counts what a spawn adds one hop further out, and a spawn adds exactly that", () => {
  const model = flowOf(connectedState());
  const fromCore = view(model, { origin: CORE });
  const more = Object.fromEntries(fromCore.cards.map((c) => [c.folder, c.more]));
  assert.deepEqual(more, { "src/hooks": 1, "src/reader": 1, "src/core": 0, "src/journal": 0, "src/store": 1 }, "callers count their callers, callees their callees, the origin nothing, a core dependency never");
  const spawned = view(model, { origin: CORE, spawned: ["src/store", "src/hooks"] });
  assert.deepEqual(columns(spawned), { ".": -2, "src/hooks": -1, "src/reader": -1, "src/core": 0, "src/journal": 1, "src/store": 1, "src/far": 2 });
  assert.equal(spawned.cards.find((c) => c.folder === "src/reader")!.more, 0, "the root the reader's +N counted is drawn now");

  const fromRun = view(model, { origin: RUN });
  assert.equal(fromRun.cards.find((c) => c.folder === "src/core")!.more, 2, "the core's reach goes on to the store and the journal");
  const further = view(model, { origin: RUN, spawned: ["src/core"] });
  assert.deepEqual(columns(further), { ".": 1, "src/hooks": 1, "src/core": 2, "src/journal": 3, "src/store": 3 }, "a spawn along the reach stands at its hops");
  assert.equal(further.cards.find((c) => c.folder === "src/store")!.more, 0, "the store calls the far component, but run's reach never does");
});

test("connections: every component interface between drawn cards is a line, and the route's own are those its reach uses", () => {
  const model = flowOf(connectedState());
  const fromCore = view(model, { origin: CORE });
  const drawn = new Set(fromCore.cards.map((c) => c.folder));
  const expected = model.edges.filter((e) => drawn.has(e.from) && drawn.has(e.to)).map((e) => `${e.from} -> ${e.to}`).sort();
  assert.deepEqual(pairs(fromCore), expected, "every interface between drawn cards, none other");
  assert.ok(pairs(fromCore).includes("src/reader -> src/journal"), "an interface between two cards on either side of the origin is drawn");
  assert.ok(fromCore.lines.every((l) => !l.work), "a component origin has no work of its own");

  const fromRun = view(model, { origin: { kind: "route", id: flowRouteId({ entrance: flowEntranceId(".", "look") }) }, spawned: ["src/core"] });
  const work = fromRun.lines.filter((l) => l.work).map((l) => `${l.from} -> ${l.to}`).sort();
  assert.deepEqual(work, [". -> src/reader", "src/core -> src/store", "src/reader -> src/core"], "look's own lines are its reach");
  assert.ok(fromRun.lines.some((l) => !l.work && l.from === "src/reader" && l.to === "src/store"), "an interface its work does not use is still drawn, not its own");
  const own = fromRun.lines.find((l) => l.from === "src/core" && l.to === "src/store")!;
  assert.deepEqual([own.workSites, own.workSymbols], [1, ["write"]], "with the sites and symbols the work references");
});

test("connections: a chokepoint is drawn once, at the door of the callee, listing every caller it stands in front of, with its crossing and its bypass", () => {
  const model = flowOf(connectedState());
  const fromCore = view(model, { origin: CORE });
  const doors = Object.fromEntries(fromCore.doors.map((d) => [d.component, d.chokepoints.map((c) => `${c.name} ${c.callers.join(",")}`)]));
  assert.deepEqual(doors, { "src/core": ["one door src/hooks,src/reader"], "src/journal": ["append-only store src/core"], "src/store": ["single writer src/core"] }, "one door per component, each chokepoint once, never one per interface");
  const store = fromCore.doors.find((d) => d.component === "src/store")!;
  assert.deepEqual([store.crossing, store.chokepoints[0]!.crossing, store.state], [true, { from: "outside", to: "inside" }, "verified"]);
  assert.match(store.chokepoints[0]!.identifier, /^X\d+$/, "a chokepoint with a crossing wears an X identifier");
  assert.equal(fromCore.doors.find((d) => d.component === "src/core")!.crossing, false, "no tick where trust does not change");

  // From the hooks, the reader is not drawn, and the core's door still lists it: every caller reaches the protected thing through it.
  const fromHooks = view(model, { origin: { kind: "component", folder: "src/hooks" } });
  assert.deepEqual(fromHooks.doors.map((d) => [d.component, d.chokepoints[0]!.callers]), [["src/core", ["src/hooks", "src/reader"]]]);

  const broken = view(flowOf(connectedState({ bypassed: "single writer" })), { origin: CORE });
  assert.equal(broken.doors.find((d) => d.component === "src/store")!.state, "broken", "a recorded bypass breaks the door");
});

test("connections: a core dependency is a chip on the cards that use it, and a card only as the origin or when asked", () => {
  const model = flowOf(connectedState());
  const fromCore = view(model, { origin: CORE });
  assert.deepEqual(fromCore.cards.map((c) => [c.folder, c.chips]), [["src/hooks", ["src/util"]], ["src/reader", ["src/util"]], ["src/core", ["src/util"]], ["src/journal", ["src/util"]], ["src/store", ["src/util"]]]);
  const asked = view(model, { origin: CORE, cores: ["src/util"] });
  assert.equal(columns(asked)["src/util"], 1, "asked for, it is a card");
  assert.ok(asked.cards.every((c) => c.chips.length === 0) && asked.lines.some((l) => l.to === "src/util"), "and its uses are lines, no longer chips");
  assert.deepEqual(columns(view(model, { origin: { kind: "component", folder: "src/util" } }))["src/util"], 0, "the origin is always a card");
  const fromRun = view(model, { origin: RUN });
  assert.deepEqual(fromRun.cards.find((c) => c.folder === "src/hooks")!.chips, ["src/util"], "from a route, the core dependencies its reach uses");
  assert.deepEqual(fromRun.cards.find((c) => c.folder === "src/core")!.chips, [], "and not those the card calls outside the work");
});

test("connections: selecting a card keeps only the lines that touch it and gives a token for every route whose reach gets to it, fewest hops first", () => {
  const model = flowOf(connectedState());
  const selected = view(model, { origin: CORE, selected: "src/store" });
  assert.deepEqual(pairs(selected), ["src/core -> src/store", "src/reader -> src/store"], "the lines that do not touch it are removed");
  assert.deepEqual(selected.doors.map((d) => d.component), ["src/store"], "and the doors they carried with them");
  const names = (id: string): string => model.routes.find((r) => r.id === id)!.names.join(",");
  assert.deepEqual(selected.tokens.map((t) => `${names(t.route)} ${t.hops} ${t.enters}`), ["look 2 src/reader", "run 2 src/hooks"], "both routes reach the store two hops in");
  assert.deepEqual(view(model, { origin: CORE, selected: "src/hooks" }).tokens.map((t) => `${names(t.route)} ${t.hops}`), ["run 0"], "a route starting at the card enters there");
  const fromRun = view(model, { origin: RUN, selected: "src/core" });
  assert.deepEqual(fromRun.tokens.map((t) => [names(t.route), t.origin]), [["look", false], ["run", true]], "the origin route is marked among them");
  assert.deepEqual(view(model, { origin: CORE, selected: "src/far" }).lines.length, view(model, { origin: CORE }).lines.length, "a selection that is not drawn prunes nothing");
});

test("connections: every route and component has a deep link that names it back", () => {
  const state = connectedState();
  const model = flowOf(state);
  const origins = [...model.routes.map((r) => ({ kind: "route" as const, id: r.id })), ...model.nodes.map((n) => ({ kind: "component" as const, folder: n.folder }))];
  assert.ok(origins.length > model.nodes.length, "the model has routes and components");
  const ids = origins.map(connectionsOriginId);
  assert.equal(new Set(ids).size, ids.length, "no two origins share an id");
  for (const [i, id] of ids.entries()) {
    assert.match(id, /^connections--(route|component)-/);
    assert.deepEqual(connectionsOriginOf(model, id), origins[i], `${id} names its origin`);
    assert.deepEqual(resolveHash(state, `#${id}`), { view: "connections", id }, `#${id} opens Connections through the page's one hash scheme`);
  }
  assert.equal(connectionsOriginId(CORE), "connections--component-src-core");
  assert.equal(connectionsOriginId({ kind: "component", folder: "." }), "connections--component-root");
  assert.equal(connectionsOriginOf(model, "connections--component-src-gone"), undefined);
});
