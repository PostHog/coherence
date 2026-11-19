/**
 * The Components view: each component read as its spec. A rail of the
 * components in folder order; one component's page at a time (its intent,
 * trust levels, entrances, invariants and requirements, folded folders), each
 * bullet a sentence with one quiet line of where it stands and its whole
 * detail a click away (enforcement and verdict, refutation, checklist, lacks,
 * a structural defect's options, reliance, journal defects). The entry
 * component's page opens with every component's intent. A filter or a search
 * lists matching bullets across every component instead, grouped by
 * component. A pure function from the shell state to markup.
 */

import { componentId, componentTree, defectsOfJournal, invariantId, invariantVerdict, latestOf, plural, textMatches } from "./derive.ts";
import { html, type Markup } from "./html.ts";
import { renderChecklist, renderCrossing, renderDefect, renderEnforcement, renderLacks, renderRefutation, renderReliance } from "./invariant-detail.ts";
import type { ComponentsFilter, ShellState, SpecComponent, SpecInvariant } from "./model.ts";
import type { DefectState } from "../../journal/defect-states.ts";

/** The lists a reader can narrow to, across every component; pressed again, a chip returns to the component's page. */
const FILTERS: readonly { id: Exclude<ComponentsFilter, "">; label: string }[] = [
  { id: "failing", label: "Failing" },
  { id: "requirement", label: "Requirements" },
  { id: "no-enforcement", label: "No enforcement" },
  { id: "unrefuted", label: "No refutation" },
  { id: "defects", label: "Open defects" },
];

/* ------------------------------------------------------------- reading */

/** The open journal defects that name a bullet, and those of a component that name none of its bullets. */
interface Defects {
  of: (invariant: SpecInvariant) => DefectState[];
  loose: (component: SpecComponent) => DefectState[];
}

function inFolder(file: string, folder: string): boolean {
  return folder === "." || file === folder || file.startsWith(`${folder}/`);
}

function readDefects(state: ShellState): Defects {
  const open = defectsOfJournal(state.journal.records).filter((d) => d.resolution === undefined);
  const named = new Map<SpecInvariant, DefectState[]>();
  const claimed = new Set<string>();
  for (const component of state.spec.components) {
    for (const invariant of component.invariants) {
      const hits = open.filter((d) => d.what.includes(invariant.name));
      if (hits.length > 0) named.set(invariant, hits);
      for (const d of hits) claimed.add(d.id);
    }
  }
  // A defect no bullet names belongs to the deepest component its own component or files lie in.
  const deepest = (file: string): string | undefined =>
    state.spec.components.filter((c) => inFolder(file, c.folder)).sort((a, b) => b.folder.length - a.folder.length)[0]?.folder;
  const loose = new Map<string, DefectState[]>();
  for (const d of open) {
    if (claimed.has(d.id)) continue;
    const folders = new Set(d.component !== undefined ? [d.component] : (d.files ?? []).map(deepest).filter((f): f is string => f !== undefined));
    for (const folder of folders) loose.set(folder, [...(loose.get(folder) ?? []), d]);
  }
  return { of: (i) => named.get(i) ?? [], loose: (c) => loose.get(c.folder) ?? [] };
}

function selectedComponent(state: ShellState): SpecComponent | undefined {
  const components = state.spec.components;
  return (
    components.find((c) => c.folder === state.components.selected) ??
    components.find((c) => c.folder === state.spec.entry) ??
    components.find((c) => c.folder === ".") ??
    componentTree(components)[0]?.component
  );
}

/** Where a bullet stands, as its margin dot: verified, broken, a requirement, or nothing enforces it. */
function standing(state: ShellState, invariant: SpecInvariant): "verified" | "broken" | "requirement" | "unenforced" {
  if (invariant.enforcements.length === 0 && invariant.state === "requirement") return "unenforced";
  return invariantVerdict(invariant, state.runs.records).state;
}

function matchesFilter(state: ShellState, invariant: SpecInvariant, filter: ComponentsFilter, defects: Defects): boolean {
  switch (filter) {
    case "":
      return true;
    case "failing":
      return invariantVerdict(invariant, state.runs.records).state === "broken";
    case "requirement":
      return invariant.state === "requirement";
    case "no-enforcement":
      return invariant.enforcements.length === 0;
    case "unrefuted":
      return invariant.lacks.includes("refutation");
    case "defects":
      return defects.of(invariant).length > 0;
  }
}

function bulletMatches(state: ShellState, invariant: SpecInvariant, query: string): boolean {
  return textMatches(
    query,
    invariant.name,
    invariant.sentence,
    invariant.because,
    invariant.component,
    invariant.enforcements.map((e) => (e.form === "chokepoint" ? `${e.chokepoint} ${e.protects}` : `${e.via} ${e.over}`)),
    invariant.crossing === undefined ? undefined : `${invariant.crossing.from} ${invariant.crossing.to}`,
    latestOf(invariant, state.runs.records).flatMap((l) => l.bypasses.map((b) => `${b.file} ${b.symbol}`)),
  );
}

/* --------------------------------------------------------------- bullet */

/** The one quiet line under a bullet's sentence: where it stands, what checks it, what it read, what is open. */
function renderMeta(state: ShellState, invariant: SpecInvariant, defects: DefectState[]): Markup {
  const verdict = invariantVerdict(invariant, state.runs.records);
  const latest = latestOf(invariant, state.runs.records);
  const parts: Markup[] = [];
  if (invariant.enforcements.length === 0) parts.push(html`<span class="standing" data-standing="unenforced">no enforcement</span>`);
  else if (verdict.state === "verified") parts.push(html`<span class="standing" data-standing="verified">${verdict.label}</span>`);
  else if (verdict.state === "broken") parts.push(html`<span class="standing" data-standing="broken">${verdict.label}</span>`);
  else {
    const passed = latest.filter((e) => e.verdict === "pass").map((e) => e.at.slice(0, 10)).sort().pop();
    const notRun = latest.find((e) => e.verdict === "not run");
    parts.push(
      html`<span class="standing" data-standing="requirement">requirement${passed !== undefined ? ` · its check passed ${passed}` : notRun !== undefined ? ` · not run ${notRun.at.slice(0, 10)}` : " · never checked"}</span>`,
    );
  }
  for (const e of invariant.enforcements) parts.push(e.form === "chokepoint" ? html`<span>chokepoint <code>${e.chokepoint}</code></span>` : html`<code>${e.via}</code>`);
  for (const e of latest) for (const p of e.peers ?? []) parts.push(html`<span>read ${p.repository} at ${p.commit?.slice(0, 7) ?? "?"}${p.dirty ? " (changed in the checkout)" : ""}</span>`);
  if (invariant.state === "requirement" && invariant.lacks.length > 0) parts.push(html`<span>lacks ${invariant.lacks.join(", ")}</span>`);
  if (defects.length > 0) parts.push(html`<span class="standing" data-standing="broken">${plural(defects.length, "open defect", "open defects")}</span>`);
  return html`<p class="bullet-meta">${parts}</p>`;
}

function renderJournalDefects(defects: DefectState[]): Markup | null {
  if (defects.length === 0) return null;
  return html`<section class="defect" data-field="journal-defects"><h4>Open defects in the journal</h4><ul>${defects.map(
    (d) => html`<li><a href="#journal-${d.id}"><code>${d.id}</code></a>${d.class === undefined ? null : html` <span class="label">${d.class}</span>`} ${d.what}</li>`,
  )}</ul></section>`;
}

function renderDetail(state: ShellState, component: SpecComponent | undefined, invariant: SpecInvariant, defects: DefectState[]): Markup {
  const entrances = invariant.entrances?.names;
  const peers = invariant.peerFiles ?? [];
  return html`<div class="bullet-detail">
    ${invariant.because !== undefined
      ? html`<p class="because" data-field="because"><span class="because-word">because</span> ${invariant.because}</p>`
      : html`<p class="because quiet" data-field="because"><span class="because-word">because</span> not written: every invariant carries its own.</p>`}
    ${renderCrossing(state, invariant)}
    ${entrances === undefined ? null : html`<p class="quiet"><span class="label">entrances</span> ${entrances === "none" ? "none" : entrances.join(", ")}</p>`}
    ${peers.length === 0 ? null : html`<p data-field="peer"><span class="label">reads where it lives</span> ${peers.map((p, i) => html`<code>${p.peer} ${p.path}</code>${i < peers.length - 1 ? ", " : ""}`)}</p>`}
    <section class="enforcements" data-field="enforcements">
      <h4>Enforcement</h4>
      ${invariant.enforcements.length === 0
        ? html`<p class="quiet">None: the bullet names no chokepoint and no totality oracle, so nothing detects a break.</p>`
        : html`<ul>${invariant.enforcements.map((e) => renderEnforcement(state, invariant, e))}</ul>`}
    </section>
    ${renderDefect(invariant, state.runs.records)}
    ${renderJournalDefects(defects)}
    ${renderRefutation(invariant, state.runs.records)}
    ${renderChecklist(invariant)}
    ${renderLacks(invariant)}
    ${renderReliance(state, invariant)}
    <p class="defined-by">${component?.specPath ?? invariant.component}:${invariant.line}</p>
  </div>`;
}

function renderBullet(state: ShellState, component: SpecComponent | undefined, invariant: SpecInvariant, defects: Defects): Markup {
  const id = invariantId(invariant.component, invariant.name);
  const open = (state.components.open ?? []).includes(id);
  const mine = defects.of(invariant);
  const name = invariant.name.charAt(0).toUpperCase() + invariant.name.slice(1);
  return html`<article class="bullet" id="${id}" data-standing="${standing(state, invariant)}" data-state="${invariant.state}" data-open="${open ? "true" : "false"}">
    <button type="button" class="bullet-toggle" data-bullet-toggle="${id}" aria-expanded="${open ? "true" : "false"}">
      <span class="bullet-sentence"><b>${name}.</b> ${invariant.sentence}</span>
    </button>
    ${renderMeta(state, invariant, mine)}
    ${open ? renderDetail(state, component, invariant, mine) : null}
  </article>`;
}

/* ----------------------------------------------------------------- page */

function renderTally(state: ShellState, component: SpecComponent): Markup {
  const bullets = component.invariants;
  if (bullets.length === 0) return html`<p class="page-tally quiet">No invariants or requirements declared yet.</p>`;
  const count = (s: string): number => bullets.filter((b) => standing(state, b) === s).length;
  const invariants = bullets.filter((b) => b.state === "invariant").length;
  const requirements = bullets.filter((b) => b.state === "requirement").length;
  // The tally doubles as the legend of the margin dots below it.
  const parts: [string, string][] = [
    ["verified", plural(invariants, "invariant", "invariants")],
    ["requirement", plural(requirements, "requirement", "requirements")],
    ["broken", count("broken") > 0 ? `${count("broken")} failing` : ""],
    ["unenforced", count("unenforced") > 0 ? `${count("unenforced")} with no enforcement` : ""],
  ];
  return html`<p class="page-tally">${parts.filter(([, text]) => text !== "").map(([mark, text]) => html`<span class="tally" data-standing="${mark}">${text}</span>`)}</p>`;
}

function renderIntents(state: ShellState): Markup {
  const tree = componentTree(state.spec.components).filter(({ component }) => component.folder !== ".");
  if (tree.length === 0) return html``;
  return html`<h3 class="page-section">Components</h3>
    <dl class="intents">${tree.map(
      ({ component, depth }) => html`<div class="intents-row" data-depth="${depth}"><dt><a href="#${componentId(component.folder)}">${component.name}</a></dt><dd>${component.intent === "" ? html`<span class="quiet">No intent line in the spec.</span>` : component.intent}</dd></div>`,
    )}</dl>`;
}

function renderPage(state: ShellState, component: SpecComponent, defects: Defects): Markup {
  const isEntry = state.spec.entry === component.folder || (state.spec.entry === undefined && component.folder === ".");
  const invariants = component.invariants.filter((i) => i.state !== "requirement");
  const requirements = component.invariants.filter((i) => i.state === "requirement");
  const loose = defects.loose(component);
  const levels = component.trustLevels ?? [];
  return html`<article class="spec-page" data-component="${component.folder}">
    <header class="page-head">
    <p class="page-path">${component.specPath}</p>
    <h2 class="page-name">${component.name}</h2>
    ${component.intent !== "" ? html`<p class="page-intent">${component.intent}</p>` : html`<p class="page-intent quiet">No intent line in the spec.</p>`}
    ${renderTally(state, component)}
    ${component.owners === undefined ? null : html`<p class="page-owners quiet" data-field="owners"><span class="label">Owners</span> ${component.owners.join(", ")}</p>`}
    </header>
    ${levels.length === 0
      ? null
      : html`<h3 class="page-section">Trust levels</h3><dl class="doors">${levels.map((l) => html`<div class="door"><dt>${l.name}</dt><dd>${l.meaning}${l.outside ? html` <span class="quiet">· outside</span>` : null}</dd></div>`)}</dl>`}
    ${component.entrances.length === 0
      ? null
      : html`<h3 class="page-section">Entrances</h3><dl class="doors">${component.entrances.map(
          (e) => html`<div class="door"><dt>${e.name}</dt><dd>${e.meaning}<span class="door-how">${e.trust ?? "no trust level"}${e.handler === undefined ? null : html` · <code>${e.handler}</code>`}</span></dd></div>`,
        )}</dl>`}
    ${invariants.length === 0 ? null : html`<h3 class="page-section">Invariants</h3>${invariants.map((i) => renderBullet(state, component, i, defects))}`}
    ${requirements.length === 0 ? null : html`<h3 class="page-section">Requirements</h3>${requirements.map((i) => renderBullet(state, component, i, defects))}`}
    ${loose.length === 0 ? null : html`<h3 class="page-section">Open defects no bullet names</h3>${renderJournalDefects(loose)}`}
    ${component.children.length === 0 || isEntry
      ? null
      : html`<h3 class="page-section">Contains</h3><p class="page-list">${component.children.map((c, i) => {
          const child = state.spec.components.find((x) => x.folder === c);
          return html`<a href="#${componentId(c)}">${child?.name ?? c}</a>${i < component.children.length - 1 ? ", " : ""}`;
        })}</p>`}
    ${(component.folded ?? []).length === 0
      ? null
      : html`<h3 class="page-section">Also governs</h3><dl class="doors">${(component.folded ?? []).map((f) => html`<div class="door"><dt><code>${f.folder}${f.subtree ? "/**" : ""}</code></dt><dd>${f.reason}</dd></div>`)}</dl>`}
    ${isEntry ? renderIntents(state) : null}
  </article>`;
}

function renderRail(state: ShellState, current: SpecComponent | undefined, defects: Defects): Markup {
  return html`<nav class="spec-rail" aria-label="Components">
    <p class="rail-head">${plural(state.spec.components.length, "component", "components")}</p>
    <ul>${componentTree(state.spec.components).map(({ component, depth }) => {
      const failing = component.invariants.some((i) => standing(state, i) === "broken" || defects.of(i).length > 0);
      return html`<li data-depth="${depth}"><a href="#${componentId(component.folder)}" aria-current="${component === current ? "page" : "false"}"><span class="rail-name">${component.name}${failing ? html`<span class="rail-mark" title="a failing bullet, or one an open defect names"></span>` : null}</span><span class="rail-count">${component.invariants.length === 0 ? "" : String(component.invariants.length)}</span></a></li>`;
    })}</ul>
  </nav>`;
}

/* ------------------------------------------------------- project-wide */

function renderAcross(state: ShellState, query: string, filter: ComponentsFilter, defects: Defects): Markup {
  const label = (FILTERS.find((f) => f.id === filter)?.label ?? filter).toLowerCase();
  const groups = componentTree(state.spec.components)
    .map(({ component }) => ({ component, bullets: component.invariants.filter((i) => matchesFilter(state, i, filter, defects) && bulletMatches(state, i, query)) }))
    .filter((g) => g.bullets.length > 0);
  const total = groups.reduce((sum, g) => sum + g.bullets.length, 0);
  const said = [filter === "" ? "" : label, query === "" ? "" : `matching “${state.components.query}”`].filter((s) => s !== "").join(", ");
  return html`<section class="spec-across">
    <p class="match-summary">${total === 0 ? `No bullet is ${said}.` : `${plural(total, "bullet", "bullets")} ${said}, in ${plural(groups.length, "component", "components")}.`}</p>
    ${groups.map(
      (g) => html`<h3 class="page-section"><a href="#${componentId(g.component.folder)}">${g.component.name}</a> <span class="quiet">${g.component.folder === "." ? "" : g.component.folder}</span></h3>${g.bullets.map((i) => renderBullet(state, g.component, i, defects))}`,
    )}
  </section>`;
}

/* ---------------------------------------------------------------- view */

export function renderComponentsTools(state: ShellState): Markup {
  const filter = state.components.filter ?? "";
  const defects = readDefects(state);
  const bullets = state.spec.components.flatMap((c) => c.invariants);
  return html`<div class="view-tools spec-tools">
    <label class="spec-search">
      <span class="visually-hidden">Search every bullet</span>
      <input type="search" data-search value="${state.components.query}" placeholder="Search every bullet" autocomplete="off" spellcheck="false">
    </label>
    <div class="spec-chips" role="group" aria-label="Show only, across every component">${FILTERS.map((f) => {
      const count = bullets.filter((i) => matchesFilter(state, i, f.id, defects)).length;
      return html`<button type="button" class="spec-chip" data-show="${f.id}" aria-pressed="${filter === f.id ? "true" : "false"}">${f.label} <span class="spec-chip-count">${String(count)}</span></button>`;
    })}</div>
  </div>`;
}

export function renderComponentsResults(state: ShellState): Markup {
  if (state.spec.components.length === 0) return html`<p class="absence">No component was found: no folder under the root holds a spec file.</p>`;
  const defects = readDefects(state);
  const query = state.components.query.trim().toLowerCase();
  const filter = state.components.filter ?? "";
  const current = selectedComponent(state);
  const across = query !== "" || filter !== "";
  return html`<div class="spec-reader">
    ${renderRail(state, across ? undefined : current, defects)}
    <div class="spec-body">${across ? renderAcross(state, query, filter, defects) : current === undefined ? null : renderPage(state, current, defects)}
      <p class="spec-keys quiet"><kbd>[</kbd> <kbd>]</kbd> previous and next component · <kbd>e</kbd> open or fold every bullet</p>
    </div>
  </div>`;
}

/** The components in rail order, for stepping from one page to the next. */
export function componentOrder(state: ShellState): string[] {
  return componentTree(state.spec.components).map(({ component }) => component.folder);
}

/** The ids of the bullets the view shows now, for opening or folding them all. */
export function shownBulletIds(state: ShellState): string[] {
  const defects = readDefects(state);
  const query = state.components.query.trim().toLowerCase();
  const filter = state.components.filter ?? "";
  const bullets =
    query !== "" || filter !== ""
      ? state.spec.components.flatMap((c) => c.invariants.filter((i) => matchesFilter(state, i, filter, defects) && bulletMatches(state, i, query)))
      : (selectedComponent(state)?.invariants ?? []);
  return bullets.map((i) => invariantId(i.component, i.name));
}

/** The bullet a hash names, by its invariant id or its reliance id. */
export function invariantOfHash(state: ShellState, id: string): SpecInvariant | undefined {
  const bare = id.startsWith("reliance-") ? `invariant-${id.slice("reliance-".length)}` : id;
  return state.spec.components.flatMap((c) => c.invariants).find((i) => invariantId(i.component, i.name) === bare);
}
