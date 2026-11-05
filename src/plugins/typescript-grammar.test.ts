/**
 * The TypeScript plugin's patched grammar (grammars/tree-sitter-typescript): the shapes PostHog's frontend writes
 * that the stock grammar erred on parse through the bundled parsers with every declaration after them read, and the
 * bundled parsers are the ones the build records. What the build does, and that the patch changes nothing it does
 * not intend, is held in CI, where build-phase.sh runs with the network denied and compares the stock and patched
 * parsers' trees over a corpus (compare.mjs); no unit test reads the build's scripts.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Language, Parser } from "web-tree-sitter";
import { declarationsOf } from "../economy/source.ts";
import { parsedOf } from "./languages.ts";
import { BUNDLED_DIR } from "./registry.ts";

test("the bundled TypeScript parsers read what tree-sitter-typescript 0.23.2 cannot: an import type with type arguments or as an array's element, an indexed type's object or keyof's operand, a member named in or beginning with in after another, a method among them, or a statement beginning with in after another, and a bare & in JSX text or a JSX string, each with every declaration after it, while in and instanceof still continue an expression and a character reference still reads as one", () => {
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
    "method signature named in_": "export interface Job {\n  id(): string\n  in_progress(): boolean\n  in2<T>(): T\n  in?(): void\n}",
    "method named in_ after a field": "export class Queue {\n  a = 1\n  in_flight() {}\n}",
    "statement beginning with in_": "export const a = 1\nin_flight()",
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
    parsedOf("typescript", "source")!.importsOf(text, (name, specifier) => imports.push(`${name} <- ${specifier}`));
    assert.deepEqual(imports, ["late <- ./late.ts"], `${shape}: the import after it is read`);
  }
  // An expression still continues onto a line that begins with the in or instanceof operator.
  // Unicode white space after the operator ends its word as a space does (a no-break space, an ideographic space).
  const operators = "export const has = key\n  in record\nexport const is = value\n  instanceof Row\nexport const near = key\n  in record\nexport const wide = value\n  instanceof　Row\nexport const in_flight = 1\n";
  assert.deepEqual(declarationsOf(operators, "typescript").map((d) => d.name), ["has", "is", "near", "wide", "in_flight"]);
  for (const { dialect, parser } of grammars) {
    const tree = parser.parse(operators)!;
    assert.equal(tree.rootNode.hasError, false, `the ${dialect} grammar continues an expression onto a line beginning with in or instanceof`);
    assert.equal(tree.rootNode.descendantsOfType("binary_expression").length, 4, `the ${dialect} grammar reads key in record and value instanceof Row as operators`);
    tree.delete();
    if (dialect === "tsx") {
      // A character reference still reads as one, in text and in a string: only a bare & is text.
      const references = parser.parse("const a = <p title=\"x&amp;y\">&amp; &#123; & {v}</p>\n")!;
      assert.equal(references.rootNode.descendantsOfType("html_character_reference").length, 3, "&amp; and &#123; are character references, in text and in a string");
      references.delete();
    }
    parser.delete();
  }
  // That no token keeps another node type than the stock grammar gives it is not held here: compare.mjs reads every
  // token of a corpus through the stock and the patched parsers in CI (grammars/tree-sitter-typescript/build-phase.sh).
});

test("the bundled TypeScript parsers are byte for byte the digests grammars/tree-sitter-typescript/parsers.sha256 records, which the build phase checks its build against", () => {
  // The digests the build phase checks each parser it builds against before it writes it (parsers.sha256). That the build
  // fetches nothing unpinned and that CI's verify waits on it are held in CI, by running it with the network denied,
  // and are not read from the scripts' text here.
  const recorded = readFileSync(resolve("grammars/tree-sitter-typescript/parsers.sha256"), "utf8");
  for (const dialect of ["typescript", "tsx"]) {
    const expected = new RegExp(`^([0-9a-f]{64})  tree-sitter-${dialect}\\.wasm$`, "m").exec(recorded)?.[1];
    assert.ok(expected !== undefined, `parsers.sha256 records the ${dialect} parser's digest`);
    assert.equal(createHash("sha256").update(readFileSync(join(BUNDLED_DIR, "typescript", `tree-sitter-${dialect}.wasm`))).digest("hex"), expected, `the bundled ${dialect} parser is the one build.sh builds: rebuild it, or record the new digest with the patch that made it`);
  }
});
