/**
 * The reference project every language plugin is held to read alike:
 * plugin check's reference reading duty, and coherence plugin compare, which
 * lays every plugin's reading side by side.
 */

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
function oneFileRule(render = "import store\n\ndef render(row):\n    return store.seal(store.Row(row)), store.SECRET_COLUMNS\n", modules: Record<string, string> = { store: "store/rows.zz", "api.render": "api/render.zz" }): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-reference-"));
  fixtures.push(root);
  const files: Record<string, string> = {
    "zz/plugin.json": JSON.stringify({ name: "zz", version: "0.1.0", pluginApi: 3, provides: { language: "zz" }, extensions: [".zz"], module: "./index.ts", treeSitter: { parser: "zz.wasm", queries: "zz.scm", resolve: "resolve.ts#RESOLVE" } }),
    "zz/index.ts": "export default {};\n",
    "zz/resolve.ts": `export const RESOLVE = { resolveModule: (root, from, specifier) => (${JSON.stringify(modules)})[specifier], modulePaths: () => [] };\n`,
    "zz/check.json": JSON.stringify({
      files: {
        "store/rows.zz": "class Row:\n    pass\n",
        "store/secrets.zz": "SECRET_COLUMNS = []\n\ndef seal(row):\n    return row\n",
        "api/render.zz": render,
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

test("a whole-module import reaches a name of the reference project only where the importer spells it: an import of the secrets module whose names render never uses holds no relation to them", async () => {
  const unused = oneFileRule("import store.secrets\nfrom store.rows import Row\n\ndef render(row):\n    return Row(row)\n", { "store.secrets": "store/secrets.zz", "store.rows": "store/rows.zz", "api.render": "api/render.zz" });
  const zz = (await compareReference([pluginAt(unused, "./zz")])).find((r) => r.plugin === "zz")!;
  assert.ok("held" in zz, JSON.stringify(zz));
  assert.deepEqual(zz.missed, ["render imports SECRET_COLUMNS, seal from secrets: api/render.zz read importing no SECRET_COLUMNS, seal from store/secrets.zz"]);

  const used = oneFileRule("import store.secrets\nfrom store.rows import Row\n\ndef render(row):\n    return store.secrets.seal(Row(row)), store.secrets.SECRET_COLUMNS\n", { "store.secrets": "store/secrets.zz", "store.rows": "store/rows.zz", "api.render": "api/render.zz" });
  const read = (await compareReference([pluginAt(used, "./zz")])).find((r) => r.plugin === "zz")!;
  assert.ok("held" in read && read.missed.length === 0, JSON.stringify(read));
});

test("a plugin written for an older interface version is told a duty newer than it is not held, and never failed by it: reference reading and server agrees hold from pluginApi 3", async () => {
  const root = oneFileRule();
  const manifest = join(root, "zz", "plugin.json");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"pluginApi":3', '"pluginApi":2'));
  const duties = (await checkPlugin(root, "./zz")).duties;
  // Each names what it asks of that version, never another change the version brought.
  for (const [name, asks] of [["reference reading", /which brought what it asks: check\.json's map of the reference project \(reference\)/], ["server agrees", /which brought what it asks: the adapter's topLevelSymbols/]] as const) {
    const duty = duties.find((d) => d.name === name)!;
    assert.equal(duty.verdict, "pass", `${name}: ${duty.reason}`);
    assert.match(duty.reason, new RegExp(`not held: plugin zz is written for pluginApi 2, and ${name} holds from pluginApi 3`));
    assert.match(duty.reason, asks);
    assert.doesNotMatch(duty.reason, /tree-sitter parser/, `${name} quotes no change it does not ask`);
  }
});
