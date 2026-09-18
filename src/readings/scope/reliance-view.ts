/**
 * The Reliance view: computed, never declared. For each chokepoint
 * invariant, what the latest check's record can say about who relies on it.
 *
 * The record carries the files the check touched, which hold the definition
 * of the protected thing, the chokepoint's own module, the reference sites,
 * their imports and their tests, undistinguished. The only sites it locates
 * are the bypasses. So the view says both: the files, in their components,
 * as an upper bound; and how many of them are reference sites the record
 * actually places. This is the listing a human sees when acknowledging a
 * retirement, and it must not read as more certain than it is. A pure
 * function from the shell state to markup.
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

/** How many of the files outside the owning component the record places as reference sites. */
function outsideSites(reliance: Reliance): number {
  const owned = new Set(reliance.entries.filter((e) => e.owner).flatMap((e) => e.files));
  return new Set(reliance.sites.filter((s) => !owned.has(s.file)).map((s) => `${s.file}:${s.line}`)).size;
}

function renderRelianceEntry(entry: Reliance["entries"][number], reliance: Reliance): Markup {
  const name = entry.component === undefined ? "in no component" : entry.component.name;
  const folder = entry.component?.folder;
  const sitesIn = (file: string): Reliance["sites"] => reliance.sites.filter((s) => s.file === file);
  return html`<li class="reliance-entry" data-owner="${entry.owner ? "true" : "false"}">
    <p class="reliance-component">${entry.component === undefined
      ? html`<span class="unresolved" title="These files lie under no folder with a spec">${name}</span>`
      : html`<a class="related-link" href="#${componentId(entry.component.folder)}">${name}</a>`}
      ${folder !== undefined && folder !== "." ? html`<span class="quiet">${folder}</span>` : null}
      ${entry.owner ? html`<span class="owner-mark">owns the invariant</span>` : null}
    </p>
    <ul class="files">${entry.files.map((f) => html`<li><code>${f}</code>${isTestFile(f) ? html` <span class="quiet">test</span>` : null}${sitesIn(f).length === 0
      ? html` <span class="quiet" title="The record says the check touched this file; it does not say what part the file played">part unknown</span>`
      : html` <span class="quiet">${sitesIn(f).map((s) => `site ${s.line} in ${s.symbol}`).join(", ")}</span>`}</li>`)}</ul>
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
            ? html`The check touched no file outside ${invariant.component === "." ? "the root" : html`<code>${invariant.component}</code>`}: nothing on record relies on this chokepoint from elsewhere.`
            : html`${plural(others.reduce((n, e) => n + e.files.length, 0), "file", "files")} in ${plural(others.length, "component", "components")} outside <code>${invariant.component}</code> ${others.reduce((n, e) => n + e.files.length, 0) === 1 ? "was" : "were"} touched by the check; ${outsideSites(reliance) === 0 ? "none of them is a reference site the record locates" : `${outsideSites(reliance)} of them ${outsideSites(reliance) === 1 ? "is a reference site the record locates" : "are reference sites the record locates"}`}.`}
            <span class="quiet">From the check at ${stamp(entry.at)}${entry.grade !== undefined ? `, graded ${entry.grade}` : ""}.</span></p>
          ${reliance.entries.length > 0 ? html`<ul class="reliance-entries">${reliance.entries.map((e) => renderRelianceEntry(e, reliance))}</ul>` : null}`}
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
  const all = allReliance(state.spec.components, state.runs.records);
  const shown = all.filter((r) => relianceMatches(r, query));
  return html`<section class="reliance-listing" aria-labelledby="reliance-heading">
    <h2 class="section-heading" id="reliance-heading">Reliance</h2>
    <p class="section-lead">Computed from the latest run, never declared: the components whose files the chokepoint check touched when it resolved every reference to the protected thing. The owning component comes first.</p>
    <p class="section-lead quiet" data-field="record-limit">Read this as an upper bound, not as reliance: the file list a check records does not separate a reference site from the definition of the protected thing, the chokepoint's own module, an import, or a test. The only sites the record places are the bypasses, marked with their line and symbol; every other file is marked part unknown. A run entry carrying each resolved reference site, classified, would make this listing the reliance the glossary defines. Work order w-1a54ec05 covers that field; nothing here guesses at it.</p>
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
