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
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { DEFAULTS, buildScopePage, writeScopePage, type BuildOptions } from "./build.ts";
import { escapeHtml } from "./html.ts";
import type { Glossary, ShellState } from "./model.ts";
import { renderShell } from "./shell.ts";

const options: BuildOptions = {
  glossaryPath: DEFAULTS.glossaryPath,
  project: DEFAULTS.project,
};

const MNEMION_GLOSSARY =
  process.env["COHERENCE_DOMAIN_GLOSSARY"] ?? "/Users/daniloc/Documents/Dev/mnemion/mnemion-js/glossary.json";

const TWO_MB = 2 * 1024 * 1024;

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

test("the page builds to the default path and stays under 2 MB", async () => {
  const { bytes } = await writeScopePage(options, DEFAULTS.outPath);
  const onDisk = await readFile(DEFAULTS.outPath, "utf8");
  assert.equal(Buffer.byteLength(onDisk, "utf8"), bytes);
  assert.ok(bytes < TWO_MB, `page is ${bytes} bytes, must be under ${TWO_MB}`);
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
  assert.doesNotMatch(html, /url\(\s*["']?(?:https?:)?\/\//, "no external url() in styles");
  assert.doesNotMatch(html, /@import/, "no @import in styles");
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

test("the render has one view strip with a Glossary tab", async () => {
  const { state } = await buildScopePage(options);
  const rendered = renderShell(state).text;
  const tabs = [...rendered.matchAll(/role="tab"/g)];
  assert.equal(tabs.length, 1);
  assert.ok(rendered.includes(">Glossary</button>"));
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

test("the build is deterministic: the same glossary in, byte-identical page out", async () => {
  const first = await buildScopePage(options);
  const second = await buildScopePage(options);
  assert.equal(first.html, second.html);
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
