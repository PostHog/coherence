/**
 * The Reliance view: actual classified references to either endpoint of a
 * chokepoint claim — the public chokepoint or the protected thing behind it.
 * Complete site evidence may be empty. Missing sites on a run are incomplete,
 * never evidence of zero reliance.
 */

import { allReliance, componentId, invariantId, plural, relianceId, stamp, textMatches, type Reliance, type RelianceSite } from "./derive.ts";
import { html, type Markup } from "./html.ts";
import type { ShellState } from "./model.ts";

function relianceSites(reliance: Reliance): RelianceSite[] {
  return reliance.evidence.status === "complete" ? reliance.evidence.sites : [];
}

function relianceMatches(reliance: Reliance, query: string): boolean {
  return textMatches(
    query,
    reliance.invariant.name,
    reliance.invariant.component,
    reliance.chokepoint,
    reliance.protects,
    relianceSites(reliance).flatMap((site) => [site.component?.name ?? "", site.component?.folder ?? "", site.file, String(site.line), site.symbol, site.target, site.siteClass, site.form ?? ""]),
  );
}

function relianceRole(site: RelianceSite): string {
  if (site.target === "protected" && site.siteClass === "bypass") return "protected thing · bypass (not a legal chokepoint reference)";
  if (site.target === "protected" && site.siteClass === "inside") return "protected thing · inside chokepoint";
  if (site.target === "chokepoint" && site.siteClass === "chokepoint-reference") return "chokepoint · reference (runtime call not established)";
  return `${site.target === "protected" ? "protected thing" : "chokepoint"} · ${site.siteClass}`;
}

function renderRelianceSite(site: RelianceSite): Markup {
  return html`<li data-target="${site.target}" data-class="${site.siteClass}" data-test="${site.test ? "true" : "false"}">
    <code>${site.file}:${site.line}</code> in <code>${site.symbol}</code>
    <span class="site-role">${relianceRole(site)}</span>
    ${site.form === undefined ? null : html` <span class="quiet">${site.form}</span>`}
    ${site.test ? html` <span class="label">test</span>` : null}
  </li>`;
}

function renderRelianceEntry(entry: Reliance["entries"][number]): Markup {
  const name = entry.component === undefined ? "in no component" : entry.component.name;
  const folder = entry.component?.folder;
  return html`<li class="reliance-entry" data-owner="${entry.owner ? "true" : "false"}">
    <p class="reliance-component">${entry.component === undefined
      ? html`<span class="unresolved" title="These sites lie under no folder with a spec">${name}</span>`
      : html`<a class="related-link" href="#${componentId(entry.component.folder)}">${name}</a>`}
      ${folder !== undefined && folder !== "." ? html`<span class="quiet">${folder}</span>` : null}
      ${entry.owner ? html`<span class="owner-mark">owns the invariant</span>` : null}
    </p>
    <ul class="site-list">${entry.sites.map(renderRelianceSite)}</ul>
  </li>`;
}

function renderReliance(reliance: Reliance): Markup {
  const { invariant, entry, evidence } = reliance;
  const id = relianceId(invariant.component, invariant.name);
  const count = evidence.status === "complete" ? evidence.sites.length : 0;
  return html`<article class="entry reliance" id="${id}" data-state="${invariant.state}" data-evidence="${evidence.status}">
    <div class="margin">
      <h3 class="headword"><a href="#${id}">${reliance.chokepoint}</a></h3>
      <p class="status">protects <code>${reliance.protects}</code></p>
      <p class="defined-by"><a class="related-link" href="#${invariantId(invariant.component, invariant.name)}">${invariant.name}</a> <span class="state-mark" data-state="${invariant.state}">${invariant.state}</span></p>
    </div>
    <div class="body">
      ${evidence.status === "unknown"
        ? html`<p class="definition quiet">${evidence.reason}${entry === undefined ? "; run the chokepoint check to compute it" : ""}.</p>`
        : html`<p class="definition">Complete site evidence records ${plural(count, "reference", "references")} to the chokepoint or protected thing.${entry === undefined ? null : html` <span class="quiet">From the check at ${stamp(entry.at)}${entry.grade === undefined ? "" : `, graded ${entry.grade}`}.</span>`}</p>
          ${count === 0 ? html`<p class="quiet">Both endpoint queries completed and returned no references.</p>` : html`<ul class="reliance-entries">${reliance.entries.map(renderRelianceEntry)}</ul>`}`}
    </div>
  </article>`;
}

export function renderRelianceTools(state: ShellState): Markup {
  return html`<div class="view-tools">
    <label class="search">
      <span class="label">Search</span>
      <input type="search" data-search value="${state.reliance.query}" placeholder="chokepoint, protected thing, component, symbol, or file" autocomplete="off" spellcheck="false">
    </label>
  </div>`;
}

export function renderRelianceResults(state: ShellState): Markup {
  const query = state.reliance.query.trim().toLowerCase();
  const all = allReliance(state.spec.components, state.runs.records);
  const shown = all.filter((reliance) => relianceMatches(reliance, query));
  return html`<section class="reliance-listing" aria-labelledby="reliance-heading">
    <h2 class="section-heading" id="reliance-heading">Reliance</h2>
    <p class="section-lead">Components rely on an invariant when their code references either its chokepoint or the protected thing behind it. Each site keeps its endpoint and classification; a protected bypass is never presented as a legal chokepoint reference.</p>
    <p class="section-lead quiet" data-field="record-limit">A run with no <code>sites</code> field is legacy or incomplete evidence, not zero reliance. A present empty site list means both endpoint queries completed and found zero references.</p>
    ${query === "" ? null : shown.length === 0
      ? html`<p class="match-summary">No chokepoint matches “${state.reliance.query}”.</p>`
      : html`<p class="match-summary">${shown.length} of ${plural(all.length, "chokepoint", "chokepoints")} match “${state.reliance.query}”.</p>`}
    ${shown.map(renderReliance)}
  </section>`;
}
