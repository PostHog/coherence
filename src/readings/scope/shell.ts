/**
 * The Scope shell: masthead, the view strip, and the active view's body.
 * A pure function from `ShellState` to markup. A view is added by listing
 * it in `state.views` and adding its tools and results to the two switches
 * below; the page re-renders the results region alone when a query or
 * filter changes, and the whole shell when the view changes.
 */

import { renderComponentsResults, renderComponentsTools } from "./components-view.ts";
import { openEscalations, plural } from "./derive.ts";
import { glossaryCounts, renderGlossaryView } from "./glossary-view.ts";
import { html, type Markup } from "./html.ts";
import { renderInvariantsResults, renderInvariantsTools } from "./invariants-view.ts";
import { renderJournalResults, renderJournalTools } from "./journal-view.ts";
import type { ShellState } from "./model.ts";
import { renderRelianceResults, renderRelianceTools } from "./reliance-view.ts";
import { renderRunsResults, renderRunsTools } from "./runs-view.ts";

/** The views in strip order. The builder embeds this list; the page reads it from state. */
export const VIEWS = [
  { id: "glossary", label: "Glossary" },
  { id: "components", label: "Components" },
  { id: "invariants", label: "Invariants" },
  { id: "reliance", label: "Reliance" },
  { id: "runs", label: "Runs" },
  { id: "journal", label: "Journal" },
] as const;

/** The one sentence under the project name: what the model holds, derived on every render. */
export function modelCounts(state: ShellState): string {
  const c = state.spec.counts;
  const parts = [
    plural(c.components, "component", "components"),
    `${plural(c.bullets, "bullet", "bullets")} (${c.invariants} ${c.invariants === 1 ? "invariant" : "invariants"}, ${c.requirements} ${c.requirements === 1 ? "requirement" : "requirements"}${c.structuralDefects > 0 ? `, ${plural(c.structuralDefects, "structural defect", "structural defects")}` : ""})`,
    plural(state.runs.records.length, "run", "runs"),
    plural(state.journal.records.length, "journal record", "journal records"),
  ];
  const open = openEscalations(state.journal.records).length;
  if (open > 0) parts.push(`${plural(open, "escalation", "escalations")} awaiting a human`);
  return `${parts.join(", ")}.`;
}

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
    <p class="counts model-counts" data-field="model-counts">${modelCounts(state)}</p>
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

/** The active view's results region alone: what a query or filter change re-renders. */
export function renderViewResults(state: ShellState): Markup {
  switch (state.activeView) {
    case "glossary":
      return renderGlossaryResults(state);
    case "components":
      return renderComponentsResults(state);
    case "invariants":
      return renderInvariantsResults(state);
    case "reliance":
      return renderRelianceResults(state);
    case "runs":
      return renderRunsResults(state);
    case "journal":
      return renderJournalResults(state);
    default:
      return html`<p class="absence">No view named “${state.activeView}” exists in this reading.</p>`;
  }
}

function renderViewTools(state: ShellState): Markup | null {
  switch (state.activeView) {
    case "glossary":
      return html`<div class="view-tools">
        <label class="search">
          <span class="label">Search</span>
          <input type="search" data-search value="${state.glossary.query}" placeholder="name, other name, definition, or rejected name" autocomplete="off" spellcheck="false">
        </label>
      </div>`;
    case "components":
      return renderComponentsTools(state);
    case "invariants":
      return renderInvariantsTools(state);
    case "reliance":
      return renderRelianceTools(state);
    case "runs":
      return renderRunsTools(state);
    case "journal":
      return renderJournalTools(state);
    default:
      return null;
  }
}

function renderViewBody(state: ShellState): Markup {
  return html`${renderViewTools(state)}<div class="view-results" data-results>${renderViewResults(state)}</div>`;
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

/** The whole page for one view: what a test renders to see a view without the browser. */
export function renderView(state: ShellState, view: string): Markup {
  return renderShell({ ...state, activeView: view });
}
