/**
 * The Reliance view: computed, never declared. For each chokepoint
 * invariant, the components whose files the latest chokepoint check
 * touched: the definitions of the protected thing and the chokepoint, and
 * every reference site the instrument resolved. This is the listing a human
 * sees when acknowledging a retirement. A pure function from the shell
 * state to markup.
 */

import { allReliance, componentId, invariantId, isTestFile, plural, relianceId, stamp, textMatches, type Reliance } from "./derive.ts";
import { html, type Markup } from "./html.ts";
import type { ShellState } from "./model.ts";

function relianceMatches(reliance: Reliance, query: string): boolean {
  return textMatches(
    query,
    reliance.invariant.name,
    reliance.invariant.component,
    reliance.chokepoint,
    reliance.protects,
    reliance.entries.flatMap((e) => [e.component?.name ?? "", e.component?.folder ?? "", ...e.files]),
  );
}

function renderRelianceEntry(entry: Reliance["entries"][number]): Markup {
  const name = entry.component === undefined ? "in no component" : entry.component.name;
  const folder = entry.component?.folder;
  return html`<li class="reliance-entry" data-owner="${entry.owner ? "true" : "false"}">
    <p class="reliance-component">${entry.component === undefined
      ? html`<span class="unresolved" title="These files lie under no folder with a spec">${name}</span>`
      : html`<a class="related-link" href="#${componentId(entry.component.folder)}">${name}</a>`}
      ${folder !== undefined && folder !== "." ? html`<span class="quiet">${folder}</span>` : null}
      ${entry.owner ? html`<span class="owner-mark">owns the invariant</span>` : null}
    </p>
    <ul class="files">${entry.files.map((f) => html`<li><code>${f}</code>${isTestFile(f) ? html` <span class="quiet">test</span>` : null}</li>`)}</ul>
  </li>`;
}

function renderReliance(reliance: Reliance): Markup {
  const { invariant, entry } = reliance;
  const id = relianceId(invariant.component, invariant.name);
  const others = reliance.entries.filter((e) => !e.owner);
  return html`<article class="entry reliance" id="${id}" data-state="${invariant.state}">
    <div class="margin">
      <h3 class="headword"><a href="#${id}">${reliance.chokepoint}</a></h3>
      <p class="status">protects <code>${reliance.protects}</code></p>
      <p class="defined-by"><a class="related-link" href="#${invariantId(invariant.component, invariant.name)}">${invariant.name}</a> <span class="state-mark" data-state="${invariant.state}">${invariant.state}</span></p>
    </div>
    <div class="body">
      ${entry === undefined
        ? html`<p class="definition quiet">No run has checked this chokepoint, so no reference site is on record; run <code>run</code> to compute reliance.</p>`
        : html`<p class="definition">${others.length === 0
            ? html`No component outside ${invariant.component === "." ? "the root" : html`<code>${invariant.component}</code>`} references the protected thing: the chokepoint is internal.`
            : html`${plural(others.length, "component relies", "components rely")} on this chokepoint through ${plural(others.reduce((n, e) => n + e.files.length, 0), "file", "files")}.`}
            <span class="quiet">From the check at ${stamp(entry.at)}${entry.grade !== undefined ? `, graded ${entry.grade}` : ""}.</span></p>
          ${reliance.entries.length > 0 ? html`<ul class="reliance-entries">${reliance.entries.map(renderRelianceEntry)}</ul>` : null}`}
    </div>
  </article>`;
}

export function renderRelianceTools(state: ShellState): Markup {
  return html`<div class="view-tools">
    <label class="search">
      <span class="label">Search</span>
      <input type="search" data-search value="${state.reliance.query}" placeholder="chokepoint, protected thing, component, or file" autocomplete="off" spellcheck="false">
    </label>
  </div>`;
}

export function renderRelianceResults(state: ShellState): Markup {
  const query = state.reliance.query.trim().toLowerCase();
  const all = allReliance(state.spec.components);
  const shown = all.filter((r) => relianceMatches(r, query));
  return html`<section class="reliance-listing" aria-labelledby="reliance-heading">
    <h2 class="section-heading" id="reliance-heading">Reliance</h2>
    <p class="section-lead">Computed from the latest run, never declared: the components whose files the chokepoint check touched when it resolved every reference to the protected thing. The owning component comes first.</p>
    <p class="section-lead quiet" data-field="record-limit">What the run record carries is the file list of each check, so reliance resolves to components and files. It does not carry the line and symbol of each reference site outside the bypasses, nor references to the chokepoint symbol itself, only to the protected thing; a record with every classified site would let this listing name the referencing symbols too.</p>
    ${all.length === 0
      ? html`<p class="absence">No bullet names a chokepoint, so there is nothing to rely on.</p>`
      : query === ""
        ? html`<p class="match-summary quiet">${plural(all.length, "chokepoint", "chokepoints")}.</p>`
        : shown.length === 0
          ? html`<p class="match-summary">No chokepoint matches “${state.reliance.query}”.</p>`
          : html`<p class="match-summary">${shown.length} of ${plural(all.length, "chokepoint", "chokepoints")} match “${state.reliance.query}”.</p>`}
    ${shown.map(renderReliance)}
  </section>`;
}
