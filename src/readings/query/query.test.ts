/**
 * The agent query check: every question answered from a fixture project, in
 * plain text, under a few hundred tokens.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { predictClosure } from "../../economy/closure.ts";
import { economyFor } from "../../economy/cli.ts";
import type { Io } from "../../journal/cli.ts";
import { COHERENCE_GLOSSARY } from "../../lifecycle/project.ts";
import { buildScopePage } from "../scope/build.ts";
import { makeFixture, type Fixture } from "../scope/check-fixture.ts";
import type { ShellState } from "../scope/model.ts";
import { QUERY_DEPENDENCIES, queryCommand } from "./cli.ts";
import { answer, QUESTIONS } from "./query.ts";

let fixture: Fixture;
let state: ShellState;

/** A few hundred tokens: four characters each, so 1600 characters. */
const FEW_HUNDRED_TOKENS = 1600;

before(async () => {
  fixture = makeFixture();
  ({ state } = await buildScopePage({ root: fixture.root, glossaryPath: COHERENCE_GLOSSARY, project: "Fixture" }));
});

after(() => fixture.remove());

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

test("query relies-on lists the components whose files reference the chokepoint's protected thing", () => {
  const result = answer(state, "relies-on", [fixture.names.chokepoint]);
  assert.equal(result.code, 0);
  assert.ok(result.text.startsWith(`${fixture.names.chokepoint} protects ${fixture.names.protects}`));
  assert.ok(result.text.includes("owner src/store (Store)"), "the owning component is marked");
  assert.ok(result.text.includes("src/api (Api): src/api/handler.ts"), "the relying component and its file are named");
  assert.ok(
    result.text.includes(`reference site ${fixture.names.bypass.file}:${fixture.names.bypass.line} in ${fixture.names.bypass.symbol} (a bypass: outside the chokepoint)`),
    "a bypass is the one reference site the record places",
  );
  assert.match(result.text, /the record carries files: a file list holds the definition of the protected thing/, "and the answer says what the file list is not");
  assert.ok(answer(state, "relies-on", ["nothing"]).text.startsWith("no bullet names"));
  assert.ok(result.text.length < FEW_HUNDRED_TOKENS);
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

test("an unknown question is refused with the fixed set", () => {
  const result = answer(state, "everything", []);
  assert.equal(result.code, 64);
  for (const question of QUESTIONS) assert.ok(result.text.includes(`query ${question}`));
});
