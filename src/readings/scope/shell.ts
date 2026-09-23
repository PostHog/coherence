/**
 * The Scope shell: masthead, the view strip, and the active view's body.
 * A pure function from `ShellState` to markup. A view is added by listing
 * it in `state.views` and adding its tools and results to the two switches
 * below; the page re-renders the results region alone when a query or
 * filter changes, and the whole shell when the view changes.
 */

import { renderComponentsResults, renderComponentsTools } from "./components-view.ts";
import { openEscalations, plural } from "./derive.ts";
import { lexiconCounts, renderLexiconView } from "./lexicon-view.ts";
import { html, type Markup } from "./html.ts";
import { renderInvariantsResults, renderInvariantsTools } from "./invariants-view.ts";
import { renderJournalResults, renderJournalTools } from "./journal-view.ts";
import type { ShellState } from "./model.ts";
import { renderRunsResults, renderRunsTools } from "./runs-view.ts";
import { flowOf, flowVerdict } from "./structure-flow.ts";
import { renderStructureResults, renderStructureTools } from "./structure-view.ts";

/** The views in strip order. The builder embeds this list; the page reads it from state. */
export const VIEWS = [
  { id: "lexicon", label: "Lexicon" },
  { id: "components", label: "Components" },
  { id: "structure", label: "Structure" },
  { id: "invariants", label: "Invariants" },
  { id: "runs", label: "Runs" },
  { id: "journal", label: "Journal" },
] as const;

/** The demoted line under the verdict: what the model holds, derived on every render. */
export function modelCounts(state: ShellState): string {
  const c = state.spec.counts;
  const parts = [
    plural(c.components, "component", "components"),
    `${c.invariants} ${c.invariants === 1 ? "invariant" : "invariants"}, ${c.requirements} ${c.requirements === 1 ? "requirement" : "requirements"}${c.structuralDefects > 0 ? `, ${plural(c.structuralDefects, "structural defect", "structural defects")}` : ""}`,
    plural(state.runs.records.length + (state.runs.omitted ?? 0), "run", "runs"),
    plural(state.journal.records.length + (state.journal.omitted ?? 0), "journal record", "journal records"),
  ];
  const open = openEscalations(state.journal.records).length;
  if (open > 0) parts.push(`${plural(open, "escalation", "escalations")} awaiting a human`);
  return `${parts.join(", ")}.`;
}

/**
 * Where the state comes from, in one line: a snapshot that never updates, or
 * a live page connecting, following the stores, or disconnected and retrying.
 * Nothing when the page has not said (a render in a test).
 */
export function renderConnection(state: ShellState): Markup | null {
  const connection = state.connection;
  if (connection === undefined) return null;
  const mark = connection.mode === "snapshot" ? "snapshot" : connection.status;
  const text =
    connection.mode === "snapshot"
      ? html`Snapshot: this file does not update. <code>coherence scope</code> opens the live reading.`
      : connection.status === "connecting"
        ? html`Connecting to the warm server…`
        : connection.status === "live"
          ? html`Live: follows the journal, runs, work orders and specs as they change.`
          : html`Disconnected from the warm server${connection.reason === undefined ? "" : ` (${connection.reason})`}; retrying${connection.attempt === undefined ? "" : `, attempt ${connection.attempt}`}. What is shown is as of the last update. If it stays down, <code>coherence scope</code> starts it again.`;
  return html`<p class="connection" data-field="connection" data-connection="${mark}" role="status" aria-live="polite"><span class="connection-dot" aria-hidden="true"></span> ${text}</p>`;
}

/**
 * The masthead leads with health: one verdict in large type, the link to its
 * set on the Structure map (the broken component's mark when one component
 * holds everything broken), and what else the verdict leaves out beneath it.
 * The lexicon and the record counts are demoted to one small line.
 */
export function renderMasthead(state: ShellState): Markup {
  const first = state.lexicon.layers[0];
  const counts =
    first !== undefined && first.kind === "present"
      ? lexiconCounts(first.lexicon)
      : "No lexicon is loaded.";
  const model = flowOf(state);
  const verdict = flowVerdict(model);
  const requirements = model.health.requirements.length;
  const detail = [
    verdict.kind === "broken" && requirements > 0 ? `${requirements} ${requirements === 1 ? "requirement" : "requirements"} not enforced yet` : "",
    verdict.kind === "nothing" ? `${requirements} ${requirements === 1 ? "requirement" : "requirements"} declared, none enforced` : "",
    model.health.uncovered.length > 0 ? plural(model.health.uncovered.length, "component not covered", "components not covered") : "",
  ].filter(Boolean).join(" · ");
  return html`<div class="masthead">
    <p class="reading-name">Scope</p>
    ${renderConnection(state)}
    <h1>${state.project}</h1>
    <a class="verdict" data-field="verdict" data-verdict="${verdict.kind}" href="#${verdict.select}">${verdict.text}</a>
    ${detail === "" ? null : html`<p class="verdict-detail" data-field="verdict-detail">${detail}</p>`}
    <p class="meta-counts model-counts" data-field="model-counts">${modelCounts(state)} ${counts}</p>
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
export function renderLexiconResults(state: ShellState): Markup {
  return renderLexiconView(state.lexicon);
}

/** The active view's results region alone: what a query or filter change re-renders. */
export function renderViewResults(state: ShellState): Markup {
  switch (state.activeView) {
    case "lexicon":
      return renderLexiconResults(state);
    case "components":
      return renderComponentsResults(state);
    case "structure":
      return renderStructureResults(state);
    case "invariants":
      return renderInvariantsResults(state);
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
    case "lexicon":
      return html`<div class="view-tools">
        <label class="search">
          <span class="label">Search</span>
          <input type="search" data-search value="${state.lexicon.query}" placeholder="name, other name, definition, or rejected name" autocomplete="off" spellcheck="false">
        </label>
      </div>`;
    case "components":
      return renderComponentsTools(state);
    case "structure":
      return renderStructureTools(state);
    case "invariants":
      return renderInvariantsTools(state);
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
