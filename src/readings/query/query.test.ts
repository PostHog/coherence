/**
 * The agent query check: every question answered from a fixture project, in
 * plain text, under a few hundred tokens.
 */

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname } from "node:path";
import { after, before, test } from "node:test";
import { predictClosure } from "../../economy/closure.ts";
import { economyFor } from "../../economy/cli.ts";
import type { Io } from "../../journal/cli.ts";
import { COHERENCE_GLOSSARY } from "../../lifecycle/project.ts";
import { buildScopePage } from "../scope/build.ts";
import { makeFixture, type Fixture } from "../scope/check-fixture.ts";
import type { Coverage } from "../../lifecycle/glossary-coverage.ts";
import { projectGlossaryCoverage } from "../scope/glossary-projection.ts";
import { structureOf } from "../scope/derive.ts";
import type { GlossaryCoverage, RecordedSite, ShellState } from "../scope/model.ts";
import { QUERY_DEPENDENCIES, queryCommand } from "./cli.ts";
import { answer, answerGlossary, answerSpine, QUESTIONS } from "./query.ts";

let fixture: Fixture;
let state: ShellState;

/** A few hundred tokens: four characters each, so 1600 characters. */
const FEW_HUNDRED_TOKENS = 1600;
const MNEMION_GLOSSARY = process.env["COHERENCE_DOMAIN_GLOSSARY"] ?? "/Users/daniloc/Documents/Dev/mnemion/mnemion-js/glossary.json";

async function queryPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  fixture = makeFixture();
  ({ state } = await buildScopePage({ root: fixture.root, glossaryPath: COHERENCE_GLOSSARY, project: "Fixture" }));
});

after(() => {
  if (fixture !== undefined) fixture.remove();
});

test("query invariants names the invariants that touch a file, by component and by reference site", () => {
  const result = answer(state, "invariants", ["src/api/handler.ts"]);
  assert.equal(result.code, 0);
  assert.ok(result.text.includes("by component src/api (Api)"), "the file's own component comes first");
  assert.ok(result.text.includes("src/store/single writer  structural defect"), "the chokepoint whose latest check touched the file is named");
  assert.ok(result.text.includes("a reference site in the latest run"), "and the reason is said");
  assert.ok(!result.text.includes("read shape"), "an invariant that never touched the file is not named");

  const folder = answer(state, "invariants", ["src/store"]);
  assert.ok(folder.text.includes("src/store/read shape") && folder.text.includes("src/store/open one"), "a folder lists its component's bullets");
  assert.ok(answer(state, "invariants", []).code === 64, "no path is refused");
  assert.ok(result.text.length < FEW_HUNDRED_TOKENS);
});

function setQuerySites(sites: RecordedSite[] | undefined): void {
  const entry = state.runs.records.at(-1)?.invariants.find((candidate) => candidate.name === "single writer" && candidate.form === "chokepoint");
  assert.ok(entry !== undefined);
  if (sites === undefined) delete entry.sites;
  else entry.sites = sites;
}

test("query relies-on lists symbols and lines from both endpoint site classes and reports legacy evidence as incomplete", () => {
  setQuerySites([
    { file: "src/api/door.ts", line: 7, symbol: "save", class: "chokepoint-reference", of: "chokepoint", test: false, form: "import" },
    { file: "src/api/handler.ts", line: 12, symbol: "handle", class: "bypass", of: "protected", test: false },
    { file: "src/store/write.ts", line: 4, symbol: "write", class: "inside", of: "protected", test: false },
  ]);
  const result = answer(state, "relies-on", [fixture.names.chokepoint]);
  assert.equal(result.code, 0);
  assert.ok(result.text.startsWith(`${fixture.names.chokepoint} protects ${fixture.names.protects}`));
  assert.ok(result.text.includes("owner src/store (Store)"), "the owning component is marked");
  assert.match(result.text, /src\/store\/write\.ts:4 in write — protected thing; inside/);
  assert.match(result.text, /src\/api\/door\.ts:7 in save — chokepoint; reference; runtime call not established; import/);
  assert.match(result.text, /src\/api\/handler\.ts:12 in handle — protected thing; bypass, not a legal chokepoint reference/);
  assert.ok(answer(state, "relies-on", ["nothing"]).text.startsWith("no bullet names"));
  assert.ok(result.text.length < FEW_HUNDRED_TOKENS);

  setQuerySites(undefined);
  assert.match(answer(state, "relies-on", [fixture.names.chokepoint]).text, /reliance unknown: run carries no sites; evidence is incomplete/);
  setQuerySites([]);
  assert.match(answer(state, "relies-on", [fixture.names.chokepoint]).text, /both endpoint queries completed and returned zero references/);
});

test("query spine uses the same ordered crossing model as Structure", () => {
  const ordered = structuredClone(state);
  ordered.structure.preview = [{ component: "src/store", name: "second crossing", crossing: { from: "inside", to: "outside" } }];
  const model = structureOf(ordered);
  const result = answerSpine(ordered);
  assert.equal(result.code, 0);
  assert.match(result.text, /^trust levels \(2\):/);
  assert.match(result.text, /crossings \(2\):/);
  const queryEdges = result.text.split("\n").filter((line) => line.startsWith("  ") && line.includes(" -> ")).map((line) => line.trim().split(/\s{2}/)[0]!);
  assert.deepEqual(queryEdges, model.edges.map((edge) => `${edge.component}/${edge.name}`));
  assert.match(result.text, /3 invariants have no crossing/);
  assert.equal(answer(state, "spine", ["extra"]).code, 64);
});

test("query spine reads all six Mnemion trust levels and every crossing when the read-only adopter is available", {
  skip: (await queryPathExists(MNEMION_GLOSSARY)) ? false : `${MNEMION_GLOSSARY} is not on this machine`,
}, async () => {
  const { state: mnemion } = await buildScopePage({ root: dirname(MNEMION_GLOSSARY), glossaryPath: COHERENCE_GLOSSARY, project: "Mnemion" });
  const model = structureOf(mnemion);
  const text = answerSpine(mnemion).text;
  assert.equal(model.levels.length, 6);
  for (const level of model.levels) assert.ok(text.includes(`  ${level.name} — ${level.meaning}`));
  const lines = text.split("\n").filter((line) => line.startsWith("  ") && line.includes(" -> "));
  assert.deepEqual(lines.map((line) => line.trim().split(/\s{2}/)[0]!), model.edges.map((edge) => `${edge.component}/${edge.name}`));
});

test("query status lists structural defects, open requirements, and escalations, in that order", () => {
  const result = answer(state, "status", []);
  assert.equal(result.code, 0);
  const defects = result.text.indexOf("structural defects (1)");
  const requirements = result.text.indexOf("open requirements (2)");
  const escalations = result.text.indexOf("escalations awaiting a human (1)");
  assert.ok(defects !== -1 && requirements !== -1 && escalations !== -1, result.text);
  assert.ok(defects < requirements && requirements < escalations, "in that order");
  assert.ok(result.text.includes(`bypass ${fixture.names.bypass.file}:${fixture.names.bypass.line} in ${fixture.names.bypass.symbol}`));
  assert.ok(result.text.includes(fixture.names.openEscalation) && !result.text.includes(fixture.names.acknowledgedEscalation), "only the open escalation");
  assert.ok(result.text.length < FEW_HUNDRED_TOKENS);
});

test("query component answers with intent, counts, bullets, and an unmeasured mass", () => {
  const result = answer(state, "component", ["src/store"]);
  assert.equal(result.code, 0);
  assert.ok(result.text.startsWith("Store  src/store  src/store/Store.spec.md"));
  assert.ok(result.text.includes("Owns every row"));
  assert.ok(result.text.includes("3 bullets: 1 invariants, 1 requirements, 1 structural defects; mass: not measured"));
  assert.ok(result.text.includes("contains src/store/cache"));
  assert.ok(answer(state, "component", ["nowhere"]).text.startsWith("no component at"));
  assert.ok(answer(state, "component", ["Store"]).text.startsWith("Store  "), "a component name is accepted too");
  assert.ok(result.text.length < FEW_HUNDRED_TOKENS);
});

test("query order answers with the order the journal folds from the store: its content and current state, never a state-change record; a completed order is not active", () => {
  const n = fixture.names;
  const mine = answer(state, "order", [], { session: n.session });
  assert.equal(mine.code, 0);
  assert.ok(mine.text.startsWith(`${n.workOrder}  active  owner ${n.session}\n`), mine.text);
  assert.ok(mine.text.includes("  objective: make every write pass through one door\n  success:   the chokepoint check passes\n  boundary:  src/store\n"), "the four things an order is");
  assert.ok(mine.text.includes(`${n.workMove}  -> active  fixture: taking it up`), "the move is history under the order");
  assert.ok(!mine.text.startsWith(n.workMove), "a move record is never answered as an order");
  assert.ok(!mine.text.includes(`${n.completedOrder}  active`) && !mine.text.includes("retire the cache"), "a completed order is not active");
  assert.ok(mine.text.includes("journal records bound: 0") && mine.text.includes("runs bound: 0"), "what binds to the order is said");
  const other = answer(state, "order", [], { session: "someone-else" });
  assert.equal(other.text, "no active work order for session someone-else (2 on record, 1 active)");
  const absent = answer({ ...state, journal: { ...state.journal, work: { kind: "absent", because: "no folder" } } }, "order", []);
  assert.equal(absent.text, "no work orders: no folder");
});

test("query economy answers what must be loaded to change the given files safely, through the economy's exported closure", async () => {
  assert.ok((QUESTIONS as readonly string[]).includes("economy"), "the fixed set names the economy prediction");
  assert.equal(QUERY_DEPENDENCIES.economy, economyFor, "the command line reaches the closure through the economy's one exported door");
  const printed: string[] = [];
  const io: Io = { cwd: fixture.root, out: (line) => printed.push(line), err: (line) => printed.push(line) };
  const none = await queryCommand(["economy"], io);
  assert.equal(none, 64, "no path is refused");
  assert.match(printed.join("\n"), /query economy: give at least one path/);
  printed.length = 0;
  // The instrument is not spawned under test: the closure is the economy's own, reached with no adapter, and says so.
  const code = await queryCommand(["economy", "src/store/write.ts"], io, { economy: (root, paths) => predictClosure(root, paths) });
  assert.equal(code, 0, printed.join("\n"));
  const text = printed.join("\n");
  assert.match(text, /^economy of a change to src\/store\/write\.ts: \d+ files?, ~\d+ tokens/);
  assert.ok(text.includes("src/store/Store.spec.md"), "the spec of the component holding the file is in the closure");
  assert.match(text, /hops skipped: instrument unavailable/);
  assert.ok(text.length < FEW_HUNDRED_TOKENS * 2);
  const hint = answer(state, "economy", ["src/store/write.ts"]);
  assert.equal(hint.code, 64, "the page state cannot answer it; the command line does, through the instrument");
  assert.match(hint.text, /query economy/);
});


test("bounded glossary answers make no false absence claim, while the CLI reads omitted terms and every use from full coverage", async () => {
  const omitted = {
    term: "omitted<term>", state: "instance" as const, concept: "kept concept", layer: "project" as const,
    definition: "definition <whole>", properties: { evidence: "<property>" }, confusables: ["other<term>"],
    fingerprint: "term-fingerprint", count: 2,
    contexts: [{ component: "component", fingerprint: "context-fingerprint", disposition: "unreviewed", because: "sense evidence <whole>" }],
    uses: [
      { file: "src/one.ts", line: 1, component: "component", text: "first <use>", kind: "code", fingerprint: "use-one" },
      { file: "src/two.ts", line: 2, component: "component", text: "second use", kind: "code", fingerprint: "use-two" },
    ],
  };
  const full: Coverage = {
    version: 1, projectGlossary: "glossary.json", fingerprint: "coverage-fingerprint",
    population: { files: [], excluded: [], unreadable: [], extraction: "fixture", limits: [] },
    terms: [omitted],
    totals: { terms: 1, uses: 2, known: 1, rejected: 0, unresolved: 0, unreviewedContexts: 1 },
  };
  const bounded = projectGlossaryCoverage(full, { bytes: 4096, terms: 0, contextsPerTerm: 0, usesPerTerm: 0, populationEntries: 0 });
  const page = answerGlossary(bounded, ["omitted<term>"]);
  assert.equal(page.code, 0);
  assert.match(page.text, /does not establish absence from the full corpus/);
  assert.match(page.text, /glossary review 'omitted<term>' --json/);

  const printed: string[] = [];
  const io: Io = { cwd: fixture.root, out: (line) => printed.push(line), err: (line) => printed.push(line) };
  const code = await queryCommand(["glossary", "omitted<term>"], io, {
    economy: QUERY_DEPENDENCIES.economy,
    glossary: async () => full,
  });
  assert.equal(code, 0);
  const text = printed.join("\n");
  assert.match(text, /Full observed candidate reading/);
  assert.match(text, /omitted<term> \[instance\] — definition <whole>/);
  assert.match(text, /Properties: {"evidence":"<property>"}; confusables: other<term>/);
  assert.match(text, /context-fingerprint/);
  assert.match(text, /src\/one\.ts:1 first <use>/);
  assert.match(text, /src\/two\.ts:2 second use/);
  assert.match(text, /2 of 2 uses shown; 0 uses omitted/);
});

test("glossary review commands shell-quote apostrophes in page omission guidance", () => {
  const report: GlossaryCoverage = {
    version: 1, projectGlossary: null, fingerprint: "f",
    population: { files: [], excluded: [], unreadable: [], extraction: "fixture", limits: [] },
    terms: [], totals: { terms: 1, uses: 0, known: 0, rejected: 0, unresolved: 1, unreviewedContexts: 0 },
    projection: { byteLimit: 100, selection: "fixture", contexts: 0, population: { files: 0, excluded: 0, unreadable: 0 } },
  };
  assert.match(answerGlossary(report, ["owner's term"]).text, /'owner'\\''s term'/);
});

test("query glossary displays every applicable property meaning instead of a false missing-definition line", () => {
  const report: GlossaryCoverage = {
    version: 1,
    projectGlossary: "glossary.json",
    fingerprint: "ambiguous-meaning",
    population: { files: [], excluded: [], unreadable: [], extraction: "fixture", limits: [] },
    totals: { terms: 1, uses: 1, known: 1, rejected: 0, unresolved: 0, unreviewedContexts: 1 },
    terms: [{
      term: "unit basis", state: "declared", concept: null, layer: null, definition: null, properties: {}, confusables: [],
      meaningAlternatives: [
        { concept: "exposure", layer: "project", definition: "The amount subject to loss.", properties: { unit_basis: "percentage" }, confusables: ["allocation"] },
        { concept: "allocation", layer: "project", definition: "The amount assigned to a strategy.", properties: { unit_basis: "percentage" }, confusables: ["exposure"] },
      ],
      fingerprint: "unit-basis", count: 1,
      contexts: [{ component: "money", fingerprint: "money-unit-basis", disposition: "unreviewed", because: null }],
      uses: [{ file: "src/money.ts", line: 4, component: "money", text: "unit_basis", kind: "code", fingerprint: "unit-basis-use" }],
    }],
  };
  const result = answerGlossary(report, ["unit basis"]);
  assert.match(result.text, /2 applicable property meanings; spelling alone does not select an owner/);
  assert.match(result.text, /applicable property meaning: exposure \(project\) — The amount subject to loss/);
  assert.match(result.text, /applicable property meaning: allocation \(project\) — The amount assigned to a strategy/);
  assert.doesNotMatch(result.text, /No settled definition/);
  assert.match(answerGlossary(report, ["allocation"]).text, /applicable property meaning: exposure/);
});

test("an unknown question is refused with the fixed set", () => {
  const result = answer(state, "everything", []);
  assert.equal(result.code, 64);
  for (const question of QUESTIONS) assert.ok(result.text.includes(`query ${question}`));
});
