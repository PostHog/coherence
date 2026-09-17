/**
 * The Glossary view: a pure function from `GlossaryViewState` to markup.
 *
 * Nothing here is stored. The filtered lists, the match counts, the targets
 * of related links, and the two-layer composition are all derived from the
 * state on every call, so the page can never disagree with itself.
 */

import { html, join, raw, slug, type Markup } from "./html.ts";
import type {
  Concept,
  Glossary,
  GlossaryViewState,
  Layer,
  Overload,
  RecordValue,
  Retirement,
  Ruling,
  TrustLevel,
} from "./model.ts";

type PresentLayer = Layer & { kind: "present" };

/** Where each concept name resolves to on the page, per layer, in layer order. */
type ConceptIndex = Map<string, Map<string, string>>;

function conceptId(layer: Layer, name: string): string {
  return `${layer.id}-${slug(name)}`;
}

function indexConcepts(layers: Layer[]): ConceptIndex {
  const index: ConceptIndex = new Map();
  for (const layer of layers) {
    if (layer.kind !== "present") continue;
    const names = new Map<string, string>();
    for (const concept of layer.glossary.concepts) {
      if (!names.has(concept.name)) names.set(concept.name, conceptId(layer, concept.name));
    }
    index.set(layer.id, names);
  }
  return index;
}

/** Resolve a name from a layer: its own concepts first, then the other layers in order. */
function resolveConcept(index: ConceptIndex, from: Layer, name: string): string | undefined {
  const own = index.get(from.id)?.get(name);
  if (own !== undefined) return own;
  for (const [layerId, names] of index) {
    if (layerId === from.id) continue;
    const id = names.get(name);
    if (id !== undefined) return id;
  }
  return undefined;
}

function matches(query: string, ...fields: (string | string[] | undefined)[]): boolean {
  if (query === "") return true;
  return fields
    .flat()
    .filter((f): f is string => f !== undefined)
    .join("\n")
    .toLowerCase()
    .includes(query);
}

/** A concept matches by name, alias, definition, or rejected name. */
function conceptMatches(concept: Concept, query: string): boolean {
  return matches(
    query,
    concept.name,
    concept.reference_aliases,
    concept.aliases,
    concept.definition,
    concept.rejected.map((r) => r.alternative),
  );
}

function humanize(key: string): string {
  return key.replace(/_/g, " ");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The sentence that says how large a glossary is. Shared by the shell masthead. */
export function glossaryCounts(glossary: Glossary): string {
  return `${plural(glossary.concepts.length, "concept", "concepts")} and ${plural(
    glossary.retirements.length,
    "retired mechanism",
    "retired mechanisms",
  )}, glossary version ${glossary.version}.`;
}

function renderQuotation(text: string, kind: "metaphor" | "owner-words"): Markup {
  const who = kind === "metaphor" ? "metaphor" : "in the owner's words";
  return html`<blockquote class="quotation ${kind}"><p>${text}</p><footer>${who}</footer></blockquote>`;
}

/** Render one value from a record, recursively, keeping quotations as quotations. */
function renderRecordValue(key: string, value: RecordValue): Markup {
  if (typeof value === "string") {
    if (key === "owner_words") return renderQuotation(value, "owner-words");
    if (key === "metaphor") return renderQuotation(value, "metaphor");
    return html`<p>${value}</p>`;
  }
  if (typeof value === "number" || typeof value === "boolean") return html`<p>${String(value)}</p>`;
  if (value === null) return html`<p class="quiet">none</p>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return html`<p class="quiet">none</p>`;
    return html`<ul class="record-list">${value.map(
      (item) => html`<li>${renderRecordValue(key, item)}</li>`,
    )}</ul>`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return html`<p class="quiet">none</p>`;
  return renderRecordFields(entries);
}

function renderRecordFields(entries: [string, RecordValue][]): Markup {
  return html`<dl class="record-fields">${entries.map(
    ([k, v]) => html`<div class="record-field"><dt>${humanize(k)}</dt><dd>${renderRecordValue(k, v)}</dd></div>`,
  )}</dl>`;
}

function renderConceptRecord(concept: Concept): Markup {
  const entries = Object.entries(concept.record);
  if (entries.length === 0) return html`<p class="quiet">Nothing further on record.</p>`;
  return html`<details class="record">
    <summary>Also on record: ${entries.map(([k]) => humanize(k)).join(", ")} (${plural(entries.length, "field", "fields")})</summary>
    ${renderRecordFields(entries)}
  </details>`;
}

function renderRejected(concept: Concept): Markup {
  if (concept.rejected.length === 0) {
    return html`<section class="rejected"><h4>Rejected</h4><p class="quiet">No alternative was recorded as rejected for this concept.</p></section>`;
  }
  return html`<section class="rejected">
    <h4>Rejected</h4>
    <ul>${concept.rejected.map(
      (r) => html`<li><span class="alternative">${r.alternative}</span><span class="because"><span class="because-word">because</span> ${r.because}</span></li>`,
    )}</ul>
  </section>`;
}

function renderRelated(layer: Layer, concept: Concept, index: ConceptIndex): Markup {
  if (concept.related.length === 0) {
    return html`<p class="related quiet">No related concepts listed.</p>`;
  }
  const links = concept.related.map((name) => {
    const target = resolveConcept(index, layer, name);
    return target === undefined
      ? html`<span class="unresolved" title="Named as related, but not a concept in any glossary on this page">${name}</span>`
      : html`<a class="related-link" href="#${target}">${name}</a>`;
  });
  return html`<p class="related"><span class="label">Related</span> ${join(
    links.map((l, i) => (i < links.length - 1 ? html`${l}, ` : l)),
  )}</p>`;
}

function renderNames(concept: Concept): Markup {
  const formerly =
    concept.reference_aliases.length > 0
      ? html`<p class="formerly"><span class="label">formerly</span> ${concept.reference_aliases.join("; ")}</p>`
      : null;
  const alsoCalled =
    concept.aliases.length > 0
      ? html`<p class="formerly"><span class="label">also called</span> ${concept.aliases.join("; ")}</p>`
      : null;
  if (formerly === null && alsoCalled === null) return html`<p class="formerly quiet">No other names.</p>`;
  return html`${formerly}${alsoCalled}`;
}

function renderNotToBeConfusedWith(concept: Concept): Markup | null {
  if (concept.not_to_be_confused_with.length === 0) return null;
  return html`<section class="distinctions">
    <h4>Not to be confused with</h4>
    <ul>${concept.not_to_be_confused_with.map((d) => html`<li>${d}</li>`)}</ul>
  </section>`;
}

function renderConcept(layer: Layer, concept: Concept, index: ConceptIndex): Markup {
  const id = conceptId(layer, concept.name);
  return html`<article class="entry concept" id="${id}">
    <div class="margin">
      <h3 class="headword"><a href="#${id}">${concept.name}</a></h3>
      ${concept.status !== undefined
        ? html`<p class="status">${concept.status}</p>`
        : html`<p class="status quiet">status not recorded</p>`}
      ${renderNames(concept)}
      ${concept.defined_by ? html`<p class="defined-by">defined by ${concept.defined_by}</p>` : null}
    </div>
    <div class="body">
      <p class="definition">${concept.definition}</p>
      ${concept.metaphor ? renderQuotation(concept.metaphor, "metaphor") : null}
      ${concept.owner_words ? renderQuotation(concept.owner_words, "owner-words") : null}
      ${renderNotToBeConfusedWith(concept)}
      ${renderRejected(concept)}
      ${renderRelated(layer, concept, index)}
      ${renderConceptRecord(concept)}
    </div>
  </article>`;
}

function renderRetirement(layer: Layer, retirement: Retirement): Markup {
  const id = `${layer.id}-retired-${slug(retirement.concept)}`;
  return html`<article class="entry retirement" id="${id}">
    <div class="margin">
      <h3 class="headword">${retirement.concept}</h3>
      <p class="status">${retirement.status ?? "retired"}</p>
      ${retirement.decided_by ? html`<p class="defined-by">decided by ${retirement.decided_by}</p>` : null}
    </div>
    <div class="body">
      <p class="definition"><span class="because-word">because</span> ${retirement.because}</p>
      ${retirement.carry_over ? html`<p class="carry-over"><span class="label">Carried over</span> ${retirement.carry_over}</p>` : null}
      ${retirement.correction ? html`<p class="correction"><span class="label">Correction</span> ${retirement.correction}</p>` : null}
      ${retirement.resolution ? html`<p class="resolution"><span class="label">Resolution</span> ${retirement.resolution}</p>` : null}
    </div>
  </article>`;
}

function renderMetaphor(name: string, text: string): Markup {
  return html`<article class="entry metaphor-entry">
    <div class="margin"><h3 class="headword">${humanize(name)}</h3></div>
    <div class="body">${renderQuotation(text, "metaphor")}</div>
  </article>`;
}

function renderTrustLevel(layer: Layer, level: TrustLevel): Markup {
  const id = `${layer.id}-trust-level-${slug(level.name)}`;
  return html`<article class="entry trust-level" id="${id}">
    <div class="margin"><h3 class="headword">${level.name}</h3><p class="status">trust level</p></div>
    <div class="body"><p class="definition">${level.meaning}</p></div>
  </article>`;
}

/** A short head for a ruling whose term is a whole question: the text before its first colon. */
function rulingHead(term: string): string {
  const colon = term.indexOf(":");
  return colon > 0 && term.length > 60 ? term.slice(0, colon) : term;
}

function renderRuling(layer: Layer, kind: "ruling" | "uncertain", ruling: Ruling, i: number): Markup {
  const head = rulingHead(ruling.term);
  const id = `${layer.id}-${kind}-${i + 1}-${slug(head)}`;
  return html`<article class="entry ${kind}" id="${id}">
    <div class="margin">
      <h3 class="headword">${head}</h3>
      ${ruling.decided_by ? html`<p class="defined-by">decided by ${ruling.decided_by}</p>` : null}
    </div>
    <div class="body">
      ${head !== ruling.term ? html`<p class="question">${ruling.term}</p>` : null}
      <p class="definition"><span class="label">Ruling</span> ${ruling.ruling}</p>
    </div>
  </article>`;
}

function renderOverload(layer: Layer, overload: Overload, i: number): Markup {
  const id = `${layer.id}-overload-${i + 1}-${slug(overload.term)}`;
  return html`<article class="entry overload" id="${id}">
    <div class="margin"><h3 class="headword">${overload.term}</h3><p class="status">${plural(overload.senses.length, "sense", "senses")}</p></div>
    <div class="body">
      <ol class="senses">${overload.senses.map((s) => html`<li>${s}</li>`)}</ol>
      ${overload.where ? html`<p class="where"><span class="label">Where</span> ${overload.where}</p>` : null}
      ${overload.ruling
        ? html`<p class="ruling-text"><span class="label">Ruling</span> ${overload.ruling}</p>`
        : html`<p class="quiet">No ruling yet.</p>`}
    </div>
  </article>`;
}

function renderMatchSummary(
  query: string,
  shown: number,
  total: number,
  noun: [string, string],
): Markup {
  if (query === "") return html`<p class="match-summary quiet">${plural(total, noun[0], noun[1])}.</p>`;
  if (shown === 0) return html`<p class="match-summary">No ${noun[0]} matches “${query}”.</p>`;
  return html`<p class="match-summary">${shown} of ${plural(total, noun[0], noun[1])} match “${query}”.</p>`;
}

/** A section over a list the glossary speaks of. Omitted entirely when the file has no such key. */
function renderListSection<T>(
  layer: Layer,
  key: string,
  heading: string,
  noun: [string, string],
  items: T[] | undefined,
  query: string,
  itemMatches: (item: T) => boolean,
  renderItem: (item: T, i: number) => Markup,
  lead: Markup | null = null,
): Markup | null {
  if (items === undefined) return null;
  const shown = items.map((item, i) => [item, i] as const).filter(([item]) => itemMatches(item));
  return html`<section class="${key}" aria-labelledby="${layer.id}-${key}-heading">
    <h2 class="section-heading" id="${layer.id}-${key}-heading">${heading}</h2>
    ${lead}
    ${items.length === 0
      ? html`<p class="quiet">This glossary lists no ${noun[1]}.</p>`
      : renderMatchSummary(query, shown.length, items.length, noun)}
    ${shown.map(([item, i]) => renderItem(item, i))}
  </section>`;
}

function renderGlossaryRecord(glossary: Glossary): Markup | null {
  const entries = Object.entries(glossary.record);
  if (entries.length === 0) return null;
  return html`<section class="glossary-record">
    <h2 class="section-heading">Also on record</h2>
    <div class="entry"><div class="margin"><p class="status">${plural(entries.length, "field", "fields")} the reading has no special form for</p></div><div class="body">${renderRecordFields(entries)}</div></div>
  </section>`;
}

function renderPresentLayer(layer: PresentLayer, state: GlossaryViewState, index: ConceptIndex): Markup {
  const rawQuery = state.query;
  const query = rawQuery.trim().toLowerCase();
  const glossary = layer.glossary;
  const trustLevelConcept = resolveConcept(index, layer, "trust level");
  const trustLead =
    trustLevelConcept !== undefined
      ? html`<p class="section-lead">Each is an instance of Coherence's concept <a class="related-link" href="#${trustLevelConcept}">trust level</a>: a name and a one-line meaning for a class of data or caller.</p>`
      : html`<p class="section-lead">Each is an instance of Coherence's concept trust level, which is not on this page.</p>`;
  return html`<section class="layer" id="layer-${layer.id}">
    <header class="layer-head">
      <h2>${layer.title}</h2>
      ${glossary.purpose ? html`<p class="purpose">${glossary.purpose}</p>` : null}
      <p class="counts">${glossaryCounts(glossary)}</p>
      ${glossary.status ? html`<p class="glossary-status quiet">Status: ${glossary.status}</p>` : null}
      ${glossary.source ? html`<p class="source quiet">Source: ${glossary.source}</p>` : null}
      ${glossary.completed ? html`<p class="completed quiet">Completed: ${glossary.completed}</p>` : null}
    </header>

    ${renderListSection(layer, "concepts", "Concepts", ["concept", "concepts"], glossary.concepts, rawQuery,
      (c) => conceptMatches(c, query),
      (c) => renderConcept(layer, c, index))}

    ${renderListSection(layer, "trust-levels", "Trust levels", ["trust level", "trust levels"], glossary.trust_levels, rawQuery,
      (t) => matches(query, t.name, t.meaning),
      (t) => renderTrustLevel(layer, t),
      trustLead)}

    ${renderListSection(layer, "rulings", "Rulings", ["ruling", "rulings"], glossary.rulings, rawQuery,
      (r) => matches(query, r.term, r.ruling),
      (r, i) => renderRuling(layer, "ruling", r, i))}

    ${renderListSection(layer, "overloads", "Candidate overloads", ["candidate overload", "candidate overloads"], glossary.candidate_overloads, rawQuery,
      (o) => matches(query, o.term, o.senses, o.where, o.ruling),
      (o, i) => renderOverload(layer, o, i),
      html`<p class="section-lead">Terms found carrying more than one sense.</p>`)}

    ${renderListSection(layer, "uncertain", "Uncertain", ["uncertain term", "uncertain terms"], glossary.uncertain, rawQuery,
      (r) => matches(query, r.term, r.ruling),
      (r, i) => renderRuling(layer, "uncertain", r, i),
      html`<p class="section-lead">Questions the glossary raised about its own names, with the ruling where one was made.</p>`)}

    ${renderListSection(layer, "retirements", "Retired mechanisms", ["retired mechanism", "retired mechanisms"], glossary.retirements, rawQuery,
      (r) => matches(query, r.concept, r.because),
      (r) => renderRetirement(layer, r))}

    ${renderListSection(layer, "metaphors", "Metaphors", ["metaphor", "metaphors"], Object.entries(glossary.metaphors), rawQuery,
      ([n, t]) => matches(query, n, t),
      ([n, t]) => renderMetaphor(n, t))}

    ${renderGlossaryRecord(glossary)}
  </section>`;
}

function renderAbsentLayer(layer: Layer & { kind: "absent" }): Markup {
  return html`<section class="layer absent" id="layer-${layer.id}">
    <header class="layer-head"><h2>${layer.title}</h2></header>
    <p class="absence">${layer.because}</p>
  </section>`;
}

/** The Glossary view body: every layer, in order, filtered by the query. */
export function renderGlossaryView(state: GlossaryViewState): Markup {
  const index = indexConcepts(state.layers);
  return raw(
    state.layers
      .map((layer) =>
        layer.kind === "present" ? renderPresentLayer(layer, state, index) : renderAbsentLayer(layer),
      )
      .map((m) => m.text)
      .join("\n"),
  );
}
