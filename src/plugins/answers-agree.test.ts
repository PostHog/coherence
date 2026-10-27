/**
 * plugin check's "answers agree" duty: two readings that answer one question
 * of the same text are run over the check project and held to agree, so a
 * reader that misses what another reads is caught on the plugin's own
 * project (df-7ac38ee4, Python's two hand-written import readers). The
 * parser derives every reading of the text from one parse; what a plugin
 * still states itself (its interfaces table's facts) is held to the parse.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkPlugin } from "./check.ts";
import { writeParserPlugin } from "./fixtures/parser-plugin.ts";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in server that reports, of each file, the top-level symbols given. */
function standIn(symbols: Record<string, string[]>): string {
  return `const SYMBOLS = ${JSON.stringify(symbols)};\nexport default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), topLevelSymbols: async (file) => (SYMBOLS[file] ?? []).map((name) => ({ name, line: 1, kind: 12 })), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => via, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n`;
}

const SECRETS = "SECRET_COLUMNS = []\n\ndef seal(row):\n    return row\n";

/** A plugin by path reading zz through Python's parser, its interfaces table's facts, its server and its check project's render file as given. */
function parserPlugin(render: string, facts: string, symbols: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-answers-agree-"));
  fixtures.push(root);
  writeParserPlugin(join(root, "zz"), { syntax: { interfaces: "facts.ts#FACTS" } }, {
    "index.ts": standIn(symbols),
    "facts.ts": `export const FACTS = ${facts};\n`,
    "check.json": JSON.stringify({
      files: { "api/render.zz": render, "store/secrets.zz": SECRETS },
      language: { files: ["api/render.zz", "store/secrets.zz"], not: [] },
      declarations: [{ file: "store/secrets.zz", name: "seal", declared: true }],
      protects: "SECRET_COLUMNS", chokepoint: "seal", references: [], grade: "reference-choked", bypasses: [],
    }),
  });
  return root;
}

const RENDER = "from store.secrets import SECRET_COLUMNS, seal as sealed\n\nclass Row:\n    pass\n\ndef render(row):\n    return sealed(row)\n";
const EVERY_SYMBOL = { "store/secrets.zz": ["SECRET_COLUMNS", "seal"], "api/render.zz": ["Row", "render"] };

test("plugin check fails a plugin whose two readers of one text disagree: an interfaces table that reads a type declaration where the parser reads none, named by file and name", async () => {
  // The plugin's own fact says a class line declares a type; Python's queries read a class as a body.
  const split = parserPlugin(RENDER, '{ serverBounds: false, isTypeDeclaration: (line) => /^class\\s/.test(line) }', EVERY_SYMBOL);
  const failed = (await checkPlugin(split, "./zz")).duties.find((d) => d.name === "answers agree")!;
  assert.equal(failed.verdict, "fail", failed.reason);
  assert.match(failed.reason, /api\/render\.zz:3: interfaces reads Row's line as type declaration, declares as body/);
  assert.doesNotMatch(failed.reason, /render\.zz:6|secrets\.zz/, "a line both read alike is no failure");

  // The fact left to the parse: both read the class line alike, and the answers agree.
  const agreeing = parserPlugin(RENDER, "{ serverBounds: false }", EVERY_SYMBOL);
  const agreed = (await checkPlugin(agreeing, "./zz")).duties.find((d) => d.name === "answers agree")!;
  assert.equal(agreed.verdict, "pass", agreed.reason);
});

test("plugin check fails a plugin whose text reading declares a name the language server reports no top-level symbol of, named by file and line", async () => {
  // The parser declares render; a server whose account lacks it reports no such symbol.
  const misread = parserPlugin(RENDER, "{ serverBounds: false }", { "store/secrets.zz": ["SECRET_COLUMNS", "seal"], "api/render.zz": ["Row"] });
  const failed = (await checkPlugin(misread, "./zz")).duties.find((d) => d.name === "server agrees")!;
  assert.equal(failed.verdict, "fail", failed.reason);
  assert.match(failed.reason, /api\/render\.zz:6: the text reading declares render, which the language server reports no top-level symbol of/);
  assert.doesNotMatch(failed.reason, /declares (Row|seal|SECRET_COLUMNS)\b/, "a name the server reports is no failure");
});
