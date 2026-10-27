/**
 * The parser path (syntax-trees.ts): a language read through a tree-sitter
 * parser has every reading of its text derived from one parse, read whole;
 * no hand-written reader of the same text stands beside it; a parser whose
 * queries Coherence cannot read, or one asked before the runtime starts, is
 * refused by name; and every tree is freed.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

/** A store's file with its body changed and sealed again, under its generation, with the key given: a store this machine's key signs, holding what it did not read. */
function resealed(text: string, key: Buffer, fingerprint: string, change: (body: string) => string): string {
  const newline = text.indexOf("\n");
  const generation = text.slice(0, newline).split(" ")[1]!;
  const body = change(text.slice(newline + 1));
  return `coherence-parses ${generation} ${createHmac("sha256", key).update(fingerprint).update("\u0000").update(`${generation}\n${body}`).digest("base64url")}\n${body}`;
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

test("the bundled TypeScript parsers read what tree-sitter-typescript 0.23.2 cannot: an import type with type arguments or as an array's element, an indexed type's object or keyof's operand, a member named in or beginning with in after another, and a bare & in JSX text or a JSX string, each with every declaration after it, and every operator keeps a node type of its own spelling", () => {
  // Each shape is one PostHog's frontend writes; the stock grammar's error over it hid the declarations after it (grammars/tree-sitter-typescript/build.sh).
  const shapes: Record<string, string> = {
    "import type with type arguments": "export type Page = null | import('../lib/api').PaginatedResponse<Source>",
    "kea's logic type": "export type L = import('node_modules/kea/lib').BuiltLogic<{ a: 1 }>",
    "import type array": "export interface Settings { tables: import('~/queries/schema').Table[] | null }",
    "import type parameter": "export const select = (members: import('../types').Member[] | null) => members",
    "keyof an import type": "export type Field = keyof import('~/types').Criteria",
    "indexed import type": "export type Kind = import('x').Logic<U>['kind']",
    "import type in type arguments": "export type ById = Record<string, import('~/types').Recording[]>",
    "member named in_": "export interface Summary {\n  ongoing: Incident[]\n  in_progress: Maintenance[]\n  instance_id: string\n  in: number\n}",
    "member named in or instanceof": "export interface Flags {\n  a: number\n  in?: number\n  b: number\n  instanceof: string\n  c: number\n  instanceof_x: number\n}",
    "class field named in": "export class Range {\n  a = 1\n  in = 2\n}",
    "bare & in JSX text": "export const Menu = () => <p>Billing & Usage &amp; more</p>",
    "bare & in a JSX string": "export const Link = () => <a href=\"https://posthog.com?utm_medium=in-product&utm_campaign=x\">docs</a>",
    "bare & before a JSX string's quote": "export const Mark = () => <a title='Q&' data-x=\"R&\" />",
  };
  // Each parses with no error: in a sample this small the stock grammar's error stays local, while across a file it swallowed what followed (18 of incidentStatusLogic.tsx's 26 declarations).
  const grammars = ["tsx", "typescript"].map((dialect) => {
    const parser = new Parser();
    parser.setLanguage(Language.loadSync(new WebAssembly.Module(readFileSync(join(BUNDLED_DIR, "typescript", `tree-sitter-${dialect}.wasm`)))));
    return { dialect, parser };
  });
  for (const [shape, line] of Object.entries(shapes)) {
    for (const { dialect, parser } of grammars) {
      if (dialect === "typescript" && shape.includes("JSX")) continue;
      const tree = parser.parse(line)!;
      assert.equal(tree.rootNode.hasError, false, `${shape}: the ${dialect} grammar parses it with no error`);
      tree.delete();
    }
    const text = `${line}\nexport function after() {}\nimport { late } from "./late.ts";\n`;
    const declared = declarationsOf(text, "typescript").map((d) => d.name);
    assert.equal(declared.at(-1), "after", `${shape}: the declaration after it is read (${declared.join(", ")})`);
    assert.equal(declared.length, 2, `${shape}: it declares its one name (${declared.join(", ")})`);
    const imports: string[] = [];
    syntaxOf("typescript", "source")!.importsOf(text, (name, specifier) => imports.push(`${name} <- ${specifier}`));
    assert.deepEqual(imports, ["late <- ./late.ts"], `${shape}: the import after it is read`);
  }
  // An expression still continues onto a line that begins with the in or instanceof operator.
  // Unicode white space after the operator ends its word as a space does (a no-break space, an ideographic space).
  const operators = "export const has = key\n  in record\nexport const is = value\n  instanceof Row\nexport const near = key\n  in\u00a0record\nexport const wide = value\n  instanceof\u3000Row\nexport const in_flight = 1\n";
  assert.deepEqual(declarationsOf(operators, "typescript").map((d) => d.name), ["has", "is", "near", "wide", "in_flight"]);
  for (const { dialect, parser } of grammars) {
    const tree = parser.parse(operators)!;
    assert.equal(tree.rootNode.hasError, false, `the ${dialect} grammar continues an expression onto a line beginning with in or instanceof`);
    assert.equal(tree.rootNode.descendantsOfType("binary_expression").length, 4, `the ${dialect} grammar reads key in record and value instanceof Row as operators`);
    tree.delete();
    // Every operator, punctuation mark and keyword keeps a node type of its own spelling: a patch that aliases a token renames every use
    // of it, which no corpus of S-expressions shows (a string '&' aliased to string_fragment for a JSX string made every & operator one).
    const tokens = [
      "type T = A & B | C & keyof D;",
      "let a = b & c | d ^ e << 1 >> 2 >>> 3, f = !g && h || (i ?? j);",
      "let k = l + m - n * o / p % q ** r; k += 1; k -= 1; k *= 2; k /= 2; k %= 2; k **= 2; k <<= 1; k >>= 1; k >>>= 1; k &= 1; k |= 1; k ^= 1; k &&= 1; k ||= 1; k ??= 1;",
      "let s = t === u || t !== v || t == w || t != x || t < y || t > z || t <= aa || t >= bb ? cc : dd;",
      "let ee = ~ff, gg = ++hh, ii = jj--, kk = ll?.mm, nn = [...oo], pp = { qq, ...rr }, ss = typeof tt, uu = void vv, ww = delete xx.yy;",
      "function zz<T extends keyof U>(v?: T): asserts v is T { if (v instanceof W || 'a' in v) return; }",
      ...(dialect === "tsx" ? ['const j = <a b="x&y" c={1}>&amp; & {d}</a>;'] : []),
    ].join("\n");
    const spelled = parser.parse(tokens)!;
    assert.equal(spelled.rootNode.hasError, false, `the ${dialect} grammar reads every operator`);
    const renamed: string[] = [];
    const cursor = spelled.walk();
    for (let more = true; more; ) {
      const node = cursor.currentNode;
      if (!node.isNamed && node.childCount === 0 && node.endIndex > node.startIndex && node.type !== node.text) renamed.push(`${JSON.stringify(node.text)} as ${node.type}`);
      if (cursor.gotoFirstChild()) continue;
      while (!cursor.gotoNextSibling()) if (!cursor.gotoParent()) { more = false; break; }
    }
    cursor.delete();
    spelled.delete();
    assert.deepEqual(renamed, [], `the ${dialect} grammar's every anonymous token is a node of its own spelling (the & operator among them)`);
    if (dialect === "tsx") {
      // A character reference still reads as one, in text and in a string: only a bare & is text.
      const references = parser.parse("const a = <p title=\"x&amp;y\">&amp; &#123; & {v}</p>\n")!;
      assert.equal(references.rootNode.descendantsOfType("html_character_reference").length, 3, "&amp; and &#123; are character references, in text and in a string");
      references.delete();
    }
    parser.delete();
  }
});

test("the bundled TypeScript parsers are the ones grammars/tree-sitter-typescript/build.sh builds: each is byte for byte the digest the script records and checks its build against, the script fetches nothing it does not check by its digest, its compiler among it, and CI's verify waits on the job that runs it", () => {
  const build = readFileSync(resolve("grammars/tree-sitter-typescript/build.sh"), "utf8");
  // Every download goes through fetch, which fails unless the file is the digest given; the CLI is handed the compiler it would download.
  const code = build.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
  assert.deepEqual(code.match(/\b(curl|wget|npm (install|exec|i)\b|npx)\b.*$/gm) ?? [], ["curl --fail --silent --show-error --location --output \"$3\" \"$1\""], "the one download is fetch's");
  const fetches = code.match(/^\s*fetch .*$/gm) ?? [];
  assert.ok(fetches.length >= 4 && fetches.every((f) => /^\s*fetch "https:\/\/[^"]+" ("\$\w+_sha"|[0-9a-f]{64}) "[^"]+"$/.test(f)), `each fetch names a digest: ${fetches.join(" | ")}`);
  for (const pinned of ["cli_sha", "sdk_sha", "opt_sha"]) assert.equal((code.match(new RegExp(`\\b${pinned}=[0-9a-f]{64}\\b`, "g")) ?? []).length, 4, `${pinned} pinned for each platform`);
  assert.match(code, /export TREE_SITTER_WASI_SDK_PATH="\$work\/wasi-sdk" TREE_SITTER_BINARYEN_PATH="\$work\/binaryen"/, "the CLI compiles with the checked wasi-sdk and binaryen");
  // CI runs the script, and the one check that stands for the rest waits on every job but the bench's, the parsers' among them,
  // so no job can be added that a pull request may fail with verify green.
  const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
  const jobs = [...ci.slice(ci.indexOf("\njobs:\n")).matchAll(/^  ([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]!);
  const needs = /^  verify:\n(?:    .*\n)*?    needs: \[([^\]]*)\]$/m.exec(ci)?.[1]?.split(",").map((n) => n.trim()).sort();
  assert.deepEqual(needs, jobs.filter((j) => j !== "verify" && j !== "bench").sort(), "verify needs every job but the bench's");
  assert.match(ci, /^  typescript-parsers:\n(?:    .*\n|\n)*?        run: grammars\/tree-sitter-typescript\/build\.sh$/m, "the typescript-parsers job runs build.sh");
  for (const dialect of ["typescript", "tsx"]) {
    const expected = new RegExp(`^expected_${dialect}=([0-9a-f]{64})$`, "m").exec(build)?.[1];
    assert.ok(expected !== undefined, `build.sh records the ${dialect} parser's digest`);
    assert.equal(createHash("sha256").update(readFileSync(join(BUNDLED_DIR, "typescript", `tree-sitter-${dialect}.wasm`))).digest("hex"), expected, `the bundled ${dialect} parser is the one build.sh builds: rebuild it, or record the new digest with the patch that made it`);
  }
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
      const { read, parsed } = warmParses(plugin, ${JSON.stringify(at)}, texts);
      const imports = treeReaderOf(plugin, ${JSON.stringify(at)}).imports(texts[39]).map((i) => i.name + " <- " + i.specifier);
      console.log(JSON.stringify({ read, parsed, imports }));`;
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

test("a warm-up holds a sample of its kept parses to a fresh parse of the same text: a store that differs is discarded whole, the readings after it read fresh, and orient says so for a week", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-stale-parses-"));
  fixtures.push(root);
  mkdirSync(join(root, ".coherence"));
  // The processes keep their machine key in a folder of the test's, so the test can sign a store as this machine would.
  const config = mkdtempSync(join(tmpdir(), "coherence-stale-key-"));
  fixtures.push(config);
  const env = { ...process.env, XDG_CONFIG_HOME: config };
  const notice = (now: number): string =>
    execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `import { staleParsesNotice } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))}; process.stdout.write(staleParsesNotice(${JSON.stringify(root)}, ${now}));`], { encoding: "utf8", env });
  const pass = (): { read: number; parsed: number; audited: number; stale: number; imports: string[] } => {
    const probe = `import { startParsers, treeReaderOf, warmParses } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
      await startParsers();
      const plugin = ${JSON.stringify({ name: "python", version: "0", dir: PYTHON, source: "bundled", manifest: { name: "python", version: "0", pluginApi: 2, treeSitter: { parser: "tree-sitter-python.wasm", queries: "python.scm", resolve: "python-source.ts#PYTHON_RESOLVE" } } })};
      const texts = Array.from({ length: 40 }, (_, i) => "from m" + i + " import (\\n    a,\\n    b,\\n)\\n");
      const counts = warmParses(plugin, ${JSON.stringify(root)}, texts);
      const imports = treeReaderOf(plugin, ${JSON.stringify(root)}).imports(texts[39]).map((i) => i.name + " <- " + i.specifier);
      console.log(JSON.stringify({ ...counts, imports }));`;
    return JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8", env })) as { read: number; parsed: number; audited: number; stale: number; imports: string[] };
  };
  const store = join(root, ".coherence", "parses", "python");
  const kept = (): string[] => readdirSync(store).filter((f) => f.endsWith(".json") && f !== "audit.json");
  assert.deepEqual([pass().audited, pass().stale], [0, 0], "a first warm-up has nothing kept to audit");
  assert.deepEqual(pick(pass(), ["audited", "stale"]), { audited: 8, stale: 0 }, "a later one audits a sample of what it kept, which agrees");
  // Stale as a fingerprint that misses an input leaves it: the same file, signed by this machine, holding what other code read.
  const [file] = kept();
  const key = readFileSync(join(config, "coherence", "parses.key"));
  const fingerprint = file!.slice(0, -".json".length);
  writeFileSync(join(store, file!), resealed(readFileSync(join(store, file!), "utf8"), key, fingerprint, (body) => body.replaceAll('"a"', '"stale"')));
  const audited = pass();
  assert.deepEqual(pick(audited, ["audited", "stale", "imports"]), { audited: 8, stale: 8, imports: ["a <- m39", "b <- m39"] }, "the audit finds the sample stale, and a reading after it reads a fresh parse");
  assert.deepEqual(kept().map((f) => readFileSync(join(store, f), "utf8").split("\n")[1]), ["{}"], "the stale store is discarded whole: sealed empty, under a generation of its own");
  assert.match(notice(Date.now()), /plugin python's kept parses differed from a fresh parse of the same text on 8 of the 8/);
  assert.equal(notice(Date.now() + 8 * 86_400_000), "", "orient says it for a week");
  assert.equal(staleParsesNotice(root), "", "and only on the machine whose warm-up wrote it");
  assert.deepEqual(pick(pass(), ["stale", "imports"]), { stale: 0, imports: ["a <- m39", "b <- m39"] }, "the next warm-up keeps fresh parses again");
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

test("the parse store never reaches past the project's own folders: a link on its path, at .coherence, at its parses or at a plugin's folder, keeps no parses and touches nothing, a store or log the project brings is never read or written through, by a link or a second name, and only the store's own files are removed", () => {
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
  assert.deepEqual(warmParses(plugin, linked, texts), { read: 0, parsed: 0, audited: 0, stale: 0, skipped: true }, "a link on the store's path keeps no parses");
  assert.deepEqual(readdirSync(victim), ["id_rsa"], "the link's target is untouched");
  // The same a folder up, and two: .coherence/parses, and .coherence itself, committed as links.
  for (const at of [join(".coherence", "parses"), ".coherence"]) {
    const higher = mkdtempSync(join(tmpdir(), "coherence-linked-higher-"));
    fixtures.push(higher);
    mkdirSync(join(higher, at, ".."), { recursive: true });
    symlinkSync(victim, join(higher, at));
    assert.deepEqual(warmParses(plugin, higher, texts), { read: 0, parsed: 0, audited: 0, stale: 0, skipped: true }, `a link at ${at} keeps no parses`);
    assert.deepEqual(readdirSync(victim), ["id_rsa"], `the target of a link at ${at} is untouched`);
  }

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
  assert.deepEqual(first, { read: 2, parsed: 2, audited: 0, stale: 0 });
  const [own] = names().filter((n) => n.endsWith(".json"));
  assert.ok(own !== undefined, names().join(", "));
  const fp = own.slice(0, -".json".length);
  // The store's own first line, this machine's, over a forged body: the signature covers what the store holds, so it is never read.
  const [genuine] = readFileSync(join(store, own), "utf8").split("\n");
  // The body is well formed, each entry [the day it was seen, its matches], so only the signature can refuse it.
  writeFileSync(join(store, own), `${genuine}\n${JSON.stringify({ [forgedKey]: [Math.floor(Date.now() / 86_400_000), [[["import.from", "forged", 1], ["import.name", "made_up", 1]]]] })}`);
  symlinkSync(elsewhere, join(store, `${fp}.added.jsonl`));
  // A fresh process's reader: the unsigned store is never read, so the text is parsed again and reads what it holds.
  const probe = `import { startParsers, treeReaderOf } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    await startParsers();
    const reader = treeReaderOf(${JSON.stringify(plugin)}, ${JSON.stringify(project)});
    const texts = Array.from({ length: 20 }, (_, i) => "Y" + i + " = 1\\n");
    for (const text of texts) reader.imports(text);
    console.log(JSON.stringify(reader.imports(${JSON.stringify(texts[0])}).map((i) => i.name + " <- " + i.specifier)));`;
  const said = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(said), ["b <- a"], "a store the project brings, under a signature of other contents, is never read");
  assert.equal(readFileSync(elsewhere, "utf8"), "", "nothing is appended through a link");
  assert.ok(names().includes("notes.txt"), "a file that is not the store's own is never removed");
  // A store this machine signed, outside the project, linked in where the store's file goes: never read through the link.
  const key = readFileSync(join(process.env["XDG_CONFIG_HOME"]!, "coherence", "parses.key"));
  const outside = join(victim, "store.json");
  writeFileSync(outside, resealed(`${genuine}\n{}`, key, fp, () => JSON.stringify({ [forgedKey]: [Math.floor(Date.now() / 86_400_000), [[["import.from", "forged", 1], ["import.name", "made_up", 1]]]] })));
  rmSync(join(store, own));
  rmSync(join(store, `${fp}.added.jsonl`));
  symlinkSync(outside, join(store, own));
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8" })), ["b <- a"], "a signed store linked in from outside is never read");
  // A log that is a second name of a file outside the project (a hard link, as an archive can carry): nothing is appended to it.
  rmSync(join(store, own));
  rmSync(join(store, `${fp}.added.jsonl`), { force: true });
  const hard = join(victim, "hard-appended");
  writeFileSync(hard, "");
  linkSync(hard, join(store, `${fp}.added.jsonl`));
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8" });
  assert.equal(readFileSync(hard, "utf8"), "", "nothing is appended to a file with a second name");
});

test("a repository's own files cannot stop a warm-up or speak at a session start: a folder where the store's file goes keeps no parses and the warm-up goes on, a lock stamped in the future or one no warm-up can read is taken over, a source file nested deep around an error is read, a source file that links out or to a pipe is never read, and an audit the project brings is never said", () => {
  const plugin: LoadedPlugin = { name: "python", version: "0", dir: PYTHON, source: "bundled", manifest: { name: "python", version: "0", pluginApi: 2, treeSitter: { parser: "tree-sitter-python.wasm", queries: "python.scm", resolve: "python-source.ts#PYTHON_RESOLVE" } } };
  const texts = ["from a import b\n", "X = 1\n"];
  const project = mkdtempSync(join(tmpdir(), "coherence-hostile-store-"));
  fixtures.push(project);
  const store = join(project, ".coherence", "parses", "python");
  mkdirSync(store, { recursive: true });
  // The fingerprint is the same for every user of a release, so a repository can name the store's file before any warm-up writes it.
  const fingerprint = fingerprintOf(PYTHON, plugin.manifest.treeSitter!);
  mkdirSync(join(store, `${fingerprint}.json`));
  writeFileSync(join(store, "warming.lock"), `1 ${Date.now() + 365 * 86_400_000}`);
  assert.deepEqual(warmParses(plugin, project, texts), { read: 2, parsed: 2, audited: 0, stale: 0 }, "the warm-up reads every text, unheld by the lock, unstopped by the folder");
  assert.deepEqual(readdirSync(store).filter((n) => n.startsWith(`${fingerprint}.json.`)), [], "and leaves no temporary file behind");
  // A folder or a link where the lock goes is no warm-up's lock either.
  for (const held of ["folder", "link"] as const) {
    const other = mkdtempSync(join(tmpdir(), "coherence-hostile-lock-"));
    fixtures.push(other);
    const otherStore = join(other, ".coherence", "parses", "python");
    mkdirSync(otherStore, { recursive: true });
    if (held === "folder") mkdirSync(join(otherStore, "warming.lock"));
    else symlinkSync(join(other, "nowhere"), join(otherStore, "warming.lock"));
    assert.deepEqual(warmParses(plugin, other, texts), { read: 2, parsed: 2, audited: 0, stale: 0 }, `a ${held} at the lock's path holds no warm-up off`);
  }
  // A lock no warm-up can read (no permission to: an archive can carry one) is no warm-up's either.
  const unreadable = mkdtempSync(join(tmpdir(), "coherence-hostile-lock-"));
  fixtures.push(unreadable);
  const unreadableStore = join(unreadable, ".coherence", "parses", "python");
  mkdirSync(unreadableStore, { recursive: true });
  writeFileSync(join(unreadableStore, "warming.lock"), `${process.pid} ${Date.now()}`);
  chmodSync(join(unreadableStore, "warming.lock"), 0o000);
  assert.deepEqual(warmParses(plugin, unreadable, texts), { read: 2, parsed: 2, audited: 0, stale: 0 }, "a lock no warm-up can read holds no warm-up off");
  // A file nested ten thousand deep around an error, which a reading that recurses over the tree overflows its stack on: read, and the next one too.
  const deep = mkdtempSync(join(tmpdir(), "coherence-hostile-deep-"));
  fixtures.push(deep);
  mkdirSync(join(deep, ".coherence"));
  assert.deepEqual(warmParses(plugin, deep, [`a = ${"(".repeat(10_000)}1 +${")".repeat(10_000)}\nB = 1\n`, "X = 1\n"]), { read: 2, parsed: 2, audited: 0, stale: 0 }, "a file nested deep around an error is read");
  assert.deepEqual(declarationsOf(`export const a = ${"(".repeat(10_000)}1 +${")".repeat(10_000)};\nexport const b = 2;\n`, "typescript").map((d) => d.name), ["a", "b"], "and TypeScript's choice between its grammars measures it");
  // A project's source files that link out of it, and to a pipe: the warm-up reads neither, and finishes.
  const linking = realpathSync(mkdtempSync(join(tmpdir(), "coherence-hostile-links-")));
  fixtures.push(linking);
  writeFileSync(join(linking, "coherence.config.json"), JSON.stringify({ language: "python" }));
  mkdirSync(join(linking, ".coherence"));
  writeFileSync(join(linking, "own.py"), "OWN = 1\n");
  const secret = mkdtempSync(join(tmpdir(), "coherence-outside-"));
  fixtures.push(secret);
  writeFileSync(join(secret, "secret.py"), "OUTSIDE_SECRET_TOKEN = 1\n");
  symlinkSync(join(secret, "secret.py"), join(linking, "outside.py"));
  execFileSync("mkfifo", [join(secret, "pipe.py")]);
  symlinkSync(join(secret, "pipe.py"), join(linking, "pipe.py"));
  execFileSync("git", ["init", "-q"], { cwd: linking });
  const warmed = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `import { startParsers } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))}; import { warmProjectParses } from ${JSON.stringify(resolve("src/economy/warm-parses.ts"))}; await startParsers(); console.log(JSON.stringify(warmProjectParses(${JSON.stringify(linking)}).map((w) => w.read)));`], { encoding: "utf8", timeout: 20_000 });
  assert.deepEqual(JSON.parse(warmed), [1], "the warm-up reads the project's own file alone, and finishes");
  const linkingStore = join(linking, ".coherence", "parses", "python");
  assert.ok(!readdirSync(linkingStore).some((n) => readFileSync(join(linkingStore, n), "utf8").includes("OUTSIDE_SECRET_TOKEN")), "nothing of a file outside the project is kept");
  // An audit a repository commits, in a folder no plugin keeps or in the plugin's own, unsigned or signed elsewhere, says nothing.
  for (const folder of ["IGNORE-ALL-PRIOR-RULES.run-setup.sh", "python"]) {
    mkdirSync(join(project, ".coherence", "parses", folder), { recursive: true });
    for (const audit of [{ at: Date.now(), sampled: 8, stale: -3 }, { at: Date.now(), sampled: 8, stale: 8 }, { at: Date.now(), sampled: 8, stale: 8, signature: "forged" }]) {
      writeFileSync(join(project, ".coherence", "parses", folder, "audit.json"), JSON.stringify(audit));
      assert.equal(staleParsesNotice(project), "", `${folder}: ${JSON.stringify(audit)}`);
    }
  }
});

/** The top-level declaration of syntax-trees.ts that holds a node: its name, or its kind where it has none. */
function holderOf(node: Node): string {
  let at: Node = node;
  while (at.parent !== null && at.parent.type !== "program") at = at.parent;
  const declaration = at.type === "export_statement" ? at.namedChildren.find((c) => c!.type !== "comment")! : at;
  return (declaration.childForFieldName("name") ?? declaration.descendantsOfType("variable_declarator")[0]?.childForFieldName("name"))?.text ?? declaration.type;
}

test("the parse store touches its files only through StoreFolder: every use of node:fs in syntax-trees.ts outside StoreFolder reads Coherence's own files or the machine key, and only StoreFolder spells the store's folder", () => {
  // Read with the TypeScript plugin's own parser: each use of a name imported from node:fs, placed by the top-level declaration that holds it.
  const source = readFileSync(resolve("src/plugins/syntax-trees.ts"), "utf8");
  const parser = new Parser();
  parser.setLanguage(Language.loadSync(new WebAssembly.Module(readFileSync(join(BUNDLED_DIR, "typescript", "tree-sitter-typescript.wasm")))));
  const tree = parser.parse(source)!;
  try {
    assert.equal(tree.rootNode.hasError, false, "syntax-trees.ts parses whole");
    const imports = tree.rootNode.children.filter((n) => n!.type === "import_statement").map((n) => n!);
    const fsModules = imports.filter((n) => /^["'](node:)?fs(\/promises)?["']$/.test(n.childForFieldName("source")!.text));
    assert.deepEqual(fsModules.map((n) => n.childForFieldName("source")!.text), ['"node:fs"'], "the file reaches the file system through one import of node:fs, by name");
    // And by no other way a module can reach it: no string naming it outside that import, no require, no dynamic import, no built-in
    // module asked for by name, and createRequire only to find web-tree-sitter's package.
    const named = tree.rootNode.descendantsOfType("string").filter((s) => /^["'`](node:)?fs(\/promises)?["'`]$/.test(s!.text) && s!.parent?.type !== "import_statement");
    assert.deepEqual(named.map((s) => s!.text), [], "no string names the file system's module outside its import");
    const ways = [
      ...tree.rootNode.descendantsOfType("call_expression").filter((c) => c!.childForFieldName("function")?.type === "import").map(() => "import()"),
      ...tree.rootNode.descendantsOfType(["identifier", "property_identifier"]).filter((id) => /^(require|getBuiltinModule|binding|_linkedBinding)$/.test(id!.text)).map((id) => id!.text),
      ...tree.rootNode.descendantsOfType("identifier").filter((id) => id!.text === "createRequire" && id!.parent?.type === "call_expression" && !(id!.parent.parent?.type === "member_expression" && id!.parent.parent.childForFieldName("property")?.text === "resolve" && holderOf(id!) === "runtimeVersion")).map(() => "createRequire"),
    ];
    assert.deepEqual(ways, [], "the file system reached by no require, dynamic import or built-in asked for by name");
    const fsNames = new Set(fsModules[0]!.descendantsOfType("import_specifier").map((s) => (s!.childForFieldName("alias") ?? s!.childForFieldName("name"))!.text));
    // What reads Coherence's own files (the parser, the queries, web-tree-sitter's package, this module's source) or the machine key, never a project's.
    const own = new Set(["compile", "fingerprintOf", "runtimeVersion", "extractionDigest", "machineKey"]);
    const holder = holderOf;
    const uses = tree.rootNode.descendantsOfType("identifier").filter((id) => fsNames.has(id!.text) && id!.parent?.type !== "import_specifier").map((id) => holder(id!));
    assert.ok(uses.includes("StoreFolder"), "the gateway itself uses the file system");
    assert.deepEqual([...new Set(uses.filter((name) => name !== "StoreFolder" && !own.has(name)))], [], "store code touches a file only through StoreFolder");
    // Inside StoreFolder each effect has one method of its own, so every file is opened the one way #openFile opens it (never through a
    // link, never waiting on a pipe, never past its size, never written through a second name), read only by the descriptor it returned,
    // removed only where remove checks it is a regular file, and renamed or linked into place only where replace and create do.
    const gateway = tree.rootNode.descendantsOfType("class_declaration").find((c) => c!.childForFieldName("name")?.text === "StoreFolder")!;
    const methodOf = (node: Node): string | undefined => {
      for (let at: Node | null = node; at !== null; at = at.parent) if (at.type === "method_definition") return at.childForFieldName("name")?.text;
      return undefined;
    };
    const doors: Record<string, string[]> = { openSync: ["#openFile"], rmSync: ["remove"], renameSync: ["replace"], linkSync: ["create"], mkdirSync: ["ensure"], readdirSync: ["all", "names"], readFileSync: ["readWithFirstLine"], readSync: ["*lines", "firstLine", "lines"] };
    const effects = gateway.descendantsOfType("call_expression").map((c) => ({ call: c!, fn: c!.childForFieldName("function")!.text })).filter(({ fn }) => fn in doors);
    for (const { call, fn } of effects) assert.ok(doors[fn]!.includes(methodOf(call) ?? ""), `StoreFolder calls ${fn} only in ${doors[fn]!.join(" or ")}, not in ${methodOf(call)}`);
    for (const { call, fn } of effects.filter((e) => e.fn === "readFileSync" || e.fn === "readSync")) assert.equal(call.childForFieldName("arguments")!.namedChildren[0]!.text, "fd", `${fn} reads only a descriptor #openFile returned`);
    const opener = effects.filter((e) => e.fn === "openSync");
    assert.equal(opener.length, 1, "one call opens a file of the store");
    assert.match(opener[0]!.call.text, /\| constants\.O_NOFOLLOW \| constants\.O_NONBLOCK/, "and it adds O_NOFOLLOW and O_NONBLOCK to whatever a caller asks");
    // No function of the module calls itself: a tree's depth, a log's length and a store's size are a project's to choose, and a reading's stack is not.
    const functions = [...tree.rootNode.descendantsOfType(["function_declaration", "method_definition", "generator_function_declaration"]), ...tree.rootNode.descendantsOfType("variable_declarator").filter((v) => /^(arrow_function|function_expression)$/.test(v!.childForFieldName("value")?.type ?? ""))];
    const recursive = functions.filter((f) => {
      const name = f!.childForFieldName("name")?.text;
      if (name === undefined) return false;
      const body = f!.type === "variable_declarator" ? f!.childForFieldName("value")! : f!;
      return body.descendantsOfType("call_expression").some((c) => [name, `this.${name}`, `${holderOf(f!)}.${name}`].includes(c!.childForFieldName("function")!.text));
    });
    assert.deepEqual(recursive.map((f) => f!.childForFieldName("name")!.text), [], "no function of syntax-trees.ts calls itself");
    // The store's folder is spelled where StoreFolder makes it, and parsesFolder, which makes it, is this module's own: no other module can call it.
    // Spelled whole or inside a path, in a string or a template.
    const spelled = tree.rootNode.descendantsOfType(["string_fragment", "template_string"]).filter((s) => /(^|[\\/`])parses([\\/`]|$)/.test(s!.text)).map((s) => holder(s!));
    assert.deepEqual([...new Set(spelled)].sort(), ["StoreFolder", "parsesFolder"]);
    assert.ok(!/export\s+(function\s+parsesFolder|class\s+StoreFolder)\b/.test(source), "neither the gateway nor the function that makes its path leaves the module");
  } finally {
    tree.delete();
    parser.delete();
  }
});

test("a store's generation is made only where ParseStore seals the store, for a rewrite or a discard, and an append writes only the log: no write but a rewrite or a discard changes the generation a process loaded", () => {
  const source = readFileSync(resolve("src/plugins/syntax-trees.ts"), "utf8");
  const parser = new Parser();
  parser.setLanguage(Language.loadSync(new WebAssembly.Module(readFileSync(join(BUNDLED_DIR, "typescript", "tree-sitter-typescript.wasm")))));
  const tree = parser.parse(source)!;
  try {
    const store = tree.rootNode.descendantsOfType("class_declaration").find((c) => c!.childForFieldName("name")?.text === "ParseStore")!;
    const method = (node: Node): string | undefined => {
      for (let at: Node | null = node; at !== null; at = at.parent) if (at.type === "method_definition") return at.childForFieldName("name")?.text;
      return undefined;
    };
    const inStore = (n: Node): string => `${store.startIndex <= n.startIndex && n.endIndex <= store.endIndex ? "ParseStore" : "elsewhere"}.${method(n)}`;
    const callsOf = (name: string): Node[] => tree.rootNode.descendantsOfType("call_expression").filter((c) => c!.childForFieldName("function")?.text === name).map((c) => c!);
    assert.deepEqual(callsOf("newGeneration").map(inStore), ["ParseStore.seal"], "only ParseStore's seal makes a generation");
    assert.deepEqual(callsOf("this.seal").map(inStore).sort(), ["ParseStore.discard", "ParseStore.rewrite"], "and only a rewrite or a discard seals");
    // What makes the bytes a generation is: only newGeneration, and the machine key's own.
    assert.deepEqual([...new Set(tree.rootNode.descendantsOfType("identifier").filter((id) => id!.text === "randomBytes" && id!.parent?.type !== "import_specifier").map((id) => holderOf(id!)))].sort(), ["machineKey", "newGeneration"]);
    // The store's folder is used only by calling it, never held under another name: each write below is every write.
    const called = (m: Node): boolean => m.parent?.type === "member_expression" && m.parent.parent?.type === "call_expression" && m.parent.parent.childForFieldName("function")?.id === m.parent.id;
    const named = (m: Node): boolean => m.parent?.type === "member_expression" && m.parent.childForFieldName("property")?.text === "name";
    const aliased = store.descendantsOfType("member_expression").filter((m) => m!.text === "this.folder" && !called(m!) && !named(m!) && !(m!.parent?.type === "assignment_expression" && method(m!) === "constructor"));
    assert.deepEqual(aliased.map((m) => `${method(m!)}: ${m!.parent!.text.slice(0, 60)}`), [], "the folder is called (or its name read), never passed or held");
    // What a process loaded is set where it loads (get) and where it writes (seal) alone: the generation it trusts and the first line it last read.
    const assigned = (field: string): string[] => [...new Set(store.descendantsOfType("assignment_expression").filter((a) => a!.childForFieldName("left")?.text === `this.${field}`).map((a) => method(a!) ?? "?"))].sort();
    assert.deepEqual(assigned("generation"), ["get", "seal"], "the generation a process holds is set by its load and its seal alone");
    assert.deepEqual(assigned("seen"), ["get", "seal"], "the first line it last read, likewise");
    // A warm-up lock is removed by its holder, or under the taking-over lock, alone: no other code removes a lock another holds.
    const removes = store.descendantsOfType("call_expression").filter((c) => c!.childForFieldName("function")?.text === "this.folder.remove" && c!.childForFieldName("arguments")!.namedChildren[0]!.text === "WARM_LOCK").map((c) => method(c!));
    assert.deepEqual(removes.sort(), ["takeOver", "unlock"], "the warm-up lock is removed only by takeOver, under its own lock, and by unlock, its holder's");
    // Each of the store's writes, by the file it names: the store's file only replaced in seal, the log only appended.
    const writes = store.descendantsOfType("call_expression").filter((c) => /^this\.folder\.(append|replace|create)$/.test(c!.childForFieldName("function")?.text ?? "")).map((c) => `${method(c!)} ${c!.childForFieldName("function")!.text.split(".").pop()} ${c!.childForFieldName("arguments")!.namedChildren[0]!.text}`);
    assert.deepEqual(writes.filter((w) => !/ (WARM_LOCK|WARM_TAKEOVER|AUDIT_FILE)$/.test(w)).sort(), ["flush append this.log", "seal replace this.base"], "the store's file written only by seal, the log only appended, and nothing else written but the locks and the audit");
  } finally {
    tree.delete();
    parser.delete();
  }
});

test("a log line is read only where it signs itself with this machine's key, a torn line is passed over, and a log that fails more than a torn line's worth is read no further, so a repository's log costs a few signatures whatever its size", () => {
  const plugin: LoadedPlugin = { name: "python", version: "0", dir: PYTHON, source: "bundled", manifest: { name: "python", version: "0", pluginApi: 2, treeSitter: { parser: "tree-sitter-python.wasm", queries: "python.scm", resolve: "python-source.ts#PYTHON_RESOLVE" } } };
  const text = "from a import b\n";
  const project = mkdtempSync(join(tmpdir(), "coherence-forged-log-"));
  fixtures.push(project);
  mkdirSync(join(project, ".coherence"));
  warmParses(plugin, project, [text]);
  // The genuine entry the warm-up kept, moved to the log under a forged name, and the store's file removed so the log alone answers.
  const store = join(project, ".coherence", "parses", "python");
  const base = readdirSync(store).find((n) => /^[\w-]{16}\.json$/.test(n))!;
  const fp = base.slice(0, 16);
  const kept = JSON.parse(readFileSync(join(store, base), "utf8").split("\n").slice(1).join("\n")) as Record<string, [number, unknown]>;
  const [digest, [day, found]] = Object.entries(kept)[0]!;
  rmSync(join(store, base));
  // With the store's file gone the store has no generation, and a log line read is one appended under none.
  const forged = JSON.stringify([digest, JSON.parse(JSON.stringify(found).replaceAll('"b"', '"made_up"')), day, ""]);
  const otherGeneration = JSON.stringify([digest, JSON.parse(JSON.stringify(found).replaceAll('"b"', '"made_up"')), day, "AAAAAAAAAAAA"]);
  // The key the leak guard's own Coherence folder holds, as every process of this test file's reads it.
  const key = readFileSync(join(process.env["XDG_CONFIG_HOME"]!, "coherence", "parses.key"));
  const signed = (line: string): string => `${createHmac("sha256", key).update(fp).update("\u0000").update(line).digest("base64url")} ${line}`;
  const read = (log: string): string[] => {
    writeFileSync(join(store, `${fp}.added.jsonl`), log);
    const probe = `import { startParsers, treeReaderOf } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
      await startParsers();
      const reader = treeReaderOf(${JSON.stringify(plugin)}, ${JSON.stringify(project)});
      for (let i = 0; i < 20; i++) reader.imports("Y" + i + " = 1\\n");
      console.log(JSON.stringify(reader.imports(${JSON.stringify(text)}).map((i) => i.name + " <- " + i.specifier)));`;
    return JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8" })) as string[];
  };
  assert.deepEqual(read(`${signed(forged)}\n`), ["made_up <- a"], "a line this machine signed is read, so the log is read at all");
  assert.deepEqual(read(`${"x".repeat(43)} ${forged}\n`), ["b <- a"], "a line signed with no key of this machine's is never read");
  assert.deepEqual(read(`${signed(otherGeneration)}\n`), ["b <- a"], "a line appended under another generation of the store is never read");
  assert.deepEqual(read(`{"torn\n${signed(forged)}\n`), ["made_up <- a"], "a line a killed process tore is passed over");
  assert.deepEqual(read(`${"a b\n".repeat(9)}${signed(forged)}\n`), ["b <- a"], "past a torn line's worth the log is read no further");
});

test("a process that lives long reads again what another process discarded, even when it appended since or the store was its log alone, a pipe the project puts at the log's path never holds a process up, and a key file too short to be one is replaced", async () => {
  const plugin: LoadedPlugin = { name: "python", version: "0", dir: PYTHON, source: "bundled", manifest: { name: "python", version: "0", pluginApi: 2, treeSitter: { parser: "tree-sitter-python.wasm", queries: "python.scm", resolve: "python-source.ts#PYTHON_RESOLVE" } } };
  const project = mkdtempSync(join(tmpdir(), "coherence-reload-"));
  fixtures.push(project);
  mkdirSync(join(project, ".coherence"));
  const texts = Array.from({ length: 40 }, (_, i) => `from m${i} import a\n`);
  const warmElsewhere = (at: string = project): string => {
    const probe = `import { startParsers, warmParses } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
      await startParsers();
      console.log(JSON.stringify(warmParses(${JSON.stringify(plugin)}, ${JSON.stringify(at)}, ${JSON.stringify(texts)})));`;
    return execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8", timeout: 30_000 });
  };
  warmElsewhere();
  // A store this machine signed whose parses differ from a fresh parse's, as a fingerprint that missed an input would leave.
  const store = join(project, ".coherence", "parses", "python");
  const base = readdirSync(store).find((n) => /^[\w-]{16}\.json$/.test(n))!;
  const key = readFileSync(join(process.env["XDG_CONFIG_HOME"]!, "coherence", "parses.key"));
  writeFileSync(join(store, base), resealed(readFileSync(join(store, base), "utf8"), key, base.slice(0, 16), (body) => body.replaceAll('"a"', '"stale"')));
  // This process loads it, another's warm-up finds it stale and discards it, and this one appends a batch of its own after.
  const reader = treeReaderOf(plugin, project)!;
  for (const text of texts) reader.imports(text);
  assert.deepEqual(reader.imports(texts[39]!).map((i) => i.name), ["stale"], "the loaded store answers");
  assert.match(warmElsewhere(), /"stale":[1-9]/, "the other process's audit finds it stale");
  for (let i = 0; i < 260; i++) reader.imports(`from n${i} import x\n`);
  await new Promise((done) => setTimeout(done, 1_200));
  for (let i = 0; i < 5; i++) reader.imports(`import z${i}\n`);
  assert.deepEqual(reader.imports(texts[39]!).map((i) => i.name), ["a"], "what the other discarded is read again, its own append notwithstanding");

  // A store that is its log alone (a process read and appended, no warm-up has written the store yet), stale: the discard is seen there too.
  const logOnly = mkdtempSync(join(tmpdir(), "coherence-log-only-"));
  fixtures.push(logOnly);
  mkdirSync(join(logOnly, ".coherence"));
  const readElsewhere = `import { startParsers, treeReaderOf } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    await startParsers();
    const reader = treeReaderOf(${JSON.stringify(plugin)}, ${JSON.stringify(logOnly)});
    for (const text of ${JSON.stringify(texts)}) reader.imports(text);`;
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", readElsewhere], { encoding: "utf8", timeout: 30_000 });
  const logStore = join(logOnly, ".coherence", "parses", "python");
  const log = readdirSync(logStore).find((n) => n.endsWith(".added.jsonl"))!;
  assert.ok(!readdirSync(logStore).some((n) => n.endsWith(".json")), "no store file yet, only its log");
  const restale = (signed: string): string => {
    const line = signed.slice(signed.indexOf(" ") + 1).replaceAll('"a"', '"stale"');
    return `${createHmac("sha256", key).update(log.slice(0, 16)).update("\u0000").update(line).digest("base64url")} ${line}`;
  };
  writeFileSync(join(logStore, log), `${readFileSync(join(logStore, log), "utf8").split("\n").filter(Boolean).map(restale).join("\n")}\n`);
  const logReader = treeReaderOf(plugin, logOnly)!;
  for (const text of texts) logReader.imports(text);
  assert.deepEqual(logReader.imports(texts[39]!).map((i) => i.name), ["stale"], "a store of its log alone answers");
  assert.match(warmElsewhere(logOnly), /"stale":[1-9]/, "the other process's audit finds it stale");
  await new Promise((done) => setTimeout(done, 1_200));
  for (let i = 0; i < 5; i++) logReader.imports(`import w${i}\n`);
  assert.deepEqual(logReader.imports(texts[39]!).map((i) => i.name), ["a"], "what the other discarded is read again, though the store it loaded had no file of its own");

  // A pipe where the log goes: a process that appends, and one that reads, each finish.
  const piped = mkdtempSync(join(tmpdir(), "coherence-piped-"));
  fixtures.push(piped);
  const pipedStore = join(piped, ".coherence", "parses", "python");
  mkdirSync(pipedStore, { recursive: true });
  execFileSync("mkfifo", [join(pipedStore, `${fingerprintOf(PYTHON, plugin.manifest.treeSitter!)}.added.jsonl`)]);
  const probe = `import { startParsers, treeReaderOf } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    await startParsers();
    const reader = treeReaderOf(${JSON.stringify(plugin)}, ${JSON.stringify(piped)});
    for (let i = 0; i < 300; i++) reader.imports("from p" + i + " import q\\n");
    console.log("finished");`;
  assert.match(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", probe], { encoding: "utf8", timeout: 20_000 }), /finished/);

  // A key file too short to be a key (one a process found empty, mid-write): replaced, so what the next warm-up keeps is read after it.
  const config = mkdtempSync(join(tmpdir(), "coherence-short-key-"));
  fixtures.push(config);
  mkdirSync(join(config, "coherence"));
  writeFileSync(join(config, "coherence", "parses.key"), "");
  const keyed = mkdtempSync(join(tmpdir(), "coherence-keyed-"));
  fixtures.push(keyed);
  mkdirSync(join(keyed, ".coherence"));
  const warm = `import { startParsers, warmParses } from ${JSON.stringify(resolve("src/plugins/syntax-trees.ts"))};
    await startParsers();
    console.log(JSON.stringify(warmParses(${JSON.stringify(plugin)}, ${JSON.stringify(keyed)}, ${JSON.stringify(texts)})));`;
  const warmed = (): { parsed: number } => JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", warm], { encoding: "utf8", env: { ...process.env, XDG_CONFIG_HOME: config } })) as { parsed: number };
  assert.equal(warmed().parsed, 40);
  assert.ok(warmed().parsed < 40, "the second warm-up reads what the first kept");
  assert.equal(readFileSync(join(config, "coherence", "parses.key")).length, 32);
});

test("a registry's leaves share one parse store at the repository's top: a warm-up of one leaf keeps what another leaf's read, and pre-reads the top's files", () => {
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
  for (const dir of [".coherence", "a/.coherence", "b/.coherence"]) mkdirSync(join(top, dir), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: top });
  const kept = (): number => {
    const store = join(top, ".coherence", "parses", "python");
    const file = readdirSync(store).find((n) => n.endsWith(".json"));
    return file === undefined ? 0 : Object.keys(JSON.parse(readFileSync(join(store, file), "utf8").split("\n").slice(1).join("\n")) as object).length;
  };
  const first = warmProjectParses(join(top, "a"));
  assert.deepEqual(first.map((w) => [w.root, w.read]), [[join(top, "a"), 1], [top, 3]], "the leaf, then the repository's top");
  assert.equal(kept(), 3, "every file of the repository, kept at its top");
  assert.ok(!existsSync(join(top, "a", ".coherence", "parses")) && !existsSync(join(top, "b", ".coherence", "parses")), "no leaf keeps a store of its own");
  writeFileSync(join(top, "b", "two.py"), "TWO = 22\n");
  warmProjectParses(join(top, "b"));
  assert.equal(kept(), 4, "b's warm-up adds its changed file and keeps a's and the top's, seen within the retention");
});
