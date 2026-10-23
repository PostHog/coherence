import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptedNames,
  firstSentence,
  namesOfAlternative,
  parseLexicon,
  rejectedNames,
  renderCompact,
  renderCompactWithin,
  deliveredText,
  tokenEstimate,
  loadLexicon,
} from "./lexicon.ts";
import { COHERENCE_LEXICON } from "./project.ts";
import { lastNamed } from "./lexicon-recency.ts";

const coherence = parseLexicon(
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

const project = parseLexicon(
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

test("acceptedNames strips alias parentheticals, splits slashes, and includes property keys, trust levels and the project", () => {
  assert.deepEqual([...acceptedNames(project)].sort(), ["anti_rot", "gadget", "gizmo", "owner-trusted", "thingamajig", "widget", "widgetry"]);
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

test("renderCompact: the project lexicon renders beneath with its own header, aliases, a not: clause and top-level rejected names", () => {
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

test("renderCompactWithin keeps the vocabulary most recently named first: the host's budget trims the least recently named, to its name and then out, and a protected concept goes last", () => {
  const big = parseLexicon(
    {
      project: "biggish",
      version: 0,
      concepts: Array.from({ length: 40 }, (_, i) => ({
        name: `thing${i}`,
        definition: `The ${i}th thing, described at some length so that the line is long. A second sentence follows.`,
        aliases: [`alias${i}`],
        not_to_be_confused_with: [`other${i}: a different thing entirely`],
        ...(i === 39 ? { protected: true } : {}),
      })),
    },
    "biggish.json",
  );
  // thing5 was named last, then journal; invariant and the other things never.
  const named = new Map([["thing5", "2026-10-23T10:00:00.000Z"], ["journal", "2026-10-22T10:00:00.000Z"]]);
  const all = 42;

  const roomy = renderCompactWithin(coherence, big, 1_000_000, "coherence", true, () => true, named);
  assert.deepEqual(roomy.delivered, { whole: all, name: 0, out: 0 }, "with room, every concept whole: the lexicon has no ceiling of its own");
  assert.match(roomy.text, /^Coherence vocabulary \(2 concepts, most recently named first; rejected names are defects\):\n- journal: [^\n]*\n- invariant: /, "within a layer, the most recently named first");
  assert.match(roomy.text, /vocabulary \(40 concepts, most recently named first; [^\n]*\n- thing39: [^\n]*\n- thing5: [^\n]*\n- thing0: /, "the protected concept heads its layer, then the most recently named, then the file's order");
  assert.match(roomy.text, /\(also: alias3\) \(not: other3\)/);

  // Just short of everything whole: the least recently named concept is the first to lose its line.
  const short = renderCompactWithin(coherence, big, roomy.text.length - 1, "coherence", true, () => true, named);
  assert.ok(short.text.length <= roomy.text.length - 1);
  assert.ok(short.delivered.whole < all && short.delivered.out === 0, JSON.stringify(short.delivered));
  assert.match(short.text, /^- thing39: /m, "a protected concept keeps its line");
  assert.match(short.text, /^- thing5: /m, "the most recently named keeps its line");
  assert.match(short.text, /^- journal: /m);
  assert.match(short.text, /^Named only here \(full entries: coherence lexicon\): invariant$/m, "the first to go to its name: no record names it, and among those Coherence's own decay before the project's");
  assert.match(short.text, /^- thing38: /m);

  // Room for every name and no line: names only, still in order.
  const namesOnly = renderCompactWithin(coherence, big, renderCompactWithin(coherence, big, 1_000_000, "coherence", true, () => true, named).text.length / 4, "coherence", true, () => true, named);
  assert.ok(namesOnly.delivered.whole < 10, JSON.stringify(namesOnly.delivered));

  // Room for only some names: the least recently named are left out, counted, and a protected one is the last to go.
  const tight = renderCompactWithin(coherence, big, 560, "coherence", true, () => true, named);
  assert.ok(tight.text.length <= 560, `${tight.text.length}`);
  assert.equal(tight.delivered.whole, 0);
  assert.ok(tight.delivered.out > 0 && tight.delivered.name > 0, JSON.stringify(tight.delivered));
  assert.match(tight.text, /Named only here \(full entries: coherence lexicon\): thing39, thing5, /);
  assert.match(tight.text, /^Coherence vocabulary [^\n]*\nNamed only here \(full entries: coherence lexicon\): journal\n1 more, the least recently named: coherence lexicon\n/m, "a recently named concept keeps its name in its own layer while one never named is left out");
  assert.match(tight.text, /^\d+ more, the least recently named: coherence lexicon$/m);
  assert.doesNotMatch(tight.text, /thing38/);

  assert.match(renderCompactWithin(coherence, big, 1_000_000, "coherence", false).text, /^Coherence vocabulary \(2 concepts; use these names when you mean Coherence's concepts\):\n/, "in an adopter the header binds Coherence's names to Coherence's concepts; with no journal, the file's order and no claim of one");

  const tooSmall = renderCompactWithin(coherence, big, 10);
  assert.deepEqual(tooSmall.delivered, { whole: 0, name: 0, out: all }, "when not even one name fits, one line points at the lexicon command");
  assert.equal(tooSmall.text, "Vocabulary omitted to stay under the host budget; full entries: coherence lexicon\n");
  assert.equal(renderCompactWithin(coherence, undefined, 10, "node src/cli.ts").text, "Vocabulary omitted to stay under the host budget; full entries: node src/cli.ts lexicon\n", "the pointer names the command the session has");
  assert.equal(deliveredText(renderCompactWithin(coherence, undefined, 1_000_000).delivered), "whole", "without a project and with room, every concept whole");
});

test("lastNamed: the latest record naming each concept by name, alias or plural in its prose, never in an id or a path", () => {
  const record = (at: string, chose: string, extra: Record<string, unknown> = {}) => ({ kind: "decision", id: `d-${at.slice(11, 13)}000000`, at, session: "s", agent: "a", chose, over: "", because: "", ...extra });
  const widget = parseLexicon({ concepts: [{ name: "widget", definition: "A thing.", aliases: ["gadget"] }, { name: "trust level", definition: "A level." }, { name: "sprocket", definition: "Never named." }] }, "w.json");
  const records = [
    record("2026-10-01T01:00:00.000Z", "kept the widgets apart"),
    record("2026-10-01T02:00:00.000Z", "a new gadget"),
    record("2026-10-01T03:00:00.000Z", "raised the trust\nlevel"),
    record("2026-10-01T04:00:00.000Z", "nothing named", { cites: ["src/sprocket.ts"] }),
    record("2026-10-01T05:00:00.000Z", "widgetry is another word"),
  ] as unknown as Parameters<typeof lastNamed>[0];
  const named = lastNamed(records, widget.concepts);
  assert.equal(named.get("widget"), "2026-10-01T02:00:00.000Z", "an alias names its concept; a longer word that begins with the name does not");
  assert.equal(named.get("trust level"), "2026-10-01T03:00:00.000Z", "a name of several words across a line break");
  assert.equal(named.has("sprocket"), false, "a citation is not prose");
});

test("tokenEstimate is bytes over four, rounded up", () => {
  assert.deepEqual(tokenEstimate("abcde"), { bytes: 5, tokens: 2 });
});

test("every concept in Coherence's lexicon file is loaded", async () => {
  const lexicon = await loadLexicon(COHERENCE_LEXICON);
  const onDisk = JSON.parse(readFileSync(COHERENCE_LEXICON, "utf8")) as { concepts: unknown[] };
  assert.equal(lexicon.concepts.length, onDisk.concepts.length, "every concept in the file is loaded");
});
