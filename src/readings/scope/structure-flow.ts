/**
 * The Structure map: what a system is made of and how work flows through
 * it, derived from the state on every render and stored nowhere.
 *
 * Nodes are the components visible at the current zoom: one level of the
 * component tree at a time, a component opened in place showing its children
 * beside its own code. Edges are component interfaces, arrows from caller to
 * callee: for each ordered pair of visible components, the symbols the
 * caller's non-test code references in the callee, as the language adapter
 * resolved them (the state's `componentInterfaces` reading, aggregated up to
 * the visible components). Without that reading only the references the
 * latest runs recorded (to chokepoints and protected things) are known, and
 * the model says so. Every component interface is drawn; none is implied
 * away.
 *
 * An interface is annotated from the invariants, never authored: the
 * chokepoint that stands on it (a chokepoint symbol among its symbols), the
 * crossing of that invariant when trust changes there, and the classes of
 * data that pass (the trust levels of those crossings). A bypass the latest
 * run classified on the pair marks it broken. Its label says what it
 * reveals in that order, and otherwise names the symbols referenced most.
 *
 * Entrances are where work enters: declared in specs, resolved by the
 * adapter. An entrance's flow starts at the component holding its handler;
 * when the root dispatcher declares it, the interface from the declaring
 * component must carry the handler, or the entrance is unreachable.
 *
 * Stability. Positions are a pure function of entrances and component
 * interfaces, ties broken by name, and each component is placed by its own
 * facts alone: its column is its place in folder order among the visible
 * components, its band one of five fixed rows from its share of incoming
 * interfaces (callers high, callees low), a component that declares an
 * entrance in the top band, and a component no interface touches in a band
 * of its own. Adding one interface changes only its caller's and callee's
 * counts, so it moves only those two.
 *
 * The comparison seam: `compareFlows` takes two models (two states, two
 * commits) and names what changed with the five measures Structure's diff
 * will show.
 */

import { allInvariants, componentOfFile, flowChokepointId, flowLevelId, latestOf, type RelianceSite } from "./derive.ts";
import { slug } from "./html.ts";
import type { InterfaceSymbol, RecordedSite, ShellState, SpecComponent, SpecInvariant } from "./model.ts";

/** Five fixed bands, top to bottom; a component no interface touches sits in a sixth. */
export const FLOW_BANDS = 5;

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
  /** Place in folder order among the visible components. */
  column: number;
  /** 0 (top) to FLOW_BANDS - 1; undefined when no interface touches the component. */
  band: number | undefined;
  /** Distinct visible components it calls, and that call it. */
  out: number;
  in: number;
  /** Whether its spec declares an entrance, which pins it to the top band. */
  declaresEntrance: boolean;
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

  const nodes: FlowNode[] = visible.map((component, column) => {
    const out = edges.filter((edge) => edge.from === component.folder).length;
    const into = edges.filter((edge) => edge.to === component.folder).length;
    const declaresEntrance = (component.entrances ?? []).length > 0 || components.some((c) => c.folder !== component.folder && represent(c.folder) === component.folder && (c.entrances ?? []).length > 0);
    const band = declaresEntrance ? 0 : out + into === 0 ? undefined : Math.round((into / (out + into)) * (FLOW_BANDS - 1));
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
      column,
      band,
      out,
      in: into,
      declaresEntrance,
      entrances: entrances.filter((entrance) => entrance.start === component.folder).map((entrance) => entrance.id),
      children: components.filter((candidate) => candidate.parent === component.folder).length,
      expanded: expanded.has(component.folder),
      defects,
    };
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
    unowned: reading.kind === "read" ? reading.unowned : undefined,
  };
}

/* ---------------------------------------------------------- selection */

export interface FlowSelection {
  kind: "none" | "entrance" | "level" | "component" | "edge" | "chokepoint" | "change";
  id: string | undefined;
  /** Component folders on the story; every other component dims. */
  nodes: Set<string>;
  /** Interface ids on the story; every other interface dims. */
  edges: Set<string>;
}

function flowReach(model: FlowModel, start: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const edge of model.edges) {
      if (edge.from !== at || nodes.has(edge.to)) continue;
      nodes.add(edge.to);
      queue.push(edge.to);
    }
  }
  return { nodes, edges: new Set(model.edges.filter((edge) => nodes.has(edge.from)).map((edge) => edge.id)) };
}

/**
 * What a selection lights. An entrance lights the interface from its
 * declaring component that carries the handler, then every interface
 * reachable from the component holding it; a trust level lights the
 * interfaces whose crossings carry that class of data (the spine); a
 * chokepoint lights every interface it stands on (reliance); a component
 * lights everything reachable from it; an interface lights itself. The
 * change selection lights nothing until two states are compared. An id that
 * names nothing in the model selects nothing.
 */
export function flowSelection(model: FlowModel, selected: string | undefined): FlowSelection {
  const none: FlowSelection = { kind: "none", id: undefined, nodes: new Set(), edges: new Set() };
  if (selected === undefined) return none;
  if (selected === FLOW_CHANGE_ID) return { kind: "change", id: selected, nodes: new Set(), edges: new Set() };
  const entrance = model.entrances.find((candidate) => candidate.id === selected);
  if (entrance !== undefined) {
    if (entrance.start === undefined) return { kind: "entrance", id: selected, nodes: new Set([entrance.declaredBy]), edges: new Set() };
    const reach = flowReach(model, entrance.start);
    const dispatch = model.edges.find((edge) => edge.from === entrance.declaredBy && edge.to === entrance.start);
    if (dispatch !== undefined && entrance.reachable) {
      reach.nodes.add(entrance.declaredBy);
      reach.edges.add(dispatch.id);
    }
    return { kind: "entrance", id: selected, ...reach };
  }
  const level = model.levels.find((candidate) => candidate.id === selected);
  if (level !== undefined) {
    const lit = model.edges.filter((edge) => level.edges.includes(edge.id));
    return { kind: "level", id: selected, nodes: new Set(lit.flatMap((edge) => [edge.from, edge.to])), edges: new Set(lit.map((edge) => edge.id)) };
  }
  const chokepoint = model.chokepoints.find((candidate) => candidate.id === selected);
  if (chokepoint !== undefined) {
    const lit = model.edges.filter((edge) => edge.chokepoints.some((c) => c.id === chokepoint.id));
    const owner = model.nodes.find((node) => node.folder === chokepoint.component || lit.some((edge) => edge.to === node.folder));
    return { kind: "chokepoint", id: selected, nodes: new Set([...(owner === undefined ? [] : [owner.folder]), ...lit.flatMap((edge) => [edge.from, edge.to])]), edges: new Set(lit.map((edge) => edge.id)) };
  }
  const node = model.nodes.find((candidate) => candidate.id === selected);
  if (node !== undefined) return { kind: "component", id: selected, ...flowReach(model, node.folder) };
  const edge = model.edges.find((candidate) => candidate.id === selected);
  if (edge !== undefined) return { kind: "edge", id: selected, nodes: new Set([edge.from, edge.to]), edges: new Set([edge.id]) };
  return none;
}

/** One line of the label a component interface wears. */
export interface FlowLabelLine {
  text: string;
  kind: "chokepoint" | "crossing" | "data" | "symbols" | "count" | "defect";
}

const FLOW_LABEL_WIDTH = 32;

function flowClip(text: string): string {
  return text.length <= FLOW_LABEL_WIDTH ? text : `${text.slice(0, FLOW_LABEL_WIDTH - 1)}…`;
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
    lines.push({ text: flowClip(`chokepoint ${names.join(", ")}`), kind: "chokepoint" });
  }
  const crossings = [...new Set(edge.crossings.map((c) => `${c.from} → ${c.to}`))];
  for (const crossing of crossings.slice(0, 2)) lines.push({ text: crossing, kind: "crossing" });
  if (crossings.length > 2) lines.push({ text: `+${crossings.length - 2} crossings`, kind: "count" });
  if (crossings.length > 1) lines.push({ text: flowClip(`data ${edge.levels.join(", ")}`), kind: "data" });
  if (lines.length === 0) {
    const top = edge.symbols.slice(0, 3).map((s) => s.symbol);
    lines.push({ text: flowClip(top.join(", ")), kind: "symbols" });
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
