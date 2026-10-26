/**
 * The reference project every language plugin is held to read alike:
 * plugin check's reference reading duty, and coherence plugin compare, which
 * lays every plugin's reading side by side.
 */

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { checkPlugin, compareReference, compareText, pluginAt } from "./check.ts";
import { BUNDLED_DIR } from "./registry.ts";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

const PYTHON = join(BUNDLED_DIR, "python");

/** A plugin by path reading a language "zz" through Python's parser, whose resolve gives an import of the module store its first file alone, as two blind Swift plugins did. */
function oneFileRule(): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-reference-"));
  fixtures.push(root);
  const files: Record<string, string> = {
    "zz/plugin.json": JSON.stringify({ name: "zz", version: "0.1.0", pluginApi: 2, provides: { language: "zz" }, extensions: [".zz"], module: "./index.ts", treeSitter: { parser: "zz.wasm", queries: "zz.scm", resolve: "resolve.ts#RESOLVE" } }),
    "zz/index.ts": "export default {};\n",
    "zz/resolve.ts": 'export const RESOLVE = { resolveModule: (root, from, specifier) => ({ store: "store/rows.zz", "api.render": "api/render.zz" })[specifier], modulePaths: () => [] };\n',
    "zz/check.json": JSON.stringify({
      files: {
        "store/rows.zz": "class Row:\n    pass\n",
        "store/secrets.zz": "SECRET_COLUMNS = []\n\ndef seal(row):\n    return row\n",
        "api/render.zz": "import store\n\ndef render(row):\n    return store.seal(store.Row(row)), store.SECRET_COLUMNS\n",
        "app/main.zz": "from api.render import render\n",
      },
      language: { files: ["store/rows.zz", "store/secrets.zz", "api/render.zz", "app/main.zz"], not: [] },
      declarations: [{ file: "store/secrets.zz", name: "seal", declared: true }],
      protects: "SECRET_COLUMNS", chokepoint: "seal", references: [], grade: "reference-choked", bypasses: [],
      reference: { files: { secrets: "store/secrets.zz", rows: "store/rows.zz", render: "api/render.zz", main: "app/main.zz" }, names: { SECRET_COLUMNS: "SECRET_COLUMNS", seal: "seal", Row: "Row", render: "render" } },
    }),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  copyFileSync(join(PYTHON, "tree-sitter-python.wasm"), join(root, "zz", "zz.wasm"));
  copyFileSync(join(PYTHON, "python.scm"), join(root, "zz", "zz.scm"));
  return root;
}

test("plugin compare lays every language plugin's reading of the reference project side by side, and names a plugin that reads a relation another way", async () => {
  const root = oneFileRule();
  const plugin = pluginAt(root, "./zz");
  const readings = await compareReference([plugin]);
  const zz = readings.find((r) => r.plugin === "zz")!;
  assert.ok("held" in zz, JSON.stringify(zz));
  assert.deepEqual(zz.missed, ["render imports SECRET_COLUMNS, seal from secrets: api/render.zz read importing nothing from store/secrets.zz"]);
  for (const bundled of ["typescript", "python", "rust", "go"]) {
    const reading = readings.find((r) => r.plugin === bundled)!;
    assert.ok("held" in reading && reading.missed.length === 0, `${bundled}: ${JSON.stringify(reading)}`);
  }
  assert.match(compareText(readings), /DIVERGES  zz \(zz\): render imports SECRET_COLUMNS, seal from secrets/);

  const duty = (await checkPlugin(root, "./zz")).duties.find((d) => d.name === "reference reading")!;
  assert.equal(duty.verdict, "fail", duty.reason);
  assert.match(duty.reason, /render imports SECRET_COLUMNS, seal from secrets: api\/render\.zz read importing nothing from store\/secrets\.zz/);
});
