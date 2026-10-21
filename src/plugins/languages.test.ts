/**
 * The core's languages are the bundled plugins' (src/plugins/languages.ts):
 * the core names no language and reaches no plugin's code except through the
 * registry; a project with no plugins key reads every language through the
 * bundled plugins, and one that names a plugin providing a language reads it
 * through that one, with the bundled plugin's data and syntax behind
 * whatever it leaves out; and a plugin adapter's test filter is its own from
 * the first ask.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";
import { isTestPath } from "../adapters/adapter.ts";
import { instrumentFor } from "../adapters/index.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { BUNDLED_DIR } from "./registry.ts";
import { LANGUAGES, languageOfFile, providerOf, syntaxOf } from "./languages.ts";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS = resolve(SRC, "..", "plugins");
const fixtures: string[] = [];

after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-languages-"));
  fixtures.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Every source file the core runs: src, tests and fixtures aside. */
function coreSources(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "fixtures" && entry.name !== "fonts") coreSources(path, into);
    } else if (entry.name.endsWith(".ts") && !/\.(test|e2e)\.ts$/.test(entry.name) && !/fixture/.test(entry.name)) into.push(path);
  }
  return into;
}

/**
 * The one string a core module may spell as a language's name, and why: a
 * program's name that happens to be the language's (the interpreter a
 * declared language's server may be run by), never a branch on a language.
 */
const ALLOWED: readonly { file: string; text: string; why: string }[] = [{ file: "src/adapters/declared-config.ts", text: "python", why: "the interpreter's program name, one of the runners a declared server is started through" }];

/** Where a source names a language or reaches into a plugin: string literals and property names spelling a language, and module specifiers into plugins/. */
function namings(file: string, text: string, languages: readonly string[]): string[] {
  const found: string[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node): string => `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const specifiers = new Set<ts.Node>();
  const reaches = (node: ts.Node, specifier: string): void => {
    if (!specifier.startsWith(".")) return;
    const target = resolve(dirname(file), specifier);
    if (target === PLUGINS || target.startsWith(`${PLUGINS}/`)) found.push(`${at(node)} imports ${specifier}, a plugin's code, not through the registry`);
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier);
      reaches(node, node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] !== undefined && ts.isStringLiteral(node.arguments[0])) {
      specifiers.add(node.arguments[0]);
      reaches(node, node.arguments[0].text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifiers.add(node.argument.literal);
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !specifiers.has(node) && languages.includes(node.text)) found.push(`${at(node)} names "${node.text}"`);
    if ((ts.isPropertyAssignment(node) || ts.isPropertySignature(node) || ts.isShorthandPropertyAssignment(node)) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && languages.includes(node.name.text)) found.push(`${at(node)} keys ${node.name.text}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test("the core names no language and reaches no plugin's code but through the registry: no string or key spelling a language a bundled plugin provides, no import into plugins/", () => {
  assert.ok(LANGUAGES.length > 0, "the bundled plugins provide languages");
  const found = coreSources(SRC).flatMap((file) => {
    const rel = relative(resolve(SRC, ".."), file);
    return namings(file, readFileSync(file, "utf8"), LANGUAGES).filter((line) => !ALLOWED.some((a) => rel === a.file && line.includes(`"${a.text}"`)));
  });
  assert.deepEqual(found, [], "a language is its plugin's: ask src/plugins/languages.ts, never branch on a name");
  // The scan sees each shape it refuses.
  const shapes = namings(join(SRC, "x.ts"), `import { RustAdapter } from "../plugins/rust/rust.ts";\nconst t = { python: 1 };\nif (l === "typescript") {}\nconst ok = await import("typescript");\n`, LANGUAGES);
  assert.equal(shapes.length, 3, shapes.join("\n"));
});

test("a project with no plugins key reads every language through the bundled plugins, and a plugin that provides one takes its place with the bundled plugin's data and syntax behind what it leaves out", () => {
  const bare = project({ "coherence.config.json": JSON.stringify({ language: ["typescript", "python", "rust"] }) });
  const config = readEnforcementConfig(bare);
  assert.deepEqual(config.plugins, [], "no plugin is the project's own");
  for (const language of LANGUAGES) assert.equal(providerOf(language)?.dir, join(BUNDLED_DIR, language), `${language} is the bundled plugin's`);
  assert.deepEqual(["a.ts", "a.d.ts", "b.pyi", "c.rs", "d.swift"].map((f) => languageOfFile(f) ?? null), ["typescript", null, "python", "rust", null], "which files are a language's is each plugin's manifest data");
  assert.equal(instrumentFor("python", bare, config).constructor.name, "PythonAdapter", "the adapter is the bundled plugin's");
  assert.equal(typeof syntaxOf("typescript", "source")?.declarationOf, "function");

  const swapped = project({
    "coherence.config.json": JSON.stringify({ language: ["python"], plugins: { py: "./plugins/py" } }),
    "plugins/py/plugin.json": JSON.stringify({ name: "py", version: "0.1.0", pluginApi: 1, provides: { language: "python" }, module: "./index.ts", testFiles: ["^check_.*\\.py$"] }),
    "plugins/py/index.ts": 'export default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => `-k ${via}`, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n',
  });
  readEnforcementConfig(swapped);
  assert.equal(providerOf("python")?.name, "py", "the project's plugin takes python's place");
  assert.equal(languageOfFile("x.py"), "python", "its files are the bundled plugin's, which it does not restate");
  assert.equal(typeof syntaxOf("python", "source")?.declarationOf, "function", "the bundled plugin's source scan stands behind it");
  assert.ok(isTestPath("src/check_x.py", []), "a field it declares is its own");
  assert.ok(!isTestPath("src/test_x.py", []), "and replaces the bundled plugin's");
  readEnforcementConfig(bare);
  assert.equal(providerOf("python")?.dir, join(BUNDLED_DIR, "python"), "a project that names none reads the bundled one again");
});

test("a plugin adapter's test filter is its own from the first ask, before any question has loaded its module", async () => {
  const root = project({
    "coherence.config.json": JSON.stringify({ language: "typescript", plugins: { filtered: "./plugins/filtered" } }),
    "plugins/filtered/plugin.json": JSON.stringify({ name: "filtered", version: "0.1.0", pluginApi: 1, extends: "typescript", module: "./index.ts" }),
    "plugins/filtered/index.ts": "export default { adapter: ({ base }) => ({ ...base, language: base.language, ladder: base.ladder, testFilter: (via) => `-k ${via}`, close: async () => {} }) };\n",
  });
  const adapter = instrumentFor("typescript", root, readEnforcementConfig(root));
  try {
    assert.equal(adapter.testFilter("the property holds"), "-k the property holds", "the plugin's filter, not the wrapped adapter's or the name as written");
  } finally {
    await adapter.close();
  }
});
