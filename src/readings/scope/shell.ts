/**
 * The Scope shell: masthead, the view strip, and the active view's body.
 * A pure function from `ShellState` to markup. A second view is added by
 * listing it in `state.views` and adding a case to `renderViewBody`.
 */

import { glossaryCounts, renderGlossaryView } from "./glossary-view.ts";
import { html, type Markup } from "./html.ts";
import type { ShellState } from "./model.ts";

function renderMasthead(state: ShellState): Markup {
  const first = state.glossary.layers[0];
  const counts =
    first !== undefined && first.kind === "present"
      ? glossaryCounts(first.glossary)
      : "No glossary is loaded.";
  return html`<div class="masthead">
    <p class="reading-name">Scope</p>
    <h1>${state.project}</h1>
    <p class="counts">${counts}</p>
  </div>`;
}

function renderViewStrip(state: ShellState): Markup {
  return html`<nav class="views" aria-label="Views">
    <ul role="tablist">${state.views.map(
      (view) => html`<li role="presentation"><button
        type="button"
        role="tab"
        id="tab-${view.id}"
        data-view="${view.id}"
        aria-selected="${view.id === state.activeView ? "true" : "false"}"
        aria-controls="view-${view.id}"
        tabindex="${view.id === state.activeView ? "0" : "-1"}">${view.label}</button></li>`,
    )}</ul>
  </nav>`;
}

/** The region the browser re-renders when the query changes. */
export function renderGlossaryResults(state: ShellState): Markup {
  return renderGlossaryView(state.glossary);
}

function renderViewBody(state: ShellState): Markup {
  switch (state.activeView) {
    case "glossary":
      return html`<div class="view-tools">
        <label class="search">
          <span class="label">Search</span>
          <input type="search" data-search value="${state.glossary.query}" placeholder="name, former name, definition, or rejected name" autocomplete="off" spellcheck="false">
        </label>
      </div>
      <div class="view-results" data-results>${renderGlossaryResults(state)}</div>`;
    default:
      return html`<p class="absence">No view named “${state.activeView}” exists in this reading.</p>`;
  }
}

/** The whole page body for a given state. */
export function renderShell(state: ShellState): Markup {
  const active = state.views.find((v) => v.id === state.activeView);
  return html`<div class="shell">
    <header class="shell-head">
      ${renderMasthead(state)}
      ${renderViewStrip(state)}
    </header>
    <main class="view" id="view-${state.activeView}" role="tabpanel" aria-labelledby="tab-${state.activeView}" data-view-body>
      <h2 class="visually-hidden">${active?.label ?? state.activeView}</h2>
      ${renderViewBody(state)}
    </main>
  </div>`;
}
