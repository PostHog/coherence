/**
 * The Structure map's render, drawn the way transit maps and process
 * drawings are. Each structural route is one line of its own color from a
 * lettered terminus through its stations in order; routes that pass the same
 * component meet at its station and run side by side at fixed offsets, never
 * merged. Every segment is horizontal, vertical, or at 45 degrees. A core
 * dependency is a rail along the foot of the map, labelled once; its callers
 * carry a short stub in the rail's color and no arrow. A chokepoint or a
 * crossing is an interface identifier drawn on the pipe where it stands, a
 * crossing with a dashed trust boundary through it; its meaning is in the
 * inspector. A component interface on no route is drawn faint, and only when
 * a selection reaches it, unless an identifier stands on it.
 *
 * Every piece of text has a priority and is placed only where it overlaps no
 * text and no station: station names first, then rail labels, the caption,
 * route letters, identifiers, defect marks, and column captions. Lower
 * priority text is dropped, never overlapped, never truncated. Every
 * coordinate is computed here from the model on each render; no position is
 * stored or read.
 */

import { componentId, invariantId, plural, relianceOf, type RelianceSite } from "./derive.ts";
import { html, join, raw, type Markup } from "./html.ts";
import type { ShellState, StructurePreview } from "./model.ts";
import {
  CORE_RULE,
  FLOW_CHANGE_ID,
  FLOW_COLUMNS,
  flowLabelLines,
  flowName,
  flowOf,
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
/** The left margin where route termini stand. */
const FLOW_LEFT = 132;
const FLOW_COL_W = 330;
/** Where a column's turning gap starts, from the column's left edge: every station box is narrower. */
const FLOW_TURN = 176;
const FLOW_TOP = 58;
const FLOW_ROW_H = 64;
/** The tallest a station may be: its tracks close up rather than grow past its row. */
const FLOW_BOX_MAX_H = 52;
/** The fixed offset between parallel tracks. */
const FLOW_TRACK = 6;
const FLOW_CHAMFER = 8;
const FLOW_RAIL_GAP = 34;
const FLOW_BOX_MIN_H = 34;

/** Route colors, light and dark: the validated categorical order (identity is also the letter, never color alone). */
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
.flow-svg .flow-terminus circle { stroke: var(--flow-surface); stroke-width: 1.5; }
.flow-svg .flow-terminus text { fill: #ffffff; }
.flow-svg .flow-end { stroke-width: 3.5; }
.flow-svg .flow-faint { fill: none; stroke: var(--flow-quiet); stroke-width: 1.4; stroke-dasharray: 5 4; }
.flow-svg .flow-bearing-line { fill: none; stroke: var(--flow-quiet); stroke-width: 1.6; }
.flow-svg .flow-broken-line { stroke: var(--flow-defect); stroke-width: 2; stroke-dasharray: 6 3; }
.flow-svg .flow-rail-line { stroke-width: 6; stroke-linecap: round; }
.flow-svg .flow-stub { stroke-width: 2.5; }
.flow-svg .flow-rail-label { fill: var(--flow-ink); }
.flow-svg .flow-tag rect { fill: var(--flow-tag); stroke: var(--flow-node-border); stroke-width: 1; }
.flow-svg .flow-tag.flow-tag-broken rect { stroke: var(--flow-defect); stroke-width: 1.8; }
.flow-svg .flow-boundary { stroke: var(--flow-boundary); stroke-width: 2.2; stroke-dasharray: 3 2; }
.flow-svg .flow-caption, .flow-svg .flow-colcap, .flow-svg .flow-defect-mark, .flow-svg .flow-rail-label { paint-order: stroke; stroke: var(--flow-surface); stroke-width: 3px; stroke-linejoin: round; }
.flow-svg .structure-edge.structure-proposed { fill: none; stroke: var(--flow-proposed); stroke-width: 2; stroke-dasharray: 9 6; }
.flow-svg .structure-proposed-word { fill: var(--flow-proposed); }
.flow-svg [data-structure-select], .flow-svg [data-structure-expand] { cursor: pointer; }
.flow-svg [data-structure-select]:focus { outline: none; }
.flow-svg .flow-station:focus rect, .flow-svg .flow-station.is-selected rect { stroke: var(--flow-lit); stroke-width: 3; }
.flow-svg .flow-station.is-lit rect { stroke: var(--flow-lit); stroke-width: 2.5; }
.flow-svg .flow-tag.is-lit rect { stroke: var(--flow-lit); stroke-width: 2; }
.flow-svg .flow-faint.is-lit, .flow-svg .flow-bearing-line.is-lit { stroke: var(--flow-lit); stroke-opacity: 1; }
.flow-svg .flow-route-group.is-lit .flow-route { stroke-width: 4.5; }
.flow-svg .is-dim { opacity: 0.16; }
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

/** A station: a component's box, its seat (left edge and row center) a function of its own row and column. */
export interface FlowStation extends FlowBox {
  folder: string;
  /** The seat: what stability promises. */
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
  terminus: Point;
  /** Per interface id along the route: the legs of its segment. */
  segments: Map<string, FlowPolyline>;
}

interface FlowLineDraw {
  edge: FlowEdge;
  kind: "bearing" | "faint";
  line: FlowPolyline;
}

interface FlowStubDraw {
  edge: FlowEdge;
  rail: number;
  from: Point;
  to: Point;
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

interface FlowTagDraw {
  edge: FlowEdge;
  text: string;
  box: FlowBox;
  boundary: { x1: number; y1: number; x2: number; y2: number } | undefined;
  identifiers: string[];
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

function colX(column: number): number {
  return FLOW_LEFT + column * FLOW_COL_W;
}

function rowY(row: number): number {
  return FLOW_TOP + row * FLOW_ROW_H + FLOW_ROW_H / 2;
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

/** The text a set of identifiers wears on one pipe: all of them when they fit, else the first and a count, never cut. */
function tagTexts(identifiers: string[]): string[] {
  const all = identifiers.join(" ");
  return identifiers.length <= 2 ? [all] : [all, `${identifiers[0]} +${identifiers.length - 1}`];
}

/**
 * Every coordinate of the map, from the model and the selection. A
 * station's seat is a function of its own row and column; the selection
 * only adds faint lines, never moves a station or a route.
 */
export function flowLayout(model: FlowModel, selection: FlowSelection = flowSelection(model, undefined), previews: readonly StructurePreview[] = []): FlowLayout {
  const rows = model.nodes.length + (model.unowned !== undefined && model.unowned.files > 0 ? 1 : 0);
  const coreIndex = new Map(model.coreDependencies.map((core, index) => [core.folder, index]));
  const railTop = FLOW_TOP + Math.max(1, rows) * FLOW_ROW_H + 12;
  const width = FLOW_LEFT + FLOW_COLUMNS * FLOW_COL_W;
  const height = railTop + model.coreDependencies.length * FLOW_RAIL_GAP + FLOW_PAD;
  const byFolder = new Map(model.nodes.map((node) => [node.folder, node]));
  const edgeById = new Map(model.edges.map((edge) => [edge.id, edge]));

  // Ports: each station side lists the tracks that leave or enter by it, ordered by the other end's height.
  type Side = "left" | "right";
  interface Port { key: string; other: number; route: number }
  const sides = new Map<string, Port[]>();
  const addPort = (folder: string, side: Side, port: Port): void => {
    const key = `${folder}\u0000${side}`;
    sides.set(key, [...(sides.get(key) ?? []), port]);
  };
  const sideOf = (from: FlowNode, to: FlowNode): { out: Side; in: Side } =>
    to.column > from.column ? { out: "right", in: "left" } : to.column < from.column ? { out: "left", in: "right" } : { out: "right", in: "right" };
  const drawn = model.routes.filter((route) => route.stops.every((stop) => byFolder.has(stop) && !byFolder.get(stop)!.core));
  const bearing = model.edges.filter((edge) => (edge.loadBearing || edge.bypasses.length > 0) && edge.routes.length === 0 && !edge.stub);
  drawn.forEach((route, index) => {
    const first = byFolder.get(route.stops[0]!)!;
    addPort(first.folder, "left", { key: `term ${route.id}`, other: rowY(first.row) - 1000 + index, route: index });
    route.stops.slice(1).forEach((stop, i) => {
      const from = byFolder.get(route.stops[i]!)!;
      const to = byFolder.get(stop)!;
      const side = sideOf(from, to);
      addPort(from.folder, side.out, { key: `out ${route.id} ${i}`, other: rowY(to.row), route: index });
      addPort(to.folder, side.in, { key: `in ${route.id} ${i}`, other: rowY(from.row), route: index });
    });
  });
  bearing.forEach((edge, index) => {
    const from = byFolder.get(edge.from)!;
    const to = byFolder.get(edge.to)!;
    const side = sideOf(from, to);
    addPort(from.folder, side.out, { key: `out ${edge.id}`, other: rowY(to.row), route: drawn.length + index });
    addPort(to.folder, side.in, { key: `in ${edge.id}`, other: rowY(from.row), route: drawn.length + index });
  });
  for (const ports of sides.values()) ports.sort((a, b) => a.other - b.other || a.route - b.route || a.key.localeCompare(b.key));

  // Stations: the seat from the row and column; the width from the name; the height from the tracks it carries.
  const stations = new Map<string, FlowStation>();
  for (const node of model.nodes) {
    if (node.core) continue;
    const name = flowName(node);
    const folder = node.folder === "." ? "project root" : node.folder;
    const w = Math.ceil(Math.max(textWidth(name, 12, true), textWidth(folder, 10)) + 20 + (node.children > 0 ? 18 : 0));
    const tracks = Math.max(sides.get(`${node.folder}\u0000left`)?.length ?? 0, sides.get(`${node.folder}\u0000right`)?.length ?? 0);
    const h = Math.min(FLOW_BOX_MAX_H, Math.max(FLOW_BOX_MIN_H, tracks * FLOW_TRACK + 12));
    const seat = { x: colX(node.column), y: rowY(node.row) };
    stations.set(node.folder, { folder: node.folder, seat, x: seat.x, y: r1(seat.y - h / 2), w, h });
  }
  const portAt = (folder: string, side: Side, key: string): Point => {
    const station = stations.get(folder)!;
    const ports = sides.get(`${folder}\u0000${side}`)!;
    const index = ports.findIndex((port) => port.key === key);
    const spacing = ports.length < 2 ? FLOW_TRACK : Math.min(FLOW_TRACK, (station.h - 12) / (ports.length - 1));
    const y = station.seat.y + (index - (ports.length - 1) / 2) * spacing;
    return [side === "left" ? station.x : station.x + station.w, r1(y)];
  };

  // Lanes: every vertical run in a column's turning gap gets its own track, ordered so parallel runs do not cross.
  interface Run { key: string; gap: number; from: Point; to: Point; backward: boolean }
  const runs: Run[] = [];
  const plan = (key: string, from: FlowNode, to: FlowNode, a: Point, b: Point): void => {
    const backward = to.column < from.column;
    runs.push({ key, gap: backward ? from.column - 1 : from.column, from: a, to: b, backward });
  };
  const ends = new Map<string, { a: Point; b: Point; from: FlowNode; to: FlowNode }>();
  drawn.forEach((route) => {
    route.stops.slice(1).forEach((stop, i) => {
      const from = byFolder.get(route.stops[i]!)!;
      const to = byFolder.get(stop)!;
      const side = sideOf(from, to);
      const a = portAt(from.folder, side.out, `out ${route.id} ${i}`);
      const b = portAt(to.folder, side.in, `in ${route.id} ${i}`);
      ends.set(`${route.id} ${i}`, { a, b, from, to });
      plan(`${route.id} ${i}`, from, to, a, b);
    });
  });
  for (const edge of bearing) {
    const from = byFolder.get(edge.from)!;
    const to = byFolder.get(edge.to)!;
    const side = sideOf(from, to);
    const a = portAt(from.folder, side.out, `out ${edge.id}`);
    const b = portAt(to.folder, side.in, `in ${edge.id}`);
    ends.set(edge.id, { a, b, from, to });
    plan(edge.id, from, to, a, b);
  }
  const lanes = new Map<string, number>();
  for (let gap = 0; gap < FLOW_COLUMNS; gap++) {
    const start = colX(gap) + FLOW_TURN;
    const inGap = runs.filter((run) => run.gap === gap);
    const up = inGap.filter((run) => !run.backward && run.to[1] < run.from[1]).sort((a, b) => a.from[1] - b.from[1] || a.key.localeCompare(b.key));
    const down = inGap.filter((run) => !run.backward && run.to[1] >= run.from[1]).sort((a, b) => b.from[1] - a.from[1] || a.key.localeCompare(b.key));
    [...up, ...down].forEach((run, index) => lanes.set(run.key, start + 10 + index * FLOW_TRACK));
    const back = inGap.filter((run) => run.backward);
    const backUp = back.filter((run) => run.to[1] < run.from[1]).sort((a, b) => a.from[1] - b.from[1] || a.key.localeCompare(b.key));
    const backDown = back.filter((run) => run.to[1] >= run.from[1]).sort((a, b) => b.from[1] - a.from[1] || a.key.localeCompare(b.key));
    const end = colX(gap + 1) - 14;
    [...backUp, ...backDown].forEach((run, index) => lanes.set(run.key, end - index * FLOW_TRACK));
  }

  // Routes: one path each, from the terminus through every station in order.
  const termini = new Map<string, number>();
  const routes: FlowRouteDraw[] = drawn.map((route, index) => {
    const color = route.slot === undefined ? "var(--flow-neutral-route)" : `var(--flow-route-${route.slot})`;
    const first = stations.get(route.stops[0]!)!;
    const startPort = portAt(first.folder, "left", `term ${route.id}`);
    const atFirst = drawn.filter((other) => other.stops[0] === route.stops[0]);
    const place = atFirst.indexOf(route);
    const spread = 20;
    const top = Math.max(FLOW_TOP + 10, first.seat.y - ((atFirst.length - 1) * spread) / 2);
    const terminus: Point = [30, r1(top + place * spread)];
    termini.set(route.id, index);
    const dy = Math.abs(terminus[1] - startPort[1]);
    const bend = startPort[0] - 10;
    const path: Point[] = [terminus, [r1(bend - dy), terminus[1]], [bend, startPort[1]], startPort];
    const segments = new Map<string, FlowPolyline>();
    let entry: Point = startPort;
    route.stops.forEach((stop, i) => {
      const station = stations.get(stop)!;
      const cx = r1(station.x + station.w / 2);
      if (i === route.stops.length - 1) {
        path.push([cx, entry[1]]);
        return;
      }
      const leg = ends.get(`${route.id} ${i}`)!;
      // Through the station: to its middle, across to the exit track, out. Hidden under the box: an interchange.
      path.push([cx, entry[1]], [cx, leg.a[1]], leg.a);
      const line = lanePath(leg.a, lanes.get(`${route.id} ${i}`)!, leg.b);
      segments.set(route.edges[i]!, line);
      path.push(...line.points.slice(1));
      entry = leg.b;
    });
    return { route, color, path: dedupe(path), terminus, segments };
  });

  const lines: FlowLineDraw[] = bearing.map((edge) => {
    const leg = ends.get(edge.id)!;
    return { edge, kind: "bearing", line: lanePath(leg.a, lanes.get(edge.id)!, leg.b) };
  });
  // Rails along the foot.
  const rails: FlowRailDraw[] = model.coreDependencies.map((core, index) => ({ folder: core.folder, index, y: railTop + index * FLOW_RAIL_GAP + 18, x0: FLOW_LEFT - 16, x1: width - FLOW_PAD }));
  // Faint: a plain interface on no route, drawn only when the selection reaches it; from a rail it rises from the rail.
  let faintIndex = 0;
  for (const edge of model.edges) {
    if (edge.routes.length > 0 || edge.stub || edge.loadBearing || edge.bypasses.length > 0 || !selection.edges.has(edge.id)) continue;
    const from = byFolder.get(edge.from)!;
    const to = byFolder.get(edge.to)!;
    const b = stations.get(to.folder)!;
    const a = stations.get(from.folder);
    if (a === undefined) {
      const rail = rails.find((candidate) => candidate.folder === from.folder)!;
      const x = r1(b.x - 24 - faintIndex * 4);
      faintIndex += 1;
      const pb: Point = [b.x, r1(b.y + b.h - 4)];
      lines.push({ edge, kind: "faint", line: { points: [[x, rail.y], [x, r1(pb[1] + 8)], [r1(x + 8), pb[1]], pb], legs: [{ a: [x, rail.y], b: [x, r1(pb[1] + 8)] }] } });
      continue;
    }
    const side = sideOf(from, to);
    const pa: Point = [side.out === "right" ? a.x + a.w : a.x, r1(a.y + a.h - 4)];
    const pb: Point = [side.in === "right" ? b.x + b.w : b.x, r1(b.y + 4)];
    const gap = to.column < from.column ? from.column - 1 : from.column;
    const lane = to.column < from.column ? colX(gap + 1) - 40 - faintIndex * 4 : colX(gap) + FLOW_TURN + 70 + faintIndex * 4;
    faintIndex += 1;
    lines.push({ edge, kind: "faint", line: lanePath(pa, lane, pb) });
  }

  // A stub under every caller of a rail.
  const stubs: FlowStubDraw[] = [];
  for (const core of model.coreDependencies) {
    const index = coreIndex.get(core.folder)!;
    for (const id of core.stubs) {
      const edge = edgeById.get(id)!;
      const station = stations.get(edge.from);
      if (station !== undefined) {
        const x = r1(station.x + 10 + index * 9);
        stubs.push({ edge, rail: index, from: [x, r1(station.y + station.h)], to: [x, r1(station.y + station.h + 8)] });
      } else {
        const caller = rails.find((rail) => rail.folder === edge.from);
        if (caller === undefined) continue;
        const x = r1(width - FLOW_PAD - 60 + index * 9);
        stubs.push({ edge, rail: index, from: [x, caller.y], to: [x, caller.y + 9] });
      }
    }
  }

  const mass = model.unowned !== undefined && model.unowned.files > 0 ? { x: colX(0), y: r1(rowY(model.nodes.length) - 17), w: 120, h: 34 } : undefined;

  // Text by priority: each piece is placed at its first candidate that overlaps no placed text and no station, else dropped.
  const obstacles: FlowBox[] = [...stations.values()].map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }));
  if (mass !== undefined) obstacles.push(mass);
  const placed: FlowBox[] = [];
  const texts: FlowText[] = [];
  const dropped: string[] = [];
  const canvas: FlowBox = { x: 2, y: 2, w: width - 4, h: height - 4 };
  const inCanvas = (box: FlowBox): boolean => box.x >= canvas.x && box.y >= canvas.y && box.x + box.w <= canvas.x + canvas.w && box.y + box.h <= canvas.y + canvas.h;
  // Drawn lines: text prefers a place no line runs through, and wears a halo where it cannot have one.
  const segments: [Point, Point][] = [
    ...routes.flatMap((draw) => draw.path.slice(1).map((p, i): [Point, Point] => [draw.path[i]!, p])),
    ...lines.flatMap((draw) => draw.line.points.slice(1).map((p, i): [Point, Point] => [draw.line.points[i]!, p])),
    ...stubs.map((stub): [Point, Point] => [stub.from, stub.to]),
  ];
  const crossesLine = (box: FlowBox): boolean => segments.some(([a, b]) => {
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const y1 = Math.max(a[1], b[1]);
    if (x1 < box.x - 2 || x0 > box.x + box.w + 2 || y1 < box.y - 2 || y0 > box.y + box.h + 2) return false;
    if (Math.abs(a[0] - b[0]) < 0.05 || Math.abs(a[1] - b[1]) < 0.05) return true;
    // A diagonal: sample it.
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
      if (!inCanvas(box) || placed.some((other) => intersects(box, other)) || (avoidStations && obstacles.some((other) => intersects(box, other, 0)))) continue;
      placed.push(box);
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
  if (mass !== undefined && model.unowned !== undefined) {
    tryPlace([{ text: "No component", x: mass.x + 10, y: mass.y + 15, size: 12, bold: true, align: "start", within: "structure--mass-box" }], "mass name", 1, "flow-station-name", false);
    tryPlace([{ text: `${plural(model.unowned.files, "file", "files")}, ${plural(model.unowned.lines, "line", "lines")}`, x: mass.x + 10, y: mass.y + 28, size: 10, bold: false, align: "start", within: "structure--mass-box" }], "mass size", 4, "flow-station-folder", false);
  }
  // 2. Rail labels, once each.
  for (const rail of rails) {
    const node = byFolder.get(rail.folder)!;
    const callers = model.coreDependencies[rail.index]!.callers.length;
    tryPlace([
      { text: `${node.name} · core dependency · called by ${callers} of ${model.nodes.length - 1}`, x: rail.x0, y: rail.y - 8, size: 11, bold: true, align: "start" },
      { text: `${node.name} · core dependency`, x: rail.x0, y: rail.y - 8, size: 11, bold: true, align: "start" },
      { text: node.name, x: rail.x0, y: rail.y - 8, size: 11, bold: true, align: "start" },
    ], `rail ${rail.folder}`, 2, "flow-rail-label");
  }
  // 3. The caption: how the routes were derived.
  const root = byFolder.get(".");
  const entranceCount = model.entrances.filter((e) => e.reachable).length;
  const captions =
    model.routesFrom === "root interfaces"
      ? [`${root === undefined ? "This project" : root.name} declares no entrances: each structural route is derived from one of the root component's component interfaces`, `No entrances declared: routes derived from the root component's interfaces`]
      : model.routesFrom === "entrances"
        ? [`${plural(model.routes.length, "structural route", "structural routes")} from ${plural(entranceCount, "entrance", "entrances")}: each line is the path work takes, stations are components`, `${plural(model.routes.length, "structural route", "structural routes")} from ${plural(entranceCount, "entrance", "entrances")}`]
        : ["No entrance is declared and there is no root component: no structural route is drawn"];
  tryPlace(captions.map((text) => ({ text, x: FLOW_PAD, y: 22, size: 12, bold: false, align: "start" as const })), "caption", 3, "flow-caption");
  // 4. Route letters in their termini (the circle is the letter's ground; text never overlaps text).
  for (const draw of routes) tryPlace([{ text: draw.route.letter, x: draw.terminus[0], y: r1(draw.terminus[1] + 3.6), size: 10, bold: true, align: "middle" }], `letter ${draw.route.id}`, 3, "flow-letter");

  // 5. Interface identifiers, on the pipe where they stand: a tag box is text's footprint too.
  const tags: FlowTagDraw[] = [];
  const identified = model.edges.filter((edge) => edge.identifiers.length > 0 || edge.bypasses.length > 0).sort((a, b) => b.bypasses.length - a.bypasses.length || b.identifiers.length - a.identifiers.length || a.id.localeCompare(b.id));
  for (const edge of identified) {
    const legs: { a: Point; b: Point }[] = [];
    const onRoute = routes.find((draw) => draw.segments.has(edge.id));
    if (onRoute !== undefined) {
      const segment = onRoute.segments.get(edge.id)!;
      legs.push(...[...segment.legs].reverse());
    }
    const line = lines.find((candidate) => candidate.edge.id === edge.id);
    if (line !== undefined) legs.push(...[...line.line.legs].reverse());
    const stub = stubs.find((candidate) => candidate.edge.id === edge.id);
    const crossing = edge.crossings.length > 0;
    let done = false;
    const marks = [...edge.identifiers, ...(edge.bypasses.length > 0 ? [`✕${edge.bypasses.length}`] : [])];
    for (const text of tagTexts(marks)) {
      const w = Math.ceil(textWidth(text, 10, true) + 8);
      const h = 14;
      const centers: Point[] = [];
      for (const leg of legs) {
        const length = Math.hypot(leg.b[0] - leg.a[0], leg.b[1] - leg.a[1]);
        if (length < 6) continue;
        for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) centers.push([r1(leg.a[0] + (leg.b[0] - leg.a[0]) * t), r1(leg.a[1] + (leg.b[1] - leg.a[1]) * t)]);
      }
      if (stub !== undefined) centers.push([r1(stub.to[0] + 4 + w / 2), r1(stub.to[1] + 3)], [r1(stub.to[0]), r1(stub.to[1] + 10)], [r1(stub.to[0] - 4 - w / 2), r1(stub.to[1] + 3)]);
      for (const [cx, cy] of centers) {
        const box: FlowBox = { x: r1(cx - w / 2), y: r1(cy - h / 2), w, h };
        if (!inCanvas(box) || placed.some((other) => intersects(box, other)) || obstacles.some((other) => intersects(box, other, 0))) continue;
        placed.push(box);
        texts.push({ key: `tag ${edge.id}`, text, x: r1(cx), y: r1(cy + 3.6), size: 10, bold: true, align: "middle", cls: "flow-tag-text", priority: 5 });
        const vertical = legs.length > 0 && onRoute === undefined && line === undefined ? false : true;
        tags.push({ edge, text, box, identifiers: marks, boundary: crossing ? (vertical ? { x1: r1(cx), y1: r1(cy - 13), x2: r1(cx), y2: r1(cy + 13) } : { x1: r1(cx - w / 2 - 6), y1: r1(cy), x2: r1(cx + w / 2 + 6), y2: r1(cy) }) : undefined });
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) dropped.push(`tag ${edge.id}`);
  }
  // A boundary is drawn across the pipe: vertical across a horizontal leg, horizontal across a vertical one.
  for (const tag of tags) {
    if (tag.boundary === undefined) continue;
    const onVertical = routes.some((draw) => draw.segments.get(tag.edge.id)?.legs.some((leg) => Math.abs(leg.a[0] - leg.b[0]) < 0.05 && Math.abs(leg.a[0] - (tag.box.x + tag.box.w / 2)) < 0.2)) ||
      lines.some((draw) => draw.edge.id === tag.edge.id && draw.line.legs.some((leg) => Math.abs(leg.a[0] - leg.b[0]) < 0.05 && Math.abs(leg.a[0] - (tag.box.x + tag.box.w / 2)) < 0.2)) ||
      stubs.some((stub) => stub.edge.id === tag.edge.id);
    const cx = tag.box.x + tag.box.w / 2;
    const cy = tag.box.y + tag.box.h / 2;
    tag.boundary = onVertical ? { x1: r1(tag.box.x - 9), y1: r1(cy), x2: r1(tag.box.x + tag.box.w + 9), y2: r1(cy) } : { x1: r1(cx), y1: r1(tag.box.y - 11), x2: r1(cx), y2: r1(tag.box.y + tag.box.h + 11) };
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
      { text, x: station.x, y: r1(station.y + station.h + 11), size: 10, bold: true, align: "start" as const },
      { text, x: station.x + station.w + 6, y: r1(station.y + 9), size: 10, bold: true, align: "start" as const },
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
  const colcaps = ["where work enters", "one interface in", "further in"];
  colcaps.forEach((text, column) => tryPlace([{ text, x: colX(column), y: 44, size: 10, bold: false, align: "start" }], `column ${column}`, 7, "flow-colcap"));

  return { width, height, stations, rails, routes, lines, stubs, tags, texts, dropped, mass };
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
  const routes = model.routes.filter((route) => route.stops.includes(node.folder)).map((route) => route.letter);
  const own = texts.filter((t) => t.key === `name ${node.folder}` || t.key === `folder ${node.folder}`);
  return html`<g class="${classes}" id="${node.id}" data-folder="${node.folder}" data-row="${String(node.row)}" data-column="${String(node.column)}" data-seat="${`${station.seat.x} ${station.seat.y}`}" data-structure-select="${node.id}" role="button" tabindex="0" aria-pressed="${selected === node.id ? "true" : "false"}" aria-label="${flowName(node)}, ${node.folder}, calls ${node.out}, called by ${node.in}${routes.length === 0 ? "" : `, on routes ${routes.join(", ")}`}">
    <title>${flowName(node)} · ${node.folder} · calls ${node.out} · called by ${node.in}${routes.length === 0 ? "" : ` · routes ${routes.join(" ")}`}</title>
    <rect id="${node.id}-box" x="${station.x}" y="${station.y}" width="${station.w}" height="${station.h}" rx="7"/>
    ${own.map(renderText)}
    ${node.children > 0 ? html`<g data-structure-expand="${node.folder}"><rect class="flow-expand" x="${station.x + station.w - 16}" y="${station.y + 2}" width="14" height="14" rx="3" fill="transparent" stroke="none"/><path class="flow-expand-mark" d="${node.expanded ? `M ${station.x + station.w - 13} ${station.y + 9} L ${station.x + station.w - 5} ${station.y + 9}` : `M ${station.x + station.w - 13} ${station.y + 9} L ${station.x + station.w - 5} ${station.y + 9} M ${station.x + station.w - 9} ${station.y + 5} L ${station.x + station.w - 9} ${station.y + 13}`}" stroke="var(--flow-muted)" stroke-width="1.5"/><title>${node.expanded ? `Close its ${plural(node.children, "component", "components")}` : `Open its ${plural(node.children, "component", "components")} in place`}</title></g>` : null}
  </g>`;
}

/** The deterministic SVG of the map for a model, a selection, and any ephemeral proposals. */
export function renderFlowSvg(model: FlowModel, selected: string | undefined, previews: readonly StructurePreview[] = []): Markup {
  const selection = flowSelection(model, selected);
  const layout = flowLayout(model, selection, previews);
  const active = selection.kind !== "none" && selection.kind !== "change";
  const routeClass = (route: FlowRoute): string => (!active ? "" : selection.routes.has(route.id) ? (selection.kind === "entrance" || selection.kind === "route" ? "is-lit" : "") : "is-dim");
  const byFolder = new Map(model.nodes.map((node) => [node.folder, node]));
  const texts = (prefix: string): FlowText[] => layout.texts.filter((t) => t.key.startsWith(prefix));
  return html`<svg class="flow-svg" xmlns="http://www.w3.org/2000/svg" role="group" aria-labelledby="flow-svg-title" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" data-selected="${selection.id ?? ""}" data-dropped="${layout.dropped.join("|")}">
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
    ${layout.lines.map((draw) => html`<g class="flow-interface ${flowLit(selection, selection.edges.has(draw.edge.id))}" id="${draw.edge.id}" data-from="${draw.edge.from}" data-to="${draw.edge.to}" data-drawn="${draw.kind}" data-structure-select="${draw.edge.id}" role="button" tabindex="0" aria-label="${draw.edge.from} to ${draw.edge.to}, on no structural route"><title>${draw.edge.from} → ${draw.edge.to}: on no structural route</title><path class="flow-line ${draw.kind === "faint" ? "flow-faint" : "flow-bearing-line"}${draw.edge.bypasses.length > 0 ? " flow-broken-line" : ""}${selection.edges.has(draw.edge.id) ? " is-lit" : ""}" data-line="${draw.edge.id}" data-edge="${draw.edge.id}" d="${pathD(draw.line.points)}" marker-end="url(#flow-arrow)"/></g>`)}
    ${layout.routes.map((draw) => html`<g class="flow-route-group ${routeClass(draw.route)}" id="${draw.route.id}" data-route="${draw.route.letter}" data-stops="${draw.route.stops.join(" ")}" data-edges="${draw.route.edges.join(" ")}"${draw.route.rail === undefined ? null : raw(` data-rail="${draw.route.rail}"`)} data-structure-select="${draw.route.id}" role="button" tabindex="0" aria-label="Route ${draw.route.letter}: ${draw.route.stops.join(", ")}">
      <title>Route ${draw.route.letter}: ${draw.route.stops.map((stop) => flowName(byFolder.get(stop)!)).join(" → ")}${draw.route.rail === undefined ? "" : ` → ${byFolder.get(draw.route.rail)!.name} (rail)`}</title>
      <path class="flow-line flow-route" data-line="${draw.route.id}" d="${pathD(draw.path)}" stroke="${draw.color}"/>
      <g class="flow-terminus"><circle cx="${draw.terminus[0]}" cy="${draw.terminus[1]}" r="8.5" fill="${draw.color}"/>${texts(`letter ${draw.route.id}`).map(renderText)}</g>
    </g>`)}
    ${layout.stubs.map((stub) => html`<g class="flow-stub-group ${flowLit(selection, selection.edges.has(stub.edge.id))}" data-stub="${stub.edge.id}" data-from="${stub.edge.from}" data-to="${stub.edge.to}"><line class="flow-line flow-stub" data-line="${`stub ${stub.edge.id}`}" x1="${stub.from[0]}" y1="${stub.from[1]}" x2="${stub.to[0]}" y2="${stub.to[1]}" stroke="var(--flow-rail-${stub.rail % FLOW_RAIL_COLORS.length})"/><circle cx="${stub.to[0]}" cy="${stub.to[1]}" r="3" fill="var(--flow-rail-${stub.rail % FLOW_RAIL_COLORS.length})"/></g>`)}
    ${[...layout.stations.entries()].map(([folder, station]) => renderStation(byFolder.get(folder)!, station, layout.texts, selection, selected, model))}
    ${layout.tags.map((tag) => {
      const lit = selection.kind === "level" || selection.kind === "chokepoint" || selection.kind === "edge" ? selection.edges.has(tag.edge.id) : undefined;
      const cls = ["flow-tag", tag.edge.bypasses.length > 0 ? "flow-tag-broken" : "", lit === undefined ? (active && !selection.edges.has(tag.edge.id) && !tag.edge.routes.some((r) => selection.routes.has(r)) ? "is-dim" : "") : lit ? "is-lit" : "is-dim"].filter(Boolean).join(" ");
      return html`<g class="${cls}" data-edge="${tag.edge.id}" data-identifiers="${tag.identifiers.join(" ")}" data-structure-select="${tag.edge.id}" role="button" tabindex="0" aria-label="${tag.identifiers.join(", ")} on ${tag.edge.from} to ${tag.edge.to}">
        <title>${tag.identifiers.join(", ")}: ${tag.edge.chokepoints.map((c) => c.name).join("; ")}${tag.edge.crossings.length > 0 ? ` · crossing ${[...new Set(tag.edge.crossings.map((c) => `${c.from} → ${c.to}`))].join(", ")}` : ""}</title>
        ${tag.boundary === undefined ? null : html`<line class="flow-boundary" x1="${tag.boundary.x1}" y1="${tag.boundary.y1}" x2="${tag.boundary.x2}" y2="${tag.boundary.y2}"/>`}
        <rect x="${tag.box.x}" y="${tag.box.y}" width="${tag.box.w}" height="${tag.box.h}" rx="3"/>
        ${layout.texts.filter((t) => t.key === `tag ${tag.edge.id}`).map(renderText)}
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
  return html`<span class="flow-swatch" data-route="${route.letter}" style="display:inline-block;min-width:1.4em;padding:0 0.3em;border-radius:1em;background:${light};color:#fff;font-weight:700;text-align:center">${route.letter}</span>`;
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
    ${model.routesFrom === "root interfaces" ? html`<p class="quiet" data-field="derived-routes">No spec declares an entrance. Each structural route below is derived from one of the root component's component interfaces, and continues along the heaviest interface at each stop.</p>` : null}
    ${model.entrances.length === 0 && model.routesFrom !== "root interfaces" ? html`<p class="quiet" data-field="no-entrances">No spec declares an entrance, and there is no root component to derive routes from.</p>` : null}
    <ul class="flow-picks" data-field="routes">${model.routes.map((route) => html`<li>${routeSwatch(route)} ${flowPick(route.id, `Route ${route.letter}`, html` <span class="quiet">${routeStops(model, route)}${route.entrances.length === 0 ? "" : ` · ${route.entrances.map((id) => model.entrances.find((e) => e.id === id)?.name ?? id).join(", ")}`}</span>`)}</li>`)}</ul>
    ${model.entrances.length === 0 ? null : html`<details class="flow-entrances"><summary>Entrances (${model.entrances.length}): select one for its route</summary><ul class="flow-picks">${model.entrances.map((e) => html`<li>${flowPick(e.id, e.name, html` <span class="quiet">${e.reachable ? `starts in ${e.start === "." ? "the root" : e.start}` : e.reason ?? ""}</span>`, e.id)}</li>`)}</ul></details>`}
    ${model.coreDependencies.length === 0 ? null : html`<h4>Core dependencies</h4><p class="quiet" data-field="core-rule">A core dependency is ${CORE_RULE}. It is drawn as a rail; its callers carry a short stub, not an arrow.</p><ul class="flow-picks">${model.coreDependencies.map((core) => {
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
  return html`<p>${routeSwatch(route)} <strong>Route ${route.letter}</strong>: ${routeStops(model, route)}</p>
    <p class="quiet">From each stop the route follows the heaviest component interface (most reference sites) to a component not yet on it and not a core dependency.</p>
    <ul class="flow-picks">${route.edges.map((id) => model.edges.find((edge) => edge.id === id)!).map((edge) => html`<li>${flowPick(edge.id, `${edge.from} → ${edge.to}`, html` <span class="quiet">${edge.identifiers.length === 0 ? plural(edge.sites, "site", "sites") : edge.identifiers.join(" ")}</span>`)}</li>`)}</ul>`;
}

function renderEntranceInspector(model: FlowModel, entrance: FlowEntrance): Markup {
  const route = model.routes.find((candidate) => candidate.entrances.includes(entrance.id));
  return html`<div class="flow-inspect" data-kind="entrance">
    <p class="eyebrow">Entrance</p>
    <h3 id="${entrance.id}">${entrance.name}</h3>
    <p>${entrance.meaning}</p>
    <p class="quiet">declared by <code>${entrance.declaredBy}</code> · handler <code>${entrance.handler ?? "none"}</code>${entrance.start === undefined ? "" : html` · starts in <code>${entrance.start}</code>`}</p>
    ${entrance.reachable ? (route === undefined ? html`<p class="quiet">Its route is not drawn.</p>` : renderRouteBody(model, route)) : html`<p class="empty" data-field="unreachable">${entrance.resolved ? "Unreachable" : "Unresolved"}: ${entrance.reason}</p>`}
  </div>`;
}

function renderRouteInspector(model: FlowModel, route: FlowRoute): Markup {
  return html`<div class="flow-inspect" data-kind="route">
    <p class="eyebrow">Structural route</p>
    <h3 id="${route.id}">Route ${route.letter}</h3>
    ${renderRouteBody(model, route)}
    ${route.entrances.length === 0 ? html`<p class="quiet">Derived from the root component's component interface to ${route.stops[1] ?? "nothing"}: no spec declares an entrance.</p>` : html`<h4>Entrances on it</h4><ul class="flow-picks">${route.entrances.map((id) => model.entrances.find((e) => e.id === id)!).map((e) => html`<li>${flowPick(e.id, e.name, html` <span class="quiet">${e.meaning}</span>`)}</li>`)}</ul>`}
  </div>`;
}

function renderLevelInspector(model: FlowModel, level: FlowLevel): Markup {
  const edges = model.edges.filter((edge) => level.edges.includes(edge.id));
  return html`<div class="flow-inspect" data-kind="level">
    <p class="eyebrow">Trust level</p>
    <h3 id="${level.id}">${level.name}</h3>
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
  return html`<div class="flow-inspect" data-kind="component">
    <p class="eyebrow">Component</p>
    <h3><a href="#${componentId(node.folder)}">${flowName(node)}</a></h3>
    <p class="quiet"><code>${node.folder}</code></p>
    <p>${node.intent}</p>
    ${node.children > 0 ? html`<p><button type="button" class="flow-pick" data-structure-expand="${node.folder}">${node.expanded ? "Close" : "Open"} its ${plural(node.children, "component", "components")} in place</button></p>` : null}
    ${node.core ? html`<p data-field="core">A core dependency: ${CORE_RULE}. Drawn as a rail; each caller carries a short stub.</p>` : null}
    <h4 data-field="routes">Structural routes through it (${model.routes.filter((r) => r.stops.includes(node.folder) || r.rail === node.folder).length})</h4>
    <ul class="flow-picks">${model.routes.filter((r) => r.stops.includes(node.folder) || r.rail === node.folder).map((route) => html`<li>${routeSwatch(route)} ${flowPick(route.id, `Route ${route.letter}`, html` <span class="quiet">${routeStops(model, route)}</span>`)}</li>`)}</ul>
    <h4 data-field="load-bearing">Load-bearing here (${bearing.length})</h4>
    ${bearing.length === 0 ? html`<p class="quiet">No chokepoint or crossing stands on its component interfaces.</p>` : html`<ul class="flow-picks">${bearing.map((edge) => html`<li>${flowPick(edge.id, `${edge.from} → ${edge.to}`, html` <span class="quiet">${flowLabelLines(edge).map((l) => l.text).join(" · ")}</span>`)}</li>`)}</ul>`}
    <h4>Calls ${plural(out.length, "component", "components")}</h4>
    <ul class="flow-picks">${out.map((edge) => html`<li>${flowPick(edge.id, `→ ${edge.to}`, html` <span class="quiet">${plural(edge.symbols.length, "symbol", "symbols")}</span>`)}</li>`)}</ul>
    <h4>Called by ${plural(into.length, "component", "components")}</h4>
    <ul class="flow-picks">${into.map((edge) => html`<li>${flowPick(edge.id, `← ${edge.from}`, html` <span class="quiet">${plural(edge.symbols.length, "symbol", "symbols")}</span>`)}</li>`)}</ul>
    ${node.defects.length === 0 ? null : html`<h4>Broken chokepoints</h4><ul>${node.defects.map((d) => html`<li><a href="#${invariantId(node.folder, d.name)}">${d.name}</a> <span class="quiet">${d.state} · ${plural(d.bypasses, "bypass", "bypasses")}, ${d.internal} inside ${node.folder}${d.internal === d.bypasses ? " (no interface can show them)" : ""}</span></li>`)}</ul>`}
  </div>`;
}

function renderEdgeInspector(edge: FlowEdge): Markup {
  const shown = edge.symbols.slice(0, 24);
  const byInvariant = [...new Set(edge.bypasses.map((b) => b.invariant))];
  return html`<div class="flow-inspect" data-kind="edge">
    <p class="eyebrow">${edge.bypasses.length > 0 ? `Broken · ${plural(edge.bypasses.length, "bypass", "bypasses")}` : edge.loadBearing ? "Load-bearing component interface" : "Component interface"}</p>
    <h3>${edge.from} → ${edge.to}</h3>
    ${edge.identifiers.length === 0 ? null : html`<p data-field="identifiers">Interface identifiers: ${edge.identifiers.map((text) => html`<code>${text}</code> `)}</p>`}
    <p class="quiet">${edge.stub ? "A stub: its callee is a core dependency, drawn as a rail." : edge.routes.length > 0 ? `On ${plural(edge.routes.length, "structural route", "structural routes")}.` : "On no structural route: drawn faint when a selection reaches it."}</p>
    <p>Code in ${edge.from} references ${plural(edge.symbols.length, "symbol", "symbols")} of ${edge.to} at ${plural(edge.sites, "site", "sites")}.</p>
    ${edge.chokepoints.length === 0 ? null : html`<h4>Chokepoints standing here</h4><ul class="flow-picks">${edge.chokepoints.map((c) => html`<li>${flowPick(c.id, c.name, html` <span class="quiet"><code>${c.chokepoint}</code> protects <code>${c.protects}</code> · ${c.state}</span>`)}</li>`)}</ul>`}
    ${edge.crossings.length === 0 ? null : html`<h4>Crossings</h4><ul>${edge.crossings.map((c) => html`<li>${c.from} → ${c.to} <span class="quiet">${c.name}</span></li>`)}</ul>`}
    ${edge.bypasses.length === 0 ? null : html`<div class="defect" data-field="defect"><h5>Bypass sites</h5><ul class="site-list">${edge.bypasses.map((b) => html`<li data-class="bypass"><code>${b.file}:${b.line}</code> in <code>${b.symbol}</code> <span class="site-role">bypass of the protected thing of ${b.invariant}</span></li>`)}</ul>${join(byInvariant.map((name) => renderFlowOptions(edge.to, name, edge.chokepoints.filter((c) => c.name === name).map((c) => c.chokepoint))))}</div>`}
    <h4>Symbols</h4>
    <ul class="flow-symbols">${shown.map((s) => html`<li><code>${s.symbol}</code> <span class="quiet">${s.file === "" ? "" : `${s.file} · `}${plural(s.sites, "site", "sites")}</span></li>`)}</ul>
    ${edge.symbols.length > shown.length ? html`<p class="quiet">and ${edge.symbols.length - shown.length} more</p>` : null}
  </div>`;
}

function renderChokepointInspector(state: ShellState, model: FlowModel, chokepoint: FlowChokepoint, selection: FlowSelection): Markup {
  const invariant = state.spec.components.find((c) => c.folder === chokepoint.component)?.invariants.find((i) => i.name === chokepoint.name);
  const reliance = invariant === undefined ? [] : relianceOf(invariant, state.spec.components, state.runs.records).filter((r) => r.chokepoint === chokepoint.chokepoint);
  const edges = model.edges.filter((edge) => selection.edges.has(edge.id));
  return html`<div class="flow-inspect" data-kind="chokepoint" data-reliance-of="${chokepoint.name}">
    <p class="eyebrow">Chokepoint and its reliance</p>
    <h3 id="${chokepoint.id}"><a href="#${invariantId(chokepoint.component, chokepoint.name)}">${chokepoint.name}</a></h3>
    <p class="quiet"><code>${chokepoint.chokepoint}</code> protects <code>${chokepoint.protects}</code> · ${chokepoint.component} · <span class="state-mark" data-state="${chokepoint.state}">${chokepoint.state}</span></p>
    <h4>Lit: ${plural(edges.length, "component interface", "component interfaces")} it stands on</h4>
    <ul class="flow-picks">${edges.map((edge) => html`<li>${flowPick(edge.id, `${edge.from} → ${edge.to}`)}</li>`)}</ul>
    ${join(reliance.map((r) => r.evidence.status === "unknown"
      ? html`<p class="quiet" data-reliance="unknown">${r.evidence.reason}</p>`
      : r.evidence.sites.length === 0
        ? html`<p class="quiet" data-reliance="complete">Complete run site evidence records 0 references to the chokepoint or protected thing.</p>`
        : html`<p class="quiet" data-reliance="complete">${plural(r.evidence.sites.length, "recorded reference site", "recorded reference sites")} to the chokepoint or protected thing; owner component first.</p><ul class="site-list">${r.evidence.sites.map(flowSite)}</ul>`))}
    ${invariant !== undefined && invariant.state === "structural defect" ? renderFlowOptions(chokepoint.component, chokepoint.name, [chokepoint.chokepoint]) : null}
  </div>`;
}

function renderChangeInspector(): Markup {
  return html`<div class="flow-inspect" data-kind="change">
    <p class="eyebrow">Change</p>
    <h3 id="${FLOW_CHANGE_ID}">What this change touches and weakens</h3>
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
            ? renderEdgeInspector(model.edges.find((e) => e.id === selection.id)!)
            : selection.kind === "chokepoint"
              ? renderChokepointInspector(state, model, model.chokepoints.find((c) => c.id === selection.id)!, selection)
              : selection.kind === "change"
                ? renderChangeInspector()
                : null;
  return html`<aside class="flow-inspector" aria-label="Structure inspector" data-selection="${selection.kind}">
    ${body === null ? null : html`<p><button type="button" class="flow-pick" data-structure-select="${selection.id!}">Clear selection</button></p>`}
    ${body ?? renderFlowSummary(model, previews)}
  </aside>`;
}

/** The one map: the evidence it stands on, the SVG, the inspector, and a legend. */
export function renderFlowSection(state: ShellState, previews: readonly StructurePreview[] = state.structure.preview, model: FlowModel = flowOf(state)): Markup {
  const selected = state.structure.selected;
  const selection = flowSelection(model, selected);
  return html`<section class="flow" aria-labelledby="flow-heading" data-interfaces="${String(model.edges.length)}">
    <div class="section-heading">
      <div><p class="eyebrow">What the system is made of and how work flows through it</p><h3 id="flow-heading">Structure</h3></div>
      <p class="quiet">${plural(model.nodes.length, "component", "components")} · ${plural(model.edges.length, "component interface", "component interfaces")} · ${plural(model.routes.length, "structural route", "structural routes")} · ${plural(model.entrances.length, "entrance", "entrances")}</p>
    </div>
    ${renderEvidence(model)}
    <div class="flow-canvas" tabindex="0" role="region" aria-label="Scrollable Structure map">${renderFlowSvg(model, selected, previews)}</div>
    ${renderFlowInspector(state, model, selection, previews)}
    <p class="quiet flow-legend">Each colored line is a structural route: the path work takes from its lettered terminus, through components in order, caller to callee. Routes through one component meet at its station. A rail along the foot is a core dependency; a short stub under a station means it calls that rail. A small tag on a line is an interface identifier (C a chokepoint, X one whose invariant carries a crossing), and a dashed red bar through it is the trust boundary the line crosses; select it for its meaning. A thin grey line is a load-bearing interface on no route; a dashed one is a plain interface a selection reached. A component's row is its folder order and its column its distance from where work enters, read from its own callers, so adding an interface moves only the components it touches.</p>
  </section>`;
}
