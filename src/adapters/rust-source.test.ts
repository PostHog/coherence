/**
 * The Rust plugin's text scans (plugins/rust/rust-source.ts, rust-scope.ts,
 * rust-interfaces.ts): what a line declares, what a use tree brings in, where
 * a module path resolves by Cargo's layout and the workspace's manifests,
 * and that mass reads Rust as it reads the other languages.
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
import { RUST_INTERFACES } from "../../plugins/rust/rust-scope.ts";
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

test("a Rust line declares an item at column zero under any visibility and qualifier, exported when pub in any form; an impl, a use or an indented item declares nothing", () => {
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
  ].join("\n");
  assert.deepEqual(
    declarationsOf(text, "rust").map((d) => [d.name, d.exported]),
    [["SECRET", true], ["seal", true], ["Row", true], ["raw", false], ["COUNT", false], ["Sealer", true], ["Rows", false], ["tests", false], ["row", false], ["match", false]],
  );
  const lines = text.split("\n");
  assert.deepEqual(lines.slice(0, 9).map((l) => declares(l, "rust")), ["value", "body", "body", "body", "value", "type", "type", "unknown", "body"]);
  assert.deepEqual(lines.slice(0, 9).map((l) => isTypeDeclaration(l, "rust")), [false, false, false, false, false, false, true, false, false], "a type alias alone declares a type only");
});

test("a use tree is read leaf by leaf through nested braces, renames, self and globs, and nothing in a comment or a string is read", () => {
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
  assert.deepEqual(RUST_INTERFACES.importLists("use a::{b as c};"), ["a::{b as c}"], "the renames are read from the tree's text");
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
  assert.deepEqual(imports("crates/shop/src/store/rows.rs", "use super::seal;\nuse super::super::api::render;\nuse crate::api;\n"), ["seal <- crates/shop/src/store/mod.rs", "render <- crates/shop/src/api.rs", "api <- crates/shop/src/lib.rs", "* <- crates/shop/src/api.rs"]);
  const api = imports("crates/shop/src/api.rs", "use crate::store::{seal, rows::*};\nuse store::seal as again;\nuse serde::Serialize;\nuse crate::HiArgs;\n");
  assert.ok(api.includes("seal <- crates/shop/src/store/mod.rs") && api.includes("* <- crates/shop/src/store/rows.rs"), api.join("\n"));
  assert.ok(!api.some((line) => line.includes("serde")), "a path into a crate outside the workspace resolves to nothing");
  assert.ok(!api.some((line) => line.includes("hiargs")), "HiArgs is an item of the crate root, never the module file hiargs.rs, on any disk");
  assert.deepEqual(imports("tool/main.rs", "mod flags;\nuse shop_core::store::seal;\nuse ::shop_core::api::render;\n"), ["seal <- crates/shop/src/store/mod.rs", "render <- crates/shop/src/api.rs", "* <- tool/flags/mod.rs"], "a workspace crate by its package name, - read as _; a [[bin]] root's module beside it");
  assert.deepEqual(RUST_INTERFACES.wildcardModules("crates/shop/src/api.rs", "use crate::store::rows::*;\n"), ["crates/shop/src/store/rows.rs", "crates/shop/src/store/rows/mod.rs"], "a glob names its module in both layouts");
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
