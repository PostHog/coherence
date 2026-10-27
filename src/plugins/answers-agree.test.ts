/**
 * plugin check's "answers agree" duty: two readings that answer one question
 * of the same text are run over the check project and held to agree, so a
 * reader that misses what another reads is caught on the plugin's own
 * project (df-7ac38ee4, Python's two hand-written import readers). The
 * parser derives every reading of the text from one parse, and a plugin's
 * interfaces table states no reading of it (languages.ts statedFacts), so
 * what the duty still finds is queries that read a declaration by what
 * surrounds it, which the same queries over its line alone read otherwise.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkPlugin } from "./check.ts";
import { writeParserPlugin } from "./fixtures/parser-plugin.ts";
import { BUNDLED_DIR } from "./registry.ts";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in server that reports, of each file, the top-level symbols given. */
function standIn(symbols: Record<string, string[]>): string {
  return `const SYMBOLS = ${JSON.stringify(symbols)};\nexport default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), topLevelSymbols: async (file) => (SYMBOLS[file] ?? []).map((name) => ({ name, line: 1, kind: 12 })), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => via, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n`;
}

const SECRETS = "SECRET_COLUMNS = []\n\ndef seal(row):\n    return row\n";

/** Python's queries, as the bundled plugin reads Python. */
const PYTHON_QUERIES = readFileSync(join(BUNDLED_DIR, "python", "python.scm"), "utf8");
const DECORATED = "(module (decorated_definition definition: [(function_definition name: (identifier) @name) (class_definition name: (identifier) @name)]) @declaration.body)";

/** A plugin by path reading zz through Python's parser and the queries given, its interfaces table's facts, its server and its check project's render file as given. */
function parserPlugin(render: string, queries: string, symbols: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-answers-agree-"));
  fixtures.push(root);
  writeParserPlugin(join(root, "zz"), { syntax: { interfaces: "facts.ts#FACTS" } }, {
    "index.ts": standIn(symbols),
    "zz.scm": queries,
    "facts.ts": "export const FACTS = { serverBounds: false };\n",
    "check.json": JSON.stringify({
      files: { "api/render.zz": render, "store/secrets.zz": SECRETS },
      language: { files: ["api/render.zz", "store/secrets.zz"], not: [] },
      declarations: [{ file: "store/secrets.zz", name: "seal", declared: true }],
      protects: "SECRET_COLUMNS", chokepoint: "seal", references: [], grade: "reference-choked", bypasses: [],
    }),
  });
  return root;
}

const RENDER = "from store.secrets import SECRET_COLUMNS, seal as sealed\n\n@dataclass\nclass Row:\n    pass\n\ndef render(row):\n    return sealed(row)\n";
const EVERY_SYMBOL = { "store/secrets.zz": ["SECRET_COLUMNS", "seal"], "api/render.zz": ["Row", "render"] };

test("plugin check fails a plugin whose two readings of one text disagree: queries that read a declaration's kind from what surrounds it, so its line read alone says otherwise, named by file and name", async () => {
  // A decorated class declares a type, and an undecorated one a body: the whole text reads Row as a type, its line alone as a body.
  assert.ok(PYTHON_QUERIES.includes(DECORATED), "the queries the test changes are Python's");
  const contextual = PYTHON_QUERIES.replace(DECORATED, "(module (decorated_definition definition: (function_definition name: (identifier) @name)) @declaration.body)\n(module (decorated_definition definition: (class_definition name: (identifier) @name)) @declaration.type)");
  const split = parserPlugin(RENDER, contextual, EVERY_SYMBOL);
  const failed = (await checkPlugin(split, "./zz")).duties.find((d) => d.name === "answers agree")!;
  assert.equal(failed.verdict, "fail", failed.reason);
  assert.match(failed.reason, /api\/render\.zz:4: interfaces reads Row's line as no type declaration, declares as type/);
  assert.doesNotMatch(failed.reason, /render\.zz:7|secrets\.zz/, "a line both read alike is no failure");

  // Python's own queries read a decorated class as its line alone reads it, and the answers agree.
  const agreeing = parserPlugin(RENDER, PYTHON_QUERIES, EVERY_SYMBOL);
  const agreed = (await checkPlugin(agreeing, "./zz")).duties.find((d) => d.name === "answers agree")!;
  assert.equal(agreed.verdict, "pass", agreed.reason);
});

test("plugin check fails a plugin whose text reading declares a name the language server reports no top-level symbol of, named by file and line", async () => {
  // The parser declares render; a server whose account lacks it reports no such symbol.
  const misread = parserPlugin(RENDER, PYTHON_QUERIES, { "store/secrets.zz": ["SECRET_COLUMNS", "seal"], "api/render.zz": ["Row"] });
  const failed = (await checkPlugin(misread, "./zz")).duties.find((d) => d.name === "server agrees")!;
  assert.equal(failed.verdict, "fail", failed.reason);
  assert.match(failed.reason, /api\/render\.zz:7: the text reading declares render, which the language server reports no top-level symbol of/);
  assert.doesNotMatch(failed.reason, /declares (Row|seal|SECRET_COLUMNS)\b/, "a name the server reports is no failure");
});
