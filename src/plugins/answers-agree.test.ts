/**
 * plugin check's "answers agree" duty: two slots that answer one question of
 * the same text are run over the check project and held to agree, so a
 * reader that misses what another reads is caught on the plugin's own
 * project (df-7ac38ee4, Python's two hand-written import readers).
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { checkPlugin } from "./check.ts";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

const STAND_IN = 'const SYMBOLS = { "store/secrets.zz": ["SECRET_COLUMNS", "seal"], "api/render.zz": ["TEMPLATE", "render"] };\nexport default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), topLevelSymbols: async (file) => (SYMBOLS[file] ?? []).map((name) => ({ name, line: 1, kind: 12 })), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => via, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n';

/** Python's readers before its parser, by the same expressions: the source scan reads a from-import to the end of its first line, the interfaces slot reads a parenthesized list whole. */
const OLD_READERS = `
const PY_DECLARATION = /^(?:async\\s+)?(?:def|class)\\s+([A-Za-z_]\\w*)|^([A-Z_][A-Z0-9_]*)\\s*(?::[^=]+)?=/;
const PY_FROM = /^from\\s+([\\w.]+)\\s+import\\s+([^\\n]+)$/gm;
const PY_LIST = /^[ \\t]*(?:from\\s+\\S+\\s+)?import\\s+(\\([^)]*\\)|[^\\n]*(?:\\\\\\n[^\\n]*)*)/gm;
export const SOURCE = {
  declarationOf(line) { const m = PY_DECLARATION.exec(line); return m === null ? undefined : { name: m[1] ?? m[2], exported: true }; },
  resolveModule: () => undefined,
  importsOf(text, add) { for (const m of text.matchAll(PY_FROM)) for (const piece of m[2].replace(/[()]/g, "").split(",")) { const name = piece.trim().split(/\\s+as\\s+/)[0].trim(); if (name !== "" && name !== "*") add(name, m[1]); } },
};
export const INTERFACES = { isTypeDeclaration: () => false, isDefaultExport: () => false, serverBounds: false, importLists: (text) => [...text.matchAll(PY_LIST)].map((m) => m[1]), defaultNames: () => [], wildcardModules: () => [] };
export const topLevel = (text, name) => new RegExp("^(?:def|class)\\\\s+" + name + "\\\\b|^" + name + "\\\\s*=", "m").test(text);
`;

function oldReaders(render: string): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-answers-agree-"));
  fixtures.push(root);
  const files: Record<string, string> = {
    "zz/plugin.json": JSON.stringify({ name: "zz", version: "0.1.0", pluginApi: 2, provides: { language: "zz" }, extensions: [".zz"], module: "./index.ts", syntax: { source: "readers.ts#SOURCE", interfaces: "readers.ts#INTERFACES", topLevel: "readers.ts#topLevel" } }),
    "zz/index.ts": STAND_IN,
    "zz/readers.ts": OLD_READERS,
    "zz/check.json": JSON.stringify({
      files: { "api/render.zz": render, "store/secrets.zz": "SECRET_COLUMNS = []\n\ndef seal(row):\n    return row\n" },
      language: { files: ["api/render.zz", "store/secrets.zz"], not: [] },
      declarations: [{ file: "store/secrets.zz", name: "seal", declared: true }],
      protects: "SECRET_COLUMNS", chokepoint: "seal", references: [], grade: "reference-choked", bypasses: [],
    }),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test("plugin check fails a plugin whose two readers of one text disagree: an import list renaming a name the source scan never reads imported, named by file and name", async () => {
  const split = oldReaders("from store.secrets import (\n    SECRET_COLUMNS,\n    seal as sealed,\n)\n\ndef render(row):\n    return sealed(row)\n");
  const failed = (await checkPlugin(split, "./zz")).duties.find((d) => d.name === "answers agree")!;
  assert.equal(failed.verdict, "fail", failed.reason);
  assert.match(failed.reason, /api\/render\.zz: interfaces\.importLists renames seal, which source\.importsOf reads no import of/);

  // The same import on one line: both readers read it, and the answers agree.
  const oneLine = oldReaders("from store.secrets import SECRET_COLUMNS, seal as sealed\n\ndef render(row):\n    return sealed(row)\n");
  const agreed = (await checkPlugin(oneLine, "./zz")).duties.find((d) => d.name === "answers agree")!;
  assert.equal(agreed.verdict, "pass", agreed.reason);
});

test("plugin check fails a plugin whose text reading declares a name the language server reports no top-level symbol of, named by file and line", async () => {
  // A class written inside a string: the line scan reads it as declared, the server knows no such symbol.
  const misread = oldReaders(["from store.secrets import seal", "", "TEMPLATE = '''", "class Fake:", "    pass", "'''", "", "def render(row):", "    return seal(row)", ""].join("\n"));
  const failed = (await checkPlugin(misread, "./zz")).duties.find((d) => d.name === "server agrees")!;
  assert.equal(failed.verdict, "fail", failed.reason);
  assert.match(failed.reason, /api\/render\.zz:4: the text reading declares Fake, which the language server reports no top-level symbol of/);
  assert.doesNotMatch(failed.reason, /declares (render|seal|TEMPLATE)\b/, "a name the server reports is no failure");
});
