/**
 * The Home view: where the project stands, in a sentence, over the project
 * drawn as its files. A project with no invariant yet is being set up, so
 * Home walks its onboarding one step at a time; once an invariant holds, Home
 * says whether everything holds, what (if anything) waits on a person, and
 * where recent work landed. Everything else is a view away. A pure function
 * from the state to markup; the scene is mounted into its host as
 * Structure's is (relief/mount.ts), in file view.
 */

import { allInvariants, invariantId, invariantVerdict, openEscalations, plural } from "./derive.ts";
import { flowOf } from "./structure-flow.ts";
import { html, raw, type Markup } from "./html.ts";
import type { ShellState, SpecComponent, SpecInvariant } from "./model.ts";
import { reliefAbsence } from "./relief/data.ts";

type Read = Extract<NonNullable<ShellState["relief"]>, { kind: "read" }>;

/** Whether Home opens as onboarding: nothing the project keeps is an invariant yet. */
export function onboarding(state: ShellState): boolean {
  return state.spec.counts.invariants === 0;
}

const DAY = 86400000;

function readOf(state: ShellState): Read | undefined {
  return state.relief?.kind === "read" ? (state.relief as Read) : undefined;
}

/** Names in a sentence: "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A component's display name: a folder with no spec loses its trailing slash. */
const named = (name: string): string => name.replace(/\/$/, "");

/** The project drawn as its files; while it is set up its components are named on it, so a new component is seen to stand apart. Beneath it, when the reading knows when its components were named, a replay of how it took shape. */
function picture(state: ShellState, named = false): Markup {
  const absent = reliefAbsence(state);
  if (absent !== undefined) return html`<p class="absence">${absent}</p>`;
  const specs = state.relief?.kind === "read" ? (state.relief.specs ?? []) : [];
  return html`<div class="relief-host home-relief"${named ? html` data-named` : null} data-relief-host></div>
    ${specs.length > 0 ? html`<div class="home-replay"><button type="button" class="home-replay-button" data-replay>▶ Replay how ${state.project} took shape</button><p class="home-replay-caption" data-replay-caption aria-live="polite"></p><ul class="home-replay-named" data-replay-named></ul></div>` : null}`;
}

/** A line of the doc as markup: its text escaped, then `code` and **bold** drawn. */
function inline(text: string): Markup {
  const escaped = html`${text}`.text;
  return raw(escaped.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"));
}

/** How Coherence works, told as the five moments of a session from docs/how-coherence-works.md: tabs to click through, each a plain line with what happens under it. No script: a radio per tab, shown by CSS. */
function whatIs(state: ShellState): Markup {
  const how = state.howItWorks;
  if (how === undefined) return html``;
  if (how.kind === "unread") return html`<section class="home-moments"><p class="absence">How Coherence works could not be shown: ${how.because}.</p></section>`;
  return html`<section class="home-moments" aria-labelledby="home-moments-title">
    <h3 class="home-label" id="home-moments-title">${how.title}</h3>
    ${how.lead.split("\n\n").map((paragraph) => html`<p class="home-sub">${inline(paragraph)}</p>`)}
    ${how.moments.map((_, i) => html`<input class="home-moment-radio" type="radio" name="home-moment" id="home-moment-${i + 1}"${i === 0 ? html` checked` : null}>`)}
    <div class="home-moment-tabs">${how.moments.map((m, i) => html`<label for="home-moment-${i + 1}" data-n="${i + 1}"><span class="home-moment-n">${i + 1}</span>${m.tab}</label>`)}</div>
    <div class="home-moment-bodies">${how.moments.map((m, i) => html`<div class="home-moment" data-n="${i + 1}">
      <p class="home-moment-events">${m.events.join(" · ")}</p>
      <p class="home-moment-plain">${inline(m.plain)}</p>
      <ul>${m.details.map((d) => html`<li>${inline(d)}</li>`)}</ul>
      ${lastSaid(state, m.events)}
    </div>`)}</div>
  </section>`;
}

/** A section's heading on its row: its first line's first characters. */
const SECTION_HEAD = 140;
/** The most characters a label runs to: past it, the words before a colon are a sentence, not a label. */
const LABEL_MAX = 72;

/**
 * A message's sections, as it lays them out: blocks apart by a blank line, and inside one block, each line flush left that
 * ends in a colon (as a stop's "Spec:" or "Practices (advisory):") opens a section of its own.
 */
export function sectionsOf(text: string): string[] {
  const sections: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    let section: string[] = [];
    for (const line of block.split("\n")) {
      if (section.length > 0 && /^\S.*:$/.test(line)) {
        sections.push(section.join("\n"));
        section = [];
      }
      section.push(line);
    }
    if (section.some((l) => l.trim() !== "")) sections.push(section.join("\n"));
  }
  return sections.map((p) => p.trim()).filter((p) => p !== "");
}

/**
 * A section's label and what follows it: the words before its first colon outside parentheses, less any parenthetical,
 * which opens the rest, when they are few (LABEL_MAX); none when the section opens with no label.
 */
export function labelOf(section: string): { label?: string; body: string } {
  const first = section.split("\n")[0] ?? "";
  let depth = 0;
  let colon = -1;
  for (let i = 0; i < first.length; i++) {
    const ch = first[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0 && (i + 1 === first.length || /\s/.test(first[i + 1]!))) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return { body: section };
  const whole = first.slice(0, colon);
  const label = whole.replace(/\s*\(.*$/, "").trim();
  if (label === "" || label.length > LABEL_MAX) return { body: section };
  const aside = whole.slice(label.length).trim();
  const rest = section.slice(colon + 1).trim();
  return { label, body: aside === "" ? rest : rest === "" ? aside : `${aside}\n${rest}` };
}

/**
 * The last thing Coherence said at one moment of a session, in its own words, as the hooks kept it
 * (lifecycle/hook-said.ts): when, to whom, and for a tool moment which tool on which file, then a row for each section of
 * what it said, headed by the section's first line, so the whole of it can be skimmed; a section longer than its heading
 * opens to the rest. A moment that has said nothing in this project yet says so; most tool calls say nothing at all.
 */
function lastSaid(state: ShellState, events: readonly string[]): Markup {
  const said = events
    .flatMap((event) => (state.hookSaid?.[event] ?? []).map((s) => ({ ...s, event })))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0];
  if (said === undefined) return html`<p class="home-said-none">Coherence has said nothing at this moment in this project yet: most of the time it has nothing to say here.</p>`;
  const when = `${said.at.slice(0, 10)} ${said.at.slice(11, 16)} UTC`;
  const to = said.to === "user" ? "shown to you" : "told the agent";
  const about = said.tool === undefined ? "" : said.file === undefined ? ` · ${said.tool}` : ` · ${said.tool} ${said.file}`;
  const sub = said.event.startsWith("Subagent") ? " · a subagent" : "";
  // A row leads with the section's own label, when it opens with one ("Spec gaps:", "Hand lists (…):"), and glimpses the rest.
  const row = (section: string): Markup => {
    const { label, body } = labelOf(section);
    // The glimpse is the section's substance: a parenthetical that opens the rest is left to the opened row.
    const glimpse = (body.startsWith("(") && body.includes("\n") ? body.split("\n")[1] : body.split("\n")[0]) ?? "";
    const lines = body === "" ? 0 : body.split("\n").length;
    if (label === undefined && lines <= 1 && glimpse.length <= SECTION_HEAD) return html`<li class="home-said-row home-said-whole"><span class="home-said-glimpse">${glimpse}</span></li>`;
    return html`<li><details class="home-said-row"><summary>${label === undefined ? null : html`<span class="home-said-label">${label}</span>`}<span class="home-said-glimpse">${glimpse}</span>${lines > 1 ? html`<span class="home-said-count">${lines} lines</span>` : null}</summary><pre class="home-said-text">${body}</pre></details></li>`;
  };
  return html`<div class="home-said">
    <p class="home-said-head">What Coherence last ${to} here <span class="home-date">${when}${about}${sub}</span></p>
    <ul class="home-said-rows">${sectionsOf(said.text).map(row)}</ul>
  </div>`;
}

/**
 * How many of the entrances the reading detected no spec declares, as a neutral count in Home's quiet ink: undeclared
 * is the normal state of a detected entrance, never a gap (d-a37af46f), and the count stands where the reader starts so
 * it is never a quiet place to leave routes (d-a1095ef2). Nothing when none is detected or every one is declared.
 */
function undeclaredLine(state: ShellState): Markup {
  const coverage = flowOf(state).coverage;
  if (coverage === undefined || coverage.uncovered.length === 0) return html``;
  const n = coverage.uncovered.length;
  return html`<p class="home-sub" data-field="undeclared">${n} of the ${plural(coverage.detected, "entrance", "entrances")} Coherence detected ${n === 1 ? "is" : "are"} undeclared.</p>`;
}

/* ------------------------------------------------------------ onboarding */

function renderOnboarding(state: ShellState): Markup {
  const read = readOf(state);
  const files = read?.components.reduce((n, c) => n + c.files, 0) ?? 0;
  // The folders by size, largest first, so the sentence names what the picture shows biggest.
  const folders = (read?.components ?? []).filter((c) => c.folder !== ".").sort((a, b) => b.lines - a.lines).map((c) => named(c.name));
  const components = state.spec.components.filter((c) => c.folder !== ".");
  const declared = allInvariants(state.spec.components);
  const step = declared.length > 0 ? 3 : components.length > 0 ? 2 : 1;

  const lead =
    step === 1
      ? html`<h2 class="home-say">Here’s ${state.project} as Coherence sees it.</h2>
          <p class="home-sub">${plural(files, "file", "files")}${folders.length > 0 ? `, most of them in ${listed(folders.slice(0, 4))}` : ""}. Each block is a file; the taller it stands, the more often it changed. Files that change together sit together.</p>`
      : step === 2
        ? html`<h2 class="home-say">Your agent has named the components of ${state.project}.</h2>
            <p class="home-sub">${listed(components.map((p) => p.name))}. Each component’s files now stand together.</p>`
        : html`<h2 class="home-say">Choose what to protect.</h2>
            <p class="home-sub">Your agent suggests the few invariants that would hurt most if they broke. Confirm, reword or drop each in the chat.</p>`;

  const next =
    step === 1
      ? "Next, your agent names the components the project is made of."
      : step === 2
        ? "Next, your agent suggests a few invariants worth protecting. You’ll confirm each one in the chat."
        : "Each invariant you confirm is broken once on purpose, to see that its check catches it.";

  return html`<div class="home">
    <p class="home-step">Setting up · step ${step} of 3</p>
    ${lead}
    ${undeclaredLine(state)}
    ${step === 3 ? html`<ol class="home-invariants">${declared.map(renderInvariant)}</ol>` : null}
    ${picture(state, true)}
    <p class="home-next">${next}</p>
    ${whatIs(state)}
  </div>`;
}

function renderInvariant(invariant: SpecInvariant): Markup {
  const checked = invariant.state === "invariant";
  return html`<li class="home-invariant"><a href="#${invariantId(invariant.component, invariant.name)}">${invariant.sentence}</a><span class="home-word" data-checked="${checked ? "yes" : "no"}">${checked ? "checked ✓" : "suggested"}</span></li>`;
}

/* ------------------------------------------------------------ summary */

/** The components that took most of the last 30 days' landings and that no invariant guards: the one thing worth saying about where work went. */
function unguardedHot(state: ShellState, read: Read): { names: string[]; top: string[]; recent: number } {
  const latest = Date.parse(read.landings[0]!.date);
  const recent = read.landings.filter((l) => latest - Date.parse(l.date) < 30 * DAY);
  const byFolder = new Map(state.spec.components.map((c) => [c.folder, c]));
  const specOf = (folder: string): SpecComponent | undefined => {
    while (!byFolder.has(folder) && folder !== ".") folder = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : ".";
    return byFolder.get(folder);
  };
  const count = new Map<number, number>();
  for (const l of recent) for (const [ci] of l.c) count.set(ci, (count.get(ci) ?? 0) + 1);
  const rows = [...count]
    .map(([ci, n]) => ({ c: read.components[ci]!, n }))
    .filter((r) => r.c.folder !== ".")
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  const names = rows.filter((r) => !(specOf(r.c.folder)?.invariants.some((i) => i.state === "invariant") ?? false)).slice(0, 2).map((r) => named(r.c.name));
  return { names, top: rows.slice(0, 2).map((r) => named(r.c.name)), recent: recent.length };
}

function renderSummary(state: ShellState): Markup {
  // Home says what is known, never how healthy the project is: what the project is made of, which components invariants
  // guard, how old the checks behind them are, and by name any invariant whose last check failed. One unchecked or long unchecked is
  // said as such; nothing here adds up to a score.
  const invariants = allInvariants(state.spec.components).filter((i) => i.state !== "requirement");
  const verdicts = invariants.map((i) => ({ invariant: i, verdict: invariantVerdict(i, state.runs.records) }));
  const broken = verdicts.filter((v) => v.verdict.state === "broken").map((v) => v.invariant);
  const questions = openEscalations(state.journal.records).length;
  const read = readOf(state);
  const components = state.spec.components.filter((c) => c.folder !== ".");
  const guarded = components.filter((c) => c.invariants.some((i) => i.state !== "requirement")).length;
  const dates = verdicts.flatMap((v) => (v.verdict.at === undefined ? [] : [v.verdict.at])).sort();
  const unchecked = verdicts.filter((v) => v.verdict.at === undefined).length;

  const say =
    broken.length === 0
      ? html`<h2 class="home-say">${state.project}, in ${plural(components.length, "component", "components")}.</h2>`
      : html`<h2 class="home-say" data-broken>${broken.length === 1 ? "One invariant failed its last check." : `${broken.length} invariants failed their last check.`}</h2>`;
  const checks = [
    dates.length === 0 ? "" : dates[0] === dates.at(-1) ? `, checked ${dates[0]}` : `; the oldest check behind them ran ${dates[0]}`,
    unchecked === 0 ? "" : `; ${unchecked} ${unchecked === 1 ? "has" : "have"} never been checked`,
  ].join("");
  const sub = `${plural(invariants.length, "invariant", "invariants")} ${invariants.length === 1 ? "guards" : "guard"} ${guarded} of the ${plural(components.length, "component", "components")}${checks}.`;
  const hot = read !== undefined && read.landings.length > 0 ? unguardedHot(state, read) : undefined;
  const observation =
    hot === undefined || hot.recent === 0 || hot.top.length === 0
      ? null
      : hot.names.length > 0
        ? `Most of the last month’s work landed in ${listed(hot.names)}, which no invariant guards yet.`
        : `Most of the last month’s work landed in ${listed(hot.top)}, which invariants guard.`;

  return html`<div class="home">
    ${say}
    <p class="home-sub">${raw(html`${sub}`.text.replace(/\d{4}-\d{2}-\d{2}/g, (date) => `<span class="home-nowrap">${date}</span>`))}</p>
    ${undeclaredLine(state)}
    ${broken.length > 0 ? html`<ul class="home-asks">${broken.slice(0, 3).map((i) => html`<li><a href="#${invariantId(i.component, i.name)}">${i.sentence}</a></li>`)}</ul>` : null}
    ${questions > 0 ? html`<p class="home-ask"><a href="#journal">${questions === 1 ? "1 question is waiting for you" : `${questions} questions are waiting for you`} →</a></p>` : null}
    ${picture(state)}
    ${observation === null ? null : html`<p class="home-next">${observation}</p>`}
    ${read !== undefined && read.landings.length > 0 ? html`<div class="home-recent"><p class="home-label">Recently</p><ul>${read.landings.slice(0, 3).map((l) => html`<li>${l.subject} <span class="home-date">${l.date}</span></li>`)}</ul></div>` : null}
    ${whatIs(state)}
  </div>`;
}

export function renderHomeResults(state: ShellState): Markup {
  return onboarding(state) ? renderOnboarding(state) : renderSummary(state);
}
