/**
 * The Structure map's render, drawn the way transit maps and process
 * drawings are. Each structural route is one line of its own color from its
 * named origin (the names of the entrances it starts from, in full, stacked
 * one per line in the left margin, or "via" the first component it reaches,
 * marked derived) through its stations in order, left to right, never back
 * to a column it has left; routes that pass the same component meet at its
 * station and run side by side at fixed offsets, never merged. Every segment
 * is horizontal, vertical, or at 45 degrees. A route that stays in a column
 * drops straight down (or up) to the next station when it is the neighbour,
 * else turns in the column's lane. A core dependency is a rail along the
 * foot, labelled once, with the interface identifiers of its stubs drawn
 * once on it; each caller's stub runs to the rail and meets it, joining the
 * column's other stubs to that rail on one shared drop. A chokepoint or a
 * crossing is an interface identifier drawn on the pipe where it stands, one
 * button each, a crossing with a dashed trust boundary through it; its
 * meaning is in the inspector. A component interface on no route is drawn
 * faint, and only when a selection reaches it, unless an identifier stands
 * on it.
 *
 * At rest the busiest entrance's route is selected and every other route is
 * dimmed; with nothing selected every route is thin and muted.
 *
 * Every piece of text has a priority and is placed only where it overlaps no
 * text and no station: station names first, then the named origins and rail
 * labels, the caption, identifiers, defect marks, and column captions. Lower
 * priority text is dropped, never overlapped, never truncated. Every
 * coordinate is computed here from the model on each render; no position is
 * stored or read.
 */

import { componentId, invariantId, latestOf, plural, relianceOf, type RelianceSite } from "./derive.ts";
import { html, join, raw, type Markup } from "./html.ts";
import { renderEnforcement, renderRefutation } from "./invariants-view.ts";
import type { ShellState, StructurePreview } from "./model.ts";
import {
  CORE_RULE,
  FLOW_CHANGE_ID,
  FLOW_NONE_ID,
  flowLabelLines,
  flowName,
  flowOf,
  flowSelected,
  routeName,
  flowSelection,
  type FlowChokepoint,
  type FlowEdge,
  type FlowEntrance,
  type FlowLevel,
  type FlowModel,
  type FlowNode,
  type FlowRoute,
  type FlowSelection,
} from "./structure-flow.ts";
import { textWidth } from "./structure-measure.ts";

const FLOW_FONT = "Helvetica, Arial, sans-serif";
const FLOW_PAD = 16;
const FLOW_TOP = 58;
const FLOW_ROW_H = 70;
/** The tallest a station may be: its tracks close up rather than grow past its row. */
const FLOW_BOX_MAX_H = 52;
const FLOW_BOX_MIN_H = 34;
/** The fixed offset between parallel tracks. */
const FLOW_TRACK = 6;
const FLOW_CHAMFER = 8;
const FLOW_RAIL_GAP = 34;
/** The fixed offset between the drops of different rails beside one column. */
const FLOW_DROP_GAP = 5;
/** A gap between columns is never narrower than this. */
const FLOW_GAP_MIN = 96;
/** Named origins: the size of a name, the height of its line, the gap between routes, the terminus dot. */
const FLOW_NAME_SIZE = 11;
const FLOW_NAME_LINE = 13;
const FLOW_NAME_GAP = 7;
const FLOW_DOT_R = 5;

/** Route colors, light and dark: the validated categorical order (identity is also the name, never color alone). */
const FLOW_ROUTE_COLORS: [string, string][] = [
  ["#2a78d6", "#3987e5"],
  ["#eb6834", "#d95926"],
  ["#1baf7a", "#199e70"],
  ["#eda100", "#c98500"],
  ["#e87ba4", "#d55181"],
  ["#008300", "#2f9e2f"],
  ["#4a3aa7", "#9085e9"],
  ["#e34948", "#e66767"],
];
const FLOW_RAIL_COLORS: [string, string][] = [
  ["#5f6b7a", "#9aa6b6"],
  ["#8a6a45", "#c2a07a"],
  ["#3f7f78", "#7fbdb5"],
  ["#7a5f86", "#b79cc4"],
];

function routeVars(): string {
  const light = FLOW_ROUTE_COLORS.map(([l], i) => `--flow-route-${i}: ${l};`).concat(FLOW_RAIL_COLORS.map(([l], i) => `--flow-rail-${i}: ${l};`));
  const dark = FLOW_ROUTE_COLORS.map(([, d], i) => `--flow-route-${i}: ${d};`).concat(FLOW_RAIL_COLORS.map(([, d], i) => `--flow-rail-${i}: ${d};`));
  return `.flow-svg { ${light.join(" ")} }\n@media (prefers-color-scheme: dark) { .flow-svg { ${dark.join(" ")} } }`;
}

const FLOW_SVG_STYLE = `
.flow-svg {
  --flow-surface: #fbfcfe;
  --flow-ink: #172033;
  --flow-muted: #5c677d;
  --flow-node: #ffffff;
  --flow-node-border: #3d4a66;
  --flow-quiet: #9aa5bd;
  --flow-defect: #c32836;
  --flow-proposed: #8b5e19;
  --flow-tag: #ffffff;
  --flow-boundary: #b3261e;
  --flow-lit: #d97706;
  --flow-neutral-route: #7d8799;
}
.flow-svg .flow-surface { fill: var(--flow-surface); }
.flow-svg text { font-family: ${FLOW_FONT}; fill: var(--flow-ink); }
.flow-svg .flow-caption { fill: var(--flow-muted); }
.flow-svg .flow-colcap { fill: var(--flow-muted); }
.flow-svg .flow-station rect { fill: var(--flow-node); stroke: var(--flow-node-border); stroke-width: 1.5; }
.flow-svg .flow-station.flow-entry rect { stroke-width: 2.5; }
.flow-svg .flow-station.flow-unconnected rect, .flow-svg .flow-mass rect { fill: var(--flow-surface); stroke-dasharray: 4 4; }
.flow-svg .flow-station.flow-broken rect { stroke: var(--flow-defect); }
.flow-svg .flow-station-folder { fill: var(--flow-muted); }
.flow-svg .flow-defect-mark { fill: var(--flow-defect); }
.flow-svg .flow-route { fill: none; stroke-width: 3.5; stroke-linejoin: round; stroke-linecap: butt; }
.flow-svg .flow-terminus-dot { stroke: var(--flow-surface); stroke-width: 1.5; }
.flow-svg .flow-derived .flow-terminus-dot { fill: var(--flow-surface); stroke-width: 2.5; stroke-dasharray: 3 2; }
.flow-svg .flow-origin { fill: var(--flow-ink); }
.flow-svg .flow-origin-derived { fill: var(--flow-muted); font-style: italic; }
.flow-svg .flow-faint { fill: none; stroke: var(--flow-quiet); stroke-width: 1.4; stroke-dasharray: 5 4; }
.flow-svg .flow-bearing-line { fill: none; stroke: var(--flow-quiet); stroke-width: 1.6; }
.flow-svg .flow-broken-line { stroke: var(--flow-defect); stroke-width: 2; stroke-dasharray: 6 3; }
.flow-svg .flow-rail-line { stroke-width: 6; stroke-linecap: round; }
.flow-svg .flow-stub { fill: none; stroke-width: 1.6; stroke-linejoin: round; }
.flow-svg .flow-joint { stroke: none; }
.flow-svg .flow-rail-label { fill: var(--flow-ink); }
.flow-svg .flow-tag rect { fill: var(--flow-tag); stroke: var(--flow-node-border); stroke-width: 1; }
.flow-svg .flow-tag.flow-tag-broken rect { stroke: var(--flow-defect); stroke-width: 1.8; }
.flow-svg .flow-tag:focus rect, .flow-svg .flow-tag.is-selected rect { stroke: var(--flow-lit); stroke-width: 2.5; }
.flow-svg .flow-boundary { stroke: var(--flow-boundary); stroke-width: 2.2; stroke-dasharray: 3 2; }
.flow-svg .flow-caption, .flow-svg .flow-colcap, .flow-svg .flow-defect-mark, .flow-svg .flow-rail-label, .flow-svg .flow-origin { paint-order: stroke; stroke: var(--flow-surface); stroke-width: 3px; stroke-linejoin: round; }
.flow-svg .structure-edge.structure-proposed { fill: none; stroke: var(--flow-proposed); stroke-width: 2; stroke-dasharray: 9 6; }
.flow-svg .structure-proposed-word { fill: var(--flow-proposed); }
.flow-svg [data-structure-select], .flow-svg [data-structure-expand] { cursor: pointer; }
.flow-svg [data-structure-select]:focus { outline: none; }
.flow-svg .flow-station:focus rect, .flow-svg .flow-station.is-selected rect { stroke: var(--flow-lit); stroke-width: 3; }
.flow-svg .flow-station.is-lit rect { stroke: var(--flow-lit); stroke-width: 2.5; }
.flow-svg .flow-tag.is-lit rect { stroke: var(--flow-lit); stroke-width: 2; }
.flow-svg .flow-faint.is-lit, .flow-svg .flow-bearing-line.is-lit { stroke: var(--flow-lit); stroke-opacity: 1; }
.flow-svg .flow-route-group.is-lit .flow-route { stroke-width: 5; }
.flow-svg .flow-route-group.is-muted .flow-route { stroke-width: 2; opacity: 0.5; }
.flow-svg .flow-route-group.is-muted .flow-terminus-dot { opacity: 0.6; }
.flow-svg .flow-route-group.is-dim .flow-route, .flow-svg .flow-route-group.is-dim .flow-terminus-dot { opacity: 0.16; }
.flow-svg .flow-route-group.is-dim .flow-route { stroke-width: 2; }
.flow-svg .flow-route-group.is-dim .flow-origin { opacity: 0.62; }
.flow-svg .flow-route-group:focus .flow-origin, .flow-svg .flow-route-group.is-lit .flow-origin { font-weight: 700; }
.flow-svg .is-dim { opacity: 0.16; }
.flow-svg .flow-route-group.is-dim { opacity: 1; }
.flow-svg .flow-station.is-dim { opacity: 1; }
.flow-svg .flow-station.is-dim rect { stroke-opacity: 0.2; }
.flow-svg .flow-station.is-dim text { opacity: 0.22; }
@media (prefers-color-scheme: dark) {
  .flow-svg {
    --flow-surface: #111827;
    --flow-ink: #f3f6ff;
    --flow-muted: #b5bfd3;
    --flow-node: #1a2336;
    --flow-node-border: #9fb0d8;
    --flow-quiet: #6f7c96;
    --flow-defect: #ff7480;
    --flow-proposed: #f2bd68;
    --flow-tag: #111827;
    --flow-boundary: #ff8a80;
    --flow-lit: #ffd166;
    --flow-neutral-route: #8d97aa;
  }
}`;

/* --------------------------------------------------------------- layout */

export interface FlowBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A station: a component's box, its seat (left edge and row center) a function of its column and rows. */
export interface FlowStation extends FlowBox {
  folder: string;
  seat: { x: number; y: number };
}

type Point = [number, number];

/** One drawn line: its points (every segment 0, 45 or 90 degrees), and the legs identifiers may stand on. */
interface FlowPolyline {
  points: Point[];
  legs: { a: Point; b: Point }[];
}

interface FlowRouteDraw {
  route: FlowRoute;
  color: string;
  path: Point[];
  /** The dot the line starts from, and each name line beside it. */
  terminus: Point;
  /** Per interface id along the route: the legs of its segment. */
  segments: Map<string, FlowPolyline>;
}

interface FlowLineDraw {
  edge: FlowEdge;
  kind: "bearing" | "faint";
  line: FlowPolyline;
}

/** A stub: from its caller's station to the rail, meeting it; a column's stubs to one rail share their drop. */
interface FlowStubDraw {
  edge: FlowEdge;
  rail: number;
  points: Point[];
  /** Where it joins the shared drop, and where the drop meets the rail. */
  joints: Point[];
}

interface FlowRailDraw {
  folder: string;
  index: number;
  y: number;
  x0: number;
  x1: number;
}

/** A piece of canvas text, placed or dropped by priority. */
export interface FlowText {
  key: string;
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  align: "start" | "middle" | "end";
  cls: string;
  priority: number;
  within?: string;
}

/** One interface identifier on the map: a button on its pipe, or once on a rail for a core dependency's stubs. */
interface FlowTagDraw {
  /** The identifier text (C3, X7), or a bypass mark, or a count of identifiers that did not fit. */
  text: string;
  kind: "identifier" | "bypass" | "more";
  /** The chokepoint it selects, for an identifier. */
  chokepoint: string | undefined;
  /** The invariant it names, for the accessible name. */
  name: string;
  /** The pipe it stands on, or the rail. */
  edge: FlowEdge | undefined;
  rail: string | undefined;
  edges: string[];
  broken: boolean;
  box: FlowBox;
  boundary: { x1: number; y1: number; x2: number; y2: number } | undefined;
}

export interface FlowLayout {
  width: number;
  height: number;
  stations: Map<string, FlowStation>;
  rails: FlowRailDraw[];
  routes: FlowRouteDraw[];
  lines: FlowLineDraw[];
  stubs: FlowStubDraw[];
  tags: FlowTagDraw[];
  texts: FlowText[];
  /** Text a priority dropped: what did not fit, by key. */
  dropped: string[];
  mass: FlowBox | undefined;
}

function r1(value: number): number {
  return Math.round(value * 10) / 10;
}

function intersects(a: FlowBox, b: FlowBox, margin = 1): boolean {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

function textBox(t: Pick<FlowText, "text" | "x" | "y" | "size" | "bold" | "align">): FlowBox {
  const w = textWidth(t.text, t.size, t.bold);
  const x = t.align === "middle" ? t.x - w / 2 : t.align === "end" ? t.x - w : t.x;
  return { x, y: t.y - t.size * 0.78, w, h: t.size };
}

/** An octilinear path from `a` to `b` turning in the lane at `lane`: horizontal, a 45-degree chamfer, vertical, a chamfer, horizontal. */
function lanePath(a: Point, lane: number, b: Point): FlowPolyline {
  const dy = b[1] - a[1];
  if (Math.abs(dy) < 0.05) return { points: [a, b], legs: [{ a, b }] };
  const sy = Math.sign(dy);
  const sx0 = Math.sign(lane - a[0]) || 1;
  const sx1 = Math.sign(b[0] - lane) || 1;
  const c = Math.min(FLOW_CHAMFER, Math.abs(dy) / 2, Math.abs(lane - a[0]), Math.abs(b[0] - lane));
  const p1: Point = [lane - sx0 * c, a[1]];
  const p2: Point = [lane, a[1] + sy * c];
  const p3: Point = [lane, b[1] - sy * c];
  const p4: Point = [lane + sx1 * c, b[1]];
  const points: Point[] = [a, p1, p2, p3, p4, b].map(([x, y]) => [r1(x), r1(y)] as Point);
  return { points, legs: [{ a: points[0]!, b: points[1]! }, { a: points[2]!, b: points[3]! }, { a: points[4]!, b: points[5]! }] };
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last === undefined || Math.abs(last[0] - p[0]) > 0.01 || Math.abs(last[1] - p[1]) > 0.01) out.push(p);
  }
  return out;
}

function pathD(points: Point[]): string {
  return dedupe(points).map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

/** The lines of a route's named origin, top to bottom: each entrance name, or "via" and the word derived. */
function originLines(route: FlowRoute): string[] {
  return route.derived ? [...route.names, "derived"] : route.names;
}

type Side = "left" | "right" | "top" | "bottom";

/** How one step between two stations is drawn: into the next column, down or up to the neighbour, round the column's lane, or back. */
type HopKind = "forward" | "adjacent" | "bracket" | "back";

interface Hop {
  key: string;
  from: FlowNode;
  to: FlowNode;
  kind: HopKind;
  /** The route's place, or past the routes for a load-bearing interface: orders parallel tracks. */
  order: number;
}

/**
 * Every coordinate of the map, from the model and the selection. A
 * station's seat is a function of its column and rows; the selection only
 * adds faint lines, never moves a station or a route.
 */
export function flowLayout(model: FlowModel, selection: FlowSelection = flowSelection(model, undefined), previews: readonly StructurePreview[] = []): FlowLayout {
  const byFolder = new Map(model.nodes.map((node) => [node.folder, node]));
  const edgeById = new Map(model.edges.map((edge) => [edge.id, edge]));
  const placed = model.nodes.filter((node) => !node.core);
  const columns = Math.max(1, ...placed.map((node) => node.column + 1));
  const inColumn = (c: number): FlowNode[] => placed.filter((node) => node.column === c).sort((a, b) => a.row - b.row);
  const cy = (node: FlowNode): number => FLOW_TOP + (node.row + node.span / 2) * FLOW_ROW_H;
  const neighbours = (a: FlowNode, b: FlowNode): boolean => {
    const list = inColumn(a.column);
    return Math.abs(list.indexOf(a) - list.indexOf(b)) === 1;
  };
  const kindOf = (from: FlowNode, to: FlowNode): HopKind => (to.column > from.column ? "forward" : to.column < from.column ? "back" : neighbours(from, to) ? "adjacent" : "bracket");

  // The hops: every step of every route, then every load-bearing or broken interface on no route.
  const drawn = model.routes.filter((route) => route.stops.every((stop) => byFolder.has(stop) && !byFolder.get(stop)!.core));
  const atRest = (edge: FlowEdge): boolean => (edge.loadBearing || edge.bypasses.length > 0) && edge.routes.length === 0 && !edge.stub;
  const bearing = model.edges.filter((edge) => atRest(edge) && !byFolder.get(edge.from)!.core);
  const hops: Hop[] = [];
  drawn.forEach((route, index) => route.stops.slice(1).forEach((stop, i) => {
    const from = byFolder.get(route.stops[i]!)!;
    const to = byFolder.get(stop)!;
    hops.push({ key: `${route.id} ${i}`, from, to, kind: kindOf(from, to), order: index });
  }));
  bearing.forEach((edge, index) => {
    const from = byFolder.get(edge.from)!;
    const to = byFolder.get(edge.to)!;
    hops.push({ key: edge.id, from, to, kind: kindOf(from, to), order: drawn.length + index });
  });

  // Ports: each station side lists the tracks by it, ordered so parallel tracks do not cross.
  interface Port { key: string; other: number; order: number }
  const sides = new Map<string, Port[]>();
  const addPort = (folder: string, side: Side, port: Port): void => {
    const key = `${folder}\u0000${side}`;
    sides.set(key, [...(sides.get(key) ?? []), port]);
  };
  const exits = (hop: Hop): { out: Side; in: Side } =>
    hop.kind === "forward" ? { out: "right", in: "left" }
      : hop.kind === "back" ? { out: "left", in: "right" }
        : hop.kind === "bracket" ? { out: "right", in: "right" }
          : hop.to.row > hop.from.row ? { out: "bottom", in: "top" } : { out: "top", in: "bottom" };
  const starts = new Map<string, FlowRoute[]>();
  drawn.forEach((route, index) => {
    const first = byFolder.get(route.stops[0]!)!;
    starts.set(first.folder, [...(starts.get(first.folder) ?? []), route]);
    addPort(first.folder, "left", { key: `term ${route.id}`, other: -1e6 + index, order: index });
  });
  for (const hop of hops) {
    const side = exits(hop);
    // A vertical pair's tracks are ordered the same at both ends so they run straight: by route, then key.
    const vertical = side.out === "top" || side.out === "bottom";
    addPort(hop.from.folder, side.out, { key: `out ${hop.key}`, other: vertical ? hop.order : cy(hop.to), order: hop.order });
    addPort(hop.to.folder, side.in, { key: `in ${hop.key}`, other: vertical ? hop.order : cy(hop.from), order: hop.order });
  }
  for (const ports of sides.values()) ports.sort((a, b) => a.other - b.other || a.order - b.order || a.key.localeCompare(b.key));

  // Station sizes: one width per column from the widest name in it; a height from the tracks it carries.
  const nameW = (node: FlowNode): number => Math.ceil(Math.max(textWidth(flowName(node), 12, true), textWidth(node.folder === "." ? "project root" : node.folder, 10)) + 20 + (node.children > 0 ? 18 : 0));
  const verticalTracks = (node: FlowNode): number => Math.max(sides.get(`${node.folder}\u0000top`)?.length ?? 0, sides.get(`${node.folder}\u0000bottom`)?.length ?? 0);
  const colW = Array.from({ length: columns }, (_, c) => Math.max(90, ...inColumn(c).map((node) => Math.max(nameW(node), verticalTracks(node) * FLOW_TRACK + 40))));
  const boxH = (node: FlowNode): number => {
    const tracks = Math.max(sides.get(`${node.folder}\u0000left`)?.length ?? 0, sides.get(`${node.folder}\u0000right`)?.length ?? 0);
    return Math.min(FLOW_BOX_MAX_H, Math.max(FLOW_BOX_MIN_H, tracks * FLOW_TRACK + 12));
  };

  // Stubs: per column and rail one shared drop beside the column; the side with fewer tracks to cross.
  const railIndex = new Map(model.coreDependencies.map((core, index) => [core.folder, index]));
  const dropSide = new Map<number, "left" | "right">();
  const railsBy = new Map<number, number[]>();
  for (let c = 0; c < columns; c++) {
    const callers = inColumn(c).filter((node) => model.edges.some((edge) => edge.stub && edge.from === node.folder));
    const rails = [...new Set(model.edges.filter((edge) => edge.stub && callers.some((n) => n.folder === edge.from)).map((edge) => railIndex.get(edge.to)!))].sort((a, b) => a - b);
    railsBy.set(c, rails);
    if (callers.length === 0) continue;
    const below = inColumn(c).filter((node) => node.row > callers[0]!.row);
    const count = (side: Side): number => below.reduce((sum, node) => sum + (sides.get(`${node.folder}\u0000${side}`)?.length ?? 0), 0);
    dropSide.set(c, count("right") < count("left") ? "right" : "left");
  }
  const dropsLeft = (c: number): number => (dropSide.get(c) === "left" ? railsBy.get(c)!.length : 0);
  const dropsRight = (c: number): number => (dropSide.get(c) === "right" ? railsBy.get(c)!.length : 0);

  // Lanes: how many vertical runs each gap carries, so each gap is as wide as its tracks need.
  const inGap = (c: number, kind: HopKind): Hop[] => hops.filter((hop) => hop.kind === kind && (kind === "back" ? hop.from.column - 1 === c : hop.from.column === c));
  const channel = (drops: number): number => (drops === 0 ? 0 : drops * FLOW_DROP_GAP + 10);
  const gapW = (c: number): number => Math.max(FLOW_GAP_MIN, 14 + channel(dropsRight(c)) + inGap(c, "bracket").length * FLOW_TRACK + 12 + inGap(c, "forward").length * FLOW_TRACK + 12 + inGap(c, "back").length * FLOW_TRACK + 12 + channel(c + 1 < columns ? dropsLeft(c + 1) : 0) + 14);

  // The left margin: the widest named origin, its dot, and room for the lines to fan into their stations.
  const termW = Math.max(0, ...drawn.flatMap((route) => originLines(route).map((line) => textWidth(line, FLOW_NAME_SIZE, false))));
  const dotX = r1(FLOW_PAD + termW + 8 + FLOW_DOT_R);
  const blocks = new Map<string, { top: number; groups: { route: FlowRoute; lines: string[]; y0: number; dot: number }[] }>();
  let fan = 0;
  for (const [folder, routes] of starts) {
    const node = byFolder.get(folder)!;
    const heights = routes.map((route) => originLines(route).length * FLOW_NAME_LINE);
    const blockH = heights.reduce((a, b) => a + b, 0) + (routes.length - 1) * FLOW_NAME_GAP;
    const top = cy(node) - blockH / 2;
    let y = top;
    const groups = routes.map((route, i) => {
      const group = { route, lines: originLines(route), y0: y, dot: r1(y + heights[i]! / 2) };
      y += heights[i]! + FLOW_NAME_GAP;
      return group;
    });
    blocks.set(folder, { top, groups });
    const h = boxH(node);
    const ports = sides.get(`${folder}\u0000left`)!;
    const spacing = ports.length < 2 ? FLOW_TRACK : Math.min(FLOW_TRACK, (h - 12) / (ports.length - 1));
    groups.forEach((group) => {
      const index = ports.findIndex((port) => port.key === `term ${group.route.id}`);
      const portY = cy(node) + (index - (ports.length - 1) / 2) * spacing;
      fan = Math.max(fan, Math.abs(portY - group.dot));
    });
  }
  const colX: number[] = [];
  colX[0] = r1(dotX + FLOW_DOT_R + 16 + fan + 12 + channel(dropsLeft(0)));
  for (let c = 1; c < columns; c++) colX[c] = r1(colX[c - 1]! + colW[c - 1]! + gapW(c - 1));
  const last = columns - 1;
  const trailing = 14 + channel(dropsRight(last)) + inGap(last, "bracket").length * FLOW_TRACK + 24;

  // Rows and the rails at the foot.
  const mass = model.unowned !== undefined && model.unowned.files > 0;
  const massRow = Math.max(0, ...inColumn(0).map((node) => node.row + node.span));
  const rows = Math.max(1, ...placed.map((node) => node.row + node.span), mass ? massRow + 1 : 0);
  const railTop = FLOW_TOP + rows * FLOW_ROW_H + 12;
  const railLabels = model.coreDependencies.map((core) => textWidth(`${byFolder.get(core.folder)!.name} · core dependency · called by ${core.callers.length} of ${model.nodes.length - 1}`, 11, true));
  const width = Math.ceil(Math.max(colX[last]! + colW[last]! + trailing, FLOW_PAD * 2 + Math.max(0, ...railLabels) + 160, 560));
  const height = railTop + model.coreDependencies.length * FLOW_RAIL_GAP + FLOW_PAD;

  // Stations.
  const stations = new Map<string, FlowStation>();
  for (const node of placed) {
    const h = boxH(node);
    const seat = { x: colX[node.column]!, y: r1(cy(node)) };
    stations.set(node.folder, { folder: node.folder, seat, x: seat.x, y: r1(seat.y - h / 2), w: colW[node.column]!, h });
  }
  const portAt = (folder: string, side: Side, key: string): Point => {
    const station = stations.get(folder)!;
    const ports = sides.get(`${folder}\u0000${side}`)!;
    const index = ports.findIndex((port) => port.key === key);
    if (side === "top" || side === "bottom") {
      const x = station.x + station.w / 2 + (index - (ports.length - 1) / 2) * FLOW_TRACK;
      return [r1(x), side === "top" ? station.y : r1(station.y + station.h)];
    }
    const spacing = ports.length < 2 ? FLOW_TRACK : Math.min(FLOW_TRACK, (station.h - 12) / (ports.length - 1));
    const y = station.seat.y + (index - (ports.length - 1) / 2) * spacing;
    return [side === "left" ? station.x : station.x + station.w, r1(y)];
  };

  // Lanes: every vertical run in a gap gets its own track, ordered so parallel runs do not cross.
  const ends = new Map<string, { a: Point; b: Point }>();
  for (const hop of hops) {
    const side = exits(hop);
    ends.set(hop.key, { a: portAt(hop.from.folder, side.out, `out ${hop.key}`), b: portAt(hop.to.folder, side.in, `in ${hop.key}`) });
  }
  const lanes = new Map<string, number>();
  for (let c = 0; c < columns; c++) {
    const edge = colX[c]! + colW[c]!;
    let x = edge + 14 + channel(dropsRight(c));
    // Brackets nearest the column, the shortest innermost, so nested brackets never cross.
    const brackets = inGap(c, "bracket").sort((a, b) => Math.abs(ends.get(a.key)!.b[1] - ends.get(a.key)!.a[1]) - Math.abs(ends.get(b.key)!.b[1] - ends.get(b.key)!.a[1]) || a.order - b.order || a.key.localeCompare(b.key));
    brackets.forEach((hop, i) => lanes.set(hop.key, r1(x + i * FLOW_TRACK)));
    x += brackets.length * FLOW_TRACK + 12;
    const forward = inGap(c, "forward");
    const up = forward.filter((hop) => ends.get(hop.key)!.b[1] < ends.get(hop.key)!.a[1]).sort((a, b) => ends.get(a.key)!.a[1] - ends.get(b.key)!.a[1] || a.order - b.order || a.key.localeCompare(b.key));
    const down = forward.filter((hop) => ends.get(hop.key)!.b[1] >= ends.get(hop.key)!.a[1]).sort((a, b) => ends.get(b.key)!.a[1] - ends.get(a.key)!.a[1] || a.order - b.order || a.key.localeCompare(b.key));
    [...down, ...up].forEach((hop, i) => lanes.set(hop.key, r1(x + i * FLOW_TRACK)));
    x += forward.length * FLOW_TRACK + 12;
    const back = inGap(c, "back").sort((a, b) => ends.get(a.key)!.a[1] - ends.get(b.key)!.a[1] || a.key.localeCompare(b.key));
    back.forEach((hop, i) => lanes.set(hop.key, r1(x + i * FLOW_TRACK)));
  }
  const hopLine = (hop: Hop): FlowPolyline => {
    const { a, b } = ends.get(hop.key)!;
    if (hop.kind === "adjacent") return { points: [a, b], legs: [{ a, b }] };
    return lanePath(a, lanes.get(hop.key)!, b);
  };

  // Routes: one path each, from the terminus through every station in order.
  const routes: FlowRouteDraw[] = drawn.map((route) => {
    const color = route.slot === undefined ? "var(--flow-neutral-route)" : `var(--flow-route-${route.slot})`;
    const first = stations.get(route.stops[0]!)!;
    const startPort = portAt(first.folder, "left", `term ${route.id}`);
    const group = blocks.get(first.folder)!.groups.find((g) => g.route === route)!;
    const terminus: Point = [dotX, group.dot];
    const dy = Math.abs(terminus[1] - startPort[1]);
    const bend = r1(startPort[0] - 10 - channel(byFolder.get(first.folder)!.column === 0 ? dropsLeft(0) : 0));
    const path: Point[] = [terminus, [r1(bend - dy), terminus[1]], [bend, startPort[1]], startPort];
    const segments = new Map<string, FlowPolyline>();
    let entry: Point = startPort;
    let entrySide: Side = "left";
    route.stops.forEach((stop, i) => {
      const station = stations.get(stop)!;
      const cx = r1(station.x + station.w / 2);
      const through = (x: Point, xSide: Side | undefined): Point[] => {
        // Hidden under the box: to its middle, across, and out by the exit's side. An interchange.
        const inside: Point[] = [];
        if (entrySide === "top" || entrySide === "bottom") inside.push([entry[0], station.seat.y], [cx, station.seat.y]);
        else inside.push([cx, entry[1]]);
        if (xSide === undefined) return inside;
        if (xSide === "top" || xSide === "bottom") inside.push([cx, station.seat.y], [x[0], station.seat.y]);
        else inside.push([cx, x[1]]);
        return [...inside, x];
      };
      if (i === route.stops.length - 1) {
        path.push(...through(entry, undefined));
        return;
      }
      const hop = hops.find((h) => h.key === `${route.id} ${i}`)!;
      const side = exits(hop);
      const leg = ends.get(hop.key)!;
      path.push(...through(leg.a, side.out));
      const line = hopLine(hop);
      segments.set(route.edges[i]!, line);
      path.push(...line.points.slice(1));
      entry = leg.b;
      entrySide = side.in;
    });
    return { route, color, path: dedupe(path), terminus, segments };
  });

  const lines: FlowLineDraw[] = bearing.map((edge) => ({ edge, kind: "bearing", line: hopLine(hops.find((hop) => hop.key === edge.id)!) }));

  // Rails along the foot.
  const rails: FlowRailDraw[] = model.coreDependencies.map((core, index) => ({ folder: core.folder, index, y: railTop + index * FLOW_RAIL_GAP + 18, x0: FLOW_PAD, x1: width - FLOW_PAD }));

  // Faint: a plain interface on no route, drawn only when the selection reaches it; from a rail it rises from the rail.
  let faintIndex = 0;
  for (const edge of model.edges) {
    const fromRail = byFolder.get(edge.from)!.core;
    if (edge.routes.length > 0 || edge.stub || (atRest(edge) && !fromRail) || (!atRest(edge) && !selection.edges.has(edge.id))) continue;
    const from = byFolder.get(edge.from)!;
    const to = byFolder.get(edge.to)!;
    const b = stations.get(to.folder)!;
    const a = stations.get(from.folder);
    if (a === undefined) {
      const rail = rails.find((candidate) => candidate.folder === from.folder)!;
      const x = r1(b.x - 24 - faintIndex * 4);
      faintIndex += 1;
      const pb: Point = [b.x, r1(b.y + b.h - 4)];
      lines.push({ edge, kind: atRest(edge) ? "bearing" : "faint", line: { points: [[x, rail.y], [x, r1(pb[1] + 8)], [r1(x + 8), pb[1]], pb], legs: [{ a: [x, rail.y], b: [x, r1(pb[1] + 8)] }] } });
      continue;
    }
    const forward = to.column > from.column;
    const same = to.column === from.column;
    const pa: Point = [forward || same ? a.x + a.w : a.x, r1(a.y + a.h - 4)];
    const pb: Point = [forward ? b.x : b.x + b.w, r1(b.y + 4)];
    const lane = forward || same
      ? colX[from.column]! + colW[from.column]! + 14 + channel(dropsRight(from.column)) + 4 + faintIndex * 4
      : colX[from.column]! - 20 - channel(dropsLeft(from.column)) - faintIndex * 4;
    faintIndex += 1;
    lines.push({ edge, kind: "faint", line: lanePath(pa, r1(lane), pb) });
  }

  // Stubs: from each caller's station down beside its column to the rail, meeting it.
  const stubs: FlowStubDraw[] = [];
  for (const core of model.coreDependencies) {
    const index = railIndex.get(core.folder)!;
    const rail = rails[index]!;
    for (const id of core.stubs) {
      const edge = edgeById.get(id)!;
      const station = stations.get(edge.from);
      if (station === undefined) {
        const caller = rails.find((candidate) => candidate.folder === edge.from);
        if (caller === undefined) continue;
        const x = r1(width - FLOW_PAD - 60 + index * 9);
        stubs.push({ edge, rail: index, points: [[x, caller.y], [x, rail.y]], joints: [[x, rail.y]] });
        continue;
      }
      const node = byFolder.get(edge.from)!;
      const side = dropSide.get(node.column) ?? "left";
      const slot = railsBy.get(node.column)!.indexOf(index);
      const dropX = side === "left" ? r1(station.x - 8 - slot * FLOW_DROP_GAP) : r1(station.x + station.w + 8 + slot * FLOW_DROP_GAP);
      const tapX = side === "left" ? r1(station.x + 6 + slot * 5) : r1(station.x + station.w - 6 - slot * 5);
      const tapY = r1(station.y + station.h + 5 + slot * 4);
      stubs.push({ edge, rail: index, points: [[tapX, r1(station.y + station.h)], [tapX, tapY], [dropX, tapY], [dropX, rail.y]], joints: [[dropX, tapY], [dropX, rail.y]] });
    }
  }

  const massBox = mass ? { x: colX[0]!, y: r1(FLOW_TOP + massRow * FLOW_ROW_H + FLOW_ROW_H / 2 - 17), w: 120, h: 34 } : undefined;

  // Text by priority: each piece is placed at its first candidate that overlaps no placed text and no station, else dropped.
  const obstacles: FlowBox[] = [...stations.values()].map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }));
  if (massBox !== undefined) obstacles.push(massBox);
  const placedText: FlowBox[] = [];
  const texts: FlowText[] = [];
  const dropped: string[] = [];
  const canvas: FlowBox = { x: 2, y: 2, w: width - 4, h: height - 4 };
  const inCanvas = (box: FlowBox): boolean => box.x >= canvas.x && box.y >= canvas.y && box.x + box.w <= canvas.x + canvas.w && box.y + box.h <= canvas.y + canvas.h;
  // Drawn lines: text prefers a place no line runs through.
  const segments: [Point, Point][] = [
    ...routes.flatMap((draw) => draw.path.slice(1).map((p, i): [Point, Point] => [draw.path[i]!, p])),
    ...lines.flatMap((draw) => draw.line.points.slice(1).map((p, i): [Point, Point] => [draw.line.points[i]!, p])),
    ...stubs.flatMap((stub) => stub.points.slice(1).map((p, i): [Point, Point] => [stub.points[i]!, p])),
  ];
  const crossesLine = (box: FlowBox): boolean => segments.some(([a, b]) => {
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const y1 = Math.max(a[1], b[1]);
    if (x1 < box.x - 2 || x0 > box.x + box.w + 2 || y1 < box.y - 2 || y0 > box.y + box.h + 2) return false;
    if (Math.abs(a[0] - b[0]) < 0.05 || Math.abs(a[1] - b[1]) < 0.05) return true;
    for (let t = 0; t <= 1; t += 0.1) {
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (x >= box.x - 2 && x <= box.x + box.w + 2 && y >= box.y - 2 && y <= box.y + box.h + 2) return true;
    }
    return false;
  });
  const tryPlace = (candidates: Omit<FlowText, "key" | "priority" | "cls">[], key: string, priority: number, cls: string, avoidStations = true): FlowText | undefined => {
    const ordered = avoidStations ? [...candidates.filter((c) => !crossesLine(textBox(c))), ...candidates.filter((c) => crossesLine(textBox(c)))] : candidates;
    for (const candidate of ordered) {
      const box = textBox(candidate);
      if (!inCanvas(box) || placedText.some((other) => intersects(box, other)) || (avoidStations && obstacles.some((other) => intersects(box, other, 0)))) continue;
      placedText.push(box);
      const text: FlowText = { ...candidate, key, priority, cls };
      texts.push(text);
      return text;
    }
    dropped.push(key);
    return undefined;
  };

  // 1. Station names and folders, inside their boxes, which were sized to hold them.
  for (const node of model.nodes) {
    const station = stations.get(node.folder);
    if (station === undefined) continue;
    const within = `${node.id}-box`;
    tryPlace([{ text: flowName(node), x: station.x + 10, y: r1(station.seat.y - 2), size: 12, bold: true, align: "start", within }], `name ${node.folder}`, 1, "flow-station-name", false);
    tryPlace([{ text: node.folder === "." ? "project root" : node.folder, x: station.x + 10, y: r1(station.seat.y + 11), size: 10, bold: false, align: "start", within }], `folder ${node.folder}`, 4, "flow-station-folder", false);
  }
  if (massBox !== undefined && model.unowned !== undefined) {
    tryPlace([{ text: "No component", x: massBox.x + 10, y: massBox.y + 15, size: 12, bold: true, align: "start", within: "structure--mass-box" }], "mass name", 1, "flow-station-name", false);
    tryPlace([{ text: `${plural(model.unowned.files, "file", "files")}, ${plural(model.unowned.lines, "line", "lines")}`, x: massBox.x + 10, y: massBox.y + 28, size: 10, bold: false, align: "start", within: "structure--mass-box" }], "mass size", 4, "flow-station-folder", false);
  }
  // 2. Named origins, in full, one line each, set to end at the terminus dot: the left margin was sized to hold them.
  for (const block of blocks.values()) {
    for (const group of block.groups) {
      group.lines.forEach((line, j) => {
        const derivedWord = group.route.derived && j === group.lines.length - 1;
        tryPlace([{ text: line, x: dotX - FLOW_DOT_R - 6, y: r1(group.y0 + (j + 1) * FLOW_NAME_LINE - 3), size: FLOW_NAME_SIZE, bold: false, align: "end" }], `origin ${group.route.id} ${j}`, 2, derivedWord ? "flow-origin flow-origin-derived" : "flow-origin", false);
      });
    }
  }
  // 2. Rail labels, once each.
  for (const rail of rails) {
    const node = byFolder.get(rail.folder)!;
    const callers = model.coreDependencies[rail.index]!.callers.length;
    // Along the rail, at its start first, else wherever no stub runs through it; never dropped while a shorter form fits.
    const forms = [`${node.name} · core dependency · called by ${callers} of ${model.nodes.length - 1}`, `${node.name} · core dependency`, node.name];
    const starts = [rail.x0, ...Array.from({ length: Math.max(0, Math.floor((rail.x1 - rail.x0) / 40)) }, (_, i) => rail.x0 + 40 * (i + 1))];
    tryPlace(forms.flatMap((text) => starts.map((x) => ({ text, x, y: rail.y - 8, size: 11, bold: true, align: "start" as const }))), `rail ${rail.folder}`, 2, "flow-rail-label", true);
  }
  // 3. The caption: how the routes were derived.
  const root = byFolder.get(".");
  const entranceCount = model.entrances.filter((e) => e.reachable).length;
  const captions =
    model.routesFrom === "root interfaces"
      ? [`${root === undefined ? "This project" : root.name} declares no entrances: each structural route is derived from one of the root component's component interfaces, and named for the first component it reaches`, `No entrances declared: routes derived from the root component's interfaces`]
      : model.routesFrom === "entrances"
        ? [`${plural(model.routes.length, "structural route", "structural routes")} from ${plural(entranceCount, "entrance", "entrances")}, each named for the entrances it starts from: the path work takes, stations are components`, `${plural(model.routes.length, "structural route", "structural routes")} from ${plural(entranceCount, "entrance", "entrances")}`]
        : ["No entrance is declared and there is no root component: no structural route is drawn"];
  tryPlace(captions.map((text) => ({ text, x: FLOW_PAD, y: 22, size: 12, bold: false, align: "start" as const })), "caption", 3, "flow-caption");

  // 5. Interface identifiers: one button each, on the pipe where it stands; a core dependency's once, on its rail.
  const tags: FlowTagDraw[] = [];
  const tagW = (text: string): number => Math.ceil(textWidth(text, 10, true) + 8);
  const TAG_H = 14;
  const identifierOf = (text: string): { chokepoint: string; name: string; crossing: boolean } => {
    const found = model.identifiers.find((identifier) => identifier.text === text)!;
    return { chokepoint: found.chokepoint, name: found.name, crossing: found.crossing !== undefined };
  };
  const fits = (box: FlowBox): boolean => inCanvas(box) && !placedText.some((other) => intersects(box, other)) && !obstacles.some((other) => intersects(box, other, 0));
  const identified = model.edges.filter((edge) => !edge.stub && (edge.identifiers.length > 0 || edge.bypasses.length > 0)).sort((a, b) => b.bypasses.length - a.bypasses.length || b.identifiers.length - a.identifiers.length || a.id.localeCompare(b.id));
  for (const edge of identified) {
    const legs: { a: Point; b: Point }[] = [];
    const onRoute = routes.find((draw) => draw.segments.has(edge.id));
    if (onRoute !== undefined) legs.push(...[...onRoute.segments.get(edge.id)!.legs].reverse());
    const line = lines.find((candidate) => candidate.edge.id === edge.id);
    if (line !== undefined) legs.push(...[...line.line.legs].reverse());
    const broken = edge.bypasses.length > 0;
    const marks = edge.bypasses.length > 0 ? [`✕${edge.bypasses.length}`] : [];
    // All identifiers side by side; when they do not fit, the first and a count that selects the interface.
    const rows = [[...edge.identifiers, ...marks], ...(edge.identifiers.length > 1 ? [[edge.identifiers[0]!, `+${edge.identifiers.length - 1}`, ...marks]] : [])];
    let done = false;
    for (const row of rows) {
      const widths = row.map(tagW);
      const total = widths.reduce((a, b) => a + b, 0) + (row.length - 1) * 3;
      for (const leg of legs) {
        const length = Math.hypot(leg.b[0] - leg.a[0], leg.b[1] - leg.a[1]);
        if (length < 6) continue;
        const vertical = Math.abs(leg.a[0] - leg.b[0]) < 0.05;
        for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          const cx = r1(leg.a[0] + (leg.b[0] - leg.a[0]) * t);
          const cyy = r1(leg.a[1] + (leg.b[1] - leg.a[1]) * t);
          let x = cx - total / 2;
          const boxes = widths.map((w) => {
            const box: FlowBox = { x: r1(x), y: r1(cyy - TAG_H / 2), w, h: TAG_H };
            x += w + 3;
            return box;
          });
          if (!boxes.every(fits)) continue;
          row.forEach((text, i) => {
            const box = boxes[i]!;
            placedText.push(box);
            const kind: FlowTagDraw["kind"] = text.startsWith("✕") ? "bypass" : text.startsWith("+") ? "more" : "identifier";
            const found = kind === "identifier" ? identifierOf(text) : undefined;
            const mid: Point = [box.x + box.w / 2, box.y + box.h / 2];
            const boundary = found?.crossing === true
              ? (vertical ? { x1: r1(box.x - 5), y1: r1(mid[1]), x2: r1(box.x + box.w + 5), y2: r1(mid[1]) } : { x1: r1(mid[0]), y1: r1(box.y - 9), x2: r1(mid[0]), y2: r1(box.y + box.h + 9) })
              : undefined;
            tags.push({ text, kind, chokepoint: found?.chokepoint, name: found?.name ?? "", edge, rail: undefined, edges: [edge.id], broken, box, boundary });
            texts.push({ key: `tag ${edge.id} ${text}`, text, x: r1(mid[0]), y: r1(mid[1] + 3.6), size: 10, bold: true, align: "middle", cls: "flow-tag-text", priority: 5 });
          });
          done = true;
          break;
        }
        if (done) break;
      }
      if (done) break;
    }
    if (!done) dropped.push(`tag ${edge.id}`);
  }
  for (const core of model.coreDependencies) {
    const rail = rails[railIndex.get(core.folder)!]!;
    const stubEdges = core.stubs.map((id) => edgeById.get(id)!);
    const texts2 = [...new Set(stubEdges.flatMap((edge) => edge.identifiers))];
    const label = texts.find((t) => t.key === `rail ${core.folder}`);
    let x = label === undefined ? rail.x0 + 8 : r1(textBox(label).x + textBox(label).w + 14);
    for (const text of texts2) {
      const w = tagW(text);
      let box: FlowBox | undefined;
      for (let tries = 0; tries < 80 && box === undefined; tries++, x += 12) {
        const candidate: FlowBox = { x: r1(x), y: r1(rail.y - TAG_H / 2), w, h: TAG_H };
        if (candidate.x + candidate.w > rail.x1) break;
        const drop = stubs.some((stub) => stub.points.some((p) => p[0] >= candidate.x - 4 && p[0] <= candidate.x + candidate.w + 4 && p[1] >= rail.y - 20));
        if (fits(candidate) && !drop) box = candidate;
      }
      if (box === undefined) {
        dropped.push(`tag rail ${core.folder} ${text}`);
        continue;
      }
      placedText.push(box);
      x = box.x + box.w + 6;
      const found = identifierOf(text);
      const mid: Point = [box.x + box.w / 2, box.y + box.h / 2];
      tags.push({
        text,
        kind: "identifier",
        chokepoint: found.chokepoint,
        name: found.name,
        edge: undefined,
        rail: core.folder,
        edges: stubEdges.filter((edge) => edge.identifiers.includes(text)).map((edge) => edge.id),
        broken: stubEdges.some((edge) => edge.identifiers.includes(text) && edge.bypasses.length > 0),
        box,
        boundary: found.crossing ? { x1: r1(mid[0]), y1: r1(box.y - 9), x2: r1(mid[0]), y2: r1(box.y + box.h + 9) } : undefined,
      });
      texts.push({ key: `tag rail ${core.folder} ${text}`, text, x: r1(mid[0]), y: r1(mid[1] + 3.6), size: 10, bold: true, align: "middle", cls: "flow-tag-text", priority: 5 });
    }
  }

  // 6. Defect marks beside their stations.
  for (const node of model.nodes) {
    const station = stations.get(node.folder);
    if (station === undefined || node.defects.length === 0) continue;
    const bypasses = node.defects.reduce((sum, d) => sum + d.bypasses, 0);
    const long = `✕ ${plural(node.defects.length, "broken chokepoint", "broken chokepoints")}, ${plural(bypasses, "bypass", "bypasses")}`;
    const short = `✕ ${node.defects.length} broken`;
    const candidates = [long, short].flatMap((text) => [
      { text, x: station.x + station.w, y: r1(station.y - 3), size: 10, bold: true, align: "end" as const },
      { text, x: station.x, y: r1(station.y - 3), size: 10, bold: true, align: "start" as const },
      { text, x: station.x, y: r1(station.y + station.h + 11), size: 10, bold: true, align: "start" as const },
      { text, x: station.x + station.w + 6, y: r1(station.y + 9), size: 10, bold: true, align: "start" as const },
      { text, x: station.x + station.w, y: r1(station.y + station.h + 11), size: 10, bold: true, align: "end" as const },
      { text, x: station.x - 6, y: r1(station.y + 9), size: 10, bold: true, align: "end" as const },
      { text, x: station.x + station.w / 2, y: r1(station.y - 3), size: 10, bold: true, align: "middle" as const },
      { text, x: station.x + station.w / 2, y: r1(station.y + station.h + 11), size: 10, bold: true, align: "middle" as const },
    ]);
    tryPlace(candidates, `defect ${node.folder}`, 6, "flow-defect-mark");
  }
  // 7. Proposals from a scaffold preview, named beside their station.
  previews.forEach((preview, index) => {
    const station = stations.get(preview.component) ?? [...stations.values()][0];
    if (station === undefined) return;
    const text = `proposed preview · ${preview.name}`;
    tryPlace([
      { text, x: station.x + station.w + 14 + index * 8, y: r1(station.y + 10 + index * 12), size: 10, bold: true, align: "start" },
      { text, x: station.x, y: r1(station.y - 4 - index * 12), size: 10, bold: true, align: "start" },
      { text, x: station.x, y: r1(station.y + station.h + 12 + index * 12), size: 10, bold: true, align: "start" },
    ], `proposal ${index}`, 6, "structure-proposed-word");
  });
  // 8. Column captions.
  for (let c = 0; c < columns; c++) {
    const text = c === 0 ? "where work enters" : c === 1 ? "one interface in" : `${c} interfaces in`;
    tryPlace([{ text, x: colX[c]!, y: 44, size: 10, bold: false, align: "start" }], `column ${c}`, 7, "flow-colcap");
  }

  return { width, height, stations, rails, routes, lines, stubs, tags, texts, dropped, mass: massBox };
}

/* --------------------------------------------------------------- render */

function flowLit(selection: FlowSelection, lit: boolean): string {
  if (selection.kind === "none" || selection.kind === "change") return "";
  return lit ? "is-lit" : "is-dim";
}

function renderText(t: FlowText): Markup {
  // Every text is set from its left edge: middle and end alignment are resolved here from the embedded metrics.
  const box = textBox(t);
  return html`<text class="${t.cls}" x="${r1(box.x)}" y="${t.y}" font-size="${t.size}"${t.bold ? raw(' font-weight="700"') : null}${t.within === undefined ? null : raw(` data-within="${t.within}"`)}>${t.text}</text>`;
}

function renderStation(node: FlowNode, station: FlowStation, texts: FlowText[], selection: FlowSelection, selected: string | undefined, model: FlowModel): Markup {
  const classes = [
    "flow-station",
    node.declaresEntrance ? "flow-entry" : "",
    node.unconnected ? "flow-unconnected" : "",
    node.defects.length > 0 ? "flow-broken" : "",
    selection.kind === "component" ? (selection.nodes.has(node.folder) ? "" : "is-dim") : flowLit(selection, selection.nodes.has(node.folder)),
    selected === node.id ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  const routes = model.routes.filter((route) => route.stops.includes(node.folder)).map(routeName);
  const own = texts.filter((t) => t.key === `name ${node.folder}` || t.key === `folder ${node.folder}`);
  return html`<g class="${classes}" id="${node.id}" data-folder="${node.folder}" data-row="${String(node.row)}" data-column="${String(node.column)}" data-seat="${`${station.seat.x} ${station.seat.y}`}" data-structure-select="${node.id}" role="button" tabindex="0" aria-pressed="${selected === node.id ? "true" : "false"}" aria-label="${flowName(node)}, ${node.folder}, calls ${node.out}, called by ${node.in}${routes.length === 0 ? "" : `, on routes ${routes.join("; ")}`}">
    <title>${flowName(node)} · ${node.folder} · calls ${node.out} · called by ${node.in}${routes.length === 0 ? "" : ` · routes: ${routes.join("; ")}`}</title>
    <rect id="${node.id}-box" x="${station.x}" y="${station.y}" width="${station.w}" height="${station.h}" rx="7"/>
    ${own.map(renderText)}
    ${node.children > 0 ? html`<g data-structure-expand="${node.folder}"><rect class="flow-expand" x="${station.x + station.w - 16}" y="${station.y + 2}" width="14" height="14" rx="3" fill="transparent" stroke="none"/><path class="flow-expand-mark" d="${node.expanded ? `M ${station.x + station.w - 13} ${station.y + 9} L ${station.x + station.w - 5} ${station.y + 9}` : `M ${station.x + station.w - 13} ${station.y + 9} L ${station.x + station.w - 5} ${station.y + 9} M ${station.x + station.w - 9} ${station.y + 5} L ${station.x + station.w - 9} ${station.y + 13}`}" stroke="var(--flow-muted)" stroke-width="1.5"/><title>${node.expanded ? `Close its ${plural(node.children, "component", "components")}` : `Open its ${plural(node.children, "component", "components")} in place`}</title></g>` : null}
  </g>`;
}

/** The deterministic SVG of the map for a model, what is selected (already resolved: undefined is nothing), and any ephemeral proposals. */
export function renderFlowSvg(model: FlowModel, selected: string | undefined, previews: readonly StructurePreview[] = []): Markup {
  const selection = flowSelection(model, selected);
  const layout = flowLayout(model, selection, previews);
  const active = selection.kind !== "none" && selection.kind !== "change";
  const routeClass = (route: FlowRoute): string => (!active ? "is-muted" : selection.routes.has(route.id) ? (selection.kind === "entrance" || selection.kind === "route" ? "is-lit" : "") : "is-dim");
  const byFolder = new Map(model.nodes.map((node) => [node.folder, node]));
  const texts = (prefix: string): FlowText[] => layout.texts.filter((t) => t.key.startsWith(prefix));
  const tagClass = (tag: (typeof layout.tags)[number]): string => {
    const lit = selection.kind === "chokepoint"
      ? tag.chokepoint === selection.id
      : selection.kind === "level" || selection.kind === "edge"
        ? tag.edges.some((id) => selection.edges.has(id))
        : undefined;
    const dim = lit === undefined ? active && !tag.edges.some((id) => selection.edges.has(id) || (model.edges.find((e) => e.id === id)?.routes.some((r) => selection.routes.has(r)) ?? false)) : !lit;
    return ["flow-tag", tag.broken ? "flow-tag-broken" : "", lit === true ? "is-lit" : dim ? "is-dim" : "", tag.chokepoint !== undefined && tag.chokepoint === selected ? "is-selected" : ""].filter(Boolean).join(" ");
  };
  return html`<svg class="flow-svg" xmlns="http://www.w3.org/2000/svg" role="group" aria-labelledby="flow-svg-title" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" style="${`min-width: ${layout.width}px; max-width: ${Math.round(layout.width * 1.25)}px`}" data-selected="${selection.id ?? ""}" data-dropped="${layout.dropped.join("|")}">
    <title id="flow-svg-title">Structure: ${plural(model.routes.length, "structural route", "structural routes")} through ${plural(model.nodes.length, "component", "components")}, ${plural(model.coreDependencies.length, "core dependency", "core dependencies")} drawn as rails</title>
    <style>${raw(FLOW_SVG_STYLE)}${raw(routeVars())}</style>
    <defs>
      <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-quiet)"/></marker>
    </defs>
    <rect class="flow-surface" x="0" y="0" width="${layout.width}" height="${layout.height}" rx="12"/>
    ${texts("caption").map(renderText)}
    ${texts("column").map(renderText)}
    ${layout.rails.map((rail) => {
      const node = byFolder.get(rail.folder)!;
      return html`<g class="flow-rail ${flowLit(selection, selection.nodes.has(rail.folder))}${selected === node.id ? " is-selected" : ""}" id="${node.id}" data-folder="${rail.folder}" data-core="true" data-structure-select="${node.id}" role="button" tabindex="0" aria-pressed="${selected === node.id ? "true" : "false"}" aria-label="${node.name}, core dependency, called by ${model.coreDependencies[rail.index]!.callers.length} components">
        <title>${node.name} · ${node.folder} · core dependency: ${CORE_RULE}</title>
        <line class="flow-line flow-rail-line" data-line="${`rail ${rail.folder}`}" x1="${rail.x0}" y1="${rail.y}" x2="${rail.x1}" y2="${rail.y}" stroke="var(--flow-rail-${rail.index % FLOW_RAIL_COLORS.length})"/>
        ${texts(`rail ${rail.folder}`).map(renderText)}
      </g>`;
    })}
    ${layout.stubs.map((stub) => html`<g class="flow-stub-group ${flowLit(selection, selection.edges.has(stub.edge.id))}" data-stub="${stub.edge.id}" data-from="${stub.edge.from}" data-to="${stub.edge.to}"><path class="flow-line flow-stub" data-line="${`stub ${stub.edge.id}`}" d="${pathD(stub.points)}" stroke="var(--flow-rail-${stub.rail % FLOW_RAIL_COLORS.length})"/>${stub.joints.map(([x, y]) => html`<circle class="flow-joint" cx="${x}" cy="${y}" r="2.6" fill="var(--flow-rail-${stub.rail % FLOW_RAIL_COLORS.length})"/>`)}</g>`)}
    ${layout.lines.map((draw) => html`<g class="flow-interface ${flowLit(selection, selection.edges.has(draw.edge.id))}" id="${draw.edge.id}" data-from="${draw.edge.from}" data-to="${draw.edge.to}" data-drawn="${draw.kind}" data-structure-select="${draw.edge.id}" role="button" tabindex="0" aria-label="${draw.edge.from} to ${draw.edge.to}, on no structural route"><title>${draw.edge.from} → ${draw.edge.to}: on no structural route</title><path class="flow-line ${draw.kind === "faint" ? "flow-faint" : "flow-bearing-line"}${draw.edge.bypasses.length > 0 ? " flow-broken-line" : ""}${selection.edges.has(draw.edge.id) ? " is-lit" : ""}" data-line="${draw.edge.id}" data-edge="${draw.edge.id}" d="${pathD(draw.line.points)}" marker-end="url(#flow-arrow)"/></g>`)}
    ${layout.routes.map((draw) => html`<g class="flow-route-group ${routeClass(draw.route)}" id="${draw.route.id}" data-names="${draw.route.names.join(", ")}" data-derived="${draw.route.derived ? "true" : "false"}" data-stops="${draw.route.stops.join(" ")}" data-edges="${draw.route.edges.join(" ")}"${draw.route.rail === undefined ? null : raw(` data-rail="${draw.route.rail}"`)} data-structure-select="${draw.route.id}" role="button" tabindex="0" aria-pressed="${selection.id === draw.route.id ? "true" : "false"}" aria-label="${routeName(draw.route)}: ${draw.route.stops.map((stop) => flowName(byFolder.get(stop)!)).join(", ")}">
      <title>${routeName(draw.route)}: ${draw.route.stops.map((stop) => flowName(byFolder.get(stop)!)).join(" → ")}${draw.route.rail === undefined ? "" : ` → ${byFolder.get(draw.route.rail)!.name} (rail)`}</title>
      <path class="flow-line flow-route" data-line="${draw.route.id}" d="${pathD(draw.path)}" stroke="${draw.color}"/>
      <g class="flow-terminus${draw.route.derived ? " flow-derived" : ""}"><circle class="flow-terminus-dot" cx="${draw.terminus[0]}" cy="${draw.terminus[1]}" r="${FLOW_DOT_R}" fill="${draw.color}"${draw.route.derived ? raw(` stroke="${draw.color}"`) : null}/>${texts(`origin ${draw.route.id} `).map(renderText)}</g>
    </g>`)}
    ${[...layout.stations.entries()].map(([folder, station]) => renderStation(byFolder.get(folder)!, station, layout.texts, selection, selected, model))}
    ${layout.tags.map((tag) => {
      const where = tag.rail !== undefined ? raw(` data-rail="${tag.rail}"`) : raw(` data-edge="${tag.edge!.id}"`);
      const on = tag.rail !== undefined ? `the ${byFolder.get(tag.rail)!.name} rail` : `${tag.edge!.from} to ${tag.edge!.to}`;
      const what = tag.kind === "identifier"
        ? raw(` data-identifier="${tag.text}"${tag.rail !== undefined ? ` data-edges="${tag.edges.join(" ")}"` : ""} data-structure-select="${tag.chokepoint}" role="button" tabindex="0" aria-label="${tag.text}: ${tag.name.replace(/"/g, "&quot;")}"`)
        : raw(` data-mark="${tag.kind}" data-structure-select="${tag.edge!.id}" role="button" tabindex="0" aria-label="${tag.kind === "bypass" ? `${plural(tag.edge!.bypasses.length, "bypass", "bypasses")}` : `${tag.edge!.identifiers.length - 1} more interface identifiers`} on ${on}"`);
      return html`<g class="${tagClass(tag)}"${where}${what}>
        <title>${tag.kind === "identifier" ? `${tag.text}: ${tag.name} · on ${on}` : tag.kind === "bypass" ? `broken: ${plural(tag.edge!.bypasses.length, "bypass", "bypasses")} on ${on}` : `${tag.edge!.identifiers.join(", ")} on ${on}`}</title>
        ${tag.boundary === undefined ? null : html`<line class="flow-boundary" x1="${tag.boundary.x1}" y1="${tag.boundary.y1}" x2="${tag.boundary.x2}" y2="${tag.boundary.y2}"/>`}
        <rect x="${tag.box.x}" y="${tag.box.y}" width="${tag.box.w}" height="${tag.box.h}" rx="3"/>
        ${layout.texts.filter((t) => t.key === (tag.rail !== undefined ? `tag rail ${tag.rail} ${tag.text}` : `tag ${tag.edge!.id} ${tag.text}`)).map(renderText)}
      </g>`;
    })}
    ${layout.mass === undefined ? null : html`<g class="flow-mass" data-mass="unowned"><rect id="structure--mass-box" x="${layout.mass.x}" y="${layout.mass.y}" width="${layout.mass.w}" height="${layout.mass.h}" rx="7"/>${texts("mass").map(renderText)}</g>`}
    ${texts("defect").map(renderText)}
    ${renderFlowProposals(model, layout, previews)}
  </svg>`;
}

function renderFlowProposals(model: FlowModel, layout: FlowLayout, previews: readonly StructurePreview[]): Markup {
  return join(previews.map((preview, index) => {
    const folder = model.nodes.find((node) => node.folder === preview.component)?.folder ?? model.nodes[0]?.folder;
    const box = folder === undefined ? undefined : layout.stations.get(folder);
    if (box === undefined) return html``;
    const x = box.x + box.w + 8 + index * 8;
    return html`<g class="flow-proposal" data-proposed="true">
      <path class="structure-edge structure-proposed" d="M ${x} ${box.y} L ${x} ${box.y + box.h}"/>
      <title>proposed preview · ${preview.name}</title>
      ${layout.texts.filter((t) => t.key === `proposal ${index}`).map(renderText)}
    </g>`;
  }));
}

/* ------------------------------------------------------------ inspector */

function flowPick(id: string, text: string, extra: Markup | null = null, elementId?: string): Markup {
  return html`<button type="button" class="flow-pick" data-structure-select="${id}"${elementId === undefined ? null : raw(` id="${elementId}"`)}>${text}</button>${extra}`;
}

function flowSite(site: RelianceSite): Markup {
  const role = site.target === "protected" && site.siteClass === "bypass"
    ? "protected thing · bypass (not a legal chokepoint reference)"
    : site.target === "chokepoint" && site.siteClass === "chokepoint-reference"
      ? "chokepoint · reference (runtime call not established)"
      : site.siteClass === "inside"
        ? `${site.target === "protected" ? "protected thing" : "chokepoint"} · inside chokepoint`
        : `${site.target === "protected" ? "protected thing" : "chokepoint"} · ${site.siteClass}`;
  return html`<li data-class="${site.siteClass}" data-target="${site.target}" data-test="${site.test ? "true" : "false"}" data-owner="${site.owner ? "true" : "false"}"><code>${site.file}:${site.line}</code> in <code>${site.symbol}</code> <span class="quiet">${site.component?.folder ?? "outside declared components"}</span> <span class="site-role">${role}</span>${site.form === undefined ? null : html` <span class="label">${site.form}</span>`}${site.owner ? html` <span class="label">owner</span>` : null}${site.test ? html` <span class="label">test</span>` : null}</li>`;
}

function renderFlowOptions(component: string, name: string, chokepoints: readonly string[]): Markup {
  return html`<h5>The two options</h5><ol class="options" data-field="options">
    <li data-option="route"><strong>Route through the chokepoint.</strong> Move each bypass inside ${join(chokepoints.map((c, i) => html`<code>${c}</code>${i < chokepoints.length - 1 ? ", " : ""}`))} so the protected thing is reached through it and nowhere else; the next run turns the verdict green.</li>
    <li data-option="retire"><strong>Escalate a retirement.</strong> Record the decision with preservation as the rejected alternative, <code>escalate</code> it, and let a human <code>acknowledge</code> with the reliance of <a href="#${invariantId(component, name)}">${name}</a> in view. The invariant stands, and alarms, until then.</li>
  </ol>`;
}

function renderEvidence(model: FlowModel): Markup {
  return html`<p class="flow-evidence" data-field="evidence"><span class="label">Evidence</span> static and computed: ${model.evidence === "language adapter"
    ? `resolved references (the ${model.language} language adapter), declared entrances, and invariants`
    : html`the references the latest runs recorded to chokepoints and protected things, declared entrances, and invariants; plain component interfaces are unknown (${model.unread})`}. Observed runtime behavior is not shown.</p>`;
}

function routeSwatch(route: FlowRoute): Markup {
  const [light] = route.slot === undefined ? ["#7d8799"] : FLOW_ROUTE_COLORS[route.slot]!;
  return html`<span class="flow-swatch" data-route="${route.id}" aria-hidden="true" style="display:inline-block;width:1.6em;height:0.45em;border-radius:1em;vertical-align:middle;background:${light}${route.derived ? ";opacity:0.7" : ""}"></span>`;
}

function routeStops(model: FlowModel, route: FlowRoute): string {
  const name = (folder: string): string => {
    const node = model.nodes.find((n) => n.folder === folder);
    return node === undefined ? folder : flowName(node);
  };
  return `${route.stops.map(name).join(" → ")}${route.rail === undefined ? "" : ` → ${name(route.rail)} (rail)`}`;
}

function renderFlowSummary(model: FlowModel, previews: readonly StructurePreview[]): Markup {
  const bearing = model.edges.filter((edge) => edge.loadBearing).length;
  const broken = model.edges.filter((edge) => edge.bypasses.length > 0).length;
  const onRoutes = model.edges.filter((edge) => edge.routes.length > 0).length;
  const stubs = model.edges.filter((edge) => edge.stub).length;
  return html`<div class="flow-summary">
    <p><strong>${plural(model.edges.length, "component interface", "component interfaces")}</strong> between ${plural(model.nodes.length, "component", "components")}: ${onRoutes} on structural routes, ${stubs} ${stubs === 1 ? "is a stub" : "are stubs"} to core dependencies, and the rest drawn faint when a selection reaches them; ${bearing} load-bearing (a chokepoint or a crossing stands there)${broken > 0 ? `, ${broken} broken` : ""}. Select to follow a story; everything else dims.</p>
    ${model.edges.length === 0 ? html`<p class="empty" data-field="no-interfaces">No component interface is known: ${model.evidence === "run sites only" ? "no latest run records a reference from one component into another's chokepoint or protected thing, and the language adapter was not asked." : "no component's code references another's."}</p>` : null}
    <h4>Where work enters</h4>
    ${model.routesFrom === "root interfaces" ? html`<p class="quiet" data-field="derived-routes">No spec declares an entrance. Each structural route below is derived from one of the root component's component interfaces, named for the first component it reaches, and continues along the heaviest interface at each stop.</p>` : null}
    ${model.entrances.length === 0 && model.routesFrom !== "root interfaces" ? html`<p class="quiet" data-field="no-entrances">No spec declares an entrance, and there is no root component to derive routes from.</p>` : null}
    <ul class="flow-picks" data-field="routes">${model.routes.map((route) => html`<li>${routeSwatch(route)} ${flowPick(route.id, routeName(route), html` <span class="quiet">${routeStops(model, route)}</span>`)}</li>`)}</ul>
    ${model.entrances.length === 0 ? null : html`<details class="flow-entrances"><summary>Entrances (${model.entrances.length}): select one for its route</summary><ul class="flow-picks">${model.entrances.map((e) => html`<li>${flowPick(e.id, e.name, html` <span class="quiet">${e.reachable ? `starts in ${e.start === "." ? "the root" : e.start}` : e.reason ?? ""}</span>`, e.id)}</li>`)}</ul></details>`}
    ${model.coreDependencies.length === 0 ? null : html`<h4>Core dependencies</h4><p class="quiet" data-field="core-rule">A core dependency is ${CORE_RULE}. It is drawn as a rail; each caller's stub runs down to it.</p><ul class="flow-picks">${model.coreDependencies.map((core) => {
      const node = model.nodes.find((n) => n.folder === core.folder)!;
      return html`<li>${flowPick(node.id, node.name, html` <span class="quiet">called by ${core.callers.map((c) => (c === "." ? "the root" : c)).join(", ")}</span>`)}</li>`;
    })}</ul>`}
    <h4>Interface identifiers</h4>
    ${model.identifiers.length === 0 ? html`<p class="quiet">No chokepoint stands on a component interface.</p>` : html`<ul class="flow-picks" data-field="identifiers">${model.identifiers.map((identifier) => html`<li><code>${identifier.text}</code> ${flowPick(identifier.chokepoint, identifier.name, html` <span class="quiet">${identifier.component}${identifier.crossing === undefined ? "" : ` · crossing ${identifier.crossing.from} → ${identifier.crossing.to}`} · on ${plural(identifier.edges.length, "interface", "interfaces")}</span>`)}</li>`)}</ul>`}
    <h4>Where data goes, by trust level</h4>
    <ul class="flow-picks">${model.levels.map((level) => html`<li>${flowPick(level.id, level.name, html` <span class="quiet">${plural(level.edges.length, "interface", "interfaces")}</span>`, level.id)}</li>`)}</ul>
    <h4>What changed</h4>
    <ul class="flow-picks"><li>${flowPick(FLOW_CHANGE_ID, "What this change touches and weakens", html` <span class="quiet">comparison with the previous commit</span>`, FLOW_CHANGE_ID)}</li></ul>
    <details class="flow-chokepoints"><summary>Chokepoints (${model.chokepoints.length}): select one for its reliance</summary>
      <ul class="flow-picks">${model.chokepoints.map((c) => html`<li>${flowPick(c.id, c.name, html` <span class="quiet"><code>${c.chokepoint}</code> in ${c.component}</span>`, c.id)}</li>`)}</ul>
    </details>
    ${previews.length === 0 ? null : html`<h4>Proposed</h4><ul>${previews.map((p) => html`<li data-proposed="true">proposed preview · ${p.name}: ${p.crossing.from} → ${p.crossing.to} in ${p.component}. Reliance unknown: a proposal has no run evidence. This dashed edge exists only in the ephemeral preview.</li>`)}</ul>`}
  </div>`;
}

function renderRouteBody(model: FlowModel, route: FlowRoute): Markup {
  return html`<p>${routeSwatch(route)} <strong>${routeName(route)}</strong>: ${routeStops(model, route)}</p>
    <p class="quiet">From each stop the route follows the heaviest component interface (most reference sites) to a component not yet on it, not a core dependency, and not in a column left of the one it stands in.</p>
    <ul class="flow-picks">${route.edges.map((id) => model.edges.find((edge) => edge.id === id)!).map((edge) => html`<li>${flowPick(edge.id, `${edge.from} → ${edge.to}`, html` <span class="quiet">${edge.identifiers.length === 0 ? plural(edge.sites, "site", "sites") : edge.identifiers.join(" ")}</span>`)}</li>`)}</ul>`;
}

function renderEntranceInspector(model: FlowModel, entrance: FlowEntrance): Markup {
  const route = model.routes.find((candidate) => candidate.entrances.includes(entrance.id));
  return html`<div class="flow-inspect" data-kind="entrance">
    <p class="eyebrow">Entrance</p>
    <h3 id="${entrance.id}-heading">${entrance.name}</h3>
    <p>${entrance.meaning}</p>
    <p class="quiet">declared by <code>${entrance.declaredBy}</code> · handler <code>${entrance.handler ?? "none"}</code>${entrance.start === undefined ? "" : html` · starts in <code>${entrance.start}</code>`}</p>
    ${entrance.reachable ? (route === undefined ? html`<p class="quiet">Its route is not drawn.</p>` : renderRouteBody(model, route)) : html`<p class="empty" data-field="unreachable">${entrance.resolved ? "Unreachable" : "Unresolved"}: ${entrance.reason}</p>`}
  </div>`;
}

function renderRouteInspector(model: FlowModel, route: FlowRoute): Markup {
  return html`<div class="flow-inspect" data-kind="route">
    <p class="eyebrow">Structural route${route.derived ? " · derived" : ""}</p>
    <h3 id="${route.id}-heading">${routeName(route)}</h3>
    ${renderRouteBody(model, route)}
    ${route.derived ? html`<p class="quiet">Derived from the root component's component interface to ${route.stops[1] ?? "nothing"}: no spec declares an entrance, so the route is named for the first component it reaches.</p>` : html`<h4>The entrances it starts from</h4><ul class="flow-picks">${route.entrances.map((id) => model.entrances.find((e) => e.id === id)!).map((e) => html`<li>${flowPick(e.id, e.name, html` <span class="quiet">${e.meaning}</span>`)}</li>`)}</ul>`}
  </div>`;
}

function renderLevelInspector(model: FlowModel, level: FlowLevel): Markup {
  const edges = model.edges.filter((edge) => level.edges.includes(edge.id));
  return html`<div class="flow-inspect" data-kind="level">
    <p class="eyebrow">Trust level</p>
    <h3 id="${level.id}-heading">${level.name}</h3>
    <p>${level.meaning}</p>
    <h4>Lit: ${plural(edges.length, "component interface", "component interfaces")} whose crossings carry it</h4>
    <ul class="flow-picks">${edges.map((edge) => html`<li>${flowPick(edge.id, `${edge.from} → ${edge.to}`, html` <span class="quiet">${edge.crossings.filter((c) => c.from === level.name || c.to === level.name).map((c) => `${c.name} (${c.from} → ${c.to})`).join("; ")}</span>`)}</li>`)}</ul>
    ${level.unplaced.length === 0 ? null : html`<h4>Crossings on no component interface</h4><ul>${level.unplaced.map((c) => html`<li><a href="#${invariantId(c.component, c.name)}">${c.name}</a> <span class="quiet">${c.from} → ${c.to}, in ${c.component === "." ? "the root" : c.component}; it stands on no component interface</span></li>`)}</ul>`}
  </div>`;
}

function renderComponentInspector(model: FlowModel, node: FlowNode): Markup {
  const out = model.edges.filter((edge) => edge.from === node.folder);
  const into = model.edges.filter((edge) => edge.to === node.folder);
  const bearing = [...out, ...into].filter((edge) => edge.loadBearing || edge.bypasses.length > 0);
  const through = model.routes.filter((r) => r.stops.includes(node.folder) || r.rail === node.folder);
  return html`<div class="flow-inspect" data-kind="component">
    <p class="eyebrow">Component</p>
    <h3><a href="#${componentId(node.folder)}">${flowName(node)}</a></h3>
    <p class="quiet"><code>${node.folder}</code></p>
    <p>${node.intent}</p>
    ${node.children > 0 ? html`<p><button type="button" class="flow-pick" data-structure-expand="${node.folder}">${node.expanded ? "Close" : "Open"} its ${plural(node.children, "component", "components")} in place</button></p>` : null}
    ${node.core ? html`<p data-field="core">A core dependency: ${CORE_RULE}. Drawn as a rail; each caller's stub runs down to it.</p>` : null}
    <h4 data-field="routes">Structural routes through it (${through.length})</h4>
    <ul class="flow-picks">${through.map((route) => html`<li>${routeSwatch(route)} ${flowPick(route.id, routeName(route), html` <span class="quiet">${routeStops(model, route)}</span>`)}</li>`)}</ul>
    <h4 data-field="load-bearing">Load-bearing here (${bearing.length})</h4>
    ${bearing.length === 0 ? html`<p class="quiet">No chokepoint or crossing stands on its component interfaces.</p>` : html`<ul class="flow-picks">${bearing.map((edge) => html`<li>${flowPick(edge.id, `${edge.from} → ${edge.to}`, html` <span class="quiet">${flowLabelLines(edge).map((l) => l.text).join(" · ")}</span>`)}</li>`)}</ul>`}
    <h4>Calls ${plural(out.length, "component", "components")}</h4>
    <ul class="flow-picks">${out.map((edge) => html`<li>${flowPick(edge.id, `→ ${edge.to}`, html` <span class="quiet">${plural(edge.symbols.length, "symbol", "symbols")}</span>`)}</li>`)}</ul>
    <h4>Called by ${plural(into.length, "component", "components")}</h4>
    <ul class="flow-picks">${into.map((edge) => html`<li>${flowPick(edge.id, `← ${edge.from}`, html` <span class="quiet">${plural(edge.symbols.length, "symbol", "symbols")}</span>`)}</li>`)}</ul>
    ${node.defects.length === 0 ? null : html`<h4>Broken chokepoints</h4><ul>${node.defects.map((d) => html`<li><a href="#${invariantId(node.folder, d.name)}">${d.name}</a> <span class="quiet">${d.state} · ${plural(d.bypasses, "bypass", "bypasses")}, ${d.internal} inside ${node.folder}${d.internal === d.bypasses ? " (no interface can show them)" : ""}</span></li>`)}</ul>`}
  </div>`;
}

function renderEdgeInspector(model: FlowModel, edge: FlowEdge): Markup {
  const shown = edge.symbols.slice(0, 24);
  const byInvariant = [...new Set(edge.bypasses.map((b) => b.invariant))];
  const through = model.routes.filter((route) => edge.routes.includes(route.id));
  return html`<div class="flow-inspect" data-kind="edge">
    <p class="eyebrow">${edge.bypasses.length > 0 ? `Broken · ${plural(edge.bypasses.length, "bypass", "bypasses")}` : edge.loadBearing ? "Load-bearing component interface" : "Component interface"}</p>
    <h3>${edge.from} → ${edge.to}</h3>
    ${edge.identifiers.length === 0 ? null : html`<p data-field="identifiers">Interface identifiers: ${join(edge.identifiers.map((text) => { const found = model.identifiers.find((i) => i.text === text)!; return html`${flowPick(found.chokepoint, `${text} ${found.name}`)} `; }))}</p>`}
    <p class="quiet">${edge.stub ? "A stub: its callee is a core dependency, drawn as a rail." : through.length > 0 ? `On ${through.map(routeName).join("; ")}.` : "On no structural route: drawn faint when a selection reaches it."}</p>
    <p>Code in ${edge.from} references ${plural(edge.symbols.length, "symbol", "symbols")} of ${edge.to} at ${plural(edge.sites, "site", "sites")}.</p>
    ${edge.chokepoints.length === 0 ? null : html`<h4>Chokepoints standing here</h4><ul class="flow-picks">${edge.chokepoints.map((c) => html`<li>${flowPick(c.id, c.name, html` <span class="quiet"><code>${c.chokepoint}</code> protects <code>${c.protects}</code> · ${c.state}</span>`)}</li>`)}</ul>`}
    ${edge.crossings.length === 0 ? null : html`<h4>Crossings</h4><ul>${edge.crossings.map((c) => html`<li>${c.from} → ${c.to} <span class="quiet">${c.name}</span></li>`)}</ul>`}
    ${edge.bypasses.length === 0 ? null : html`<div class="defect" data-field="defect"><h5>Bypass sites</h5><ul class="site-list">${edge.bypasses.map((b) => html`<li data-class="bypass"><code>${b.file}:${b.line}</code> in <code>${b.symbol}</code> <span class="site-role">bypass of the protected thing of ${b.invariant}</span></li>`)}</ul>${join(byInvariant.map((name) => renderFlowOptions(edge.to, name, edge.chokepoints.filter((c) => c.name === name).map((c) => c.chokepoint))))}</div>`}
    <h4>Symbols</h4>
    <ul class="flow-symbols">${shown.map((s) => html`<li><code>${s.symbol}</code> <span class="quiet">${s.file === "" ? "" : `${s.file} · `}${plural(s.sites, "site", "sites")}</span></li>`)}</ul>
    ${edge.symbols.length > shown.length ? html`<p class="quiet">and ${edge.symbols.length - shown.length} more</p>` : null}
  </div>`;
}

/**
 * An interface identifier's inspector: the invariant behind the chokepoint, in
 * full, and where it stands on the map. Its reliance follows.
 */
function renderChokepointInspector(state: ShellState, model: FlowModel, chokepoint: FlowChokepoint, selection: FlowSelection): Markup {
  const invariant = state.spec.components.find((c) => c.folder === chokepoint.component)?.invariants.find((i) => i.name === chokepoint.name);
  const reliance = invariant === undefined ? [] : relianceOf(invariant, state.spec.components, state.runs.records).filter((r) => r.chokepoint === chokepoint.chokepoint);
  const edges = model.edges.filter((edge) => selection.edges.has(edge.id));
  const identifier = model.identifiers.find((i) => i.chokepoint === chokepoint.id);
  const through = model.routes.filter((route) => edges.some((edge) => edge.routes.includes(route.id) || (edge.stub && route.rail === edge.to && route.stops[route.stops.length - 1] === edge.from)));
  const meaning = (level: string): string => state.spec.trustLevels.find((l) => l.name === level)?.meaning ?? "not a declared trust level";
  const bypasses = invariant === undefined ? [] : latestOf(invariant, state.runs.records).filter((entry) => entry.form === "chokepoint").flatMap((entry) => entry.bypasses);
  return html`<div class="flow-inspect" data-kind="chokepoint" data-reliance-of="${chokepoint.name}">
    <p class="eyebrow">${identifier === undefined ? "Chokepoint" : `Interface identifier ${identifier.text}`} · and its reliance</p>
    <h3 id="${chokepoint.id}-heading"><a href="#${invariantId(chokepoint.component, chokepoint.name)}">${chokepoint.name}</a></h3>
    ${invariant === undefined ? null : html`<p data-field="sentence">${invariant.sentence}</p>`}
    <p class="quiet">in <code>${chokepoint.component}</code> · <span class="state-mark" data-state="${chokepoint.state}">${chokepoint.state}</span></p>
    <p class="quiet"><code>${chokepoint.chokepoint}</code> protects <code>${chokepoint.protects}</code></p>
    ${invariant === undefined ? null : html`<h4>Enforcement</h4><ul class="enforcements">${join(invariant.enforcements.map((enforcement) => renderEnforcement(state, invariant, enforcement)))}</ul>`}
    ${invariant?.crossing === undefined ? null : html`<h4>Crossing</h4><p class="crossing" data-field="crossing"><span class="level">${invariant.crossing.from}</span> <span class="quiet">(${meaning(invariant.crossing.from)})</span> → <span class="level">${invariant.crossing.to}</span> <span class="quiet">(${meaning(invariant.crossing.to)})</span></p>`}
    ${invariant === undefined ? null : renderRefutation(invariant, state.runs.records)}
    ${bypasses.length === 0 ? null : html`<div class="defect" data-field="defect"><h5>Bypass sites</h5><ul class="site-list">${bypasses.map((b) => html`<li data-class="bypass"><code>${b.file}:${b.line}</code> in <code>${b.symbol}</code></li>`)}</ul>${renderFlowOptions(chokepoint.component, chokepoint.name, [chokepoint.chokepoint])}</div>`}
    <h4>The component interfaces it stands on (${edges.length})</h4>
    <ul class="flow-picks" data-field="interfaces">${edges.map((edge) => html`<li>${flowPick(edge.id, `${edge.from} → ${edge.to}`, html` <span class="quiet">${plural(edge.symbols.length, "symbol", "symbols")}${edge.stub ? " · a stub to a core dependency" : ""}</span>`)}</li>`)}</ul>
    <h4 data-field="routes-through">Structural routes through it (${through.length})</h4>
    ${through.length === 0 ? html`<p class="quiet">No structural route passes the interfaces it stands on.</p>` : html`<ul class="flow-picks">${through.map((route) => html`<li>${routeSwatch(route)} ${flowPick(route.id, routeName(route), html` <span class="quiet">${routeStops(model, route)}</span>`)}</li>`)}</ul>`}
    <h4>Reliance</h4>
    ${join(reliance.map((r) => r.evidence.status === "unknown"
      ? html`<p class="quiet" data-reliance="unknown">${r.evidence.reason}</p>`
      : r.evidence.sites.length === 0
        ? html`<p class="quiet" data-reliance="complete">Complete run site evidence records 0 references to the chokepoint or protected thing.</p>`
        : html`<p class="quiet" data-reliance="complete">${plural(r.evidence.sites.length, "recorded reference site", "recorded reference sites")} to the chokepoint or protected thing; owner component first.</p><ul class="site-list">${r.evidence.sites.map(flowSite)}</ul>`))}
    ${invariant !== undefined && invariant.state === "structural defect" && bypasses.length === 0 ? renderFlowOptions(chokepoint.component, chokepoint.name, [chokepoint.chokepoint]) : null}
  </div>`;
}

function renderChangeInspector(): Markup {
  return html`<div class="flow-inspect" data-kind="change">
    <p class="eyebrow">Change</p>
    <h3 id="${FLOW_CHANGE_ID}-heading">What this change touches and weakens</h3>
    <p data-field="change-placeholder">Structure compares this state with the previous commit, or with a commit the agent names, in the next slice. The comparison is already one pure function over two maps, <code>compareFlows</code>, and it measures what the change touched and what it weakened:</p>
    <ul data-field="measures">
      <li>entrance added or removed</li>
      <li>component interface added, removed, or widened (references new symbols)</li>
      <li>chokepoint gaining a bypass</li>
      <li>crossing added or removed</li>
      <li>data path gaining a branch</li>
    </ul>
    <p class="quiet">No second state is in this page, so nothing is lit.</p>
  </div>`;
}

/**
 * The one inspector, beside the map: whatever is selected, else the
 * map's summary. Open while something is selected; closed by its close
 * button or Escape, which clear the selection. The selection hash reopens it.
 */
function renderFlowInspector(state: ShellState, model: FlowModel, selection: FlowSelection, previews: readonly StructurePreview[]): Markup {
  const body =
    selection.kind === "entrance"
      ? renderEntranceInspector(model, model.entrances.find((e) => e.id === selection.id)!)
      : selection.kind === "route"
        ? renderRouteInspector(model, model.routes.find((r) => r.id === selection.id)!)
      : selection.kind === "level"
        ? renderLevelInspector(model, model.levels.find((l) => l.id === selection.id)!)
        : selection.kind === "component"
          ? renderComponentInspector(model, model.nodes.find((n) => n.id === selection.id)!)
          : selection.kind === "edge"
            ? renderEdgeInspector(model, model.edges.find((e) => e.id === selection.id)!)
            : selection.kind === "chokepoint"
              ? renderChokepointInspector(state, model, model.chokepoints.find((c) => c.id === selection.id)!, selection)
              : selection.kind === "change"
                ? renderChangeInspector()
                : null;
  const open = body !== null;
  return html`<aside class="flow-inspector" aria-label="Structure inspector" data-selection="${selection.kind}" data-open="${open ? "true" : "false"}"${open ? raw(' role="dialog" aria-modal="false"') : null}>
    ${open ? html`<button type="button" class="flow-close" data-structure-close data-structure-select="${FLOW_NONE_ID}" aria-label="Close the inspector" title="Close (Escape)">×</button>` : null}
    ${body ?? renderFlowSummary(model, previews)}
  </aside>`;
}

/** The one map: the evidence it stands on, the canvas and the inspector beside it, and a legend. */
export function renderFlowSection(state: ShellState, previews: readonly StructurePreview[] = state.structure.preview, model: FlowModel = flowOf(state)): Markup {
  const selected = flowSelected(model, state.structure.selected);
  const selection = flowSelection(model, selected);
  return html`<section class="flow" aria-labelledby="flow-heading" data-interfaces="${String(model.edges.length)}">
    <div class="section-heading">
      <div><p class="eyebrow">What the system is made of and how work flows through it</p><h3 id="flow-heading">Structure</h3></div>
      <p class="quiet">${plural(model.nodes.length, "component", "components")} · ${plural(model.edges.length, "component interface", "component interfaces")} · ${plural(model.routes.length, "structural route", "structural routes")} · ${plural(model.entrances.length, "entrance", "entrances")}</p>
    </div>
    ${renderEvidence(model)}
    <div class="flow-stage">
      <div class="flow-canvas" tabindex="0" role="region" aria-label="Scrollable Structure map">${renderFlowSvg(model, selected, previews)}</div>
      ${renderFlowInspector(state, model, selection, previews)}
    </div>
    <p class="quiet flow-legend">Each colored line is a structural route: the path work takes from the entrances named at its start (or "via" the first component it reaches, marked derived, when none is declared), through components in order, caller to callee, never back to a column it has left. The map opens on the busiest entrance's route; close the inspector to see every route muted. Routes through one component meet at its station. A rail along the foot is a core dependency; a thin line from a station down to it is that component's stub, and an identifier on the rail stands on those stubs. A small boxed code on a line is an interface identifier (C a chokepoint, X one whose invariant carries a crossing), and a dashed red bar through it is the trust boundary the line crosses; select it for its invariant. A thin grey line is a load-bearing interface on no route; a dashed one is a plain interface a selection reached. A component's column is its distance from where work enters; within a column components keep folder order, so adding an interface never reorders the ones it does not reach.</p>
  </section>`;
}
