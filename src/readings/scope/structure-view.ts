/**
 * The Structure view: one map. What the system is made of and how work flows
 * through it, drawn by `structure-flow-view.ts` from the `flowOf` model. The
 * security spine is a trust-level selection on it and reliance is a
 * chokepoint selection; neither is a section or a view of its own.
 */

import { html, type Markup } from "./html.ts";
import type { ShellState, StructurePreview } from "./model.ts";
import { renderFlowSection } from "./structure-flow-view.ts";

/** Structure keeps no filter; selection and zoom live in the map. */
export function renderStructureTools(_state: ShellState): Markup {
  return html`<div class="tool-copy"><p>Each colored line is the path work takes from an entrance through the components. Select a route, an entrance, a trust level, a component, an interface, or a chokepoint to light its story.</p></div>`;
}

/**
 * Render the Structure view. `preview` is an optional, ephemeral list supplied
 * by scaffold preview; it is never added to the spec model and receives no
 * run verdict or reliance evidence: each proposal is drawn dashed on its
 * component, unverified.
 */
export function renderStructureResults(state: ShellState, preview: readonly StructurePreview[] = []): Markup {
  return html`<div class="structure-results">${renderFlowSection(state, preview.length === 0 ? state.structure.preview : preview)}</div>`;
}
