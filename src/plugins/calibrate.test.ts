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

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

test("plugin calibrate names each declaration the text reading finds that the language server reports no top-level symbol of, and counts what the server alone reports by kind", async () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-calibrate-"));
  fixtures.push(root);
  const files: Record<string, string> = {
    "coherence.config.json": JSON.stringify({ language: "zz", plugins: { zz: "./zz" } }),
    "zz/plugin.json": JSON.stringify({ name: "zz", version: "0.1.0", pluginApi: 2, provides: { language: "zz" }, extensions: [".zz"], module: "./index.ts", syntax: { source: "readers.ts#SOURCE" } }),
    // A line scan that reads a class written inside a string as declared.
    "zz/readers.ts": 'export const SOURCE = { declarationOf(line) { const m = /^(?:def|class)\\s+(\\w+)|^([A-Z_][A-Z0-9_]*)\\s*=/.exec(line); return m === null ? undefined : { name: m[1] ?? m[2], exported: true }; }, resolveModule: () => undefined, importsOf: () => {} };\n',
    // A server that knows the file's real symbols, a lowercase variable among them the reading leaves out.
    "zz/index.ts": 'const SYMBOLS = { "app/render.zz": [["TEMPLATE", 13], ["render", 12], ["helper", 13]] };\nexport default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), topLevelSymbols: async (file) => (SYMBOLS[file] ?? []).map(([name, kind]) => ({ name, line: 1, kind })), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => via, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n',
    "app/render.zz": ["TEMPLATE = '''", "class Fake:", "    pass", "'''", "helper = 1", "", "def render(row):", "    return row", ""].join("\n"),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const [zz] = await calibrate(root);
  assert.ok(zz !== undefined && !("notRun" in zz), JSON.stringify(zz));
  assert.deepEqual({ declared: zz.declared, agreed: zz.agreed, readerOnly: zz.readerOnly }, { declared: 3, agreed: 2, readerOnly: ["app/render.zz:2 Fake"] });
  assert.deepEqual(zz.serverOnly, [{ kind: "variable", count: 1, example: "app/render.zz:1 helper" }]);
  assert.match(calibrationText([zz]), /MISREAD  1 the reading declares and the server reports no top-level symbol of/);
});
