/**
 * The parser path (syntax-trees.ts): a language read through a tree-sitter
 * parser has every reading of its text derived from one parse, read whole;
 * no hand-written reader of the same text stands beside it; a parser whose
 * queries Coherence cannot read, or one asked before the runtime starts, is
 * refused by name; and every tree is freed.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { declarationsOf, importsOf } from "../economy/source.ts";
import { forProject, registerProjectPlugins, sourceProvider, syntaxOf } from "./languages.ts";
import type { LoadedPlugin, PluginManifest } from "./plugin.ts";
import { BUNDLED_DIR, readManifest } from "./registry.ts";
import { fingerprintOf, importShapes, KEPT_FROM, keptParseOf, staleParsesNotice, treeReaderOf, warmParses } from "./syntax-trees.ts";
import { warmProjectParses } from "../economy/warm-parses.ts";
import { Language, Parser, Tree, type Node } from "web-tree-sitter";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

const PYTHON = join(BUNDLED_DIR, "python");

/** The Python plugin as the store's tests read it, by path. */
const PY_PLUGIN: LoadedPlugin = { name: "python", version: "0", dir: PYTHON, source: "bundled", manifest: { name: "python", version: "0", pluginApi: 2, treeSitter: { parser: "tree-sitter-python.wasm", queries: "python.scm", resolve: "python-source.ts#PYTHON_RESOLVE" } } };

/** The user's cache folder of the Python plugin's kept parses, as this test file's processes keep them (the leak guard's XDG_CACHE_HOME). */
function pythonStore(): string {
  return join(process.env["XDG_CACHE_HOME"]!, "coherence", "parses", fingerprintOf(PYTHON, PY_PLUGIN.manifest.treeSitter!));
}

/** The segments a store folder holds now. */
function segmentsIn(store: string): string[] {
  return existsSync(store) ? readdirSync(store).filter((name) => /^[0-9a-f]{24}\.json$/.test(name)).sort() : [];
}

/** Run a script in a fresh process with the parser runtime started, the store's module and the Python plugin in scope; its stdout. */
function inProcess(body: string, env: NodeJS.ProcessEnv = process.env): string {
  const probe = `import { startParsers, treeReaderOf, warmParses, staleParsesNotice } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    await startParsers();
    const plugin = ${JSON.stringify(PY_PLUGIN)};
    ${body}`;
  return execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8", env, timeout: 60_000 });
}

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
  syntaxOf("typescript", "source")!.importsOf(text, (name, specifier) => imports.push(`${name ?? "(module)"} <- ${specifier}`));
  assert.deepEqual(imports.sort(), ["(module) <- ./barrel.ts", "(module) <- ./polyfill.ts", "(module) <- ./store/rows.ts", "Ref <- react", "SECRET_COLUMNS <- ./store/secrets.ts", "audit <- ./audit.ts", "default <- react", "render <- ./audit.ts", "seal <- ./store/secrets.ts", "useState <- react"]);
  assert.deepEqual(
    declarationsOf(text, "typescript").map((d) => `${d.name}@${d.line} ${d.exported ? "exported" : "private"} ${d.declares}${d.isDefault ? " default" : ""}`),
    ["FIXTURE@11 private value", "Mode@15 exported value", "pick@16 exported body", "LIMIT@16 exported value", "TABLE@17 exported value", "made@18 exported unknown", "Row@19 exported type", "local@23 private body", "Page@28 exported body default"],
    "a declaration inside a template string is none; a const enum is named by its name; each name of a statement is declared, by what its value is",
  );
  const topLevel = syntaxOf("typescript", "topLevel")!;
  assert.ok(["GET", "POST", "auth", "handle", "show", "Page"].every((name) => topLevel(text, name)), "a destructured name and a name an export list exports are at the top level");
  assert.ok(!topLevel(text, "inner") && !topLevel(text, "Fake"), "a name inside a function or a template is not");
  const interfaces = syntaxOf("typescript", "interfaces")!;
  assert.deepEqual(interfaces.importLists(text), ["Ref as R, seal as sealed, render as show"]);
  assert.deepEqual(interfaces.defaultNames(text), ["local"], "a name exported as the default by name");
  assert.ok(interfaces.isDefaultExport("export default function Page() {") && !interfaces.isDefaultExport("export function Page() {"));
  assert.ok(interfaces.isTypeDeclaration("export interface Row {") && !interfaces.isTypeDeclaration("export const Row = 1;"));
  assert.ok(interfaces.wildcardModules("src/index.ts", text).includes("src/barrel.ts"), "a wildcard re-export's module, in every spelling");
  // An old-style cast is a JSX tag to the TSX grammar, one that swallows every declaration after it; the TypeScript grammar, the plugin's alternate, reads it as a cast.
  const cast = ['export function before() { const v = <any>window; return v; }', "export const angle = <string>input;", "export function after() {}", 'import { late } from "./late.ts";', ""].join("\n");
  assert.deepEqual(declarationsOf(cast, "typescript").map((d) => d.name), ["before", "angle", "after"], "every declaration after an old-style cast is read");
  const castImports: string[] = [];
  syntaxOf("typescript", "source")!.importsOf(cast, (name, specifier) => castImports.push(`${name} <- ${specifier}`));
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
  // The first texts a process meets are parsed directly, so a hook that reads a file or two never loads the kept parses (DIRECT_PARSES, 16).
  assert.deepEqual(pass(root, 39), { read: 40, parsed: 17, imports: ["a <- m39", "b_changed <- m39"] }, "a later process parses only its first few texts and the one that changed");
  assert.deepEqual(pass(root, 39), { read: 40, parsed: 16, imports: ["a <- m39", "b_changed <- m39"] }, "and the changed text is kept in turn");
  assert.deepEqual(pass(other, 39), { read: 40, parsed: 16, imports: ["a <- m39", "b_changed <- m39"] }, "another project holding the same texts reads their parses");
  assert.ok(segmentsIn(pythonStore()).length > 0, "kept in the user's cache");
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
  // Stale as a fingerprint that misses an input leaves it: the same segments, holding what other code read.
  const store = pythonStore();
  for (const segment of segmentsIn(store)) writeFileSync(join(store, segment), readFileSync(join(store, segment), "utf8").replaceAll('"a"', '"stale"'));
  const audited = pass();
  assert.deepEqual(pick(audited, ["audited", "stale", "imports"]), { audited: 8, stale: 8, imports: ["a <- audited39", "b <- audited39"] }, "the audit finds the sample stale, and a reading after it reads a fresh parse");
  assert.ok(segmentsIn(store).every((segment) => !readFileSync(join(store, segment), "utf8").includes('"stale"')), "the stale store is removed whole");
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

test("the parse store lives outside every project and is used only where the user's cache is the user's alone: a project's own .coherence/parses, a forged store, a log, a lock and an audit among it, is never read or written, and a cache others may write keeps nothing", () => {
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
  // A cache folder others may write, or a link where it goes, keeps no parses: every text is parsed, and nothing is written there.
  for (const how of ["others may write", "a link"] as const) {
    const cache = mkdtempSync(join(tmpdir(), "coherence-shared-cache-"));
    fixtures.push(cache);
    if (how === "a link") {
      const elsewhere = mkdtempSync(join(tmpdir(), "coherence-elsewhere-"));
      fixtures.push(elsewhere);
      symlinkSync(elsewhere, join(cache, "coherence"));
    } else {
      mkdirSync(join(cache, "coherence"));
      chmodSync(join(cache, "coherence"), 0o777);
    }
    const shared = inProcess(`console.log(JSON.stringify(warmParses(plugin, ${JSON.stringify(project)}, ${JSON.stringify(texts)})));`, { ...process.env, XDG_CACHE_HOME: cache });
    assert.deepEqual(JSON.parse(shared), { read: 0, parsed: 0, audited: 0, stale: 0 }, `a cache folder that is ${how} keeps nothing`);
    assert.ok(!existsSync(join(cache, "coherence", "parses")) || segmentsIn(join(cache, "coherence", "parses", fingerprint)).length === 0, `and nothing is written to a cache that is ${how}`);
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
  assert.ok(!segmentsIn(pythonStore()).some((segment) => readFileSync(join(pythonStore(), segment), "utf8").includes("OUTSIDE_SECRET_TOKEN")), "nothing of a file outside the project is kept");
});

test("the parse store's path is made in this module alone, under the user's cache: neither parsesFolder nor StoreFolder is exported, parsesFolder builds on userCacheDir, and the module names no project folder of Coherence's", () => {
  const source = readFileSync(resolve("src/plugins/syntax-trees.ts"), "utf8");
  assert.ok(!/export\s+(function\s+parsesFolder|class\s+StoreFolder)\b/.test(source), "neither the gateway nor the function that makes its path leaves the module");
  const body = /function parsesFolder\(\)[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  assert.match(body, /userCacheDir\(\)/, "the store's folder is under the user's cache");
  assert.doesNotMatch(source.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, ""), /["'`][^"'`]*\.coherence/, "the module's code spells no .coherence path, so it cannot name a project's folder");
});

test("a process that lives long reads the segments other processes wrote since, at most once a second, and reads the store again when a segment it read is gone; a process that parses and exits writes what it parsed without reading the store", async () => {
  const project = mkdtempSync(join(tmpdir(), "coherence-reload-"));
  fixtures.push(project);
  const texts = Array.from({ length: 40 }, (_, i) => `from lived${i} import a\n`);
  // A store another process wrote first, so this one has segments to read, whatever ran before it.
  inProcess(`console.log(JSON.stringify(warmParses(plugin, ${JSON.stringify(project)}, ${JSON.stringify(texts)})));`);
  const reader = treeReaderOf(PY_PLUGIN, project)! as unknown as { imports(text: string): { name: string }[]; store: { loads: number } };
  for (const text of texts) reader.imports(text);
  const loaded = reader.store.loads;
  assert.ok(loaded >= 1, "the store is read");
  // Another process parses texts this one never met, and writes them as a segment of its own.
  inProcess(`console.log(JSON.stringify(warmParses(plugin, ${JSON.stringify(project)}, Array.from({ length: 40 }, (_, i) => "from n" + i + " import c\\n"))));`);
  await new Promise((done) => setTimeout(done, 1_200));
  for (let i = 0; i < 5; i++) reader.imports(`import p${i}\n`);
  assert.equal(reader.store.loads, loaded + 1, "the segment another process wrote is read once it is there");
  const before = (reader.store as unknown as { parsed: number }).parsed;
  assert.deepEqual(reader.imports("from n39 import c\n").map((i) => i.name), ["c"]);
  assert.equal((reader.store as unknown as { parsed: number }).parsed, before, "and the other process's parse answers, unparsed here");
  // Another process removes the store whole, as a warm-up that finds it stale does: this one reads again and answers from no segment gone.
  const store = pythonStore();
  for (const segment of segmentsIn(store)) writeFileSync(join(store, segment), readFileSync(join(store, segment), "utf8").replaceAll('"c"', '"stale"'));
  inProcess(`console.log(JSON.stringify(warmParses(plugin, ${JSON.stringify(project)}, Array.from({ length: 40 }, (_, i) => "from n" + i + " import c\\n"))));`);
  await new Promise((done) => setTimeout(done, 1_200));
  for (let i = 0; i < 5; i++) reader.imports(`import q${i}\n`);
  assert.deepEqual(reader.imports("from n38 import c\n").map((i) => i.name), ["c"], "a segment another process removed answers no more");
  // A process that parses a few texts and exits writes them, and never reads the store to do so.
  const brief = inProcess(`const reader = treeReaderOf(plugin, ${JSON.stringify(project)});
    for (let i = 0; i < 3; i++) reader.imports("import r" + i + "\\n");
    const written = reader.store.parsed;
    reader.store.flush();
    console.log(JSON.stringify({ loads: reader.store.loads, written }));`);
  assert.deepEqual(JSON.parse(brief), { loads: 0, written: 3 }, "a short process writes without reading the store");
});

test("a warm-up merges a store of many segments into one, keeping what it read and what any pass wrote in the last fourteen days, and another warm-up of the same project skips while one runs", () => {
  const project = mkdtempSync(join(tmpdir(), "coherence-merge-"));
  fixtures.push(project);
  const store = pythonStore();
  // Ten processes, each parsing texts of its own: ten segments.
  for (let n = 0; n < 10; n++) inProcess(`const reader = treeReaderOf(plugin, ${JSON.stringify(project)}); for (let i = 0; i < 20; i++) reader.imports("from s${n}x" + i + " import a\\n"); reader.store.flush();`);
  const many = segmentsIn(store);
  assert.ok(many.length >= 10, `segments: ${many.length}`);
  // One written long ago, holding texts no pass reads again (none of s9's, which the warm-up below reads).
  const old = join(store, many.find((segment) => readFileSync(join(store, segment), "utf8").includes('"s0x0"'))!);
  const longAgo = new Date(Date.now() - 30 * 86_400_000);
  utimesSync(old, longAgo, longAgo);
  const oldKeys = Object.keys(JSON.parse(readFileSync(old, "utf8")) as object);
  const counts = JSON.parse(inProcess(`console.log(JSON.stringify(warmParses(plugin, ${JSON.stringify(project)}, Array.from({ length: 20 }, (_, i) => "from s9x" + i + " import a\\n"))));`)) as { read: number };
  assert.equal(counts.read, 20);
  const after = segmentsIn(store);
  assert.equal(after.length, 1, "merged into one");
  const merged = JSON.parse(readFileSync(join(store, after[0]!), "utf8")) as Record<string, unknown>;
  assert.ok(oldKeys.every((key) => !(key in merged)), "a segment no pass has read in fourteen days ages out");
  assert.ok(Object.keys(merged).length >= 8 * 20, "and every recent one is kept");
  // A warm-up of the same project, while one runs (its lock live), skips; one of another project does not.
  const lock = join(store, `warming-${createHash("sha256").update(resolve(project)).digest("hex").slice(0, 16)}.lock`);
  writeFileSync(lock, `${process.pid} ${Date.now()}`);
  assert.deepEqual(warmParses(PY_PLUGIN, project, ["X = 1\n"]), { read: 0, parsed: 0, audited: 0, stale: 0, skipped: true }, "the same project's warm-up skips");
  const another = mkdtempSync(join(tmpdir(), "coherence-merge-other-"));
  fixtures.push(another);
  assert.equal(warmParses(PY_PLUGIN, another, ["X = 1\n"]).read, 1, "another project's does not");
  rmSync(lock);
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
  const kept = (): string => segmentsIn(pythonStore()).map((segment) => readFileSync(join(pythonStore(), segment), "utf8")).join("");
  assert.ok(["ONE", "TWO", "THREE"].every((name) => kept().includes(`"${name}"`)), "a's warm-up keeps the leaf's file and every file of the top, b's among them");
  const second = warmProjectParses(join(top, "b"));
  assert.deepEqual(second.map((w) => [w.root, w.read]), [[join(top, "b"), 1], [top, 3]], "b's warm-up reads its leaf and the top from the same store");
  assert.ok(![top, join(top, "a"), join(top, "b")].some((dir) => existsSync(join(dir, ".coherence", "parses"))), "no project keeps a store of its own");
});
