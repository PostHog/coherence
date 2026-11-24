/**
 * The Scope shell: masthead, the view strip, and the active view's body.
 * A pure function from `ShellState` to markup. A view is added by listing
 * it in VIEWS and giving it its parts in VIEW_PARTS below; the page
 * re-renders the results region alone when a query or filter changes, and
 * the whole shell when the view changes.
 */

import { renderHomeResults } from "./home-view.ts";
import { renderComponentsResults, renderComponentsTools } from "./components-view.ts";
import { openEscalations, plural } from "./derive.ts";
import { renderLexiconView } from "./lexicon-view.ts";
import { html, type Markup } from "./html.ts";
import { renderJournalResults, renderJournalTools } from "./journal-view.ts";
import { renderPracticesResults, renderPracticesTools } from "./practices-view.ts";
import type { ComponentsFilter, JournalKind, ShellState } from "./model.ts";
import { renderRunsResults, renderRunsTools } from "./runs-view.ts";
import { renderConnectionsResults, renderStructureResults } from "./structure-view.ts";
import { CONNECTIONS_ID, CONNECTIONS_LABEL } from "./derive.ts";

/**
 * The views in strip order: Structure first, Connections beside it, then Lexicon, then the rest (the owner's rulings, d-bf90cb79,
 * 2026-10-30). The builder
 * embeds this list; the page reads it from state.
 */
export const VIEWS = [
  { id: "home", label: "Home" },
  { id: "structure", label: "Structure" },
  { id: CONNECTIONS_ID, label: CONNECTIONS_LABEL },
  { id: "lexicon", label: "Lexicon" },
  { id: "components", label: "Components" },
  { id: "practices", label: "Practices" },
  { id: "runs", label: "Runs" },
  { id: "journal", label: "Journal" },
] as const;

/** The view a page opens on when its address names none: the first in strip order. */
export const DEFAULT_VIEW: string = VIEWS[0].id;


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
  return html`<p class="connection" data-field="connection" data-connection="${mark}" role="status" aria-live="polite"><span class="connection-dot" aria-hidden="true"></span><span class="connection-text">${text}</span></p>`;
}

/**
 * The masthead, the same on every view so the view strip under it never moves: the reading's name, the connection,
 * the project. It says no verdict over the whole project: Coherence speaks for the rules it checked, as of when it
 * checked them, so where things stand is each view's to say in its own terms (Home in words, Invariants per rule).
 */
export function renderMasthead(state: ShellState): Markup {
  return html`<div class="masthead masthead-quiet">
    <p class="reading-name">Scope</p>
    ${renderConnection(state)}
    <h1>${state.project}</h1>
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

/** A view's id, as VIEWS lists it. */
export type ViewId = (typeof VIEWS)[number]["id"];

/** What a view draws and what a reader sets on it: its results region, the tools above it, its search's query, its filters. */
interface ViewParts {
  results: (state: ShellState) => Markup;
  tools?: (state: ShellState) => Markup;
  query?: (state: ShellState, value: string) => void;
  /** A filter by name; a name the view does not have is ignored. */
  filter?: (state: ShellState, name: string, value: string) => void;
}

function renderLexiconTools(state: ShellState): Markup {
  return html`<div class="view-tools">
        <label class="search">
          <span class="label">Search</span>
          <input type="search" data-search value="${state.lexicon.query}" placeholder="name, other name, definition, or rejected name" autocomplete="off" spellcheck="false">
        </label>
      </div>`;
}

/**
 * Each view's parts, keyed by its id: the one place a view's name is
 * switched on, which the compiler holds to VIEWS (a view listed there
 * without an entry here, or an entry for no view, does not compile).
 */
const VIEW_PARTS: Record<ViewId, ViewParts> = {
  home: { results: renderHomeResults },
  structure: { results: renderStructureResults },
  [CONNECTIONS_ID]: { results: renderConnectionsResults },
  lexicon: { results: renderLexiconResults, tools: renderLexiconTools, query: (state, value) => void (state.lexicon.query = value) },
  components: {
    results: renderComponentsResults,
    tools: renderComponentsTools,
    query: (state, value) => void (state.components.query = value),
    filter: (state, name, value) => {
      if (name === "show") state.components.filter = value as ComponentsFilter;
    },
  },
  practices: { results: renderPracticesResults, tools: renderPracticesTools, query: (state, value) => void (state.practicesView.query = value) },
  runs: { results: renderRunsResults, tools: renderRunsTools, query: (state, value) => void (state.runsView.query = value) },
  journal: {
    results: renderJournalResults,
    tools: renderJournalTools,
    query: (state, value) => void (state.journalView.query = value),
    filter: (state, name, value) => {
      if (name === "kind") state.journalView.kind = value as JournalKind | "";
      if (name === "agent") state.journalView.agent = value;
      if (name === "session") state.journalView.session = value;
    },
  },
};

/** The parts of the view a state names, or undefined when it names none of VIEWS. */
function partsOf(view: string): ViewParts | undefined {
  return Object.hasOwn(VIEW_PARTS, view) ? VIEW_PARTS[view as ViewId] : undefined;
}

/** The active view's results region alone: what a query or filter change re-renders. */
export function renderViewResults(state: ShellState): Markup {
  const parts = partsOf(state.activeView);
  return parts === undefined ? html`<p class="absence">No view named “${state.activeView}” exists in this reading.</p>` : parts.results(state);
}

function renderViewTools(state: ShellState): Markup | null {
  return partsOf(state.activeView)?.tools?.(state) ?? null;
}

/** Set the active view's search query; a view with no search ignores it. */
export function setViewQuery(state: ShellState, value: string): void {
  partsOf(state.activeView)?.query?.(state, value);
}

/** Set a filter of the active view. Unknown names are ignored. */
export function setViewFilter(state: ShellState, name: string, value: string): void {
  partsOf(state.activeView)?.filter?.(state, name, value);
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
