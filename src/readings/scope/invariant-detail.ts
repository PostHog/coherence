/**
 * What a bullet's detail says, on its component's page in the Components
 * view: its crossing over the declared trust levels, each enforcement with
 * its latest verdict and the chokepoint grade with the rung's enforcer, its
 * refutations, its checklist, what it lacks, a structural defect's bypass
 * sites and the two honest options, and a chokepoint's reliance listing,
 * folded: every recorded reference site to the chokepoint or the protected
 * thing. Pure functions from the shell state to markup.
 */

import { defectsOf, isKept, latestOf, plural, relianceId, relianceOf, stamp, type Reliance, type RelianceSite } from "./derive.ts";
import { html, join, type Markup } from "./html.ts";
import type { LatestEntry, RunRecord, ShellState, SpecEnforcement, SpecInvariant, TrustLevel } from "./model.ts";

function levelMeaning(levels: readonly TrustLevel[], name: string): string | undefined {
  return levels.find((l) => l.name === name)?.meaning;
}

export function renderCrossing(state: ShellState, invariant: SpecInvariant): Markup {
  const crossing = invariant.crossing;
  if (crossing === undefined) return html`<p class="crossing quiet">no crossing</p>`;
  const from = levelMeaning(state.spec.trustLevels, crossing.from);
  const to = levelMeaning(state.spec.trustLevels, crossing.to);
  return html`<p class="crossing" data-field="crossing"><span class="label">crossing</span>
    <span class="level" title="${from ?? "not a declared trust level"}">${crossing.from}</span> → <span class="level" title="${to ?? "not a declared trust level"}">${crossing.to}</span></p>`;
}

/** The verdict of one enforcement as the latest run left it, or its absence. */
function renderVerdict(state: ShellState, entry: LatestEntry | undefined): Markup {
  if (entry === undefined) return html`<p class="verdict" data-verdict="unverified"><span class="verdict-word">declared, unverified</span> <span class="quiet">no run has checked this enforcement</span></p>`;
  const kept = isKept(entry, state.runs.records);
  const keptMark = kept ? html` <span class="kept" data-kept title="the latest run skipped this enforcement; the verdict stands from the run that last checked it">kept from an earlier run (${stamp(entry.at)})</span>` : null;
  const rung = entry.grade === undefined ? undefined : state.spec.ladder.rungs.find((r) => r.grade === entry.grade);
  const grade =
    entry.grade === undefined
      ? null
      : html`<span class="grade" data-grade="${entry.grade}">${entry.grade}</span>${entry.enforcer !== undefined ? html` <span class="enforced-by quiet">enforced by ${entry.enforcer}</span>` : rung !== undefined ? html` <span class="enforced-by quiet">enforced by ${rung.enforcedBy}</span>` : null}`;
  const word = entry.verdict === "pass" ? `verified ${entry.at.slice(0, 10)}` : entry.verdict === "fail" ? `structural defect ${entry.at.slice(0, 10)}` : `not run ${entry.at.slice(0, 10)}`;
  return html`<p class="verdict" data-verdict="${entry.verdict}"><span class="verdict-word">${word}</span> ${grade}${keptMark}</p>
    <p class="reason quiet">${entry.reason}</p>`;
}

/**
 * Which references the chokepoint governs, as the latest run applied it, with
 * the exempt references counted, so the component's own references read as
 * exempted rather than absent. Nothing is drawn for anywhere, the default.
 */
function renderGoverned(enforcement: Extract<SpecEnforcement, { form: "chokepoint" }>, entry: LatestEntry | undefined): Markup | null {
  const ran = entry?.from;
  if (ran?.exempt !== undefined) {
    // Exempt references the page carries, and those its window counted instead.
    const exempt = entry!.sites === undefined
      ? undefined
      : entry!.sites.filter((s) => s.of === "protected" && s.class === "exempt").length +
        (entry!.sitesLeft ?? []).filter((s) => s.of === "protected" && s.class === "exempt").reduce((sum, s) => sum + s.count, 0);
    const by = ran.by === "bullet" ? "its from: line" : ran.by === "config" ? "the config default" : "the default";
    return html`<p class="governs" data-field="from" data-exempt="${ran.exempt}"><span class="label">from</span> ${ran.value} <span class="quiet">(${by}): governs only references from outside <code>${ran.exempt}</code>; ${entry!.sitesUnresolved !== undefined ? `exempt references unknown: ${entry!.sitesUnresolved}` : exempt === undefined ? "exempt references unrecorded" : `${plural(exempt, "reference", "references")} from inside it exempt, reported and never a bypass`}</span></p>`;
  }
  const declared = enforcement.from;
  if (declared === undefined || declared === "anywhere") return null;
  return html`<p class="governs" data-field="from"><span class="label">from</span> ${typeof declared === "string" ? declared : `outside ${declared.outside}`} <span class="quiet">declared; no run has applied it yet</span></p>`;
}

export function renderEnforcement(state: ShellState, invariant: SpecInvariant, enforcement: SpecEnforcement): Markup {
  const entry = latestOf(invariant, state.runs.records).find((l) => l.form === enforcement.form);
  if (enforcement.form === "chokepoint") {
    return html`<li class="enforcement" data-form="chokepoint">
      <p><span class="label">chokepoint</span> <code>${enforcement.chokepoint}</code> <span class="label">protects</span> <code>${enforcement.protects}</code></p>
      ${renderVerdict(state, entry)}
      ${renderGoverned(enforcement, entry)}
      ${entry !== undefined && entry.testReferences > 0 ? html`<p class="quiet">${plural(entry.testReferences, "test reference", "test references")}, reported and never a bypass.</p>` : null}
    </li>`;
  }
  return html`<li class="enforcement" data-form="totality-oracle">
    <p><span class="label">totality oracle</span> <code>${enforcement.via}</code> <span class="label">over</span> ${enforcement.over}</p>
    ${renderVerdict(state, entry)}
  </li>`;
}

export function renderRefutation(invariant: SpecInvariant, runs: readonly RunRecord[]): Markup {
  const automatic = latestOf(invariant, runs).find((l) => l.form === "chokepoint" && l.refutation === "automatic");
  const refused = latestOf(invariant, runs).find((l) => l.form === "chokepoint" && l.refutation === "refused by the language");
  const checked = latestOf(invariant, runs).find((l) => l.form === "chokepoint" && l.refutation === "refused by the checker");
  const parts: Markup[] = [];
  for (const refutation of invariant.refutations) {
    parts.push(html`<li class="refutation" data-refutation="witnessed"><span class="refutation-word">witnessed ${refutation.date}</span> <span class="broke">${refutation.broke}</span> <span class="arrow">→</span> <span class="saw">${refutation.saw}</span></li>`);
  }
  if (automatic !== undefined) {
    parts.push(html`<li class="refutation" data-refutation="automatic"><span class="refutation-word">automatic from the run ${automatic.at.slice(0, 10)}</span> <span class="quiet">the instrument reported a synthetic reference from outside the chokepoint, so it would report a real one</span></li>`);
  }
  if (refused !== undefined) {
    parts.push(html`<li class="refutation" data-refutation="refused"><span class="refutation-word">refused by the language, run ${refused.at.slice(0, 10)}</span> <span class="quiet">the compiler or interpreter refused a synthetic reference from outside the chokepoint; the refusal is the proof</span> </li>`);
  }
  if (checked !== undefined) {
    parts.push(html`<li class="refutation" data-refutation="refused"><span class="refutation-word">refused by the checker, run ${checked.at.slice(0, 10)}</span> <span class="quiet">${checked.enforcer ?? "the checker"} refused a synthetic import from another module, staged in a throwaway copy; the refusal is the proof</span> </li>`);
  }
  if (parts.length === 0) {
    parts.push(html`<li class="refutation" data-refutation="missing"><span class="refutation-word">missing</span> <span class="quiet">no witnessed firing is written on the bullet and no run has refuted it automatically</span></li>`);
  }
  return html`<section class="refutations" data-field="refutation"><h4>Refutation</h4><ul>${parts}</ul></section>`;
}

export function renderChecklist(invariant: SpecInvariant): Markup {
  const kinds = invariant.kinds;
  if (kinds === undefined) return html`<section class="checklist" data-field="checklist"><h4>Checklist</h4><p class="quiet">No kinds line: the decomposition checklist was never run for this bullet.</p></section>`;
  const kindsText = kinds === "none" ? "none" : kinds.join(", ");
  return html`<section class="checklist" data-field="checklist">
    <h4>Checklist <span class="quiet">kinds ${kindsText}: ${plural(invariant.applicable.length, "shape applies", "shapes apply")}</span></h4>
    ${invariant.checklist.length === 0 && invariant.missingShapes.length === 0
      ? html`<p class="quiet">No shape applies.</p>`
      : html`<ul>${invariant.checklist.map((line) =>
          line.outcome === "declared"
            ? html`<li data-outcome="declared"><span class="shape">${line.shape}</span> <span class="label">declared as</span> ${line.as}</li>`
            : html`<li data-outcome="dismissed"><span class="shape">${line.shape}</span> <span class="label">dismissed:</span> ${line.reason}</li>`,
        )}${invariant.missingShapes.map((shape) => html`<li data-outcome="missing"><span class="shape">${shape}</span> <span class="label">neither declared nor dismissed</span></li>`)}</ul>`}
  </section>`;
}

export function renderLacks(invariant: SpecInvariant): Markup | null {
  if (invariant.lacks.length === 0 && invariant.unfilled.length === 0) return null;
  return html`<p class="lacks" data-field="lacks">
    ${invariant.lacks.length > 0 ? html`<span class="label">lacks</span> ${invariant.lacks.join(", ")}` : null}
    ${invariant.unfilled.length > 0 ? html`<span class="label">unfilled</span> ${invariant.unfilled.join(", ")}` : null}
  </p>`;
}

/** A structural defect's evidence and the two honest options. */
export function renderDefect(invariant: SpecInvariant, runs: readonly RunRecord[]): Markup | null {
  if (invariant.state !== "structural defect") return null;
  const chokepoints = invariant.enforcements.flatMap((e) => (e.form === "chokepoint" ? [e.chokepoint] : []));
  const failing = defectsOf(invariant, runs);
  const sites = failing.flatMap((d) => d.bypasses);
  return html`<section class="defect" data-field="defect">
    <h4>Structural defect</h4>
    ${failing.map((d) => html`<p class="reason">${d.form === "chokepoint" ? "chokepoint" : "totality oracle"} failed ${stamp(d.at)}: ${d.reason}</p>`)}
    ${sites.length > 0
      ? html`<h5>Bypass sites</h5><ul class="bypasses" data-field="bypasses">${sites.map((b) => html`<li><code>${b.file}:${b.line}</code> <span class="label">in</span> <code>${b.symbol}</code>${b.checker === undefined ? null : html` <span class="quiet">${b.checker}</span>`}</li>`)}</ul>`
      : null}
    <h5>The two options</h5>
    <ol class="options" data-field="options">
      <li data-option="route">${chokepoints.length > 0
        ? html`<strong>Route through the chokepoint.</strong> Move each reference above inside ${chokepoints.map((c, i) => html`<code>${c}</code>${i < chokepoints.length - 1 ? ", " : ""}`)} so the protected thing is reached through it and nowhere else; the next run turns the verdict green.`
        : html`<strong>Restore the enforcement.</strong> Make the test the bullet names run and pass under its name again; the next run turns the verdict green.`}</li>
      <li data-option="retire"><strong>Escalate a retirement.</strong> Record the decision with preservation as the rejected alternative, <code>escalate</code> it, and let a human <code>acknowledge</code> with the <a href="#${relianceId(invariant.component, invariant.name)}">reliance listing</a> in view. The invariant stands, and alarms, until then.</li>
    </ol>
  </section>`;
}

/**
 * The sites the page's window counted and did not list, said with where they
 * are: the live page loads them from its server, and a snapshot names the
 * query that lists every one.
 */
function renderSitesLeft(state: ShellState, entry: LatestEntry, chokepoint: string, left: number): Markup {
  const by = new Map<string, number>();
  for (const tally of entry.sitesLeft ?? []) by.set(tally.component ?? "", (by.get(tally.component ?? "") ?? 0) + tally.count);
  const where = [...by.entries()].map(([folder, count]) => `${count} in ${folder === "" ? "no declared component" : folder === "." ? "the root" : folder}`).join(", ");
  const said = `${plural(left, "more site is", "more sites are")} counted and not listed (${where})`;
  return state.connection?.mode === "live"
    ? html`<p class="quiet" data-field="sites-left" data-left="${left}">${said}. <button type="button" class="history-load" data-load-sites="${entry.at}~${entry.session}" data-component="${entry.component}" data-name="${entry.name}">Load the other ${left}</button></p>`
    : html`<p class="quiet" data-field="sites-left" data-left="${left}">${said}: <code>query relies-on ${chokepoint}</code> lists every one, from the run under <code>.coherence/runs</code>.</p>`;
}

/** One reference site: where it is, what it references, how it is classified, and whether it is the owner's or a test's. */
function renderSite(site: RelianceSite): Markup {
  const role = site.target === "protected" && site.siteClass === "bypass"
    ? "protected thing · bypass (not a legal chokepoint reference)"
    : site.target === "chokepoint" && site.siteClass === "chokepoint-reference"
      ? "chokepoint · reference (runtime call not established)"
      : site.siteClass === "exempt"
        ? "protected thing · exempt (from where the chokepoint does not govern; never a bypass)"
        : site.siteClass === "inside"
          ? `${site.target === "protected" ? "protected thing" : "chokepoint"} · inside chokepoint`
          : `${site.target === "protected" ? "protected thing" : "chokepoint"} · ${site.siteClass}`;
  return html`<li data-class="${site.siteClass}" data-target="${site.target}" data-test="${site.test ? "true" : "false"}" data-owner="${site.owner ? "true" : "false"}"><code>${site.file}:${site.line}</code> in <code>${site.symbol}</code> <span class="quiet">${site.component?.folder ?? "outside declared components"}</span> <span class="site-role">${role}</span>${site.form === undefined ? null : html` <span class="label">${site.form}</span>`}${site.owner ? html` <span class="label">owner</span>` : null}${site.test ? html` <span class="label">test</span>` : null}</li>`;
}

/** One chokepoint's reliance: unknown said as unknown, a complete empty list as zero, else the sites the page carries and where the rest are. */
function renderRelianceOf(state: ShellState, reliance: Reliance): Markup {
  const evidence = reliance.evidence;
  if (evidence.status === "unknown") return html`<p class="quiet" data-reliance="unknown">${evidence.reason}</p>`;
  if (evidence.sites.length === 0 && evidence.left === 0) return html`<p class="quiet" data-reliance="complete">Complete run site evidence records 0 references to the chokepoint or protected thing.</p>`;
  return html`<p class="quiet" data-reliance="complete">${plural(evidence.sites.length + evidence.left, "recorded reference site", "recorded reference sites")} to the chokepoint or protected thing; owner component first.${evidence.left === 0 ? "" : ` This page lists ${evidence.sites.length} of them.`}</p>${evidence.left === 0 || reliance.entry === undefined ? null : renderSitesLeft(state, reliance.entry, reliance.chokepoint, evidence.left)}<ul class="site-list">${evidence.sites.map(renderSite)}</ul>`;
}

/**
 * Who references the chokepoint: the reliance listing a human reads before
 * acknowledging a retirement. Folded beneath the card, and open when a link
 * landed on it or the reader opened it, which the state keeps across renders.
 */
export function renderReliance(state: ShellState, invariant: SpecInvariant): Markup | null {
  const readings = relianceOf(invariant, state.spec.components, state.runs.records);
  if (readings.length === 0) return null;
  const id = relianceId(invariant.component, invariant.name);
  const counted = readings.map((r) => (r.evidence.status === "unknown" ? "unknown" : plural(r.evidence.sites.length + r.evidence.left, "site", "sites")));
  return html`<details class="record reliance" id="${id}" data-field="reliance" ${state.components.reliance === id ? "open" : ""}>
    <summary data-reliance-toggle="${id}"><span class="label">Reliance</span> who references this chokepoint <span class="quiet">${counted.join(", ")}</span></summary>
    ${join(readings.map((r) => html`<section data-reliance-of="${r.chokepoint}">${readings.length > 1 ? html`<h5><code>${r.chokepoint}</code> <span class="label">protects</span> <code>${r.protects}</code></h5>` : null}${renderRelianceOf(state, r)}</section>`))}
  </details>`;
}
