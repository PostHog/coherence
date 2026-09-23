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
 * At rest nothing is selected and every route is drawn: the whole system in
 * view, unless something is broken, when the broken component opens
 * selected. Red means broken and nothing else; the selection is a neutral
 * halo and weight, a color no route wears; attention that is not breakage
 * (nothing enforced, no control, not covered) is amber.
 *
 * Motion (the owner's rule): only the direction of work moves, and only on
 * what is selected. A selected route sends a short bright pulse from its
 * entrance to its end, caller to callee, at a constant speed; a selected
 * component's lines pulse into it from its callers and out of it to its
 * callees, one hop after it lights; an identifier the pulse passes ticks.
 * Every animation plays a fixed number of times and stops; a hover replays
 * it once; broken marks never move. With reduced motion nothing animates and
 * small chevrons along the selected lines point caller to callee instead.
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
/** A row's height, unless a station's text needs a taller box: then the box and a gap of FLOW_ROW_GAP. */
const FLOW_ROW_H = 88;
const FLOW_ROW_GAP = 20;
/** The tallest its tracks make a station: they close up rather than grow past it. Its text may make it taller. */
const FLOW_BOX_MAX_H = 68;
/** A station holds at least four lines: its name, two of its role, its folder; a third role line adds one line. */
const FLOW_BOX_MIN_H = 64;
const FLOW_ROLE_LINE = 13;
/** The most lines a component's role wraps to on its box. */
const FLOW_ROLE_LINES = 3;
/** The width a component's role wraps at, unless its name or folder is wider; widened toward FLOW_ROLE_MAX_W only when the role would otherwise be cut mid-phrase. */
const FLOW_ROLE_W = 140;
const FLOW_ROLE_MAX_W = 220;
/** The pulse: its speed along a line, the length of its bright segment, and how many times it plays before it rests. */
export const FLOW_PULSE_SPEED = 520;
const FLOW_PULSE_SEG = 30;
export const FLOW_PULSE_PLAYS = 2;
/** The delay per hop of a component's ripple, by the number of component interfaces from it. */
export const FLOW_HOP_DELAY = 0.1;
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
 * Route colors, light and dark: hues that never read as red, orange or
 * amber (red is broken, amber is attention, and the selection wears no
 * color at all), each darkened only until white text on it reaches 4.5:1 (the
 * owner asked for white text in every origin token; identity is also the
 * name, never color alone). The check measures every one.
 */
export const FLOW_ROUTE_COLORS: [string, string][] = [
  ["#2874d0", "#1d73db"],
  ["#007c89", "#00808d"],
  ["#2e7d32", "#2f7d33"],
  ["#6a3fb5", "#7162e3"],
  ["#983a9e", "#a0409f"],
  ["#5a7414", "#5b7515"],
  ["#77594a", "#80604d"],
  ["#4053a8", "#5b6cc9"],
];
/** Rails: quiet, desaturated, and never brighter than a route. */
export const FLOW_RAIL_COLORS: [string, string][] = [
  ["#5f6b7a", "#7f8b9b"],
  ["#62705f", "#7f8e7b"],
  ["#6f6478", "#8f8398"],
  ["#56707a", "#76909a"],
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
  --flow-hatch: #9aa5bd;
  --flow-boundary: #5c677d;
  --flow-select: #172033;
  --flow-halo: rgba(23, 32, 51, 0.2);
  --flow-attention: #945400;
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
.flow-svg .flow-state-bar.flow-state-hollow { fill: var(--flow-node); stroke: var(--flow-attention); stroke-width: 1.2; }
.flow-svg .flow-route { fill: none; stroke-width: 3.5; stroke-linejoin: round; stroke-linecap: butt; }
.flow-svg .flow-terminus-dot { stroke: var(--flow-surface); stroke-width: 1.5; }
.flow-svg .flow-derived .flow-terminus-dot { fill: var(--flow-surface); stroke-width: 2.5; stroke-dasharray: 3 2; }
.flow-svg .flow-origin { fill: #ffffff; }
.flow-svg .flow-origin-more { fill: #ffffff; }
.flow-svg .flow-derived .flow-origin-token { stroke: #ffffff; stroke-width: 1; stroke-dasharray: 3 2; }
.flow-svg .flow-trust .flow-trust-box { fill: rgba(255, 255, 255, 0.16); stroke: #ffffff; stroke-width: 1; }
.flow-svg .flow-trust.flow-trust-unknown .flow-trust-box { fill: none; stroke-dasharray: 2.5 1.5; }
.flow-svg .flow-trust text { fill: #ffffff; }
.flow-svg .flow-trust.flow-trust-nocontrol .flow-trust-box { fill: #ffffff; stroke: #ffffff; }
.flow-svg .flow-trust.flow-trust-nocontrol text { fill: #8a4e00; }
.flow-svg .flow-faint { fill: none; stroke: var(--flow-quiet); stroke-width: 1.4; stroke-dasharray: 5 4; }
.flow-svg .flow-bearing-line { fill: none; stroke: var(--flow-quiet); stroke-width: 1.6; }
.flow-svg .flow-broken-line { stroke: var(--flow-defect); stroke-width: 2; stroke-dasharray: 6 3; }
.flow-svg .flow-rail-line { stroke-width: 6; stroke-linecap: round; }
.flow-svg .flow-stub { fill: none; stroke-width: 1.6; stroke-linejoin: round; }
.flow-svg .flow-joint { stroke: none; }
.flow-svg .flow-rail-label { fill: var(--flow-ink); }
.flow-svg .flow-station-name { fill: var(--flow-ink); }
.flow-svg .flow-tag .flow-tag-shape { stroke-width: 1.2; }
.flow-svg .flow-tag-verified .flow-tag-shape { fill: var(--flow-verified); stroke: var(--flow-verified); }
.flow-svg .flow-tag-verified text { fill: #ffffff; }
.flow-svg .flow-tag-requirement .flow-tag-shape { fill: url(#flow-tag-hatch); stroke: var(--flow-node-border); }
.flow-svg .flow-tag-requirement text { fill: var(--flow-ink); paint-order: stroke; stroke: var(--flow-tag); stroke-width: 2.5px; stroke-linejoin: round; }
.flow-svg .flow-tag-broken .flow-tag-shape { fill: var(--flow-defect); stroke: var(--flow-defect); }
.flow-svg .flow-tag-broken text { fill: #ffffff; }
.flow-svg .flow-tag-mark .flow-tag-shape { fill: var(--flow-tag); stroke: var(--flow-defect); stroke-width: 1.8; }
.flow-svg .flow-tag-mark text { fill: var(--flow-defect); }
.flow-svg .flow-tag-boundary .flow-tag-shape { fill: var(--flow-tag); stroke: var(--flow-muted); stroke-width: 1.2; }
.flow-svg .flow-tag-boundary text { fill: var(--flow-ink); }
.flow-svg .flow-tag-tick .flow-tag-shape { fill: transparent; stroke: none; }
.flow-svg .flow-tag-attention .flow-tag-shape { fill: var(--flow-tag); stroke: var(--flow-attention); stroke-width: 1.4; }
.flow-svg .flow-tag-attention text { fill: var(--flow-attention); }
.flow-svg .flow-tag-repeat .flow-tag-shape { stroke-width: 1.4; }
.flow-svg .flow-tag.is-selected .flow-tag-halo { fill: none; stroke: var(--flow-halo); stroke-width: 5; }
.flow-svg .flow-tag:focus .flow-tag-shape, .flow-svg .flow-tag.is-selected .flow-tag-shape { stroke: var(--flow-select); stroke-width: 2.2; }
.flow-svg .flow-boundary { stroke: var(--flow-boundary); stroke-width: 2; stroke-dasharray: 3 2; }
.flow-svg .flow-caption, .flow-svg .flow-colcap, .flow-svg .flow-rail-label { paint-order: stroke; stroke: var(--flow-surface); stroke-width: 3px; stroke-linejoin: round; }
.flow-svg .structure-edge.structure-proposed { fill: none; stroke: var(--flow-proposed); stroke-width: 2; stroke-dasharray: 9 6; }
.flow-svg .structure-proposed-word { fill: var(--flow-proposed); }
.flow-svg [data-structure-select], .flow-svg [data-structure-expand] { cursor: pointer; }
.flow-svg [data-structure-select]:focus { outline: none; }
.flow-svg .flow-halo { fill: none; stroke: var(--flow-halo); stroke-width: 6; }
.flow-svg .flow-station:focus rect.flow-box, .flow-svg .flow-station.is-selected rect.flow-box { stroke: var(--flow-select); stroke-width: 3; }
.flow-svg .flow-station.is-lit rect.flow-box, .flow-svg .flow-station.is-caller rect.flow-box { stroke: var(--flow-select); stroke-width: 2; }
.flow-svg .flow-station.is-callee rect.flow-box { stroke: var(--flow-select); stroke-width: 2; stroke-dasharray: 5 3; }
.flow-svg .flow-tag.is-lit .flow-tag-shape { stroke: var(--flow-select); stroke-width: 2; }
.flow-svg .flow-faint.is-lit, .flow-svg .flow-bearing-line.is-lit { stroke: var(--flow-select); stroke-opacity: 0.85; }
.flow-svg .flow-faint.is-in, .flow-svg .flow-bearing-line.is-in { stroke-dasharray: none; stroke-width: 1.8; }
.flow-svg .flow-faint.is-out, .flow-svg .flow-bearing-line.is-out { stroke-dasharray: 5 3; stroke-width: 1.6; }
.flow-svg .flow-route-group.is-lit .flow-route { stroke-width: 5; }
.flow-svg .flow-route-group.is-dim .flow-route, .flow-svg .flow-route-group.is-dim .flow-terminus-dot { opacity: 0.16; }
.flow-svg .flow-route-group.is-dim .flow-route { stroke-width: 2; }
.flow-svg .flow-route-group.is-dim .flow-origin-token { opacity: 0.8; }
.flow-svg .is-dim { opacity: 0.16; }
.flow-svg .flow-route-group.is-dim { opacity: 1; }
.flow-svg .flow-station.is-dim { opacity: 1; }
.flow-svg .flow-station.is-dim rect.flow-box { stroke-opacity: 0.2; }
.flow-svg .flow-station.is-dim text, .flow-svg .flow-station.is-dim .flow-state-bar { opacity: 0.25; }
.flow-svg .flow-tag.is-dim { opacity: 0.3; }
.flow-svg .flow-tag.flow-tag-tick .flow-tag-shape { fill: transparent; stroke: none; }
.flow-svg .flow-pulse { fill: none; stroke-linecap: round; stroke-width: 3; pointer-events: none; animation-name: flow-pulse; animation-timing-function: linear; animation-fill-mode: none; }
.flow-svg .flow-pulse-replay { animation-name: none; }
.flow-svg:has(.is-pulse-source:hover) .flow-pulse-replay { animation-name: flow-pulse; animation-iteration-count: 1 !important; animation-delay: 0s !important; }
.flow-svg .flow-tick { animation-name: flow-tick; animation-timing-function: linear; }
.flow-svg .flow-station.is-reach rect.flow-box { animation: flow-reach 0.35s ease-out both; }
.flow-svg .flow-chevron { display: none; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
@keyframes flow-pulse { from { stroke-dashoffset: 0; } to { stroke-dashoffset: var(--pulse-end); } }
@keyframes flow-tick { 0% { filter: brightness(1.7) drop-shadow(0 0 2px var(--flow-halo)); } 14%, 100% { filter: none; } }
@keyframes flow-reach { from { stroke-opacity: 0.2; } to { stroke-opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .flow-svg .flow-pulse { display: none; animation: none; }
  .flow-svg .flow-tick, .flow-svg .flow-station.is-reach rect.flow-box { animation: none; }
  .flow-svg .flow-chevron { display: inline; }
}
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
    --flow-hatch: #6f7c96;
    --flow-boundary: #b5bfd3;
    --flow-select: #f3f6ff;
    --flow-halo: rgba(243, 246, 255, 0.26);
    --flow-attention: #f0b04a;
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
 * entrance line, or once on a rail for a core dependency's stubs; drawn in
 * full once, and as a dot wherever it stands again), a bypass mark or a
 * count on a pipe, or a component's broken, boundary or not-covered mark,
 * attached to its box. (A route's trust, and its no-control mark, is the
 * badge in its origin token, not a tag.)
 */
export interface FlowTagDraw {
  /** The identifier text (C3, X7), a bypass mark, a count of identifiers that did not fit, or a component mark's words. */
  text: string;
  kind: "identifier" | "bypass" | "more" | "broken" | "boundary" | "uncovered";
  /** For an identifier: whether it is drawn in full elsewhere, so here it is a dot that selects the same identifier. */
  repeat: boolean;
  /** For an identifier: a crossing's (X, pointed ends) or a plain chokepoint's (C, rounded). */
  shape: "chokepoint" | "crossing" | undefined;
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
  /** Each entrance route's trust badge, left of its origin token: the levels its entrances carry in, or unknown. */
  badges: { route: string; box: FlowBox; levels: string[] }[];
  texts: FlowText[];
  /** Text a priority dropped: what did not fit, by key. */
  dropped: string[];
  mass: FlowBox | undefined;
}

/** The trust a route's entrances carry in, in words: its levels, else "unknown". */
export function trustWords(route: Pick<FlowRoute, "trust">): string {
  return route.trust.length === 0 ? "unknown" : route.trust.join(", ");
}

/**
 * What a route's badge says: "no control" when nothing controls it (its trust
 * is then unknown by construction), else its trust (decision d-7d36881b).
 */
export function badgeWords(route: Pick<FlowRoute, "trust" | "noControl">): string {
  return route.noControl ? "no control" : trustWords(route);
}

/** The length of a polyline. */
export function polylineLength(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return sum;
}

/** How far along a polyline the point nearest `p` lies. */
function alongPolyline(points: readonly Point[], p: Point): { at: number; distance: number } {
  let best = { at: 0, distance: Infinity };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (length * length)));
    const distance = Math.hypot(a[0] + (b[0] - a[0]) * t - p[0], a[1] + (b[1] - a[1]) * t - p[1]);
    if (distance < best.distance) best = { at: walked + length * t, distance };
    walked += length;
  }
  return best;
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
 * A component's role on its box: its spec's intent in at most three lines of
 * `width`, shortened when it does not fit at a clause (a colon, a semicolon,
 * a comma, a dash, or before "and", "that", "with", "through", "for",
 * "whose", "where", "which") of three words or more, else to the words that
 * fit, never ending on a word that only leads into the next; never an
 * ellipsis. The layout widens a column (up to FLOW_ROLE_MAX_W) before it
 * lets a role fall to the last case, which cuts mid-phrase (roleCut). The
 * whole intent is in the inspector and the box's title.
 */
export function roleLines(intent: string, width: number, most = FLOW_ROLE_LINES): string[] {
  return roleCut(intent, width, most).lines;
}

/** A role's lines, and how it was shortened: not at all, at a clause, or at a word, which is mid-phrase. */
export function roleCut(intent: string, width: number, most = FLOW_ROLE_LINES): { lines: string[]; cut: "whole" | "clause" | "word" } {
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
  if (whole === "") return { lines: [], cut: "whole" };
  if (fits(whole)) return { lines: wrap(whole), cut: "whole" };
  const cuts: number[] = [];
  for (const m of whole.matchAll(/[:;,]\s| \u2014 | (?:and|that|with|through|for|whose|where|which) /g)) cuts.push(m.index);
  const clause = cuts.map((at) => whole.slice(0, at).replace(/[.:;,]+$/, "")).filter((text) => text.split(" ").length >= 3 && fits(text)).pop();
  if (clause !== undefined) return { lines: wrap(clause), cut: "clause" };
  const words = whole.split(" ");
  let count = 0;
  while (count < words.length && fits(words.slice(0, count + 1).join(" "))) count += 1;
  const kept = words.slice(0, Math.max(1, count));
  while (kept.length > 1 && /^(?:a|an|the|as|of|to|and|or|for|with|by|in|on|at|that|through|from|into|one|its|their)$/i.test(kept[kept.length - 1]!.replace(/[.:;,]+$/, ""))) kept.pop();
  return { lines: wrap(kept.join(" ").replace(/[.:;,]+$/, "")), cut: "word" };
}

/** The narrowest width from `from` up to FLOW_ROLE_MAX_W at which a role is whole or cut at a clause, else FLOW_ROLE_MAX_W. */
function roleWidth(intent: string, from: number): number {
  for (let width = from; width < FLOW_ROLE_MAX_W; width += 10) if (roleCut(intent, width).cut !== "word") return width;
  return Math.max(from, FLOW_ROLE_MAX_W);
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
  // A row is FLOW_ROW_H tall unless a station's text needs a taller box (set below, once the boxes are sized).
  let rowH = FLOW_ROW_H;
  const cy = (node: FlowNode): number => FLOW_TOP + (node.row + node.span / 2) * rowH;
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

  // Station sizes: one width per column from the widest name, folder, or role in it (a role wraps to three lines at
  // FLOW_ROLE_W, and its column widens toward FLOW_ROLE_MAX_W only when it would otherwise be cut mid-phrase); a height
  // from the tracks it carries and the lines of its text, never under four lines.
  const folderText = (node: FlowNode): string => (node.folder === "." ? "project root" : node.folder);
  const ownW = (node: FlowNode): number => Math.max(textWidth(flowName(node), TYPE_NAME, true) + (node.children > 0 ? 18 : 0), textWidth(folderText(node), TYPE_SMALL, false, 0, true));
  const roleW = (node: FlowNode): number => Math.min(textWidth(node.intent.trim().replace(/[.:;,]+$/, ""), TYPE_SMALL, false), roleWidth(node.intent, Math.ceil(Math.max(FLOW_ROLE_W, ownW(node)))));
  const nameW = (node: FlowNode): number => Math.ceil(Math.max(ownW(node), roleW(node)) + 24);
  const verticalTracks = (node: FlowNode): number => Math.max(sides.get(`${node.folder}\u0000top`)?.length ?? 0, sides.get(`${node.folder}\u0000bottom`)?.length ?? 0);
  const colW = Array.from({ length: columns }, (_, c) => Math.max(90, ...inColumn(c).map((node) => Math.max(nameW(node), verticalTracks(node) * FLOW_TRACK + 40))));
  const roleOf = (node: FlowNode): string[] => roleLines(node.intent, (node.core ? FLOW_ROLE_W : colW[node.column]!) - 24);
  const textH = (node: FlowNode): number => FLOW_BOX_MIN_H + Math.max(0, roleOf(node).length - 2) * FLOW_ROLE_LINE;
  const boxH = (node: FlowNode): number => {
    const tracks = Math.max(sides.get(`${node.folder}\u0000left`)?.length ?? 0, sides.get(`${node.folder}\u0000right`)?.length ?? 0);
    return Math.max(textH(node), Math.min(FLOW_BOX_MAX_H, Math.max(FLOW_BOX_MIN_H, tracks * FLOW_TRACK + 12)));
  };
  rowH = Math.max(FLOW_ROW_H, ...placed.map((node) => boxH(node) + FLOW_ROW_GAP));

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

  // The left margin: the widest named origin, its dot, and room for the lines to fan into their stations. An entrance
  // route's trust badge sits inside its token, left of its shortest line, where the right-aligned names leave room, so it
  // rarely widens the margin (decision d-29200639).
  const badgeW = (route: FlowRoute): number => Math.ceil(textWidth(badgeWords(route), TYPE_SMALL, false, 0, true) + 10);
  const lineW = (route: FlowRoute, j: number): number => textWidth(originLines(route)[j]!, FLOW_NAME_SIZE, !(route.names.length > originLines(route).length && j === originLines(route).length - 1));
  /** The line the badge shares: the shortest, the last of equals. */
  const badgeLine = (route: FlowRoute): number => originLines(route).reduce((best, _, j) => (lineW(route, j) <= lineW(route, best) ? j : best), 0);
  const termW = Math.max(0, ...drawn.flatMap((route) => [...originLines(route).map((_, j) => lineW(route, j)), route.derived ? 0 : lineW(route, badgeLine(route)) + 5 + badgeW(route)]));
  // Identifiers where work enters stand on the line from the origin: the margin leaves them room.
  const tagW = (text: string): number => Math.ceil(textWidth(text, TYPE_SMALL, false, 0, true) + 8 + (text.startsWith("X") ? 6 : 0));
  const markW = (text: string): number => Math.ceil(textWidth(text, TYPE_SMALL, true) + 10);
  const entryRoom = Math.max(0, ...drawn.map((route) => (route.entry.length === 0 ? 0 : route.entry.reduce((sum, text) => sum + tagW(text) + 3, 0) + 12)));
  const dotX = r1(FLOW_PAD + termW + 2 * FLOW_TOKEN_PAD_X + 8 + FLOW_DOT_R);
  // Each group: its route, its name lines, where its names start (below the trust badge's row), and its dot.
  const blocks = new Map<string, { top: number; groups: { route: FlowRoute; lines: string[]; top: number; y0: number; dot: number }[] }>();
  let fan = 0;
  for (const [folder, routes] of starts) {
    const node = byFolder.get(folder)!;
    const heights = routes.map((route) => originLines(route).length * FLOW_NAME_LINE);
    const blockH = heights.reduce((a, b) => a + b, 0) + (routes.length - 1) * FLOW_NAME_GAP;
    const top = cy(node) - blockH / 2;
    let y = top;
    const groups = routes.map((route, i) => {
      const group = { route, lines: originLines(route), top: y, y0: y, dot: r1(y + heights[i]! / 2) };
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
  const railTop = FLOW_TOP + rows * rowH + 12;
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

  const massBox = mass ? { x: colX[0]!, y: r1(FLOW_TOP + massRow * rowH + rowH / 2 - 17), w: 120, h: 34 } : undefined;

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
    // The text block (name, up to three role lines, folder) sits centered in the box, which was sized to hold it.
    const role = roleOf(node);
    const need = textH(node);
    const top = station.y + (station.h - need) / 2;
    tryPlace([{ text: flowName(node), x, y: r1(top + 15), size: TYPE_NAME, bold: true, align: "start", within }], `name ${node.folder}`, 1, "flow-station-name", false);
    role.forEach((line, i) => {
      tryPlace([{ text: line, x, y: r1(top + 29 + i * FLOW_ROLE_LINE), size: TYPE_SMALL, bold: false, align: "start", within }], `role ${node.folder} ${i}`, 3, "flow-station-role", false);
    });
    tryPlace([{ text: folderText(node), x, y: r1(top + need - 8), size: TYPE_SMALL, bold: false, align: "start", within, mono: true }], `folder ${node.folder}`, 4, "flow-station-folder flow-mono", false);
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
  // 2. Each entrance route's trust badge: a pill inside its origin token, left of its shortest line.
  const badges: FlowLayout["badges"] = [];
  for (const block of blocks.values()) {
    for (const group of block.groups) {
      if (group.route.derived) continue;
      const w = badgeW(group.route);
      const j = badgeLine(group.route);
      const end = dotX - FLOW_DOT_R - 6 - FLOW_TOKEN_PAD_X - lineW(group.route, j) - 5;
      const box: FlowBox = { x: r1(end - w), y: r1(group.y0 + j * FLOW_NAME_LINE + 1), w, h: 13 };
      const placedBadge = tryPlace([{ text: badgeWords(group.route), x: r1(box.x + w / 2), y: r1(box.y + 10.1), size: TYPE_SMALL, bold: false, align: "middle", mono: true }], `trust ${group.route.id}`, 2, "flow-trust-text flow-mono", false);
      if (placedBadge !== undefined) badges.push({ route: group.route.id, box, levels: group.route.trust });
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
    tags.push({ text, kind: "broken", repeat: false, shape: undefined, state: "broken", route: undefined, node: node.folder, chokepoint: undefined, name: node.defects.map((d) => d.name).join(", "), edge: undefined, rail: undefined, edges: [], broken: true, box, boundary: undefined });
    tokenText(`mark broken ${node.folder}`, text, box, false, "flow-tag-text");
  }
  // 3. A component no enforcement covers carries a not-covered mark on its box, in the attention color, never red.
  const NOT_COVERED = "not covered";
  for (const node of model.nodes) {
    const station = stations.get(node.folder);
    if (station === undefined || node.covered) continue;
    const w = markW(NOT_COVERED);
    const order = attached(station, w, TAG_H);
    const box = [order[1]!, order[2]!, order[5]!, order[3]!, order[4]!, order[6]!, order[0]!].find((candidate) => fitsAttached(candidate, station));
    if (box === undefined) {
      dropped.push(`uncovered ${node.folder}`);
      continue;
    }
    placedText.push(box);
    tags.push({ text: NOT_COVERED, kind: "uncovered", repeat: false, shape: undefined, state: "mark", route: undefined, node: node.folder, chokepoint: undefined, name: `${node.name} is not covered`, edge: undefined, rail: undefined, edges: [], broken: false, box, boundary: undefined });
    tokenText(`mark uncovered ${node.folder}`, NOT_COVERED, box, false, "flow-tag-text");
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
    // The boundary runs along the edge the mark sits on: the box's own border, dashed, a trust boundary on the component.
    // Its place is kept under every selection; the count shows only when a trust level, the component or the boundary
    // is selected, and at rest the dashed edge alone is the mark.
    const side = box.x >= station.x + station.w - 1 ? "right" : box.y < station.y ? "top" : "bottom";
    const edgeY = side === "top" ? station.y : r1(station.y + station.h);
    const boundary = side === "right"
      ? { x1: r1(station.x + station.w), y1: r1(box.y - 5), x2: r1(station.x + station.w), y2: r1(box.y + box.h + 5) }
      : { x1: r1(box.x - 6), y1: edgeY, x2: r1(box.x + box.w + 6), y2: edgeY };
    tags.push({ text, kind: "boundary", repeat: false, shape: undefined, state: worstState(node.boundary.map((c) => c.verdict.state)) ?? "requirement", route: undefined, node: node.folder, chokepoint: undefined, name: `${plural(node.boundary.length, "crossing", "crossings")} inside ${node.name}`, edge: undefined, rail: undefined, edges: [], broken: false, box, boundary });
    if (boundaryShown(selection, node.folder)) tokenText(`mark boundary ${node.folder}`, text, box, false, "flow-tag-text");
  }

  // 5. Interface identifiers: one button each, on the pipe where it stands, on the entrance line where work enters through
  // it, and a core dependency's once, on its rail. Each is drawn in its invariant's state, and in full once: wherever it
  // stands again it is a dot of its shape and state that selects the same identifier. A crossing's identifier (X) has
  // pointed ends, a plain chokepoint's (C) is rounded. The entrance lines come first, where work enters.
  const identifierOf = (text: string): { chokepoint: string; name: string; crossing: boolean; state: FlowState } => {
    const found = model.identifiers.find((identifier) => identifier.text === text)!;
    return { chokepoint: found.chokepoint, name: found.name, crossing: found.crossing !== undefined, state: found.verdict.state };
  };
  const boundaryOf = (box: FlowBox, vertical: boolean): FlowTagDraw["boundary"] => {
    const mid: Point = [box.x + box.w / 2, box.y + box.h / 2];
    return vertical ? { x1: r1(box.x - 5), y1: r1(mid[1]), x2: r1(box.x + box.w + 5), y2: r1(mid[1]) } : { x1: r1(mid[0]), y1: r1(box.y - 9), x2: r1(mid[0]), y2: r1(box.y + box.h + 9) };
  };
  const DOT = 10;
  const full = new Set<string>();
  const isIdentifier = (text: string): boolean => /^[CX]\d+$/.test(text);
  const shapeOf = (text: string): FlowTagDraw["shape"] => (isIdentifier(text) ? (identifierOf(text).crossing ? "crossing" : "chokepoint") : undefined);
  /** A box on a line centered at (cx, cy): a dot is square and smaller than a token. */
  const tokenBox = (x: number, cyy: number, w: number): FlowBox => (w === DOT ? { x: r1(x), y: r1(cyy - DOT / 2), w: DOT, h: DOT } : { x: r1(x), y: r1(cyy - TAG_H / 2), w, h: TAG_H });
  const identifierTag = (text: string, box: FlowBox, where: Pick<FlowTagDraw, "route" | "edge" | "rail" | "edges" | "broken">, vertical: boolean, key: string): void => {
    const found = identifierOf(text);
    const repeat = box.w === DOT;
    tags.push({ text, kind: "identifier", repeat, shape: shapeOf(text), state: found.state, node: undefined, chokepoint: found.chokepoint, name: found.name, ...where, box, boundary: found.crossing && !repeat ? boundaryOf(box, vertical) : undefined });
    if (!repeat) {
      full.add(text);
      tokenText(key, text, box, true, "flow-tag-text");
    }
  };
  const widthOf = (text: string): number => (text.startsWith("✕") || text.startsWith("+") ? Math.ceil(textWidth(text, TYPE_SMALL, true) + 8) : full.has(text) ? DOT : tagW(text));
  for (const draw of routes) {
    const row = draw.route.entry;
    if (row.length === 0) continue;
    const widths = row.map(widthOf);
    const total = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 3;
    const { a, b } = draw.entry;
    let placedEntry = false;
    for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const cx = r1(a[0] + (b[0] - a[0]) * t);
      let x = cx - total / 2;
      const boxes = widths.map((w) => {
        const box = tokenBox(x, a[1], w);
        x += w + 3;
        return box;
      });
      if (boxes[0]!.x < a[0] + 2 || boxes[boxes.length - 1]!.x + boxes[boxes.length - 1]!.w > b[0] - 2 || !boxes.every(fits)) continue;
      row.forEach((text, i) => {
        const box = boxes[i]!;
        placedText.push(box);
        identifierTag(text, box, { route: draw.route.id, edge: undefined, rail: undefined, edges: [], broken: identifierOf(text).state === "broken" }, false, `tag entry ${draw.route.id} ${text}`);
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
    // All identifiers side by side; when they do not fit, the first and a count that selects the interface.
    const rows = [[...edge.identifiers, ...marks], ...(edge.identifiers.length > 1 ? [[edge.identifiers[0]!, `+${edge.identifiers.length - 1}`, ...marks]] : [])];
    let done = false;
    for (const row of rows) {
      const widths = row.map(widthOf);
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
            const box = tokenBox(x, cyy, w);
            x += w + 3;
            return box;
          });
          if (!boxes.every(fits)) continue;
          row.forEach((text, i) => {
            const box = boxes[i]!;
            placedText.push(box);
            if (isIdentifier(text)) {
              identifierTag(text, box, { route: undefined, edge, rail: undefined, edges: [edge.id], broken }, vertical, `tag ${edge.id} ${text}`);
              return;
            }
            const kind: FlowTagDraw["kind"] = text.startsWith("✕") ? "bypass" : "more";
            tags.push({ text, kind, repeat: false, shape: undefined, state: "mark", route: undefined, node: undefined, chokepoint: undefined, name: "", edge, rail: undefined, edges: [edge.id], broken, box, boundary: undefined });
            tokenText(`tag ${edge.id} ${text}`, text, box, false, "flow-tag-text");
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
    const onRail = (w: number, h: number): FlowBox | undefined => {
      for (let tries = 0; tries < 120; tries++, x += 12) {
        const candidate: FlowBox = { x: r1(x), y: r1(rail.y - h / 2), w, h };
        if (candidate.x + candidate.w > rail.x1) return undefined;
        const drop = stubs.some((stub) => stub.points.some((p) => p[0] >= candidate.x - 4 && p[0] <= candidate.x + candidate.w + 4 && p[1] >= rail.y - 20));
        if (fits(candidate) && !drop) return candidate;
      }
      return undefined;
    };
    for (const text of texts2) {
      const w = widthOf(text);
      const box = onRail(w, w === DOT ? DOT : TAG_H);
      if (box === undefined) {
        dropped.push(`tag rail ${core.folder} ${text}`);
        continue;
      }
      placedText.push(box);
      x = box.x + box.w + 6;
      identifierTag(text, box, { route: undefined, edge: undefined, rail: core.folder, edges: stubEdges.filter((edge) => edge.identifiers.includes(text)).map((edge) => edge.id), broken: stubEdges.some((edge) => edge.identifiers.includes(text) && edge.bypasses.length > 0) }, false, `tag rail ${core.folder} ${text}`);
    }
    // A core dependency's own marks stand on its rail: its broken chokepoints, the crossings inside it, and not covered.
    const railNode = byFolder.get(core.folder)!;
    const marks: { kind: "broken" | "boundary" | "uncovered"; text: string }[] = [
      ...(railNode.defects.length > 0 ? [{ kind: "broken" as const, text: `✕ ${railNode.defects.length} broken` }] : []),
      ...(railNode.covered ? [] : [{ kind: "uncovered" as const, text: NOT_COVERED }]),
      ...(railNode.boundary.length > 0 ? [{ kind: "boundary" as const, text: plural(railNode.boundary.length, "crossing", "crossings") }] : []),
    ];
    for (const mark of marks) {
      const box = onRail(markW(mark.text), TAG_H);
      if (box === undefined) {
        dropped.push(`${mark.kind} ${core.folder}`);
        continue;
      }
      placedText.push(box);
      x = box.x + box.w + 6;
      tags.push({
        text: mark.text,
        kind: mark.kind,
        repeat: false,
        shape: undefined,
        state: mark.kind === "broken" ? "broken" : mark.kind === "uncovered" ? "mark" : worstState(railNode.boundary.map((c) => c.verdict.state)) ?? "requirement",
        route: undefined,
        node: core.folder,
        chokepoint: undefined,
        name: mark.kind === "broken" ? railNode.defects.map((d) => d.name).join(", ") : mark.kind === "uncovered" ? `${railNode.name} is not covered` : `${plural(railNode.boundary.length, "crossing", "crossings")} inside ${railNode.name}`,
        edge: undefined,
        rail: undefined,
        edges: [],
        broken: mark.kind === "broken",
        box,
        boundary: mark.kind === "boundary" ? boundaryOf(box, false) : undefined,
      });
      if (mark.kind !== "boundary" || boundaryShown(selection, core.folder)) tokenText(`mark ${mark.kind} ${core.folder}`, mark.text, box, false, "flow-tag-text");
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
    const text = c === 0 ? "Where work enters" : `${plural(c, "step", "steps")} from an entrance`;
    tryPlace([{ text, x: colX[c]!, y: 44, size: TYPE_SMALL, bold: false, align: "start" }], `column ${c}`, 7, "flow-colcap");
  }

  return { width, height, stations, rails, routes, lines, stubs, tags, badges, texts, dropped, mass: massBox };
}

/** Whether a component's crossing count shows: only while a trust level, the component, or its boundary is selected. */
function boundaryShown(selection: FlowSelection, folder: string): boolean {
  return (selection.kind === "level" || selection.kind === "component" || selection.kind === "boundary") && selection.marks.has(folder);
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
  if (node.invariants.length === 0) return node.covered ? "declares no invariant" : "declares no invariant; not covered";
  const count = (state: FlowState): number => node.invariants.filter((i) => i.verdict.state === state).length;
  const words = [count("verified") > 0 ? `${count("verified")} verified` : "", count("requirement") > 0 ? `${plural(count("requirement"), "requirement", "requirements")} not enforced` : "", count("broken") > 0 ? `${count("broken")} broken` : ""].filter(Boolean).join(", ");
  return node.covered ? words : `${words}; not covered`;
}

/** How a neighbor stands to a selected component: a caller depends on it (work travels in), a callee is what it uses (work travels out). */
type Standing = "caller" | "callee" | undefined;

function renderStation(node: FlowNode, station: FlowStation, texts: FlowText[], selection: FlowSelection, selected: string | undefined, model: FlowModel, standing: Standing): Markup {
  const own = selected === node.id;
  const classes = [
    "flow-station",
    node.declaresEntrance ? "flow-entry" : "",
    node.unconnected ? "flow-unconnected" : "",
    node.defects.length > 0 ? "flow-broken" : "",
    selection.kind === "component" ? (own ? "" : standing === "caller" ? "is-caller is-reach" : standing === "callee" ? "is-callee is-reach" : "is-dim") : flowLit(selection, selection.nodes.has(node.folder)),
    own ? "is-selected is-pulse-source" : "",
  ].filter(Boolean).join(" ");
  const routes = model.routes.filter((route) => route.stops.includes(node.folder)).map(routeName);
  const mine = texts.filter((t) => t.key === `name ${node.folder}` || t.key.startsWith(`role ${node.folder} `) || t.key === `folder ${node.folder}`);
  const state = node.state;
  // A component nothing covers carries a hollow bar, unless it is broken: red stays.
  const hollow = !node.covered && state !== "broken";
  const bar = hollow
    ? html`<rect class="flow-state-bar flow-state-hollow" data-state-bar="${state ?? "none"}" data-covered="false" x="${r1(station.x + 3.5)}" y="${r1(station.y + 6)}" width="4" height="${r1(station.h - 12)}" rx="2"/>`
    : state === undefined ? null : html`<rect class="flow-state-bar flow-state-${state}" data-state-bar="${state}" x="${r1(station.x + 3.5)}" y="${r1(station.y + 6)}" width="4" height="${r1(station.h - 12)}" rx="2"/>`;
  const standingWords = standing === "caller" ? "; calls the selected component" : standing === "callee" ? "; the selected component calls it" : "";
  return html`<g class="${classes}" id="${node.id}" data-folder="${node.folder}" data-row="${String(node.row)}" data-column="${String(node.column)}" data-seat="${`${station.seat.x} ${station.seat.y}`}" data-state="${state ?? "none"}" data-covered="${node.covered ? "true" : "false"}"${standing === undefined ? null : raw(` data-standing="${standing}"`)} data-structure-select="${node.id}" role="button" tabindex="0" aria-pressed="${own ? "true" : "false"}" aria-label="${flowName(node)}, ${node.folder}: ${node.intent} ${stateWords(node)}; calls ${node.out}, called by ${node.in}${routes.length === 0 ? "" : `, on routes ${routes.join("; ")}`}${standingWords}">
    <title>${flowName(node)} · ${node.folder} · ${node.intent} · ${stateWords(node)} · calls ${node.out} · called by ${node.in}${routes.length === 0 ? "" : ` · routes: ${routes.join("; ")}`}</title>
    ${own ? html`<rect class="flow-halo" x="${r1(station.x - 4)}" y="${r1(station.y - 4)}" width="${r1(station.w + 8)}" height="${r1(station.h + 8)}" rx="10"/>` : null}
    <rect class="flow-box" id="${node.id}-box" x="${station.x}" y="${station.y}" width="${station.w}" height="${station.h}" rx="7"${standing === undefined ? null : raw(` style="animation-delay: ${FLOW_HOP_DELAY}s"`)}/>
    ${bar}
    ${mine.map(renderText)}
    ${node.children > 0 ? html`<g data-structure-expand="${node.folder}"><rect class="flow-expand" x="${station.x + station.w - 16}" y="${station.y + 2}" width="14" height="14" rx="3" fill="transparent" stroke="none"/><path class="flow-expand-mark" d="${node.expanded ? `M ${station.x + station.w - 13} ${station.y + 9} L ${station.x + station.w - 5} ${station.y + 9}` : `M ${station.x + station.w - 13} ${station.y + 9} L ${station.x + station.w - 5} ${station.y + 9} M ${station.x + station.w - 9} ${station.y + 5} L ${station.x + station.w - 9} ${station.y + 13}`}" stroke="var(--flow-muted)" stroke-width="1.5"/><title>${node.expanded ? `Close its ${plural(node.children, "component", "components")}` : `Open its ${plural(node.children, "component", "components")} in place`}</title></g>` : null}
  </g>`;
}

/** One line that moves when its selection is made: its points caller to callee, its color, and when its pulse starts. */
export interface FlowPulse {
  /** The interface or route it runs along. */
  on: string;
  points: Point[];
  color: string;
  /** Its length in px, and its duration: the length over FLOW_PULSE_SPEED, so every pulse moves at one speed. */
  length: number;
  duration: number;
  delay: number;
}

/**
 * What moves under a selection, and only under one: a selected route's (or
 * entrance's) path, from its origin token to where it ends; a selected
 * component's interfaces, into it from each caller and out of it to each
 * callee, one hop after it lights. Every point list runs caller to callee,
 * so a pulse never runs backwards. Nothing moves at rest.
 */
export function flowPulses(model: FlowModel, selection: FlowSelection, layout: FlowLayout): FlowPulse[] {
  const pulse = (on: string, points: Point[], color: string, delay: number): FlowPulse => {
    const clean = dedupe(points);
    const length = r1(polylineLength(clean));
    return { on, points: clean, color, length, duration: Math.round((length / FLOW_PULSE_SPEED) * 1000) / 1000, delay };
  };
  if (selection.kind === "route" || selection.kind === "entrance") {
    return layout.routes.filter((draw) => selection.routes.has(draw.route.id)).map((draw) => pulse(draw.route.id, draw.path, draw.color, 0));
  }
  if (selection.kind !== "component") return [];
  const out: FlowPulse[] = [];
  for (const id of [...selection.into, ...selection.outOf].sort()) {
    const onRoute = layout.routes.find((draw) => draw.segments.has(id));
    const line = layout.lines.find((draw) => draw.edge.id === id);
    const stub = layout.stubs.find((draw) => draw.edge.id === id);
    const points = onRoute?.segments.get(id)?.points ?? line?.line.points ?? stub?.points;
    if (points === undefined || points.length < 2) continue;
    out.push(pulse(id, points, onRoute?.color ?? (stub !== undefined ? `var(--flow-rail-${stub.rail % FLOW_RAIL_COLORS.length})` : "var(--flow-select)"), FLOW_HOP_DELAY));
  }
  void model;
  return out;
}

/** The bright tint a pulse wears: its line's own color, lightened, never a new hue. */
function pulseTint(color: string): string {
  return `color-mix(in srgb, ${color} 45%, #ffffff)`;
}

function renderPulse(p: FlowPulse): Markup {
  const style = (plays: boolean): string => `stroke-dasharray: ${FLOW_PULSE_SEG} ${r1(p.length + FLOW_PULSE_SEG)}; stroke-dashoffset: -${p.length}px; --pulse-end: -${p.length}px; animation-duration: ${p.duration}s; animation-delay: ${p.delay}s${plays ? `; animation-iteration-count: ${FLOW_PULSE_PLAYS}` : ""}`;
  const d = pathD(p.points);
  return html`<path class="flow-pulse" data-pulse="${p.on}" data-pulse-length="${String(p.length)}" data-pulse-duration="${String(p.duration)}" data-pulse-plays="${String(FLOW_PULSE_PLAYS)}" d="${d}" stroke="${pulseTint(p.color)}" style="${style(true)}"/><path class="flow-pulse flow-pulse-replay" data-pulse-replay="${p.on}" d="${d}" stroke="${pulseTint(p.color)}" style="${style(false)}"/>`;
}

/** Small static chevrons along a pulse's line, pointing caller to callee: what reduced motion shows instead of the pulse. */
function renderChevrons(p: FlowPulse): Markup {
  const marks: string[] = [];
  const lengths = p.points.slice(1).map((b, i) => Math.hypot(b[0] - p.points[i]![0], b[1] - p.points[i]![1]));
  // Every leg long enough carries one; a line of short legs carries one on its longest.
  const longest = Math.max(...lengths);
  for (let i = 1; i < p.points.length; i++) {
    const a = p.points[i - 1]!;
    const b = p.points[i]!;
    const length = lengths[i - 1]!;
    if (length < 28 && !(longest < 28 && length === longest && length >= 8)) continue;
    const u: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const n: Point = [-u[1], u[0]];
    const tip: Point = [a[0] + u[0] * (length / 2 + 3), a[1] + u[1] * (length / 2 + 3)];
    const arm = (s: number): Point => [r1(tip[0] - u[0] * 4 + s * n[0] * 4), r1(tip[1] - u[1] * 4 + s * n[1] * 4)];
    marks.push(`M ${arm(1).join(" ")} L ${r1(tip[0])} ${r1(tip[1])} L ${arm(-1).join(" ")}`);
  }
  return marks.length === 0 ? html`` : html`<path class="flow-chevron" data-chevrons="${p.on}" d="${marks.join(" ")}" stroke="${p.color}"/>`;
}

/** The pointed outline of a crossing's identifier (X), or its dot: a diamond. A plain chokepoint's (C) is a rounded box, or a round dot. */
function tagShape(tag: FlowTagDraw): Markup {
  const { x, y, w, h } = tag.box;
  if (tag.kind === "identifier" && tag.repeat) {
    const cx = r1(x + w / 2);
    const cyy = r1(y + h / 2);
    return tag.shape === "crossing"
      ? html`<path class="flow-tag-shape" d="${`M ${cx} ${r1(cyy - 5)} L ${r1(cx + 5)} ${cyy} L ${cx} ${r1(cyy + 5)} L ${r1(cx - 5)} ${cyy} Z`}"/>`
      : html`<circle class="flow-tag-shape" cx="${cx}" cy="${cyy}" r="4.2"/>`;
  }
  if (tag.kind === "identifier" && tag.shape === "crossing") {
    return html`<path class="flow-tag-shape" d="${`M ${r1(x + 5)} ${y} L ${r1(x + w - 5)} ${y} L ${r1(x + w)} ${r1(y + h / 2)} L ${r1(x + w - 5)} ${r1(y + h)} L ${r1(x + 5)} ${r1(y + h)} L ${x} ${r1(y + h / 2)} Z`}"/>`;
  }
  return html`<rect class="flow-tag-shape" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>`;
}

/** The deterministic SVG of the map for a model, what is selected (already resolved: undefined is nothing), and any ephemeral proposals. */
export function renderFlowSvg(model: FlowModel, selected: string | undefined, previews: readonly StructurePreview[] = []): Markup {
  const selection = flowSelection(model, selected);
  const layout = flowLayout(model, selection, previews);
  const active = selection.kind !== "none" && selection.kind !== "change";
  const tracing = selection.kind === "entrance" || selection.kind === "route";
  const routeClass = (route: FlowRoute): string => [!active ? "" : selection.routes.has(route.id) ? (tracing ? "is-lit" : "") : "is-dim", tracing && selection.routes.has(route.id) ? "is-pulse-source" : ""].filter(Boolean).join(" ");
  const byFolder = new Map(model.nodes.map((node) => [node.folder, node]));
  const texts = (prefix: string): FlowText[] => layout.texts.filter((t) => t.key.startsWith(prefix));
  const edgeOf = new Map(model.edges.map((edge) => [edge.id, edge]));
  const callers = new Set([...selection.into].map((id) => edgeOf.get(id)!.from));
  const callees = new Set([...selection.outOf].map((id) => edgeOf.get(id)!.to));
  const standingOf = (folder: string): Standing => (selection.kind !== "component" ? undefined : callers.has(folder) ? "caller" : callees.has(folder) ? "callee" : undefined);
  const lineDirection = (id: string): string => (selection.into.has(id) ? " is-in" : selection.outOf.has(id) ? " is-out" : "");

  // Motion: the pulses of the selection, and the ticks of the identifiers each pulse passes. Broken marks never move.
  const pulses = flowPulses(model, selection, layout);
  const ticks = new Map<FlowTagDraw, { duration: number; delay: number }>();
  for (const tag of layout.tags) {
    if (tag.kind !== "identifier" || tag.state === "broken") continue;
    const center: Point = [tag.box.x + tag.box.w / 2, tag.box.y + tag.box.h / 2];
    for (const p of pulses) {
      const on = p.on === tag.route || p.on === tag.edge?.id || (tag.edge !== undefined && model.routes.find((r) => r.id === p.on)?.edges.includes(tag.edge.id) === true);
      if (!on) continue;
      const along = alongPolyline(p.points, center);
      if (along.distance > 12) continue;
      ticks.set(tag, { duration: p.duration, delay: Math.round((p.delay + along.at / FLOW_PULSE_SPEED) * 1000) / 1000 });
      break;
    }
  }

  const tagClass = (tag: FlowTagDraw): string => {
    // An identifier lights exactly when the selection names its chokepoint; a component's mark when it names the component.
    const lit = tag.kind === "identifier"
      ? selection.chokepoints.has(tag.chokepoint!)
      : tag.kind === "broken" || tag.kind === "boundary" || tag.kind === "uncovered"
        ? selection.marks.has(tag.node!)
        : tag.edges.some((id) => selection.edges.has(id));
    const quiet = selection.kind === "route" || selection.kind === "entrance" || selection.kind === "component";
    // A component's mark on a lit component stays: it belongs to what the story passes.
    const onLit = tag.node !== undefined && selection.nodes.has(tag.node);
    const look = tag.kind === "boundary"
      ? `flow-tag-boundary${boundaryShown(selection, tag.node!) ? "" : " flow-tag-tick"}`
      : tag.kind === "uncovered"
        ? "flow-tag-attention"
        : `flow-tag-${tag.state === "mark" ? "mark" : tag.state}${tag.kind === "broken" ? " flow-tag-broken-mark" : ""}`;
    return [
      "flow-tag",
      look,
      tag.kind === "identifier" && tag.repeat ? "flow-tag-repeat" : "",
      active && lit && !quiet ? "is-lit" : active && !lit && !onLit ? "is-dim" : "",
      (tag.chokepoint !== undefined && tag.chokepoint === selected) || (tag.kind === "broken" && selected === flowBrokenId(tag.node!)) || (tag.kind === "boundary" && selected === flowBoundaryId(tag.node!)) ? "is-selected" : "",
      ticks.has(tag) ? "flow-tick" : "",
    ].filter(Boolean).join(" ");
  };
  return html`<svg class="flow-svg" xmlns="http://www.w3.org/2000/svg" role="group" aria-labelledby="flow-svg-title" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" style="${`min-width: ${layout.width}px`}" data-selected="${selection.id ?? ""}" data-dropped="${layout.dropped.join("|")}">
    <title id="flow-svg-title">Structure: ${plural(model.routes.length, "structural route", "structural routes")} through ${plural(model.nodes.length, "component", "components")}, ${plural(model.coreDependencies.length, "core dependency", "core dependencies")} drawn as rails</title>
    <style>${raw(FLOW_SVG_STYLE)}${raw(routeVars())}</style>
    <defs>
      <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-quiet)"/></marker>
      <pattern id="flow-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="3" fill="var(--flow-node)"/><rect width="1.4" height="3" fill="var(--flow-verified)"/></pattern>
      <pattern id="flow-tag-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="var(--flow-tag)"/><rect width="1.6" height="4" fill="var(--flow-hatch)"/></pattern>
    </defs>
    <rect class="flow-surface" x="0" y="0" width="${layout.width}" height="${layout.height}" rx="12"/>
    ${texts("caption").map(renderText)}
    ${texts("column").map(renderText)}
    ${layout.rails.map((rail) => {
      const node = byFolder.get(rail.folder)!;
      const own = selected === node.id;
      return html`<g class="flow-rail ${flowLit(selection, selection.nodes.has(rail.folder))}${own ? " is-selected is-pulse-source" : ""}" id="${node.id}" data-folder="${rail.folder}" data-core="true" data-state="${node.state ?? "none"}" data-covered="${node.covered ? "true" : "false"}" data-structure-select="${node.id}" role="button" tabindex="0" aria-pressed="${own ? "true" : "false"}" aria-label="${node.name}, core dependency, called by ${model.coreDependencies[rail.index]!.callers.length} components; ${stateWords(node)}">
        <title>${node.name} · ${node.folder} · ${node.intent} · ${stateWords(node)} · core dependency: ${CORE_RULE}</title>
        ${own ? html`<line class="flow-halo" x1="${rail.x0}" y1="${rail.y}" x2="${rail.x1}" y2="${rail.y}" stroke-width="12"/>` : null}
        <line class="flow-line flow-rail-line" data-line="${`rail ${rail.folder}`}" x1="${rail.x0}" y1="${rail.y}" x2="${rail.x1}" y2="${rail.y}" stroke="var(--flow-rail-${rail.index % FLOW_RAIL_COLORS.length})"/>
        ${texts(`rail ${rail.folder}`).map(renderText)}
      </g>`;
    })}
    ${layout.stubs.map((stub) => html`<g class="flow-stub-group ${flowLit(selection, selection.edges.has(stub.edge.id))}" data-stub="${stub.edge.id}" data-from="${stub.edge.from}" data-to="${stub.edge.to}"><path class="flow-line flow-stub" data-line="${`stub ${stub.edge.id}`}" d="${pathD(stub.points)}" stroke="var(--flow-rail-${stub.rail % FLOW_RAIL_COLORS.length})"/>${stub.joints.map(([x, y]) => html`<circle class="flow-joint" cx="${x}" cy="${y}" r="2.6" fill="var(--flow-rail-${stub.rail % FLOW_RAIL_COLORS.length})"/>`)}</g>`)}
    ${layout.lines.map((draw) => html`<g class="flow-interface ${flowLit(selection, selection.edges.has(draw.edge.id))}" id="${draw.edge.id}" data-from="${draw.edge.from}" data-to="${draw.edge.to}" data-drawn="${draw.kind}" data-structure-select="${draw.edge.id}" role="button" tabindex="0" aria-label="${draw.edge.from} to ${draw.edge.to}, on no structural route"><title>${draw.edge.from} → ${draw.edge.to}: on no structural route</title><path class="flow-line ${draw.kind === "faint" ? "flow-faint" : "flow-bearing-line"}${draw.edge.bypasses.length > 0 ? " flow-broken-line" : ""}${selection.edges.has(draw.edge.id) ? ` is-lit${lineDirection(draw.edge.id)}` : ""}" data-line="${draw.edge.id}" data-edge="${draw.edge.id}" d="${pathD(draw.line.points)}" marker-end="url(#flow-arrow)"/></g>`)}
    ${layout.routes.map((draw) => {
      const badge = layout.badges.find((b) => b.route === draw.route.id);
      const level = badge === undefined || badge.levels.length !== 1 ? undefined : model.levels.find((l) => l.name === badge.levels[0]);
      return html`<g class="flow-route-group ${routeClass(draw.route)}" id="${draw.route.id}" data-names="${draw.route.names.join(", ")}" data-derived="${draw.route.derived ? "true" : "false"}" data-stops="${draw.route.stops.join(" ")}" data-edges="${draw.route.edges.join(" ")}"${draw.route.rail === undefined ? null : raw(` data-rail="${draw.route.rail}"`)} data-trust="${draw.route.trust.join(" ")}" data-controls="${draw.route.controls.join(" ")}" data-structure-select="${draw.route.id}" role="button" tabindex="0" aria-pressed="${selection.id === draw.route.id ? "true" : "false"}" aria-label="${routeName(draw.route)}: ${draw.route.stops.map((stop) => flowName(byFolder.get(stop)!)).join(", ")}${draw.route.derived ? "" : `; trust ${trustWords(draw.route)}`}${draw.route.noControl ? "; no control" : ""}">
      <title>${routeName(draw.route)}: ${draw.route.stops.map((stop) => flowName(byFolder.get(stop)!)).join(" → ")}${draw.route.rail === undefined ? "" : ` → ${byFolder.get(draw.route.rail)!.name} (rail)`}${draw.route.derived ? "" : ` · trust in: ${trustWords(draw.route)}`}</title>
      <path class="flow-line flow-route" data-line="${draw.route.id}" d="${pathD(draw.path)}" stroke="${draw.color}"/>
      <g class="flow-token${draw.route.derived ? " flow-derived" : ""}">${originToken([...texts(`origin ${draw.route.id} `), ...texts(`trust ${draw.route.id}`)], draw.color)}</g>
      ${badge === undefined ? null : html`<g class="flow-trust${draw.route.noControl ? " flow-trust-nocontrol" : badge.levels.length === 0 ? " flow-trust-unknown" : ""}" data-trust-badge="${badgeWords(draw.route)}" data-no-control="${draw.route.noControl ? "true" : "false"}"${level === undefined ? null : raw(` data-structure-select="${level.id}" role="button" tabindex="0" aria-label="trust level ${level.name}: ${level.meaning.replace(/"/g, "&quot;")}"`)}><title>${draw.route.noControl ? "No control: no chokepoint or crossing stands where this route's work enters or on any interface it takes, and the trust its entrances carry in is unknown (no crossing's chokepoint is their handler), so the map treats it as untrusted." : badge.levels.length === 0 ? "Trust in: unknown. No crossing's chokepoint is these entrances' handler, so the trust they carry in is not derived; the map treats it as untrusted." : `Trust in: ${badge.levels.join(", ")}, the entering side of the crossing whose chokepoint is these entrances' handler.`}</title><rect class="flow-trust-box" x="${badge.box.x}" y="${badge.box.y}" width="${badge.box.w}" height="${badge.box.h}" rx="7"/>${texts(`trust ${draw.route.id}`).map(renderText)}</g>`}
      <g class="flow-terminus${draw.route.derived ? " flow-derived" : ""}">${texts(`origin ${draw.route.id} `).map(renderText)}</g>
    </g>`;
    })}
    <g class="flow-motion" aria-hidden="true">${pulses.map(renderPulse)}${pulses.map(renderChevrons)}</g>
    ${[...layout.stations.entries()].map(([folder, station]) => renderStation(byFolder.get(folder)!, station, layout.texts, selection, selected, model, standingOf(folder)))}
    ${layout.tags.map((tag) => {
      const where = tag.rail !== undefined ? raw(` data-rail="${tag.rail}"`) : tag.route !== undefined ? raw(` data-entry="${tag.route}"`) : tag.node !== undefined ? raw(` data-node="${tag.node}"`) : raw(` data-edge="${tag.edge!.id}"`);
      const route = tag.route === undefined ? undefined : model.routes.find((r) => r.id === tag.route);
      const on = tag.rail !== undefined ? `the ${byFolder.get(tag.rail)!.name} rail` : route !== undefined ? `the entrance line of ${routeName(route)}` : tag.node !== undefined ? byFolder.get(tag.node)!.name : `${tag.edge!.from} to ${tag.edge!.to}`;
      const verdict = tag.chokepoint === undefined ? undefined : model.identifiers.find((i) => i.chokepoint === tag.chokepoint)?.verdict.label;
      const repeat = tag.kind === "identifier" && tag.repeat ? "; drawn in full elsewhere" : "";
      const what = tag.kind === "identifier"
        ? raw(` data-identifier="${tag.text}" data-state="${tag.state}"${tag.rail !== undefined ? ` data-edges="${tag.edges.join(" ")}"` : ""} data-structure-select="${tag.chokepoint}" role="button" tabindex="0" aria-label="${tag.text}: ${tag.name.replace(/"/g, "&quot;")}, ${verdict ?? ""}${repeat}" data-shape="${tag.shape}" data-repeat="${tag.repeat ? "true" : "false"}"`)
        : tag.kind === "broken"
          ? raw(` data-mark="broken" data-state="broken" data-structure-select="${flowBrokenId(tag.node!)}" role="button" tabindex="0" aria-label="${tag.text} in ${on}: ${tag.name.replace(/"/g, "&quot;")}"`)
          : tag.kind === "boundary"
            ? raw(` data-mark="boundary" data-state="${tag.state}" data-structure-select="${flowBoundaryId(tag.node!)}" role="button" tabindex="0" aria-label="${tag.name.replace(/"/g, "&quot;")}"`)
            : tag.kind === "uncovered"
              ? raw(` data-mark="uncovered" data-structure-select="${flowHealthId("uncovered")}" role="button" tabindex="0" aria-label="${on}: not covered, no enforcement covers it"`)
              : raw(` data-mark="${tag.kind}" data-structure-select="${tag.edge!.id}" role="button" tabindex="0" aria-label="${tag.kind === "bypass" ? `${plural(tag.edge!.bypasses.length, "bypass", "bypasses")}` : `${tag.edge!.identifiers.length - 1} more interface identifiers`} on ${on}"`);
      const key = tag.kind === "broken" || tag.kind === "boundary" || tag.kind === "uncovered" ? `mark ${tag.kind} ${tag.node}` : tag.rail !== undefined ? `tag rail ${tag.rail} ${tag.text}` : tag.route !== undefined ? `tag entry ${tag.route} ${tag.text}` : `tag ${tag.edge!.id} ${tag.text}`;
      const title = tag.kind === "identifier"
        ? `${tag.text}: ${tag.name}, ${verdict ?? ""} · on ${on}${tag.repeat ? " · drawn in full elsewhere; select to see where it stands" : ""}`
        : tag.kind === "bypass" ? `broken: ${plural(tag.edge!.bypasses.length, "bypass", "bypasses")} on ${on}`
          : tag.kind === "broken" ? `${on}: broken chokepoints ${tag.name}`
            : tag.kind === "boundary" ? `${tag.name}: trust boundaries on no drawn interface`
              : tag.kind === "uncovered" ? `${on} is not covered: no chokepoint stands on an interface it exposes or where work enters it, and none of its invariants is verified by a totality oracle`
                : `${tag.edge!.identifiers.join(", ")} on ${on}`;
      const tick = ticks.get(tag);
      const style = tick === undefined ? null : raw(` style="animation-duration: ${tick.duration}s; animation-delay: ${tick.delay}s; animation-iteration-count: ${FLOW_PULSE_PLAYS}"`);
      const selectedTag = tagClass(tag).includes("is-selected");
      return html`<g class="${tagClass(tag)}"${where}${what}${style}>
        <title>${title}</title>
        ${selectedTag ? html`<rect class="flow-tag-halo" x="${r1(tag.box.x - 3)}" y="${r1(tag.box.y - 3)}" width="${r1(tag.box.w + 6)}" height="${r1(tag.box.h + 6)}" rx="5"/>` : null}
        ${tag.boundary === undefined ? null : html`<line class="flow-boundary" x1="${tag.boundary.x1}" y1="${tag.boundary.y1}" x2="${tag.boundary.x2}" y2="${tag.boundary.y2}"/>`}
        ${tagShape(tag)}
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
  const lightRails = FLOW_RAIL_COLORS.map(([l], i) => `--flow-key-rail-${i}: ${l};`).join(" ");
  const darkRails = FLOW_RAIL_COLORS.map(([, d], i) => `--flow-key-rail-${i}: ${d};`).join(" ");
  return `.flow { ${light} ${lightRails} --flow-key-neutral: ${FLOW_NEUTRAL_ROUTE[0]}; }\n@media (prefers-color-scheme: dark) { .flow { ${dark} ${darkRails} --flow-key-neutral: ${FLOW_NEUTRAL_ROUTE[1]}; } }`;
}

function routeStops(model: FlowModel, route: FlowRoute): string {
  const name = (folder: string): string => {
    const node = model.nodes.find((n) => n.folder === folder);
    return node === undefined ? folder : flowName(node);
  };
  return `${route.stops.map(name).join(" → ")}${route.rail === undefined ? "" : ` → ${name(route.rail)} (rail)`}`;
}

function routeRow(model: FlowModel, route: FlowRoute): Markup {
  const trust = route.derived ? "" : ` · trust ${trustWords(route)}${route.noControl ? " · no control" : ""}`;
  return flowRow(flowPick(route.id, routeName(route)), `${routeStops(model, route)}${trust}`, "line", routeSwatch(route));
}

/** A route's trust and its controls, in one short block: what the security reader asks of every route first. */
function renderRouteTrust(state: ShellState, route: FlowRoute): Markup {
  if (route.derived) return html``;
  return html`${flowFacts([
    [html`${termLink(state, "trust level", "Trust")} in`, route.trust.length === 0 ? html`<span data-field="trust">unknown</span> <span class="flow-meta">no crossing's chokepoint is its entrances' handler, so the trust they carry in is not derived; treated as untrusted</span>` : html`<span data-field="trust">${route.trust.join(", ")}</span>`],
    ["Controls on it", route.controls.length === 0 ? html`<span class="flow-attention" data-field="controls">no control</span> <span class="flow-meta">no chokepoint or crossing stands where its work enters or on any interface it takes</span>` : html`<span data-field="controls">${route.controls.join(" ")}</span>`],
  ])}`;
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
    case "broken":
      return `${count} broken: structural defects and requirements with a broken chokepoint`;
    case "uncovered":
      return `${count} ${count === 1 ? "component" : "components"} not covered`;
    case "escalations":
      return `${count} ${count === 1 ? "escalation" : "escalations"} awaiting a human`;
  }
}

/** The part of a trust level's meaning before its first colon or full stop: its definition in one line. */
function levelLine(meaning: string): string {
  const cut = /^(.+?)(?::\s|\.\s|\.$|;\s)/.exec(meaning.trim());
  return (cut?.[1] ?? meaning).trim();
}

/**
 * The health strip at the top of the map: every count is a selection, and its
 * inspector lists the set. A broken count that sits in one component selects
 * that component's broken mark, which the page scrolls into view. Beneath it,
 * the trust-level key: each level a selection, defined in one line, and what
 * an unknown trust means.
 */
function renderHealthStrip(model: FlowModel, selected: string | undefined): Markup {
  const counts: Record<FlowHealthKind, number> = { verified: model.health.verified.length, requirements: model.health.requirements.length, defects: model.health.defects.length, bypassed: model.health.bypassed.length, broken: flowHealthMembers(model, "broken").length, uncovered: model.health.uncovered.length, escalations: model.health.escalations.length };
  const shown = FLOW_HEALTH_KINDS.filter((kind) => kind !== "broken" && (kind === "verified" || kind === "requirements" || kind === "defects" || counts[kind] > 0));
  const nothingEnforced = counts.verified === 0 && counts.requirements > 0;
  // A broken count held by one component selects that component's broken mark: the map's one broken place, one click away.
  const target = (kind: FlowHealthKind): string => {
    if ((kind !== "defects" && kind !== "bypassed") || counts[kind] === 0) return flowHealthId(kind);
    const members = new Set(flowHealthMembers(model, kind).map((m) => `${m.component}\u0000${m.name}`));
    const holders = model.nodes.filter((node) => node.invariants.some((i) => members.has(`${i.component}\u0000${i.name}`)));
    return holders.length === 1 && holders[0]!.defects.length > 0 ? flowBrokenId(holders[0]!.folder) : flowHealthId(kind);
  };
  const derived = model.routes.some((route) => !route.derived);
  return html`<div class="flow-health" data-field="health" role="group" aria-label="Health">
    ${shown.map((kind) => html`<button type="button" class="flow-health-count" data-health="${kind}" data-count="${String(counts[kind])}" data-structure-select="${target(kind)}" aria-pressed="${selected === target(kind) || selected === flowHealthId(kind) ? "true" : "false"}"><span class="flow-health-swatch" aria-hidden="true"></span><strong>${String(counts[kind])}</strong> ${healthWords(kind, counts[kind]).replace(/^\d+ /, "")}</button>`)}
    ${nothingEnforced ? html`<p class="flow-health-note" data-field="nothing-enforced">Nothing is enforced yet: every declared invariant is still a requirement, so no identifier on this map is a working control.</p>` : null}
    ${model.levels.length === 0 ? null : html`<div class="flow-trust-key" data-field="trust-key">
      <p class="flow-trust-key-title">Trust levels <span class="flow-meta">each entrance's badge says which it carries in; select one to see where its crossings stand</span></p>
      <ul>${model.levels.map((level) => html`<li><button type="button" class="flow-trust-level" data-structure-select="${level.id}" aria-pressed="${selected === level.id ? "true" : "false"}" title="${level.meaning}"><code>${level.name}</code></button> <span>${levelLine(level.meaning)}</span></li>`)}${derived ? html`<li data-level="unknown"><span class="flow-trust-level flow-trust-unknown"><code>unknown</code></span> <span>not derived, treated as untrusted</span></li><li data-level="no-control"><span class="flow-trust-level flow-trust-nocontrol"><code>no control</code></span> <span>unknown, and nothing on the route controls it</span></li>` : null}</ul>
    </div>`}
  </div>`;
}

function renderHealthInspector(state: ShellState, model: FlowModel, kind: FlowHealthKind): Markup {
  if (kind === "escalations") {
    return html`<div class="flow-inspect" data-kind="health" data-health="${kind}">
      ${flowHead("Health", html`${healthWords(kind, model.health.escalations.length)}`, `${flowHealthId(kind)}-heading`, "Each waits for a human to acknowledge it.")}
      <ul class="flow-rows" data-field="members">${model.health.escalations.map((e) => html`<li class="flow-row"><a class="flow-pick" href="#journal-${slug(e.id)}">${e.id}</a><span class="flow-meta">${e.what}</span></li>`)}</ul>
    </div>`;
  }
  if (kind === "uncovered") {
    const nodes = model.health.uncovered.map((folder) => model.nodes.find((n) => n.folder === folder)!);
    return html`<div class="flow-inspect" data-kind="health" data-health="${kind}">
      ${flowHead("Health", html`${healthWords(kind, nodes.length)}`, `${flowHealthId(kind)}-heading`, html`No ${termLink(state, "chokepoint")} stands on a ${termLink(state, "component interface")} it exposes or where work enters it, and none of its invariants is verified by a ${termLink(state, "totality oracle")}. Each carries a hollow bar and a not-covered mark.`)}
      ${nodes.length === 0 ? html`<p class="flow-note">None: every component is covered.</p>` : html`<ul class="flow-rows" data-field="members">${nodes.map((node) => html`<li class="flow-row" data-component="${node.folder}">${flowPick(node.id, flowName(node))}<span class="flow-meta">${node.core ? `core dependency, called by ${node.in}` : `called by ${node.in}`}; ${node.invariants.length === 0 ? "declares no invariant" : stateWords(node).replace(/; not covered$/, "")}</span></li>`)}</ul>`}
    </div>`;
  }
  const members = flowHealthMembers(model, kind);
  const summary = kind === "verified"
    ? html`Each is an ${termLink(state, "invariant")}: enforced, its enforcement seen to fire, and verified by the latest run that checked it.`
    : kind === "requirements"
      ? html`Each is a ${termLink(state, "requirement")}: declared, and nothing yet detects its violation, so it is not enforced. Its identifier on the map is hatched, not solid.`
      : kind === "defects"
        ? html`Each is a ${termLink(state, "structural defect")}: an invariant whose enforcement no longer holds.`
        : kind === "broken"
          ? html`Each is broken: a ${termLink(state, "structural defect")}, or a ${termLink(state, "requirement")} whose ${termLink(state, "chokepoint")} check found a ${termLink(state, "bypass")}.`
          : html`Each is a ${termLink(state, "requirement")} whose ${termLink(state, "chokepoint")} check found a ${termLink(state, "bypass")}: broken, though never enforced.`;
  const byComponent = [...new Set(members.map((m) => m.component))];
  return html`<div class="flow-inspect" data-kind="health" data-health="${kind}">
    ${flowHead("Health", html`${healthWords(kind, members.length)}`, `${flowHealthId(kind)}-heading`, summary)}
    ${members.length === 0 ? html`<p class="flow-note">None.</p>` : join(byComponent.map((component) => {
      const holder = model.nodes.find((n) => n.invariants.some((i) => i.component === component) && n.defects.length > 0);
      return html`<h4>${component === "." ? "The root" : component} <span class="flow-count">${members.filter((m) => m.component === component).length}</span>${(kind === "broken" || kind === "bypassed" || kind === "defects") && holder !== undefined ? html` ${flowPick(flowBrokenId(holder.folder), "see the bypass sites")}` : null}</h4><ul class="flow-rows" data-field="members">${members.filter((m) => m.component === component).map((m) => invariantRow(model, m))}</ul>`;
    }))}
  </div>`;
}

function renderFlowSummary(state: ShellState, model: FlowModel, previews: readonly StructurePreview[]): Markup {
  const bearing = model.edges.filter((edge) => edge.loadBearing).length;
  const broken = model.edges.filter((edge) => edge.bypasses.length > 0).length;
  const onRoutes = model.edges.filter((edge) => edge.routes.length > 0).length;
  const stubs = model.edges.filter((edge) => edge.stub).length;
  return html`<div class="flow-summary">
    ${flowHead("Nothing selected", html`The whole system`, undefined, `${plural(model.nodes.length, "component", "components")} and ${plural(model.edges.length, "component interface", "component interfaces")}. Select anything to trace it; the rest dims.`)}
    ${model.edges.length === 0 ? html`<p class="empty" data-field="no-interfaces">No component interface is known: ${model.evidence === "run sites only" ? "no latest run records a reference from one component into another's chokepoint or protected thing, and the language adapter was not asked." : "no component's code references another's."}</p>` : null}
    <h4>Where work enters</h4>
    ${model.routesFrom === "root interfaces" ? html`<p class="flow-note" data-field="derived-routes">No spec declares an entrance. Each route is ${termLink(state, "derived")} from one of the root component's component interfaces by ${termLink(state, "reference weight")}, not flow, and named for the first component it reaches.</p>` : null}
    ${model.entrances.length === 0 && model.routesFrom !== "root interfaces" ? html`<p class="flow-note" data-field="no-entrances">No spec declares an entrance, and there is no root component to derive routes from.</p>` : null}
    <ul class="flow-rows" data-field="routes">${model.routes.map((route) => routeRow(model, route))}</ul>
    ${model.entrances.length === 0 ? null : html`<details class="flow-entrances"><summary>Entrances <span class="flow-count">${model.entrances.length}</span></summary><ul class="flow-rows">${model.entrances.map((e) => flowRow(flowPick(e.id, e.name, e.id), e.reachable ? `starts in ${e.start === "." ? "the root" : e.start}${e.trust.length === 0 ? ", trust unknown" : `, carries ${e.trust.join(", ")}`}` : e.reason ?? ""))}</ul></details>`}
    <h4>Component interfaces</h4>
    ${flowFacts([
      ["On routes", `${onRoutes}`],
      [html`Stubs to ${termLink(state, "core dependency", "core dependencies")}`, `${stubs}`],
      ["Load-bearing", html`${bearing} <span class="flow-meta">a ${termLink(state, "chokepoint")} or a ${termLink(state, "crossing")} stands there</span>`],
      broken > 0 ? ["Broken", html`<span class="flow-bad">${broken}</span>`] : null,
      ["Others", html`${model.edges.length - onRoutes - stubs} <span class="flow-meta">drawn faint when a selection reaches them</span>`],
    ])}
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
    ${renderRouteTrust(state, route)}
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

/** How many of a component's invariants its inspector shows before folding the rest. */
const FLOW_INVARIANTS_SHOWN = 4;

/**
 * A component's inspector, in the order the owner asks of it: its verdict in
 * one line (broken first, and whether anything covers it), then who depends
 * on it (its callers, what a change to it affects) and what it uses, then its
 * invariants, the first few shown and the rest folded; its routes and
 * load-bearing interfaces after.
 */
function renderComponentInspector(state: ShellState, model: FlowModel, node: FlowNode): Markup {
  const out = model.edges.filter((edge) => edge.from === node.folder);
  const into = model.edges.filter((edge) => edge.to === node.folder);
  const bearing = [...out, ...into].filter((edge) => edge.loadBearing || edge.bypasses.length > 0);
  const through = model.routes.filter((r) => r.stops.includes(node.folder) || r.rail === node.folder);
  const count = (s: FlowState): number => node.invariants.filter((i) => i.verdict.state === s).length;
  const verdict = node.invariants.length === 0
    ? "It declares no invariant: nothing here is enforced."
    : [count("broken") > 0 ? `${count("broken")} broken` : "", count("requirement") > 0 ? `${plural(count("requirement"), "requirement", "requirements")} not enforced` : "", count("verified") > 0 ? `${count("verified")} verified` : ""].filter(Boolean).join(", ");
  const name = (folder: string): string => (folder === "." ? "root" : folder);
  const shown = node.invariants.slice(0, FLOW_INVARIANTS_SHOWN);
  const folded = node.invariants.slice(FLOW_INVARIANTS_SHOWN);
  return html`<div class="flow-inspect" data-kind="component">
    ${flowHead(node.core ? html`${termLink(state, "core dependency", "Core dependency")}` : html`${termLink(state, "component", "Component")}`, html`<a href="#${componentId(node.folder)}">${flowName(node)}</a>`, undefined, node.intent)}
    <p class="flow-verdict-line${count("broken") > 0 ? " flow-bad" : ""}" data-field="own-verdicts">${verdict}</p>
    ${node.covered ? null : html`<p class="flow-note flow-attention" data-field="uncovered">Not covered: no ${termLink(state, "chokepoint")} stands on an interface it exposes or where work enters it, and none of its invariants is verified by a ${termLink(state, "totality oracle")}.</p>`}
    ${node.defects.length === 0 ? null : html`<p><button type="button" class="flow-pick flow-action flow-bad" data-structure-select="${flowBrokenId(node.folder)}">${plural(node.defects.length, "broken chokepoint", "broken chokepoints")}: see the bypass sites</button></p>`}
    <h4 data-field="callers">Who depends on it <span class="flow-count">${into.length}</span> <span class="flow-meta">its callers: a change here reaches them</span></h4>
    ${into.length === 0 ? html`<p class="flow-note">Nothing calls it${node.declaresEntrance ? "; work enters here" : ""}.</p>` : html`<ul class="flow-rows">${into.map((edge) => flowRow(flowPick(edge.id, `← ${name(edge.from)}`), `${plural(edge.symbols.length, "symbol", "symbols")}${edge.identifiers.length === 0 ? "" : ` · ${edge.identifiers.join(" ")}`}`, "count"))}</ul>`}
    <h4 data-field="callees">What it uses <span class="flow-count">${out.length}</span></h4>
    ${out.length === 0 ? html`<p class="flow-note">It calls no other component.</p>` : html`<ul class="flow-rows">${out.map((edge) => flowRow(flowPick(edge.id, `→ ${name(edge.to)}`), `${plural(edge.symbols.length, "symbol", "symbols")}${edge.identifiers.length === 0 ? "" : ` · ${edge.identifiers.join(" ")}`}`, "count"))}</ul>`}
    <h4 data-field="own-invariants">Its invariants <span class="flow-count">${node.invariants.length}</span></h4>
    ${node.invariants.length === 0 ? null : html`<ul class="flow-rows" data-field="invariants">${shown.map((ref) => invariantRow(model, ref))}</ul>${folded.length === 0 ? null : html`<details class="flow-more flow-invariants-more"><summary>+${folded.length} more</summary><ul class="flow-rows">${folded.map((ref) => invariantRow(model, ref))}</ul></details>`}`}
    ${node.boundary.length === 0 ? null : html`<p><button type="button" class="flow-pick flow-action" data-structure-select="${flowBoundaryId(node.folder)}">${plural(node.boundary.length, "crossing", "crossings")} inside it</button></p>`}
    ${node.children > 0 ? html`<p><button type="button" class="flow-pick flow-action" data-structure-expand="${node.folder}">${node.expanded ? "Close" : "Open"} its ${plural(node.children, "component", "components")} in place</button></p>` : null}
    ${node.core ? html`<p class="flow-note" data-field="core">A core dependency: ${CORE_RULE}. Drawn as a rail; each caller's stub runs down to it.</p>` : null}
    <h4 data-field="routes">Structural routes through it (${through.length})</h4>
    <ul class="flow-rows">${through.map((route) => routeRow(model, route))}</ul>
    <h4 data-field="load-bearing">Load-bearing here (${bearing.length})</h4>
    ${bearing.length === 0 ? html`<p class="flow-note">No chokepoint or crossing stands on its component interfaces.</p>` : html`<ul class="flow-rows">${bearing.map((edge) => flowRow(flowPick(edge.id, edgeName(edge)), flowLabelLines(edge).map((l) => l.text).join(", ")))}</ul>`}
    ${flowFacts([["Folder", html`<code>${node.folder}</code>`]])}
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

/** The key's hatch, drawn as the map draws a requirement's identifier. */
const KEY_HATCH = '<defs><pattern id="flow-key-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.2" height="4" fill="var(--flow-key-quiet)"/></pattern></defs>';

/** The key below the map: each mark and what it is, the terms it uses, and how the map is laid out, folded beneath. */
function renderFlowKey(state: ShellState): Markup {
  return html`<div class="flow-key" data-field="key">
    <ul aria-label="Map key">
      ${keyItem('<path d="M1 7 H27" stroke="var(--flow-key-route-0)" stroke-width="3.5"/>', html`${termLink(state, "structural route", "Structural route")}: the path its entrances' handler takes; its origin token names up to four entrances and counts the rest, and the pill in it is the ${termLink(state, "trust level")} they carry in (dashed: unknown, not derived, treated as untrusted)`)}
      ${keyItem('<rect x="2" y="2" width="24" height="10" rx="3" fill="none" stroke="currentColor" stroke-dasharray="3 2"/>', html`${termLink(state, "derived", "Derived")} route: no entrance declared, drawn by ${termLink(state, "reference weight")}, not flow`)}
      ${keyItem('<rect x="2" y="1.5" width="24" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="3.5" width="2.5" height="7" rx="1" fill="currentColor"/>', html`${termLink(state, "component", "Component")}: its name, its role, its folder; the bar at its left is its worst verdict; a heavier border declares an entrance`)}
      ${keyItem('<rect x="4" y="1.5" width="20" height="11" rx="2.5" fill="var(--flow-key-verified)"/><text x="8" y="10.2" font-size="8.5" font-weight="500" fill="var(--paper)">C</text>', html`${termLink(state, "interface identifier", "Interface identifier")}, solid fill: its ${termLink(state, "invariant")} is enforced and verified`)}
      ${keyItem(`${KEY_HATCH}<rect x="4" y="1.5" width="20" height="11" rx="2.5" fill="url(#flow-key-hatch)" stroke="currentColor"/><text x="8" y="10.2" font-size="8.5" font-weight="500" fill="currentColor">C</text>`, html`Hollow and hatched: a ${termLink(state, "requirement")}, not enforced, so not a working control`)}
      ${keyItem('<rect x="4" y="1.5" width="20" height="11" rx="2.5" fill="var(--flow-key-broken)"/><text x="8" y="10.2" font-size="8.5" font-weight="500" fill="#fff">C</text>', html`Red fill: broken, a ${termLink(state, "structural defect")} or a ${termLink(state, "chokepoint")} with a ${termLink(state, "bypass")}; a component with one carries a red broken mark that lists its bypass sites. Red means broken and nothing else`)}
      ${keyItem('<rect x="1" y="2" width="11" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M17 2 H24 L27 7 L24 12 H17 L14 7 Z" fill="none" stroke="currentColor" stroke-width="1.3"/>', html`C = ${termLink(state, "chokepoint")}, rounded: the one site every reference to a protected thing passes. X = ${termLink(state, "crossing")}, pointed: a chokepoint whose invariant names the trust levels on either side of it`)}
      ${keyItem('<circle cx="7" cy="7" r="4" fill="var(--flow-key-verified)"/><path d="M20 2 L25 7 L20 12 L15 7 Z" fill="var(--flow-key-verified)"/>', "A dot: the same identifier drawn in full elsewhere on the map; select it to select that identifier")}
      ${keyItem('<path d="M14 0 V14" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/><path d="M1 7 H27" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>', html`Trust boundary: where a crossing's ${termLink(state, "trust level")} changes, on its interface, on the line where work enters, or dashed along a component's edge for the crossings inside it (their count shows when a trust level or the component is selected)`)}
      ${keyItem('<rect x="1" y="2" width="26" height="10" rx="3" fill="none" stroke="var(--flow-key-attention)" stroke-width="1.4"/>', html`Amber, attention, not breakage: <strong>no control</strong>, the pill of an untrusted route with no chokepoint or crossing where its work enters or on any interface it takes; <strong>not covered</strong>, on a component no enforcement covers, whose bar is hollow`)}
      ${keyItem('<path d="M1 11 H27" stroke="var(--flow-key-rail)" stroke-width="4" stroke-linecap="round"/><path d="M8 1 V11" stroke="var(--flow-key-rail)" stroke-width="1.5"/>', html`${termLink(state, "core dependency", "Core dependency")} (rail) and a caller's stub to it`)}
      ${keyItem('<rect x="3" y="2" width="22" height="10" rx="3" fill="none" stroke="var(--flow-key-halo)" stroke-width="5"/><rect x="3" y="2" width="22" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>', "Selected: a neutral halo and a heavier border, never a route's color")}
      ${keyItem('<path d="M1 4 H27" stroke="currentColor" stroke-width="1.8"/><path d="M1 10 H27" stroke="currentColor" stroke-width="1.6" stroke-dasharray="5 3"/>', "With a component selected: solid, a caller that depends on it; dashed, a callee it uses")}
      ${keyItem('<path d="M1 7 H27" stroke="var(--flow-key-quiet)" stroke-width="1.6"/>', "Load-bearing interface on no route")}
      ${keyItem('<path d="M1 7 H27" stroke="var(--flow-key-quiet)" stroke-width="1.4" stroke-dasharray="5 4"/>', "Interface a selection reached")}
      ${keyItem('<path d="M1 7 H27" stroke="var(--flow-key-quiet)" stroke-width="2"/><path d="M11 3 L15 7 L11 11" fill="none" stroke="currentColor" stroke-width="1.6"/>', "Motion: selecting a route or a component sends a short pulse along its lines, caller to callee, twice, then it rests; hover replays it. With reduced motion, chevrons point the same way")}
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
        <li>The map opens on ${DEFAULT_RULE}.</li>
      </ul>
    </details>
  </div>`;
}

/**
 * The canvas and what says it scrolls: when the map is wider than the room it
 * has, a hint above it and a fade at the edge it continues past. Both are
 * CSS alone, from the map's own width, which the layout already knows.
 */
function renderCanvas(model: FlowModel, selected: string | undefined, previews: readonly StructurePreview[]): Markup {
  const svg = renderFlowSvg(model, selected, previews);
  const width = /width="(\d+)"/.exec(svg.text.slice(svg.text.indexOf("<svg")))?.[1] ?? "0";
  return html`<div class="flow-canvas-wrap" data-map-width="${width}">
    <style>${raw(`@container flow-canvas (max-width: ${Number(width) - 1}px) { .flow-scroll-hint { display: block; } .flow-fade-end { display: block; } }`)}</style>
    <p class="flow-scroll-hint" data-field="scroll-hint">The map is wider than this window: scroll it sideways to see the rest →</p>
    <div class="flow-canvas-frame">
      <div class="flow-canvas" tabindex="0" role="region" aria-label="Scrollable Structure map">${svg}</div>
      <div class="flow-fade flow-fade-end" aria-hidden="true"></div>
    </div>
  </div>`;
}

/** The one map: the evidence it stands on, the health strip, the canvas and the inspector beside it, and its key. */
export function renderFlowSection(state: ShellState, previews: readonly StructurePreview[] = state.structure.preview, model: FlowModel = flowOf(state)): Markup {
  // A scaffold preview is what its page is for: it opens on the whole system with the proposal named, never on a broken component.
  const selected = previews.length > 0 && state.structure.selected === undefined ? undefined : flowSelected(model, state.structure.selected);
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
        ${renderCanvas(model, selected, previews)}
      </div>
      ${renderFlowInspector(state, model, selection, previews, state.structure.selected !== undefined)}
    </div>
    ${renderFlowKey(state)}
  </section>`;
}
