/**
 * The Structure map: what a system is made of and how work flows through
 * it, derived from the state on every render and stored nowhere. It is drawn
 * the way transit maps and process drawings are: journeys, not connections.
 *
 * Nodes are the components visible at the current zoom: one level of the
 * component tree at a time, a component opened in place showing its children
 * beside its own code. Edges are component interfaces, from caller to
 * callee: for each ordered pair of visible components, the symbols the
 * caller's non-test code references in the callee, as the language adapter
 * resolved them (the state's `componentInterfaces` reading, aggregated up to
 * the visible components). Without that reading only the references the
 * latest runs recorded (to chokepoints and protected things) are known, and
 * the model says so. Every component interface is in the model; none is
 * implied away.
 *
 * Structural routes. Each entrance's route is the path work takes from it:
 * the component that declares it, the component holding its handler, then,
 * from each stop, the heaviest component interface (most reference sites,
 * ties by folder) to a component not yet on the route and not a core
 * dependency, until none is left. Entrances whose routes are the same stops
 * share one line. A project that declares no entrance has its routes derived
 * from the root component's component interfaces, one per callee, and the
 * model says so.
 *
 * Core dependencies. A component that more than half of the other visible
 * components call, with at least three callers and at least three quarters
 * of its component interfaces incoming, is a utility: drawn as a rail its
 * callers attach to by a short stub, never as a route stop or an arrow.
 *
 * Interface identifiers. Every chokepoint gets a short identifier from its
 * place in the chokepoint list (C for a chokepoint, X for one whose
 * invariant carries a crossing), drawn on each component interface it
 * stands on.
 *
 * An interface is annotated from the invariants, never authored: the
 * chokepoint that stands on it (a chokepoint symbol among its symbols), the
 * crossing of that invariant when trust changes there, and the classes of
 * data that pass (the trust levels of those crossings). A bypass the latest
 * run classified on the pair marks it broken.
 *
 * Stability. Positions are a pure function of entrances and component
 * interfaces, ties broken by name, and each component is placed by its own
 * facts alone: its row is its place in folder order among the visible
 * components, and its column its distance from where work enters, read
 * from its own callers: 0 when its spec declares an entrance (or, when no
 * spec does, when it is the root) or nothing calls it, 1 when an entrance's
 * component calls it, 2 otherwise. Adding one interface changes only its
 * callee's callers, so it moves at most the components it joins. The price
 * is that distance is capped at two, and rows follow folders rather than
 * straightening routes; routes are straightened by routing instead.
 *
 * The comparison seam: `compareFlows` takes two models (two states, two
 * commits) and names what changed with the five measures Structure's diff
 * will show.
 */

import { allInvariants, componentOfFile, flowChokepointId, flowLevelId, latestOf, type RelianceSite } from "./derive.ts";
import { slug } from "./html.ts";
import type { InterfaceSymbol, RecordedSite, ShellState, SpecComponent, SpecInvariant } from "./model.ts";

/** Three columns: where work enters, one interface in, further in. */
export const FLOW_COLUMNS = 3;

/** The rule that makes a component a core dependency, as the map and the query state it. */
export const CORE_RULE = "called by more than half of the other visible components, by at least three, with at least three quarters of its component interfaces incoming";

/* ------------------------------------------------------------------ ids */

/** Map ids start with "structure--": a slug never begins with a hyphen, so no other id can collide. */
function flowSlug(folder: string): string {
  return folder === "." ? "root" : slug(folder);
}

export function flowNodeId(folder: string): string {
  return `structure--node-${flowSlug(folder)}`;
}

export function flowEdgeId(from: string, to: string): string {
  return `structure--interface-${flowSlug(from)}--${flowSlug(to)}`;
}

export function flowEntranceId(component: string, name: string): string {
  return `structure--entrance-${flowSlug(component)}--${slug(name)}`;
}

/** A route's id from its first stop and its letter's place. */
export function flowRouteId(letter: string): string {
  return `structure--route-${letter.toLowerCase()}`;
}

/** The one selection that asks what a change touches and what it weakened: the diff's place on the map. */
export const FLOW_CHANGE_ID = "structure--change";

export function isFlowId(id: string): boolean {
  return id.startsWith("structure--");
}

/* ---------------------------------------------------------------- types */

/** Where the symbols of the component interfaces came from. */
export type FlowEvidence = "language adapter" | "run sites only";

export interface FlowInvariantRef {
  component: string;
  name: string;
  state: SpecInvariant["state"];
}

export interface FlowChokepoint extends FlowInvariantRef {
  id: string;
  chokepoint: string;
  protects: string;
}

export interface FlowCrossing extends FlowInvariantRef {
  from: string;
  to: string;
}

/** One component interface: every symbol `from` references in `to`, and what the invariants reveal about it. */
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** Most-referenced first, then by name. */
  symbols: Omit<InterfaceSymbol, "from" | "to">[];
  sites: number;
  chokepoints: FlowChokepoint[];
  crossings: FlowCrossing[];
  /** The classes of data that pass: the trust levels of its crossings, in declaration order. */
  levels: string[];
  /** Bypass sites in `from` of a protected thing whose invariant `to` owns, from the latest run. */
  bypasses: (RelianceSite & { invariant: string })[];
  /** Load-bearing: a chokepoint or a crossing stands on it. */
  loadBearing: boolean;
  /** The structural routes that run along it, by id. */
  routes: string[];
  /** Whether its callee is a core dependency: drawn as a stub, never as a line. */
  stub: boolean;
  /** The interface identifiers standing on it, in chokepoint order. */
  identifiers: string[];
}

/** One structural route: the stops one or more entrances' work takes, in order, drawn as one line of its own color. */
export interface FlowRoute {
  id: string;
  /** A short name, A, B, C, in route order: what the line wears at its terminus. */
  letter: string;
  /** The color slot, 0 to 7; undefined past the eighth route, which is drawn neutral with its letter. */
  slot: number | undefined;
  /** Entrance ids that take this route; empty when the route is derived from the root's interfaces. */
  entrances: string[];
  /** Component folders in the order work reaches them. */
  stops: string[];
  /** Component interface ids between consecutive stops. */
  edges: string[];
  /** The core dependency the route ends into, when its next stop would be one. */
  rail: string | undefined;
}

/** A core dependency: a component most others call, drawn as a rail. */
export interface FlowCore {
  folder: string;
  /** Visible components calling it, in folder order. */
  callers: string[];
  /** Interface ids from its callers: each is a stub. */
  stubs: string[];
}

/** An interface identifier: the short tag a chokepoint wears where it stands. */
export interface FlowIdentifier {
  /** The tag itself: C or X and the chokepoint's place in the list, as C3 or X7. */
  text: string;
  /** The chokepoint's id. */
  chokepoint: string;
  component: string;
  name: string;
  /** The crossing of its invariant, when trust changes there: a trust boundary on the map. */
  crossing: { from: string; to: string } | undefined;
  /** Component interface ids it stands on. */
  edges: string[];
}

export interface FlowEntrance {
  id: string;
  name: string;
  meaning: string;
  /** The component whose spec declares it. */
  declaredBy: string;
  handler: string | undefined;
  /** The visible component holding the resolved handler, where its flow starts. */
  start: string | undefined;
  resolved: boolean;
  reachable: boolean;
  /** Why it is unresolved or unreachable. */
  reason: string | undefined;
}

export interface FlowNode {
  id: string;
  folder: string;
  name: string;
  intent: string;
  /** Place in folder order among the visible components: its row. */
  row: number;
  /** Distance from where work enters, capped at 2, read from its own callers (see the file comment). */
  column: number;
  /** Distinct visible components it calls, and that call it. */
  out: number;
  in: number;
  /** Whether work enters here: its spec declares an entrance, or none does and it is the root. */
  declaresEntrance: boolean;
  /** Whether it is a core dependency, drawn as a rail. */
  core: boolean;
  /** Whether no component interface touches it. */
  unconnected: boolean;
  /** Entrances whose flow starts here. */
  entrances: string[];
  /** Components nested beneath it, and whether they are shown. */
  children: number;
  expanded: boolean;
  /** Broken chokepoints of its invariants, with the bypasses inside it that no edge can show. */
  defects: { name: string; state: SpecInvariant["state"]; bypasses: number; internal: number }[];
}

export interface FlowLevel {
  id: string;
  name: string;
  meaning: string;
  /** Interfaces whose crossings carry this class of data. */
  edges: string[];
  /** Crossing-bearing invariants naming this level that stand on no interface. */
  unplaced: FlowCrossing[];
}

export interface FlowModel {
  evidence: FlowEvidence;
  /** The language the adapter read, when it read. */
  language: string | undefined;
  /** Why the adapter's reading is absent, when it is. */
  unread: string | undefined;
  /** Visible components in folder order (their column order). */
  nodes: FlowNode[];
  /** Every component interface between visible components, in folder order of caller then callee. */
  edges: FlowEdge[];
  entrances: FlowEntrance[];
  levels: FlowLevel[];
  chokepoints: FlowChokepoint[];
  /** Structural routes in route order. */
  routes: FlowRoute[];
  /** Where the routes come from: declared entrances, or the root's interfaces when no entrance is declared. */
  routesFrom: "entrances" | "root interfaces" | "none";
  coreDependencies: FlowCore[];
  identifiers: FlowIdentifier[];
  /** Source under no component's folder, when the adapter read the tree. */
  unowned: { files: number; lines: number } | undefined;
}

/* ------------------------------------------------------ interface symbols */

const FLOW_NAME = /^([A-Za-z_$][\w$]*)(?:\s+in\s+(\S+))?$/;

/** A spec value as a symbol and optional file, or a module path; undefined for prose. */
function flowNamed(value: string): { symbol?: string; file?: string } | undefined {
  const named = FLOW_NAME.exec(value.trim());
  if (named !== null) return named[2] === undefined ? { symbol: named[1]! } : { symbol: named[1]!, file: named[2]! };
  if (/^[A-Za-z0-9_./@-]+\.[A-Za-z]+$/.test(value.trim())) return { file: value.trim() };
  return undefined;
}

/** Whether an interface symbol is the named thing: the same symbol (in the named file, when one is named), or any symbol of a named module. */
function flowIs(symbol: Omit<InterfaceSymbol, "from" | "to">, named: { symbol?: string; file?: string }): boolean {
  const inFile = named.file === undefined || symbol.file === "" || symbol.file === named.file || symbol.file.endsWith(`/${named.file}`);
  return named.symbol === undefined ? inFile && symbol.file !== "" : symbol.symbol === named.symbol && inFile;
}

/** The symbols the latest runs recorded as referenced across components: the fallback when the adapter was not asked. */
function flowRunSymbols(state: ShellState): InterfaceSymbol[] {
  const components = state.spec.components;
  const tally = new Map<string, InterfaceSymbol>();
  for (const invariant of allInvariants(components)) {
    const entry = latestOf(invariant, state.runs.records).find((candidate) => candidate.form === "chokepoint");
    if (entry?.sites === undefined) continue;
    for (const enforcement of invariant.enforcements) {
      if (enforcement.form !== "chokepoint") continue;
      for (const site of entry.sites) {
        if (site.test || site.class === "test" || site.class === "inside") continue;
        const from = componentOfFile(site.file, components)?.folder;
        if (from === undefined || from === invariant.component) continue;
        const value = site.of === "chokepoint" ? enforcement.chokepoint : enforcement.protects;
        const named = flowNamed(value);
        const symbol = named?.symbol ?? value;
        const key = `${from}\u0000${invariant.component}\u0000${symbol}`;
        const known = tally.get(key);
        if (known === undefined) tally.set(key, { from, to: invariant.component, symbol, file: named?.file ?? "", sites: 1 });
        else known.sites += 1;
      }
    }
  }
  return [...tally.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.symbol.localeCompare(b.symbol));
}

function flowBypasses(state: ShellState, invariant: SpecInvariant): RecordedSite[] {
  // A chokepoint entry kept from before the bullet dropped its chokepoint form is history, not evidence.
  if (!invariant.enforcements.some((e) => e.form === "chokepoint")) return [];
  const entry = latestOf(invariant, state.runs.records).find((candidate) => candidate.form === "chokepoint");
  if (entry === undefined) return [];
  if (entry.sites !== undefined) return entry.sites.filter((site) => site.class === "bypass" && !site.test);
  return entry.bypasses.map((b): RecordedSite => ({ file: b.file, line: b.line, symbol: b.symbol, class: "bypass", of: "protected", test: false }));
}

/* --------------------------------------------------------------- zoom */

/** The folders open in place: as the state says, else every top-level component. */
export function flowExpanded(state: ShellState): Set<string> {
  if (state.structure.expanded !== undefined) return new Set(state.structure.expanded);
  return new Set(state.spec.components.filter((component) => component.parent === undefined).map((component) => component.folder));
}

/** The visible component that stands for a folder at the current zoom: itself when every ancestor is open, else the nearest closed ancestor. */
function flowRepresentative(components: Map<string, SpecComponent>, expanded: Set<string>, folder: string): string {
  const chain: string[] = [];
  for (let at: string | undefined = folder; at !== undefined; at = components.get(at)?.parent) chain.unshift(at);
  for (let index = 0; index < chain.length - 1; index++) if (!expanded.has(chain[index]!)) return chain[index]!;
  return folder;
}

/* ---------------------------------------------------------- the model */

/**
 * Derive the Structure map from the state: the one pure function the view
 * and `query structure` both read.
 */
export function flowOf(state: ShellState): FlowModel {
  const components = state.spec.components;
  const byFolder = new Map(components.map((component) => [component.folder, component]));
  const expanded = flowExpanded(state);
  const represent = (folder: string): string => flowRepresentative(byFolder, expanded, folder);
  const visible = components.filter((component) => represent(component.folder) === component.folder);
  const order = new Map(visible.map((component, index) => [component.folder, index]));
  const invariants = allInvariants(components);
  const levelOrder = new Map(state.spec.trustLevels.map((level, index) => [level.name, index]));
  const reading = state.componentInterfaces;
  const symbols = reading.kind === "read" ? reading.symbols : flowRunSymbols(state);

  const pairs = new Map<string, Map<string, Omit<InterfaceSymbol, "from" | "to">>>();
  for (const symbol of symbols) {
    if (!byFolder.has(symbol.from) || !byFolder.has(symbol.to)) continue;
    const from = represent(symbol.from);
    const to = represent(symbol.to);
    if (from === to) continue;
    const key = `${from}\u0000${to}`;
    const carried = pairs.get(key) ?? new Map<string, Omit<InterfaceSymbol, "from" | "to">>();
    pairs.set(key, carried);
    const known = carried.get(`${symbol.symbol}\u0000${symbol.file}`);
    if (known === undefined) carried.set(`${symbol.symbol}\u0000${symbol.file}`, { symbol: symbol.symbol, file: symbol.file, sites: symbol.sites });
    else known.sites += symbol.sites;
  }

  const chokepoints: FlowChokepoint[] = invariants.flatMap((invariant) =>
    invariant.enforcements.flatMap((enforcement): FlowChokepoint[] =>
      enforcement.form === "chokepoint"
        ? [{ id: flowChokepointId(invariant.component, invariant.name), component: invariant.component, name: invariant.name, state: invariant.state, chokepoint: enforcement.chokepoint, protects: enforcement.protects }]
        : [],
    ),
  );

  const edges: FlowEdge[] = [...pairs.entries()]
    .sort(([a], [b]) => {
      const [af, at] = a.split("\u0000") as [string, string];
      const [bf, bt] = b.split("\u0000") as [string, string];
      return order.get(af)! - order.get(bf)! || order.get(at)! - order.get(bt)!;
    })
    .map(([key, carried]) => {
      const [from, to] = key.split("\u0000") as [string, string];
      const list = [...carried.values()].sort((a, b) => b.sites - a.sites || a.symbol.localeCompare(b.symbol) || a.file.localeCompare(b.file));
      const standing = chokepoints.filter((c) => represent(c.component) === to && list.some((symbol) => { const named = flowNamed(c.chokepoint); return named !== undefined && flowIs(symbol, named); }));
      const crossings: FlowCrossing[] = standing.flatMap((c) => {
        const crossing = invariants.find((invariant) => invariant.component === c.component && invariant.name === c.name)?.crossing;
        return crossing === undefined ? [] : [{ component: c.component, name: c.name, state: c.state, from: crossing.from, to: crossing.to }];
      });
      const bypasses: FlowEdge["bypasses"] = [];
      for (const invariant of invariants) {
        if (represent(invariant.component) !== to) continue;
        for (const site of flowBypasses(state, invariant)) {
          const component = componentOfFile(site.file, components);
          if (component === undefined || represent(component.folder) !== from) continue;
          bypasses.push({ file: site.file, line: site.line, symbol: site.symbol, target: site.of, siteClass: site.class, form: site.form, component, owner: false, test: false, invariant: invariant.name });
        }
      }
      const levels = [...new Set(crossings.flatMap((c) => [c.from, c.to]))].sort((a, b) => (levelOrder.get(a) ?? 99) - (levelOrder.get(b) ?? 99) || a.localeCompare(b));
      return {
        id: flowEdgeId(from, to),
        from,
        to,
        symbols: list,
        sites: list.reduce((sum, symbol) => sum + symbol.sites, 0),
        chokepoints: standing,
        crossings,
        levels,
        bypasses: bypasses.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
        loadBearing: standing.length > 0 || crossings.length > 0,
        routes: [] as string[],
        stub: false,
        identifiers: [] as string[],
      };
    });

  // Entrances: resolved by the adapter when it was asked, else by the spec model's own check.
  const resolutions = reading.kind === "read" ? reading.entrances : undefined;
  const entrances: FlowEntrance[] = components.flatMap((component) =>
    (component.entrances ?? []).map((entrance): FlowEntrance => {
      const resolution = resolutions?.find((r) => r.component === component.folder && r.name === entrance.name);
      const file = resolutions === undefined ? entrance.file : resolution?.file;
      const holder = file === undefined ? undefined : componentOfFile(file, components)?.folder;
      const start = holder === undefined ? undefined : represent(holder);
      const declaredBy = represent(component.folder);
      const handlerName = entrance.handler?.split(/\s+in\s+/)[0];
      const dispatch = edges.find((edge) => edge.from === declaredBy && edge.to === start);
      const reachable = start !== undefined && (start === declaredBy || (dispatch?.symbols.some((symbol) => symbol.symbol === handlerName) ?? false));
      const reason =
        start === undefined
          ? (resolution?.reason ?? "the handler did not resolve")
          : reachable
            ? undefined
            : `the handler resolves in ${start}, and no component interface from ${declaredBy} carries ${handlerName ?? "it"}`;
      return { id: flowEntranceId(component.folder, entrance.name), name: entrance.name, meaning: entrance.meaning, declaredBy, handler: entrance.handler, start, resolved: start !== undefined, reachable, reason };
    }),
  );

  // Who calls whom among the visible components: every placement fact below is read from a component's own interfaces.
  const callersOf = new Map<string, string[]>(visible.map((component) => [component.folder, edges.filter((edge) => edge.to === component.folder).map((edge) => edge.from)]));
  const calleesOf = new Map<string, string[]>(visible.map((component) => [component.folder, edges.filter((edge) => edge.from === component.folder).map((edge) => edge.to)]));
  const anyEntrance = components.some((component) => (component.entrances ?? []).length > 0);
  const entersHere = (folder: string): boolean =>
    anyEntrance
      ? components.some((c) => represent(c.folder) === folder && (c.entrances ?? []).length > 0)
      : folder === ".";
  const others = visible.length - 1;
  const isCore = (folder: string): boolean => {
    const callers = callersOf.get(folder)!.length;
    const callees = calleesOf.get(folder)!.length;
    return callers >= 3 && callers * 2 > others && callers * 4 >= 3 * (callers + callees);
  };

  const nodes: FlowNode[] = visible.map((component, row) => {
    const callers = callersOf.get(component.folder)!;
    const out = calleesOf.get(component.folder)!.length;
    const into = callers.length;
    const declaresEntrance = entersHere(component.folder);
    const column = declaresEntrance || into === 0 ? 0 : callers.some(entersHere) ? 1 : 2;
    const defects = invariants
      .filter((invariant) => represent(invariant.component) === component.folder && invariant.enforcements.some((e) => e.form === "chokepoint"))
      .flatMap((invariant) => {
        const entry = latestOf(invariant, state.runs.records).find((candidate) => candidate.form === "chokepoint");
        if (entry?.verdict !== "fail") return [];
        const internal = entry.bypasses.filter((b) => { const at = componentOfFile(b.file, components); return at !== undefined && represent(at.folder) === component.folder; }).length;
        return [{ name: invariant.name, state: invariant.state, bypasses: entry.bypasses.length, internal }];
      });
    return {
      id: flowNodeId(component.folder),
      folder: component.folder,
      name: component.name,
      intent: component.intent,
      row,
      column,
      out,
      in: into,
      declaresEntrance,
      core: isCore(component.folder),
      unconnected: out + into === 0,
      entrances: entrances.filter((entrance) => entrance.start === component.folder).map((entrance) => entrance.id),
      children: components.filter((candidate) => candidate.parent === component.folder).length,
      expanded: expanded.has(component.folder),
      defects,
    };
  });

  // Core dependencies, and the stubs their callers attach by.
  const core = new Set(nodes.filter((node) => node.core).map((node) => node.folder));
  const coreDependencies: FlowCore[] = nodes.filter((node) => node.core).map((node) => {
    const stubs = edges.filter((edge) => edge.to === node.folder);
    for (const edge of stubs) edge.stub = true;
    return { folder: node.folder, callers: stubs.map((edge) => edge.from), stubs: stubs.map((edge) => edge.id) };
  });

  // Structural routes: the declaring component, the handler's, then the heaviest interface onward.
  const byPair = new Map(edges.map((edge) => [`${edge.from}\u0000${edge.to}`, edge]));
  const onward = (stops: string[]): { stops: string[]; rail: string | undefined } => {
    const route = [...stops];
    for (;;) {
      const at = route[route.length - 1]!;
      const next = edges
        .filter((edge) => edge.from === at && !route.includes(edge.to) && !core.has(edge.to))
        .sort((a, b) => b.sites - a.sites || a.to.localeCompare(b.to))[0];
      if (next === undefined) return { stops: route, rail: undefined };
      route.push(next.to);
    }
  };
  const drafts: { stops: string[]; rail: string | undefined; entrance: string | undefined }[] = [];
  const routesFrom: FlowModel["routesFrom"] = anyEntrance ? "entrances" : byFolder.has(".") && order.has(".") && !core.has(".") ? "root interfaces" : "none";
  if (routesFrom === "entrances") {
    for (const entrance of entrances) {
      if (!entrance.reachable || entrance.start === undefined || core.has(entrance.declaredBy)) continue;
      const first = entrance.declaredBy === entrance.start ? [entrance.start] : [entrance.declaredBy, entrance.start];
      if (core.has(entrance.start)) drafts.push({ stops: [entrance.declaredBy], rail: entrance.start, entrance: entrance.id });
      else drafts.push({ ...onward(first), entrance: entrance.id });
    }
  } else if (routesFrom === "root interfaces") {
    const fromRoot = edges.filter((edge) => edge.from === "." && !core.has(edge.to)).sort((a, b) => b.sites - a.sites || a.to.localeCompare(b.to));
    for (const edge of fromRoot) drafts.push({ ...onward([".", edge.to]), entrance: undefined });
  }
  const routes: FlowRoute[] = [];
  for (const draft of drafts) {
    const known = routes.find((route) => route.stops.join("\u0000") === draft.stops.join("\u0000") && route.rail === draft.rail);
    if (known !== undefined) {
      if (draft.entrance !== undefined) known.entrances.push(draft.entrance);
      continue;
    }
    const letter = routeLetter(routes.length);
    const routeEdges = draft.stops.slice(1).map((to, index) => byPair.get(`${draft.stops[index]}\u0000${to}`)!.id);
    routes.push({ id: flowRouteId(letter), letter, slot: routes.length < 8 ? routes.length : undefined, entrances: draft.entrance === undefined ? [] : [draft.entrance], stops: draft.stops, edges: routeEdges, rail: draft.rail });
  }
  for (const route of routes) for (const id of route.edges) edges.find((edge) => edge.id === id)!.routes.push(route.id);

  // Interface identifiers: each chokepoint's place in the list, on every interface it stands on.
  const identifiers: FlowIdentifier[] = chokepoints.flatMap((chokepoint, index) => {
    const on = edges.filter((edge) => edge.chokepoints.some((c) => c.id === chokepoint.id));
    if (on.length === 0) return [];
    const crossing = invariants.find((invariant) => invariant.component === chokepoint.component && invariant.name === chokepoint.name)?.crossing;
    const text = `${crossing === undefined ? "C" : "X"}${index + 1}`;
    for (const edge of on) edge.identifiers.push(text);
    return [{ text, chokepoint: chokepoint.id, component: chokepoint.component, name: chokepoint.name, crossing: crossing === undefined ? undefined : { from: crossing.from, to: crossing.to }, edges: on.map((edge) => edge.id) }];
  });

  const levels = state.spec.trustLevels.map((level) => {
    const carrying = edges.filter((edge) => edge.levels.includes(level.name));
    const placed = new Set(carrying.flatMap((edge) => edge.crossings.map((c) => `${c.component}\u0000${c.name}`)));
    const unplaced = invariants
      .filter((invariant) => invariant.crossing !== undefined && (invariant.crossing.from === level.name || invariant.crossing.to === level.name) && !placed.has(`${invariant.component}\u0000${invariant.name}`))
      .map((invariant): FlowCrossing => ({ component: invariant.component, name: invariant.name, state: invariant.state, from: invariant.crossing!.from, to: invariant.crossing!.to }));
    return { id: flowLevelId(level.name), name: level.name, meaning: level.meaning, edges: carrying.map((edge) => edge.id), unplaced };
  });

  return {
    evidence: reading.kind === "read" ? "language adapter" : "run sites only",
    language: reading.kind === "read" ? reading.language : undefined,
    unread: reading.kind === "read" ? undefined : reading.because,
    nodes,
    edges,
    entrances,
    levels,
    chokepoints,
    routes,
    routesFrom,
    coreDependencies,
    identifiers,
    unowned: reading.kind === "read" ? reading.unowned : undefined,
  };
}

/** A, B, ... Z, then AA, AB: a route's short name from its place. */
function routeLetter(index: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return index < 26 ? letters[index]! : `${letters[Math.floor(index / 26) - 1]}${letters[index % 26]}`;
}

/* ---------------------------------------------------------- selection */

export interface FlowSelection {
  kind: "none" | "entrance" | "route" | "level" | "component" | "edge" | "chokepoint" | "change";
  id: string | undefined;
  /** Component folders on the story; every other component dims. */
  nodes: Set<string>;
  /** Interface ids on the story; every other interface dims. */
  edges: Set<string>;
  /** Routes on the story; every other route dims. */
  routes: Set<string>;
}

function flowRouteLight(model: FlowModel, route: FlowRoute): { nodes: Set<string>; edges: Set<string>; routes: Set<string> } {
  const railStub = route.rail === undefined ? undefined : model.edges.find((edge) => edge.from === route.stops[route.stops.length - 1] && edge.to === route.rail);
  return {
    nodes: new Set([...route.stops, ...(route.rail === undefined ? [] : [route.rail])]),
    edges: new Set([...route.edges, ...(railStub === undefined ? [] : [railStub.id])]),
    routes: new Set([route.id]),
  };
}

/**
 * What a selection lights. An entrance lights its structural route; a route
 * lights itself; a trust level lights the interfaces whose crossings carry
 * that class of data, and so its trust boundaries; a chokepoint lights every
 * interface it stands on (reliance); a component lights its direct
 * component interfaces and the components at their other ends, and keeps
 * the routes through it undimmed, never everything it transitively
 * reaches; an interface lights itself. The change selection lights nothing
 * until two states are compared. An id that names nothing selects nothing.
 */
export function flowSelection(model: FlowModel, selected: string | undefined): FlowSelection {
  const none: FlowSelection = { kind: "none", id: undefined, nodes: new Set(), edges: new Set(), routes: new Set() };
  if (selected === undefined) return none;
  if (selected === FLOW_CHANGE_ID) return { ...none, kind: "change", id: selected };
  const entrance = model.entrances.find((candidate) => candidate.id === selected);
  if (entrance !== undefined) {
    const route = model.routes.find((candidate) => candidate.entrances.includes(entrance.id));
    if (route === undefined) return { ...none, kind: "entrance", id: selected, nodes: new Set([entrance.declaredBy]) };
    return { kind: "entrance", id: selected, ...flowRouteLight(model, route) };
  }
  const route = model.routes.find((candidate) => candidate.id === selected);
  if (route !== undefined) return { kind: "route", id: selected, ...flowRouteLight(model, route) };
  const level = model.levels.find((candidate) => candidate.id === selected);
  if (level !== undefined) {
    const lit = model.edges.filter((edge) => level.edges.includes(edge.id));
    return { kind: "level", id: selected, nodes: new Set(lit.flatMap((edge) => [edge.from, edge.to])), edges: new Set(lit.map((edge) => edge.id)), routes: new Set() };
  }
  const chokepoint = model.chokepoints.find((candidate) => candidate.id === selected);
  if (chokepoint !== undefined) {
    const lit = model.edges.filter((edge) => edge.chokepoints.some((c) => c.id === chokepoint.id));
    return { kind: "chokepoint", id: selected, nodes: new Set([chokepoint.component, ...lit.flatMap((edge) => [edge.from, edge.to])]), edges: new Set(lit.map((edge) => edge.id)), routes: new Set() };
  }
  const node = model.nodes.find((candidate) => candidate.id === selected);
  if (node !== undefined) {
    const direct = model.edges.filter((edge) => edge.from === node.folder || edge.to === node.folder);
    return {
      kind: "component",
      id: selected,
      nodes: new Set([node.folder, ...direct.flatMap((edge) => [edge.from, edge.to])]),
      edges: new Set(direct.map((edge) => edge.id)),
      routes: new Set(model.routes.filter((r) => r.stops.includes(node.folder) || r.rail === node.folder).map((r) => r.id)),
    };
  }
  const edge = model.edges.find((candidate) => candidate.id === selected);
  if (edge !== undefined) return { kind: "edge", id: selected, nodes: new Set([edge.from, edge.to]), edges: new Set([edge.id]), routes: new Set(edge.routes) };
  return none;
}

/** One line of the label a component interface wears. */
export interface FlowLabelLine {
  text: string;
  kind: "chokepoint" | "crossing" | "data" | "symbols" | "count" | "defect";
}


/**
 * The label a component interface wears: what the invariants reveal, in
 * order (the chokepoint that stands there, the crossing, the classes of data
 * when more than one crossing passes), else the symbols referenced most, and
 * its bypasses when broken. Never a verb.
 */
export function flowLabelLines(edge: FlowEdge): FlowLabelLine[] {
  const lines: FlowLabelLine[] = [];
  if (edge.chokepoints.length > 0) {
    const names = [...new Set(edge.chokepoints.map((c) => c.chokepoint.split(/\s+in\s+/)[0]!))];
    lines.push({ text: `chokepoint ${names.join(", ")}`, kind: "chokepoint" });
  }
  const crossings = [...new Set(edge.crossings.map((c) => `${c.from} → ${c.to}`))];
  for (const crossing of crossings.slice(0, 2)) lines.push({ text: crossing, kind: "crossing" });
  if (crossings.length > 2) lines.push({ text: `+${crossings.length - 2} crossings`, kind: "count" });
  if (crossings.length > 1) lines.push({ text: `data ${edge.levels.join(", ")}`, kind: "data" });
  if (lines.length === 0) {
    const top = edge.symbols.slice(0, 3).map((s) => s.symbol);
    lines.push({ text: top.join(", "), kind: "symbols" });
    if (edge.symbols.length > top.length) lines.push({ text: `+${edge.symbols.length - top.length} more`, kind: "count" });
  }
  if (edge.bypasses.length > 0) lines.push({ text: `broken: ${edge.bypasses.length} ${edge.bypasses.length === 1 ? "bypass" : "bypasses"}`, kind: "defect" });
  return lines;
}

/** The name a component shows on the map: the root is named for what it is. */
export function flowName(node: Pick<FlowNode, "folder" | "name">): string {
  return node.folder === "." ? `${node.name} (root)` : node.name;
}

/* --------------------------------------------------------- comparison */

/** One of the five measures of what a change did to the map, for one interface or entrance. */
export type FlowChange =
  | { kind: "entrance added" | "entrance removed"; entrance: string }
  | { kind: "interface added" | "interface removed"; edge: string }
  | { kind: "interface widened"; edge: string; symbols: string[] }
  | { kind: "chokepoint gained a bypass"; edge: string; bypasses: number }
  | { kind: "crossing added" | "crossing removed"; edge: string; crossing: string }
  | { kind: "data path branched"; edge: string; levels: string[] };

/**
 * The seam for Structure's diff: two models (the previous commit's state, or
 * a commit the agent names, and this one), and what changed, measured the
 * five ways the owner named. Pure; the diff view is the next slice.
 */
export function compareFlows(before: FlowModel, after: FlowModel): FlowChange[] {
  const changes: FlowChange[] = [];
  const hadEntrance = new Set(before.entrances.map((e) => e.id));
  const hasEntrance = new Set(after.entrances.map((e) => e.id));
  for (const e of after.entrances) if (!hadEntrance.has(e.id)) changes.push({ kind: "entrance added", entrance: e.id });
  for (const e of before.entrances) if (!hasEntrance.has(e.id)) changes.push({ kind: "entrance removed", entrance: e.id });
  const earlier = new Map(before.edges.map((edge) => [edge.id, edge]));
  const later = new Map(after.edges.map((edge) => [edge.id, edge]));
  for (const edge of after.edges) {
    const was = earlier.get(edge.id);
    const crossingNames = (e: FlowEdge | undefined): Set<string> => new Set((e?.crossings ?? []).map((c) => `${c.component}/${c.name}`));
    if (was === undefined) changes.push({ kind: "interface added", edge: edge.id });
    else {
      const had = new Set(was.symbols.map((s) => s.symbol));
      const gained = [...new Set(edge.symbols.map((s) => s.symbol))].filter((s) => !had.has(s)).sort();
      if (gained.length > 0) changes.push({ kind: "interface widened", edge: edge.id, symbols: gained });
      if (edge.bypasses.length > was.bypasses.length) changes.push({ kind: "chokepoint gained a bypass", edge: edge.id, bypasses: edge.bypasses.length - was.bypasses.length });
    }
    const had = crossingNames(was);
    const has = crossingNames(edge);
    for (const name of has) if (!had.has(name)) changes.push({ kind: "crossing added", edge: edge.id, crossing: name });
    for (const name of had) if (!has.has(name)) changes.push({ kind: "crossing removed", edge: edge.id, crossing: name });
    const levels = edge.levels.filter((level) => !(was?.levels ?? []).includes(level));
    if (levels.length > 0) changes.push({ kind: "data path branched", edge: edge.id, levels });
  }
  for (const edge of before.edges) {
    if (later.has(edge.id)) continue;
    changes.push({ kind: "interface removed", edge: edge.id });
    for (const c of edge.crossings) changes.push({ kind: "crossing removed", edge: edge.id, crossing: `${c.component}/${c.name}` });
  }
  return changes;
}
