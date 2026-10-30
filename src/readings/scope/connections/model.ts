/**
 * Connections: Scope's view of component interfaces rooted at one origin,
 * a structural route or a component (d-a314db4e). This module is its model:
 * which cards, lines, doors, chips and entrance tokens an origin, the cards
 * spawned from it and a selection give, as one pure function of the flow
 * model Structure already derives (structure-flow.ts). No new reading, no
 * position: where each thing is drawn is the drawing's (drawing.ts).
 *
 * Columns are hops from the origin. From a component, what it calls stands
 * one column right and what calls it one column left (a component both
 * calls and is called by stands right, its call back drawn as a side line).
 * From a structural route, the origin is the entrance token in column 0, and
 * hops run along its entrances' handler's static reach, starting at once
 * from the component that declares the route and from each entrance's
 * handler component (column 1); a component first met further along stands
 * at 1 plus its hops, and every component holding a chokepoint the work
 * passes is drawn from the start. A spawn draws what lies one hop further
 * out from that card, the same way; +N on a card counts what a spawn would
 * add.
 *
 * Core dependencies are never cards unless they are the origin or the reader
 * asks for one: each is a chip on the cards that use it. Every component
 * interface between two drawn cards is a line, and from a route the lines its
 * work uses are its own. A chokepoint is drawn once, at the door of the
 * component it stands in front of (the callee of the interfaces it stands
 * on), with every caller whose interface it stands on (d-d4f9fea6).
 * Selecting a drawn card keeps only the lines that touch it and lists every
 * route whose reach gets to it, with how many hops in (d-9cf51e23).
 */

import { CONNECTIONS_PREFIX } from "../derive.ts";
import { flowNodeId, type FlowEdge, type FlowModel, type FlowRoute, type FlowState } from "../structure-flow.ts";

/** Where the view is rooted: a structural route, by its id, or a component, by its folder. */
export type ConnectionsOrigin = { kind: "route"; id: string } | { kind: "component"; folder: string };

/** What the reader made of the view beyond its origin: the cards spawned, the core dependencies drawn as cards, the selected card. */
export interface ConnectionsAsk {
  origin: ConnectionsOrigin;
  /** Cards whose next hop out is drawn: each one's +N, taken. */
  spawned?: readonly string[];
  /** Core dependencies the reader asked to see as cards. */
  cores?: readonly string[];
  /** The selected card's folder: only its lines stay, and the routes reaching it are listed. */
  selected?: string | undefined;
}

/** One drawn component. */
export interface ConnectionsCard {
  folder: string;
  /** Hops from the origin: negative for callers of a component origin, 0 for the origin itself, 1 for where a route starts. */
  column: number;
  /** Components a spawn of this card would add: its +N. */
  more: number;
  /** Core dependencies it uses that are not drawn as cards, in folder order. */
  chips: string[];
}

/** One component interface between two drawn cards. */
export interface ConnectionsLine {
  /** The interface's id in the flow model. */
  id: string;
  from: string;
  to: string;
  sites: number;
  /** Whether the origin route's work uses it: its entrances' handler's reach references the callee through it. */
  work: boolean;
  /** Reference sites the work makes through it, and the symbols, most used first. */
  workSites: number;
  workSymbols: string[];
}

/** One chokepoint at a door: its identifier, its invariant and what it protects, and every caller that reaches that through it. */
export interface ConnectionsDoorChokepoint {
  /** The interface identifier it wears, as X14. */
  identifier: string;
  /** Its id in the flow model. */
  id: string;
  /** The component owning its invariant, and the invariant. */
  component: string;
  name: string;
  protects: string;
  state: FlowState;
  /** Whether a caller's bypass of it was recorded. */
  bypassed: boolean;
  /** The crossing of its invariant when trust changes at it. */
  crossing: { from: string; to: string } | undefined;
  /** Every component calling the protected thing through it, drawn or not, in folder order. */
  callers: string[];
}

/** A component's door: the chokepoints standing in front of it, drawn once where the work arrives. */
export interface ConnectionsDoor {
  component: string;
  chokepoints: ConnectionsDoorChokepoint[];
  /** The worst verdict among them, and broken when any is bypassed. */
  state: FlowState;
  /** Whether trust changes at any of them: the crossing tick. */
  crossing: boolean;
}

/** A route whose entrances' reach gets to the selected card. */
export interface ConnectionsToken {
  route: string;
  /** Hops from where its work starts to the selected card: 0 when it starts there. */
  hops: number;
  /** Where its work enters: its first entrance's handler component, else the component declaring it. */
  enters: string;
  trust: string[];
  noTracedControl: boolean;
  /** Whether it is the origin route itself. */
  origin: boolean;
}

/** Where the origin route's work enters the drawn cards, and the identifiers standing there. */
export interface ConnectionsEntry {
  to: string;
  identifiers: string[];
}

export interface ConnectionsView {
  origin: ConnectionsOrigin;
  /** The origin route, when the origin is one. */
  route: FlowRoute | undefined;
  /** Drawn cards in column order, then folder order. */
  cards: ConnectionsCard[];
  /** Every component interface between drawn cards, or, with a card selected, those that touch it. */
  lines: ConnectionsLine[];
  /** One per component with a chokepoint on a drawn line into it. */
  doors: ConnectionsDoor[];
  /** With a card selected: every route reaching it, fewest hops first. */
  tokens: ConnectionsToken[];
  entry: ConnectionsEntry | undefined;
}

/* ------------------------------------------------------------------ ids */

/**
 * A deep link's id for an origin, under Scope's one hash scheme: the view's
 * prefix and the flow model's own id for the route or component, so a route
 * keeps the id the flow model gives it ("structure--route-…" becomes
 * "connections--route-…") and a component's is "connections--component-…".
 */
export function connectionsOriginId(origin: ConnectionsOrigin): string {
  return origin.kind === "route"
    ? origin.id.replace(/^structure--/, CONNECTIONS_PREFIX)
    : flowNodeId(origin.folder).replace(/^structure--node-/, `${CONNECTIONS_PREFIX}component-`);
}

/** The origin a deep link's id names in this model, or undefined when it names none. */
export function connectionsOriginOf(model: Pick<FlowModel, "routes" | "nodes">, id: string): ConnectionsOrigin | undefined {
  for (const route of model.routes) if (connectionsOriginId({ kind: "route", id: route.id }) === id) return { kind: "route", id: route.id };
  for (const node of model.nodes) if (connectionsOriginId({ kind: "component", folder: node.folder }) === id) return { kind: "component", folder: node.folder };
  return undefined;
}

/** The origin a view opens on with nothing asked: the busiest route, else the first component. */
export function connectionsDefaultOrigin(model: Pick<FlowModel, "routes" | "nodes">): ConnectionsOrigin | undefined {
  const route = [...model.routes].sort((a, b) => b.sites - a.sites || a.id.localeCompare(b.id))[0];
  if (route !== undefined) return { kind: "route", id: route.id };
  const node = model.nodes[0];
  return node === undefined ? undefined : { kind: "component", folder: node.folder };
}

/* ---------------------------------------------------------------- reach */

/**
 * The drawn component that stands for a folder: itself when it is a node,
 * else the nearest node holding it, as the flow model folds a closed
 * folder's children into it. A reach reference names folders unfolded.
 */
function representIn(nodes: readonly { folder: string }[]): (folder: string) => string | undefined {
  const folders = new Set(nodes.map((n) => n.folder));
  return (folder) => {
    for (let at = folder; ; at = at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : ".") {
      if (folders.has(at)) return at;
      if (at === ".") return undefined;
    }
  };
}

type Reach = Map<string, Map<string, { sites: number; symbols: Map<string, number> }>>;

/**
 * The component interfaces a route's work uses, caller to callee, folded to
 * the drawn components: every entrance's handler's static reach, else, when
 * none was read, the route's own stops in order.
 */
function reachOf(model: FlowModel, route: FlowRoute, represent: (folder: string) => string | undefined): Reach {
  const reach: Reach = new Map();
  const add = (fromFolder: string, toFolder: string, symbol: string, sites: number): void => {
    const from = represent(fromFolder);
    const to = represent(toFolder);
    if (from === undefined || to === undefined || from === to) return;
    const callees = reach.get(from) ?? new Map();
    reach.set(from, callees);
    const pair = callees.get(to) ?? { sites: 0, symbols: new Map<string, number>() };
    callees.set(to, pair);
    pair.sites += sites;
    pair.symbols.set(symbol, (pair.symbols.get(symbol) ?? 0) + sites);
  };
  const entrances = route.entrances.map((id) => model.entrances.find((e) => e.id === id));
  const read = entrances.some((e) => e?.reach !== undefined);
  if (read) for (const entrance of entrances) for (const r of entrance?.reach ?? []) add(r.from, r.to, r.symbol, r.sites);
  else for (const id of route.edges) {
    const edge = model.edges.find((e) => e.id === id);
    if (edge !== undefined) for (const s of edge.symbols) add(edge.from, edge.to, s.symbol, s.sites);
  }
  return reach;
}

/** Where a route's work starts: the component declaring it and each entrance's handler component. */
function startsOf(model: FlowModel, route: FlowRoute): string[] {
  const starts = [route.stops[0], ...route.entrances.map((id) => model.entrances.find((e) => e.id === id)?.start)];
  return [...new Set(starts.filter((f): f is string => f !== undefined))];
}

/** Hops from a route's starts along its reach, by component. */
function hopsAlong(starts: readonly string[], reach: Reach): Map<string, number> {
  const hops = new Map(starts.map((f) => [f, 0]));
  const queue = [...starts];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const to of [...(reach.get(at)?.keys() ?? [])].sort()) {
      if (hops.has(to)) continue;
      hops.set(to, hops.get(at)! + 1);
      queue.push(to);
    }
  }
  return hops;
}

/** Where a route's work enters: its first entrance's handler component, else its first stop. */
function entersAt(model: FlowModel, route: FlowRoute): string {
  return model.entrances.find((e) => e.id === route.entrances[0])?.start ?? route.stops[0] ?? ".";
}

/** Every route whose reach gets to a component, with its hops there, fewest first, then by name. */
export function connectionsReaching(model: FlowModel, folder: string, origin?: ConnectionsOrigin): ConnectionsToken[] {
  const represent = representIn(model.nodes);
  const tokens: ConnectionsToken[] = [];
  for (const route of model.routes) {
    const hops = hopsAlong(startsOf(model, route), reachOf(model, route, represent)).get(folder);
    if (hops === undefined) continue;
    tokens.push({ route: route.id, hops, enters: entersAt(model, route), trust: route.trust, noTracedControl: route.noTracedControl, origin: origin?.kind === "route" && origin.id === route.id });
  }
  const name = (id: string): string => model.routes.find((r) => r.id === id)?.names[0] ?? id;
  return tokens.sort((a, b) => a.hops - b.hops || name(a.route).localeCompare(name(b.route)) || a.route.localeCompare(b.route));
}

/* ----------------------------------------------------------------- view */

const worst = (states: readonly FlowState[]): FlowState => (states.includes("broken") ? "broken" : states.includes("requirement") ? "requirement" : "verified");

/**
 * What the view draws for an origin, its spawns, the core dependencies drawn
 * as cards and a selection. Undefined when the origin names nothing in the
 * model (a route or component the reading no longer has).
 */
export function connectionsOf(model: FlowModel, ask: ConnectionsAsk): ConnectionsView | undefined {
  const { origin } = ask;
  const nodes = new Set(model.nodes.map((n) => n.folder));
  const route = origin.kind === "route" ? model.routes.find((r) => r.id === origin.id) : undefined;
  if (origin.kind === "route" ? route === undefined : !nodes.has(origin.folder)) return undefined;
  const represent = representIn(model.nodes);
  const core = new Set(model.coreDependencies.map((c) => c.folder));
  const cores = new Set(ask.cores ?? []);
  const hidden = (folder: string): boolean => core.has(folder) && !(origin.kind === "component" && origin.folder === folder) && !cores.has(folder);
  const edgeOf = new Map(model.edges.map((e) => [`${e.from}\u0000${e.to}`, e]));
  const callees = (folder: string): string[] => model.edges.filter((e) => e.from === folder).map((e) => e.to);
  const callers = (folder: string): string[] => model.edges.filter((e) => e.to === folder).map((e) => e.from);

  const column = new Map<string, number>();
  let next: (folder: string) => string[];
  let place: (folder: string, from: number) => number;
  let reach: Reach | undefined;
  if (route === undefined) {
    const at = (origin as { folder: string }).folder;
    column.set(at, 0);
    for (const to of callees(at)) if (!hidden(to) && to !== at) column.set(to, 1);
    for (const from of callers(at)) if (!hidden(from) && !column.has(from)) column.set(from, -1);
    next = (folder) => {
      const c = column.get(folder) ?? 0;
      return c > 0 ? callees(folder) : c < 0 ? callers(folder) : [];
    };
    place = (_folder, from) => (from < 0 ? from - 1 : from + 1);
  } else {
    reach = reachOf(model, route, represent);
    const used = reach;
    const starts = startsOf(model, route);
    const hops = hopsAlong(starts, used);
    const far = Math.max(0, ...hops.values()) + 1;
    const depth = (folder: string): number => 1 + (hops.get(folder) ?? far);
    for (const f of starts) if (!hidden(f)) column.set(f, 1);
    for (const f of starts) for (const to of used.get(f)?.keys() ?? []) if (!hidden(to) && !column.has(to)) column.set(to, depth(to));
    // Every component holding a chokepoint the work passes is drawn from the start.
    const passed = [
      ...route.entrances.flatMap((id) => model.entrances.find((e) => e.id === id)?.guards ?? []).map((g) => g.component),
      ...route.traced.map((t) => t.component),
    ];
    for (const raw of passed) {
      const f = represent(raw);
      if (f !== undefined && !column.has(f) && !hidden(f)) column.set(f, depth(f));
    }
    next = (folder) => [...(used.get(folder)?.keys() ?? [])];
    place = (folder, from) => Math.max(depth(folder), from + 1);
  }

  // Spawns: each spawned card's next hop out, until nothing more is added (a spawn may sit on a card another spawn drew).
  const spawned = new Set(ask.spawned ?? []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of spawned) {
      const c = column.get(f);
      if (c === undefined) continue;
      for (const to of next(f)) {
        if (column.has(to) || hidden(to)) continue;
        column.set(to, place(to, c));
        grew = true;
      }
    }
  }

  const order = new Map(model.nodes.map((n, i) => [n.folder, i]));
  const drawn = [...column.keys()].sort((a, b) => column.get(a)! - column.get(b)! || order.get(a)! - order.get(b)!);
  const cards: ConnectionsCard[] = drawn.map((folder) => {
    const isOrigin = origin.kind === "component" && origin.folder === folder;
    const more = isOrigin ? 0 : new Set(next(folder).filter((to) => !column.has(to) && !hidden(to))).size;
    const uses = reach === undefined ? callees(folder) : [...(reach.get(folder)?.keys() ?? [])];
    const chips = [...new Set(uses.filter(hidden))].sort((a, b) => order.get(a)! - order.get(b)!);
    return { folder, column: column.get(folder)!, more, chips };
  });

  const all: ConnectionsLine[] = [];
  for (const from of drawn) {
    for (const to of drawn) {
      const edge = edgeOf.get(`${from}\u0000${to}`);
      if (edge === undefined || from === to) continue;
      const work = reach?.get(from)?.get(to);
      const workSymbols = work === undefined ? [] : [...work.symbols.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
      all.push({ id: edge.id, from, to, sites: edge.sites, work: work !== undefined, workSites: work?.sites ?? 0, workSymbols });
    }
  }

  const selected = ask.selected !== undefined && column.has(ask.selected) ? ask.selected : undefined;
  const lines = selected === undefined ? all : all.filter((l) => l.from === selected || l.to === selected);
  const doors = doorsOf(model, lines, edgeOf);
  const tokens = selected === undefined ? [] : connectionsReaching(model, selected, origin);

  let entry: ConnectionsEntry | undefined;
  if (route !== undefined) {
    const enters = entersAt(model, route);
    const to = column.has(enters) ? enters : route.stops.find((s) => column.has(s));
    if (to !== undefined) entry = { to, identifiers: route.entry };
  }
  return { origin, route, cards, lines, doors, tokens, entry };
}

/** The doors on the drawn lines: each chokepoint once, at the callee, listing every caller of the model that passes it. */
function doorsOf(model: FlowModel, lines: readonly ConnectionsLine[], edgeOf: Map<string, FlowEdge>): ConnectionsDoor[] {
  const identifier = new Map(model.identifiers.map((i) => [i.chokepoint, i.text]));
  const order = new Map(model.nodes.map((n, i) => [n.folder, i]));
  const at = new Map<string, Map<string, ConnectionsDoorChokepoint>>();
  for (const line of lines) {
    const edge = edgeOf.get(`${line.from}\u0000${line.to}`)!;
    for (const c of edge.chokepoints) {
      const door = at.get(line.to) ?? new Map<string, ConnectionsDoorChokepoint>();
      at.set(line.to, door);
      if (door.has(c.id)) continue;
      const through = model.edges.filter((e) => e.to === line.to && e.chokepoints.some((x) => x.id === c.id));
      const crossing = through.flatMap((e) => e.crossings).find((x) => x.component === c.component && x.name === c.name);
      door.set(c.id, {
        identifier: identifier.get(c.id) ?? "C",
        id: c.id,
        component: c.component,
        name: c.name,
        protects: c.protects,
        state: c.verdict.state,
        bypassed: through.some((e) => e.bypasses.some((b) => b.invariant === c.name)),
        crossing: crossing === undefined ? undefined : { from: crossing.from, to: crossing.to },
        callers: through.map((e) => e.from).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
      });
    }
  }
  return [...at.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map(([component, door]) => {
      const chokepoints = [...door.values()];
      return {
        component,
        chokepoints,
        state: chokepoints.some((c) => c.bypassed) ? "broken" : worst(chokepoints.map((c) => c.state)),
        crossing: chokepoints.some((c) => c.crossing !== undefined),
      };
    });
}
