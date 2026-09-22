/**
 * The browser side of the Scope reading.
 *
 * The page holds one `ShellState`, parsed once from the JSON the builder
 * embedded. Every change to what the reader sees is a change to that state
 * followed by a render; nothing is written to the DOM that a render could not
 * regenerate. The only other places a value lives are the search field and
 * the filter selects, whose current values are copied into the active view's
 * state on every input or change event. The hash is read, never written to
 * the state: a hash resolves to a view and a card on load and on change.
 *
 * This file is stripped of types and inlined into the page together with the
 * modules it imports, so it must not rely on anything outside them.
 */

import { componentOfHash, resolveHash } from "./derive.ts";
import type { JournalKind, LifecycleState, ShellState } from "./model.ts";
import { renderShell, renderViewResults } from "./shell.ts";
import { flowExpanded, isFlowId } from "./structure-flow.ts";

function readEmbeddedState(): ShellState {
  const node = document.getElementById("scope-state");
  if (node === null || node.textContent === null) {
    throw new Error("Scope: the embedded state is missing from this page.");
  }
  return JSON.parse(node.textContent) as ShellState;
}

/** The query field of the active view. */
function setQuery(state: ShellState, value: string): void {
  switch (state.activeView) {
    case "glossary":
      state.glossary.query = value;
      return;
    case "components":
      state.components.query = value;
      return;
    case "invariants":
      state.invariants.query = value;
      return;
    case "runs":
      state.runsView.query = value;
      return;
    case "journal":
      state.journalView.query = value;
      return;
    default:
      return;
  }
}

/** A filter of the active view. Unknown names are ignored. */
function setFilter(state: ShellState, name: string, value: string): void {
  if (state.activeView === "invariants") {
    if (name === "state") state.invariants.state = value as LifecycleState | "";
    if (name === "component") state.invariants.component = value;
  } else if (state.activeView === "journal") {
    if (name === "kind") state.journalView.kind = value as JournalKind | "";
    if (name === "agent") state.journalView.agent = value;
    if (name === "session") state.journalView.session = value;
  }
}

function boot(): void {
  const root = document.getElementById("scope-root");
  if (root === null) throw new Error("Scope: the root element is missing from this page.");
  const state = readEmbeddedState();

  const renderAll = (): void => {
    root.innerHTML = renderShell(state).text;
  };

  const renderResults = (): void => {
    const results = root.querySelector<HTMLElement>("[data-results]");
    if (results === null) return renderAll();
    results.innerHTML = renderViewResults(state).text;
  };

  const showView = (view: string): void => {
    if (view === state.activeView) return;
    state.activeView = view;
    renderAll();
  };

  /** Land on what the hash names: its view first, then the card. */
  const followHash = (): void => {
    const target = resolveHash(state, location.hash);
    if (target === undefined) return;
    if (target.id !== undefined) {
      const component = componentOfHash(state, target.id);
      if (component !== undefined) state.components.selected = component.folder;
      if (isFlowId(target.id)) state.structure.selected = target.id;
    } else if (target.view === "structure") delete state.structure.selected;
    const changed = target.view !== state.activeView;
    state.activeView = target.view;
    if (changed || target.id !== undefined) renderAll();
    if (target.id !== undefined) document.getElementById(decodeURIComponent(target.id))?.scrollIntoView();
  };

  /** Select a story in the Structure flow, or clear it when it is already selected; the hash follows so it can be linked. */
  const selectStory = (id: string): void => {
    if (id === "" || state.structure.selected === id) delete state.structure.selected;
    else state.structure.selected = id;
    history.replaceState(null, "", `#${state.structure.selected ?? "structure"}`);
    renderResults();
    if (state.structure.selected !== undefined) {
      const again = root.querySelector<HTMLElement | SVGElement>(`[id="${state.structure.selected}"][data-structure-select]`);
      again?.focus({ preventScroll: true });
    }
  };

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.hasAttribute("data-search")) return;
    setQuery(state, target.value);
    renderResults();
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const name = target.dataset["filter"];
    if (name === undefined) return;
    setFilter(state, name, target.value);
    renderResults();
  });

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const tab = target.closest<HTMLElement>("[role=tab][data-view]");
    if (tab !== null) {
      const view = tab.dataset["view"];
      if (view !== undefined && view !== state.activeView) {
        showView(view);
        history.replaceState(null, "", `#${view}`);
        root.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
      }
      return;
    }

    const expand = target.closest<Element>("[data-structure-expand]");
    if (expand !== null) {
      // One level of the component tree at a time: open or close this component in place.
      const folder = expand.getAttribute("data-structure-expand") ?? "";
      const open = flowExpanded(state);
      if (open.has(folder)) open.delete(folder);
      else open.add(folder);
      state.structure.expanded = [...open].sort();
      renderResults();
      return;
    }

    const story = target.closest<Element>("[data-structure-select]");
    if (story !== null) {
      selectStory(story.getAttribute("data-structure-select") ?? "");
      return;
    }

    const select = target.closest<HTMLElement>("[data-select-component]");
    if (select !== null) {
      const folder = select.dataset["selectComponent"];
      if (folder === undefined || state.components.selected === folder) delete state.components.selected;
      else state.components.selected = folder;
      renderResults();
      return;
    }

    // A link into a card must land on it even when a query has hidden it or
    // another view holds it: clear the active view's query, then let the
    // hash change resolve the view.
    const link = target.closest<HTMLAnchorElement>("a[href^='#']");
    if (link !== null) {
      const hash = link.getAttribute("href") ?? "";
      const resolved = resolveHash(state, hash);
      if (resolved === undefined) return;
      if (resolved.view === state.activeView) {
        setQuery(state, "");
        renderResults();
      }
      if (hash === location.hash) {
        // Same hash again fires no hashchange; follow it by hand.
        event.preventDefault();
        followHash();
      }
    }
  });

  root.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof Element && target.hasAttribute("data-structure-select") && !(target instanceof HTMLButtonElement)) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectStory(target.getAttribute("data-structure-select") ?? "");
      return;
    }
    if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab") return;
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const ids = state.views.map((v) => v.id);
    const current = ids.indexOf(state.activeView);
    if (current === -1 || ids.length < 2) return;
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = ids[(current + step + ids.length) % ids.length];
    if (next === undefined) return;
    showView(next);
    history.replaceState(null, "", `#${next}`);
    root.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
    event.preventDefault();
  });

  window.addEventListener("hashchange", followHash);

  renderAll();
  followHash();
}

boot();

export {};
