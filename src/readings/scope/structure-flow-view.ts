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
import { html, join, raw, slug, type Markup } from "./html.ts";
import { renderEnforcement, renderRefutation } from "./invariants-view.ts";
import type { ShellState, StructurePreview } from "./model.ts";
import {
  CORE_RULE,
  DEFAULT_RULE,
  FLOW_CHANGE_ID,
  FLOW_HEALTH_KINDS,
  FLOW_NONE_ID,
  ROUTE_RULE,
  flowBoundaryId,
  flowBrokenId,
  flowHealthId,
  flowHealthMembers,
  flowLabelLines,
  flowName,
  flowOf,
  flowSelected,
  originLines,
  routeName,
  flowSelection,
  worstState,
  type FlowChokepoint,
  type FlowCrossing,
  type FlowEdge,
  type FlowEntrance,
  type FlowHealthKind,
  type FlowInvariantRef,
  type FlowLevel,
  type FlowModel,
  type FlowNode,
  type FlowRoute,
  type FlowSelection,
  type FlowState,
} from "./structure-flow.ts";
import { textWidth } from "./structure-measure.ts";

/** The page's own system family: the map is UI, set in the face the inspector and the page use. */
const FLOW_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Code-ish text on the map (a folder, an interface identifier) is set in IBM Plex Mono, embedded in the page, with a monospace fallback. */
const FLOW_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/**
 * The map's type scale: three sizes and two weights, each with one role.
 * 13 medium: a component's name. 12 regular: the map's caption. 11 regular:
 * a component's role, a column caption, a rail's label, and, in Plex Mono,
 * a folder and an interface identifier (the page embeds Plex Mono's regular
 * weight only). 11 medium: the text in a token (a route's named origin, a
 * mark). Medium (500), never semibold:
 * the owner found semibold on the map too heavy. Numerals stay proportional
 * on the map. The measure's metrics are the system face's semibold for any
 * weight from medium up (the wider, so medium is never undershot) and Plex
 * Mono's fixed advance for mono text.
 */
const TYPE_NAME = 13;
const TYPE_LABEL = 12;
const TYPE_SMALL = 11;
const FLOW_WEIGHT = "500";
const FLOW_PAD = 16;
const FLOW_TOP = 58;
const FLOW_ROW_H = 88;
/** The tallest a station may be: its tracks close up rather than grow past its row. */
const FLOW_BOX_MAX_H = 68;
/** A station holds four lines: its name, two of its role, its folder. */
const FLOW_BOX_MIN_H = 64;
/** The width a component's two role lines wrap at, unless its name or folder is wider: roles never widen a column past it. */
const FLOW_ROLE_W = 140;
/** The fixed offset between parallel tracks. */
const FLOW_TRACK = 6;
const FLOW_CHAMFER = 8;
const FLOW_RAIL_GAP = 34;
/** The fixed offset between the drops of different rails beside one column. */
const FLOW_DROP_GAP = 5;
/** A gap between columns is never narrower than this. */
const FLOW_GAP_MIN = 96;
/** Named origins: the size of a name, the height of its line, the gap between routes, the terminus dot. */
const FLOW_NAME_SIZE = TYPE_SMALL;
const FLOW_NAME_LINE = 14;
const FLOW_NAME_GAP = 10;
/** The colored token behind a route's named origin: horizontal and vertical padding. */
const FLOW_TOKEN_PAD_X = 6;
const FLOW_TOKEN_PAD_Y = 3;
const FLOW_DOT_R = 5;

/**
 * Route colors, light and dark: the validated categorical order, each hue
 * darkened only until white text on it reaches 4.5:1 (the owner asked for
 * white text in every origin token; identity is also the name, never color
 * alone). The check measures every one.
 */
export const FLOW_ROUTE_COLORS: [string, string][] = [
  ["#2874d0", "#1d73db"],
  ["#cb4814", "#c35022"],
  ["#15855d", "#15845d"],
  ["#9e6b00", "#a06a00"],
  ["#da2b6d", "#d03a71"],
  ["#008300", "#288628"],
  ["#4a3aa7", "#7162e3"],
  ["#df2c2b", "#dd3030"],
];
const FLOW_RAIL_COLORS: [string, string][] = [
  ["#5f6b7a", "#9aa6b6"],
  ["#8a6a45", "#c2a07a"],
  ["#3f7f78", "#7fbdb5"],
  ["#7a5f86", "#b79cc4"],
];
/** The route past the eighth, drawn neutral and still named; white on it reaches 4.5:1 too. */
export const FLOW_NEUTRAL_ROUTE: [string, string] = ["#6b7588", "#69758c"];

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The WCAG contrast of white text on a #rrggbb color. */
export function whiteContrast(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

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
  --flow-verified: #1f3a5f;
  --flow-neutral-route: ${FLOW_NEUTRAL_ROUTE[0]};
}
.flow-svg .flow-surface { fill: var(--flow-surface); }
.flow-svg text { font-family: ${FLOW_FONT}; fill: var(--flow-ink); }
.flow-svg text.flow-mono { font-family: ${FLOW_MONO}; }
.flow-svg .flow-caption { fill: var(--flow-muted); }
.flow-svg .flow-colcap { fill: var(--flow-muted); }
.flow-svg .flow-station rect.flow-box { fill: var(--flow-node); stroke: var(--flow-node-border); stroke-width: 1.5; }
.flow-svg .flow-station.flow-entry rect.flow-box { stroke-width: 2.5; }
.flow-svg .flow-station.flow-unconnected rect.flow-box, .flow-svg .flow-mass rect { fill: var(--flow-surface); stroke-dasharray: 4 4; }
.flow-svg .flow-station.flow-broken rect.flow-box { stroke: var(--flow-defect); }
.flow-svg .flow-station-folder { fill: var(--flow-muted); }
.flow-svg .flow-station-role { fill: var(--flow-ink); }
.flow-svg .flow-state-bar { stroke: none; }
.flow-svg .flow-state-verified { fill: var(--flow-verified); }
.flow-svg .flow-state-requirement { fill: url(#flow-hatch); stroke: var(--flow-verified); stroke-width: 0.8; }
.flow-svg .flow-state-broken { fill: var(--flow-defect); }
.flow-svg .flow-route { fill: none; stroke-width: 3.5; stroke-linejoin: round; stroke-linecap: butt; }
.flow-svg .flow-terminus-dot { stroke: var(--flow-surface); stroke-width: 1.5; }
.flow-svg .flow-derived .flow-terminus-dot { fill: var(--flow-surface); stroke-width: 2.5; stroke-dasharray: 3 2; }
.flow-svg .flow-origin { fill: #ffffff; }
.flow-svg .flow-origin-more { fill: #ffffff; }
.flow-svg .flow-derived .flow-origin-token { stroke: #ffffff; stroke-width: 1; stroke-dasharray: 3 2; }
.flow-svg .flow-faint { fill: none; stroke: var(--flow-quiet); stroke-width: 1.4; stroke-dasharray: 5 4; }
.flow-svg .flow-bearing-line { fill: none; stroke: var(--flow-quiet); stroke-width: 1.6; }
.flow-svg .flow-broken-line { stroke: var(--flow-defect); stroke-width: 2; stroke-dasharray: 6 3; }
.flow-svg .flow-rail-line { stroke-width: 6; stroke-linecap: round; }
.flow-svg .flow-stub { fill: none; stroke-width: 1.6; stroke-linejoin: round; }
.flow-svg .flow-joint { stroke: none; }
.flow-svg .flow-rail-label { fill: var(--flow-ink); }
.flow-svg .flow-station-name { fill: var(--flow-ink); }
.flow-svg .flow-tag rect { stroke-width: 1.2; }
.flow-svg .flow-tag-verified rect { fill: var(--flow-verified); stroke: var(--flow-verified); }
.flow-svg .flow-tag-verified text { fill: #ffffff; }
.flow-svg .flow-tag-requirement rect { fill: var(--flow-tag); stroke: var(--flow-node-border); stroke-dasharray: 2.5 1.5; }
.flow-svg .flow-tag-requirement text { fill: var(--flow-ink); }
.flow-svg .flow-tag-broken rect { fill: var(--flow-defect); stroke: var(--flow-defect); }
.flow-svg .flow-tag-broken text { fill: #ffffff; }
.flow-svg .flow-tag-mark rect { fill: var(--flow-tag); stroke: var(--flow-defect); stroke-width: 1.8; }
.flow-svg .flow-tag-mark text { fill: var(--flow-defect); }
.flow-svg .flow-tag:focus rect, .flow-svg .flow-tag.is-selected rect { stroke: var(--flow-lit); stroke-width: 2.5; stroke-dasharray: none; }
.flow-svg .flow-boundary { stroke: var(--flow-boundary); stroke-width: 2.2; stroke-dasharray: 3 2; }
.flow-svg .flow-caption, .flow-svg .flow-colcap, .flow-svg .flow-rail-label { paint-order: stroke; stroke: var(--flow-surface); stroke-width: 3px; stroke-linejoin: round; }
.flow-svg .structure-edge.structure-proposed { fill: none; stroke: var(--flow-proposed); stroke-width: 2; stroke-dasharray: 9 6; }
.flow-svg .structure-proposed-word { fill: var(--flow-proposed); }
.flow-svg [data-structure-select], .flow-svg [data-structure-expand] { cursor: pointer; }
.flow-svg [data-structure-select]:focus { outline: none; }
.flow-svg .flow-station:focus rect.flow-box, .flow-svg .flow-station.is-selected rect.flow-box { stroke: var(--flow-lit); stroke-width: 3; }
.flow-svg .flow-station.is-lit rect.flow-box { stroke: var(--flow-lit); stroke-width: 2.5; }
.flow-svg .flow-tag.is-lit rect { stroke: var(--flow-lit); stroke-width: 2.2; stroke-dasharray: none; }
.flow-svg .flow-faint.is-lit, .flow-svg .flow-bearing-line.is-lit { stroke: var(--flow-lit); stroke-opacity: 1; }
.flow-svg .flow-route-group.is-lit .flow-route { stroke-width: 5; }
.flow-svg .flow-route-group.is-muted .flow-route { stroke-width: 2; opacity: 0.5; }
.flow-svg .flow-route-group.is-muted .flow-terminus-dot { opacity: 0.6; }
.flow-svg .flow-route-group.is-dim .flow-route, .flow-svg .flow-route-group.is-dim .flow-terminus-dot { opacity: 0.16; }
.flow-svg .flow-route-group.is-dim .flow-route { stroke-width: 2; }
.flow-svg .flow-route-group.is-dim .flow-origin-token { opacity: 0.8; }
.flow-svg .flow-route-group.is-muted .flow-origin-token { opacity: 0.85; }
.flow-svg .is-dim { opacity: 0.16; }
.flow-svg .flow-route-group.is-dim { opacity: 1; }
.flow-svg .flow-station.is-dim { opacity: 1; }
.flow-svg .flow-station.is-dim rect.flow-box { stroke-opacity: 0.2; }
.flow-svg .flow-station.is-dim text, .flow-svg .flow-station.is-dim .flow-state-bar { opacity: 0.25; }
.flow-svg .flow-tag.is-dim { opacity: 0.3; }
@media (prefers-color-scheme: dark) {
  .flow-svg {
    --flow-surface: #111827;
    --flow-ink: #f3f6ff;
    --flow-muted: #b5bfd3;
    --flow-node: #1a2336;
    --flow-node-border: #9fb0d8;
    --flow-quiet: #6f7c96;
    --flow-defect: #e5484d;
    --flow-proposed: #f2bd68;
    --flow-tag: #111827;
    --flow-boundary: #ff8a80;
    --flow-lit: #ffd166;
    --flow-verified: #c9d6f2;
    --flow-neutral-route: ${FLOW_NEUTRAL_ROUTE[1]};
  }
  .flow-svg .flow-tag-verified text { fill: #111827; }
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
  /** The line from its origin token toward its first station: where work enters, and where an entrance's own chokepoint stands. */
  entry: { a: Point; b: Point };
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
  /** Set in IBM Plex Mono: a folder or an interface identifier. */
  mono?: boolean;
}

/**
 * One token on the map: an interface identifier (a button on its pipe, on an
 * entrance line, or once on a rail for a core dependency's stubs), a bypass
 * mark or a count on a pipe, or a component's broken or boundary mark,
 * attached to its box.
 */
interface FlowTagDraw {
  /** The identifier text (C3, X7), a bypass mark, a count of identifiers that did not fit, or a component mark's words. */
  text: string;
  kind: "identifier" | "bypass" | "more" | "broken" | "boundary";
  /** The state it is drawn in: an identifier's or boundary mark's verdict; a bypass or broken mark is broken. */
  state: FlowState | "mark";
  /** The route whose entrance line it stands on, for an identifier where work enters. */
  route: string | undefined;
  /** The component a broken or boundary mark is attached to. */
  node: string | undefined;
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

function textBox(t: Pick<FlowText, "text" | "x" | "y" | "size" | "bold" | "align" | "mono">): FlowBox {
  const w = textWidth(t.text, t.size, t.bold, 0, t.mono === true);
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

/** A rail's label, longest first: its name, what it is, and how many call it. */
function railForms(name: string, callers: number, others: number): string[] {
  return [`${name}: core dependency, called by ${callers} of ${others}`, `${name}: core dependency`, name];
}

/**
 * A component's role on its box: its spec's intent in at most two lines of
 * `width`, shortened when it does not fit at a clause (a colon, a semicolon,
 * a comma, a dash, or before "and", "that", "with", "through", "for",
 * "whose", "where", "which") of three words or more, else to the words that
 * fit, never ending on a word that only leads into the next; never an
 * ellipsis. The whole intent is in the inspector and the box's title.
 */
export function roleLines(intent: string, width: number, most = 2): string[] {
  const whole = intent.trim().replace(/[.:;,]+$/, "");
  const wrap = (text: string): string[] => {
    const lines: string[] = [];
    for (const word of text.split(" ")) {
      const last = lines[lines.length - 1];
      if (last !== undefined && textWidth(`${last} ${word}`, TYPE_SMALL, false) <= width) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines;
  };
  const fits = (text: string): boolean => {
    const lines = wrap(text);
    return lines.length <= most && lines.every((line) => textWidth(line, TYPE_SMALL, false) <= width);
  };
  if (whole === "") return [];
  if (fits(whole)) return wrap(whole);
  const cuts: number[] = [];
  for (const m of whole.matchAll(/[:;,]\s| \u2014 | (?:and|that|with|through|for|whose|where|which) /g)) cuts.push(m.index);
  const clause = cuts.map((at) => whole.slice(0, at).replace(/[.:;,]+$/, "")).filter((text) => text.split(" ").length >= 3 && fits(text)).pop();
  if (clause !== undefined) return wrap(clause);
  const words = whole.split(" ");
  let count = 0;
  while (count < words.length && fits(words.slice(0, count + 1).join(" "))) count += 1;
  const kept = words.slice(0, Math.max(1, count));
  while (kept.length > 1 && /^(?:a|an|the|as|of|to|and|or|for|with|by|in|on|at|that|through|from|into|one|its|their)$/i.test(kept[kept.length - 1]!.replace(/[.:;,]+$/, ""))) kept.pop();
  return wrap(kept.join(" ").replace(/[.:;,]+$/, ""));
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

  // Station sizes: one width per column from the widest name, folder, or role in it (a role is shortened to fit, never
  // widening a column past FLOW_ROLE_W, where it wraps to two lines); a height from the tracks it carries, never under four lines.
  const folderText = (node: FlowNode): string => (node.folder === "." ? "project root" : node.folder);
  const ownW = (node: FlowNode): number => Math.max(textWidth(flowName(node), TYPE_NAME, true) + (node.children > 0 ? 18 : 0), textWidth(folderText(node), TYPE_SMALL, false, 0, true));
  const roleW = (node: FlowNode): number => Math.min(textWidth(node.intent.trim().replace(/[.:;,]+$/, ""), TYPE_SMALL, false), Math.max(FLOW_ROLE_W, ownW(node)));
  const nameW = (node: FlowNode): number => Math.ceil(Math.max(ownW(node), roleW(node)) + 24);
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
  const termW = Math.max(0, ...drawn.flatMap((route) => originLines(route).map((line) => textWidth(line, FLOW_NAME_SIZE, true))));
  // Identifiers where work enters stand on the line from the origin: the margin leaves them room.
  const tagW = (text: string): number => Math.ceil(textWidth(text, TYPE_SMALL, false, 0, true) + 8);
  const entryRoom = Math.max(0, ...drawn.map((route) => (route.entry.length === 0 ? 0 : route.entry.reduce((sum, text) => sum + tagW(text) + 3, 0) + 12)));
  const dotX = r1(FLOW_PAD + termW + 2 * FLOW_TOKEN_PAD_X + 8 + FLOW_DOT_R);
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
  colX[0] = r1(dotX + FLOW_DOT_R + 16 + entryRoom + fan + 12 + channel(dropsLeft(0)));
  for (let c = 1; c < columns; c++) colX[c] = r1(colX[c - 1]! + colW[c - 1]! + gapW(c - 1));
  const last = columns - 1;
  const trailing = 14 + channel(dropsRight(last)) + inGap(last, "bracket").length * FLOW_TRACK + 24;

  // Rows and the rails at the foot.
  const mass = model.unowned !== undefined && model.unowned.files > 0;
  const massRow = Math.max(0, ...inColumn(0).map((node) => node.row + node.span));
  const rows = Math.max(1, ...placed.map((node) => node.row + node.span), mass ? massRow + 1 : 0);
  const railTop = FLOW_TOP + rows * FLOW_ROW_H + 12;
  const railLabels = model.coreDependencies.map((core) => textWidth(railForms(byFolder.get(core.folder)!.name, core.callers.length, model.nodes.length - 1)[0]!, TYPE_SMALL, false));
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
    // The route starts at the right edge of its origin token, as the lettered dots did: the line leaves the name itself.
    const terminus: Point = [r1(dotX - FLOW_DOT_R - 6), group.dot];
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
    return { route, color, path: dedupe(path), terminus, segments, entry: { a: terminus, b: [r1(bend - dy), terminus[1]] as Point } };
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

  // 1. Station names, roles, and folders, inside their boxes, which were sized to hold them.
  for (const node of model.nodes) {
    const station = stations.get(node.folder);
    if (station === undefined) continue;
    const within = `${node.id}-box`;
    const x = station.x + 12;
    tryPlace([{ text: flowName(node), x, y: r1(station.seat.y - 17), size: TYPE_NAME, bold: true, align: "start", within }], `name ${node.folder}`, 1, "flow-station-name", false);
    roleLines(node.intent, station.w - 24).forEach((line, i) => {
      tryPlace([{ text: line, x, y: r1(station.seat.y - 3 + i * 13), size: TYPE_SMALL, bold: false, align: "start", within }], `role ${node.folder} ${i}`, 3, "flow-station-role", false);
    });
    tryPlace([{ text: folderText(node), x, y: r1(station.seat.y + 24), size: TYPE_SMALL, bold: false, align: "start", within, mono: true }], `folder ${node.folder}`, 4, "flow-station-folder flow-mono", false);
  }
  if (massBox !== undefined && model.unowned !== undefined) {
    tryPlace([{ text: "No component", x: massBox.x + 10, y: massBox.y + 15, size: TYPE_NAME, bold: true, align: "start", within: "structure--mass-box" }], "mass name", 1, "flow-station-name", false);
    tryPlace([{ text: `${plural(model.unowned.files, "file", "files")}, ${plural(model.unowned.lines, "line", "lines")}`, x: massBox.x + 10, y: massBox.y + 29, size: TYPE_SMALL, bold: false, align: "start", within: "structure--mass-box" }], "mass size", 4, "flow-station-folder", false);
  }
  // 2. Named origins, one line each, set to end at the terminus dot: at most four names and a count of the rest.
  for (const block of blocks.values()) {
    for (const group of block.groups) {
      group.lines.forEach((line, j) => {
        const quiet = (group.route.derived && j === group.lines.length - 1) || (!group.route.derived && group.route.names.length > group.lines.length && j === group.lines.length - 1);
        tryPlace([{ text: line, x: dotX - FLOW_DOT_R - 6 - FLOW_TOKEN_PAD_X, y: r1(group.y0 + (j + 1) * FLOW_NAME_LINE - 3), size: FLOW_NAME_SIZE, bold: !quiet, align: "end" }], `origin ${group.route.id} ${j}`, 2, quiet ? "flow-origin-more" : "flow-origin", false);
      });
    }
  }
  // 2. Rail labels, once each.
  for (const rail of rails) {
    const node = byFolder.get(rail.folder)!;
    const callers = model.coreDependencies[rail.index]!.callers.length;
    // Along the rail, at its start first, else wherever no stub runs through it; never dropped while a shorter form fits.
    const forms = railForms(node.name, callers, model.nodes.length - 1);
    const starts = [rail.x0, ...Array.from({ length: Math.max(0, Math.floor((rail.x1 - rail.x0) / 40)) }, (_, i) => rail.x0 + 40 * (i + 1))];
    tryPlace(forms.flatMap((text) => starts.map((x) => ({ text, x, y: rail.y - 8, size: TYPE_SMALL, bold: false, align: "start" as const }))), `rail ${rail.folder}`, 2, "flow-rail-label", true);
  }

  // 3. Tokens: a padded box around one line of text. A token never overlaps text, another token, or a station.
  const tags: FlowTagDraw[] = [];
  const TAG_H = 14;
  const fits = (box: FlowBox): boolean => inCanvas(box) && !placedText.some((other) => intersects(box, other)) && !obstacles.some((other) => intersects(box, other, 0));
  const tokenText = (key: string, text: string, box: FlowBox, mono: boolean, cls: string): void => {
    // Mono text is set regular: the page embeds Plex Mono's regular weight only.
    texts.push({ key, text, x: r1(box.x + box.w / 2), y: r1(box.y + box.h / 2 + 3.9), size: TYPE_SMALL, bold: !mono, align: "middle", cls, priority: 5, ...(mono ? { mono: true } : {}) });
  };

  // 3. A component's broken mark, attached to its box: it selects its broken chokepoints and their bypass sites.
  const attached = (station: FlowStation, w: number, h: number): FlowBox[] => [
    { x: r1(station.x + station.w - 1), y: r1(station.y + 3), w, h },
    { x: r1(station.x + station.w - 8 - w), y: r1(station.y - h + 1), w, h },
    { x: r1(station.x + 8), y: r1(station.y - h + 1), w, h },
    { x: r1(station.x + station.w - 8 - w), y: r1(station.y + station.h - 1), w, h },
    { x: r1(station.x + 8), y: r1(station.y + station.h - 1), w, h },
    { x: r1(station.x + station.w / 2 - w / 2), y: r1(station.y - h + 1), w, h },
    { x: r1(station.x + station.w / 2 - w / 2), y: r1(station.y + station.h - 1), w, h },
  ];
  // A token attached to a box overlaps its border by one pixel, so the station itself is not an obstacle to it.
  const fitsAttached = (box: FlowBox, own: FlowStation): boolean => inCanvas(box) && !placedText.some((other) => intersects(box, other)) && !obstacles.some((other) => !(other.x === own.x && other.y === own.y) && intersects(box, other, 0));
  for (const node of model.nodes) {
    const station = stations.get(node.folder);
    if (station === undefined || node.defects.length === 0) continue;
    const text = `✕ ${node.defects.length} broken`;
    const w = Math.ceil(textWidth(text, TYPE_SMALL, true) + 10);
    const box = attached(station, w, TAG_H + 2).find((candidate) => fitsAttached(candidate, station));
    if (box === undefined) {
      dropped.push(`broken ${node.folder}`);
      continue;
    }
    placedText.push(box);
    tags.push({ text, kind: "broken", state: "broken", route: undefined, node: node.folder, chokepoint: undefined, name: node.defects.map((d) => d.name).join(", "), edge: undefined, rail: undefined, edges: [], broken: true, box, boundary: undefined });
    tokenText(`mark broken ${node.folder}`, text, box, false, "flow-tag-text");
  }

  // 4. The caption: how the routes were followed.
  const root = byFolder.get(".");
  const entranceCount = model.entrances.filter((e) => e.reachable).length;
  const captions =
    model.routesFrom === "root interfaces"
      ? [`${plural(model.routes.length, "structural route", "structural routes")} by reference weight from ${root === undefined ? "the root component" : root.name}'s interfaces, not flow: no entrance is declared`, `${plural(model.routes.length, "structural route", "structural routes")} by reference weight: no entrance is declared`]
      : model.routesFrom === "entrances"
        ? [`${plural(model.routes.length, "structural route", "structural routes")} from ${plural(entranceCount, "entrance", "entrances")}`]
        : ["No entrance is declared and there is no root component: no structural route is drawn"];
  tryPlace(captions.map((text) => ({ text, x: FLOW_PAD, y: 22, size: TYPE_LABEL, bold: false, align: "start" as const })), "caption", 3, "flow-caption");

  // 4. A component's boundary mark, on its box's edge: the crossings standing inside it, on no interface or entrance line.
  for (const node of model.nodes) {
    const station = stations.get(node.folder);
    if (station === undefined || node.boundary.length === 0) continue;
    const text = plural(node.boundary.length, "crossing", "crossings");
    const w = Math.ceil(textWidth(text, TYPE_SMALL, true) + 10);
    const order = attached(station, w, TAG_H);
    const box = [order[4]!, order[3]!, order[6]!, order[2]!, order[1]!, order[5]!, order[0]!].find((candidate) => fitsAttached(candidate, station));
    if (box === undefined) {
      dropped.push(`boundary ${node.folder}`);
      continue;
    }
    placedText.push(box);
    // The boundary runs along the edge the mark sits on: the box's own border, dashed red, a trust boundary on the component.
    const side = box.x >= station.x + station.w - 1 ? "right" : box.y < station.y ? "top" : "bottom";
    const edgeY = side === "top" ? station.y : r1(station.y + station.h);
    const boundary = side === "right"
      ? { x1: r1(station.x + station.w), y1: r1(box.y - 5), x2: r1(station.x + station.w), y2: r1(box.y + box.h + 5) }
      : { x1: r1(box.x - 6), y1: edgeY, x2: r1(box.x + box.w + 6), y2: edgeY };
    tags.push({ text, kind: "boundary", state: worstState(node.boundary.map((c) => c.verdict.state)) ?? "requirement", route: undefined, node: node.folder, chokepoint: undefined, name: `${plural(node.boundary.length, "crossing", "crossings")} inside ${node.name}`, edge: undefined, rail: undefined, edges: [], broken: false, box, boundary });
    tokenText(`mark boundary ${node.folder}`, text, box, false, "flow-tag-text");
  }

  // 5. Interface identifiers: one button each, on the pipe where it stands, on the entrance line where work enters through
  // it, and a core dependency's once, on its rail. Each is drawn in its invariant's state.
  const identifierOf = (text: string): { chokepoint: string; name: string; crossing: boolean; state: FlowState } => {
    const found = model.identifiers.find((identifier) => identifier.text === text)!;
    return { chokepoint: found.chokepoint, name: found.name, crossing: found.crossing !== undefined, state: found.verdict.state };
  };
  const boundaryOf = (box: FlowBox, vertical: boolean): FlowTagDraw["boundary"] => {
    const mid: Point = [box.x + box.w / 2, box.y + box.h / 2];
    return vertical ? { x1: r1(box.x - 5), y1: r1(mid[1]), x2: r1(box.x + box.w + 5), y2: r1(mid[1]) } : { x1: r1(mid[0]), y1: r1(box.y - 9), x2: r1(mid[0]), y2: r1(box.y + box.h + 9) };
  };
  for (const draw of routes) {
    if (draw.route.entry.length === 0) continue;
    const widths = draw.route.entry.map(tagW);
    const total = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 3;
    const { a, b } = draw.entry;
    let placedEntry = false;
    for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const cx = r1(a[0] + (b[0] - a[0]) * t);
      let x = cx - total / 2;
      const boxes = widths.map((w) => {
        const box: FlowBox = { x: r1(x), y: r1(a[1] - TAG_H / 2), w, h: TAG_H };
        x += w + 3;
        return box;
      });
      if (boxes[0]!.x < a[0] + 2 || boxes[boxes.length - 1]!.x + boxes[boxes.length - 1]!.w > b[0] - 2 || !boxes.every(fits)) continue;
      draw.route.entry.forEach((text, i) => {
        const box = boxes[i]!;
        placedText.push(box);
        const found = identifierOf(text);
        tags.push({ text, kind: "identifier", state: found.state, route: draw.route.id, node: undefined, chokepoint: found.chokepoint, name: found.name, edge: undefined, rail: undefined, edges: [], broken: found.state === "broken", box, boundary: found.crossing ? boundaryOf(box, false) : undefined });
        tokenText(`tag entry ${draw.route.id} ${text}`, text, box, true, "flow-tag-text");
      });
      placedEntry = true;
      break;
    }
    if (!placedEntry) dropped.push(`tag entry ${draw.route.id}`);
  }
  const identified = model.edges.filter((edge) => !edge.stub && (edge.identifiers.length > 0 || edge.bypasses.length > 0)).sort((a, b) => b.bypasses.length - a.bypasses.length || b.identifiers.length - a.identifiers.length || a.id.localeCompare(b.id));
  for (const edge of identified) {
    const legs: { a: Point; b: Point }[] = [];
    const onRoute = routes.find((draw) => draw.segments.has(edge.id));
    if (onRoute !== undefined) legs.push(...[...onRoute.segments.get(edge.id)!.legs].reverse());
    const line = lines.find((candidate) => candidate.edge.id === edge.id);
    if (line !== undefined) legs.push(...[...line.line.legs].reverse());
    const broken = edge.bypasses.length > 0;
    const marks = edge.bypasses.length > 0 ? [`✕${edge.bypasses.length}`] : [];
    const width = (text: string): number => (text.startsWith("✕") || text.startsWith("+") ? Math.ceil(textWidth(text, TYPE_SMALL, true) + 8) : tagW(text));
    // All identifiers side by side; when they do not fit, the first and a count that selects the interface.
    const rows = [[...edge.identifiers, ...marks], ...(edge.identifiers.length > 1 ? [[edge.identifiers[0]!, `+${edge.identifiers.length - 1}`, ...marks]] : [])];
    let done = false;
    for (const row of rows) {
      const widths = row.map(width);
      const total = widths.reduce((a, b) => a + b, 0) + (row.length - 1) * 3;
      for (const leg of legs) {
        const length = Math.hypot(leg.b[0] - leg.a[0], leg.b[1] - leg.a[1]);
        if (length < 6) continue;
        const vertical = Math.abs(leg.a[0] - leg.b[0]) < 0.05;
        for (const t of [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6, 0.22, 0.78, 0.08, 0.92]) {
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
            const state: FlowTagDraw["state"] = found?.state ?? "mark";
            tags.push({ text, kind, state, route: undefined, node: undefined, chokepoint: found?.chokepoint, name: found?.name ?? "", edge, rail: undefined, edges: [edge.id], broken, box, boundary: found?.crossing === true ? boundaryOf(box, vertical) : undefined });
            tokenText(`tag ${edge.id} ${text}`, text, box, kind === "identifier", "flow-tag-text");
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
      tags.push({
        text,
        kind: "identifier",
        state: found.state,
        route: undefined,
        node: undefined,
        chokepoint: found.chokepoint,
        name: found.name,
        edge: undefined,
        rail: core.folder,
        edges: stubEdges.filter((edge) => edge.identifiers.includes(text)).map((edge) => edge.id),
        broken: stubEdges.some((edge) => edge.identifiers.includes(text) && edge.bypasses.length > 0),
        box,
        boundary: found.crossing ? boundaryOf(box, false) : undefined,
      });
      tokenText(`tag rail ${core.folder} ${text}`, text, box, true, "flow-tag-text");
    }
    // A core dependency's own marks stand on its rail: its broken chokepoints, and the crossings inside it.
    const railNode = byFolder.get(core.folder)!;
    const marks: { kind: "broken" | "boundary"; text: string }[] = [
      ...(railNode.defects.length > 0 ? [{ kind: "broken" as const, text: `✕ ${railNode.defects.length} broken` }] : []),
      ...(railNode.boundary.length > 0 ? [{ kind: "boundary" as const, text: plural(railNode.boundary.length, "crossing", "crossings") }] : []),
    ];
    for (const mark of marks) {
      const w = Math.ceil(textWidth(mark.text, TYPE_SMALL, true) + 10);
      let box: FlowBox | undefined;
      for (let tries = 0; tries < 120 && box === undefined; tries++, x += 12) {
        const candidate: FlowBox = { x: r1(x), y: r1(rail.y - TAG_H / 2), w, h: TAG_H };
        if (candidate.x + candidate.w > rail.x1) break;
        const drop = stubs.some((stub) => stub.points.some((p) => p[0] >= candidate.x - 4 && p[0] <= candidate.x + candidate.w + 4 && p[1] >= rail.y - 20));
        if (fits(candidate) && !drop) box = candidate;
      }
      if (box === undefined) {
        dropped.push(`${mark.kind} ${core.folder}`);
        continue;
      }
      placedText.push(box);
      x = box.x + box.w + 6;
      tags.push({
        text: mark.text,
        kind: mark.kind,
        state: mark.kind === "broken" ? "broken" : worstState(railNode.boundary.map((c) => c.verdict.state)) ?? "requirement",
        route: undefined,
        node: core.folder,
        chokepoint: undefined,
        name: mark.kind === "broken" ? railNode.defects.map((d) => d.name).join(", ") : `${plural(railNode.boundary.length, "crossing", "crossings")} inside ${railNode.name}`,
        edge: undefined,
        rail: undefined,
        edges: [],
        broken: mark.kind === "broken",
        box,
        boundary: mark.kind === "boundary" ? boundaryOf(box, false) : undefined,
      });
      tokenText(`mark ${mark.kind} ${core.folder}`, mark.text, box, false, "flow-tag-text");
    }
  }

  // 7. Proposals from a scaffold preview, named beside their station.
  previews.forEach((preview, index) => {
    const station = stations.get(preview.component) ?? [...stations.values()][0];
    if (station === undefined) return;
    const text = `proposed preview · ${preview.name}`;
    tryPlace([
      { text, x: station.x + station.w + 14 + index * 8, y: r1(station.y + 10 + index * 12), size: TYPE_SMALL, bold: true, align: "start" },
      { text, x: station.x, y: r1(station.y - 4 - index * 12), size: TYPE_SMALL, bold: true, align: "start" },
      { text, x: station.x, y: r1(station.y + station.h + 12 + index * 12), size: TYPE_SMALL, bold: true, align: "start" },
    ], `proposal ${index}`, 6, "structure-proposed-word");
  });
  // 8. Column captions.
  for (let c = 0; c < columns; c++) {
    const text = c === 0 ? "Where work enters" : `${plural(c, "interface", "interfaces")} in`;
    tryPlace([{ text, x: colX[c]!, y: 44, size: TYPE_SMALL, bold: false, align: "start" }], `column ${c}`, 7, "flow-colcap");
  }

  return { width, height, stations, rails, routes, lines, stubs, tags, texts, dropped, mass: massBox };
}

/* --------------------------------------------------------------- render */

function flowLit(selection: FlowSelection, lit: boolean): string {
  if (selection.kind === "none" || selection.kind === "change") return "";
  return lit ? "is-lit" : "is-dim";
}

/** The colored token behind a route's named origin: one rounded rectangle around all its lines, in the route's color. */
function originToken(lines: FlowText[], color: string): Markup {
  if (lines.length === 0) return html``;
  const boxes = lines.map(textBox);
  const x0 = Math.min(...boxes.map((b) => b.x)) - FLOW_TOKEN_PAD_X;
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + FLOW_TOKEN_PAD_X;
  const y0 = Math.min(...boxes.map((b) => b.y)) - FLOW_TOKEN_PAD_Y;
  const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + FLOW_TOKEN_PAD_Y;
  return html`<rect class="flow-origin-token" x="${r1(x0)}" y="${r1(y0)}" width="${r1(x1 - x0)}" height="${r1(y1 - y0)}" rx="5" fill="${color}"/>`;
}

function renderText(t: FlowText): Markup {
  // Every text is set from its left edge: middle and end alignment are resolved here from the embedded metrics.
  const box = textBox(t);
  return html`<text class="${t.cls}" x="${r1(box.x)}" y="${t.y}" font-size="${t.size}"${t.bold ? raw(` font-weight="${FLOW_WEIGHT}"`) : null}${t.within === undefined ? null : raw(` data-within="${t.within}"`)}>${t.text}</text>`;
}

/** A component's verdicts in words, for its title and accessible name. */
function stateWords(node: FlowNode): string {
  if (node.invariants.length === 0) return "declares no invariant";
  const count = (state: FlowState): number => node.invariants.filter((i) => i.verdict.state === state).length;
  return [count("verified") > 0 ? `${count("verified")} verified` : "", count("requirement") > 0 ? plural(count("requirement"), "requirement", "requirements") : "", count("broken") > 0 ? `${count("broken")} broken` : ""].filter(Boolean).join(", ");
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
  const own = texts.filter((t) => t.key === `name ${node.folder}` || t.key.startsWith(`role ${node.folder} `) || t.key === `folder ${node.folder}`);
  const state = node.state;
  return html`<g class="${classes}" id="${node.id}" data-folder="${node.folder}" data-row="${String(node.row)}" data-column="${String(node.column)}" data-seat="${`${station.seat.x} ${station.seat.y}`}" data-state="${state ?? "none"}" data-structure-select="${node.id}" role="button" tabindex="0" aria-pressed="${selected === node.id ? "true" : "false"}" aria-label="${flowName(node)}, ${node.folder}: ${node.intent} ${stateWords(node)}; calls ${node.out}, called by ${node.in}${routes.length === 0 ? "" : `, on routes ${routes.join("; ")}`}">
    <title>${flowName(node)} · ${node.folder} · ${node.intent} · ${stateWords(node)} · calls ${node.out} · called by ${node.in}${routes.length === 0 ? "" : ` · routes: ${routes.join("; ")}`}</title>
    <rect class="flow-box" id="${node.id}-box" x="${station.x}" y="${station.y}" width="${station.w}" height="${station.h}" rx="7"/>
    ${state === undefined ? null : html`<rect class="flow-state-bar flow-state-${state}" data-state-bar="${state}" x="${r1(station.x + 3.5)}" y="${r1(station.y + 6)}" width="4" height="${r1(station.h - 12)}" rx="2"/>`}
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
    // An identifier lights exactly when the selection names its chokepoint; a component's mark when it names the component.
    const lit = tag.kind === "identifier"
      ? selection.chokepoints.has(tag.chokepoint!)
      : tag.kind === "broken" || tag.kind === "boundary"
        ? selection.marks.has(tag.node!)
        : tag.edges.some((id) => selection.edges.has(id));
    const quiet = selection.kind === "route" || selection.kind === "entrance" || selection.kind === "component";
    // A component's mark on a lit component stays: it belongs to what the story passes.
    const onLit = tag.node !== undefined && selection.nodes.has(tag.node);
    return [
      "flow-tag",
      `flow-tag-${tag.state === "mark" ? "mark" : tag.state}`,
      tag.kind === "broken" ? "flow-tag-broken-mark" : tag.kind === "boundary" ? "flow-tag-boundary" : "",
      active && lit && !quiet ? "is-lit" : active && !lit && !onLit ? "is-dim" : "",
      (tag.chokepoint !== undefined && tag.chokepoint === selected) || (tag.kind === "broken" && selected === flowBrokenId(tag.node!)) || (tag.kind === "boundary" && selected === flowBoundaryId(tag.node!)) ? "is-selected" : "",
    ].filter(Boolean).join(" ");
  };
  return html`<svg class="flow-svg" xmlns="http://www.w3.org/2000/svg" role="group" aria-labelledby="flow-svg-title" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" style="${`min-width: ${layout.width}px`}" data-selected="${selection.id ?? ""}" data-dropped="${layout.dropped.join("|")}">
    <title id="flow-svg-title">Structure: ${plural(model.routes.length, "structural route", "structural routes")} through ${plural(model.nodes.length, "component", "components")}, ${plural(model.coreDependencies.length, "core dependency", "core dependencies")} drawn as rails</title>
    <style>${raw(FLOW_SVG_STYLE)}${raw(routeVars())}</style>
    <defs>
      <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-quiet)"/></marker>
      <pattern id="flow-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="3" fill="var(--flow-node)"/><rect width="1.4" height="3" fill="var(--flow-verified)"/></pattern>
    </defs>
    <rect class="flow-surface" x="0" y="0" width="${layout.width}" height="${layout.height}" rx="12"/>
    ${texts("caption").map(renderText)}
    ${texts("column").map(renderText)}
    ${layout.rails.map((rail) => {
      const node = byFolder.get(rail.folder)!;
      return html`<g class="flow-rail ${flowLit(selection, selection.nodes.has(rail.folder))}${selected === node.id ? " is-selected" : ""}" id="${node.id}" data-folder="${rail.folder}" data-core="true" data-state="${node.state ?? "none"}" data-structure-select="${node.id}" role="button" tabindex="0" aria-pressed="${selected === node.id ? "true" : "false"}" aria-label="${node.name}, core dependency, called by ${model.coreDependencies[rail.index]!.callers.length} components; ${stateWords(node)}">
        <title>${node.name} · ${node.folder} · ${node.intent} · ${stateWords(node)} · core dependency: ${CORE_RULE}</title>
        <line class="flow-line flow-rail-line" data-line="${`rail ${rail.folder}`}" x1="${rail.x0}" y1="${rail.y}" x2="${rail.x1}" y2="${rail.y}" stroke="var(--flow-rail-${rail.index % FLOW_RAIL_COLORS.length})"/>
        ${texts(`rail ${rail.folder}`).map(renderText)}
      </g>`;
    })}
    ${layout.stubs.map((stub) => html`<g class="flow-stub-group ${flowLit(selection, selection.edges.has(stub.edge.id))}" data-stub="${stub.edge.id}" data-from="${stub.edge.from}" data-to="${stub.edge.to}"><path class="flow-line flow-stub" data-line="${`stub ${stub.edge.id}`}" d="${pathD(stub.points)}" stroke="var(--flow-rail-${stub.rail % FLOW_RAIL_COLORS.length})"/>${stub.joints.map(([x, y]) => html`<circle class="flow-joint" cx="${x}" cy="${y}" r="2.6" fill="var(--flow-rail-${stub.rail % FLOW_RAIL_COLORS.length})"/>`)}</g>`)}
    ${layout.lines.map((draw) => html`<g class="flow-interface ${flowLit(selection, selection.edges.has(draw.edge.id))}" id="${draw.edge.id}" data-from="${draw.edge.from}" data-to="${draw.edge.to}" data-drawn="${draw.kind}" data-structure-select="${draw.edge.id}" role="button" tabindex="0" aria-label="${draw.edge.from} to ${draw.edge.to}, on no structural route"><title>${draw.edge.from} → ${draw.edge.to}: on no structural route</title><path class="flow-line ${draw.kind === "faint" ? "flow-faint" : "flow-bearing-line"}${draw.edge.bypasses.length > 0 ? " flow-broken-line" : ""}${selection.edges.has(draw.edge.id) ? " is-lit" : ""}" data-line="${draw.edge.id}" data-edge="${draw.edge.id}" d="${pathD(draw.line.points)}" marker-end="url(#flow-arrow)"/></g>`)}
    ${layout.routes.map((draw) => html`<g class="flow-route-group ${routeClass(draw.route)}" id="${draw.route.id}" data-names="${draw.route.names.join(", ")}" data-derived="${draw.route.derived ? "true" : "false"}" data-stops="${draw.route.stops.join(" ")}" data-edges="${draw.route.edges.join(" ")}"${draw.route.rail === undefined ? null : raw(` data-rail="${draw.route.rail}"`)} data-trust="${draw.route.trust.join(" ")}" data-structure-select="${draw.route.id}" role="button" tabindex="0" aria-pressed="${selection.id === draw.route.id ? "true" : "false"}" aria-label="${routeName(draw.route)}: ${draw.route.stops.map((stop) => flowName(byFolder.get(stop)!)).join(", ")}">
      <title>${routeName(draw.route)}: ${draw.route.stops.map((stop) => flowName(byFolder.get(stop)!)).join(" → ")}${draw.route.rail === undefined ? "" : ` → ${byFolder.get(draw.route.rail)!.name} (rail)`}</title>
      <path class="flow-line flow-route" data-line="${draw.route.id}" d="${pathD(draw.path)}" stroke="${draw.color}"/>
      <g class="flow-terminus${draw.route.derived ? " flow-derived" : ""}">${originToken(texts(`origin ${draw.route.id} `), draw.color)}${texts(`origin ${draw.route.id} `).map(renderText)}</g>
    </g>`)}
    ${[...layout.stations.entries()].map(([folder, station]) => renderStation(byFolder.get(folder)!, station, layout.texts, selection, selected, model))}
    ${layout.tags.map((tag) => {
      const where = tag.rail !== undefined ? raw(` data-rail="${tag.rail}"`) : tag.route !== undefined ? raw(` data-entry="${tag.route}"`) : tag.node !== undefined ? raw(` data-node="${tag.node}"`) : raw(` data-edge="${tag.edge!.id}"`);
      const on = tag.rail !== undefined ? `the ${byFolder.get(tag.rail)!.name} rail` : tag.route !== undefined ? `the entrance line of ${routeName(model.routes.find((r) => r.id === tag.route)!)}` : tag.node !== undefined ? byFolder.get(tag.node)!.name : `${tag.edge!.from} to ${tag.edge!.to}`;
      const verdict = tag.chokepoint === undefined ? undefined : model.identifiers.find((i) => i.chokepoint === tag.chokepoint)?.verdict.label;
      const what = tag.kind === "identifier"
        ? raw(` data-identifier="${tag.text}" data-state="${tag.state}"${tag.rail !== undefined ? ` data-edges="${tag.edges.join(" ")}"` : ""} data-structure-select="${tag.chokepoint}" role="button" tabindex="0" aria-label="${tag.text}: ${tag.name.replace(/"/g, "&quot;")}, ${verdict ?? ""}"`)
        : tag.kind === "broken"
          ? raw(` data-mark="broken" data-state="broken" data-structure-select="${flowBrokenId(tag.node!)}" role="button" tabindex="0" aria-label="${tag.text} in ${on}: ${tag.name.replace(/"/g, "&quot;")}"`)
          : tag.kind === "boundary"
            ? raw(` data-mark="boundary" data-state="${tag.state}" data-structure-select="${flowBoundaryId(tag.node!)}" role="button" tabindex="0" aria-label="${tag.name.replace(/"/g, "&quot;")}"`)
            : raw(` data-mark="${tag.kind}" data-structure-select="${tag.edge!.id}" role="button" tabindex="0" aria-label="${tag.kind === "bypass" ? `${plural(tag.edge!.bypasses.length, "bypass", "bypasses")}` : `${tag.edge!.identifiers.length - 1} more interface identifiers`} on ${on}"`);
      const key = tag.kind === "broken" ? `mark broken ${tag.node}` : tag.kind === "boundary" ? `mark boundary ${tag.node}` : tag.rail !== undefined ? `tag rail ${tag.rail} ${tag.text}` : tag.route !== undefined ? `tag entry ${tag.route} ${tag.text}` : `tag ${tag.edge!.id} ${tag.text}`;
      const title = tag.kind === "identifier" ? `${tag.text}: ${tag.name}, ${verdict ?? ""} · on ${on}` : tag.kind === "bypass" ? `broken: ${plural(tag.edge!.bypasses.length, "bypass", "bypasses")} on ${on}` : tag.kind === "broken" ? `${on}: broken chokepoints ${tag.name}` : tag.kind === "boundary" ? `${tag.name}: trust boundaries on no drawn interface` : `${tag.edge!.identifiers.join(", ")} on ${on}`;
      return html`<g class="${tagClass(tag)}"${where}${what}>
        <title>${title}</title>
        ${tag.boundary === undefined ? null : html`<line class="flow-boundary" x1="${tag.boundary.x1}" y1="${tag.boundary.y1}" x2="${tag.boundary.x2}" y2="${tag.boundary.y2}"/>`}
        <rect x="${tag.box.x}" y="${tag.box.y}" width="${tag.box.w}" height="${tag.box.h}" rx="3"/>
        ${layout.texts.filter((t) => t.key === key).map((t) => renderText({ ...t, cls: `${t.cls}${t.mono === true ? " flow-mono" : ""}` }))}
      </g>`;
    })}
    ${layout.mass === undefined ? null : html`<g class="flow-mass" data-mass="unowned"><rect id="structure--mass-box" x="${layout.mass.x}" y="${layout.mass.y}" width="${layout.mass.w}" height="${layout.mass.h}" rx="7"/>${texts("mass").map(renderText)}</g>`}
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

/*
 * The inspector reads like a product sidebar, not a page: what kind of thing
 * is selected, its name, one line saying what it is, then rows of labelled
 * facts and lists of rows to select next. One verdict per invariant, dated;
 * what an agent needs (test commands, per-enforcement records, the two
 * options) folds beneath it, closed. Monospace only for code identifiers and
 * paths; counts in tabular numerals; long explanations fold.
 */

/** Terms the map uses that the glossary does not define: defined here, in the key, and on hover where they appear. */
const LOCAL_TERMS: Record<string, string> = {
  bypass: "a reference to a chokepoint's protected thing from outside the chokepoint: one is enough to break it",
  derived: "a route drawn by reference weight from the root component's interfaces because no entrance is declared: not the path work takes",
  "reference weight": "how many reference sites a component interface carries: what a derived route follows, which is not flow",
};

/** A term linked to its glossary definition (its title carries the definition), or defined in place when the glossary has none. */
function termLink(state: ShellState, name: string, text: string = name): Markup {
  const layer = state.glossary.layers.find((l) => l.kind === "present" && l.id === "coherence");
  const concept = layer?.kind === "present" ? layer.glossary.concepts.find((c) => c.name === name) : undefined;
  if (concept !== undefined) return html`<a class="flow-term" href="#coherence-${slug(name)}" title="${concept.definition}">${text}</a>`;
  return html`<dfn class="flow-term" title="${LOCAL_TERMS[name] ?? name}">${text}</dfn>`;
}

function flowPick(id: string, text: string | Markup, elementId?: string): Markup {
  return html`<button type="button" class="flow-pick" data-structure-select="${id}"${elementId === undefined ? null : raw(` id="${elementId}"`)}>${text}</button>`;
}

/** One selectable row: an optional lead (a route swatch), the pick, and its meta, a count at the right or a line below. */
function flowRow(pick: Markup, meta: Markup | string | null = null, kind: "count" | "line" = "line", lead: Markup | null = null): Markup {
  return html`<li class="flow-row${kind === "count" ? " flow-row-count" : ""}">${lead}${pick}${meta === null || meta === "" ? null : html`<span class="flow-meta">${meta}</span>`}</li>`;
}

/** Labelled facts: a label and its value per row. */
function flowFacts(rows: readonly (readonly [string | Markup, Markup | string] | null)[]): Markup {
  const shown = rows.filter((row): row is readonly [string | Markup, Markup | string] => row !== null);
  return shown.length === 0 ? html`` : html`<dl class="flow-facts">${shown.map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}</dl>`;
}

/** A code identifier or path in monospace; prose (anything with a space) stays in the text face. */
function codeOrText(value: string): Markup {
  return /\s/.test(value.trim()) ? html`${value}` : html`<code>${value}</code>`;
}

/** The start of an inspector: what kind of thing, its name, and a one-line summary. */
function flowHead(kind: Markup | string, heading: Markup, id?: string, summary: Markup | string | null = null): Markup {
  return html`<p class="flow-kind">${kind}</p>
    <h3${id === undefined ? null : raw(` id="${id}"`)}>${heading}</h3>
    ${summary === null || summary === "" ? null : html`<p class="flow-sub">${summary}</p>`}`;
}

/** An invariant's one verdict, drawn as the map draws it: a swatch in its state and the verdict in words, dated. */
function verdictMark(ref: Pick<FlowInvariantRef, "verdict">): Markup {
  return html`<span class="flow-verdict" data-verdict-state="${ref.verdict.state}"><span class="flow-verdict-swatch" aria-hidden="true"></span>${ref.verdict.label}</span>`;
}

/** One invariant as a row: its name (selecting its chokepoint when it has one, else linking its card) and its one verdict. */
function invariantRow(model: FlowModel, ref: FlowInvariantRef, where = false): Markup {
  const chokepoint = model.chokepoints.find((c) => c.component === ref.component && c.name === ref.name);
  const identifier = chokepoint === undefined ? undefined : model.identifiers.find((i) => i.chokepoint === chokepoint.id);
  const pick = chokepoint === undefined ? html`<a class="flow-pick" href="#${invariantId(ref.component, ref.name)}">${ref.name}</a>` : flowPick(chokepoint.id, ref.name);
  const lead = identifier === undefined ? null : html`<span class="flow-ident" data-verdict-state="${ref.verdict.state}">${identifier.text}</span>`;
  return html`<li class="flow-row" data-invariant="${ref.name}" data-verdict-state="${ref.verdict.state}">${lead}${pick}<span class="flow-meta">${verdictMark(ref)}${where ? html` · ${ref.component === "." ? "the root" : ref.component}` : null}</span></li>`;
}

function flowSite(site: RelianceSite): Markup {
  const role = site.target === "protected" && site.siteClass === "bypass"
    ? "protected thing · bypass (not a legal chokepoint reference)"
    : site.target === "chokepoint" && site.siteClass === "chokepoint-reference"
      ? "chokepoint · reference (runtime call not established)"
      : site.siteClass === "inside"
        ? `${site.target === "protected" ? "protected thing" : "chokepoint"} · inside chokepoint`
        : `${site.target === "protected" ? "protected thing" : "chokepoint"} · ${site.siteClass}`;
  return html`<li data-class="${site.siteClass}" data-target="${site.target}" data-test="${site.test ? "true" : "false"}" data-owner="${site.owner ? "true" : "false"}"><code>${site.file}:${site.line}</code> in <code>${site.symbol}</code> <span class="flow-meta">${site.component?.folder ?? "outside declared components"}</span> <span class="site-role">${role}</span>${site.form === undefined ? null : html` <span class="label">${site.form}</span>`}${site.owner ? html` <span class="label">owner</span>` : null}${site.test ? html` <span class="label">test</span>` : null}</li>`;
}

/** The two honest options for a broken chokepoint: advice for the agent that repairs it, folded. */
function renderFlowOptions(component: string, name: string, chokepoints: readonly string[]): Markup {
  return html`<details class="flow-more flow-agent"><summary>What an agent does next</summary><h5>The two options</h5><ol class="options" data-field="options">
    <li data-option="route"><strong>Route through the chokepoint.</strong> Move each bypass inside ${join(chokepoints.map((c, i) => html`<code>${c}</code>${i < chokepoints.length - 1 ? ", " : ""}`))} so the protected thing is reached through it and nowhere else; the next run turns the verdict green.</li>
    <li data-option="retire"><strong>Escalate a retirement.</strong> Record the decision with preservation as the rejected alternative, <code>escalate</code> it, and let a human <code>acknowledge</code> with the reliance of <a href="#${invariantId(component, name)}">${name}</a> in view. The invariant stands, and alarms, until then.</li>
  </ol></details>`;
}

/** The evidence the map stands on, in one line. */
function renderEvidence(model: FlowModel): Markup {
  return html`<p class="flow-evidence" data-field="evidence">Evidence: ${model.evidence === "language adapter"
    ? `resolved references from the ${model.language} language adapter, declared entrances, and invariants`
    : html`the references the latest runs recorded to chokepoints and protected things, declared entrances, and invariants; plain component interfaces are unknown (${model.unread})`}. Observed runtime behavior is not shown.</p>`;
}

function routeSwatch(route: FlowRoute): Markup {
  const slot = route.slot === undefined ? "var(--flow-key-neutral)" : `var(--flow-key-route-${route.slot})`;
  return html`<span class="flow-swatch${route.derived ? " flow-swatch-derived" : ""}" data-route="${route.id}" aria-hidden="true" style="${`background: ${slot}`}"></span>`;
}

/** The page's own copies of the route colors, light and dark, for swatches and the key outside the map. */
function keyVars(): string {
  const light = FLOW_ROUTE_COLORS.map(([l], i) => `--flow-key-route-${i}: ${l};`).join(" ");
  const dark = FLOW_ROUTE_COLORS.map(([, d], i) => `--flow-key-route-${i}: ${d};`).join(" ");
  return `.flow { ${light} --flow-key-neutral: ${FLOW_NEUTRAL_ROUTE[0]}; }\n@media (prefers-color-scheme: dark) { .flow { ${dark} --flow-key-neutral: ${FLOW_NEUTRAL_ROUTE[1]}; } }`;
}

function routeStops(model: FlowModel, route: FlowRoute): string {
  const name = (folder: string): string => {
    const node = model.nodes.find((n) => n.folder === folder);
    return node === undefined ? folder : flowName(node);
  };
  return `${route.stops.map(name).join(" → ")}${route.rail === undefined ? "" : ` → ${name(route.rail)} (rail)`}`;
}

function routeRow(model: FlowModel, route: FlowRoute): Markup {
  return flowRow(flowPick(route.id, routeName(route)), routeStops(model, route), "line", routeSwatch(route));
}

function edgeName(edge: FlowEdge): string {
  return `${edge.from === "." ? "root" : edge.from} → ${edge.to === "." ? "root" : edge.to}`;
}

/** The words each health count carries, for the strip and its inspector. */
function healthWords(kind: FlowHealthKind, count: number): string {
  switch (kind) {
    case "verified":
      return `${count} ${count === 1 ? "invariant" : "invariants"} enforced and verified`;
    case "requirements":
      return `${count} ${count === 1 ? "requirement" : "requirements"}, not yet enforced`;
    case "defects":
      return plural(count, "structural defect", "structural defects");
    case "bypassed":
      return `${count} ${count === 1 ? "requirement" : "requirements"} with a broken chokepoint`;
    case "escalations":
      return `${count} ${count === 1 ? "escalation" : "escalations"} awaiting a human`;
  }
}

/** The health strip at the top of the map: every count is a selection, and its inspector lists the set. */
function renderHealthStrip(model: FlowModel, selected: string | undefined): Markup {
  const counts: Record<FlowHealthKind, number> = { verified: model.health.verified.length, requirements: model.health.requirements.length, defects: model.health.defects.length, bypassed: model.health.bypassed.length, escalations: model.health.escalations.length };
  const shown = FLOW_HEALTH_KINDS.filter((kind) => kind === "verified" || kind === "requirements" || kind === "defects" || counts[kind] > 0);
  const nothingEnforced = counts.verified === 0 && counts.requirements > 0;
  return html`<div class="flow-health" data-field="health" role="group" aria-label="Health">
    ${shown.map((kind) => html`<button type="button" class="flow-health-count" data-health="${kind}" data-count="${String(counts[kind])}" data-structure-select="${flowHealthId(kind)}" aria-pressed="${selected === flowHealthId(kind) ? "true" : "false"}"><span class="flow-health-swatch" aria-hidden="true"></span><strong>${String(counts[kind])}</strong> ${healthWords(kind, counts[kind]).replace(/^\d+ /, "")}</button>`)}
    ${nothingEnforced ? html`<p class="flow-health-note" data-field="nothing-enforced">Nothing is enforced yet: every declared invariant is still a requirement, so no identifier on this map is a working control.</p>` : null}
  </div>`;
}

function renderHealthInspector(state: ShellState, model: FlowModel, kind: FlowHealthKind): Markup {
  if (kind === "escalations") {
    return html`<div class="flow-inspect" data-kind="health" data-health="${kind}">
      ${flowHead("Health", html`${healthWords(kind, model.health.escalations.length)}`, `${flowHealthId(kind)}-heading`, "Each waits for a human to acknowledge it.")}
      <ul class="flow-rows" data-field="members">${model.health.escalations.map((e) => html`<li class="flow-row"><a class="flow-pick" href="#journal-${slug(e.id)}">${e.id}</a><span class="flow-meta">${e.what}</span></li>`)}</ul>
    </div>`;
  }
  const members = flowHealthMembers(model, kind);
  const summary = kind === "verified"
    ? html`Each is an ${termLink(state, "invariant")}: enforced, its enforcement seen to fire, and verified by the latest run that checked it.`
    : kind === "requirements"
      ? html`Each is a ${termLink(state, "requirement")}: declared, and nothing yet detects its violation. Its identifier on the map is outlined, not solid.`
      : kind === "defects"
        ? html`Each is a ${termLink(state, "structural defect")}: an invariant whose enforcement no longer holds.`
        : html`Each is a ${termLink(state, "requirement")} whose ${termLink(state, "chokepoint")} check found a ${termLink(state, "bypass")}: broken, though never enforced.`;
  const byComponent = [...new Set(members.map((m) => m.component))];
  return html`<div class="flow-inspect" data-kind="health" data-health="${kind}">
    ${flowHead("Health", html`${healthWords(kind, members.length)}`, `${flowHealthId(kind)}-heading`, summary)}
    ${members.length === 0 ? html`<p class="flow-note">None.</p>` : join(byComponent.map((component) => html`<h4>${component === "." ? "The root" : component} <span class="flow-count">${members.filter((m) => m.component === component).length}</span></h4><ul class="flow-rows" data-field="members">${members.filter((m) => m.component === component).map((m) => invariantRow(model, m))}</ul>`))}
  </div>`;
}

function renderFlowSummary(state: ShellState, model: FlowModel, previews: readonly StructurePreview[]): Markup {
  const bearing = model.edges.filter((edge) => edge.loadBearing).length;
  const broken = model.edges.filter((edge) => edge.bypasses.length > 0).length;
  const onRoutes = model.edges.filter((edge) => edge.routes.length > 0).length;
  const stubs = model.edges.filter((edge) => edge.stub).length;
  return html`<div class="flow-summary">
    ${flowHead("Nothing selected", html`${plural(model.edges.length, "component interface", "component interfaces")}`, undefined, `Between ${plural(model.nodes.length, "component", "components")}. Select anything to trace it; the rest dims.`)}
    ${flowFacts([
      ["On routes", `${onRoutes}`],
      [html`Stubs to ${termLink(state, "core dependency", "core dependencies")}`, `${stubs}`],
      ["Load-bearing", html`${bearing} <span class="flow-meta">a ${termLink(state, "chokepoint")} or a ${termLink(state, "crossing")} stands there</span>`],
      broken > 0 ? ["Broken", html`<span class="flow-bad">${broken}</span>`] : null,
      ["Others", html`${model.edges.length - onRoutes - stubs} <span class="flow-meta">drawn faint when a selection reaches them</span>`],
    ])}
    ${model.edges.length === 0 ? html`<p class="empty" data-field="no-interfaces">No component interface is known: ${model.evidence === "run sites only" ? "no latest run records a reference from one component into another's chokepoint or protected thing, and the language adapter was not asked." : "no component's code references another's."}</p>` : null}
    <h4>Where work enters</h4>
    ${model.routesFrom === "root interfaces" ? html`<p class="flow-note" data-field="derived-routes">No spec declares an entrance. Each route is ${termLink(state, "derived")} from one of the root component's component interfaces by ${termLink(state, "reference weight")}, not flow, and named for the first component it reaches.</p>` : null}
    ${model.entrances.length === 0 && model.routesFrom !== "root interfaces" ? html`<p class="flow-note" data-field="no-entrances">No spec declares an entrance, and there is no root component to derive routes from.</p>` : null}
    <ul class="flow-rows" data-field="routes">${model.routes.map((route) => routeRow(model, route))}</ul>
    ${model.entrances.length === 0 ? null : html`<details class="flow-entrances"><summary>Entrances <span class="flow-count">${model.entrances.length}</span></summary><ul class="flow-rows">${model.entrances.map((e) => flowRow(flowPick(e.id, e.name, e.id), e.reachable ? `starts in ${e.start === "." ? "the root" : e.start}${e.trust.length === 0 ? "" : `, carries ${e.trust.join(", ")}`}` : e.reason ?? ""))}</ul></details>`}
    ${model.coreDependencies.length === 0 ? null : html`<h4>Core dependencies</h4><p class="flow-note" data-field="core-rule">A ${termLink(state, "core dependency")} is ${CORE_RULE}. Drawn as a rail; each caller's stub runs down to it.</p><ul class="flow-rows">${model.coreDependencies.map((core) => {
      const node = model.nodes.find((n) => n.folder === core.folder)!;
      return flowRow(flowPick(node.id, node.name), `called by ${core.callers.map((c) => (c === "." ? "the root" : c)).join(", ")}`);
    })}</ul>`}
    <h4>Interface identifiers</h4>
    ${model.identifiers.length === 0 ? html`<p class="flow-note">No chokepoint stands on a component interface or an entrance line.</p>` : html`<ul class="flow-rows" data-field="identifiers">${model.identifiers.map((identifier) => flowRow(flowPick(identifier.chokepoint, identifier.name), html`${verdictMark(identifier)} · ${identifier.component}${identifier.crossing === undefined ? "" : `, crossing ${identifier.crossing.from} → ${identifier.crossing.to}`}`, "line", html`<span class="flow-ident" data-verdict-state="${identifier.verdict.state}">${identifier.text}</span>`))}</ul>`}
    <h4>Where data goes, by trust level</h4>
    <ul class="flow-rows">${model.levels.map((level) => {
      const drawn = model.crossings.filter((c) => c.from === level.name || c.to === level.name).length;
      return flowRow(flowPick(level.id, level.name, level.id), plural(drawn, "crossing", "crossings"), "count");
    })}</ul>
    <h4>What changed</h4>
    <ul class="flow-rows">${flowRow(flowPick(FLOW_CHANGE_ID, "What this change touches and weakens", FLOW_CHANGE_ID), "comparison with the previous commit")}</ul>
    <details class="flow-chokepoints"><summary>Chokepoints <span class="flow-count">${model.chokepoints.length}</span></summary>
      <ul class="flow-rows">${model.chokepoints.map((c) => flowRow(flowPick(c.id, c.name, c.id), html`${verdictMark(c)} · <code>${c.chokepoint}</code> in ${c.component}`))}</ul>
    </details>
    ${previews.length === 0 ? null : html`<h4>Proposed</h4><ul>${previews.map((p) => html`<li data-proposed="true">proposed preview · ${p.name}: ${p.crossing.from} → ${p.crossing.to} in ${p.component}. Reliance unknown: a proposal has no run evidence. This dashed edge exists only in the ephemeral preview.</li>`)}</ul>`}
  </div>`;
}

/** A route's stops as rows: each component interface it takes, with its identifiers or its site count. */
function renderRouteBody(state: ShellState, model: FlowModel, route: FlowRoute, named: boolean): Markup {
  return html`${named ? html`<p class="flow-sub">${routeSwatch(route)} <strong>${routeName(route)}</strong>: ${routeStops(model, route)}</p>` : null}
    ${route.entry.length === 0 ? null : html`<p class="flow-note" data-field="entry">Where work enters, its handler is itself a ${termLink(state, "chokepoint")}: ${route.entry.join(" ")} stand on the line from its entrances${route.trust.length === 0 ? "" : `, carrying ${route.trust.join(", ")} in`}.</p>`}
    <h4>Interfaces along it <span class="flow-count">${route.edges.length}</span></h4>
    ${route.edges.length === 0 ? html`<p class="flow-note">None: its handler's reach calls no other component except core dependencies${route.rail === undefined ? "" : `; it ends in the ${route.rail} rail`}.</p>` : html`<ul class="flow-rows">${route.edges.map((id) => model.edges.find((edge) => edge.id === id)!).map((edge) => flowRow(flowPick(edge.id, edgeName(edge)), edge.identifiers.length === 0 ? plural(edge.sites, "site", "sites") : `${edge.identifiers.join(" ")} · ${plural(edge.sites, "site", "sites")}`, "count"))}</ul>`}
    <details class="flow-more"><summary>How a route is followed</summary><p>${route.followed === "reach" ? `By its handler's reach: ${ROUTE_RULE}.` : html`By ${termLink(state, "reference weight")}, not flow: the adapter read no handler reach, so from each stop the route follows the heaviest component interface (most reference sites) to a component not yet on it, not a core dependency, and not in a column left of the one it stands in.`}</p></details>`;
}

function renderEntranceInspector(state: ShellState, model: FlowModel, entrance: FlowEntrance): Markup {
  const route = model.routes.find((candidate) => candidate.entrances.includes(entrance.id));
  return html`<div class="flow-inspect" data-kind="entrance">
    ${flowHead("Entrance", html`${entrance.name}`, `${entrance.id}-heading`, entrance.meaning)}
    ${flowFacts([
      ["Declared by", html`<code>${entrance.declaredBy}</code>`],
      ["Handler", entrance.handler === undefined ? "none" : html`<code>${entrance.handler}</code>`],
      entrance.start === undefined ? null : ["Starts in", html`<code>${entrance.start}</code>`],
      [html`${termLink(state, "trust level", "Trust")} in`, entrance.trust.length === 0 ? "no crossing's chokepoint is its handler" : entrance.trust.join(", ")],
    ])}
    ${entrance.reachable ? (route === undefined ? html`<p class="flow-note">Its route is not drawn.</p>` : renderRouteBody(state, model, route, true)) : html`<p class="empty" data-field="unreachable">${entrance.resolved ? "Unreachable" : "Unresolved"}: ${entrance.reason}</p>`}
  </div>`;
}

function renderRouteInspector(state: ShellState, model: FlowModel, route: FlowRoute): Markup {
  return html`<div class="flow-inspect" data-kind="route">
    ${flowHead(route.derived ? html`${termLink(state, "derived", "Derived")} structural route, by reference weight` : html`${termLink(state, "structural route", "Structural route")}`, html`${routeSwatch(route)} ${route.derived ? routeName(route) : plural(route.names.length, "entrance", "entrances")}`, `${route.id}-heading`, routeStops(model, route))}
    ${renderRouteBody(state, model, route, false)}
    ${route.derived ? html`<p class="flow-note">Derived from the root component's component interface to ${route.stops[1] ?? "nothing"} by reference weight: no spec declares an entrance, so the route is named for the first component it reaches and is not the path work takes.</p>` : html`<h4>Entrances it starts from <span class="flow-count">${route.entrances.length}</span></h4><ul class="flow-rows" data-field="entrances">${route.entrances.map((id) => model.entrances.find((e) => e.id === id)!).map((e) => flowRow(flowPick(e.id, e.name), e.meaning))}</ul>`}
  </div>`;
}

function renderLevelInspector(state: ShellState, model: FlowModel, level: FlowLevel): Markup {
  const edges = model.edges.filter((edge) => level.edges.includes(edge.id));
  const touching = (c: FlowCrossing): boolean => c.from === level.name || c.to === level.name;
  const atEntrances = model.routes.filter((r) => level.routes.includes(r.id));
  const marks = model.nodes.filter((n) => level.components.includes(n.folder));
  const total = model.crossings.filter(touching).length;
  return html`<div class="flow-inspect" data-kind="level">
    ${flowHead(html`${termLink(state, "trust level", "Trust level")}`, html`${level.name}`, `${level.id}-heading`, level.meaning)}
    <p class="flow-note">${plural(total, "crossing", "crossings")} carry it, every one drawn: on the interfaces its chokepoint stands on, on an entrance line, or on a component's boundary mark.</p>
    ${edges.length === 0 ? null : html`<h4>On component interfaces <span class="flow-count">${edges.length}</span></h4><ul class="flow-rows">${edges.map((edge) => flowRow(flowPick(edge.id, edgeName(edge)), edge.crossings.filter(touching).map((c) => `${c.name} (${c.from} → ${c.to}), ${c.verdict.label}`).join("; ")))}</ul>`}
    ${atEntrances.length === 0 ? null : html`<h4>Where work enters <span class="flow-count">${atEntrances.length}</span></h4><ul class="flow-rows">${atEntrances.map((route) => flowRow(flowPick(route.id, routeName(route)), model.crossings.filter((c) => touching(c) && c.routes.includes(route.id)).map((c) => `${c.name} (${c.from} → ${c.to})`).join("; ")))}</ul>`}
    ${marks.length === 0 ? null : html`<h4>Inside components <span class="flow-count">${marks.length}</span></h4><ul class="flow-rows">${marks.map((node) => flowRow(flowPick(flowBoundaryId(node.folder), node.name), node.boundary.filter(touching).map((c) => `${c.name} (${c.from} → ${c.to})`).join("; ")))}</ul>`}
    ${level.unplaced.length === 0 ? null : html`<h4>Crossings the map could not place</h4><ul class="flow-rows">${level.unplaced.map((c) => html`<li class="flow-row"><a href="#${invariantId(c.component, c.name)}">${c.name}</a><span class="flow-meta">${c.from} → ${c.to}, in ${c.component === "." ? "the root" : c.component}</span></li>`)}</ul>`}
    ${total === 0 ? html`<p class="flow-note" data-field="no-crossing">No crossing names this trust level.</p>` : null}
  </div>`;
}

function renderComponentInspector(state: ShellState, model: FlowModel, node: FlowNode): Markup {
  const out = model.edges.filter((edge) => edge.from === node.folder);
  const into = model.edges.filter((edge) => edge.to === node.folder);
  const bearing = [...out, ...into].filter((edge) => edge.loadBearing || edge.bypasses.length > 0);
  const through = model.routes.filter((r) => r.stops.includes(node.folder) || r.rail === node.folder);
  const count = (s: FlowState): number => node.invariants.filter((i) => i.verdict.state === s).length;
  return html`<div class="flow-inspect" data-kind="component">
    ${flowHead(node.core ? html`${termLink(state, "core dependency", "Core dependency")}` : html`${termLink(state, "component", "Component")}`, html`<a href="#${componentId(node.folder)}">${flowName(node)}</a>`, undefined, node.intent)}
    <h4 data-field="own-invariants">Its invariants <span class="flow-count">${node.invariants.length}</span></h4>
    ${node.invariants.length === 0 ? html`<p class="flow-note">It declares no invariant: nothing here is enforced.</p>` : html`<p class="flow-note" data-field="own-verdicts">${[count("verified") > 0 ? `${count("verified")} verified` : "", count("requirement") > 0 ? plural(count("requirement"), "requirement", "requirements") : "", count("broken") > 0 ? `${count("broken")} broken` : ""].filter(Boolean).join(", ")}</p><ul class="flow-rows" data-field="invariants">${node.invariants.map((ref) => invariantRow(model, ref))}</ul>`}
    ${node.defects.length === 0 ? null : html`<p><button type="button" class="flow-pick flow-action flow-bad" data-structure-select="${flowBrokenId(node.folder)}">${plural(node.defects.length, "broken chokepoint", "broken chokepoints")}: see the bypass sites</button></p>`}
    ${node.boundary.length === 0 ? null : html`<p><button type="button" class="flow-pick flow-action" data-structure-select="${flowBoundaryId(node.folder)}">${plural(node.boundary.length, "crossing", "crossings")} inside it</button></p>`}
    ${flowFacts([
      ["Folder", html`<code>${node.folder}</code>`],
      ["Calls", `${plural(out.length, "component", "components")}`],
      ["Called by", `${plural(into.length, "component", "components")}`],
    ])}
    ${node.children > 0 ? html`<p><button type="button" class="flow-pick flow-action" data-structure-expand="${node.folder}">${node.expanded ? "Close" : "Open"} its ${plural(node.children, "component", "components")} in place</button></p>` : null}
    ${node.core ? html`<p class="flow-note" data-field="core">A core dependency: ${CORE_RULE}. Drawn as a rail; each caller's stub runs down to it.</p>` : null}
    <h4 data-field="routes">Structural routes through it (${through.length})</h4>
    <ul class="flow-rows">${through.map((route) => routeRow(model, route))}</ul>
    <h4 data-field="load-bearing">Load-bearing here (${bearing.length})</h4>
    ${bearing.length === 0 ? html`<p class="flow-note">No chokepoint or crossing stands on its component interfaces.</p>` : html`<ul class="flow-rows">${bearing.map((edge) => flowRow(flowPick(edge.id, edgeName(edge)), flowLabelLines(edge).map((l) => l.text).join(", ")))}</ul>`}
    <h4>Calls <span class="flow-count">${out.length}</span></h4>
    <ul class="flow-rows">${out.map((edge) => flowRow(flowPick(edge.id, `→ ${edge.to}`), plural(edge.symbols.length, "symbol", "symbols"), "count"))}</ul>
    <h4>Called by <span class="flow-count">${into.length}</span></h4>
    <ul class="flow-rows">${into.map((edge) => flowRow(flowPick(edge.id, `← ${edge.from === "." ? "root" : edge.from}`), plural(edge.symbols.length, "symbol", "symbols"), "count"))}</ul>
  </div>`;
}

/** A component's broken chokepoints: every bypass site, and, when all sit inside the component, that it says so and lists them. */
function renderBrokenInspector(state: ShellState, model: FlowModel, node: FlowNode): Markup {
  return html`<div class="flow-inspect" data-kind="broken">
    ${flowHead(html`Broken ${termLink(state, "chokepoint", "chokepoints")}`, html`<a href="#${componentId(node.folder)}">${node.name}</a>: ${plural(node.defects.length, "broken chokepoint", "broken chokepoints")}`, `${flowBrokenId(node.folder)}-heading`, html`A ${termLink(state, "bypass")} reaches a protected thing from outside its chokepoint.`)}
    ${join(node.defects.map((defect) => {
      const ref = node.invariants.find((i) => i.name === defect.name);
      const inside = defect.sites.filter((s) => s.inside);
      const outside = defect.sites.filter((s) => !s.inside);
      return html`<section class="flow-defect" data-defect="${defect.name}">
        <h4>${flowPick(defect.chokepoint, defect.name)} ${ref === undefined ? null : verdictMark(ref)}</h4>
        <p class="flow-note" data-field="where">${defect.sites.length === 0 ? "The latest run failed it and recorded no bypass site." : inside.length === defect.sites.length ? `All ${plural(defect.sites.length, "bypass", "bypasses")} sit inside ${node.name}, so no component interface carries them; they are listed here.` : `${plural(outside.length, "bypass", "bypasses")} from other components, drawn on their interfaces; ${inside.length} inside ${node.name}.`}</p>
        <ul class="site-list" data-field="sites">${defect.sites.map((s) => html`<li data-class="bypass" data-inside="${s.inside ? "true" : "false"}"><code>${s.file}:${s.line}</code> in <code>${s.symbol}</code>${s.inside ? html` <span class="label">inside</span>` : null}</li>`)}</ul>
        ${renderFlowOptions(node.folder, defect.name, [model.chokepoints.find((c) => c.id === defect.chokepoint)?.chokepoint ?? defect.name])}
      </section>`;
    }))}
  </div>`;
}

/** The crossings standing inside a component, on no drawn interface or entrance line: its boundary mark's inspector. */
function renderBoundaryInspector(state: ShellState, model: FlowModel, node: FlowNode): Markup {
  const pairs = [...new Set(node.boundary.map((c) => `${c.from} → ${c.to}`))];
  return html`<div class="flow-inspect" data-kind="boundary">
    ${flowHead(html`Trust boundaries inside a component`, html`<a href="#${componentId(node.folder)}">${node.name}</a>: ${plural(node.boundary.length, "crossing", "crossings")}`, `${flowBoundaryId(node.folder)}-heading`, html`Each ${termLink(state, "crossing")} stands inside ${node.name}: both sides of its chokepoint are in it, or it has no chokepoint, so no component interface can carry it.`)}
    ${join(pairs.map((pair) => {
      const members = node.boundary.filter((c) => `${c.from} → ${c.to}` === pair);
      return html`<h4>${pair} <span class="flow-count">${members.length}</span></h4><ul class="flow-rows" data-field="crossings">${members.map((c) => invariantRow(model, c))}</ul>`;
    }))}
  </div>`;
}

function renderEdgeInspector(state: ShellState, model: FlowModel, edge: FlowEdge): Markup {
  const shown = edge.symbols.slice(0, 24);
  const byInvariant = [...new Set(edge.bypasses.map((b) => b.invariant))];
  const through = model.routes.filter((route) => edge.routes.includes(route.id));
  const kind = edge.bypasses.length > 0 ? html`Broken component interface, ${plural(edge.bypasses.length, "bypass", "bypasses")}` : edge.loadBearing ? "Load-bearing component interface" : html`${termLink(state, "component interface", "Component interface")}`;
  return html`<div class="flow-inspect" data-kind="edge">
    ${flowHead(kind, html`${edgeName(edge)}`, undefined, `Code in ${edge.from} references ${plural(edge.symbols.length, "symbol", "symbols")} of ${edge.to} at ${plural(edge.sites, "site", "sites")}.`)}
    ${flowFacts([
      ["Drawn", edge.stub ? "A stub: its callee is a core dependency, drawn as a rail." : through.length > 0 ? `On ${through.map(routeName).join("; ")}.` : "On no structural route: drawn faint when a selection reaches it."],
    ])}
    ${edge.identifiers.length === 0 ? null : html`<h4>Interface identifiers</h4><ul class="flow-rows" data-field="identifiers">${edge.identifiers.map((text) => { const found = model.identifiers.find((i) => i.text === text)!; return flowRow(flowPick(found.chokepoint, found.name), verdictMark(found), "line", html`<span class="flow-ident" data-verdict-state="${found.verdict.state}">${text}</span>`); })}</ul>`}
    ${edge.chokepoints.length === 0 ? null : html`<h4>Chokepoints standing here</h4><ul class="flow-rows">${edge.chokepoints.map((c) => flowRow(flowPick(c.id, c.name), html`<code>${c.chokepoint}</code> protects ${codeOrText(c.protects)} · ${verdictMark(c)}`))}</ul>`}
    ${edge.crossings.length === 0 ? null : html`<h4>Crossings</h4><ul class="flow-rows">${edge.crossings.map((c) => html`<li class="flow-row">${c.from} → ${c.to}<span class="flow-meta">${c.name}</span></li>`)}</ul>`}
    ${edge.bypasses.length === 0 ? null : html`<div class="defect" data-field="defect"><h5>Bypass sites</h5><ul class="site-list">${edge.bypasses.map((b) => html`<li data-class="bypass"><code>${b.file}:${b.line}</code> in <code>${b.symbol}</code> <span class="site-role">bypass of the protected thing of ${b.invariant}</span></li>`)}</ul>${join(byInvariant.map((name) => renderFlowOptions(edge.to, name, edge.chokepoints.filter((c) => c.name === name).map((c) => c.chokepoint))))}</div>`}
    <h4>Symbols <span class="flow-count">${edge.symbols.length}</span></h4>
    <ul class="flow-rows flow-symbols">${shown.map((s) => html`<li class="flow-row flow-row-count"><code>${s.symbol}</code><span class="flow-meta">${s.file === "" ? "" : `${s.file}, `}${plural(s.sites, "site", "sites")}${s.kind === "type" ? ", type" : ""}</span></li>`)}</ul>
    ${edge.symbols.length > shown.length ? html`<p class="flow-note">and ${edge.symbols.length - shown.length} more</p>` : null}
  </div>`;
}

/**
 * An interface identifier's inspector: the invariant behind the chokepoint,
 * its one verdict, and where it stands on the map. What an agent needs
 * (per-enforcement records and test commands, the refutation record, the
 * reliance sites, the two options) folds beneath, closed.
 */
function renderChokepointInspector(state: ShellState, model: FlowModel, chokepoint: FlowChokepoint, selection: FlowSelection): Markup {
  const invariant = state.spec.components.find((c) => c.folder === chokepoint.component)?.invariants.find((i) => i.name === chokepoint.name);
  const reliance = invariant === undefined ? [] : relianceOf(invariant, state.spec.components, state.runs.records).filter((r) => r.chokepoint === chokepoint.chokepoint);
  const edges = model.edges.filter((edge) => selection.edges.has(edge.id));
  const identifier = model.identifiers.find((i) => i.chokepoint === chokepoint.id);
  const through = model.routes.filter((route) => edges.some((edge) => edge.routes.includes(route.id) || (edge.stub && route.rail === edge.to && route.stops[route.stops.length - 1] === edge.from)) || (identifier?.routes.includes(route.id) ?? false));
  const meaning = (level: string): string => state.spec.trustLevels.find((l) => l.name === level)?.meaning ?? "not a declared trust level";
  const bypasses = invariant === undefined ? [] : latestOf(invariant, state.runs.records).filter((entry) => entry.form === "chokepoint").flatMap((entry) => entry.bypasses);
  return html`<div class="flow-inspect" data-kind="chokepoint" data-reliance-of="${chokepoint.name}">
    ${flowHead(identifier === undefined ? html`${termLink(state, "chokepoint", "Chokepoint")} and its reliance` : html`${termLink(state, "interface identifier", "Interface identifier")} <span class="flow-ident" data-verdict-state="${identifier.verdict.state}">${identifier.text}</span>`, html`<a href="#${invariantId(chokepoint.component, chokepoint.name)}">${chokepoint.name}</a>`, `${chokepoint.id}-heading`, invariant === undefined ? null : html`<span data-field="sentence">${invariant.sentence}</span>`)}
    ${flowFacts([
      ["Verdict", html`<span data-field="verdict">${verdictMark(chokepoint)}</span>`],
      ["Component", html`<code>${chokepoint.component}</code>`],
      [html`${termLink(state, "chokepoint", "Chokepoint")}`, html`<code>${chokepoint.chokepoint}</code>`],
      ["Protects", codeOrText(chokepoint.protects)],
      invariant?.crossing === undefined ? null : [html`${termLink(state, "crossing", "Crossing")}`, html`<span class="crossing" data-field="crossing"><span class="level">${invariant.crossing.from}</span> → <span class="level">${invariant.crossing.to}</span></span>`],
      ["Stands on", `${plural(edges.length, "interface", "interfaces")}${identifier !== undefined && identifier.routes.length > 0 ? `, and where work enters by ${plural(identifier.routes.length, "route", "routes")}` : ""}`],
    ])}
    ${invariant?.crossing === undefined ? null : html`<dl class="flow-levels"><dt><span class="level">${invariant.crossing.from}</span></dt><dd>${meaning(invariant.crossing.from)}</dd><dt><span class="level">${invariant.crossing.to}</span></dt><dd>${meaning(invariant.crossing.to)}</dd></dl>`}
    ${bypasses.length === 0 ? null : html`<div class="defect" data-field="defect"><h5>${termLink(state, "bypass", "Bypass")} sites</h5><ul class="site-list">${bypasses.map((b) => html`<li data-class="bypass"><code>${b.file}:${b.line}</code> in <code>${b.symbol}</code></li>`)}</ul>${renderFlowOptions(chokepoint.component, chokepoint.name, [chokepoint.chokepoint])}</div>`}
    <h4>The component interfaces it stands on (${edges.length})</h4>
    <ul class="flow-rows" data-field="interfaces">${edges.map((edge) => flowRow(flowPick(edge.id, edgeName(edge)), `${plural(edge.symbols.length, "symbol", "symbols")}${edge.stub ? ", a stub to a core dependency" : ""}`, edge.stub ? "line" : "count"))}</ul>
    <h4 data-field="routes-through">Structural routes through it (${through.length})</h4>
    ${through.length === 0 ? html`<p class="flow-note">No structural route passes the interfaces it stands on.</p>` : html`<ul class="flow-rows">${through.map((route) => routeRow(model, route))}</ul>`}
    ${invariant === undefined ? null : html`<details class="flow-more flow-enforcement flow-agent"><summary>Enforcement record, for agents <span class="flow-meta">${enforcementSummary(state, invariant)}</span></summary><ul class="enforcements">${join(invariant.enforcements.map((enforcement) => renderEnforcement(state, invariant, enforcement)))}</ul></details>`}
    ${invariant === undefined ? null : html`<details class="flow-more flow-refutation flow-agent"><summary>${termLink(state, "refutation", "Refutation")} record</summary>${renderRefutation(invariant, state.runs.records)}</details>`}
    <details class="flow-more flow-reliance flow-agent"><summary>${termLink(state, "reliance", "Reliance")}: the recorded reference sites</summary>
    ${join(reliance.map((r) => r.evidence.status === "unknown"
      ? html`<p class="flow-note" data-reliance="unknown">${r.evidence.reason}</p>`
      : r.evidence.sites.length === 0
        ? html`<p class="flow-note" data-reliance="complete">Complete run site evidence records 0 references to the chokepoint or protected thing.</p>`
        : html`<p class="flow-note" data-reliance="complete">${plural(r.evidence.sites.length, "recorded reference site", "recorded reference sites")} to the chokepoint or protected thing; owner component first.</p><ul class="site-list">${r.evidence.sites.map(flowSite)}</ul>`))}
    </details>
    ${invariant !== undefined && invariant.state === "structural defect" && bypasses.length === 0 ? renderFlowOptions(chokepoint.component, chokepoint.name, [chokepoint.chokepoint]) : null}
  </div>`;
}

/** The enforcement forms, for the folded record's heading: the forms only; the one verdict is above. */
function enforcementSummary(state: ShellState, invariant: NonNullable<ShellState["spec"]["components"][number]["invariants"][number]>): string {
  void state;
  return invariant.enforcements.map((enforcement) => (enforcement.form === "chokepoint" ? "chokepoint" : "totality oracle")).join(", ");
}

function renderChangeInspector(): Markup {
  return html`<div class="flow-inspect" data-kind="change">
    ${flowHead("Change", html`What this change touches and weakens`, `${FLOW_CHANGE_ID}-heading`, "No second state is in this page, so nothing is lit.")}
    <p data-field="change-placeholder">Structure compares this state with the previous commit, or with a commit the agent names, in the next slice. The comparison is already one pure function over two maps, <code>compareFlows</code>, and it measures what the change touched and what it weakened:</p>
    <ul class="flow-list" data-field="measures">
      <li>entrance added or removed</li>
      <li>component interface added, removed, or widened (references new symbols)</li>
      <li>chokepoint gaining a bypass</li>
      <li>crossing added or removed</li>
      <li>data path gaining a branch</li>
    </ul>
  </div>`;
}

/**
 * The one inspector, beside the map: whatever is selected, else the map's
 * summary. Open while something is selected; closed by its close button or
 * Escape, which clear the selection. The selection hash reopens it. When the
 * selection is only the default story (the reader chose nothing), it is
 * marked so: below the side-by-side width it then stays in the page's flow
 * under the map instead of opening as a sheet over it.
 */
function renderFlowInspector(state: ShellState, model: FlowModel, selection: FlowSelection, previews: readonly StructurePreview[], chosen: boolean): Markup {
  const health = FLOW_HEALTH_KINDS.find((kind) => flowHealthId(kind) === selection.id);
  const body =
    selection.kind === "entrance"
      ? renderEntranceInspector(state, model, model.entrances.find((e) => e.id === selection.id)!)
      : selection.kind === "route"
        ? renderRouteInspector(state, model, model.routes.find((r) => r.id === selection.id)!)
      : selection.kind === "level"
        ? renderLevelInspector(state, model, model.levels.find((l) => l.id === selection.id)!)
        : selection.kind === "component"
          ? renderComponentInspector(state, model, model.nodes.find((n) => n.id === selection.id)!)
          : selection.kind === "edge"
            ? renderEdgeInspector(state, model, model.edges.find((e) => e.id === selection.id)!)
            : selection.kind === "chokepoint"
              ? renderChokepointInspector(state, model, model.chokepoints.find((c) => c.id === selection.id)!, selection)
              : selection.kind === "health" && health !== undefined
                ? renderHealthInspector(state, model, health)
                : selection.kind === "broken"
                  ? renderBrokenInspector(state, model, model.nodes.find((n) => flowBrokenId(n.folder) === selection.id)!)
                  : selection.kind === "boundary"
                    ? renderBoundaryInspector(state, model, model.nodes.find((n) => flowBoundaryId(n.folder) === selection.id)!)
                    : selection.kind === "change"
                      ? renderChangeInspector()
                      : null;
  const open = body !== null;
  return html`<aside class="flow-inspector" aria-label="Structure inspector" data-selection="${selection.kind}" data-open="${open ? "true" : "false"}" data-default="${open && !chosen ? "true" : "false"}"${open ? raw(' role="dialog" aria-modal="false"') : null}>
    ${open ? html`<button type="button" class="flow-close" data-structure-close data-structure-select="${FLOW_NONE_ID}" aria-label="Close the inspector" title="Close (Escape)">×</button>` : null}
    ${body ?? renderFlowSummary(state, model, previews)}
  </aside>`;
}

/** One entry of the key: a small drawing of the mark, and what it means. */
function keyItem(glyph: string, label: Markup | string): Markup {
  return html`<li><svg class="flow-key-glyph" viewBox="0 0 28 14" width="28" height="14" aria-hidden="true">${raw(glyph)}</svg><span>${label}</span></li>`;
}

/** The key below the map: each mark and what it is, the terms it uses, and how the map is laid out, folded beneath. */
function renderFlowKey(state: ShellState): Markup {
  return html`<div class="flow-key" data-field="key">
    <ul aria-label="Map key">
      ${keyItem('<path d="M1 7 H27" stroke="var(--flow-key-route-0)" stroke-width="3.5"/>', html`${termLink(state, "structural route", "Structural route")}: the path its entrances' handler takes; its origin token names up to four entrances and counts the rest`)}
      ${keyItem('<rect x="2" y="2" width="24" height="10" rx="3" fill="none" stroke="currentColor" stroke-dasharray="3 2"/>', html`${termLink(state, "derived", "Derived")} route: no entrance declared, drawn by ${termLink(state, "reference weight")}, not flow`)}
      ${keyItem('<rect x="2" y="1.5" width="24" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="3.5" width="2.5" height="7" rx="1" fill="currentColor"/>', html`${termLink(state, "component", "Component")}: its name, its role, its folder; the bar at its left is its worst verdict; a heavier border declares an entrance`)}
      ${keyItem('<rect x="4" y="1.5" width="20" height="11" rx="2.5" fill="var(--flow-key-verified)"/><text x="8" y="10.2" font-size="8.5" font-weight="500" fill="var(--paper)">X</text>', html`${termLink(state, "interface identifier", "Interface identifier")}, solid: its ${termLink(state, "invariant")} is enforced and verified`)}
      ${keyItem('<rect x="4" y="1.5" width="20" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-dasharray="2.5 1.5"/><text x="8" y="10.2" font-size="8.5" font-weight="500" fill="currentColor">X</text>', html`Outlined: a ${termLink(state, "requirement")}, declared and not yet enforced, so not a working control`)}
      ${keyItem('<rect x="4" y="1.5" width="20" height="11" rx="2.5" fill="var(--fail)"/><text x="8" y="10.2" font-size="8.5" font-weight="500" fill="#fff">X</text>', html`Red: broken, a ${termLink(state, "structural defect")} or a ${termLink(state, "chokepoint")} with a ${termLink(state, "bypass")}; a component with one carries a red broken mark that lists its bypass sites`)}
      ${keyItem('<text x="2" y="10.2" font-size="8.5" font-weight="500" fill="currentColor">C X</text>', html`C: a ${termLink(state, "chokepoint")}; X: one whose invariant carries a ${termLink(state, "crossing")}`)}
      ${keyItem('<path d="M14 0 V14" stroke="var(--fail)" stroke-width="2" stroke-dasharray="3 2"/><path d="M1 7 H27" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>', html`Trust boundary: where a crossing's ${termLink(state, "trust level")} changes, on its interface, on the line where work enters, or on a component's edge with a count of the crossings inside it`)}
      ${keyItem('<path d="M1 11 H27" stroke="var(--flow-key-rail)" stroke-width="4" stroke-linecap="round"/><path d="M8 1 V11" stroke="var(--flow-key-rail)" stroke-width="1.5"/>', html`${termLink(state, "core dependency", "Core dependency")} (rail) and a caller's stub to it`)}
      ${keyItem('<path d="M1 7 H27" stroke="var(--flow-key-quiet)" stroke-width="1.6"/>', "Load-bearing interface on no route")}
      ${keyItem('<path d="M1 7 H27" stroke="var(--flow-key-quiet)" stroke-width="1.4" stroke-dasharray="5 4"/>', "Interface a selection reached")}
    </ul>
    <details class="flow-more flow-terms"><summary>Terms</summary>
      <dl class="flow-levels">${Object.entries(LOCAL_TERMS).map(([name, meaning]) => html`<dt><dfn id="structure--term-${slug(name)}">${name}</dfn></dt><dd>${meaning}</dd>`)}</dl>
    </details>
    <details class="flow-more flow-rules"><summary>How the map is laid out</summary>
      <ul class="flow-list">
        <li>A route: ${ROUTE_RULE}.</li>
        <li>Entrances share a route only when they share its stops and the trust they carry in: the entering side of the crossings whose chokepoint is their handler.</li>
        <li>A component's column is its distance from where work enters. Within a column components keep folder order, so adding an interface never reorders the ones it does not reach.</li>
        <li>An identifier on a rail stands on the stubs to that core dependency.</li>
        <li>The map opens on ${DEFAULT_RULE}. Close the inspector to see every route muted.</li>
      </ul>
    </details>
  </div>`;
}

/** The one map: the evidence it stands on, the health strip, the canvas and the inspector beside it, and its key. */
export function renderFlowSection(state: ShellState, previews: readonly StructurePreview[] = state.structure.preview, model: FlowModel = flowOf(state)): Markup {
  const selected = flowSelected(model, state.structure.selected);
  const selection = flowSelection(model, selected);
  return html`<section class="flow" aria-labelledby="flow-heading" data-interfaces="${String(model.edges.length)}">
    <style>${raw(keyVars())}</style>
    <div class="flow-head">
      <h3 id="flow-heading">Structure</h3>
      <p class="flow-lede">What the system is made of and how work flows through it. Select anything on the map to trace it.</p>
      ${renderEvidence(model)}
    </div>
    <div class="flow-stage">
      <div class="flow-map">
        ${renderHealthStrip(model, selected)}
        <div class="flow-canvas" tabindex="0" role="region" aria-label="Scrollable Structure map">${renderFlowSvg(model, selected, previews)}</div>
      </div>
      ${renderFlowInspector(state, model, selection, previews, state.structure.selected !== undefined)}
    </div>
    ${renderFlowKey(state)}
  </section>`;
}
