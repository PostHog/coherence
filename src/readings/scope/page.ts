/**
 * The browser side of the Scope reading.
 *
 * The page holds one `ShellState`, parsed once from the JSON the builder
 * embedded. Every change to what the reader sees is a change to that state
 * followed by a render; nothing is written to the DOM that a render could not
 * regenerate. The only other place a value lives is the search field, whose
 * current text is copied into `state.glossary.query` on every input event.
 *
 * This file is stripped of types and inlined into the page together with the
 * modules it imports, so it must not rely on anything outside them.
 */

import type { ShellState } from "./model.ts";
import { renderGlossaryResults, renderShell } from "./shell.ts";

function readEmbeddedState(): ShellState {
  const node = document.getElementById("scope-state");
  if (node === null || node.textContent === null) {
    throw new Error("Scope: the embedded state is missing from this page.");
  }
  return JSON.parse(node.textContent) as ShellState;
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
    results.innerHTML = renderGlossaryResults(state).text;
  };

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.hasAttribute("data-search")) return;
    state.glossary.query = target.value;
    renderResults();
  });

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const tab = target.closest<HTMLElement>("[role=tab][data-view]");
    if (tab !== null) {
      const view = tab.dataset["view"];
      if (view !== undefined && view !== state.activeView) {
        state.activeView = view;
        renderAll();
        root.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
      }
      return;
    }

    // A related link must land on its card even when the query has hidden it:
    // clear the query and render before the browser follows the anchor.
    const link = target.closest<HTMLAnchorElement>("a.related-link");
    if (link !== null && state.glossary.query !== "") {
      state.glossary.query = "";
      renderAll();
    }
  });

  root.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab") return;
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const ids = state.views.map((v) => v.id);
    const current = ids.indexOf(state.activeView);
    if (current === -1 || ids.length < 2) return;
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = ids[(current + step + ids.length) % ids.length];
    if (next === undefined) return;
    state.activeView = next;
    renderAll();
    root.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
    event.preventDefault();
  });

  renderAll();

  // Honor a hash that arrived before the first render.
  if (location.hash.length > 1) {
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }
}

boot();

export {};
