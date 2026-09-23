/**
 * The Lexicon view: a pure function from `LexiconViewState` to markup.
 *
 * Nothing here is stored. The filtered lists, the match counts, the targets
 * of related links, and the two-layer composition are all derived from the
 * state on every call, so the page can never disagree with itself.
 */

import { lexiconReviewCommand } from "./model.ts";
import { plural } from "./derive.ts";
import { html, join, raw, slug, type Markup } from "./html.ts";
import type {
  Concept,
  Fields,
  Lexicon,
  LexiconCoverage,
  LexiconViewState,
  Layer,
  Overload,
  RecordValue,
  RejectedName,
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
    for (const concept of layer.lexicon.concepts) {
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
    concept.aliases,
    concept.instances ?? [],
    concept.definition,
    concept.rejected.map((r) => r.alternative),
  );
}

function humanize(key: string): string {
  return key.replace(/_/g, " ");
}

/** The sentence that says how large a lexicon is. Shared by the shell masthead. */
export function lexiconCounts(lexicon: Lexicon): string {
  return `${plural(lexicon.concepts.length, "concept", "concepts")}, lexicon version ${lexicon.version}.`;
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
    ([k, v]) => html`<div class="record-field" data-field="${k}"><dt>${humanize(k)}</dt><dd>${renderRecordValue(k, v)}</dd></div>`,
  )}</dl>`;
}

/**
 * A named set of fields one click away: the disclosure's summary names the
 * fields it holds, so the reader knows what opening it will show. Omitted
 * when there are no fields.
 */
function renderDisclosure(kind: "detail" | "provenance", label: string, fields: Fields): Markup | null {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return html`<details class="record ${kind}" data-section="${kind}">
    <summary>${label}: ${entries.map(([k]) => humanize(k)).join(", ")} (${plural(entries.length, "field", "fields")})</summary>
    ${renderRecordFields(entries)}
  </details>`;
}

/** Fields the reading has no place for, kept as the file said them. */
function renderConceptRecord(concept: Concept): Markup {
  const entries = Object.entries(concept.record);
  if (entries.length === 0) return html``;
  return html`<details class="record" data-section="record">
    <summary>Also on record: ${entries.map(([k]) => humanize(k)).join(", ")} (${plural(entries.length, "field", "fields")})</summary>
    ${renderRecordFields(entries)}
  </details>`;
}

function renderProperties(concept: Concept): Markup | null {
  const entries = Object.entries(concept.properties);
  if (entries.length === 0) return null;
  return html`<section class="properties" data-field="properties">
    <h4>Properties</h4>
    ${renderRecordFields(entries)}
  </section>`;
}

function renderOpenQuestions(concept: Concept): Markup | null {
  if (concept.open_questions.length === 0) return null;
  return html`<section class="open-questions" data-field="open_questions">
    <h4>Open questions</h4>
    <ul>${concept.open_questions.map((q) => html`<li>${q}</li>`)}</ul>
  </section>`;
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
      ? html`<span class="unresolved" title="Named as related, but not a concept in any lexicon on this page">${name}</span>`
      : html`<a class="related-link" href="#${target}">${name}</a>`;
  });
  return html`<p class="related"><span class="label">Related</span> ${join(
    links.map((l, i) => (i < links.length - 1 ? html`${l}, ` : l)),
  )}</p>`;
}

function renderNames(concept: Concept): Markup {
  if (concept.aliases.length === 0) return html`<p class="formerly quiet">No other names.</p>`;
  return html`<p class="formerly"><span class="label">also called</span> ${concept.aliases.join("; ")}</p>`;
}

function renderNotToBeConfusedWith(concept: Concept): Markup | null {
  if (concept.not_to_be_confused_with.length === 0) return null;
  return html`<section class="distinctions" data-field="not_to_be_confused_with">
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
      ${concept.instances?.length ? html`<p>Instances: ${concept.instances.join(", ")}</p>` : null}
    </div>
    <div class="body">
      <div class="vocabulary" data-section="vocabulary">
        <p class="definition" data-field="definition">${concept.definition}</p>
        ${renderProperties(concept)}
        ${renderNotToBeConfusedWith(concept)}
        ${renderRejected(concept)}
        ${renderRelated(layer, concept, index)}
        ${renderOpenQuestions(concept)}
      </div>
      ${renderDisclosure("detail", "Detail", concept.detail)}
      ${renderDisclosure("provenance", "Provenance", concept.provenance)}
      ${renderConceptRecord(concept)}
    </div>
  </article>`;
}

function renderRejectedName(layer: Layer, rejected: RejectedName): Markup {
  const id = `${layer.id}-rejected-${slug(rejected.concept)}`;
  return html`<article class="entry rejected-name" id="${id}">
    <div class="margin">
      <h3 class="headword">${rejected.concept}</h3>
      <p class="status">rejected</p>
      ${rejected.decided_by ? html`<p class="defined-by">decided by ${rejected.decided_by}</p>` : null}
    </div>
    <div class="body">
      <p class="definition"><span class="because-word">because</span> ${rejected.because}</p>
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

/** A section over a list the lexicon speaks of. Omitted entirely when the file has no such key. */
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
      ? html`<p class="quiet">This lexicon lists no ${noun[1]}.</p>`
      : renderMatchSummary(query, shown.length, items.length, noun)}
    ${shown.map(([item, i]) => renderItem(item, i))}
  </section>`;
}

function renderLexiconRecord(lexicon: Lexicon): Markup | null {
  const entries = Object.entries(lexicon.record);
  if (entries.length === 0) return null;
  return html`<section class="lexicon-record">
    <h2 class="section-heading">Also on record</h2>
    <div class="entry"><div class="margin"><p class="status">${plural(entries.length, "field", "fields")} the reading has no special form for</p></div><div class="body">${renderRecordFields(entries)}</div></div>
  </section>`;
}

function renderPresentLayer(layer: PresentLayer, state: LexiconViewState, index: ConceptIndex): Markup {
  const rawQuery = state.query;
  const query = rawQuery.trim().toLowerCase();
  const lexicon = layer.lexicon;
  const trustLevelConcept = resolveConcept(index, layer, "trust level");
  const trustLead =
    trustLevelConcept !== undefined
      ? html`<p class="section-lead">Each is an instance of Coherence's concept <a class="related-link" href="#${trustLevelConcept}">trust level</a>: a name and a one-line meaning for a class of data or caller.</p>`
      : html`<p class="section-lead">Each is an instance of Coherence's concept trust level, which is not on this page.</p>`;
  return html`<section class="layer" id="layer-${layer.id}">
    <header class="layer-head">
      <h2>${layer.title}</h2>
      ${lexicon.purpose ? html`<p class="purpose">${lexicon.purpose}</p>` : null}
      <p class="counts">${lexiconCounts(lexicon)}</p>
      ${lexicon.status ? html`<p class="lexicon-status quiet">Status: ${lexicon.status}</p>` : null}
      ${lexicon.source ? html`<p class="source quiet">Source: ${lexicon.source}</p>` : null}
      ${lexicon.completed ? html`<p class="completed quiet">Completed: ${lexicon.completed}</p>` : null}
    </header>

    ${renderListSection(layer, "concepts", "Concepts", ["concept", "concepts"], lexicon.concepts, rawQuery,
      (c) => conceptMatches(c, query),
      (c) => renderConcept(layer, c, index))}

    ${renderListSection(layer, "trust-levels", "Trust levels", ["trust level", "trust levels"], lexicon.trust_levels, rawQuery,
      (t) => matches(query, t.name, t.meaning),
      (t) => renderTrustLevel(layer, t),
      trustLead)}

    ${renderListSection(layer, "rulings", "Rulings", ["ruling", "rulings"], lexicon.rulings, rawQuery,
      (r) => matches(query, r.term, r.ruling),
      (r, i) => renderRuling(layer, "ruling", r, i))}

    ${renderListSection(layer, "overloads", "Candidate overloads", ["candidate overload", "candidate overloads"], lexicon.candidate_overloads, rawQuery,
      (o) => matches(query, o.term, o.senses, o.where, o.ruling),
      (o, i) => renderOverload(layer, o, i),
      html`<p class="section-lead">Terms found carrying more than one sense.</p>`)}

    ${renderListSection(layer, "uncertain", "Uncertain", ["uncertain term", "uncertain terms"], lexicon.uncertain, rawQuery,
      (r) => matches(query, r.term, r.ruling),
      (r, i) => renderRuling(layer, "uncertain", r, i),
      html`<p class="section-lead">Questions the lexicon raised about its own names, with the ruling where one was made.</p>`)}

    ${renderListSection(layer, "rejected-names", "Rejected names", ["rejected name", "rejected names"], lexicon.rejected_names, rawQuery,
      (r) => matches(query, r.concept, r.because),
      (r) => renderRejectedName(layer, r),
      html`<p class="section-lead">Names this lexicon refuses at the top level, each with its because.</p>`)}

    ${renderListSection(layer, "metaphors", "Metaphors", ["metaphor", "metaphors"], Object.entries(lexicon.metaphors), rawQuery,
      ([n, t]) => matches(query, n, t),
      ([n, t]) => renderMetaphor(n, t))}

    ${renderLexiconRecord(lexicon)}
  </section>`;
}

function renderAbsentLayer(layer: Layer & { kind: "absent" }): Markup {
  return html`<section class="layer absent" id="layer-${layer.id}">
    <header class="layer-head"><h2>${layer.title}</h2></header>
    <p class="absence">${layer.because}</p>
  </section>`;
}

/**
 * The attention signal the section leads with: the recurring terms that lack a
 * definition, most recurring first, then the uses whose sense is at risk. Names
 * only, never a total; the population's numbers wait in its disclosure.
 */
function renderAttention(coverage: LexiconCoverage): Markup {
  const signal = coverage.attention;
  if (!signal) return html`<p class="section-lead">This reading carries no ranked signal; the full one: <code>coherence lexicon coverage</code>.</p>`;
  if (signal.undefinedTerms.length === 0 && signal.senses.length === 0)
    return html`<p class="section-lead attention-clear">No recurring term lacks a definition, and no use's sense is at risk.</p>`;
  return html`${signal.undefinedTerms.length > 0 ? html`<h3>Recurring terms that lack a definition, most recurring first</h3>
    <ol class="attention-terms">${signal.undefinedTerms.map((t) => html`<li><strong>${t.term}</strong>
      <span class="quiet">— on ${plural(t.prose, "prose line", "prose lines")} across ${plural(t.components, "component", "components")}; first at <code>${t.first}</code></span></li>`)}</ol>
    ${signal.more.undefinedTerms ? html`<p class="quiet">More recur; the rest: <code>coherence lexicon coverage</code>.</p>` : null}
    <p class="quiet">Declare each (<code>coherence lexicon propose declare &lt;term&gt;</code>) or map it as an alias of an existing concept.</p>` : null}
    ${signal.senses.length > 0 ? html`<h3>Senses at risk</h3>
    <ul class="attention-senses">${signal.senses.map((s) => html`<li><strong>${s.term}</strong> in ${s.component}
      <span class="quiet">— ${s.reason}; evidence <code>${s.evidence}</code></span></li>`)}</ul>
    ${signal.more.senses ? html`<p class="quiet">More are at risk; the rest: <code>coherence lexicon coverage</code>.</p>` : null}
    <p class="quiet">Check each use against the definition: <code>coherence lexicon review &lt;term&gt;</code>.</p>` : html`<p class="quiet">No use's sense is at risk.</p>`}`;
}

/** Live evidence is a reading beside the lexicon, never an address stored in a concept. */
function renderVocabularyCoverage(state: LexiconViewState): Markup | null {
  const coverage = state.coverage;
  if (!coverage) return null;
  const query = state.query.trim().toLowerCase();
  const population = coverage.projection?.population ?? {
    files: coverage.population.files.length,
    excluded: coverage.population.excluded.length,
    unreadable: coverage.population.unreadable.length,
  };
  const fullContexts = coverage.projection?.contexts ?? coverage.terms.reduce((n, t) => n + t.contexts.length, 0);
  const embeddedContexts = coverage.terms.reduce((n, t) => n + t.contexts.length, 0);
  const embeddedUses = coverage.terms.reduce((n, t) => n + t.uses.length, 0);
  const ranked = new Set((coverage.attention?.undefinedTerms ?? []).map((t) => t.term));
  const terms = coverage.terms.filter((t) => query
    ? matches(query, t.term, t.concept ?? "", t.definition ?? "", JSON.stringify(t.properties), t.confusables,
        t.meaningAlternatives?.flatMap((meaning) => [meaning.concept, meaning.layer, meaning.definition, JSON.stringify(meaning.properties), ...meaning.confusables]),
        t.contexts.map((c) => `${c.component} ${c.disposition} ${c.risk ?? ""} ${c.because ?? ""}`), t.uses.map((u) => `${u.file} ${u.text}`))
    : ranked.has(t.term) || (t.unreviewedContextCount ?? 0) > 0);
  return html`<section class="lexicon-coverage"><h2>Vocabulary coverage and sense review</h2>
    ${renderAttention(coverage)}
    <p class="quiet">Record a ruling with <code>coherence lexicon review</code>; this page writes nothing. Full reading from this project's root:
      <code>coherence lexicon coverage --json</code>; one term: <code>coherence query lexicon &lt;term&gt;</code>.</p>
    ${query ? html`<p>Search is limited to embedded terms, contexts and use excerpts; refine it or use the full CLI reading.</p>` : null}
    ${query && terms.length === 0 ? html`<p>No matching evidence in this page selection; this is not a corpus absence claim.
      Full term reading: <code>${lexiconReviewCommand(state.query.trim())}</code>.</p>` : null}
    ${terms.slice(0, 30).map((t) => html`<details><summary>${t.term} — ${t.state}${t.recurrence ? html`; recurs on ${plural(t.recurrence.prose, "prose line", "prose lines")} across ${plural(t.recurrence.components, "component", "components")}` : null}</summary>
      ${t.meaningAlternatives !== undefined && t.meaningAlternatives.length > 0
        ? html`<p>${plural(t.meaningAlternatives.length, "applicable property meaning", "applicable property meanings")}; this spelling alone does not select an owner.</p>
          <ul class="meaning-alternatives">${t.meaningAlternatives.map((meaning) => html`<li>
            <strong>${meaning.concept}</strong> <span class="quiet">${meaning.layer}</span> — ${meaning.definition}
            <br><span class="quiet">Properties: ${JSON.stringify(meaning.properties)}. Confusables: ${meaning.confusables.join("; ") || "none declared"}.</span>
          </li>`)}</ul>`
        : html`<p>${t.definition ?? "No settled definition. Declare, map, or fix; do not infer meaning from a spelling."}</p>
          <p>Properties: ${JSON.stringify(t.properties)}. Confusables: ${t.confusables.join("; ") || "none declared"}.</p>`}
      ${t.contexts.map((c) => html`<p>${c.component}: ${c.disposition}${c.risk ? html`; <strong>sense at risk</strong>: ${c.risk}` : null}${c.because ? " — " + c.because : ""}<br><code>${c.fingerprint}</code></p>`)}
      <ul>${t.uses.slice(0, 8).map((u) => html`<li><code>${u.file}:${u.line}</code> ${u.text}</li>`)}</ul>
      <p class="quiet">${t.contexts.length} of ${t.contextCount ?? t.contexts.length} contexts and ${Math.min(t.uses.length, 8)} of ${t.count} uses shown.
        Full definition, contexts, evidence keys and uses: <code>${lexiconReviewCommand(t.term)}</code>.</p>
    </details>`)}
    ${terms.length > 30 ? html`<p class="quiet">More terms match; refine the search or use the full CLI reading.</p>` : null}
    <details><summary>Population and limits</summary>
      <p>Full observed population: ${population.files} files; ${coverage.totals.terms} observed candidate terms; ${coverage.totals.uses} uses;
        ${coverage.totals.known} declared; ${coverage.totals.rejected} rejected; ${coverage.totals.unresolved} unresolved;
        ${coverage.totals.unreviewedContexts} contexts whose sense is at risk await review. This is not a semantic coverage percentage.</p>
      <p>${population.excluded} exclusions; ${population.unreadable} unreadable.</p>
      <p>Page evidence: ${coverage.terms.length} of ${coverage.totals.terms} terms embedded; ${coverage.totals.terms - coverage.terms.length} terms omitted.
        ${embeddedContexts} of ${fullContexts} contexts embedded; ${fullContexts - embeddedContexts} contexts omitted.
        ${embeddedUses} of ${coverage.totals.uses} uses embedded; ${coverage.totals.uses - embeddedUses} uses omitted.</p>
      ${coverage.projection ? html`<p>Bounded evidence selection (at most ${coverage.projection.byteLimit} embedded JSON bytes): ${coverage.projection.selection}
        Search covers only embedded evidence. A missing term or no match does not establish absence from the full corpus.</p>` : null}
      <p>${coverage.population.extraction}</p>
      <p>Source reading fingerprint: <code>${coverage.fingerprint}</code>.</p>
      <ul>${coverage.population.limits.map((l) => html`<li>${l}</li>`)}</ul>
      <p>${Math.min(coverage.population.files.length, 30)} of ${population.files} file records shown; ${population.files - Math.min(coverage.population.files.length, 30)} file records omitted.</p>
      <ul>${coverage.population.files.slice(0, 30).map((f) => html`<li>${f.file}: ${f.kind}, ${f.lines} lines</li>`)}</ul>
      <p>${Math.min(coverage.population.excluded.length, 30)} of ${population.excluded} exclusion records shown; ${population.excluded - Math.min(coverage.population.excluded.length, 30)} exclusion records omitted.</p>
      <ul>${coverage.population.excluded.slice(0, 30).map((e) => html`<li>${e.file}: ${e.reason}</li>`)}</ul>
      <p>${Math.min(coverage.population.unreadable.length, 30)} of ${population.unreadable} unreadable records shown; ${population.unreadable - Math.min(coverage.population.unreadable.length, 30)} unreadable records omitted.</p>
      <ul>${coverage.population.unreadable.slice(0, 30).map((e) => html`<li>${e.file}: ${e.reason}</li>`)}</ul>
    </details>
  </section>`;
}

/** The Lexicon view body: every layer, in order, filtered by the query. */
export function renderLexiconView(state: LexiconViewState): Markup {
  const index = indexConcepts(state.layers);
  return raw(
    (renderVocabularyCoverage(state)?.text ?? "") + state.layers
      .map((layer) =>
        layer.kind === "present" ? renderPresentLayer(layer, state, index) : renderAbsentLayer(layer),
      )
      .map((m) => m.text)
      .join("\n"),
  );
}
