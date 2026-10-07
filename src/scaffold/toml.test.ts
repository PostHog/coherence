/** The TOML subset reader a boundary draft reads its declaration file with. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { lineOf, parseToml, TomlError, type TomlTable } from "./toml.ts";

test("the TOML reader takes tables, arrays of tables, strings, numbers, booleans, multi-line arrays and inline tables, and remembers each table's line", () => {
  const doc = parseToml(
    [
      "# top",
      'title = "a \\"quoted\\" \\u00e9 name" # trailing',
      "literal = 'C:\\path'",
      "count = 1_000",
      "ratio = -0.5e2",
      "on = true",
      "dotted.key = 'x'",
      '"quoted key" = 1',
      "",
      "[server]",
      "ports = [",
      "  80, # web",
      "  443,",
      "]",
      "",
      "[[item]]",
      'name = "one"',
      'deps = [{ path = "a", deprecated = true }, "b"]',
      "",
      "[[item]]",
      'name = """',
      'two"""',
      "",
    ].join("\n"),
    "t.toml",
  );
  assert.equal(doc.title, 'a "quoted" é name');
  assert.equal(doc.literal, "C:\\path");
  assert.equal(doc.count, 1000);
  assert.equal(doc.ratio, -50);
  assert.equal(doc.on, true);
  assert.deepEqual(doc.dotted, { key: "x" });
  assert.equal(doc["quoted key"], 1);
  assert.deepEqual(doc.server, { ports: [80, 443] });
  const items = doc.item as TomlTable[];
  assert.equal(items.length, 2);
  assert.deepEqual(items[0]!.deps, [{ path: "a", deprecated: true }, "b"]);
  assert.equal(items[1]!.name, "two");
  assert.equal(lineOf(doc.server as TomlTable), 10);
  assert.deepEqual(items.map((t) => lineOf(t)), [16, 20]);
});

test("the TOML reader refuses what it cannot read, naming the line", () => {
  const refused = (text: string, line: number, reason: RegExp): void => {
    assert.throws(
      () => parseToml(text, "t.toml"),
      (error: unknown) => error instanceof TomlError && error.line === line && reason.test(error.reason),
      `${JSON.stringify(text)} at line ${line}`,
    );
  };
  refused('a = 1\na = 2\n', 2, /defined twice/);
  refused('a = "open\n', 1, /newline inside a single-line string|unterminated/);
  refused("a = [1, 2\nb = 3\n", 2, /expected , or \]/);
  refused("[t]\nx = 1\n[t]\n", 3, /defined twice/);
  refused("a = 1 b = 2\n", 1, /after a value/);
  refused("a = 1979-05-27\n", 1, /dates and times/);
  refused("a = bare\n", 1, /not a TOML value/);
  refused("= 1\n", 1, /where a key belongs/);
  refused("[[t]\n", 1, /to close the header/);
});
