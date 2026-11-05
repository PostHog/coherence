/**
 * The Structure view, the relief (relief/scene.ts), and the Connections view
 * beside it in the strip (connections/drawing.ts). Each lives outside the
 * rendered markup, built once and kept alive, so a view renders only the host
 * the page mounts it into (relief/mount.ts, connections/mount.ts), or why
 * there is nothing to draw.
 */

import { html, type Markup } from "./html.ts";
import type { ShellState } from "./model.ts";
import { reliefAbsence } from "./relief/data.ts";

/** The relief's host, or why there is none: asked of the reading alone, so a render never joins the relief's data (mount.ts does, when what it draws changed). */
export function renderStructureResults(state: ShellState): Markup {
  const absent = reliefAbsence(state);
  if (absent !== undefined) return html`<p class="absence">${absent}</p>`;
  return html`<div class="relief-host" data-relief-host></div>`;
}

export function renderConnectionsResults(state: ShellState): Markup {
  if (state.spec.components.length === 0) return html`<p class="absence">This reading declares no component to start from.</p>`;
  return html`<div class="connections-host" data-connections-host></div>`;
}
