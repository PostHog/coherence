/**
 * Timing debt in the tests: the runner's own measure of each test reaches the
 * run record, and a test is read only against its own history, with a floor,
 * allowing for a busier machine.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { latencyLines, readLatency } from "./latency.ts";
import type { RunEntry, RunRecord } from "./record.ts";
import { parseReport, verdictsFromReport } from "./totality.ts";

function entry(name: string, testMs: number | undefined): RunEntry {
  return { component: "src", name, form: "totality oracle", verdict: "pass", mode: "batched", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], latency: 0, reason: "", ...(testMs === undefined ? {} : { testMs }) };
}

let clock = 0;
function run(tests: Record<string, number | undefined>, options: { session?: string; load?: number } = {}): RunRecord {
  clock += 1;
  return {
    at: new Date(Date.UTC(2026, 9, 7, 0, 0, clock)).toISOString(),
    session: options.session ?? "s0",
    agent: "a",
    commit: null,
    dirty: false,
    instrument: { language: "typescript", server: "none" },
    latency: 0,
    load: { average: (options.load ?? 1) * 8, cores: 8 },
    invariants: Object.entries(tests).map(([name, ms]) => entry(name, ms)),
  };
}

test("a test is slower only against its own history: over twice its median and over the floor, allowing for a busier machine", () => {
  const history = [1000, 1100, 900, 1000, 1050].map((ms) => run({ grown: ms, jitter: 300, busy: 1000, young: 1000, steady: 5000 }));
  const young = [run({ young: 1000 })];
  const latest = run({ grown: 3000, jitter: 1500, steady: 6000, young: 4000 }, { session: "mine" });
  const busy = run({ busy: 3000 }, { session: "mine", load: 2 });
  const reading = readLatency([...history.map((r) => ({ ...r, invariants: r.invariants.filter((e) => e.name !== "young") })), ...young, latest, busy]);
  assert.deepEqual(reading.slower.map((s) => s.name), ["grown"], "only the test over twice its own median and over 2 s; jitter under the floor, a steady slow test, one with too little history, and one on a machine twice as busy are quiet");
  assert.equal(reading.slower[0]!.medianMs, 1000);
  assert.equal(reading.slower[0]!.history, 5);
  assert.equal(readLatency([...history, latest], { session: "someone else" }).slower.length, 0, "with a session, only that session's own runs are named");
  const bothBusy = readLatency([...history, run({ busy: 5000 }, { load: 2 })]);
  assert.deepEqual(bothBusy.slower.map((s) => s.name), ["busy"], "a busier machine raises the bar, it does not silence a test that outgrew even that");
  assert.match(latencyLines(reading)[0]!, /^Latency: 1 test ran over 2× the median of its own last runs: src\/grown 3\.0 s against 1\.0 s/);
});


test("a run records each test's time as its runner measured it, from a jest-shaped report, JUnit XML, and pytest-json-report", () => {
  const jest = parseReport(JSON.stringify({ testResults: [{ assertionResults: [{ title: "a", fullName: "a", status: "passed", duration: 120 }, { title: "a", ancestorTitles: ["a"], fullName: "a inner", status: "passed", duration: 30 }, { title: "b", fullName: "b", status: "passed" }] }] }));
  const jestVerdicts = verdictsFromReport(jest, ["a", "b"], "jest");
  assert.equal(jestVerdicts.get("a")!.testMs, 150, "every test under the via, summed");
  assert.equal(jestVerdicts.get("b")!.testMs, undefined, "a test with no measure leaves its time unknown, never zero");
  const junit = parseReport(`<testsuite><testcase classname="tests.test_x" name="test_a" time="1.25"/></testsuite>`);
  assert.equal(verdictsFromReport(junit, ["test_a"], "pytest").get("test_a")!.testMs, 1250);
  const pytest = parseReport(JSON.stringify({ tests: [{ nodeid: "tests/test_x.py::test_a", outcome: "passed", setup: { duration: 0.1 }, call: { duration: 0.5 }, teardown: { duration: 0.05 } }] }));
  assert.equal(verdictsFromReport(pytest, ["test_a"], "pytest").get("test_a")!.testMs, 650, "setup, call and teardown together");
});
