/**
 * The Structure map's render: components in their columns and bands, one
 * arrow per component interface from caller to callee, load-bearing ones
 * labelled by what the invariants reveal, and an inspector for what the
 * reader selected. Every coordinate is computed here from the model on each
 * render; no position is stored or read.
 */

import { componentId, invariantId, plural, relianceOf, type RelianceSite } from "./derive.ts";
import { html, join, raw, type Markup } from "./html.ts";
import type { ShellState, StructurePreview } from "./model.ts";
import {
  FLOW_BANDS,
  FLOW_CHANGE_ID,
  flowLabelLines,
  flowName,
  flowOf,
  flowSelection,
  type FlowChokepoint,
  type FlowEdge,
  type FlowEntrance,
  type FlowLabelLine,
  type FlowLevel,
  type FlowModel,
  type FlowNode,
  type FlowSelection,
} from "./structure-flow.ts";

const FLOW_NODE_W = 136;
const FLOW_NODE_H = 62;
const FLOW_GAP_X = 12;
const FLOW_BAND_H = 124;
const FLOW_PAD = 24;
const FLOW_TOP = 30;
const FLOW_LINE = 14;

const FLOW_SVG_STYLE = `
.flow-svg {
  --flow-surface: #fbfcfe;
  --flow-ink: #172033;
  --flow-muted: #5c677d;
  --flow-node: #eef2ff;
  --flow-node-border: #6073a8;
  --flow-quiet: #9aa5bd;
  --flow-bearing: #1f4fb8;
  --flow-defect: #c32836;
  --flow-proposed: #8b5e19;
  --flow-label: #ffffff;
  --flow-lit: #d97706;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.flow-svg .flow-surface { fill: var(--flow-surface); }
.flow-svg .flow-caption { fill: var(--flow-muted); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
.flow-svg .flow-band { stroke: var(--flow-node-border); stroke-opacity: 0.14; stroke-dasharray: 3 5; }
.flow-svg .flow-node rect { fill: var(--flow-node); stroke: var(--flow-node-border); stroke-width: 1.5; }
.flow-svg .flow-node.flow-entrance rect { stroke-width: 2.5; }
.flow-svg .flow-node.flow-unconnected rect, .flow-svg .flow-mass rect { fill: var(--flow-surface); stroke-dasharray: 4 4; }
.flow-svg .flow-node.flow-broken rect { stroke: var(--flow-defect); }
.flow-svg .flow-node-name { fill: var(--flow-ink); font-size: 13px; font-weight: 700; }
.flow-svg .flow-node-folder, .flow-svg .flow-node-counts { fill: var(--flow-muted); font-size: 10.5px; }
.flow-svg .flow-node-mark { fill: var(--flow-defect); font-size: 10.5px; font-weight: 700; }
.flow-svg .flow-node-tag { fill: var(--flow-bearing); font-size: 10.5px; font-weight: 700; }
.flow-svg .flow-edge path { fill: none; stroke: var(--flow-quiet); stroke-width: 1.2; }
.flow-svg .flow-edge.flow-bearing path { stroke: var(--flow-bearing); stroke-width: 2.4; }
.flow-svg .flow-edge.flow-defect path { stroke: var(--flow-defect); stroke-width: 2.8; stroke-dasharray: 7 4; }
.flow-svg .flow-edge path.flow-edge-hit { stroke: transparent; stroke-width: 14; stroke-dasharray: none; }
.flow-svg .flow-edge.flow-quiet path:not(.flow-edge-hit) { stroke-opacity: 0.55; }
.flow-svg .flow-label { display: none; }
.flow-svg .flow-edge.flow-labelled .flow-label, .flow-svg .flow-edge:hover .flow-label, .flow-svg .flow-edge:focus .flow-label { display: inline; }
.flow-svg .flow-label rect { fill: var(--flow-label); stroke: var(--flow-quiet); stroke-opacity: 0.6; }
.flow-svg .flow-label text { fill: var(--flow-ink); font-size: 11px; }
.flow-svg .flow-label .flow-label-count { fill: var(--flow-muted); }
.flow-svg .flow-label .flow-label-defect { fill: var(--flow-defect); font-weight: 700; }
.flow-svg .flow-label .flow-label-chokepoint { font-weight: 700; }
.flow-svg .structure-edge.structure-proposed { fill: none; stroke: var(--flow-proposed); stroke-width: 2; stroke-dasharray: 9 6; }
.flow-svg .structure-proposed-word { fill: var(--flow-proposed); font-size: 11px; font-weight: 700; }
.flow-svg [data-structure-select], .flow-svg [data-structure-expand] { cursor: pointer; }
.flow-svg [data-structure-select]:focus { outline: none; }
.flow-svg .flow-node:focus rect, .flow-svg .flow-node.is-selected rect { stroke: var(--flow-lit); stroke-width: 3; }
.flow-svg .flow-edge.is-lit path:not(.flow-edge-hit) { stroke: var(--flow-lit); stroke-width: 3; }
.flow-svg .flow-edge.flow-defect.is-lit path:not(.flow-edge-hit) { stroke: var(--flow-defect); }
.flow-svg .flow-edge:focus path:not(.flow-edge-hit), .flow-svg .flow-edge.is-selected path:not(.flow-edge-hit) { stroke-width: 4; }
.flow-svg .flow-node.is-lit rect { stroke: var(--flow-lit); stroke-width: 2.5; }
.flow-svg .is-dim { opacity: 0.14; }
@media (prefers-color-scheme: dark) {
  .flow-svg {
    --flow-surface: #111827;
    --flow-ink: #f3f6ff;
    --flow-muted: #b5bfd3;
    --flow-node: #202b43;
    --flow-node-border: #91a7df;
    --flow-quiet: #5d6a85;
    --flow-bearing: #9bb7ff;
    --flow-defect: #ff7480;
    --flow-proposed: #f2bd68;
    --flow-label: #111827;
    --flow-lit: #ffd166;
  }
}`;

/* --------------------------------------------------------------- layout */

export interface FlowBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FlowRoute {
  edge: FlowEdge;
  path: string;
  label: { x: number; y: number; w: number; h: number; lines: FlowLabelLine[] };
}

export interface FlowLayout {
  width: number;
  height: number;
  boxes: Map<string, FlowBox>;
  mass: FlowBox | undefined;
  captions: { y: number; text: string }[];
  bands: number[];
  routes: FlowRoute[];
}

function flowRound(value: number): number {
  return Math.round(value * 10) / 10;
}

function flowTruncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function flowBandY(band: number): number {
  return FLOW_PAD + FLOW_TOP + band * FLOW_BAND_H;
}

/**
 * Every coordinate of the map, from the model alone. A component's box is a
 * function of its own column and band, so no other component's facts move it.
 */
export function flowLayout(model: FlowModel): FlowLayout {
  const columns = model.nodes.length + (model.unowned !== undefined && model.unowned.files > 0 ? 1 : 0);
  const width = FLOW_PAD * 2 + Math.max(1, columns) * (FLOW_NODE_W + FLOW_GAP_X) - FLOW_GAP_X;
  const unconnectedBand = model.nodes.some((node) => node.band === undefined) || (model.unowned?.files ?? 0) > 0;
  const bandCount = FLOW_BANDS + (unconnectedBand ? 1 : 0);
  const height = flowBandY(bandCount - 1) + FLOW_NODE_H + FLOW_PAD;
  const boxes = new Map<string, FlowBox>();
  for (const node of model.nodes) {
    boxes.set(node.folder, { x: FLOW_PAD + node.column * (FLOW_NODE_W + FLOW_GAP_X), y: flowBandY(node.band ?? FLOW_BANDS), w: FLOW_NODE_W, h: FLOW_NODE_H });
  }
  const mass = model.unowned !== undefined && model.unowned.files > 0
    ? { x: FLOW_PAD + model.nodes.length * (FLOW_NODE_W + FLOW_GAP_X), y: flowBandY(FLOW_BANDS), w: FLOW_NODE_W, h: FLOW_NODE_H }
    : undefined;
  const captions = [
    { y: flowBandY(0) - 10, text: "entrances and callers" },
    { y: flowBandY(FLOW_BANDS - 1) - 10, text: "callees: the foundations" },
    ...(unconnectedBand ? [{ y: flowBandY(FLOW_BANDS) - 10, text: "no component interface" }] : []),
  ];
  const bands = Array.from({ length: bandCount - 1 }, (_, band) => flowRound(flowBandY(band + 1) - (FLOW_BAND_H - FLOW_NODE_H) / 2));

  // Ports: each box spreads its arrows along the side they leave or enter by, in the other end's order.
  const sideOf = (edge: FlowEdge): { out: "top" | "bottom"; in: "top" | "bottom" } => {
    const from = boxes.get(edge.from)!;
    const to = boxes.get(edge.to)!;
    if (to.y > from.y) return { out: "bottom", in: "top" };
    if (to.y < from.y) return { out: "top", in: "bottom" };
    return { out: "bottom", in: "bottom" };
  };
  const ports = new Map<string, number>();
  for (const node of model.nodes) {
    const box = boxes.get(node.folder)!;
    for (const side of ["top", "bottom"] as const) {
      const attached = model.edges
        .flatMap((edge) => [
          ...(edge.from === node.folder && sideOf(edge).out === side ? [{ key: `out ${edge.id}`, other: boxes.get(edge.to)! }] : []),
          ...(edge.to === node.folder && sideOf(edge).in === side ? [{ key: `in ${edge.id}`, other: boxes.get(edge.from)! }] : []),
        ])
        .sort((a, b) => a.other.x - b.other.x || a.key.localeCompare(b.key));
      attached.forEach((port, index) => ports.set(port.key, flowRound(box.x + ((index + 1) * box.w) / (attached.length + 1))));
    }
  }
  const routes: FlowRoute[] = model.edges.map((edge) => {
    const from = boxes.get(edge.from)!;
    const to = boxes.get(edge.to)!;
    const side = sideOf(edge);
    const x0 = ports.get(`out ${edge.id}`)!;
    const y0 = side.out === "bottom" ? from.y + from.h : from.y;
    const x1 = ports.get(`in ${edge.id}`)!;
    const y1 = side.in === "bottom" ? to.y + to.h : to.y;
    const reach = Math.max(34, Math.abs(y1 - y0) / 2);
    const c0 = side.out === "bottom" ? y0 + reach : y0 - reach;
    const c1 = side.in === "top" ? y1 - reach : y1 + reach;
    const path = `M ${x0} ${y0} C ${x0} ${flowRound(c0)}, ${x1} ${flowRound(c1)}, ${x1} ${y1}`;
    const lines = flowLabelLines(edge);
    const longest = lines.reduce((max, line) => Math.max(max, line.text.length), 0);
    const w = Math.ceil(longest * 6.1 + 12);
    const h = lines.length * FLOW_LINE + 6;
    // The curve's midpoint: the mean of its ends and control points, as a cubic's t = 0.5 is.
    const mx = (x0 + x1) / 2;
    const my = (y0 + 3 * c0 + 3 * c1 + y1) / 8;
    return { edge, path, label: { x: flowRound(Math.min(Math.max(mx - w / 2, 2), width - w - 2)), y: flowRound(my - h / 2), w, h, lines } };
  });
  return { width, height, boxes, mass, captions, bands, routes };
}

/* --------------------------------------------------------------- render */

function flowLit(selection: FlowSelection, lit: boolean): string {
  if (selection.kind === "none" || selection.kind === "change") return "";
  return lit ? "is-lit" : "is-dim";
}

function renderFlowNode(node: FlowNode, box: FlowBox, selection: FlowSelection, selected: string | undefined): Markup {
  const classes = [
    "flow-node",
    node.declaresEntrance || node.entrances.length > 0 ? "flow-entrance" : "",
    node.band === undefined ? "flow-unconnected" : "",
    node.defects.length > 0 ? "flow-broken" : "",
    flowLit(selection, selection.nodes.has(node.folder)),
    selected === node.id ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  const bypasses = node.defects.reduce((sum, d) => sum + d.bypasses, 0);
  const mark = node.defects.length === 0 ? undefined : `✕ ${plural(node.defects.length, "broken chokepoint", "broken chokepoints")}, ${plural(bypasses, "bypass", "bypasses")}`;
  const tag = node.entrances.length > 0 ? `▸ ${plural(node.entrances.length, "entrance", "entrances")}` : node.declaresEntrance ? "▸ declares entrances" : undefined;
  return html`<g class="${classes}" id="${node.id}" data-folder="${node.folder}" data-column="${String(node.column)}" data-band="${node.band === undefined ? "none" : String(node.band)}" data-structure-select="${node.id}" role="button" tabindex="0" aria-pressed="${selected === node.id ? "true" : "false"}" aria-label="${flowName(node)}, ${node.folder}, calls ${node.out}, called by ${node.in}${mark === undefined ? "" : `, ${mark}`}">
    <title>${flowName(node)} · ${node.folder} · calls ${node.out} · called by ${node.in}</title>
    <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="9"/>
    <text class="flow-node-name" x="${box.x + 10}" y="${box.y + 19}">${flowTruncate(flowName(node), 17)}</text>
    <text class="flow-node-folder" x="${box.x + 10}" y="${box.y + 33}">${flowTruncate(node.folder === "." ? "project root" : node.folder, 22)}</text>
    <text class="${mark === undefined ? "flow-node-tag" : "flow-node-mark"}" x="${box.x + 10}" y="${box.y + 47}">${flowTruncate(mark ?? tag ?? `calls ${node.out} · called by ${node.in}`, 23)}</text>
    ${node.children > 0 ? html`<text class="flow-node-counts" x="${box.x + 10}" y="${box.y + 58}" data-structure-expand="${node.folder}">${node.expanded ? `− ${node.children} open beside it` : `+ ${plural(node.children, "component", "components")} inside`}</text>` : null}
  </g>`;
}

function renderFlowEdge(route: FlowRoute, selection: FlowSelection, selected: string | undefined): Markup {
  const edge = route.edge;
  const lit = selection.edges.has(edge.id);
  // A label shows where it tells the story: on the selected interface, on every lit one when a trust level or a
  // chokepoint is selected (a few), and on the lit load-bearing or broken ones when a whole reach is lit.
  const labelled = selected === edge.id || (lit && (selection.kind === "level" || selection.kind === "chokepoint" || edge.loadBearing || edge.bypasses.length > 0));
  const classes = ["flow-edge", edge.bypasses.length > 0 ? "flow-defect" : edge.loadBearing ? "flow-bearing" : "flow-quiet", flowLit(selection, lit), selected === edge.id ? "is-selected" : "", labelled ? "flow-labelled" : ""].filter(Boolean).join(" ");
  const label = route.label;
  const text = label.lines.map((line) => line.text).join(" · ");
  return html`<g class="${classes}" id="${edge.id}" data-from="${edge.from}" data-to="${edge.to}" data-label="${text}" data-structure-select="${edge.id}" role="button" tabindex="0" aria-pressed="${selected === edge.id ? "true" : "false"}" aria-label="${edge.from} calls ${edge.to}: ${text}">
    <title>${edge.from} → ${edge.to}: ${text}</title>
    <path class="flow-edge-hit" d="${route.path}"/>
    <path d="${route.path}" marker-end="${edge.bypasses.length > 0 ? "url(#flow-arrow-defect)" : edge.loadBearing ? "url(#flow-arrow-bearing)" : "url(#flow-arrow)"}"/>
    <g class="flow-label">
      <rect x="${label.x}" y="${label.y}" width="${label.w}" height="${label.h}" rx="5"/>
      ${label.lines.map((line, index) => html`<text class="flow-label-${line.kind}" x="${label.x + 6}" y="${label.y + 14 + index * FLOW_LINE}">${line.text}</text>`)}
    </g>
  </g>`;
}

function renderFlowProposals(model: FlowModel, layout: FlowLayout, previews: readonly StructurePreview[]): Markup {
  return join(previews.map((preview, index) => {
    const folder = model.nodes.find((node) => node.folder === preview.component)?.folder ?? model.nodes[0]?.folder;
    const box = folder === undefined ? undefined : layout.boxes.get(folder);
    if (box === undefined) return html``;
    const x = box.x + box.w - 12 - index * 8;
    return html`<g class="flow-proposal" data-proposed="true">
      <path class="structure-edge structure-proposed" d="M ${x} ${box.y} L ${x} ${box.y - 22}"/>
      <text class="structure-proposed-word" x="${Math.max(4, x - 150)}" y="${box.y - 26}">proposed preview · ${flowTruncate(preview.name, 22)}</text>
    </g>`;
  }));
}

/** The deterministic SVG of the map for a model, a selection, and any ephemeral proposals. */
export function renderFlowSvg(model: FlowModel, selected: string | undefined, previews: readonly StructurePreview[] = []): Markup {
  const layout = flowLayout(model);
  const selection = flowSelection(model, selected);
  const byFolder = new Map(model.nodes.map((node) => [node.folder, node]));
  return html`<svg class="flow-svg" xmlns="http://www.w3.org/2000/svg" role="group" aria-labelledby="flow-svg-title" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" data-selected="${selection.id ?? ""}">
    <title id="flow-svg-title">Structure: ${plural(model.nodes.length, "component", "components")} and ${plural(model.edges.length, "component interface", "component interfaces")}, arrows from caller to callee</title>
    <style>${raw(FLOW_SVG_STYLE)}</style>
    <defs>
      <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-quiet)"/></marker>
      <marker id="flow-arrow-bearing" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-bearing)"/></marker>
      <marker id="flow-arrow-defect" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-defect)"/></marker>
    </defs>
    <rect class="flow-surface" x="0" y="0" width="${layout.width}" height="${layout.height}" rx="12"/>
    ${layout.bands.map((y) => html`<line class="flow-band" x1="${FLOW_PAD}" y1="${y}" x2="${layout.width - FLOW_PAD}" y2="${y}"/>`)}
    ${layout.captions.map((caption) => html`<text class="flow-caption" x="${FLOW_PAD}" y="${caption.y}">${caption.text}</text>`)}
    ${layout.routes.map((route) => renderFlowEdge(route, selection, selected))}
    ${[...layout.boxes.entries()].map(([folder, box]) => renderFlowNode(byFolder.get(folder)!, box, selection, selected))}
    ${layout.mass === undefined || model.unowned === undefined
      ? null
      : html`<g class="flow-mass" data-mass="unowned"><rect x="${layout.mass.x}" y="${layout.mass.y}" width="${layout.mass.w}" height="${layout.mass.h}" rx="9"/><text class="flow-node-name" x="${layout.mass.x + 10}" y="${layout.mass.y + 19}">No component</text><text class="flow-node-folder" x="${layout.mass.x + 10}" y="${layout.mass.y + 35}">${plural(model.unowned.files, "file", "files")}, ${plural(model.unowned.lines, "line", "lines")}</text></g>`}
    ${renderFlowProposals(model, layout, previews)}
  </svg>`;
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

function renderFlowSummary(model: FlowModel, previews: readonly StructurePreview[]): Markup {
  const bearing = model.edges.filter((edge) => edge.loadBearing).length;
  const broken = model.edges.filter((edge) => edge.bypasses.length > 0).length;
  return html`<div class="flow-summary">
    <p><strong>${plural(model.edges.length, "component interface", "component interfaces")}</strong> between ${plural(model.nodes.length, "component", "components")}; ${bearing} load-bearing (a chokepoint or a crossing stands there)${broken > 0 ? `, ${broken} broken` : ""}. Select to follow a story; everything else dims.</p>
    ${model.edges.length === 0 ? html`<p class="empty" data-field="no-interfaces">No component interface is known: ${model.evidence === "run sites only" ? "no latest run records a reference from one component into another's chokepoint or protected thing, and the language adapter was not asked." : "no component's code references another's."}</p>` : null}
    <h4>Where work enters</h4>
    ${model.entrances.length === 0
      ? html`<p class="quiet" data-field="no-entrances">No spec declares an entrance; the map starts from the components nothing calls.</p>`
      : html`<ul class="flow-picks">${model.entrances.map((e) => html`<li>${flowPick(e.id, e.name, html` <span class="quiet">${e.reachable ? `starts in ${e.start === "." ? "the root" : e.start}` : e.reason ?? ""}</span>`, e.id)}</li>`)}</ul>`}
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

function renderEntranceInspector(model: FlowModel, entrance: FlowEntrance, selection: FlowSelection): Markup {
  return html`<div class="flow-inspect" data-kind="entrance">
    <p class="eyebrow">Entrance</p>
    <h3 id="${entrance.id}">${entrance.name}</h3>
    <p>${entrance.meaning}</p>
    <p class="quiet">declared by <code>${entrance.declaredBy}</code> · handler <code>${entrance.handler ?? "none"}</code>${entrance.start === undefined ? "" : html` · starts in <code>${entrance.start}</code>`}</p>
    ${entrance.reachable ? html`<p>Lit: ${plural(selection.edges.size, "component interface", "component interfaces")} the work can reach from here.</p>` : html`<p class="empty" data-field="unreachable">${entrance.resolved ? "Unreachable" : "Unresolved"}: ${entrance.reason}</p>`}
    <ul class="flow-picks">${model.edges.filter((edge) => selection.edges.has(edge.id)).map((edge) => html`<li>${flowPick(edge.id, `${edge.from} → ${edge.to}`)}</li>`)}</ul>
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
      ? renderEntranceInspector(model, model.entrances.find((e) => e.id === selection.id)!, selection)
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
      <p class="quiet">${plural(model.nodes.length, "component", "components")} · ${plural(model.edges.length, "component interface", "component interfaces")} · ${plural(model.entrances.length, "entrance", "entrances")}</p>
    </div>
    ${renderEvidence(model)}
    <div class="flow-canvas" tabindex="0" role="region" aria-label="Scrollable Structure map">${renderFlowSvg(model, selected, previews)}</div>
    ${renderFlowInspector(state, model, selection, previews)}
    <p class="quiet flow-legend">An arrow points from caller to callee: every component interface is drawn. Blue arrows are load-bearing (a chokepoint or crossing stands there) and wear what the invariants reveal; grey ones are plain; dashed red is a bypass. A component's band comes from its own calls, so adding an interface moves only the two components it joins.</p>
  </section>`;
}
