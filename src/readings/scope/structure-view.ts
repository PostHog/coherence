/**
 * The Structure view: the relief (relief/scene.ts), or the connections view
 * beside it (connections/drawing.ts), one at a time by the toggle in its tool
 * line. Each lives outside the rendered markup, built once and kept alive, so
 * the view renders only the host the page mounts it into (relief/mount.ts,
 * connections/mount.ts), or why there is nothing to draw.
 */

import { CONNECTIONS_ID, CONNECTIONS_LABEL } from "./derive.ts";
import { html, type Markup } from "./html.ts";
import type { ShellState } from "./model.ts";
import { reliefData } from "./relief/data.ts";

/** Whether Structure shows the connections view rather than the relief. */
export function showsConnections(state: ShellState): boolean {
  return state.structure.shows === CONNECTIONS_ID;
}

/** The toggle between the relief and the connections view; each carries its own controls beneath it. */
export function renderStructureTools(state: ShellState): Markup | null {
  const connections = showsConnections(state);
  return html`<div class="view-tools structure-shows"><div class="segmented" role="group" aria-label="Structure shows">
    <button type="button" data-structure-shows="relief" aria-pressed="${connections ? "false" : "true"}">Relief</button><button type="button" data-structure-shows="${CONNECTIONS_ID}" aria-pressed="${connections ? "true" : "false"}">${CONNECTIONS_LABEL}</button>
  </div></div>`;
}

export function renderStructureResults(state: ShellState): Markup {
  if (showsConnections(state)) {
    if (state.spec.components.length === 0) return html`<p class="absence">This reading declares no component to start from.</p>`;
    return html`<div class="connections-host" data-connections-host></div>`;
  }
  const data = reliefData(state);
  if ("absent" in data) return html`<p class="absence">${data.absent}</p>`;
  return html`<div class="relief-host" data-relief-host></div>`;
}
