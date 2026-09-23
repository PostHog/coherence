import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verdictsFromReport } from "./totality.ts";

function filtered(root: string, pattern: string, files: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env["NODE_TEST_CONTEXT"];
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", `--test-name-pattern=${pattern}`, ...files], {
    cwd: root,
    encoding: "utf8",
    env,
  });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

test("all-files filtering ignores safe teardown in unrelated files but preserves selected failures and missing detectors", async () => {
  const root = await mkdtemp(join(tmpdir(), "coherence-filtered-runner-"));
  try {
    await mkdir(join(root, "tests"));
    const unrelated = join(root, "tests", "unrelated.test.mjs");
    const selected = join(root, "tests", "selected.test.mjs");
    await writeFile(unrelated, [
      'import test, { after, before } from "node:test";',
      "let fixture;",
      "before(() => { fixture = { ready: true }; });",
      "after(() => { if (fixture !== undefined) fixture = undefined; });",
      'test("unrelated detector", () => { if (!fixture?.ready) throw new Error("fixture absent"); });',
    ].join("\n"));
    await writeFile(selected, 'import test from "node:test"; test("selected detector", () => {});\n');
    const files = [unrelated, selected];
    const baseline = filtered(root, "selected detector", files);
    assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);

    await writeFile(selected, 'import test from "node:test"; test("selected detector", () => { throw new Error("selected assertion failed"); });\n');
    const assertionFailure = filtered(root, "selected detector", files);
    assert.notEqual(assertionFailure.status, 0, "a selected assertion failure remains red");

    await writeFile(selected, [
      'import test, { before } from "node:test";',
      'before(() => { throw new Error("selected setup failed"); });',
      'test("selected detector", () => {});',
    ].join("\n"));
    const setupFailure = filtered(root, "selected detector", files);
    assert.notEqual(setupFailure.status, 0, "a selected setup failure remains red");

    const missingName = "missing detector";
    const missing = verdictsFromReport({ testResults: [{ assertionResults: [{ title: "selected detector", fullName: "selected detector", status: "passed" }] }] }, [missingName], "filtered runner").get(missingName)!;
    assert.equal(missing.verdict, "fail");
    assert.equal(missing.matched, 0, "a missing named detector remains distinguishable from a failing selected test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
