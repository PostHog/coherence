/**
 * The Structure view, the relief (relief/scene.ts), and the Connections view
 * beside it in the strip (connections/drawing.ts). Each lives outside the
 * rendered markup, built once and kept alive, so a view renders only the host
 * the page mounts it into (relief/mount.ts, connections/mount.ts), or why
 * there is nothing to draw.
 */

import { html, type Markup } from "./html.ts";
import type { ShellState } from "./model.ts";
import { reliefData } from "./relief/data.ts";

export function renderStructureResults(state: ShellState): Markup {
  const data = reliefData(state);
  if ("absent" in data) return html`<p class="absence">${data.absent}</p>`;
  return html`<div class="relief-host" data-relief-host></div>`;
}

export function renderConnectionsResults(state: ShellState): Markup {
  if (state.spec.components.length === 0) return html`<p class="absence">This reading declares no component to start from.</p>`;
  return html`<div class="connections-host" data-connections-host></div>`;
}
