import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptedNames,
  firstSentence,
  namesOfAlternative,
  parseGlossary,
  rejectedNames,
  renderCompact,
  renderCompactWithin,
  tokenEstimate,
  loadGlossary,
} from "./glossary.ts";
import { COHERENCE_GLOSSARY } from "./project.ts";

const coherence = parseGlossary(
  {
    version: 2,
    concepts: [
      {
        name: "invariant",
        definition: "The abstract behavioral requirement. It must be preserved across implementations.",
        status: "settled",
        rejected: [
          { alternative: "a flat project-level set of invariants", because: "coupling keeps it legible" },
          { alternative: "zorp", because: "a former name" },
        ],
        detail: { revelation: "never injected" },
        provenance: { owner_words: "never injected either" },
      },
      {
        name: "journal",
        definition: "Compression. The record of what was decided and why.",
        rejected: [{ alternative: "quux", because: "a former name" }],
      },
    ],
    metaphors: { spine: "Invariants are the spine." },
  },
  "coherence.json",
);

const project = parseGlossary(
  {
    project: "widgetry",
    version: 0,
    concepts: [
      {
        name: "widget",
        definition: "A thing with a knob and a dial. Widgets come in pairs.",
        aliases: ["gadget (code term)", "gizmo / thingamajig"],
        not_to_be_confused_with: ["sprocket: a toothed wheel", "Coherence's component"],
        properties: { anti_rot: "never addressed" },
      },
    ],
    trust_levels: [{ name: "owner-trusted", meaning: "full access" }],
    rejected: [
      { concept: "doohickey", because: "retired surface", decided_by: "owner" },
      { concept: "records/{object}/{id} URI form", because: "superseded" },
      { concept: "convention / add_convention (change type)", because: "vestigial" },
      { concept: "organism (as a name for the widget)", because: "metaphor, not a name" },
    ],
  },
  "widgetry.json",
);

test("namesOfAlternative keeps names and drops design sentences", () => {
  assert.deepEqual(namesOfAlternative("zorp"), [{ name: "zorp", identifierOnly: false }]);
  assert.deepEqual(namesOfAlternative("quux bundle"), [{ name: "quux bundle", identifierOnly: false }]);
  assert.deepEqual(namesOfAlternative("a flat project-level set of invariants"), []);
  assert.deepEqual(namesOfAlternative("fold conjecture into decide"), []);
  assert.deepEqual(namesOfAlternative("blorp (live TUI)"), [{ name: "blorp", identifierOnly: true }]);
  assert.deepEqual(namesOfAlternative("florp (roles, facets, caller-assessed records)"), [
    { name: "florp", identifierOnly: false },
  ]);
  assert.deepEqual(namesOfAlternative("canvas / notebook"), [
    { name: "canvas", identifierOnly: false },
    { name: "notebook", identifierOnly: false },
  ]);
  assert.deepEqual(namesOfAlternative("records/{object}/{id} URI form"), [
    { name: "records/{object}/{id} URI form", identifierOnly: false },
    { name: "records/{object}/{id}", identifierOnly: false },
  ]);
  assert.deepEqual(namesOfAlternative("convention / add_convention (change type)"), [
    { name: "convention", identifierOnly: true },
    { name: "add_convention", identifierOnly: true },
  ]);
});

test("rejectedNames carries the concept and because; top-level rejections carry the project", () => {
  const names = rejectedNames(project);
  assert.deepEqual(
    names.map((n) => [n.name, n.concept]),
    [
      ["doohickey", "widgetry"],
      ["records/{object}/{id} URI form", "widgetry"],
      ["records/{object}/{id}", "widgetry"],
      ["convention", "widgetry"],
      ["add_convention", "widgetry"],
      ["organism", "widgetry"],
    ],
  );
  assert.equal(names[0]!.because, "retired surface");
  assert.deepEqual(rejectedNames(coherence).map((n) => n.name), ["zorp", "quux"]);
});

test("acceptedNames strips alias parentheticals, splits slashes, and includes trust levels and the project", () => {
  assert.deepEqual([...acceptedNames(project)].sort(), ["gadget", "gizmo", "owner-trusted", "thingamajig", "widget", "widgetry"]);
});

test("firstSentence takes one sentence, or two when the first is a bare label", () => {
  assert.equal(firstSentence("The abstract behavioral requirement. It must be preserved."), "The abstract behavioral requirement.");
  assert.equal(firstSentence("Compression. The record of what was decided and why."), "Compression. The record of what was decided and why.");
  assert.equal(firstSentence("No period at all"), "No period at all");
});

test("renderCompact: header, one line per concept, rejected in brackets, nothing from detail, provenance or metaphors", () => {
  const text = renderCompact(coherence);
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^Coherence vocabulary \(2 concepts/);
  assert.equal(lines[1], "- invariant: The abstract behavioral requirement. [rejected: zorp]");
  assert.equal(lines[2], "- journal: Compression. The record of what was decided and why. [rejected: quux]");
  assert.doesNotMatch(text, /never injected|spine|owner_words|revelation/);
});

test("renderCompact: the project glossary renders beneath with its own header, aliases, a not: clause and top-level rejected names", () => {
  const text = renderCompact(coherence, project);
  const lines = text.trimEnd().split("\n");
  assert.equal(lines[3], "");
  assert.match(lines[4]!, /^Widgetry vocabulary \(1 concept/);
  assert.equal(
    lines[5],
    "- widget: A thing with a knob and a dial. (also: gadget, gizmo, thingamajig) (not: sprocket, Coherence's component)",
  );
  assert.equal(
    lines[6],
    "- rejected names: doohickey, records/{object}/{id} URI form, records/{object}/{id}, convention, add_convention, organism",
  );
  assert.doesNotMatch(text, /anti_rot|never addressed/);
});

test("renderCompactWithin steps the project layer down until the text fits; Coherence's layer never shrinks", () => {
  const big = parseGlossary(
    {
      project: "biggish",
      version: 0,
      concepts: Array.from({ length: 40 }, (_, i) => ({
        name: `thing${i}`,
        definition: `The ${i}th thing, described at some length so that the line is long. A second sentence follows.`,
        aliases: [`alias${i}`],
        not_to_be_confused_with: [`other${i}: a different thing entirely`],
      })),
    },
    "biggish.json",
  );
  const full = renderCompactWithin(coherence, big, 1_000_000);
  assert.equal(full.detail, "full");
  assert.match(full.text, /\(also: alias3\) \(not: other3\)/);

  const noConfusions = renderCompactWithin(coherence, big, full.text.length - 1);
  assert.equal(noConfusions.detail, "no-confusions");
  assert.match(noConfusions.text, /\(also: alias3\)/);
  assert.doesNotMatch(noConfusions.text, /not: other3/);

  const definitions = renderCompactWithin(coherence, big, noConfusions.text.length - 1);
  assert.equal(definitions.detail, "definitions");
  assert.match(definitions.text, /^- thing3: The 3th thing, described at some length so that the line is long\.$/m);

  const names = renderCompactWithin(coherence, big, definitions.text.length - 1);
  assert.equal(names.detail, "names");
  assert.match(names.text, /Biggish vocabulary \(40 concepts; names only here; full entries: coherence glossary\):\nthing0, thing1, /);
  assert.match(names.text, /^- invariant: The abstract behavioral requirement\. \[rejected: zorp\]$/m, "Coherence's layer is untouched");
  assert.ok(names.text.length < definitions.text.length);

  const tooSmall = renderCompactWithin(coherence, big, 10);
  assert.equal(tooSmall.detail, "names", "the last level is returned even when it does not fit");
  assert.equal(renderCompactWithin(coherence, undefined, 10).detail, "full", "without a project there is nothing to step down");
});

test("tokenEstimate is bytes over four, rounded up", () => {
  assert.deepEqual(tokenEstimate("abcde"), { bytes: 5, tokens: 2 });
});

test("the compact Coherence glossary stays under 2,000 tokens", async () => {
  const glossary = await loadGlossary(COHERENCE_GLOSSARY);
  const { tokens } = tokenEstimate(renderCompact(glossary));
  assert.ok(tokens < 2000, `compact glossary is ${tokens} tokens`);
  assert.equal(glossary.concepts.length, 38);
});
