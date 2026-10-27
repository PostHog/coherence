/**
 * The parser path (syntax-trees.ts): a language read through a tree-sitter
 * parser has every reading of its text derived from one parse, read whole;
 * no hand-written reader of the same text stands beside it; a parser whose
 * queries Coherence cannot read, or one asked before the runtime starts, is
 * refused by name; and every tree is freed.
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { declarationsOf, importsOf } from "../economy/source.ts";
import { forProject, parsedOf, registerProjectPlugins, repeatedAnswers, sourceProvider, syntaxOf } from "./languages.ts";
import { DERIVED_SLOTS, OLDEST_PLUGIN_API, PLUGIN_API, type LoadedPlugin, type PluginManifest } from "./plugin.ts";
import { writeParserPlugin } from "./fixtures/parser-plugin.ts";
import { BUNDLED_DIR, readManifest, readPlugins } from "./registry.ts";
import { fingerprintOf, importShapes, KEPT_FROM, keptParseOf, staleParsesNotice, treeReaderOf, warmParses } from "./syntax-trees.ts";
import { warmProjectParses } from "../economy/warm-parses.ts";
import { Parser, Tree } from "web-tree-sitter";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

const PYTHON = join(BUNDLED_DIR, "python");
const DOCS = readFileSync(resolve("docs/plugins.md"), "utf8");

/** The Python plugin as the store's tests read it, by path. */
const PY_PLUGIN: LoadedPlugin = { name: "python", version: "0", dir: PYTHON, source: "bundled", manifest: { name: "python", version: "0", pluginApi: 2, treeSitter: { parser: "tree-sitter-python.wasm", queries: "python.scm", resolve: "python-source.ts#PYTHON_RESOLVE" } } };

/** The user's cache folder of the Python plugin's kept parses, as this test file's processes keep them (the leak guard's XDG_CACHE_HOME). */
function pythonStore(): string {
  return join(process.env["XDG_CACHE_HOME"]!, "coherence", "parses", fingerprintOf(PYTHON, PY_PLUGIN.manifest.treeSitter!));
}

/** The kept parses a store folder holds now, each a file under the folder of its key's first two digits. */
function keptIn(store: string): string[] {
  if (!existsSync(store)) return [];
  return readdirSync(store)
    .filter((shard) => /^[0-9a-f]{2}$/.test(shard))
    .flatMap((shard) => readdirSync(join(store, shard)).filter((name) => /^[0-9a-f]{30}$/.test(name)).map((name) => join(store, shard, name)))
    .sort();
}

/** A text's kept parse's file in a store folder. */
function keptFile(store: string, text: string): string {
  const key = createHash("sha256").update(text).digest("hex").slice(0, 32);
  return join(store, key.slice(0, 2), key.slice(2));
}

/** Run a script in a fresh process with the parser runtime started, the store's module and the Python plugin in scope; its stdout. */
function inProcess(body: string, env: NodeJS.ProcessEnv = process.env): string {
  const probe = `import { startParsers, treeReaderOf, warmParses, staleParsesNotice } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    await startParsers();
    const plugin = ${JSON.stringify(PY_PLUGIN)};
    ${body}`;
  return execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8", env, timeout: 60_000 });
}

/** A plugin folder by path that reads a language "zz" through Python's parser, with the manifest and files given. */
function parserPlugin(manifest: Record<string, unknown>, files: Record<string, string> = {}): LoadedPlugin {
  const dir = mkdtempSync(join(tmpdir(), "coherence-syntax-trees-"));
  fixtures.push(dir);
  const full = writeParserPlugin(dir, manifest, files);
  return { name: "zz", version: "0.1.0", dir, source: dir, manifest: full };
}

/** Where the refusal of a hand-written reader puts each recovery: the ejected copy's first, then the parser path for a plugin written from scratch. */
function recoveries(problem: string): { eject: number; parser: number } {
  return { eject: problem.indexOf("coherence plugin eject"), parser: problem.indexOf("docs/plugins.md, Reading through a parser") };
}

test("a manifest that fills a hand-written reader slot (source, declares, topLevel or kept) never loads, whatever pluginApi it is written for and whether or not it names a parser, so no reading of the core can meet one: one refusal names every such slot, the eject to redo first and the parser to read through", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-syntax-trees-project-"));
  fixtures.push(root);
  for (const pluginApi of [OLDEST_PLUGIN_API, PLUGIN_API - 1, PLUGIN_API])
    for (const slot of DERIVED_SLOTS)
      for (const parser of [true, false]) {
        const plugin = parserPlugin({ pluginApi, syntax: { [slot]: "resolve.ts#RESOLVE" }, ...(parser ? {} : { treeSitter: undefined }) });
        const what = `syntax.${slot} at pluginApi ${pluginApi}${parser ? " beside a parser" : ""}`;
        const read = readManifest("zz", plugin.dir, "coherence.config.json");
        assert.equal(read.manifest, undefined, `${what} reads as a manifest`);
        assert.equal(read.problems.length, 1, `${what}: ${read.problems.join("\n")}`);
        const [problem] = read.problems as [string];
        assert.ok(problem.startsWith(`coherence.config.json: plugin zz's syntax.${slot} is a hand-written reader of its language's text, which this Coherence does not read (pluginApi 4 removed them)`), problem);
        const at = recoveries(problem);
        assert.ok(at.eject >= 0 && at.parser > at.eject, `${what}: the eject to redo is named before the parser path: ${problem}`);
        // Through the path every project's config takes: no plugin comes back for any reading to ask.
        const loaded = readPlugins(root, { zz: plugin.dir }, "coherence.config.json", [], () => undefined);
        assert.deepEqual(loaded.plugins, [], `${what} loads through the config`);
        assert.deepEqual(loaded.problems, [problem], what);
      }
  assert.ok(DOCS.includes("\n### Reading through a parser\n"), "the section the refusal names is docs/plugins.md's");
  // Every slot one fills is named in its one refusal.
  const three = readManifest("zz", parserPlugin({ treeSitter: undefined, syntax: { source: "resolve.ts#RESOLVE", declares: "resolve.ts#RESOLVE", topLevel: "resolve.ts#RESOLVE" } }).dir, "coherence.config.json").problems;
  assert.equal(three.length, 1, three.join("\n"));
  assert.match(three[0]!, /plugin zz's syntax\.source, syntax\.declares and syntax\.topLevel are hand-written readers/);
  // An extending plugin wraps no reader either.
  const extending = parserPlugin({ provides: undefined, extends: "typescript", treeSitter: undefined, syntax: { source: "resolve.ts#RESOLVE" } });
  assert.match(readManifest("zz", extending.dir, "coherence.config.json").problems.join("\n"), /plugin zz's syntax\.source is a hand-written reader/);
  assert.deepEqual(readManifest("zz", parserPlugin({}).dir, "coherence.config.json").problems, [], "a parser alone loads");
  assert.deepEqual(readManifest("zz", parserPlugin({ pluginApi: OLDEST_PLUGIN_API, treeSitter: undefined, syntax: { notice: "notice.ts#NOTICE" } }, { "notice.ts": "export const NOTICE = () => \"\";\n" }).dir, "coherence.config.json").problems, [], "a plugin of an older interface that fills none of them loads");
});

/** The TypeScript plugin as Coherence 1.10.1's `plugin eject typescript` wrote it, byte for byte: its bundled manifest filled source, declares and topLevel by hand. */
const EJECTED_1_10_1 = resolve("src/plugins/fixtures/ejected-1.10.1/typescript");

test("a copy ejected from Coherence 1.10.1 is refused as ejected from an older Coherence, its recovery named first: eject it again from this version and reapply the changes; the parser path follows for a plugin written from scratch", () => {
  const manifest = JSON.parse(readFileSync(join(EJECTED_1_10_1, "plugin.json"), "utf8")) as Record<string, unknown>;
  assert.equal(manifest["pluginApi"], 2, "the copy is Coherence 1.10.1's, written for pluginApi 2");
  assert.deepEqual(Object.keys(manifest["syntax"] as object).filter((slot) => (DERIVED_SLOTS as readonly string[]).includes(slot)), ["source", "declares", "topLevel"], "it fills the hand-written readers by hand");
  assert.match(readFileSync(join(EJECTED_1_10_1, "index.ts"), "utf8"), /from "@posthog\/coherence\/plugin"/, "its import of the core is the one eject writes");
  // A project that runs the copy by path, as eject left it.
  const root = mkdtempSync(join(tmpdir(), "coherence-ejected-"));
  fixtures.push(root);
  cpSync(EJECTED_1_10_1, join(root, "cp", "typescript"), { recursive: true });
  const loaded = readPlugins(root, { typescript: "./cp/typescript" }, "coherence.config.json", [], () => undefined);
  assert.deepEqual(loaded.plugins, [], "the copy never loads");
  assert.equal(loaded.problems.length, 1, loaded.problems.join("\n"));
  const [problem] = loaded.problems as [string];
  assert.ok(problem.startsWith("coherence.config.json: plugin typescript is ejected from an older Coherence (a copy of the bundled typescript plugin, version 1.10.1): its syntax.source, syntax.declares and syntax.topLevel are hand-written readers"), problem);
  assert.ok(problem.includes('set plugins.typescript to "bundled" in the config, run `coherence plugin eject typescript --to <a new folder>`, then carry your changes into the new copy'), problem);
  const at = recoveries(problem);
  assert.ok(at.eject >= 0 && at.parser > at.eject, `the eject comes first, the parser path after: ${problem}`);
  // A plugin no bundled one is named as is not said to be ejected, and is told both ways, the eject first.
  const scratch = readPlugins(root, { zz: parserPlugin({ treeSitter: undefined, syntax: { kept: "resolve.ts#RESOLVE" } }).dir }, "coherence.config.json", [], () => undefined).problems;
  assert.equal(scratch.length, 1);
  assert.doesNotMatch(scratch[0]!, /is ejected from an older Coherence/);
  assert.ok(recoveries(scratch[0]!).eject >= 0 && recoveries(scratch[0]!).parser > recoveries(scratch[0]!).eject, scratch[0]);
});

test("an interfaces table states its language's facts alone: one that answers importLists, wildcardModules or any reading of its text is refused naming it, whether or not its plugin names a parser, and the core reads those through the parser", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-syntax-trees-project-"));
  fixtures.push(root);
  const HAND = "export const FACTS = { serverBounds: false, importLists: (text) => [], wildcardModules: (file, text) => text.split('\\n').filter((l) => l.startsWith('use ')).map((l) => l.slice(4) + '.zz') };\n";
  for (const parser of [true, false]) {
    // The blind reviewer's probe: no parser, pluginApi 4, a wildcardModules read off the text by hand, which the removed kept slot answered.
    const plugin = parserPlugin({ ...(parser ? {} : { treeSitter: undefined }), syntax: { interfaces: "facts.ts#FACTS" } }, { "facts.ts": HAND });
    assert.deepEqual(readManifest("zz", plugin.dir, "coherence.config.json").problems, [], "the manifest names a slot that remains");
    registerProjectPlugins(root, [plugin]);
    forProject(root, () => {
      assert.throws(() => syntaxOf("zz", "interfaces"), (error: Error) => error.message.startsWith("plugin zz's interfaces table answers importLists and wildcardModules, which this Coherence does not read (pluginApi 4)"), parser ? "beside a parser" : "without one");
      assert.equal(parsedOf("zz", "interfaces") === undefined, !parser, "the readings are the parser's, and none without one");
    });
    // plugin check's one answer each duty loads every slot the plugin fills, and meets the same refusal.
    assert.throws(() => repeatedAnswers(plugin), /plugin zz's interfaces table answers importLists and wildcardModules/);
  }
  // Each reading pluginApi 3's tables answered, alone, is refused by its name.
  for (const reader of ["isTypeDeclaration", "isDefaultExport", "defaultNames", "importLists", "wildcardModules"]) {
    const plugin = parserPlugin({ syntax: { interfaces: "facts.ts#FACTS" } }, { "facts.ts": `export const FACTS = { serverBounds: false, ${reader}: () => [] };\n` });
    registerProjectPlugins(root, [plugin]);
    forProject(root, () => assert.throws(() => syntaxOf("zz", "interfaces"), new RegExp(`interfaces table answers ${reader}, which`), reader));
  }
  // A plugin extending a language whose wrap adds a reader to the table beneath is refused too.
  const extending = parserPlugin({ name: "zz-more", provides: undefined, extends: "zz", treeSitter: undefined, syntax: { interfaces: "more.ts#MORE" } }, { "more.ts": "export const MORE = (beneath) => ({ ...beneath, wildcardModules: () => [] });\n" });
  registerProjectPlugins(root, [parserPlugin({ syntax: { interfaces: "resolve.ts#FACTS" } }), { ...extending, name: "zz-more" }]);
  forProject(root, () => assert.throws(() => syntaxOf("zz", "interfaces"), /plugin zz-more's interfaces table answers wildcardModules/));
  // Facts alone load, and the readings come from the parse.
  registerProjectPlugins(root, [parserPlugin({ syntax: { interfaces: "resolve.ts#FACTS" } })]);
  forProject(root, () => {
    assert.deepEqual(syntaxOf("zz", "interfaces"), { serverBounds: false });
    assert.deepEqual(parsedOf("zz", "interfaces")!.importLists("from a import b as c\n"), ["b as c"]);
  });
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
  parsedOf("python", "source")!.importsOf(text, (name, specifier) => imports.push(`${name ?? "(module)"} <- ${specifier}`));
  assert.deepEqual(imports, ["annotations <- __future__", "SECRET_COLUMNS <- store.secrets", "seal <- store.secrets", "(module) <- os.path", "(module) <- json", "render <- .views", "loads <- fast", "thing <- lazy"]);
  assert.deepEqual(
    declarationsOf(text, "python").map((d) => `${d.name}@${d.line} ${d.exported ? "exported" : "private"} ${d.declares}`),
    ["TEMPLATE@13 exported value", "TYPES@17 exported value", "handler@23 exported body"],
    "a constant whose value starts on a later line is declared; a class inside a string is not; a module variable is bound, not declared",
  );
  const topLevel = parsedOf("python", "topLevel")!;
  assert.ok(topLevel(text, "logger") && topLevel(text, "_hidden") && topLevel(text, "handler"), "a bound name is at the top level");
  assert.ok(!topLevel(text, "Fake") && !topLevel(text, "thing"), "a name inside a string or a function is not");
  assert.deepEqual(parsedOf("python", "interfaces")!.importLists(text), ["seal as sealed, json as j"]);
});

test("the parser reads TypeScript's imports, declarations and default exports whole: a default beside named imports, across lines, never inside a template or a comment", () => {
  const text = [
    "/** A module whose comment shows an import: import { fake } from './nothing' */",
    'import React, { useState, type Ref as R } from "react";',
    "import {",
    "  SECRET_COLUMNS,",
    "  seal as sealed,",
    '} from "./store/secrets.ts";',
    'import * as rows from "./store/rows.ts";',
    'import "./polyfill.ts";',
    'export { audit, render as show } from "./audit.ts";',
    'export * from "./barrel.ts";',
    "const FIXTURE = `",
    'import { leaked } from "./never.ts";',
    "export function Fake() {}",
    "`;",
    "export const enum Mode { On }",
    "export const pick = <T,>(items: T[]): T => items[0]!, LIMIT = 10 * 60;",
    "export const TABLE = { a: 1 } as unknown as Record<string, number>;",
    "export const made = build();",
    "export type Row =",
    "  | { id: string }",
    "  | null;",
    "export const { handlers: { GET, POST }, auth } = NextAuth();",
    "function local() {",
    "  const inner = 1;",
    "  return inner;",
    "}",
    "export { local as handle };",
    "export default function Page() {",
    "  return null;",
    "}",
    "export { local as default };",
    "",
  ].join("\n");
  const imports: string[] = [];
  parsedOf("typescript", "source")!.importsOf(text, (name, specifier) => imports.push(`${name ?? "(module)"} <- ${specifier}`));
  assert.deepEqual(imports.sort(), ["(module) <- ./barrel.ts", "(module) <- ./polyfill.ts", "(module) <- ./store/rows.ts", "Ref <- react", "SECRET_COLUMNS <- ./store/secrets.ts", "audit <- ./audit.ts", "default <- react", "render <- ./audit.ts", "seal <- ./store/secrets.ts", "useState <- react"]);
  assert.deepEqual(
    declarationsOf(text, "typescript").map((d) => `${d.name}@${d.line} ${d.exported ? "exported" : "private"} ${d.declares}${d.isDefault ? " default" : ""}`),
    ["FIXTURE@11 private value", "Mode@15 exported value", "pick@16 exported body", "LIMIT@16 exported value", "TABLE@17 exported value", "made@18 exported unknown", "Row@19 exported type", "local@23 private body", "Page@28 exported body default"],
    "a declaration inside a template string is none; a const enum is named by its name; each name of a statement is declared, by what its value is",
  );
  const topLevel = parsedOf("typescript", "topLevel")!;
  assert.ok(["GET", "POST", "auth", "handle", "show", "Page"].every((name) => topLevel(text, name)), "a destructured name and a name an export list exports are at the top level");
  assert.ok(!topLevel(text, "inner") && !topLevel(text, "Fake"), "a name inside a function or a template is not");
  const interfaces = parsedOf("typescript", "interfaces")!;
  assert.deepEqual(interfaces.importLists(text), ["Ref as R, seal as sealed, render as show"]);
  assert.deepEqual(interfaces.defaultNames(text), ["local"], "a name exported as the default by name");
  assert.ok(interfaces.isDefaultExport("export default function Page() {") && !interfaces.isDefaultExport("export function Page() {"));
  assert.ok(interfaces.isTypeDeclaration("export interface Row {") && !interfaces.isTypeDeclaration("export const Row = 1;"));
  assert.ok(interfaces.wildcardModules("src/index.ts", text).includes("src/barrel.ts"), "a wildcard re-export's module, in every spelling");
  // An old-style cast is a JSX tag to the TSX grammar, one that swallows every declaration after it; the TypeScript grammar, the plugin's alternate, reads it as a cast.
  const cast = ['export function before() { const v = <any>window; return v; }', "export const angle = <string>input;", "export function after() {}", 'import { late } from "./late.ts";', ""].join("\n");
  assert.deepEqual(declarationsOf(cast, "typescript").map((d) => d.name), ["before", "angle", "after"], "every declaration after an old-style cast is read");
  const castImports: string[] = [];
  parsedOf("typescript", "source")!.importsOf(cast, (name, specifier) => castImports.push(`${name} <- ${specifier}`));
  assert.deepEqual(castImports, ["late <- ./late.ts"]);
  assert.deepEqual(importShapes(sourceProvider("typescript")!, cast).map((i) => i.shapes), [["named"]], "and an import after it is at the top level, not inside a block");
  assert.deepEqual(declarationsOf("export const App = () => <div onClick={() => 1}>hi</div>;\nexport function Next() {}\n", "typescript").map((d) => d.name), ["App", "Next"], "and JSX still reads through the TSX grammar");
  // A file mid-edit: the cast swallows the rest of it to TSX in one error, and the TypeScript grammar holds two typos in two small ones.
  const editing = ["export const angle = <string>input;", "export function a1() {}", "let q = (1 + ;", "export function a2() {}", "let r = (2 + ;", "export function a3() {}", "export const z = 1;", ""].join("\n");
  assert.deepEqual(declarationsOf(editing, "typescript").map((d) => d.name), ["angle", "a1", "q", "a2", "r", "a3", "z"], "the tree whose errors cover less of the text is read, not the one with fewer errors");
});

test("a parser is held to what Coherence reads: a capture it reads nothing by, queries that do not compile against its parser or its alternate, and a reading before the runtime starts are each refused by name", () => {
  const stray = parserPlugin({}, { "zz.scm": "(import_statement name: (dotted_name) @import.thing)\n" });
  assert.throws(() => treeReaderOf(stray), /plugin zz's queries capture @import\.thing, which Coherence reads nothing by/);
  // A capture the queries keep for a predicate (an underscore leads its name) compiles, tests, and is read by nothing.
  const own = parserPlugin({}, { "zz.scm": '((import_statement name: (dotted_name) @import.module @_module) (#eq? @_module "os"))\n' });
  let tested: string[] = [];
  assert.doesNotThrow(() => (tested = treeReaderOf(own)!.imports("import os\nimport sys\n").map((i) => i.specifier)), "a capture the queries keep for a predicate is refused");
  assert.deepEqual(tested, ["os"]);
  const broken = parserPlugin({}, { "zz.scm": "(import_statement name: (no_such_node) @import.module)\n" });
  assert.throws(() => treeReaderOf(broken), /plugin zz's queries \(zz\.scm\) do not compile against its parser/);
  // An alternate parser is held to the same queries: Rust's grammar has no import_statement for Python's queries to name.
  const crossed = parserPlugin({ treeSitter: { parser: "zz.wasm", alternate: "alt.wasm", queries: "zz.scm", resolve: "resolve.ts#RESOLVE" } });
  copyFileSync(join(BUNDLED_DIR, "rust", "tree-sitter-rust.wasm"), join(crossed.dir, "alt.wasm"));
  // It is compiled the first time a tree errs, so a text that parses clean never asks it, and the first that errs is refused by name.
  const crossedReader = treeReaderOf(crossed)!;
  assert.deepEqual(crossedReader.imports("import os\n").map((i) => i.specifier), ["os"], "a text the parser reads whole never asks the alternate");
  assert.throws(() => crossedReader.imports("import (\n"), /plugin zz's queries \(zz\.scm\) do not compile against its alternate parser \(alt\.wasm\)/);

  // A process that never started the runtime: the reading is refused saying how to start it, never read as nothing.
  const probe = `import { treeReaderOf } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    try { treeReaderOf(${JSON.stringify({ name: "zz", version: "0.1.0", dir: stray.dir, source: stray.dir, manifest: stray.manifest })}); console.log("read"); }
    catch (error) { console.log(error.message); }`;
  const said = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8" });
  assert.match(said, /plugin zz reads its language through a parser, and the parser runtime is not started: await startParsers\(\)/);
});

test("a path a group spells in pieces is read whole: every prefix over an import, outer first, joined to it by the separator, to any depth, the census placing it in the statement that holds it, and a prefix captured with no separator is refused", () => {
  // Python's grammar standing in for a language whose imports nest in groups (Rust's use a::{b::{c}}): a class's name prefixes every import in its body.
  const queries = "(class_definition name: (identifier) @import.prefix)\n(import_statement name: (dotted_name) @import.module) @import\n";
  const plugin = parserPlugin({ treeSitter: { parser: "zz.wasm", queries: "zz.scm", resolve: "resolve.ts#RESOLVE", separator: "::" } }, { "zz.scm": queries });
  const text = ["import os", "class A:", "    import json", "    class B:", "        import re", "    import sys", "import time", ""].join("\n");
  assert.deepEqual(
    treeReaderOf(plugin)!.imports(text).map((i) => i.specifier),
    ["os", "A::json", "A::B::re", "A::sys", "time"],
    "each import is read under the prefixes over it, the inner after the outer, and none past the group it stands in",
  );
  assert.deepEqual(importShapes(plugin, text).map((i) => i.specifier), ["os", "A::json", "A::B::re", "A::sys", "time"], "the census reads the same paths");
  // A statement captured in a match of its own holds the imports of matches that capture none, as a use declaration holds the leaves of its groups.
  const apart = parserPlugin({}, { "zz.scm": "(import_statement) @import\n(import_statement name: (dotted_name) @import.module)\n" });
  assert.deepEqual(importShapes(apart, "import os\ndef f():\n    import json\n").map((i) => i.shapes), [["whole module"], ["whole module", "inside a block"]], "the census places an import in the statement that holds it");
  const unjoined = parserPlugin({}, { "zz.scm": queries });
  assert.throws(() => treeReaderOf(unjoined), /plugin zz's queries capture @import\.prefix, and its treeSitter names no separator/);
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

test("a project's parses are kept between processes, in the user's cache outside every project: a later process parses only the texts that changed, and reads the rest as a fresh parse would, and any project holding the same text reads its parse", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-kept-parses-"));
  fixtures.push(root);
  const other = mkdtempSync(join(tmpdir(), "coherence-kept-parses-other-"));
  fixtures.push(other);
  // Each process: read the texts through Python's parser for a project, and say what it parsed and what it read.
  const pass = (at: string, changed: number | undefined): { read: number; parsed: number; imports: string[] } =>
    JSON.parse(inProcess(`const texts = Array.from({ length: 40 }, (_, i) => "from m" + i + " import (\\n    a,\\n    b" + (i === ${changed ?? -1} ? "_changed" : "") + ",\\n)\\n");
      const { read, parsed } = warmParses(plugin, ${JSON.stringify(at)}, texts);
      const imports = treeReaderOf(plugin, ${JSON.stringify(at)}).imports(texts[39]).map((i) => i.name + " <- " + i.specifier);
      console.log(JSON.stringify({ read, parsed, imports }));`)) as { read: number; parsed: number; imports: string[] };
  assert.deepEqual(pass(root, undefined), { read: 40, parsed: 40, imports: ["a <- m39", "b <- m39"] }, "a first process parses every text");
  assert.deepEqual(pass(root, 39), { read: 40, parsed: 1, imports: ["a <- m39", "b_changed <- m39"] }, "a later process parses only the text that changed");
  assert.deepEqual(pass(root, 39), { read: 40, parsed: 0, imports: ["a <- m39", "b_changed <- m39"] }, "and the changed text is kept in turn");
  assert.deepEqual(pass(other, 39), { read: 40, parsed: 0, imports: ["a <- m39", "b_changed <- m39"] }, "another project holding the same texts reads their parses");
  assert.ok(keptIn(pythonStore()).length >= 41, "kept in the user's cache, a file each");
  assert.deepEqual([readdirSync(root), readdirSync(other)], [[], []], "and nothing written into either project");
});

test("a kept parse is filed under every input it depends on: each treeSitter input KEPT_FROM names changes the fingerprint, each it leaves out changes no kept parse, and the code that reads a tree is syntax-trees.ts alone", () => {
  const base = parserPlugin({});
  const declared = base.manifest.treeSitter!;
  const print = fingerprintOf(base.dir, declared);
  for (const [key, how] of Object.entries(KEPT_FROM) as [keyof typeof KEPT_FROM, "file" | "value" | false][]) {
    if (how === "file") {
      // An optional file (the alternate parser) is named for the comparison, a copy of the parser under its own name, so a change to it
      // changes the fingerprint through this key alone; naming it changes the fingerprint too.
      const own = `${key}.wasm`;
      const named = { ...declared, [key]: declared[key] ?? own };
      const other = parserPlugin({});
      if (declared[key] === undefined) for (const dir of [base.dir, other.dir]) copyFileSync(join(dir, declared.parser), join(dir, own));
      if (declared[key] === undefined) assert.notEqual(fingerprintOf(base.dir, named), print, `naming ${key} changes the fingerprint`);
      const before = fingerprintOf(other.dir, named);
      writeFileSync(join(other.dir, named[key]!), Buffer.concat([readFileSync(join(other.dir, named[key]!)), Buffer.from("\n")]));
      assert.notEqual(fingerprintOf(other.dir, named), before, `a change to the ${key} file changes the fingerprint`);
    } else if (how === "value") {
      const one = fingerprintOf(base.dir, { ...declared, [key]: "::" });
      assert.notEqual(one, print, `naming ${key} changes the fingerprint`);
      assert.notEqual(fingerprintOf(base.dir, { ...declared, [key]: "." }), one, `a different ${key} changes the fingerprint`);
    } else {
      assert.equal(fingerprintOf(base.dir, { ...declared, [key]: "^_" }), print, `${key} is left out of the fingerprint`);
      // So it must change no kept parse of any bundled plugin that reads through a parser, over the texts of its own check project.
      for (const name of readdirSync(BUNDLED_DIR)) {
        const manifest = readManifest(name, join(BUNDLED_DIR, name), "test").manifest;
        const tree = manifest?.treeSitter;
        if (tree === undefined) continue;
        const texts = Object.values((JSON.parse(readFileSync(join(BUNDLED_DIR, name, "check.json"), "utf8")) as { files: Record<string, string> }).files);
        const [one, two] = ["^_", "::"].map((value) => {
          const dir = mkdtempSync(join(tmpdir(), "coherence-kept-from-"));
          fixtures.push(dir);
          for (const file of [tree.parser, tree.alternate, tree.queries].filter((f): f is string => f !== undefined)) copyFileSync(join(BUNDLED_DIR, name, file), join(dir, file));
          const plugin: LoadedPlugin = { name, version: "0", dir, source: dir, manifest: { ...manifest!, treeSitter: { ...tree, [key]: value } } };
          return texts.map((t) => keptParseOf(plugin, t));
        });
        assert.deepEqual(one, two, `${key} changes no kept parse of ${name}'s check project`);
      }
    }
  }
  // The fingerprint digests this module's source as the code that turns a tree into what is kept, so that code must live nowhere else:
  // a runtime import of another of Coherence's modules is one whose edit would change a kept parse under an unchanged fingerprint.
  const source = readFileSync(resolve("src/plugins/syntax-trees.ts"), "utf8");
  const own = [...source.matchAll(/^(?:import|export) (?!type )[^;]*?from ["'](\.[^"']+)["'];|\bimport\(\s*["'`](\.[^"'`]+)/gm)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(own, ["../lifecycle/user-dir.ts"], "syntax-trees.ts imports at run time only the machine key's folder from the rest of Coherence");
});

test("a warm-up holds a sample of its kept parses to a fresh parse of the same text: a store that differs is removed whole, the readings after it read fresh, and orient says so for a week", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-stale-parses-"));
  fixtures.push(root);
  const pass = (): { read: number; parsed: number; audited: number; stale: number; imports: string[] } =>
    JSON.parse(inProcess(`const texts = Array.from({ length: 40 }, (_, i) => "from audited" + i + " import (\\n    a,\\n    b,\\n)\\n");
      const counts = warmParses(plugin, ${JSON.stringify(root)}, texts);
      const imports = treeReaderOf(plugin, ${JSON.stringify(root)}).imports(texts[39]).map((i) => i.name + " <- " + i.specifier);
      console.log(JSON.stringify({ ...counts, imports }));`)) as { read: number; parsed: number; audited: number; stale: number; imports: string[] };
  const notice = (now: number): string => inProcess(`process.stdout.write(staleParsesNotice(${now}));`);
  assert.deepEqual([pass().audited, pass().stale], [0, 0], "a first warm-up has nothing kept to audit");
  assert.deepEqual(pick(pass(), ["audited", "stale"]), { audited: 8, stale: 0 }, "a later one audits a sample of what it kept, which agrees");
  // Stale as a fingerprint that misses an input leaves it: the same files, holding what other code read.
  const store = pythonStore();
  for (const file of keptIn(store)) writeFileSync(file, readFileSync(file, "utf8").replaceAll('"a"', '"stale"'));
  const audited = pass();
  assert.deepEqual(pick(audited, ["audited", "stale", "imports"]), { audited: 8, stale: 8, imports: ["a <- audited39", "b <- audited39"] }, "the audit finds the sample stale, and a reading after it reads a fresh parse");
  assert.ok(keptIn(store).every((file) => !readFileSync(file, "utf8").includes('"stale"')), "the stale store is removed whole");
  assert.match(notice(Date.now()), /plugin python's kept parses differed from a fresh parse of the same text on 8 of the 8/);
  assert.equal(notice(Date.now() + 8 * 86_400_000), "", "orient says it for a week");
  assert.deepEqual(pick(pass(), ["stale", "imports"]), { stale: 0, imports: ["a <- audited39", "b <- audited39"] }, "the next warm-up keeps fresh parses again");
});

/** Some of an object's keys. */
function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, value[k]])) as Pick<T, K>;
}

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

test("the parse store lives outside every project and is used only where the user's cache is the user's alone: a project's own .coherence/parses, a forged store, a log, a lock and an audit among it, is never read or written, and a cache others may write, or a link to one, keeps nothing", () => {
  const texts = ["from a import (\n    b,\n)\n", "X = 1\n"];
  // A repository that commits what an older Coherence kept in the project, and things no Coherence wrote: none of it is the store's.
  const project = mkdtempSync(join(tmpdir(), "coherence-forged-"));
  fixtures.push(project);
  const planted = join(project, ".coherence", "parses", "python");
  mkdirSync(planted, { recursive: true });
  const fingerprint = fingerprintOf(PYTHON, PY_PLUGIN.manifest.treeSitter!);
  const reader = treeReaderOf(PY_PLUGIN, project)! as ReturnType<typeof treeReaderOf> & { keyOf(text: string): string };
  const forged = JSON.stringify({ [reader.keyOf(texts[0]!)]: [[["import.from", "forged", 1], ["import.name", "made_up", 1]]] });
  writeFileSync(join(planted, `${fingerprint}.json`), forged);
  writeFileSync(join(planted, `${fingerprint}.added.jsonl`), `${forged}\n`);
  writeFileSync(join(planted, "warming.lock"), `${process.pid} ${Date.now()}`);
  writeFileSync(join(planted, "audit.json"), JSON.stringify({ at: Date.now(), sampled: 8, stale: 8 }));
  mkdirSync(join(planted, "..", "IGNORE-ALL-PRIOR-RULES"), { recursive: true });
  writeFileSync(join(planted, "..", "IGNORE-ALL-PRIOR-RULES", "audit.json"), JSON.stringify({ at: Date.now(), sampled: 8, stale: 8 }));
  // What the project's .coherence holds, each entry by name, size and time: the same after the reading, so nothing in it was written.
  const snapshot = (): string[] => (readdirSync(join(project, ".coherence"), { recursive: true }) as string[]).sort().map((name) => {
    const entry = lstatSync(join(project, ".coherence", name));
    return `${name} ${entry.size} ${entry.mtimeMs}`;
  });
  const before = snapshot();
  // A cache of the test's own, so no other test's audit speaks here.
  const own = mkdtempSync(join(tmpdir(), "coherence-own-cache-"));
  fixtures.push(own);
  const read = JSON.parse(inProcess(`const counts = warmParses(plugin, ${JSON.stringify(project)}, ${JSON.stringify(texts)});
    const texts = Array.from({ length: 20 }, (_, i) => "Y" + i + " = 1\\n");
    const reader = treeReaderOf(plugin, ${JSON.stringify(project)});
    for (const text of texts) reader.imports(text);
    console.log(JSON.stringify({ counts, imports: reader.imports(${JSON.stringify(texts[0])}).map((i) => i.name + " <- " + i.specifier), notice: staleParsesNotice() }));`, { ...process.env, XDG_CACHE_HOME: own })) as { counts: { read: number; skipped?: true }; imports: string[]; notice: string };
  assert.deepEqual(read, { counts: { read: 2, parsed: 2, audited: 0, stale: 0 }, imports: ["b <- a"], notice: "" }, "the warm-up reads every text, unheld by the planted lock, and no forged store, log or audit speaks");
  assert.deepEqual(snapshot(), before, "and nothing in the project is written");
  // A cache folder others may write, or a link to one, keeps no parses: every text is parsed, and nothing is written there.
  for (const how of ["others may write", "a link to a folder others may write"] as const) {
    const cache = mkdtempSync(join(tmpdir(), "coherence-shared-cache-"));
    fixtures.push(cache);
    if (how === "a link to a folder others may write") {
      const elsewhere = mkdtempSync(join(tmpdir(), "coherence-elsewhere-"));
      fixtures.push(elsewhere);
      chmodSync(elsewhere, 0o777);
      symlinkSync(elsewhere, join(cache, "coherence"));
    } else {
      mkdirSync(join(cache, "coherence"));
      chmodSync(join(cache, "coherence"), 0o777);
    }
    const shared = inProcess(`console.log(JSON.stringify(warmParses(plugin, ${JSON.stringify(project)}, ${JSON.stringify(texts)})));`, { ...process.env, XDG_CACHE_HOME: cache });
    assert.deepEqual(JSON.parse(shared), { read: 0, parsed: 0, audited: 0, stale: 0 }, `a cache folder that is ${how} keeps nothing`);
    assert.deepEqual(keptIn(join(cache, "coherence", "parses", fingerprint)), [], `and nothing is written to a cache that is ${how}`);
  }
});

test("a repository's own files cannot stop a warm-up: a source file nested deep around an error is read, and a source file that links out of the project, to a pipe, or past 16 MB is never read by the warm-up, which finishes", () => {
  // A file nested ten thousand deep around an error, which a reading that recurses over the tree overflows its stack on: read, and the next one too.
  const deep = mkdtempSync(join(tmpdir(), "coherence-hostile-deep-"));
  fixtures.push(deep);
  assert.deepEqual(pick(warmParses(PY_PLUGIN, deep, [`a = ${"(".repeat(10_000)}1 +${")".repeat(10_000)}\nB_DEEP = 1\n`, "X_AFTER_DEEP = 1\n"]), ["read", "parsed"]), { read: 2, parsed: 2 }, "a file nested deep around an error is read, and the next one");
  assert.deepEqual(declarationsOf(`export const a = ${"(".repeat(10_000)}1 +${")".repeat(10_000)};\nexport const b = 2;\n`, "typescript").map((d) => d.name), ["a", "b"], "and TypeScript's choice between its grammars measures it");
  // A project's source files that link out of it, to a pipe, and one past 16 MB: the warm-up reads none, and finishes.
  const linking = realpathSync(mkdtempSync(join(tmpdir(), "coherence-hostile-links-")));
  fixtures.push(linking);
  writeFileSync(join(linking, "coherence.config.json"), JSON.stringify({ language: "python" }));
  writeFileSync(join(linking, "own.py"), "OWN = 1\n");
  writeFileSync(join(linking, "huge.py"), "X = 1\n".repeat(3_000_000));
  const secret = mkdtempSync(join(tmpdir(), "coherence-outside-"));
  fixtures.push(secret);
  writeFileSync(join(secret, "secret.py"), "OUTSIDE_SECRET_TOKEN = 1\n");
  symlinkSync(join(secret, "secret.py"), join(linking, "outside.py"));
  execFileSync("mkfifo", [join(secret, "pipe.py")]);
  symlinkSync(join(secret, "pipe.py"), join(linking, "pipe.py"));
  execFileSync("git", ["init", "-q"], { cwd: linking });
  const warmed = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `import { startParsers } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))}; import { warmProjectParses } from ${JSON.stringify(resolve("src/economy/warm-parses.ts"))}; await startParsers(); console.log(JSON.stringify(warmProjectParses(${JSON.stringify(linking)}).map((w) => w.read)));`], { encoding: "utf8", timeout: 20_000 });
  assert.deepEqual(JSON.parse(warmed), [1], "the warm-up reads the project's own regular file alone, never one past 16 MB, and finishes");
  assert.ok(!keptIn(pythonStore()).some((file) => readFileSync(file, "utf8").includes("OUTSIDE_SECRET_TOKEN")), "nothing of a file outside the project is kept");
});

test("a kept parse is read only where it is the user's alone: a store folder, or a kept parse's folder, that others may write, a folder on the way to the cache others may write, a kept parse that is a link, and one that others may write, each answers nothing, and the text is parsed", () => {
  const text = "from payments import charge\n";
  const fingerprint = fingerprintOf(PYTHON, PY_PLUGIN.manifest.treeSitter!);
  const forged = JSON.stringify([[["import.from", "forged", 1], ["import.name", "made_up", 1]]]);
  // A fresh cache, a forged parse planted where the text's would be, and one thing on its path made what the case says; then a reading.
  const reading = (arrange: (cache: string, store: string, file: string) => void, under?: string): string[] => {
    const cache = join(under ?? mkdtempSync(join(tmpdir(), "coherence-own-")), "cache");
    if (under === undefined) fixtures.push(dirname(cache));
    const store = join(cache, "coherence", "parses", fingerprint);
    const file = keptFile(store, text);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, forged, { mode: 0o600 });
    arrange(cache, store, file);
    return JSON.parse(inProcess(`console.log(JSON.stringify(treeReaderOf(plugin, "/p").imports(${JSON.stringify(text)}).map((i) => i.name + " <- " + i.specifier)));`, { ...process.env, XDG_CACHE_HOME: cache })) as string[];
  };
  assert.deepEqual(reading(() => {}), ["made_up <- forged"], "a kept parse in a store of the user's alone is read, so the cases below each test one thing");
  assert.deepEqual(reading((_c, store) => chmodSync(store, 0o770)), ["charge <- payments"], "a store folder others may write");
  assert.deepEqual(reading((_c, _s, file) => chmodSync(dirname(file), 0o770)), ["charge <- payments"], "a kept parse's folder others may write");
  assert.deepEqual(reading((_c, _s, file) => chmodSync(file, 0o666)), ["charge <- payments"], "a kept parse others may write");
  assert.deepEqual(reading((_c, _s, file) => {
    const elsewhere = mkdtempSync(join(tmpdir(), "coherence-elsewhere-"));
    fixtures.push(elsewhere);
    writeFileSync(join(elsewhere, "parse"), forged);
    rmSync(file);
    symlinkSync(join(elsewhere, "parse"), file);
  }), ["charge <- payments"], "a kept parse that is a link");
  // A folder on the way to the cache that others may write, not sticky: another user could move the cache away under it.
  const shared = mkdtempSync(join(tmpdir(), "coherence-shared-"));
  fixtures.push(shared);
  assert.deepEqual(reading((cache) => chmodSync(dirname(cache), 0o777), shared), ["charge <- payments"], "a folder on the way others may write");
});

test("syntax-trees.ts gives out no way to the store: its exports are the readings, the warm-up, the fingerprint and the notice, never the store, its folder or a path", async () => {
  const exported = Object.keys(await import("./syntax-trees.ts")).sort();
  assert.deepEqual(exported, ["CAPTURES", "IMPORT_SHAPES", "KEPT_FROM", "capturesStatements", "fingerprintOf", "importShapes", "keptParseOf", "staleParsesNotice", "startParsers", "treeReaderOf", "warmParses"]);
});

test("a reading holds no kept parse past its last few texts and reads each from its own file: one another process keeps is read at once, one another removes answers no more, and each parse is kept as it is made", () => {
  const project = mkdtempSync(join(tmpdir(), "coherence-loose-"));
  fixtures.push(project);
  const texts = Array.from({ length: 40 }, (_, i) => `from loose${i} import c\n`);
  const reader = treeReaderOf(PY_PLUGIN, project)! as unknown as { imports(text: string): { name: string }[]; store: { parsed: number } };
  // Another process keeps the texts; this one reads them at once, parsing none.
  inProcess(`warmParses(plugin, ${JSON.stringify(project)}, ${JSON.stringify(texts)});`);
  const before = reader.store.parsed;
  for (const text of texts) assert.deepEqual(reader.imports(text).map((i) => i.name), ["c"]);
  assert.equal(reader.store.parsed, before, "what another process kept is read at once, nothing parsed here");
  // Another process finds the store stale and removes it: a text this one read before is parsed again, never answered from what was removed.
  const store = pythonStore();
  for (const file of keptIn(store)) writeFileSync(file, readFileSync(file, "utf8").replaceAll('"c"', '"stale"'));
  const audit = JSON.parse(inProcess(`console.log(JSON.stringify(warmParses(plugin, ${JSON.stringify(project)}, ${JSON.stringify(texts)})));`)) as { stale: number };
  assert.ok(audit.stale > 0, "the other process's audit finds the store stale");
  assert.deepEqual(reader.imports(texts[0]!).map((i) => i.name), ["c"], "a parse another process removed answers no more");
  assert.equal(reader.store.parsed, before + 1, "and the text is parsed again");
  // A process that parses three texts and exits has kept each, with no step at its exit.
  const brief = ["import brief_one\n", "import brief_two\n", "import brief_three\n"];
  inProcess(`const reader = treeReaderOf(plugin, ${JSON.stringify(project)}); for (const text of ${JSON.stringify(brief)}) reader.imports(text); process.exit(0);`);
  assert.ok(brief.every((text) => existsSync(keptFile(store, text))), "each parse is kept as it is made");
});

test("a kept parse no process has read in fourteen days is swept by a warm-up, at most once a day, with the temporary files of writes that died, a store a discard left and another fingerprint's folder; one read since is kept", () => {
  const cache = mkdtempSync(join(tmpdir(), "coherence-sweep-"));
  fixtures.push(cache);
  const env = { ...process.env, XDG_CACHE_HOME: cache };
  const parses = join(cache, "coherence", "parses");
  const store = join(parses, fingerprintOf(PYTHON, PY_PLUGIN.manifest.treeSitter!));
  const unread = Array.from({ length: 5 }, (_, i) => `from unread${i} import a\n`);
  const reread = Array.from({ length: 5 }, (_, i) => `from reread${i} import a\n`);
  inProcess(`warmParses(plugin, "/p", ${JSON.stringify([...unread, ...reread])});`, env);
  const age = (path: string, ms: number): void => utimesSync(path, new Date(Date.now() - ms), new Date(Date.now() - ms));
  for (const file of keptIn(store)) age(file, 30 * 86_400_000);
  // A reading, not a warm-up, reads the second five again: each is stamped as read.
  inProcess(`const reader = treeReaderOf(plugin, "/p"); for (const text of ${JSON.stringify(reread)}) reader.imports(text);`, env);
  // What writes that died, a discard and an older Coherence leave.
  const shard = dirname(keptFile(store, unread[0]!));
  writeFileSync(join(shard, "0".repeat(30) + ".1.aaaaaaaaaaaa.tmp"), "");
  age(join(shard, "0".repeat(30) + ".1.aaaaaaaaaaaa.tmp"), 2 * 3_600_000);
  writeFileSync(join(shard, "1".repeat(30) + ".2.bbbbbbbbbbbb.tmp"), "");
  const other = join(parses, "f".repeat(24), "ab");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "c".repeat(30)), "[]");
  age(join(other, "c".repeat(30)), 20 * 86_400_000);
  const discarded = join(parses, `${"e".repeat(24)}.stale-${"0".repeat(16)}`);
  mkdirSync(discarded);
  age(join(parses, "swept"), 2 * 86_400_000);
  inProcess(`warmParses(plugin, "/p", ["from fresh import a\\n"]);`, env);
  assert.ok(unread.every((text) => !existsSync(keptFile(store, text))), "a kept parse no process read in fourteen days is swept");
  assert.ok([...reread, "from fresh import a\n"].every((text) => existsSync(keptFile(store, text))), "one read since is kept, and the warm-up's own");
  assert.deepEqual(readdirSync(shard).filter((name) => name.endsWith(".tmp")), ["1".repeat(30) + ".2.bbbbbbbbbbbb.tmp"], "a write's temporary file is swept an hour on, never sooner");
  assert.ok(!existsSync(join(parses, "f".repeat(24))) && !existsSync(discarded), "another fingerprint's folder empties and goes, and a discarded store goes");
  // Swept within the day: nothing more is swept, however old.
  for (const file of keptIn(store)) age(file, 30 * 86_400_000);
  inProcess(`warmParses(plugin, "/p", []);`, env);
  assert.ok(reread.every((text) => existsSync(keptFile(store, text))), "a warm-up within a day of a sweep sweeps nothing");
});

test("two warm-ups of one project at once both read every text, need no lock, and keep each text's parse once, whole and as a fresh parse reads it", async () => {
  const cache = mkdtempSync(join(tmpdir(), "coherence-together-"));
  fixtures.push(cache);
  const env = { ...process.env, XDG_CACHE_HOME: cache };
  const texts = Array.from({ length: 300 }, (_, i) => `from together${i} import (\n    a${i},\n    b,\n)\n`);
  const probe = `import { startParsers, warmParses } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    await startParsers();
    console.log(JSON.stringify(warmParses(${JSON.stringify(PY_PLUGIN)}, "/together", ${JSON.stringify(texts)})));`;
  const warm = (): Promise<{ read: number }> =>
    new Promise((done, fail) => {
      const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { env, stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.on("exit", (code) => (code === 0 ? done(JSON.parse(out) as { read: number }) : fail(new Error(`warm-up exited ${code}`))));
    });
  const both = await Promise.all([warm(), warm()]);
  assert.deepEqual(both.map((w) => w.read), [300, 300], "each reads every text");
  const store = join(cache, "coherence", "parses", fingerprintOf(PYTHON, PY_PLUGIN.manifest.treeSitter!));
  assert.equal(keptIn(store).length, 300, "one kept parse a text");
  for (const text of texts) assert.equal(readFileSync(keptFile(store, text), "utf8"), keptParseOf(PY_PLUGIN, text), "each whole, as a fresh parse reads it");
  assert.deepEqual(readdirSync(store, { recursive: true }).filter((name) => String(name).endsWith(".tmp")), [], "and no temporary file is left");
});

test("a registry's leaves and its top share the user's one parse store: a warm-up of one leaf pre-reads the leaf and the top's files, and a warm-up of another reads what the first kept", () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "coherence-shared-parses-")));
  fixtures.push(top);
  const files: Record<string, string> = {
    "coherence.config.json": JSON.stringify({ projects: ["a", "b"], language: "python" }),
    "a/coherence.config.json": "{}\n",
    "a/one.py": "from b.two import TWO\nONE = 1\n",
    "b/coherence.config.json": "{}\n",
    "b/two.py": "TWO = 2\n",
    "tools/three.py": "THREE = 3\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(top, path)), { recursive: true });
    writeFileSync(join(top, path), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: top });
  const first = warmProjectParses(join(top, "a"));
  assert.deepEqual(first.map((w) => [w.root, w.read]), [[join(top, "a"), 1], [top, 3]], "the leaf, then the repository's top");
  const kept = (): string => keptIn(pythonStore()).map((file) => readFileSync(file, "utf8")).join("");
  assert.ok(["ONE", "TWO", "THREE"].every((name) => kept().includes(`"${name}"`)), "a's warm-up keeps the leaf's file and every file of the top, b's among them");
  const second = warmProjectParses(join(top, "b"));
  assert.deepEqual(second.map((w) => [w.root, w.read]), [[join(top, "b"), 1], [top, 3]], "b's warm-up reads its leaf and the top from the same store");
  assert.ok(![top, join(top, "a"), join(top, "b")].some((dir) => existsSync(join(dir, ".coherence", "parses"))), "no project keeps a store of its own");
});
