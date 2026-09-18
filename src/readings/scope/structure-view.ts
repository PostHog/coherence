/**
 * The Structure view: declared trust levels as nodes and every invariant with
 * a crossing as a labelled edge. Coordinates are derived from the current
 * Structure model on every render; no layout state is read or written.
 *
 * The SVG is the compact visual reading. Each edge is paired with a native
 * details element containing the complete reliance evidence the latest run
 * actually carries. Missing and legacy site evidence remains explicitly
 * unknown rather than becoming an empty reliance list.
 */

import { invariantId, plural, structureOf, type RelianceSite, type StructureEdge, type StructureModel } from "./derive.ts";
import { html, join, raw, type Markup } from "./html.ts";
import type { ShellState, StructurePreview } from "./model.ts";

const STRUCTURE_HEADER_HEIGHT = 104;
const STRUCTURE_ROW_HEIGHT = 88;
const STRUCTURE_LEVEL_WIDTH = 180;
const STRUCTURE_MIN_WIDTH = 760;
const STRUCTURE_SIDE_PAD = 70;

const STRUCTURE_SVG_STYLE = `
.structure-svg {
  --structure-surface: #fbfcfe;
  --structure-ink: #172033;
  --structure-muted: #5c677d;
  --structure-guide: #d9deea;
  --structure-node: #eef2ff;
  --structure-node-border: #6073a8;
  --structure-edge: #405a93;
  --structure-defect: #c32836;
  --structure-proposed: #8b5e19;
  color-scheme: light dark;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.structure-svg .structure-surface { fill: var(--structure-surface); }
.structure-svg .structure-guide { stroke: var(--structure-guide); stroke-width: 1; }
.structure-svg .structure-node { fill: var(--structure-node); stroke: var(--structure-node-border); stroke-width: 1.5; }
.structure-svg .structure-node-name { fill: var(--structure-ink); font-size: 13px; font-weight: 700; }
.structure-svg .structure-edge { fill: none; stroke: var(--structure-edge); stroke-width: 2.5; }
.structure-svg .structure-edge.structure-defect { stroke: var(--structure-defect); stroke-width: 3; }
.structure-svg .structure-edge.structure-proposed { stroke: var(--structure-proposed); stroke-dasharray: 9 6; }
.structure-svg .structure-port { fill: var(--structure-surface); stroke: var(--structure-edge); stroke-width: 2; }
.structure-svg .structure-port.structure-defect { stroke: var(--structure-defect); }
.structure-svg .structure-port.structure-proposed { stroke: var(--structure-proposed); }
.structure-svg .structure-edge-name { fill: var(--structure-ink); font-size: 14px; font-weight: 700; }
.structure-svg .structure-edge-meta { fill: var(--structure-muted); font-size: 12px; }
.structure-svg .structure-edge-name.structure-defect,
.structure-svg .structure-edge-meta.structure-defect { fill: var(--structure-defect); }
.structure-svg .structure-proposed-word { fill: var(--structure-proposed); }
.structure-svg .structure-focus:focus { outline: none; }
.structure-svg .structure-focus:focus .structure-edge { stroke-width: 5; }
@media (prefers-color-scheme: dark) {
  .structure-svg {
    --structure-surface: #111827;
    --structure-ink: #f3f6ff;
    --structure-muted: #b5bfd3;
    --structure-guide: #344057;
    --structure-node: #202b43;
    --structure-node-border: #91a7df;
    --structure-edge: #9bb7ff;
    --structure-defect: #ff7480;
    --structure-proposed: #f2bd68;
  }
}`;

function structureChokepointText(edge: StructureEdge): string {
  if (edge.chokepoints.length === 0) return "chokepoint not declared";
  return edge.chokepoints.map((entry) => `${entry.chokepoint} protects ${entry.protects}`).join("; ");
}

function structureGradeText(edge: StructureEdge): string {
  if (edge.grade === undefined) return "grade unknown · enforcer unknown";
  return `${edge.grade} · enforced by ${edge.enforcer ?? "unknown"}`;
}

function structureStateText(edge: StructureEdge): string {
  const bypasses = plural(edge.bypassCount, "bypass", "bypasses");
  return edge.state === "structural defect" ? `${edge.state} · ${bypasses}` : edge.state;
}

function structureEdgeLine(edge: StructureEdge): string {
  const proposed = edge.proposed ? "proposed preview · " : "";
  return `${proposed}${edge.name} · ${structureChokepointText(edge)} · ${structureGradeText(edge)} · ${structureStateText(edge)}`;
}

function structureWidth(model: StructureModel): number {
  const levelsWidth = model.levels.length <= 1 ? STRUCTURE_MIN_WIDTH : STRUCTURE_SIDE_PAD * 2 + (model.levels.length - 1) * STRUCTURE_LEVEL_WIDTH;
  const longest = model.edges.reduce((length, edge) => Math.max(length, structureEdgeLine(edge).length), 0);
  return Math.max(STRUCTURE_MIN_WIDTH, levelsWidth, Math.ceil(longest * 7.2 + 40));
}

function structureLevelX(model: StructureModel, width: number): Map<string, number> {
  const positions = new Map<string, number>();
  if (model.levels.length === 1) {
    positions.set(model.levels[0]!.name, width / 2);
    return positions;
  }
  const span = width - STRUCTURE_SIDE_PAD * 2;
  const step = model.levels.length > 1 ? span / (model.levels.length - 1) : 0;
  model.levels.forEach((level, index) => positions.set(level.name, STRUCTURE_SIDE_PAD + step * index));
  return positions;
}

function structurePath(from: number, to: number, y: number): string {
  if (from === to) return `M ${from} ${y} C ${from - 34} ${y - 38}, ${from + 34} ${y - 38}, ${to} ${y}`;
  return `M ${from} ${y} L ${to} ${y}`;
}

function structureMarker(edge: StructureEdge): string {
  if (edge.state === "structural defect") return "url(#structure-arrow-defect)";
  if (edge.proposed) return "url(#structure-arrow-proposed)";
  return "url(#structure-arrow)";
}

function structureClass(edge: StructureEdge): string {
  return [edge.state === "structural defect" ? "structure-defect" : "", edge.proposed ? "structure-proposed" : ""].filter(Boolean).join(" ");
}

/** Render the deterministic inline SVG for an already-derived Structure model. */
export function renderStructureSvg(model: StructureModel): Markup {
  const width = structureWidth(model);
  const height = STRUCTURE_HEADER_HEIGHT + model.edges.length * STRUCTURE_ROW_HEIGHT + 24;
  const positions = structureLevelX(model, width);
  const fallbackFrom = 24;
  const fallbackTo = width - 24;
  return html`<svg class="structure-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="structure-svg-title structure-svg-description" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMinYMin meet">
    <title id="structure-svg-title">Security structure: ${plural(model.levels.length, "trust level", "trust levels")} and ${plural(model.edges.length, "crossing", "crossings")}</title>
    <desc id="structure-svg-description">Trust levels appear in declaration order. Each following row is one crossing-bearing invariant. Structural defects are red; proposed preview crossings are dashed.</desc>
    <style>${raw(STRUCTURE_SVG_STYLE)}</style>
    <defs>
      <marker id="structure-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--structure-edge)"/></marker>
      <marker id="structure-arrow-defect" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--structure-defect)"/></marker>
      <marker id="structure-arrow-proposed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--structure-proposed)"/></marker>
    </defs>
    <rect class="structure-surface" x="0" y="0" width="${width}" height="${height}" rx="12"/>
    ${model.levels.map((level) => {
      const x = positions.get(level.name)!;
      return html`<g class="structure-level" data-level="${level.name}">
        <title>${level.name}: ${level.meaning}</title>
        <line class="structure-guide" x1="${x}" y1="78" x2="${x}" y2="${height - 12}"/>
        <rect class="structure-node" x="${x - 64}" y="22" width="128" height="48" rx="10"/>
        <text class="structure-node-name" x="${x - 54}" y="51">${level.name}</text>
      </g>`;
    })}
    ${model.edges.map((edge, index) => {
      const y = STRUCTURE_HEADER_HEIGHT + index * STRUCTURE_ROW_HEIGHT + 18;
      const from = positions.get(edge.from) ?? fallbackFrom;
      const to = positions.get(edge.to) ?? fallbackTo;
      const classes = structureClass(edge);
      const relianceId = `${edge.id}-reliance`;
      const labelId = `${edge.id}-svg-label`;
      const descriptionId = `${edge.id}-svg-description`;
      return html`<g class="structure-focus" id="${edge.id}" data-component="${edge.component}" data-state="${edge.state}" data-proposed="${edge.proposed ? "true" : "false"}" tabindex="0" role="group" aria-labelledby="${labelId}" aria-describedby="${descriptionId}" aria-details="${relianceId}">
        <title>${structureEdgeLine(edge)}</title>
        <path class="structure-edge ${classes}" d="${structurePath(from, to, y)}" marker-end="${structureMarker(edge)}"/>
        <circle class="structure-port ${classes}" cx="${from}" cy="${y}" r="5"/>
        <circle class="structure-port ${classes}" cx="${to}" cy="${y}" r="5"/>
        <text id="${labelId}" class="structure-edge-name ${classes}" x="20" y="${y + 31}">${edge.proposed ? html`<tspan class="structure-proposed-word">proposed preview · </tspan>` : null}${edge.name}</text>
        <text id="${descriptionId}" class="structure-edge-meta ${classes}" x="20" y="${y + 51}">${edge.from} → ${edge.to} · ${structureChokepointText(edge)} · ${structureGradeText(edge)} · ${structureStateText(edge)}</text>
      </g>`;
    })}
  </svg>`;
}

function renderStructureSite(site: RelianceSite): Markup {
  const component = site.component?.folder ?? "outside declared components";
  return html`<li data-owner="${site.owner ? "true" : "false"}" data-test="${site.test ? "true" : "false"}" data-target="${site.target}" data-class="${site.siteClass}">
    <code>${site.file}:${site.line}</code> in <code>${site.symbol}</code>
    <span class="quiet">${component}</span>
    <span class="label">${site.target === "protected" ? "protected thing" : "chokepoint"}</span>
    <span class="label">${site.siteClass}</span>
    ${site.form === undefined ? null : html` <span class="label">${site.form}</span>`}
    ${site.owner ? html` <span class="label">owner</span>` : null}
    ${site.test ? html` <span class="label">test</span>` : null}
  </li>`;
}

function renderStructureReliance(edge: StructureEdge): Markup {
  const reading = edge.reliance;
  if (reading.status === "unknown") return html`<p class="quiet" data-reliance="unknown">${reading.reason}</p>`;
  if (reading.sites.length === 0) {
    return html`<p class="quiet" data-reliance="complete">Complete run site evidence records 0 references to the chokepoint or protected thing.</p>`;
  }
  return html`<p class="quiet" data-reliance="complete">${plural(reading.sites.length, "recorded reference site", "recorded reference sites")} to the chokepoint or protected thing; owner component first.</p>
    <ul class="site-list">${reading.sites.map(renderStructureSite)}</ul>`;
}

function renderStructureReading(edge: StructureEdge): Markup {
  return html`<details class="structure-reading" id="${edge.id}-reliance" data-structure-edge="${edge.id}">
    <summary>${edge.name}: reliance</summary>
    <p><span class="label">crossing</span> ${edge.from} → ${edge.to}</p>
    <p><span class="label">chokepoint</span> ${structureChokepointText(edge)}</p>
    ${renderStructureReliance(edge)}
    ${edge.proposed ? html`<p class="quiet">This dashed edge exists only in the ephemeral preview.</p>` : html`<p><a href="#${invariantId(edge.component, edge.name)}">Open invariant</a></p>`}
  </details>`;
}

/** Structure has no stored reader filters; its tools state is intentionally empty. */
export function renderStructureTools(_state: ShellState): Markup {
  return html`<div class="tool-copy"><p>Crossings only, in declared and stable model order. Layout is derived on every render.</p></div>`;
}

/**
 * Render the Structure view. `preview` is an optional, ephemeral list supplied
 * by scaffold preview; it is never added to ShellState and receives no run
 * verdict or reliance evidence.
 */
export function renderStructureResults(state: ShellState, preview: readonly StructurePreview[] = []): Markup {
  return renderStructureModel(structureOf(state, preview.length === 0 ? state.structure.preview : preview));
}

/** Render an already-derived model, useful to deterministic checks and previews. */
export function renderStructureModel(model: StructureModel): Markup {
  return html`<section class="structure-view" aria-labelledby="structure-heading">
    <div class="section-heading">
      <div><p class="eyebrow">Security spine</p><h2 id="structure-heading">Structure</h2></div>
      <p class="quiet">${plural(model.edges.length, "crossing-bearing invariant", "crossing-bearing invariants")} · ${plural(model.invariantsWithoutCrossing, "invariant has", "invariants have")} no crossing</p>
    </div>
    ${model.levels.length === 0 ? html`<p class="empty">No trust levels are declared in the entry spec.</p>` : null}
    <div class="structure-canvas" style="max-width:100%;overflow-x:auto" tabindex="0" role="region" aria-label="Scrollable Structure diagram">${renderStructureSvg(model)}</div>
    <section class="structure-readings" aria-labelledby="structure-readings-heading">
      <h3 id="structure-readings-heading">Edge readings</h3>
      ${model.edges.length === 0 ? html`<p class="empty">No invariant carries a crossing.</p>` : join(model.edges.map(renderStructureReading))}
    </section>
  </section>`;
}
