/**
 * The Rust plugin's text scans (plugins/rust/rust-source.ts, rust-scope.ts,
 * rust-interfaces.ts, rust-lists.ts): what a line declares, what a use tree
 * brings in, where a module path resolves by Cargo's layout and the
 * workspace's manifests, what a hand-kept list holds, and that mass reads
 * Rust as it reads the other languages.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { computeMass, formatMass } from "../economy/mass.ts";
import { declarationsOf, importsOf } from "../economy/source.ts";
import { declares } from "../observation/interfaces.ts";
import { isTypeDeclaration } from "../readings/scope/component-interfaces.ts";
import { syntaxOf } from "../plugins/languages.ts";
import { rustListOf } from "../../plugins/rust/rust-lists.ts";
import { uncommented, useLeaves } from "../../plugins/rust/rust-source.ts";

const madeFolders: string[] = [];
after(() => {
  for (const folder of madeFolders) rmSync(folder, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-rust-source-"));
  madeFolders.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

test("a Rust file declares each item at its top level under any visibility and qualifier, exported when pub in any form, named as written; an impl, a use, an item inside another or in a string declares nothing", () => {
  const text = [
    "pub const SECRET: &str = \"t\";",
    "pub(crate) async fn seal() {}",
    "pub(in crate::store) struct Row;",
    "const unsafe fn raw() {}",
    "static mut COUNT: u32 = 0;",
    "pub trait Sealer {}",
    "type Rows = Vec<Row>;",
    "mod tests;",
    "macro_rules! row { () => {} }",
    "impl Row {",
    "    pub fn id(&self) -> u64 { 0 }",
    "}",
    "use crate::store::Row;",
    "extern crate alloc;",
    "fn r#match() {}",
    "#[derive(Debug)] pub struct Tagged;",
    "const DOC: &str = \"",
    "fn in_string() {}",
    "\";",
  ].join("\n");
  assert.deepEqual(
    declarationsOf(text, "rust").map((d) => [d.name, d.exported]),
    [["SECRET", true], ["seal", true], ["Row", true], ["raw", false], ["COUNT", false], ["Sealer", true], ["Rows", false], ["tests", false], ["row", false], ["r#match", false], ["Tagged", true], ["DOC", false]],
    "a raw identifier is named as rust-analyzer names it, r# kept; an item after an attribute on its line is read",
  );
  const lines = text.split("\n");
  assert.deepEqual(lines.slice(0, 9).map((l) => declares(l, "rust")), ["value", "body", "body", "body", "value", "type", "type", "unknown", "body"]);
  assert.deepEqual(lines.slice(0, 9).map((l) => isTypeDeclaration(l, "rust")), [false, false, false, false, false, true, true, false, false], "a trait and a type alias declare a type, as declares says");
});

test("a use tree is read leaf by leaf through nested braces, renames, self and globs, each path as an item of its module and as the module, and nothing in a comment or a string is read", () => {
  const text = [
    "use crate::{store::{self, seal as close, Row}, api::*};",
    "pub(crate) use super::super::util::helper;",
    "use ::serde::Serialize;",
    "// use crate::commented::Out;",
    "/* use crate::in_block::Out; */",
    "const S: &str = \"line one \\",
    "    use crate::in_string::Out; // still the string\";",
    "const R: &str = r#\"a \" quote, then use crate::raw::Out;\"#;",
    "use crate::after::Seen;",
  ].join("\n");
  assert.deepEqual(
    useLeaves(text).map((l) => l.path.join("::") + (l.alias === undefined ? "" : ` as ${l.alias}`)),
    ["crate::store::self", "crate::store::seal as close", "crate::store::Row", "crate::api::*", "super::super::util::helper", "::serde::Serialize", "crate::after::Seen"],
  );
  assert.equal(uncommented(text).length, text.length, "blanking keeps every offset");
  // Through the parser: each leaf spelled whole, its group's paths before it.
  const read: string[] = [];
  syntaxOf("rust", "source")!.importsOf(text, (name, specifier) => read.push(name === undefined ? specifier : `${name} from ${specifier}`));
  assert.deepEqual(
    [...new Set(read)].sort(),
    ["::serde::Serialize", "Row from crate::store", "Seen from crate::after", "Serialize from ::serde", "crate::after::Seen", "crate::api", "crate::store::Row", "crate::store::seal", "crate::store::self", "helper from super::super::util", "seal from crate::store", "super::super::util::helper"],
  );
  const interfaces = syntaxOf("rust", "interfaces")!;
  assert.deepEqual(interfaces.importLists("use a::{b as c};"), ["b as c, a::b as c"], "a rename is read as the name and as the path it renames");
  assert.deepEqual(interfaces.wildcardModules("src/x.rs", text), ["src/api.rs", "src/api/mod.rs"], "a glob in a group is read under the group's path");
});

test("a Rust list is the array a top-level const or static is set to: its string literals, a tuple by its first, a path by its last segment, through & and vec!; what it cannot read is kept as written, and a comment or a string's brackets are no member", () => {
  const text = [
    'pub const KINDS: &[&str] = &["box", /* ground */ "plane", r#"say "hi""#];',
    "static TABLE: [(&str, u32); 2] = [",
    '    ("a", 1), // the first',
    '    ("b, ]", 2),',
    "];",
    "pub(crate) static SHAPES: &'static [Kind] = &[Kind::Box, shape::Kind::Sphere, 3, make(\"x\")];",
    "const NAMES: Vec<&str> = vec![\"x\"];",
    "const COUNT: usize = 3;",
    "fn body() {",
    '    const INNER: &[&str] = &["not top"];',
    "}",
  ].join("\n");
  assert.deepEqual(rustListOf(text, "KINDS"), { line: 1, kind: "array", members: ["box", "plane", 'say "hi"'], unread: [] });
  assert.deepEqual(rustListOf(text, "TABLE"), { line: 2, kind: "array", members: ["a", "b, ]"], unread: [] }, "past the type's [..; 2], a row by its first column, a comma and a bracket in a string kept in it");
  assert.deepEqual(rustListOf(text, "SHAPES"), { line: 6, kind: "array", members: ["Box", "Sphere"], unread: ["3", 'make("x")'] });
  assert.deepEqual(rustListOf(text, "NAMES")?.members, ["x"]);
  assert.equal(rustListOf(text, "COUNT"), undefined, "a const set to no array is no list");
  assert.equal(rustListOf(text, "INNER"), undefined, "a const inside a fn is not at the top");
  assert.equal(rustListOf(text, "MISSING"), undefined);
});

test("a Rust path resolves by its crate's folder layout: crate, self, super and a module of the file's own, a.rs or a/mod.rs, a crate of the workspace by its package name, a [[bin]] root's modules beside it, and only under the file's exact spelling", () => {
  const root = project({
    "Cargo.toml": '[workspace]\nmembers = ["crates/*", "tool"]\n',
    "crates/shop/Cargo.toml": '[package]\nname = "shop-core"\n',
    "crates/shop/src/lib.rs": "pub mod store;\npub mod api;\n",
    "crates/shop/src/store/mod.rs": "pub mod rows;\npub fn seal() {}\n",
    "crates/shop/src/store/rows.rs": "use super::seal;\nuse super::super::api::render;\nuse crate::api;\n",
    "crates/shop/src/api.rs": "use crate::store::{seal, rows::*};\nuse store::seal as again;\nuse serde::Serialize;\npub fn render() {}\n",
    "crates/shop/src/hiargs.rs": "pub struct HiArgs;\n",
    "tool/Cargo.toml": '[package]\nname = "tool"\n\n[[bin]]\nname = "tool"\npath = "main.rs"\n',
    "tool/main.rs": "mod flags;\nuse shop_core::store::seal;\nuse ::shop_core::api::render;\n",
    "tool/flags/mod.rs": "pub fn parse() {}\n",
  });
  const imports = (file: string, text: string): string[] => importsOf(root, file, text, "rust").map((i) => `${i.name ?? "*"} <- ${i.module}`);
  assert.deepEqual(imports("crates/shop/src/store/rows.rs", "use super::seal;\nuse super::super::api::render;\nuse crate::api;\n").sort(), ["* <- crates/shop/src/api.rs", "api <- crates/shop/src/lib.rs", "render <- crates/shop/src/api.rs", "seal <- crates/shop/src/store/mod.rs"]);
  const api = imports("crates/shop/src/api.rs", "use crate::store::{seal, rows::*};\nuse store::seal as again;\nuse serde::Serialize;\nuse crate::HiArgs;\n");
  assert.ok(api.includes("seal <- crates/shop/src/store/mod.rs") && api.includes("* <- crates/shop/src/store/rows.rs"), api.join("\n"));
  assert.ok(!api.some((line) => line.includes("serde")), "a path into a crate outside the workspace resolves to nothing");
  assert.ok(!api.some((line) => line.includes("hiargs")), "HiArgs is an item of the crate root, never the module file hiargs.rs, on any disk");
  assert.deepEqual(imports("tool/main.rs", "mod flags;\nuse shop_core::store::seal;\nuse ::shop_core::api::render;\n").sort(), ["* <- tool/flags/mod.rs", "render <- crates/shop/src/api.rs", "seal <- crates/shop/src/store/mod.rs"], "a workspace crate by its package name, - read as _; a [[bin]] root's module beside it");
  assert.deepEqual(syntaxOf("rust", "interfaces")!.wildcardModules("crates/shop/src/api.rs", "use crate::store::rows::*;\n"), ["crates/shop/src/store/rows.rs", "crates/shop/src/store/rows/mod.rs"], "a glob names its module in both layouts");
});

test("a use inside an inline module is read from that module: super leaves it before the file's own, a path still inside it leads to no other file, and a bare path there names a crate", () => {
  const root = project({
    "Cargo.toml": '[package]\nname = "shop"\n',
    "src/lib.rs": "pub mod store;\npub mod api;\n",
    "src/store/mod.rs": "pub fn seal() {}\npub mod rows;\n",
    "src/store/rows.rs": "pub struct Row;\n",
    "src/api.rs": "",
  });
  const text = [
    "pub fn render() {}",
    "#[cfg(test)]",
    "mod tests {",
    "    use super::*;",
    "    use super::super::store::seal;",
    "    use crate::store::rows::Row;",
    "    use shop::store::rows;",
    "    use self::helpers::Fixture;",
    "    use store::Shadow;",
    "    mod deeper {",
    "        use super::super::render;",
    "        use super::super::super::store::*;",
    "    }",
    "}",
  ].join("\n");
  assert.deepEqual(
    importsOf(root, "src/api.rs", text, "rust").map((i) => `${i.name ?? "*"} <- ${i.module}`).sort(),
    ["* <- src/store/mod.rs", "* <- src/store/rows.rs", "Row <- src/store/rows.rs", "rows <- src/store/mod.rs", "seal <- src/store/mod.rs"],
    "use super::* in a test module is this file, never the crate root; super::super leaves the inline module, then the file's; a bare path inside it is a crate",
  );
  assert.deepEqual(syntaxOf("rust", "interfaces")!.wildcardModules("src/api.rs", text), ["src/store.rs", "src/store/mod.rs"], "a glob of the file's own module keys no file; one that leaves it keys the module it reaches");
});

test("mass reads a Rust project as it reads the other languages: its files counted, reach followed through its use trees and mod declarations, and no language named not read", () => {
  const root = project({
    "coherence.config.json": JSON.stringify({ language: "rust" }),
    "Cargo.toml": '[package]\nname = "shop"\n',
    "Shop.spec.md": "# Shop\n\nA shop.\n",
    "src/store/Store.spec.md": "# Store\n\nThe store.\n\n## invariants\n- sealed rows: Every row is sealed.\n  protects: SECRET\n  chokepoint: seal\n  because: a token must not leak\n  kinds: none\n",
    "src/lib.rs": "pub mod store;\npub mod api;\nmod unused;\n",
    "src/store/mod.rs": "pub const SECRET: &str = \"t\";\npub fn seal() {}\n",
    "src/api.rs": "use crate::store::seal;\npub fn render() {\n    seal();\n}\n",
    "src/unused.rs": "pub fn nobody() {}\n",
  });
  const report = computeMass(root);
  assert.deepEqual(report.languages.read, ["rust"]);
  assert.deepEqual(report.languages.unread, []);
  assert.equal(report.total.files, 4);
  assert.ok(report.total.symbols >= 7, `${report.total.symbols} symbols`);
  assert.doesNotMatch(formatMass(report), /NOT READ|not measured/);
});
