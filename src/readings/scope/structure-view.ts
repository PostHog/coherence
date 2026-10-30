/**
 * The Structure view: the relief (relief/scene.ts). Its scene lives outside
 * the rendered markup, built once and kept alive, so the view renders only the
 * host the page mounts it into (relief/mount.ts), or why there is nothing to
 * draw.
 */

import { html, type Markup } from "./html.ts";
import type { ShellState } from "./model.ts";
import { reliefData } from "./relief/data.ts";

/** The relief carries its own controls, so the view has no tool line. */
export function renderStructureTools(_state: ShellState): Markup | null {
  return null;
}

export function renderStructureResults(state: ShellState): Markup {
  const data = reliefData(state);
  if ("absent" in data) return html`<p class="absence">${data.absent}</p>`;
  return html`<div class="relief-host" data-relief-host></div>`;
}
