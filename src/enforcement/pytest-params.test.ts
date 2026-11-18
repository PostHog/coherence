/**
 * pytest names each case of a parametrized test `test_x[param]` in its JUnit
 * report. A via naming the test, `test_x`, selects every case through -k, so
 * run alone it passed; batched, no reported title equalled the via and it
 * read "no test ran". The billing retrial's agent rewrote its parametrized
 * test as a loop to get past it (c-4cbfb997).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReport, verdictsFromReport } from "./totality.ts";

const junit = (cases: string) => `<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest">${cases}</testsuite></testsuites>`;

test("a parametrized pytest test is graded by its cases: each test_x[param] belongs to the via test_x, and test_x_other does not", () => {
  const report = parseReport(
    junit(
      `<testcase classname="billing.tests.test_routes" name="test_routes_refuse[api/one]" time="0.1"/>` +
        `<testcase classname="billing.tests.test_routes" name="test_routes_refuse[api/two]" time="0.1"/>` +
        `<testcase classname="billing.tests.test_routes" name="test_routes_refuse_more" time="0.1"><failure message="boom">boom</failure></testcase>`,
    ),
  );
  const passing = verdictsFromReport(report, ["test_routes_refuse"], "pytest");
  assert.equal(passing.get("test_routes_refuse")!.verdict, "pass", passing.get("test_routes_refuse")!.reason);
  assert.equal(passing.get("test_routes_refuse")!.matched, 2, "both cases, and never test_routes_refuse_more, whose name only starts the same");

  const failing = verdictsFromReport(parseReport(junit(`<testcase classname="m" name="test_x[a]"/><testcase classname="m" name="test_x[b]"><failure message="no">no</failure></testcase>`)), ["test_x"], "pytest");
  assert.equal(failing.get("test_x")!.verdict, "fail", "one failing case fails the via");
  assert.match(failing.get("test_x")!.reason, /1 of 2 tests under "test_x" failed: m\.test_x\[b\]/);

  const one = verdictsFromReport(parseReport(junit(`<testcase classname="m" name="test_x[a]"/><testcase classname="m" name="test_x[b]"/>`)), ["test_x[a]"], "pytest");
  assert.equal(one.get("test_x[a]")!.matched, 1, "a via naming one case keeps to that case");
});
