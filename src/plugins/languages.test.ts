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
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";
import { isTestPath } from "../adapters/adapter.ts";
import { instrumentFor } from "../adapters/index.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { BUNDLED_DIR } from "./registry.ts";
import { moduleSpecifiers } from "./specifiers.ts";
import { ciNotes, ciSteps, entranceRules, environmentFolders, forProject, LANGUAGES, languageOfFile, providerOf, serverExtensions, syntaxOf } from "./languages.ts";
import { loadSpecModel } from "../spec/model.ts";

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
 * What a core module may spell of a language, each narrowly, by file and the
 * exact text, and why: Coherence's handling of its own TypeScript sources
 * (it is built from them), a program's name that is a language's too, and
 * the language knowledge still in the core, listed until each moves into its
 * plugin (docs/plugins.md, Not yet). Anything else is a finding.
 */
const ALLOWED: readonly { file: string; texts: readonly string[]; why: string }[] = [
  { file: "src/adapters/declared-config.ts", texts: ['"python"'], why: "the interpreter's program name, one of the runners a declared server is started through" },
  { file: "src/build.ts", texts: ['/(from\\s+["\']\\.{1,2}\\/[^"\']+)\\.ts(["\'])/g', "/\\.(test|e2e)\\.ts$/", '".ts"', '/((?:\\bfrom|\\bimport)\\s*\\(?\\s*["\']\\.{1,2}\\/[^"\']+)\\.ts(["\'])/g', "/\\.ts$/", '".js"', '/("[A-Za-z]+":\\s*"[^"#/]+)\\.ts(["#])/g'], why: "Coherence's own build compiles its own TypeScript sources" },
  { file: "src/plugins/eject.ts", texts: ["/\\.[cm]?[jt]sx?$/"], why: "an eject rewrites the bundled plugins' sources, Coherence's own TypeScript" },
  { file: "src/plugins/specifiers.ts", texts: ['"typescript"'], why: "the TypeScript compiler's package, which reads the imports of the bundled plugins' sources, Coherence's own TypeScript" },
  { file: "src/enforcement/code-fingerprint.ts", texts: ["/\\.(ts|mts|cts|js|mjs|cjs|json)$/", "/\\.js$/", "/\\.ts$/"], why: "the identity of Coherence's own code, its sources or the compiled modules" },
  { file: "src/readings/scope/build.ts", texts: ["/\\.ts$/", '".js"'], why: "the Scope page is built from Coherence's own TypeScript sources" },
  { file: "src/enforcement/check.ts", texts: ["/^(.*)\\/(?:__init__\\.py|mod\\.rs)$/", "/^((?:.*\\/)?src)\\/(?:lib|main)\\.rs$/", "/^(.*)\\.rs$/"], why: "not yet a plugin's: which files a module owns (a Python package's __init__, a Rust module's folder)" },
  { file: "src/lifecycle/check.ts", texts: ['".ts"', '".tsx"', '".js"', '".jsx"', '".mjs"', '".cjs"', '".mts"', '".cts"', '".py"', '".rs"'], why: "not yet a plugin's: the vocabulary check's list of code extensions, which names many languages besides the bundled ones" },
  { file: "src/lifecycle/mirrors.ts", texts: ["/\\.[cm]?js$/", "/\\.([cm]?)js$/", "/\\.js$/", '".tsx"'], why: "not yet a plugin's: how a declared mirror's import closure resolves a TypeScript specifier" },
  { file: "src/readings/mirrors/mirrors.ts", texts: ["/\\.(test|e2e)\\.[cm]?[tj]s$|fixture/", "/\\.(ts|mts|cts|js|mjs|cjs)$/", "/\\.[cm]?js$/", "/\\.js$/", '".ts"'], why: "not yet a plugin's: the mirror reading parses TypeScript and JavaScript with the TypeScript compiler" },
  { file: "src/observation/map.ts", texts: ['/^(?:\\s*File "([^"]+)", line (\\d+)|([^\\s:]+\\.py):(\\d+):)/'], why: "not yet a plugin's: the observation reads a Python traceback's frames" },
  { file: "src/adapters/entrance-candidates.ts", texts: ["/\\.(ts|tsx|mts|cts|js|mjs|cjs|py)$/"], why: "not yet a plugin's: the package-script rule's list of the files a runner it follows can run" },
];

/** The file extensions the bundled plugins' languages are written in, as a string spells one (".rs"). */
const EXTENSIONS: ReadonlySet<string> = new Set(LANGUAGES.flatMap((language) => [...serverExtensions(language)]));

/** A regular expression's source that matches one of those extensions: an escaped dot before a language's stem or character class (\.py, \.(?:[cm]?[tj]sx?), \.rs). */
const EXTENSION_PATTERN = /\\\.\(?(?:\?:)?(?:pyi?|rs|\[(?:cm|mc)\]\??|\[(?:tj|jt)\]|[cm]?[tj]sx?)(?![A-Za-z])/;

/** Where a source names a language or reaches into a plugin: string literals and property names spelling a language or one of its file extensions, regular expressions matching one, and module specifiers into plugins/. */
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
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !specifiers.has(node)) {
      if (languages.includes(node.text)) found.push(`${at(node)} names "${node.text}"`);
      else if (EXTENSIONS.has(node.text)) found.push(`${at(node)} names the extension "${node.text}"`);
      else if (EXTENSION_PATTERN.test(node.text)) found.push(`${at(node)} spells a pattern for a language's files: "${node.text}"`);
    }
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral && EXTENSION_PATTERN.test(node.getText(source))) found.push(`${at(node)} matches a language's files: ${node.getText(source)}`);
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
    // A finding ends with the text it found, quoted or as the regular expression: allowed only when its file lists exactly that text.
    return namings(file, readFileSync(file, "utf8"), LANGUAGES).filter((line) => !ALLOWED.some((a) => rel === a.file && a.texts.some((text) => line.endsWith(` ${text}`))));
  });
  assert.deepEqual(found, [], "a language is its plugin's: ask src/plugins/languages.ts, never branch on a name");
  // The scan sees each shape it refuses.
  const shapes = namings(join(SRC, "x.ts"), `import { RustAdapter } from "../plugins/rust/rust.ts";\nconst t = { python: 1 };\nif (l === "typescript") {}\nconst ok = await import("typescript");\nconst rust = file.endsWith(".rs");\nconst py = /\\.py$/.test(file);\nconst ts = /\\.(?:[cm]?[tj]sx?)$/;\n`, LANGUAGES);
  assert.equal(shapes.length, 6, shapes.join("\n"));
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

test("a plugin that provides a language no bundled plugin does is read as a bundled one is, for its project alone: its files, tests, folders, entrance rules, CI steps and syntax slots; a language nothing provides is refused by the spec check as by a run", () => {
  const zz = (fields: Record<string, unknown> = {}): Record<string, string> => ({
    "plugins/zz/plugin.json": JSON.stringify({
      name: "zz",
      version: "0.1.0",
      pluginApi: 2,
      provides: { language: "zz" },
      module: "./index.ts",
      extensions: [".zz"],
      testFiles: ["_check\\.zz$"],
      environmentFolders: ["zzdeps"],
      entrances: { rules: [{ rule: "zz verb", plural: "zz verbs", detects: "a verb a zz file exports" }], notDetected: "a zz verb built at run time" },
      ci: { note: "zz needs its server", steps: [{ name: "zz server", run: "install-zz-server" }] },
      syntax: { topLevel: "top.ts#zzDeclaresAtTop" },
      ...fields,
    }),
    "plugins/zz/index.ts": swapPlugin("zz", "zz", {})["plugins/zz/index.ts"]!,
    "plugins/zz/top.ts": "export const zzDeclaresAtTop = (text, name) => text.split(\"\\n\").includes(`verb ${name}`);\n",
  });
  const root = project({
    "coherence.config.json": JSON.stringify({ language: ["zz"], plugins: { zz: "./plugins/zz" } }),
    ...zz(),
    "app/Accounts.spec.md": "# Accounts\n\nThe accounts.\n\n## entrances\n- reset: an operator resets a password\n  handler: reset in app/accounts.zz\n- rename: an operator renames an account\n  handler: rename in app/accounts.zz\n",
    "app/accounts.zz": "verb reset\n",
  });
  const config = readEnforcementConfig(root);
  assert.deepEqual(config.languages, ["zz"], "the plugin's language is among those the readings read, not set aside as unscanned");
  assert.doesNotThrow(() => readEnforcementConfig(root), "reading the config again never takes the plugin for another owner of its own .zz");
  assert.equal(languageOfFile("app/accounts.zz"), "zz", "its files are its extensions'");
  assert.ok(isTestPath("app/accounts_check.zz", []), "its testFiles name its tests");
  assert.ok(environmentFolders().has("zzdeps"), "its environment folders are left out of every walk");
  assert.deepEqual(entranceRules("zz").map((r) => r.rule), ["zz verb"], "its entrance rules are the language's");
  assert.deepEqual([ciNotes(["zz"]), ciSteps(["zz"])], [["zz needs its server"], [{ name: "zz server", run: "install-zz-server" }]], "the CI workflow carries its note and its steps");
  assert.equal(syntaxOf("zz", "topLevel")?.("verb reset\n", "reset"), true, "its syntax slot answers for it");
  const problems = loadSpecModel(root, { runs: false }).problems.map((p) => p.message).filter((m) => /entrance/.test(m));
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0]!, /entrance rename: handler rename is not declared at the top level of app\/accounts\.zz/, "the spec check reads its handlers by the plugin's slot: one declared, one not");

  const bare = project({ "coherence.config.json": JSON.stringify({ language: "typescript" }) });
  readEnforcementConfig(bare);
  assert.equal(languageOfFile("app/accounts.zz"), undefined, "a project that does not name the plugin reads none of it");
  assert.equal(forProject(root, () => languageOfFile("app/accounts.zz")), "zz", "while the one that does still reads it");

  const taken = project({ "coherence.config.json": JSON.stringify({ language: ["zz"], plugins: { zz: "./plugins/zz" } }), ...zz({ extensions: [".zz", ".py"] }) });
  assert.throws(() => readEnforcementConfig(taken), /plugin zz claims \.py, which python already reads/, "a bundled language's files are never a new language's");

  const unnamed = project({ "coherence.config.json": JSON.stringify({ language: "zz" }) });
  assert.deepEqual(
    loadSpecModel(unnamed, { runs: false }).problems.map((p) => p.message).filter((m) => /language names/.test(m)).map((m) => m.replace(/^.*?: language/, "language")),
    ['language names "zz"; each is one of typescript, python, rust, a language declared under languages, or one a plugin named under plugins provides (docs/plugins.md)'],
    "the spec check refuses the language a run refuses, and names the plugin route",
  );
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

/** A plugin that provides `language` in a bundled one's place, with an adapter that answers nothing, and the manifest fields given. */
function swapPlugin(name: string, language: string, fields: Record<string, unknown>): Record<string, string> {
  return {
    [`plugins/${name}/plugin.json`]: JSON.stringify({ name, version: "0.1.0", pluginApi: 1, provides: { language }, module: "./index.ts", ...fields }),
    [`plugins/${name}/index.ts`]: 'export default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => via, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n',
  };
}

test("a plugin that names its files in a bundled language's place owns its whole file rule: its extensions are the language's, never the bundled pattern's", () => {
  const root = project({ "coherence.config.json": JSON.stringify({ language: "typescript", plugins: { svelte: "./plugins/svelte" } }), ...swapPlugin("svelte", "typescript", { extensions: [".ts", ".svelte"] }) });
  readEnforcementConfig(root);
  assert.equal(languageOfFile("src/App.svelte"), "typescript", "the file it adds is the language's");
  assert.equal(languageOfFile("src/app.ts"), "typescript");
  assert.equal(languageOfFile("src/app.tsx"), undefined, "the bundled pattern stands behind none of it: the rule is one rule");
});

test("each project's plugins answer for it alone: two projects in one process, their work interleaved, each read through its own", async () => {
  const swapped = project({ "coherence.config.json": JSON.stringify({ language: "python", plugins: { pyx: "./plugins/pyx" } }), ...swapPlugin("pyx", "python", { extensions: [".py", ".pyx"] }) });
  const bare = project({ "coherence.config.json": JSON.stringify({ language: "python" }) });
  readEnforcementConfig(swapped);
  readEnforcementConfig(bare);
  const tick = (): Promise<void> => new Promise((done) => setImmediate(done));
  const asked = await Promise.all(
    [swapped, bare, swapped].map((root) =>
      forProject(root, async () => {
        await tick();
        const file = languageOfFile("m.pyx");
        await tick();
        return { file, provider: providerOf("python")?.name };
      }),
    ),
  );
  assert.deepEqual(asked, [
    { file: "python", provider: "pyx" },
    { file: undefined, provider: "python" },
    { file: "python", provider: "pyx" },
  ]);
  assert.equal(providerOf("python")?.name, "python", "outside forProject, the project read last: the bare one");
});

test("a session start names each plugin the project brings whose syntax code runs in its hooks, once, and says nothing of the bundled ones or of a plugin with no syntax code", async () => {
  const { startReading } = await import("../lifecycle/hook.ts");
  const withSyntax = project({
    "coherence.config.json": JSON.stringify({ language: "python", plugins: { pyx: "./plugins/pyx" } }),
    ...swapPlugin("pyx", "python", { syntax: { source: "source.ts#SOURCE" } }),
    "plugins/pyx/source.ts": "export const SOURCE = { declarationOf: () => undefined, resolveModule: () => undefined, importsOf: () => {} };\n",
  });
  const said = (await startReading(withSyntax)).text;
  assert.match(said, /^Plugin code in this session's hooks: pyx \(\.\/plugins\/pyx: source\) runs as a reading reads its language, with the project's privileges\.$/m, said);
  assert.equal(said.match(/Plugin code in this session's hooks/g)?.length, 1, "one line");
  const adapterOnly = project({ "coherence.config.json": JSON.stringify({ language: "python", plugins: { pyx: "./plugins/pyx" } }), ...swapPlugin("pyx", "python", {}) });
  assert.doesNotMatch((await startReading(adapterOnly)).text, /Plugin code in this session's hooks/, "a plugin whose code runs only in a run and the warm server");
  const bare = project({ "coherence.config.json": JSON.stringify({ language: ["typescript", "python", "rust"] }) });
  assert.doesNotMatch((await startReading(bare)).text, /Plugin code in this session's hooks/, "the bundled plugins are the package itself");
});

test("a session start names each plugin written for an older pluginApi with what changed since, in one line, and nothing for one on the current interface", async () => {
  const { startReading } = await import("../lifecycle/hook.ts");
  const { PLUGIN_API } = await import("./plugin.ts");
  const at = (pluginApi: number): string =>
    project({
      "coherence.config.json": JSON.stringify({ language: "python", plugins: { pyx: "./plugins/pyx" } }),
      ...swapPlugin("pyx", "python", { pluginApi }),
    });
  const older = (await startReading(at(PLUGIN_API - 1))).text;
  assert.match(older, new RegExp(`^Plugins written for an older pluginApi \\(this Coherence runs ${PLUGIN_API}\\): pyx \\(${PLUGIN_API - 1}; since: ${PLUGIN_API}: syntax slots moved from the module's syntax export to plugin\\.json[^\\n]*\\)\\.$`, "m"), older);
  assert.equal(older.match(/older pluginApi/g)?.length, 1, "one line");
  assert.doesNotMatch((await startReading(at(PLUGIN_API))).text, /older pluginApi/, "a plugin on the interface this Coherence runs");
});

test("a module written for pluginApi 1 that exports its syntax is refused by name at load, never silently ignored", async () => {
  const { pluginAt } = await import("./check.ts");
  const { moduleOf, moduleSyncOf, PluginRefused } = await import("./registry.ts");
  const root = project(swapPlugin("pyx", "python", {}));
  writeFileSync(join(root, "plugins/pyx/index.ts"), "export default { adapter: () => undefined, syntax: { source: {} } };\n");
  const plugin = pluginAt(root, "./plugins/pyx");
  const named = (e: unknown): boolean => e instanceof PluginRefused && /plugin pyx's module exports syntax, which this Coherence does not read: name each slot in plugin\.json as "syntax"/.test(e.message);
  assert.throws(() => moduleSyncOf(plugin), named);
  await assert.rejects(moduleOf(plugin), named);
});

test("the bundled plugins reach the core only through the plugin interface, src/plugins/api.ts, which @posthog/coherence/plugin is", () => {
  const reaching: string[] = [];
  // Every specifier as the parser reads it (moduleSpecifiers): a static import, an export from, a dynamic import() and a require() alike.
  for (const name of readdirSync(PLUGINS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    for (const file of readdirSync(join(PLUGINS, name), { recursive: true }).map(String).filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
      const text = readFileSync(join(PLUGINS, name, file), "utf8");
      const from = posix.dirname(file.split(sep).join("/"));
      for (const { text: specifier } of moduleSpecifiers(file, text)) {
        if (specifier === "../../src/plugins/api.ts" && from === ".") continue;
        if (specifier.startsWith(".") && posix.normalize(posix.join(from, specifier)).startsWith("..")) reaching.push(`plugins/${name}/${file} imports ${specifier}`);
      }
    }
  }
  assert.deepEqual(reaching, [], "an ejected copy reaches Coherence only through the package's plugin interface; export what a plugin needs from src/plugins/api.ts");
  const pkg = JSON.parse(readFileSync(join(PLUGINS, "..", "package.json"), "utf8")) as { exports: Record<string, { default: string }> };
  assert.equal(pkg.exports["./plugin"]!.default, "./dist/plugins/api.js", "the package's plugin export is that module");
});
