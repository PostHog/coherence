/**
 * The parts of the seam that need no instrument: how a spec value reads,
 * how an import site is told from a use, and which paths are tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { isTestPath, parseName, rangeContains } from "./adapter.ts";
import { PYTHON_LADDER, PythonAdapter } from "./python.ts";
import { TYPESCRIPT_LADDER, isImportSite } from "./typescript.ts";

test("a spec value reads as a bare symbol, a symbol in a file, a module path, or prose", () => {
  assert.deepEqual(parseName("writeClass"), { form: "symbol", name: "writeClass", fileHint: undefined });
  assert.deepEqual(parseName("KERNEL_WRITE_POLICY in policy.ts"), { form: "symbol", name: "KERNEL_WRITE_POLICY", fileHint: "policy.ts" });
  assert.deepEqual(parseName("seal in entities/Hive/policy.ts"), { form: "symbol", name: "seal", fileHint: "entities/Hive/policy.ts" });
  assert.deepEqual(parseName("entities/Hive/policy.ts"), { form: "module", path: "entities/Hive/policy.ts" });
  assert.equal(parseName("the kernel tables (KERNEL_TABLES) reached through data.ts").form, "prose");
  assert.equal(parseName("IMMUTABLE and IMMUTABLE_AFTER_CREATE in kernel.ts").form, "prose");
});

test("an import or export specifier is told from a use, across wrapped lines", () => {
  const lines = ['import { SECRET_COLUMNS, seal } from "../store/secrets.ts";', "", "export function render() {", "  const leaked = SECRET_COLUMNS;", "}"];
  assert.equal(isImportSite(lines, 0, 9), true);
  assert.equal(isImportSite(lines, 3, 17), false);
  const wrapped = ["import {", "  SECRET_COLUMNS,", "  seal,", '} from "./secrets.ts";', "const x = SECRET_COLUMNS;"];
  assert.equal(isImportSite(wrapped, 1, 2), true);
  assert.equal(isImportSite(wrapped, 4, 10), false);
  const reexport = ['export { SECRET_COLUMNS } from "./secrets.ts";', "export type { Row } from './row.ts';"];
  assert.equal(isImportSite(reexport, 0, 9), true);
  assert.equal(isImportSite(reexport, 1, 14), true);
  const afterImport = ['import { a } from "./a.ts";', "const b = a(SECRET_COLUMNS);"];
  assert.equal(isImportSite(afterImport, 1, 12), false, "a use on the line after an import is a use");
});

test("a path is a test when a configured folder is a segment or the file is named .test or .spec", () => {
  const folders = ["__tests__", "tests"];
  assert.equal(isTestPath("src/__tests__/policy.test.ts", folders), true);
  assert.equal(isTestPath("src/policy.test.ts", folders), true);
  assert.equal(isTestPath("src/policy.spec.ts", folders), true);
  assert.equal(isTestPath("src/policy.ts", folders), false);
  assert.equal(isTestPath("tests-helpers/policy.ts", folders), false, "a folder name matches whole, not as a prefix");
});

test("rangeContains is inclusive at both ends", () => {
  const range = { start: { line: 2, character: 4 }, end: { line: 5, character: 1 } };
  assert.equal(rangeContains(range, { line: 2, character: 4 }), true);
  assert.equal(rangeContains(range, { line: 5, character: 1 }), true);
  assert.equal(rangeContains(range, { line: 5, character: 2 }), false);
  assert.equal(rangeContains(range, { line: 1, character: 40 }), false);
});

test("the grade ladder's top rung is adapter-defined: TypeScript enforces visibility, Python does not", async () => {
  assert.equal(TYPESCRIPT_LADDER.top, "visibility-choked");
  assert.equal(PYTHON_LADDER.top, "reference-choked");
  assert.match(PYTHON_LADDER.because, /convention/);
  const python = new PythonAdapter("/nowhere");
  const ready = await python.ready();
  assert.equal(ready.ok, false);
  assert.match(ready.reason, /not yet/);
  const visibility = await python.visibility({ name: "x", kind: "symbol", file: "x.py", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, selection: { line: 0, character: 0 } });
  assert.equal(visibility.enforced, false);
});
