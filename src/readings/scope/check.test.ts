/**
 * The Scope check: builds the reading and asserts what the page must hold.
 *
 *   npm run scope:check
 *
 * The Mnemion assertion reads the first adopter's domain glossary from its own
 * repository (COHERENCE_DOMAIN_GLOSSARY overrides the path) and is skipped,
 * visibly, when that file is not on this machine.
 */

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { loadRuns } from "../../enforcement/record.ts";
import { loadJournal } from "../../journal/store.ts";
import { loadSpecModel } from "../../spec/model.ts";
import { DEFAULTS, buildScopePage, writeScopePage, writeStructurePreview, type BuildOptions } from "./build.ts";
import { makeFixture, type Fixture } from "./check-fixture.ts";
import { allReliance, componentId, defectsOf, invariantId, journalId, latestOf, relianceId, resolveHash, runId, structureId, structureOf, verifiedOf, workId } from "./derive.ts";
import { escapeHtml } from "./html.ts";
import type { Glossary, GlossaryCoverage, RecordedSite, ShellState, StructurePreview } from "./model.ts";
import { renderShell, renderView } from "./shell.ts";
import { renderStructureSvg } from "./structure-view.ts";

const options: BuildOptions = {
  glossaryPath: DEFAULTS.glossaryPath,
  project: DEFAULTS.project,
};

const MNEMION_GLOSSARY =
  process.env["COHERENCE_DOMAIN_GLOSSARY"] ?? "/Users/daniloc/Documents/Dev/mnemion/mnemion-js/glossary.json";
const MNEMION_ROOT = dirname(MNEMION_GLOSSARY);

const TWO_MB = 2 * 1024 * 1024;
const THREE_MB = 3 * 1024 * 1024;

let fixture: Fixture;
let fixtureState: ShellState;

before(async () => {
  fixture = makeFixture();
  ({ state: fixtureState } = await buildScopePage({ root: fixture.root, glossaryPath: DEFAULTS.glossaryPath, project: "Fixture" }));
});

after(() => fixture.remove());

/** A fresh copy of the fixture state, so a test's filters never leak into another's. */
function fresh(): ShellState {
  return JSON.parse(JSON.stringify(fixtureState)) as ShellState;
}

/** The markup of one card on a view. */
function card(rendered: string, id: string): string {
  const start = rendered.indexOf(`id="${id}"`);
  assert.ok(start !== -1, `card ${id} is on the page`);
  return rendered.slice(start, rendered.indexOf("</article>", start));
}

/** Every card id a view renders, in order. */
function cardIds(rendered: string): string[] {
  return [...rendered.matchAll(/<article class="entry[^"]*" id="([^"]+)"/g)].map((m) => m[1]!);
}

function firstGlossary(state: ShellState): Glossary {
  const layer = state.glossary.layers[0];
  assert.ok(layer !== undefined && layer.kind === "present", "the Coherence layer is present");
  return layer.glossary;
}

function secondGlossary(state: ShellState): Glossary {
  const layer = state.glossary.layers[1];
  assert.ok(layer !== undefined && layer.kind === "present", "the domain layer is present");
  return layer.glossary;
}

/** The JSON the page embeds, read back out of the file. */
function embeddedState(html: string): ShellState {
  const match = /<script type="application\/json" id="scope-state">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match !== null && match[1] !== undefined, "the page embeds its state");
  return JSON.parse(match[1]) as ShellState;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("the page builds to the default path and stays under 3 MB with Coherence's own data", async () => {
  const { bytes, state } = await writeScopePage(options, DEFAULTS.outPath);
  const onDisk = await readFile(DEFAULTS.outPath, "utf8");
  assert.equal(Buffer.byteLength(onDisk, "utf8"), bytes);
  assert.ok(bytes < THREE_MB, `page is ${bytes} bytes, must be under ${THREE_MB}`);
  assert.equal(state.spec.components.length, loadSpecModel(process.cwd()).components.length, "every component of Coherence's own tree is in the state");
  assert.equal(state.runs.records.length, loadRuns(process.cwd()).records.length, "every run record is in the state");
  assert.equal(state.journal.records.length, loadJournal(process.cwd()).records.length, "every journal record is in the state");
});

test("the page is self-contained: no external src, href, url() or @import", async () => {
  const { html } = await buildScopePage(options);
  const attributes = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/g)].map((m) => m[1] ?? "");
  for (const value of attributes) {
    assert.ok(
      value.startsWith("#") || value.startsWith("data:"),
      `external reference in page: ${value}`,
    );
  }
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  assert.ok(style.length > 0, "the page carries its styles inline");
  assert.doesNotMatch(style, /url\(\s*["']?(?:https?:)?\/\//, "no external url() in styles");
  assert.doesNotMatch(style, /@import/, "no @import in styles");
  assert.doesNotMatch(html, /^\s*import\s/m, "the inline module has no import statements left");
});

test("the embedded state is the loaded glossary, unchanged", async () => {
  const { html, state } = await buildScopePage(options);
  assert.deepEqual(embeddedState(html), state);
  const glossary = firstGlossary(state);
  const file = JSON.parse(await readFile(DEFAULTS.glossaryPath, "utf8")) as {
    concepts: { name: string; detail?: object; provenance?: object }[];
    metaphors: Record<string, string>;
    shape: object;
    version: number;
  };
  assert.equal(glossary.concepts.length, file.concepts.length);
  assert.equal(glossary.version, file.version);
  assert.deepEqual(Object.keys(glossary.metaphors), Object.keys(file.metaphors));
  assert.deepEqual(glossary.shape, file.shape, "the file's shape key is kept in the model");
  assert.equal(glossary.rejected_names, undefined, "Coherence's glossary has no top-level rejected names");
  assert.deepEqual(glossary.record, {}, "every top-level key of the file has a place in the model");
  for (const [i, concept] of glossary.concepts.entries()) {
    const entry = file.concepts[i]!;
    assert.deepEqual(concept.detail, entry.detail ?? {}, `${concept.name}: detail is kept whole`);
    assert.deepEqual(concept.provenance, entry.provenance ?? {}, `${concept.name}: provenance is kept whole`);
    assert.deepEqual(concept.record, {}, `${concept.name}: every key of the entry has a place in the model`);
  }
});

test("the render shows every concept name and every rejected alternative's because", async () => {
  const { state } = await buildScopePage(options);
  const rendered = renderShell(state).text;
  const glossary = firstGlossary(state);
  for (const concept of glossary.concepts) {
    assert.ok(rendered.includes(escapeHtml(concept.name)), `concept ${concept.name} is on the page`);
    for (const rejected of concept.rejected) {
      assert.ok(
        rendered.includes(escapeHtml(rejected.because)),
        `because for "${rejected.alternative}" (${concept.name}) is on the page`,
      );
    }
  }
  for (const [name, text] of Object.entries(glossary.metaphors)) {
    assert.ok(rendered.includes(escapeHtml(text)), `metaphor ${name} is on the page`);
  }
  for (const value of Object.values(glossary.shape ?? {})) {
    if (typeof value === "string") assert.ok(!rendered.includes(escapeHtml(value)), "the shape key is rendered nowhere");
  }
  assert.ok(rendered.includes(`${glossary.concepts.length} concepts`), "concept count is in the masthead");
  assert.ok(rendered.includes(`glossary version ${glossary.version}`), "version is in the masthead");
  assert.ok(!rendered.includes(">Retired mechanisms</h2>"), "there is no retired-mechanisms section");
  assert.ok(!rendered.includes('class="entry retirement"'), "there are no retired-mechanism cards");
});

/** The markup of one concept's card, and the vocabulary part of it: the body above the disclosures. */
function conceptCard(rendered: string, id: string): { card: string; vocabulary: string } {
  const start = rendered.indexOf(`id="${id}"`);
  assert.ok(start !== -1, `card ${id} is on the page`);
  const card = rendered.slice(start, rendered.indexOf("</article>", start));
  const from = card.indexOf('data-section="vocabulary"');
  assert.ok(from !== -1, `card ${id} has a vocabulary section`);
  const to = card.indexOf("<details", from);
  return { card, vocabulary: card.slice(from, to === -1 ? undefined : to) };
}

test("provenance and detail are one click away; no provenance key or value appears in the vocabulary", async () => {
  const { state } = await buildScopePage(options);
  const rendered = renderShell(state).text;
  const glossary = firstGlossary(state);
  for (const concept of glossary.concepts) {
    const id = `coherence-${slug(concept.name)}`;
    const { card, vocabulary } = conceptCard(rendered, id);
    assert.ok(!vocabulary.includes("<details"), `${concept.name}: the vocabulary holds no disclosure`);
    assert.ok(!vocabulary.includes('class="quotation'), `${concept.name}: no quotation in the vocabulary`);
    for (const [key, value] of Object.entries(concept.provenance)) {
      assert.ok(!vocabulary.includes(`data-field="${key}"`), `${concept.name}: provenance key ${key} is not a vocabulary field`);
      assert.ok(!vocabulary.includes(`<dt>${escapeHtml(key.replace(/_/g, " "))}</dt>`), `${concept.name}: ${key} is not labeled in the vocabulary`);
      for (const text of stringsIn(value)) {
        assert.ok(!vocabulary.includes(escapeHtml(text)), `${concept.name}: provenance ${key} text is not in the vocabulary`);
      }
    }
    const provenance = card.indexOf('data-section="provenance"');
    assert.ok(provenance !== -1 && card.includes("<summary>Provenance:"), `${concept.name}: provenance is under its own disclosure`);
    assert.ok(card.slice(provenance).includes('data-field="defined_by"'), `${concept.name}: defined_by is in provenance`);
    for (const [key, value] of Object.entries(concept.provenance)) {
      if (key === "owner_words" && typeof value === "string") {
        assert.ok(card.includes(`<blockquote class="quotation owner-words"><p>${escapeHtml(value)}</p>`), `${concept.name}: owner's words are a quotation`);
      }
      if (key === "metaphor" && typeof value === "string") {
        assert.ok(card.includes(`<blockquote class="quotation metaphor"><p>${escapeHtml(value)}</p>`), `${concept.name}: metaphor is a quotation`);
      }
    }
    const detailKeys = Object.keys(concept.detail);
    if (detailKeys.length === 0) {
      assert.ok(!card.includes('data-section="detail"'), `${concept.name}: no detail, no Detail disclosure`);
    } else {
      assert.ok(card.includes("<summary>Detail:"), `${concept.name}: detail is under its own disclosure`);
      for (const key of detailKeys) {
        assert.ok(card.includes(`data-field="${key}"`), `${concept.name}: detail ${key} is on the card`);
      }
      assert.ok(card.indexOf('data-section="detail"') < provenance, `${concept.name}: Detail comes before Provenance`);
    }
    assert.ok(!card.includes("data-section=\"record\""), `${concept.name}: the record is empty, so no record section renders`);
  }
});

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Every string inside a value, however nested. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
}

test("the render has one view strip with the seven views in order", async () => {
  const { state } = await buildScopePage(options);
  const rendered = renderShell(state).text;
  const tabs = [...rendered.matchAll(/role="tab"[^>]*data-view="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ["glossary", "components", "structure", "invariants", "reliance", "runs", "journal"]);
  for (const label of ["Glossary", "Components", "Structure", "Invariants", "Reliance", "Runs", "Journal"]) {
    assert.ok(rendered.includes(`>${label}</button>`), `${label} tab`);
  }
});

test("the search derives its matches from state and hides the rest", async () => {
  const { state } = await buildScopePage(options);
  const total = firstGlossary(state).concepts.length;
  state.glossary.query = "chokepoint";
  const rendered = renderShell(state).text;
  const shown = [...rendered.matchAll(/class="entry concept"/g)].length;
  assert.ok(shown > 0 && shown < total, `query narrows ${total} concepts to ${shown}`);
  assert.ok(rendered.includes(`${shown} of ${total} concepts match “chokepoint”.`));
  state.glossary.query = "no concept says this sentence";
  assert.ok(renderShell(state).text.includes("No concept matches"));
});

test("the Scope glossary reading displays every applicable property meaning without choosing an owner", () => {
  const state = fresh();
  const coverage: GlossaryCoverage = {
    version: 1,
    projectGlossary: "glossary.json",
    fingerprint: "ambiguous-meaning",
    population: { files: [], excluded: [], unreadable: [], extraction: "fixture", limits: [] },
    totals: { terms: 1, uses: 1, known: 1, rejected: 0, unresolved: 0, unreviewedContexts: 1 },
    terms: [{
      term: "unit basis",
      state: "declared",
      concept: null,
      layer: null,
      definition: null,
      properties: {},
      confusables: [],
      meaningAlternatives: [
        { concept: "exposure", layer: "project", definition: "The amount subject to loss.", properties: { unit_basis: "percentage" }, confusables: ["allocation"] },
        { concept: "allocation", layer: "project", definition: "The amount assigned to a strategy.", properties: { unit_basis: "percentage" }, confusables: ["exposure"] },
      ],
      fingerprint: "unit-basis",
      count: 1,
      contexts: [{ component: "money", fingerprint: "money-unit-basis", disposition: "unreviewed", because: null }],
      uses: [{ file: "src/money.ts", line: 4, component: "money", text: "unit_basis", kind: "code", fingerprint: "unit-basis-use" }],
    }],
  };
  state.glossary.coverage = coverage;
  state.glossary.query = "unit basis";
  const rendered = renderView(state, "glossary").text;
  assert.match(rendered, /2 applicable property meanings; this spelling alone does not select an owner/);
  assert.match(rendered, /exposure[\s\S]*The amount subject to loss/);
  assert.match(rendered, /allocation[\s\S]*The amount assigned to a strategy/);
  assert.match(rendered, /unit_basis/);
  assert.doesNotMatch(rendered, /No settled definition/);
});

test("an absent domain glossary is rendered as a placeholder, a present one as a second layer", async () => {
  const absent = await buildScopePage(options);
  const absentRendered = renderShell(absent.state).text;
  assert.ok(absentRendered.includes("No domain glossary is present."));

  const present = await buildScopePage({ ...options, domainPath: DEFAULTS.glossaryPath, domainTitle: "Stand-in domain" });
  const presentRendered = renderShell(present.state).text;
  assert.ok(!presentRendered.includes("No domain glossary is present."));
  assert.ok(presentRendered.includes("Stand-in domain"));
  assert.equal([...presentRendered.matchAll(/class="layer"/g)].length, 2);
  assert.ok(presentRendered.includes('id="domain-invariant"'), "domain layer cards carry their own ids");
});

test("related names that resolve become links; the rest are marked unresolved", async () => {
  const { state } = await buildScopePage(options);
  const rendered = renderShell(state).text;
  assert.ok(rendered.includes('href="#coherence-invariant"'));
  assert.ok(rendered.includes('class="unresolved"'), "some related names are not concepts and say so");
});

test("the build is deterministic: the same glossaries, specs, runs, journal and work in, byte-identical page out", async () => {
  const first = await buildScopePage(options);
  const second = await buildScopePage(options);
  assert.equal(first.html, second.html);

  // Union item 28: every input the page depends on, named. Adding a record to any of them
  // changes the page, which is why the claim is about all of them and not the glossaries alone.
  // Its own copy of the fixture: this test appends to every record store, and the shared one must not move.
  const own = makeFixture();
  const fixtureOptions: BuildOptions = { root: own.root, glossaryPath: DEFAULTS.glossaryPath, project: "Fixture" };
  const before = (await buildScopePage(fixtureOptions)).html;
  assert.equal((await buildScopePage(fixtureOptions)).html, before, "the fixture builds identically twice");
  const inputs: { name: string; write: () => void }[] = [
    { name: "the journal", write: () => appendFileSync(join(own.root, ".coherence", "journal", `${own.names.session}.jsonl`), JSON.stringify({ id: "d-00009999", kind: "decision", at: "2026-09-12T10:00:00.000Z", session: own.names.session, agent: "fixture", commit: "abc1234", dirty: false, chose: "one more door", over: ["two doors"], because: "a later record must reach the page" }) + "\n") },
    { name: "the runs", write: () => appendFileSync(join(own.root, ".coherence", "runs", `${own.names.session}.jsonl`), JSON.stringify({ at: "2026-09-12T10:00:00.000Z", session: own.names.session, agent: "fixture", commit: "abc1234", dirty: false, instrument: { language: "typescript", server: "cold" }, latency: 1, invariants: [{ component: "src/store", name: "single writer", form: "chokepoint", grade: "reference-choked", verdict: "pass", refutation: "automatic", bypasses: [], testReferences: 0, files: ["src/store/write.ts"], latency: 1, reason: "clean again" }] }) + "\n") },
    { name: "the work store", write: () => appendFileSync(join(own.root, ".coherence", "work", `${own.names.session}.jsonl`), JSON.stringify({ id: "wm-00009999", kind: "move", at: "2026-09-12T10:00:00.000Z", session: own.names.session, agent: "fixture", commit: "abc1234", dirty: false, of: own.names.workOrder, state: "waiting", because: "a later record must reach the page" }) + "\n") },
    { name: "the specs", write: () => appendFileSync(join(own.root, "src", "api", "Api.spec.md"), "- one more: The api keeps one rule of its own.\n  because: a later bullet must reach the page\n") },
  ];
  let previous = before;
  for (const input of inputs) {
    input.write();
    const after = (await buildScopePage(fixtureOptions)).html;
    assert.notEqual(after, previous, `${input.name} is an input the page depends on`);
    assert.equal((await buildScopePage(fixtureOptions)).html, after, `${input.name} changed, and the page is deterministic again`);
    previous = after;
  }
  own.remove();
});

test("the state stores no copy of what it derives: the latest verdicts live in the run records and nowhere else", async () => {
  const { state } = await buildScopePage({ root: fixture.root, glossaryPath: DEFAULTS.glossaryPath, project: "Fixture" });
  for (const component of state.spec.components) {
    for (const invariant of component.invariants) {
      for (const key of ["latest", "verified", "defects"]) {
        assert.ok(!(key in invariant), `${component.folder}/${invariant.name} carries no stored ${key}: it is derived from state.runs.records at render`);
      }
    }
  }
  // Derived at render, and the same answer the stored copy used to give.
  const invariant = state.spec.components.find((c) => c.folder === "src/store")!.invariants.find((i) => i.name === "single writer")!;
  const latest = latestOf(invariant, state.runs.records);
  assert.deepEqual(latest.map((l) => [l.form, l.verdict, l.at]), [["chokepoint", "fail", fixture.names.runAts[1]]]);
  assert.deepEqual(defectsOf(invariant, state.runs.records).map((d) => d.verdict), ["fail"]);
  assert.deepEqual(verifiedOf(invariant, state.runs.records), []);
  const kept = state.spec.components.find((c) => c.folder === "src/store")!.invariants.find((i) => i.name === fixture.names.keptName)!;
  assert.deepEqual(latestOf(kept, state.runs.records).map((l) => [l.form, l.at]), [["totality oracle", fixture.names.runAts[0]]], "an enforcement a later run skipped keeps the verdict of the last run that checked it");
  assert.deepEqual(verifiedOf(kept, state.runs.records).map((v) => v.verdict), ["pass"]);
});

test("every view renders from state: every component, invariant, run, and journal record in the fixture is on its view", () => {
  const state = fresh();
  const n = fixture.names;

  const components = renderView(state, "components").text;
  for (const folder of n.components) assert.ok(components.includes(`id="${componentId(folder)}"`), `component ${folder} has a card`);
  assert.equal([...components.matchAll(/data-slot="mass"/g)].length, n.components.length, "every component reserves its mass slot");
  assert.ok(components.includes("mass: not measured"));
  assert.ok(components.includes('data-depth="2"'), "nesting follows the folders");
  assert.ok(!components.includes("data-selected-invariants"), "no component is selected until the reader selects one");
  state.components.selected = "src/store";
  const selected = renderView(state, "components").text;
  const storeCard = card(selected, componentId("src/store"));
  assert.ok(storeCard.includes("data-selected-invariants"), "the selected component shows its invariants");
  for (const { component, name } of n.invariants.filter((i) => i.component === "src/store")) {
    assert.ok(storeCard.includes(`href="#${invariantId(component, name)}"`), `${name} is listed with a link`);
  }
  assert.ok(storeCard.includes('data-count="invariants">1 invariant<') && storeCard.includes('data-count="requirements">1 requirement<'), "counts per state");

  const invariants = renderView(state, "invariants").text;
  for (const { component, name, state: lifecycle } of n.invariants) {
    const c = card(invariants, invariantId(component, name));
    assert.ok(c.includes(`data-state="${lifecycle}"`), `${name} is a ${lifecycle}`);
  }
  assert.ok(invariants.includes("enforced by the language itself"), "the ladder's top rung names its enforcer");
  assert.ok(invariants.includes('data-refutation="witnessed"') && invariants.includes('data-refutation="automatic"') && invariants.includes('data-refutation="missing"'), "all three refutation states render");
  assert.ok(invariants.includes("outside</span> → <span class=\"level\" title=\"The store&#39;s own code.\">inside"), "a crossing names its trust levels with their meanings");
  assert.ok(card(invariants, invariantId("src/store", "read shape")).includes("kept from an earlier run"), "a verdict the latest run skipped is marked as kept");
  assert.ok(card(invariants, invariantId("src/store", "open one")).includes("lacks</span> enforcement, refutation, kinds"), "what a requirement lacks is said");
  state.invariants.state = "structural defect";
  assert.deepEqual(cardIds(renderView(state, "invariants").text), [invariantId("src/store", "single writer")], "the state filter narrows to the defect");
  state.invariants.state = "";
  state.invariants.component = ".";
  assert.deepEqual(cardIds(renderView(state, "invariants").text), [invariantId(".", "entry rule")], "the component filter narrows to the root");
  state.invariants.component = "";
  state.invariants.query = "row shape";
  assert.deepEqual(cardIds(renderView(state, "invariants").text), [invariantId("src/store", "read shape")], "the search narrows by sentence");
  state.invariants.query = "";

  const reliance = renderView(state, "reliance").text;
  const relianceCard = card(reliance, relianceId("src/store", "single writer"));
  assert.ok(relianceCard.includes("reliance unknown: run carries no sites"), "a legacy run is explicitly incomplete");
  assert.ok(reliance.includes('data-field="record-limit"'), "the evidence boundary is said on the view");

  const relied = allReliance(state.spec.components, state.runs.records).find((reading) => reading.invariant.name === "single writer");
  assert.ok(relied !== undefined && relied.evidence.status === "unknown");
  assert.match(relied.evidence.reason, /run carries no sites/);


  const runs = renderView(state, "runs").text;
  const runIds = cardIds(runs).filter((id) => id.startsWith("run-"));
  assert.deepEqual(runIds, [...state.runs.records].reverse().map(runId), "runs are listed latest first");
  const latest = card(runs, runIds[0]!);
  assert.ok(latest.includes('data-count="pass">0 pass<') && latest.includes('data-count="fail">1 fail<') && latest.includes('data-count="not-run">0 not run<'));
  assert.ok(latest.includes("<code>def5678</code>") && latest.includes("data-dirty"), "commit and dirty flag");
  assert.ok(latest.includes('data-field="verdicts"') && latest.includes("<details"), "verdicts are one click away");
  assert.ok(latest.includes(`kept from the run at 2026-09-10 10:00`) && latest.includes(n.keptName), "the kept mark names the earlier run");
  assert.ok(latest.includes("fixture") && latest.includes("s1-fixtu"), "agent and session");

  const journal = renderView(state, "journal").text;
  for (const id of n.journalIds) assert.ok(journal.includes(`id="journal-${id}"`), `journal record ${id} has a card`);
  assert.ok(journal.includes(`id="pinned-journal-${n.openEscalation}"`), "the open escalation is pinned at the top");
  assert.ok(!journal.includes(`id="pinned-journal-${n.acknowledgedEscalation}"`), "an acknowledged escalation is not pinned");
  assert.ok(journal.indexOf('data-field="escalations"') < journal.indexOf('id="journal-heading"'), "pinned before the timeline");
  assert.ok(card(journal, `journal-${n.acknowledgedEscalation}`).includes("acknowledged by ak-00000005"), "the answer a later record gives is in the margin");
  assert.ok(journal.includes(n.decisionOver), "a decision's rejected alternative is shown");
  assert.ok(journal.includes(n.conjectureCandidate) && journal.includes("log the key at both sites"), "a conjecture's candidates and discriminating test");
  assert.ok(journal.includes(`id="${workId(n.workOrder)}"`) && journal.includes("make every write pass through one door"), "the work order renders");
  const active = card(journal, workId(n.workOrder));
  assert.ok(active.includes('data-state="active"') && active.includes("the chokepoint check passes") && active.includes("src/store"), "the order shows its current state, success, and boundary");
  assert.ok(active.includes(`<code>${n.workMove}</code>`), "the move is history under the order");
  assert.ok(!journal.includes(`id="${workId(n.workMove)}"`), "a state-change record is never a card of its own");
  assert.ok(card(journal, workId(n.completedOrder)).includes('data-state="completed"'), "a closed order shows completed");
  state.journalView.kind = "decision";
  assert.deepEqual(cardIds(renderView(state, "journal").text).filter((id) => id.startsWith("journal-")), ["journal-d-00000001"], "the kind filter narrows");
  state.journalView.kind = "";
  state.journalView.query = "language server";
  assert.deepEqual(cardIds(renderView(state, "journal").text).filter((id) => id.startsWith("journal-")), ["journal-u-00000006"], "the search narrows");
  state.journalView.query = "";
  const absent = fresh();
  absent.journal.work = { kind: "absent", because: "nothing here" };
  assert.ok(renderView(absent, "journal").text.includes("No work orders: nothing here"), "absent work orders are a rendered fact");
});

test("a structural defect renders its bypass sites and both honest options", () => {
  const state = fresh();
  const n = fixture.names;
  const c = card(renderView(state, "invariants").text, invariantId("src/store", "single writer"));
  assert.ok(c.includes('data-field="defect"'));
  assert.ok(c.includes('data-grade="broken"') && c.includes("enforced by nobody"), "the broken rung and its enforcer");
  const bypasses = c.slice(c.indexOf('data-field="bypasses"'));
  assert.ok(bypasses.includes(`<code>${n.bypass.file}:${n.bypass.line}</code>`) && bypasses.includes(`<code>${n.bypass.symbol}</code>`), "file, line, symbol");
  assert.ok(c.includes('data-option="route"') && c.includes("Route through the chokepoint") && c.includes(`<code>${n.chokepoint}</code>`), "option one");
  assert.ok(c.includes('data-option="retire"') && c.includes("Escalate a retirement") && c.includes(`href="#${relianceId("src/store", "single writer")}"`), "option two links the reliance listing");
  for (const { component, name, state: lifecycle } of n.invariants) {
    if (lifecycle === "structural defect") continue;
    assert.ok(!card(renderView(state, "invariants").text, invariantId(component, name)).includes('data-field="defect"'), `${name} shows no defect section`);
  }
});

function setSingleWriterSites(state: ShellState, sites: RecordedSite[] | undefined): void {
  const entry = state.runs.records.at(-1)?.invariants.find((candidate) => candidate.name === "single writer" && candidate.form === "chokepoint");
  assert.ok(entry !== undefined);
  if (sites === undefined) delete entry.sites;
  else entry.sites = sites;
}

test("Structure derives every edge in stable order, counts no-crossing invariants, and renders defects and previews deterministically", () => {
  const state = fresh();
  const model = structureOf(state);
  assert.deepEqual(model.levels.map((level) => level.name), ["outside", "inside"]);
  assert.deepEqual(model.edges.map((edge) => `${edge.component}/${edge.name}`), ["src/store/single writer"]);
  assert.equal(model.invariantsWithoutCrossing, 3);
  const first = renderStructureSvg(model).text;
  const second = renderStructureSvg(structureOf(state)).text;
  assert.equal(first, second, "the same model produces byte-identical SVG");
  assert.match(first, /data-state="structural defect"/);
  assert.match(first, /1 bypass/);
  assert.match(first, /structure-defect/);
  assert.doesNotMatch(first, /read shape|open one|entry rule/, "bullets without crossings are not edges");

  const preview: StructurePreview = {
    component: "src/store",
    name: "preview writer",
    crossing: { from: "outside", to: "inside" },
    chokepoints: [{ chokepoint: "write", protects: "writeRow" }],
  };
  state.structure.preview = [preview];
  const proposed = renderView(state, "structure").text;
  assert.match(proposed, /preview writer/);
  assert.match(proposed, /data-proposed="true"/);
  assert.match(proposed, /structure-proposed/);
  assert.match(proposed, /reliance unknown: proposed preview has no run evidence/);
});

test("reliance reads both protected and chokepoint endpoint sites, owner first, without calling a bypass a legal door reference", () => {
  const state = fresh();
  setSingleWriterSites(state, [
    { file: "src/api/door.ts", line: 7, symbol: "save", class: "chokepoint-reference", of: "chokepoint", test: false, form: "import" },
    { file: "src/api/handler.ts", line: 12, symbol: "handle", class: "bypass", of: "protected", test: false },
    { file: "src/store/write.ts", line: 4, symbol: "write", class: "inside", of: "protected", test: false },
    { file: "src/api/door.test.ts", line: 9, symbol: "test save", class: "chokepoint-reference", of: "chokepoint", test: true },
  ]);
  const reading = allReliance(state.spec.components, state.runs.records).find((candidate) => candidate.invariant.name === "single writer");
  assert.ok(reading !== undefined && reading.evidence.status === "complete");
  assert.deepEqual(reading.evidence.sites.map((site) => site.file), ["src/store/write.ts", "src/api/door.test.ts", "src/api/door.ts", "src/api/handler.ts"], "owner component is first and sites are stable");
  const rendered = card(renderView(state, "reliance").text, relianceId("src/store", "single writer"));
  assert.match(rendered, /protected thing · inside chokepoint/);
  assert.match(rendered, /chokepoint · reference \(runtime call not established\)/);
  assert.match(rendered, /protected thing · bypass \(not a legal chokepoint reference\)/);
  assert.match(rendered, /data-test="true"/);

  const protectedOnly = fresh();
  setSingleWriterSites(protectedOnly, [{ file: "src/api/handler.ts", line: 12, symbol: "handle", class: "bypass", of: "protected", test: false }]);
  assert.match(renderView(protectedOnly, "reliance").text, /protected thing · bypass/);
  const doorOnly = fresh();
  setSingleWriterSites(doorOnly, [{ file: "src/api/door.ts", line: 7, symbol: "save", class: "chokepoint-reference", of: "chokepoint", test: false }]);
  assert.match(renderView(doorOnly, "reliance").text, /chokepoint · reference/);
});

test("legacy site absence stays unknown while a complete empty site list confirms zero", () => {
  const legacy = fresh();
  setSingleWriterSites(legacy, undefined);
  assert.match(renderView(legacy, "reliance").text, /reliance unknown: run carries no sites; evidence is incomplete/);
  assert.match(renderView(legacy, "structure").text, /reliance unknown: run carries no sites; evidence is incomplete/);

  const empty = fresh();
  setSingleWriterSites(empty, []);
  assert.match(renderView(empty, "reliance").text, /Complete site evidence records 0 references/);
  assert.match(renderView(empty, "reliance").text, /Both endpoint queries completed and returned no references/);
  assert.match(renderView(empty, "structure").text, /Complete run site evidence records 0 references/);
});

test("the Structure preview bridge validates crossings, selects Structure, and writes deterministic generated pages only", async () => {
  const preview: StructurePreview = { component: "src/store", name: "preview writer", crossing: { from: "outside", to: "inside" } };
  const output = await mkdtemp(join(tmpdir(), "coherence-structure-preview-"));
  try {
    const one = join(output, "preview-one.html");
    const two = join(output, "preview-two.html");
    const first = await writeStructurePreview(fixture.root, preview, one);
    const second = await writeStructurePreview(fixture.root, preview, two);
    assert.equal(first.state.activeView, "structure");
    assert.deepEqual(first.state.structure.preview, [preview]);
    assert.equal(await readFile(one, "utf8"), await readFile(two, "utf8"));
    assert.match(await readFile(one, "utf8"), /preview writer/);
    await assert.rejects(
      writeStructurePreview(fixture.root, { ...preview, name: "bad level", crossing: { from: "missing", to: "inside" } }, join(output, "bad.html")),
      /crossing names trust level missing/,
    );
    await assert.rejects(writeStructurePreview(fixture.root, preview, join(fixture.root, "preview.html")), /outside the project root/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("deep links resolve: every card id on every view resolves to that view", () => {
  const state = fresh();
  for (const view of state.views) {
    const rendered = renderView(state, view.id).text;
    const ids = view.id === "structure"
      ? [...rendered.matchAll(/<g class="structure-focus" id="([^"]+)"/g)].map((match) => match[1]!)
      : cardIds(rendered).filter((id) => !id.startsWith("pinned-"));
    assert.ok(ids.length > 0, `${view.id} renders cards`);
    for (const id of ids) {
      const target = resolveHash(state, `#${id}`);
      assert.ok(target !== undefined && target.view === view.id && target.id === id, `#${id} resolves to ${view.id}`);
    }
    assert.deepEqual(resolveHash(state, `#${view.id}`), { view: view.id, id: undefined }, `#${view.id} names the view alone`);
  }
  assert.equal(resolveHash(state, "#nothing-here"), undefined);
  assert.equal(resolveHash(state, ""), undefined);
  const links = [...renderView(state, "invariants").text.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
  for (const link of links) assert.ok(resolveHash(state, `#${link}`) !== undefined, `link #${link} resolves`);
});

test("the first adopter's tree builds as a second root: its glossary is the domain layer and its run records show its structural defects", {
  skip: (await exists(MNEMION_GLOSSARY)) ? false : `${MNEMION_GLOSSARY} is not on this machine`,
}, async () => {
  const { html, state } = await buildScopePage({ root: MNEMION_ROOT, glossaryPath: DEFAULTS.glossaryPath, project: "Mnemion" });
  assert.ok(Buffer.byteLength(html, "utf8") < THREE_MB);
  assert.ok(state.glossary.layers[1]?.kind === "present" && state.glossary.layers[1].title === "Mnemion glossary", "Mnemion's glossary.json is located from its root");
  assert.ok(state.spec.components.length > 1 && state.runs.records.length > 0, "Mnemion's specs and runs are loaded");
  const invariants = renderView(state, "invariants").text;
  const defects = state.spec.components.flatMap((c) => c.invariants.filter((i) => i.state === "structural defect"));
  assert.equal([...invariants.matchAll(/<article class="entry invariant" id="[^"]+" data-state="structural defect"/g)].length, defects.length, "every structural defect the model derives is a defect card");
  for (const defect of defects) {
    const c = card(invariants, invariantId(defect.component, defect.name));
    assert.ok(c.includes('data-option="route"') && c.includes('data-option="retire"'), `${defect.name} shows both options`);
    for (const site of defectsOf(defect, state.runs.records).flatMap((d) => d.bypasses)) {
      assert.ok(c.includes(`<code>${escapeHtml(site.file)}:${site.line}</code>`), `${defect.name} shows bypass ${site.file}:${site.line}`);
    }
  }
  const reliance = renderView(state, "reliance").text;
  assert.ok(reliance.includes(">writeClass</a>"), "Mnemion's kernel write chokepoint is on the reliance view");
  const structure = structureOf(state);
  assert.equal(structure.levels.length, 6, "Mnemion declares six trust levels");
  assert.equal(structure.edges.length, state.spec.components.flatMap((component) => component.invariants).filter((invariant) => invariant.crossing !== undefined).length);
  const svg = renderStructureSvg(structure).text;
  assert.equal(svg, renderStructureSvg(structureOf(state)).text, "Mnemion's read-only state produces byte-identical SVG");
  for (const level of structure.levels) assert.ok(svg.includes(escapeHtml(level.name)), `${level.name} is a Structure node`);
  for (const edge of structure.edges) assert.ok(svg.includes(escapeHtml(edge.name)), `${edge.name} is a Structure edge`);
});

test("the Mnemion domain glossary renders beneath Coherence's with every concept, ruling, rejected name and trust level", {
  skip: (await exists(MNEMION_GLOSSARY)) ? false : `${MNEMION_GLOSSARY} is not on this machine`,
}, async () => {
  const { html, state } = await buildScopePage({ ...options, domainPath: MNEMION_GLOSSARY });
  assert.ok(Buffer.byteLength(html, "utf8") < TWO_MB);
  assert.deepEqual(embeddedState(html), state);
  const mnemion = secondGlossary(state);
  const rendered = renderShell(state).text;

  const layers = [...rendered.matchAll(/id="layer-(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(layers, ["coherence", "domain"], "Coherence's layer comes first, the domain layer beneath");
  assert.ok(rendered.includes("Mnemion glossary"), "the layer is titled from the file's project name");
  assert.ok(mnemion.purpose !== undefined && rendered.includes(escapeHtml(mnemion.purpose)));

  assert.ok(mnemion.concepts.length > 0);
  for (const concept of mnemion.concepts) {
    assert.ok(rendered.includes(`id="domain-${concept.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}"`), `Mnemion concept ${concept.name} has a card`);
    assert.ok(rendered.includes(escapeHtml(concept.definition)), `definition of ${concept.name} is on the page`);
    for (const alias of concept.aliases) {
      assert.ok(rendered.includes(escapeHtml(alias)), `alias ${alias} of ${concept.name} is on the page`);
    }
    for (const distinction of concept.not_to_be_confused_with) {
      assert.ok(rendered.includes(escapeHtml(distinction)), `distinction for ${concept.name} is on the page`);
    }
  }
  assert.ok(mnemion.rulings !== undefined && mnemion.rulings.length > 0, "Mnemion carries rulings");
  for (const ruling of mnemion.rulings) {
    assert.ok(rendered.includes(escapeHtml(ruling.ruling)), `ruling on ${ruling.term} is on the page`);
  }
  assert.ok(mnemion.uncertain !== undefined && mnemion.uncertain.length > 0, "Mnemion carries uncertain terms");
  for (const item of mnemion.uncertain) {
    assert.ok(rendered.includes(escapeHtml(item.term)), "uncertain term is on the page in full");
  }
  assert.ok(mnemion.candidate_overloads !== undefined && mnemion.candidate_overloads.length > 0);
  for (const overload of mnemion.candidate_overloads) {
    for (const sense of overload.senses) assert.ok(rendered.includes(escapeHtml(sense)));
  }
  assert.ok(mnemion.rejected_names !== undefined && mnemion.rejected_names.length > 0, "Mnemion carries rejected names");
  for (const rejected of mnemion.rejected_names) {
    assert.ok(rendered.includes(escapeHtml(rejected.concept)), `rejected name ${rejected.concept} is on the page`);
    assert.ok(rendered.includes(escapeHtml(rejected.because)));
    assert.ok(rejected.decided_by !== undefined && rendered.includes(`decided by ${escapeHtml(rejected.decided_by)}`));
  }
  assert.ok(rendered.includes(">Rejected names</h2>"), "rejected names have their own section");
  for (const concept of mnemion.concepts) {
    for (const text of stringsIn(concept.properties)) {
      assert.ok(rendered.includes(escapeHtml(text)), `property of ${concept.name} is on the page`);
    }
    for (const text of stringsIn(concept.record)) {
      assert.ok(rendered.includes(escapeHtml(text)), `record of ${concept.name} is on the page`);
    }
  }
  assert.ok(mnemion.trust_levels !== undefined && mnemion.trust_levels.length > 0, "Mnemion declares trust levels");
  for (const level of mnemion.trust_levels) {
    assert.ok(rendered.includes(escapeHtml(level.name)) && rendered.includes(escapeHtml(level.meaning)));
  }
  assert.ok(
    rendered.includes('instance of Coherence\'s concept <a class="related-link" href="#coherence-trust-level">trust level</a>'),
    "trust levels are presented as instances of Coherence's concept, linked to its card",
  );
  for (const key of Object.keys(mnemion.record)) {
    assert.ok(rendered.includes(escapeHtml(key.replace(/_/g, " "))), `top-level field ${key} is on the page`);
  }
});
