/**
 * The Components view: the component tree with intent, per component the
 * counts of its bullets by state, a mass line reserved for the economy's
 * measurement, and the selected component's invariants. A pure function from
 * the shell state to markup.
 */

import { componentId, componentTree, invariantId, plural, textMatches } from "./derive.ts";
import { html, type Markup } from "./html.ts";
import type { ShellState, SpecComponent, SpecInvariant } from "./model.ts";

function componentMatches(component: SpecComponent, query: string): boolean {
  return textMatches(
    query,
    component.name,
    component.folder,
    component.intent,
    component.specPath,
    component.invariants.map((i) => i.name),
  );
}

function stateCounts(component: SpecComponent): { invariants: number; requirements: number; defects: number } {
  let invariants = 0;
  let requirements = 0;
  let defects = 0;
  for (const invariant of component.invariants) {
    if (invariant.state === "invariant") invariants += 1;
    else if (invariant.state === "requirement") requirements += 1;
    else defects += 1;
  }
  return { invariants, requirements, defects };
}

function renderInvariantLine(invariant: SpecInvariant): Markup {
  const forms = invariant.enforcements.map((e) => (e.form === "chokepoint" ? `chokepoint ${e.chokepoint}` : `totality oracle`));
  return html`<li class="invariant-line" data-state="${invariant.state}">
    <a href="#${invariantId(invariant.component, invariant.name)}">${invariant.name}</a>
    <span class="state-mark" data-state="${invariant.state}">${invariant.state}</span>
    ${forms.length > 0 ? html`<span class="quiet">${forms.join(", ")}</span>` : html`<span class="quiet">no enforcement</span>`}
  </li>`;
}

/** The mass line: a slot the economy fills once it measures; until then it says so. */
function renderMass(): Markup {
  return html`<p class="mass quiet" data-slot="mass">mass: not measured</p>`;
}

function renderComponent(state: ShellState, component: SpecComponent, depth: number, selected: boolean): Markup {
  const id = componentId(component.folder);
  const counts = stateCounts(component);
  const bullets = component.invariants.length;
  const children = component.children.length;
  const isEntry = state.spec.entry === component.folder;
  return html`<article class="entry component" id="${id}" data-depth="${depth}" aria-current="${selected ? "true" : "false"}">
    <div class="margin">
      <h3 class="headword"><a href="#${id}">${component.name}</a></h3>
      <p class="status">${component.folder === "." ? "root" : component.folder}${isEntry ? " · entry" : ""}</p>
      <p class="defined-by">${component.specPath}</p>
      ${component.trustLevels !== undefined ? html`<p class="defined-by">declares ${plural(component.trustLevels.length, "trust level", "trust levels")}</p>` : null}
    </div>
    <div class="body">
      ${component.intent !== "" ? html`<p class="definition">${component.intent}</p>` : html`<p class="definition quiet">No intent line in the spec.</p>`}
      <p class="counts-line">
        <span class="count" data-count="bullets">${plural(bullets, "bullet", "bullets")}</span>
        <span class="count" data-count="invariants">${plural(counts.invariants, "invariant", "invariants")}</span>
        <span class="count" data-count="requirements">${plural(counts.requirements, "requirement", "requirements")}</span>
        ${counts.defects > 0 ? html`<span class="count failing" data-count="defects">${plural(counts.defects, "structural defect", "structural defects")}</span>` : null}
        ${children > 0 ? html`<span class="count" data-count="children">${plural(children, "child component", "child components")}</span>` : null}
      </p>
      ${renderMass()}
      ${children > 0
        ? html`<p class="related"><span class="label">Contains</span> ${component.children.map((c, i) => html`<a class="related-link" href="#${componentId(c)}">${c}</a>${i < children - 1 ? ", " : ""}`)}</p>`
        : null}
      <p class="select-line"><button type="button" class="select" data-select-component="${component.folder}" aria-expanded="${selected ? "true" : "false"}">${selected ? "Hide invariants" : bullets === 0 ? "No invariants to show" : `Show ${plural(bullets, "invariant", "invariants")}`}</button></p>
      ${selected
        ? bullets === 0
          ? html`<p class="quiet">This component's spec declares no bullets.</p>`
          : html`<ul class="invariant-lines" data-selected-invariants>${component.invariants.map(renderInvariantLine)}</ul>`
        : null}
    </div>
  </article>`;
}

export function renderComponentsTools(state: ShellState): Markup {
  return html`<div class="view-tools">
    <label class="search">
      <span class="label">Search</span>
      <input type="search" data-search value="${state.components.query}" placeholder="component, folder, intent, or invariant name" autocomplete="off" spellcheck="false">
    </label>
  </div>`;
}

export function renderComponentsResults(state: ShellState): Markup {
  const query = state.components.query.trim().toLowerCase();
  const tree = componentTree(state.spec.components);
  const shown = tree.filter(({ component }) => componentMatches(component, query));
  const total = tree.length;
  if (total === 0) return html`<p class="absence">No component was found: no folder under the root holds a spec file.</p>`;
  return html`<section class="components" aria-labelledby="components-heading">
    <h2 class="section-heading" id="components-heading">Components</h2>
    <p class="section-lead">Any folder with a spec file. Nesting follows the folders; the entry component declares the trust levels crossings name. Select a component to see its invariants.</p>
    ${query === ""
      ? html`<p class="match-summary quiet">${plural(total, "component", "components")}.</p>`
      : shown.length === 0
        ? html`<p class="match-summary">No component matches “${state.components.query}”.</p>`
        : html`<p class="match-summary">${shown.length} of ${plural(total, "component", "components")} match “${state.components.query}”.</p>`}
    ${shown.map(({ component, depth }) => renderComponent(state, component, depth, state.components.selected === component.folder))}
  </section>`;
}
