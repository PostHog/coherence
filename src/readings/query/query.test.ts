/**
 * The agent query check: every question answered from a fixture project, in
 * plain text, under a few hundred tokens.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { COHERENCE_GLOSSARY } from "../../lifecycle/project.ts";
import { buildScopePage } from "../scope/build.ts";
import { makeFixture, type Fixture } from "../scope/check-fixture.ts";
import type { ShellState } from "../scope/model.ts";
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
  assert.ok(result.text.includes(`bypass ${fixture.names.bypass.file}:${fixture.names.bypass.line} in ${fixture.names.bypass.symbol}`));
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

test("query order answers the session's active work order, and says when there are none", () => {
  const mine = answer(state, "order", [], { session: fixture.names.session });
  assert.equal(mine.code, 0);
  assert.ok(mine.text.startsWith(`${fixture.names.workOrder}  active`));
  assert.ok(mine.text.includes("objective: make every write pass through one door"));
  const other = answer(state, "order", [], { session: "someone-else" });
  assert.ok(other.text.startsWith("no active work order for session someone-else"));
  const absent = answer({ ...state, journal: { ...state.journal, work: { kind: "absent", because: "no folder" } } }, "order", []);
  assert.equal(absent.text, "no work orders: no folder");
});

test("an unknown question is refused with the fixed set", () => {
  const result = answer(state, "everything", []);
  assert.equal(result.code, 64);
  for (const question of QUESTIONS) assert.ok(result.text.includes(`query ${question}`));
});
