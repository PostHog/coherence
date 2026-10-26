/**
 * The parser path (syntax-trees.ts): a language read through a tree-sitter
 * parser has every reading of its text derived from one parse, read whole;
 * no hand-written reader of the same text stands beside it; a parser whose
 * queries Coherence cannot read, or one asked before the runtime starts, is
 * refused by name; and every tree is freed.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { declarationsOf, importsOf } from "../economy/source.ts";
import { forProject, registerProjectPlugins, syntaxOf } from "./languages.ts";
import type { LoadedPlugin, PluginManifest } from "./plugin.ts";
import { BUNDLED_DIR, readManifest } from "./registry.ts";
import { treeReaderOf, warmParses } from "./syntax-trees.ts";
import { Parser, Tree } from "web-tree-sitter";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

const PYTHON = join(BUNDLED_DIR, "python");

/** A plugin folder by path that reads a language "zz" through Python's parser, with the manifest and queries given. */
function parserPlugin(manifest: Partial<PluginManifest>, files: Record<string, string> = {}): LoadedPlugin {
  const dir = mkdtempSync(join(tmpdir(), "coherence-syntax-trees-"));
  fixtures.push(dir);
  copyFileSync(join(PYTHON, "tree-sitter-python.wasm"), join(dir, "zz.wasm"));
  copyFileSync(join(PYTHON, "python.scm"), join(dir, "zz.scm"));
  writeFileSync(join(dir, "resolve.ts"), "export const RESOLVE = { resolveModule: () => undefined, modulePaths: () => [] };\nexport const FACTS = { serverBounds: false, importLists: () => [] };\n");
  writeFileSync(join(dir, "index.ts"), "export default {};\n");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const full = { name: "zz", version: "0.1.0", pluginApi: 2, provides: { language: "zz" }, extensions: [".zz"], module: "./index.ts", treeSitter: { parser: "zz.wasm", queries: "zz.scm", resolve: "resolve.ts#RESOLVE" }, ...manifest };
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(full));
  return { name: "zz", version: "0.1.0", dir, source: dir, manifest: full as PluginManifest };
}

test("a plugin that names a parser and a hand-written reader of the same text is refused, naming the slot", () => {
  for (const slot of ["source", "declares", "topLevel", "kept"] as const) {
    const plugin = parserPlugin({ syntax: { [slot]: "resolve.ts#RESOLVE" } });
    const read = readManifest("zz", plugin.dir, "coherence.config.json");
    assert.equal(read.manifest, undefined, `syntax.${slot} beside a parser loads`);
    assert.ok(read.problems.some((p) => p.includes(`syntax.${slot} would read it a second time`)), read.problems.join("\n"));
  }
  assert.deepEqual(readManifest("zz", parserPlugin({}).dir, "coherence.config.json").problems, [], "a parser alone loads");

  // An interfaces table that answers the imports the parser reads is refused when the slot is first asked.
  const plugin = parserPlugin({ syntax: { interfaces: "resolve.ts#FACTS" } });
  const root = mkdtempSync(join(tmpdir(), "coherence-syntax-trees-project-"));
  fixtures.push(root);
  registerProjectPlugins(root, [plugin]);
  forProject(root, () => assert.throws(() => syntaxOf("zz", "interfaces"), /interfaces table's importLists would read its imports a second time/));
  registerProjectPlugins(root, []);
});

test("the parser reads Python's imports and declarations whole: across lines, in blocks, never inside a string or a comment", () => {
  const text = [
    '"""A module whose docstring shows an import: from fake import nothing"""',
    "from __future__ import annotations",
    "from store.secrets import (",
    "    SECRET_COLUMNS,",
    "    seal as sealed,  # renamed",
    ")",
    "import os.path, json as j",
    "from .views import render  # noqa: F401",
    "try:",
    "    from fast import loads",
    "except ImportError:",
    "    loads = None",
    "TEMPLATE = '''",
    "class Fake:",
    "    pass",
    "'''",
    "TYPES: dict[",
    "    str, int",
    "] = {}",
    "logger = make_logger()",
    "_hidden = 1",
    "@route('/x')",
    "def handler():",
    "    from lazy import thing",
    "    return thing",
    "",
  ].join("\n");
  const imports: string[] = [];
  syntaxOf("python", "source")!.importsOf(text, (name, specifier) => imports.push(`${name ?? "(module)"} <- ${specifier}`));
  assert.deepEqual(imports, ["annotations <- __future__", "SECRET_COLUMNS <- store.secrets", "seal <- store.secrets", "(module) <- os.path", "(module) <- json", "render <- .views", "loads <- fast", "thing <- lazy"]);
  assert.deepEqual(
    declarationsOf(text, "python").map((d) => `${d.name}@${d.line} ${d.exported ? "exported" : "private"} ${d.declares}`),
    ["TEMPLATE@13 exported value", "TYPES@17 exported value", "handler@23 exported body"],
    "a constant whose value starts on a later line is declared; a class inside a string is not; a module variable is bound, not declared",
  );
  const topLevel = syntaxOf("python", "topLevel")!;
  assert.ok(topLevel(text, "logger") && topLevel(text, "_hidden") && topLevel(text, "handler"), "a bound name is at the top level");
  assert.ok(!topLevel(text, "Fake") && !topLevel(text, "thing"), "a name inside a string or a function is not");
  assert.deepEqual(syntaxOf("python", "interfaces")!.importLists(text), ["seal as sealed, json as j"]);
});

test("a parser is held to what Coherence reads: a capture it reads nothing by, queries that do not compile, and a reading before the runtime starts are each refused by name", () => {
  const stray = parserPlugin({}, { "zz.scm": "(import_statement name: (dotted_name) @import.thing)\n" });
  assert.throws(() => treeReaderOf(stray), /plugin zz's queries capture @import\.thing, which Coherence reads nothing by/);
  const broken = parserPlugin({}, { "zz.scm": "(import_statement name: (no_such_node) @import.module)\n" });
  assert.throws(() => treeReaderOf(broken), /plugin zz's queries \(zz\.scm\) do not compile against its parser/);

  // A process that never started the runtime: the reading is refused saying how to start it, never read as nothing.
  const probe = `import { treeReaderOf } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    try { treeReaderOf(${JSON.stringify({ name: "zz", version: "0.1.0", dir: stray.dir, source: stray.dir, manifest: stray.manifest })}); console.log("read"); }
    catch (error) { console.log(error.message); }`;
  const said = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8" });
  assert.match(said, /plugin zz reads its language through a parser, and the parser runtime is not started: await startParsers\(\)/);
});

test("every tree a reading parses is freed before the reading returns, none left to the collector", () => {
  // Every tree a parse makes, until its delete(): web-tree-sitter frees a dropped tree only when the collector finalizes it, which a parse-heavy pass outruns.
  const live = new Set<Tree>();
  const parse = Parser.prototype.parse;
  const free = Tree.prototype.delete;
  Parser.prototype.parse = function (this: Parser, ...args: Parameters<Parser["parse"]>) {
    const tree = parse.apply(this, args);
    if (tree !== null) live.add(tree);
    return tree;
  };
  Tree.prototype.delete = function (this: Tree) {
    live.delete(this);
    free.call(this);
  };
  try {
    const reader = treeReaderOf({ name: "python", version: "0", dir: PYTHON, source: "bundled", manifest: { name: "python", version: "0", pluginApi: 2, treeSitter: { parser: "tree-sitter-python.wasm", queries: "python.scm", resolve: "python-source.ts#PYTHON_RESOLVE" } } })!;
    let parsed = 0;
    for (let i = 0; i < 20; i++) {
      // Each text differs from the last, so every reading parses: a reader keeps a few texts' matches.
      const text = `from a import (\n    b,\n)\nVALUE_${i} = ${i}\ndef f():\n    return b\n`;
      reader.imports(text);
      reader.declarations(`${text}\n`);
      reader.topLevel(`${text}\n\n`);
      parsed += 3;
      assert.equal(live.size, 0, `after ${parsed} parses, ${live.size} trees were never freed`);
    }
  } finally {
    Parser.prototype.parse = parse;
    Tree.prototype.delete = free;
  }
});

test("a project's parses are kept between processes: a later process parses only the texts that changed, and reads the rest as a fresh parse would", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-kept-parses-"));
  fixtures.push(root);
  mkdirSync(join(root, ".coherence"));
  const bare = mkdtempSync(join(tmpdir(), "coherence-no-state-"));
  fixtures.push(bare);
  // Each process: start the runtime, read the texts through Python's parser for the project, and say what it parsed and what it read.
  const pass = (at: string, changed: number | undefined): { read: number; parsed: number; imports: string[] } => {
    const probe = `import { startParsers, treeReaderOf, warmParses } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
      await startParsers();
      const plugin = ${JSON.stringify({ name: "python", version: "0", dir: PYTHON, source: "bundled", manifest: { name: "python", version: "0", pluginApi: 2, treeSitter: { parser: "tree-sitter-python.wasm", queries: "python.scm", resolve: "python-source.ts#PYTHON_RESOLVE" } } })};
      const texts = Array.from({ length: 40 }, (_, i) => "from m" + i + " import (\\n    a,\\n    b" + (i === ${changed ?? -1} ? "_changed" : "") + ",\\n)\\n");
      const counts = warmParses(plugin, ${JSON.stringify(at)}, texts);
      const imports = treeReaderOf(plugin, ${JSON.stringify(at)}).imports(texts[39]).map((i) => i.name + " <- " + i.specifier);
      console.log(JSON.stringify({ ...counts, imports }));`;
    return JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8" })) as { read: number; parsed: number; imports: string[] };
  };
  assert.deepEqual(pass(root, undefined), { read: 40, parsed: 40, imports: ["a <- m39", "b <- m39"] }, "a first process parses every text");
  // The first texts a process meets are parsed directly, so a hook that reads a file or two never loads the kept parses (DIRECT_PARSES, 16).
  assert.deepEqual(pass(root, 39), { read: 40, parsed: 17, imports: ["a <- m39", "b_changed <- m39"] }, "a later process parses only its first few texts and the one that changed");
  assert.deepEqual(pass(root, 39), { read: 40, parsed: 16, imports: ["a <- m39", "b_changed <- m39"] }, "and the changed text is kept in turn");
  assert.deepEqual(readdirSync(join(root, ".coherence", "parses", "python")).filter((f) => f.endsWith(".json")).length, 1, "one store, the log folded into it");
  pass(bare, undefined);
  assert.deepEqual(readdirSync(bare), [], "a project with no .coherence folder gains none");
});

test("an import that resolves to a module joins, of its files, those that declare the name it imports, and every one when it imports the module whole or no file declares the name", () => {
  const plugin = parserPlugin({ treeSitter: { parser: "zz.wasm", queries: "zz.scm", resolve: "module.ts#MODULE" } }, {
    "module.ts": 'export const MODULE = { resolveModule: (root, from, specifier) => (specifier === "store" ? { module: "store", files: ["store/cache.zz", "store/rows.zz", "store/secrets.zz"] } : undefined), modulePaths: () => [] };\n',
  });
  const root = mkdtempSync(join(tmpdir(), "coherence-module-imports-"));
  fixtures.push(root);
  mkdirSync(join(root, "store"));
  writeFileSync(join(root, "store", "cache.zz"), "CACHE = {}\n");
  writeFileSync(join(root, "store", "rows.zz"), "class Row:\n    pass\n");
  writeFileSync(join(root, "store", "secrets.zz"), "SECRET_COLUMNS = ['token']\n\ndef seal(row):\n    return row\n");
  registerProjectPlugins(root, [plugin]);
  try {
    forProject(root, () => {
      const joined = (text: string): string[] => importsOf(root, "api/render.zz", text, "zz").map((i) => `${i.name ?? "*"} <- ${i.module}`);
      assert.deepEqual(joined("from store import seal, SECRET_COLUMNS\n"), ["seal <- store/secrets.zz", "SECRET_COLUMNS <- store/secrets.zz"], "a name joins the file that declares it, and no other");
      assert.deepEqual(joined("from store import Row\n"), ["Row <- store/rows.zz"]);
      assert.deepEqual(joined("import store\n"), ["* <- store/cache.zz", "* <- store/rows.zz", "* <- store/secrets.zz"], "a module imported whole joins every file of it");
      assert.deepEqual(joined("from store import Missing\n"), ["Missing <- store/cache.zz", "Missing <- store/rows.zz", "Missing <- store/secrets.zz"], "a name no file declares joins every file, never a file picked for it");
    });
  } finally {
    registerProjectPlugins(root, []);
  }
});

test("a whole module the text uses names of through the name its import binds brings in those names, each joined to the module's file that declares it; one it uses no name of that way stays whole", () => {
  // Python's parser with uses captured as Go's queries capture them: an attribute of a bare name is a name used through a qualifier.
  const queries = `${readFileSync(join(PYTHON, "python.scm"), "utf8")}\n(attribute object: (identifier) @use.qualifier attribute: (identifier) @use.name)\n`;
  const files = '["store/cache.zz", "store/rows.zz", "store/secrets.zz"]';
  const bound = parserPlugin({ treeSitter: { parser: "zz.wasm", queries: "zz.scm", resolve: "module.ts#MODULE" } }, {
    "zz.scm": queries,
    "module.ts": `export const MODULE = { resolveModule: (root, from, specifier) => (specifier === "lib.store" ? { module: "store", files: ${files} } : undefined), modulePaths: () => [], boundName: (specifier) => specifier.split(".").pop() };\n`,
  });
  const unbound = parserPlugin({ treeSitter: { parser: "zz.wasm", queries: "zz.scm", resolve: "module.ts#MODULE" } }, {
    "zz.scm": queries,
    "module.ts": `export const MODULE = { resolveModule: (root, from, specifier) => (specifier === "store" ? { module: "store", files: ${files} } : undefined), modulePaths: () => [] };\n`,
  });
  const root = mkdtempSync(join(tmpdir(), "coherence-qualified-uses-"));
  fixtures.push(root);
  mkdirSync(join(root, "store"));
  writeFileSync(join(root, "store", "cache.zz"), "CACHE = {}\n");
  writeFileSync(join(root, "store", "rows.zz"), "class Row:\n    pass\n");
  writeFileSync(join(root, "store", "secrets.zz"), "SECRET_COLUMNS = ['token']\n\ndef seal(row):\n    return row\n");
  const joined = (text: string): string[] => importsOf(root, "api/render.zz", text, "zz").map((i) => `${i.name ?? "*"} <- ${i.module}`);
  const whole = ["* <- store/cache.zz", "* <- store/rows.zz", "* <- store/secrets.zz"];
  try {
    registerProjectPlugins(root, [bound]);
    forProject(root, () => {
      assert.deepEqual(joined("import lib.store\nstore.seal(store.Row())\n"), ["Row <- store/rows.zz", "seal <- store/secrets.zz"], "each name used through the name the resolution says the import binds joins the file that declares it");
      assert.deepEqual(joined("import lib.store as st\nst.seal(row)\n"), ["seal <- store/secrets.zz"], "an alias the import gives is the name it binds");
      assert.deepEqual(joined("import lib.store as st\nstore.seal(row)\n"), whole, "a use through a name the import does not bind is no use of it");
      assert.deepEqual(joined("import lib.store\nother.seal(row)\n"), whole, "a module the text uses no name of is imported whole");
    });
    registerProjectPlugins(root, [unbound]);
    forProject(root, () => assert.deepEqual(joined("import store\nstore.CACHE\n"), ["CACHE <- store/cache.zz"], "a resolution that names no binding binds the specifier's last path element"));
  } finally {
    registerProjectPlugins(root, []);
  }
});

test("the parse store never reaches past the project's own folders: a link on its path keeps no parses and touches nothing, a store or log the project brings is never read or written through, and only the store's own files are removed", () => {
  const plugin: LoadedPlugin = { name: "python", version: "0", dir: PYTHON, source: "bundled", manifest: { name: "python", version: "0", pluginApi: 2, treeSitter: { parser: "tree-sitter-python.wasm", queries: "python.scm", resolve: "python-source.ts#PYTHON_RESOLVE" } } };
  const texts = ["from a import (\n    b,\n)\n", "X = 1\n"];

  // A repository that commits .coherence/parses/python as a link to a folder outside it.
  const victim = mkdtempSync(join(tmpdir(), "coherence-victim-"));
  fixtures.push(victim);
  writeFileSync(join(victim, "id_rsa"), "secret\n");
  const linked = mkdtempSync(join(tmpdir(), "coherence-linked-"));
  fixtures.push(linked);
  mkdirSync(join(linked, ".coherence", "parses"), { recursive: true });
  symlinkSync(victim, join(linked, ".coherence", "parses", "python"));
  assert.deepEqual(warmParses(plugin, linked, texts), { read: 0, parsed: 0, skipped: true }, "a link on the store's path keeps no parses");
  assert.deepEqual(readdirSync(victim), ["id_rsa"], "the link's target is untouched");

  // A real store folder holding a forged store, a log that links out, and a file of someone else's.
  const project = mkdtempSync(join(tmpdir(), "coherence-forged-"));
  fixtures.push(project);
  const store = join(project, ".coherence", "parses", "python");
  mkdirSync(store, { recursive: true });
  const reader = treeReaderOf(plugin, project)! as ReturnType<typeof treeReaderOf> & { keyOf(text: string): string };
  const elsewhere = join(victim, "appended");
  writeFileSync(elsewhere, "");
  // The forged store names a text's digest with a made-up import; the log links to a file outside the project.
  const forgedKey = reader.keyOf(texts[0]!);
  const names = (): string[] => readdirSync(store).sort();
  writeFileSync(join(store, "notes.txt"), "someone else's\n");
  const first = warmParses(plugin, project, texts);
  assert.deepEqual(first, { read: 2, parsed: 2 });
  const [own] = names().filter((n) => n.endsWith(".json"));
  assert.ok(own !== undefined, names().join(", "));
  const fp = own.slice(0, -".json".length);
  writeFileSync(join(store, own), JSON.stringify({ [forgedKey]: [[["import.from", "forged", 1], ["import.name", "made_up", 1]]] }));
  symlinkSync(elsewhere, join(store, `${fp}.added.jsonl`));
  // A fresh process's reader: the unsigned store is never read, so the text is parsed again and reads what it holds.
  const probe = `import { startParsers, treeReaderOf } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    await startParsers();
    const reader = treeReaderOf(${JSON.stringify(plugin)}, ${JSON.stringify(project)});
    const texts = Array.from({ length: 20 }, (_, i) => "Y" + i + " = 1\\n");
    for (const text of texts) reader.imports(text);
    console.log(JSON.stringify(reader.imports(${JSON.stringify(texts[0])}).map((i) => i.name + " <- " + i.specifier)));`;
  const said = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(said), ["b <- a"], "a store the project brings, unsigned, is never read");
  assert.equal(readFileSync(elsewhere, "utf8"), "", "nothing is appended through a link");
  assert.ok(names().includes("notes.txt"), "a file that is not the store's own is never removed");
});
