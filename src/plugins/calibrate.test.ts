/**
 * coherence plugin calibrate: the text reading's declarations against the
 * language server's top-level symbols over a real project, misreads named
 * and what the server alone reports counted by kind.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { calibrate, calibrationText } from "./calibrate.ts";
import { writeParserPlugin } from "./fixtures/parser-plugin.ts";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

test("plugin calibrate names each declaration the text reading finds that the language server reports no top-level symbol of, and counts what the server alone reports by kind", async () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-calibrate-"));
  fixtures.push(root);
  // Read through Python's parser, which declares TEMPLATE and render and binds helper without declaring it.
  writeParserPlugin(join(root, "zz"), {}, {
    // A server whose account differs from the parse: it knows no render, which the reading declares, and reports a lowercase variable the reading leaves out.
    "index.ts": 'const SYMBOLS = { "app/render.zz": [["TEMPLATE", 13], ["helper", 13]] };\nexport default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), topLevelSymbols: async (file) => (SYMBOLS[file] ?? []).map(([name, kind]) => ({ name, line: 1, kind })), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => via, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n',
  });
  const files: Record<string, string> = {
    "coherence.config.json": JSON.stringify({ language: "zz", plugins: { zz: "./zz" } }),
    "app/render.zz": ["TEMPLATE = '''", "class Fake:", "    pass", "'''", "helper = 1", "", "def render(row):", "    return row", ""].join("\n"),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const [zz] = await calibrate(root);
  assert.ok(zz !== undefined && !("notRun" in zz), JSON.stringify(zz));
  assert.deepEqual({ declared: zz.declared, agreed: zz.agreed, readerOnly: zz.readerOnly }, { declared: 2, agreed: 1, readerOnly: ["app/render.zz:7 render"] });
  assert.deepEqual(zz.serverOnly, [{ kind: "variable", count: 1, example: "app/render.zz:1 helper" }]);
  assert.match(calibrationText([zz]), /MISREAD  1 the reading declares and the server reports no top-level symbol of/);
});
