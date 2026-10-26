/**
 * coherence plugin shapes: the shapes of import a project's code takes, by
 * count, beside its language plugin's check projects, each shape the project
 * writes and no check project holds named untested.
 */

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { BUNDLED_DIR } from "./registry.ts";
import { shapeCensus, shapesText } from "./shapes.ts";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

const PYTHON = join(BUNDLED_DIR, "python");

test("plugin shapes counts each shape of import the project writes beside its plugin's check projects, and names each the project writes that no check project holds", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-shapes-"));
  fixtures.push(root);
  const files: Record<string, string> = {
    "coherence.config.json": JSON.stringify({ language: "zz", plugins: { zz: "./zz" } }),
    "zz/plugin.json": JSON.stringify({ name: "zz", version: "0.1.0", pluginApi: 2, provides: { language: "zz" }, extensions: [".zz"], module: "./index.ts", treeSitter: { parser: "zz.wasm", queries: "zz.scm", resolve: "resolve.ts#RESOLVE" } }),
    "zz/index.ts": "export default {};\n",
    "zz/resolve.ts": "export const RESOLVE = { resolveModule: () => undefined, modulePaths: () => [] };\n",
    // The plugin's check project: one named import on one line, and nothing else.
    "zz/check.json": JSON.stringify({ files: { "a.zz": "from store import seal\n" }, language: { files: ["a.zz"], not: [] } }),
    "app/main.zz": "import store\nfrom store import (\n    seal as sealed,\n    Row,\n)\nfrom store import *\n\ndef run():\n    from lazy import thing\n    return thing\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  copyFileSync(join(PYTHON, "tree-sitter-python.wasm"), join(root, "zz", "zz.wasm"));
  copyFileSync(join(PYTHON, "python.scm"), join(root, "zz", "zz.scm"));

  const [census] = shapeCensus(root);
  assert.ok(census !== undefined && !("notRead" in census), JSON.stringify(census));
  const counts = Object.fromEntries(census.rows.map((r) => [r.shape, [r.here, r.checked]]));
  assert.deepEqual(counts, { named: [3, 1], renamed: [1, 0], glob: [1, 0], "whole module": [1, 0], "spans lines": [2, 0], "inside a block": [1, 0] });
  const text = shapesText([census]);
  for (const shape of ["renamed", "glob", "whole module", "spans lines", "inside a block"]) assert.match(text, new RegExp(`UNTESTED  \\d+ ${shape} import`), shape);
  assert.doesNotMatch(text, /UNTESTED  \d+ named import/, "a shape the check project holds is no gap");
});
