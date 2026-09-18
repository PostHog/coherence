/**
 * The Journal view: the merged timeline across every session, latest first,
 * with a glyph per kind; escalations awaiting a human pinned at the top; a
 * decision's rejected alternatives shown, never hidden; a conjecture's
 * candidates and discriminating test; and the work orders when the work
 * orders folder exists. Filtered by kind, agent, and session; searched by text. A
 * pure function from the shell state to markup.
 */

import {
  GLYPH,
  JOURNAL_KINDS,
  distinct,
  journalId,
  journalStatuses,
  journalText,
  openEscalations,
  plural,
  shortSession,
  stamp,
  subjectOf,
  textMatches,
  workId,
} from "./derive.ts";
import { html, type Markup } from "./html.ts";
import type { Fields, JournalRecord, RecordValue, ShellState, WorkOrder } from "./model.ts";

function renderBecause(text: string): Markup {
  return html`<p class="because" data-field="because"><span class="because-word">because</span> ${text}</p>`;
}

function renderPointer(of: string): Markup {
  return html`<a class="related-link" href="#journal-${of}">${of}</a>`;
}

/** The body of one record, by kind. Every field the record carries is shown. */
function renderBody(record: JournalRecord): Markup {
  switch (record.kind) {
    case "decision":
      return html`<p class="definition" data-field="chose">${record.chose}</p>
        <section class="rejected" data-field="over"><h4>Rejected</h4>${record.over === "none"
          ? html`<p class="quiet">none: the caller said nothing was rejected.</p>`
          : record.over.length === 0
            ? html`<p class="quiet">unexamined: the caller never said what was rejected.</p>`
            : html`<ul>${record.over.map((o) => html`<li><span class="alternative">${o}</span></li>`)}</ul>`}</section>
        ${renderBecause(record.because)}`;
    case "retraction":
      return html`<p class="definition">retract ${renderPointer(record.of)}</p>${renderBecause(record.because)}`;
    case "conjecture":
      return html`<p class="definition" data-field="observation">${record.observation}</p>
        <section class="candidates" data-field="could-be"><h4>Could be</h4><ul>${record.couldBe.map((c) => html`<li>${c}</li>`)}</ul></section>
        <p class="discriminated" data-field="discriminated-by"><span class="label">discriminated by</span> ${record.discriminatedBy}</p>`;
    case "resolution":
      return html`<p class="definition">resolved ${renderPointer(record.of)}${record.as !== undefined ? html` <span class="label">as</span> ${record.as}` : null}</p>${renderBecause(record.because)}`;
    case "dismissal":
      return html`<p class="definition">dismissed ${renderPointer(record.of)}</p>${renderBecause(record.because)}`;
    case "defect":
      return html`<p class="definition" data-field="what">${record.what}</p>
        <p data-field="evidence"><span class="label">evidence</span> ${record.evidence}</p>
        ${record.files.length > 0 ? html`<p data-field="files"><span class="label">files</span> ${record.files.map((f, i) => html`<code>${f}</code>${i < record.files.length - 1 ? ", " : ""}`)}</p>` : null}`;
    case "experiment":
      return html`<p class="definition" data-field="expectation">${record.expectation}</p>
        ${record.context.length > 0 ? html`<p data-field="context"><span class="label">context</span> ${record.context.join(", ")}</p>` : null}
        <section class="steps"><h4>Actions</h4><ol>${record.actions.map((s) => html`<li><code>${s.id}</code> ${s.text}</li>`)}</ol></section>
        <section class="steps"><h4>Success criteria</h4><ol>${record.criteria.map((s) => html`<li><code>${s.id}</code> ${s.text}</li>`)}</ol></section>`;
    case "close":
      return html`<p class="definition">closed ${renderPointer(record.of)}: <span data-outcome="${record.outcome}">${record.outcome}</span></p>
        <ul class="results">${Object.entries(record.results).map(([id, result]) => html`<li><code>${id}</code> ${result}</li>`)}</ul>`;
    case "unable":
    case "escalation":
      return html`<p class="definition" data-field="what">${record.what}</p>${renderBecause(record.because)}`;
    case "acknowledgement":
      return html`<p class="definition">acknowledged ${renderPointer(record.of)}</p>${renderBecause(record.because)}`;
  }
}

function renderRecord(record: JournalRecord, status: string | undefined, pinned = false): Markup {
  const id = journalId(record);
  return html`<article class="entry journal-record" id="${pinned ? `pinned-${id}` : id}" data-kind="${record.kind}"${pinned ? html` data-pinned` : null}>
    <div class="margin">
      <h3 class="headword"><span class="glyph" aria-hidden="true">${GLYPH[record.kind]}</span> <a href="#${id}">${record.kind}</a></h3>
      <p class="status">${stamp(record.at)}</p>
      <p class="defined-by">${record.agent} · <span title="${record.session}">${shortSession(record.session)}</span></p>
      <p class="defined-by"><code>${record.id}</code>${record.commit !== null ? html` at <code>${record.commit}</code>${record.dirty ? ", dirty" : ""}` : null}</p>
      ${record.work !== undefined ? html`<p class="defined-by">work order <a class="related-link" href="#${workId(record.work)}">${record.work}</a></p>` : null}
      ${status !== undefined ? html`<p class="record-status" data-status>${status}</p>` : null}
    </div>
    <div class="body">${renderBody(record)}</div>
  </article>`;
}

function fieldText(value: RecordValue | undefined): string | undefined {
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
}

function renderWorkField(key: string, value: RecordValue): Markup {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return html`<p>${String(value)}</p>`;
  if (value === null) return html`<p class="quiet">none</p>`;
  if (Array.isArray(value)) return value.length === 0 ? html`<p class="quiet">none</p>` : html`<ul class="record-list">${value.map((v) => html`<li>${renderWorkField(key, v)}</li>`)}</ul>`;
  const entries = Object.entries(value);
  return entries.length === 0 ? html`<p class="quiet">none</p>` : html`<dl class="record-fields">${entries.map(([k, v]) => html`<div class="record-field" data-field="${k}"><dt>${k.replace(/_/g, " ")}</dt><dd>${renderWorkField(k, v)}</dd></div>`)}</dl>`;
}

/** A work order as the file said it: the fields the view recognizes in the margin, the rest in the body. */
function renderWorkOrder(order: WorkOrder): Markup {
  const fields: Fields = order.fields;
  const state = fieldText(fields["state"]);
  const objective = fieldText(fields["objective"]);
  const owner = fieldText(fields["owner"]) ?? fieldText(fields["session"]);
  const rest = Object.entries(fields).filter(([k]) => k !== "state" && k !== "objective" && k !== "id");
  return html`<article class="entry work-order" id="${workId(order.id)}" data-state="${state ?? ""}">
    <div class="margin">
      <h3 class="headword"><a href="#${workId(order.id)}">${order.id}</a></h3>
      <p class="status">${state ?? "state not recorded"}</p>
      ${owner !== undefined ? html`<p class="defined-by">owner <span title="${owner}">${shortSession(owner)}</span></p>` : null}
    </div>
    <div class="body">
      ${objective !== undefined ? html`<p class="definition">${objective}</p>` : html`<p class="definition quiet">No objective field.</p>`}
      ${rest.length > 0 ? html`<dl class="record-fields">${rest.map(([k, v]) => html`<div class="record-field" data-field="${k}"><dt>${k.replace(/_/g, " ")}</dt><dd>${renderWorkField(k, v)}</dd></div>`)}</dl>` : null}
    </div>
  </article>`;
}

function renderWork(state: ShellState): Markup {
  const work = state.journal.work;
  return html`<section class="work-orders" aria-labelledby="work-heading">
    <h2 class="section-heading" id="work-heading">Work orders</h2>
    ${work.kind === "absent"
      ? html`<p class="absence" data-field="work-absent">No work orders: ${work.because}</p>`
      : work.orders.length === 0
        ? html`<p class="absence" data-field="work-absent">No work orders: the work orders folder exists and is empty.</p>`
        : html`<p class="match-summary quiet">${plural(work.orders.length, "work order", "work orders")}.</p>${work.orders.map(renderWorkOrder)}`}
    ${work.kind === "present" && work.damaged.length > 0
      ? html`<ul class="damaged">${work.damaged.map((d) => html`<li><code>${d.file}:${d.line}</code> ${d.reason}</li>`)}</ul>`
      : null}
  </section>`;
}

export function renderJournalTools(state: ShellState): Markup {
  const view = state.journalView;
  const agents = distinct(state.journal.records.map((r) => r.agent)).sort();
  const sessions = distinct(state.journal.records.map((r) => r.session));
  return html`<div class="view-tools">
    <label class="search">
      <span class="label">Search</span>
      <input type="search" data-search value="${view.query}" placeholder="text, id, agent, or session" autocomplete="off" spellcheck="false">
    </label>
    <div class="filters">
      <label class="filter"><span class="label">Kind</span>
        <select data-filter="kind">
          <option value="" ${view.kind === "" ? "selected" : ""}>every kind</option>
          ${JOURNAL_KINDS.map((k) => html`<option value="${k}" ${view.kind === k ? "selected" : ""}>${GLYPH[k]} ${k}</option>`)}
        </select></label>
      <label class="filter"><span class="label">Agent</span>
        <select data-filter="agent">
          <option value="" ${view.agent === "" ? "selected" : ""}>every agent</option>
          ${agents.map((a) => html`<option value="${a}" ${view.agent === a ? "selected" : ""}>${a}</option>`)}
        </select></label>
      <label class="filter"><span class="label">Session</span>
        <select data-filter="session">
          <option value="" ${view.session === "" ? "selected" : ""}>every session</option>
          ${sessions.map((s) => html`<option value="${s}" ${view.session === s ? "selected" : ""}>${shortSession(s)}</option>`)}
        </select></label>
    </div>
  </div>`;
}

export function renderJournalResults(state: ShellState): Markup {
  const view = state.journalView;
  const query = view.query.trim().toLowerCase();
  const records = state.journal.records;
  const status = journalStatuses(records);
  const open = openEscalations(records);
  const shown = [...records]
    .reverse()
    .filter(
      (r) =>
        (view.kind === "" || r.kind === view.kind) &&
        (view.agent === "" || r.agent === view.agent) &&
        (view.session === "" || r.session === view.session) &&
        textMatches(query, journalText(r)),
    );
  const filtered = view.kind !== "" || view.agent !== "" || view.session !== "" || query !== "";
  return html`${open.length > 0
    ? html`<section class="escalations" aria-labelledby="escalations-heading" data-field="escalations">
      <h2 class="section-heading" id="escalations-heading">Awaiting a human (${open.length})</h2>
      <p class="section-lead">Escalations no acknowledgement points at. Each heads every read until a human answers it.</p>
      ${open.map((r) => renderRecord(r, status.get(r.id), true))}
    </section>`
    : html`<p class="quiet" data-field="escalations">No escalation awaits a human.</p>`}
  <section class="timeline" aria-labelledby="journal-heading">
    <h2 class="section-heading" id="journal-heading">Timeline</h2>
    <p class="section-lead">Every record across every session, latest first. A record answered by a later one (retracted, resolved, dismissed, closed, acknowledged) carries that answer in its margin; nothing on disk changes.</p>
    ${records.length === 0
      ? html`<p class="absence">Nothing recorded.</p>`
      : !filtered
        ? html`<p class="match-summary quiet">${plural(records.length, "record", "records")}.</p>`
        : shown.length === 0
          ? html`<p class="match-summary">No record matches.</p>`
          : html`<p class="match-summary">${shown.length} of ${plural(records.length, "record", "records")} shown.</p>`}
    ${shown.map((r) => renderRecord(r, status.get(r.id)))}
    ${state.journal.damaged.length > 0
      ? html`<section class="damaged"><h4>Unreadable lines</h4><ul>${state.journal.damaged.map((d) => html`<li><code>${d.file}:${d.line}</code> ${d.reason}</li>`)}</ul></section>`
      : null}
  </section>
  ${renderWork(state)}`;
}

/** The one line that stands for a record, for the masthead's count of what awaits a human. */
export function escalationSubjects(state: ShellState): string[] {
  return openEscalations(state.journal.records).map(subjectOf);
}
