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
    concepts: { name: string }[];
    rejected: { concept: string }[];
    version: number;
  };
  assert.equal(glossary.concepts.length, file.concepts.length);
  assert.equal(glossary.retirements.length, file.rejected.length);
  assert.equal(glossary.version, file.version);
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
  for (const retirement of glossary.retirements) {
    assert.ok(rendered.includes(escapeHtml(retirement.concept)), `retired ${retirement.concept} is on the page`);
    assert.ok(rendered.includes(escapeHtml(retirement.because)), `because for retired ${retirement.concept} is on the page`);
  }
  for (const [name, text] of Object.entries(glossary.metaphors)) {
    assert.ok(rendered.includes(escapeHtml(text)), `metaphor ${name} is on the page`);
  }
  assert.ok(rendered.includes(`${glossary.concepts.length} concepts`), "concept count is in the masthead");
  assert.ok(rendered.includes(`glossary version ${glossary.version}`), "version is in the masthead");
});

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
  assert.ok(mnemion.retirements.length > 0, "Mnemion carries rejected names");
  for (const retirement of mnemion.retirements) {
    assert.ok(rendered.includes(escapeHtml(retirement.concept)), `rejected name ${retirement.concept} is on the page`);
    assert.ok(rendered.includes(escapeHtml(retirement.because)));
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
