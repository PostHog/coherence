/**
 * The Runs view: the run records as a timeline, latest first. Per record the
 * session, agent, commit, dirty flag, and the counts of pass, fail, and not
 * run; the per-enforcement verdicts one click away. The latest record also
 * lists what the status view keeps from earlier runs. A pure function from
 * the shell state to markup.
 */

import { invariantId, keptFromEarlier, plural, runId, shortSession, stamp, textMatches, verdictCounts } from "./derive.ts";
import { html, type Markup } from "./html.ts";
import type { RunEntry, RunRecord, ShellState } from "./model.ts";

function runMatches(record: RunRecord, query: string): boolean {
  return textMatches(
    query,
    record.session,
    record.agent,
    record.commit,
    record.at,
    record.instrument.language,
    record.invariants.map((e) => `${e.component} ${e.name} ${e.verdict} ${e.grade ?? ""}`),
  );
}

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
}

function renderRunEntry(entry: RunEntry): Markup {
  return html`<li class="run-entry" data-verdict="${entry.verdict}">
    <span class="verdict-glyph" aria-hidden="true">${entry.verdict === "pass" ? "✓" : entry.verdict === "fail" ? "✕" : "○"}</span>
    <a class="related-link" href="#${invariantId(entry.component, entry.name)}">${entry.component}/${entry.name}</a>
    <span class="quiet">${entry.form}${entry.grade !== undefined ? ` · ${entry.grade}` : ""}${entry.mode !== undefined ? ` · ${entry.mode}` : ""} · refutation ${entry.refutation} · ${ms(entry.latency)}</span>
    <span class="verdict-word" data-verdict="${entry.verdict}">${entry.verdict}</span>
    <p class="reason quiet">${entry.reason}</p>
  </li>`;
}

function renderKept(state: ShellState): Markup | null {
  const kept = keptFromEarlier(state.runs.records);
  if (kept.length === 0) return html`<p class="quiet" data-field="kept">The latest run checked every enforcement that has ever been checked; nothing is kept from an earlier run.</p>`;
  return html`<details class="record kept-list" data-field="kept">
    <summary>Kept from earlier runs: ${plural(kept.length, "enforcement", "enforcements")} the latest run skipped</summary>
    <ul class="run-entries">${kept.map((e) => html`<li class="run-entry" data-verdict="${e.verdict}" data-kept>
      <a class="related-link" href="#${invariantId(e.component, e.name)}">${e.component}/${e.name}</a>
      <span class="quiet">${e.form} · ${e.verdict} · <span class="kept">kept from the run at ${stamp(e.at)} (${shortSession(e.session)})</span></span>
    </li>`)}</ul>
  </details>`;
}

function renderRun(state: ShellState, record: RunRecord, latest: boolean): Markup {
  const id = runId(record);
  const counts = verdictCounts(record);
  return html`<article class="entry run" id="${id}" data-latest="${latest ? "true" : "false"}" data-defects="${counts.fail > 0 ? "true" : "false"}">
    <div class="margin">
      <h3 class="headword"><a href="#${id}">${stamp(record.at)}</a></h3>
      <p class="status">${latest ? "latest run" : "run"} · ${record.agent}</p>
      <p class="defined-by" title="${record.session}">session <code>${shortSession(record.session)}</code></p>
    </div>
    <div class="body">
      <p class="definition"><span class="count" data-count="pass">${counts.pass} pass</span> <span class="count${counts.fail > 0 ? " failing" : ""}" data-count="fail">${counts.fail} fail</span> <span class="count" data-count="not-run">${counts.notRun} not run</span> <span class="quiet">of ${plural(record.invariants.length, "enforcement", "enforcements")}</span></p>
      <p class="run-facts"><span class="label">commit</span> ${record.commit === null ? html`<span class="quiet">none</span>` : html`<code>${record.commit}</code>`}${record.dirty ? html` <span class="dirty" data-dirty>dirty</span>` : html` <span class="quiet">clean</span>`}
        <span class="label">instrument</span> ${record.instrument.language} (${record.instrument.server}) <span class="label">took</span> ${ms(record.latency)}</p>
      ${record.invariants.length === 0
        ? html`<p class="quiet">No enforcement was checked.</p>`
        : html`<details class="record verdicts" data-field="verdicts">
          <summary>Verdicts: ${plural(record.invariants.length, "enforcement", "enforcements")}</summary>
          <ul class="run-entries">${record.invariants.map(renderRunEntry)}</ul>
        </details>`}
      ${latest ? renderKept(state) : null}
    </div>
  </article>`;
}

export function renderRunsTools(state: ShellState): Markup {
  return html`<div class="view-tools">
    <label class="search">
      <span class="label">Search</span>
      <input type="search" data-search value="${state.runsView.query}" placeholder="session, agent, commit, invariant, or verdict" autocomplete="off" spellcheck="false">
    </label>
  </div>`;
}

export function renderRunsResults(state: ShellState): Markup {
  const query = state.runsView.query.trim().toLowerCase();
  const records = [...state.runs.records].reverse();
  const shown = records.filter((r) => runMatches(r, query));
  const damaged = state.runs.damaged;
  return html`<section class="runs" aria-labelledby="runs-heading">
    <h2 class="section-heading" id="runs-heading">Runs</h2>
    <p class="section-lead">One record per verification pass, latest first. The verdict an invariant shows is a view over every run: an enforcement a later run skipped keeps its last verdict, dated.</p>
    ${records.length === 0
      ? html`<p class="absence">No run yet: every enforcement is declared, unverified. Run <code>run</code> to append the first record.</p>`
      : query === ""
        ? html`<p class="match-summary quiet">${plural(records.length, "run", "runs")}.</p>`
        : shown.length === 0
          ? html`<p class="match-summary">No run matches “${state.runsView.query}”.</p>`
          : html`<p class="match-summary">${shown.length} of ${plural(records.length, "run", "runs")} match “${state.runsView.query}”.</p>`}
    ${state.runs.omitted === undefined
      ? null
      : state.connection?.mode === "live"
        ? html`<p class="quiet history" data-field="omitted">${plural(state.runs.omitted, "earlier run is", "earlier runs are")} not loaded yet: none holds any enforcement's latest verdict. <button type="button" class="history-load" data-history="runs">Load earlier runs</button></p>`
        : html`<p class="quiet" data-field="omitted">${plural(state.runs.omitted, "earlier run is", "earlier runs are")} not embedded in this page: none holds any enforcement's latest verdict. Every run is under <code>.coherence/runs</code>; <code>run --status</code> reads the latest verdicts from all of them.</p>`}
    ${shown.map((r, i) => renderRun(state, r, i === 0 && r === records[0]))}
    ${damaged.length > 0
      ? html`<section class="damaged"><h4>Unreadable lines</h4><ul>${damaged.map((d) => html`<li><code>${d.file}:${d.line}</code> ${d.reason}</li>`)}</ul></section>`
      : null}
  </section>`;
}
