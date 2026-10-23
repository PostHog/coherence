/**
 * The Go plugin's text scans (plugins/go/go-source.ts, go-scope.ts,
 * go-interfaces.ts, go-top-level.ts): what a line declares, alone or in a
 * grouped block, what a file imports and which of the package's files each
 * name it uses comes from, where an import path resolves by go.mod and
 * go.work, and that mass reads Go as it reads the other languages.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { computeMass, formatMass } from "../economy/mass.ts";
import { declarationsOf, importsOf } from "../economy/source.ts";
import { declares } from "../observation/interfaces.ts";
import { isTypeDeclaration } from "../readings/scope/component-interfaces.ts";
import { GO_INTERFACES } from "../../plugins/go/go-scope.ts";
import { codeOnly, importsIn, packageNameOf, uncommented } from "../../plugins/go/go-source.ts";
import { goDeclaresAtTop } from "../../plugins/go/go-top-level.ts";

const madeFolders: string[] = [];
after(() => {
  for (const folder of madeFolders) rmSync(folder, { recursive: true, force: true });
});

const CONFIG = JSON.stringify({ language: "go", plugins: { go: "bundled" } });

/** A project that names the Go plugin, its config read so the plugin's slots answer for "go". */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-go-source-"));
  madeFolders.push(root);
  for (const [file, text] of Object.entries({ "coherence.config.json": CONFIG, ...files })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  readEnforcementConfig(root);
  return root;
}

before(() => {
  project({});
});

const DECLARATIONS = [
  "package store",
  "",
  "import \"fmt\"",
  "",
  "// Entry is one row.",
  "type Entry struct {",
  "\tID string",
  "\tName func() string",
  "}",
  "",
  "type (",
  "\tReader interface {",
  "\t\tRead() string",
  "\t}",
  "\tRows = []Entry",
  "\tList[T any] []T",
  ")",
  "",
  "var (",
  "\tlimit, depth = 1, 2",
  "\tusage = `",
  "func Hidden() {}",
  "`",
  "\tWrite = func() {}",
  "\tTable = map[string]int{",
  "\t\t\"a\": 1,",
  "\t}",
  ")",
  "",
  "const (",
  "\tA = iota",
  "\tB",
  "\t_",
  ")",
  "",
  "/*",
  "func Commented() {}",
  "*/",
  "var _ Reader = (*Entry)(nil)",
  "var Ready bool",
  "const Version = \"1\"",
  "type Count int",
  "type Arr [4]int",
  "",
  "func (e *Entry) Method() string { return e.ID }",
  "",
  "func Map[K comparable](k K) K {",
  "\tlocal := k",
  "\tvar inner = local",
  "\treturn inner",
  "}",
  "",
  "func main() { fmt.Println(Version) }",
].join("\n");

test("a Go line declares a package-level func, type, var or const at column zero, or a member of a grouped block one level in; exported when its name starts upper case; a method, a field, a local, the blank identifier and a name in a comment or a raw string declare nothing", () => {
  const found = declarationsOf(DECLARATIONS, "go").map((d) => [d.name, d.exported]);
  assert.deepEqual(found, [
    ["Entry", true],
    ["Reader", true],
    ["Rows", true],
    ["List", true],
    ["limit", false],
    ["usage", false],
    ["Write", true],
    ["Table", true],
    ["A", true],
    ["B", true],
    ["Ready", true],
    ["Version", true],
    ["Count", true],
    ["Arr", true],
    ["Map", true],
    ["main", false],
  ]);
  for (const name of ["depth", "limit", "Reader", "B", "Map"]) assert.ok(goDeclaresAtTop(DECLARATIONS, name), `${name} is declared at the top level`);
  for (const name of ["ID", "Name", "Read", "Hidden", "Commented", "_", "Method", "local", "inner", "store", "fmt"]) assert.ok(!goDeclaresAtTop(DECLARATIONS, name), `${name} is not`);
});

test("what a Go declaration line declares, alone or read by the scan just before: an interface or alias is a type only, a const a value, a var by what it is set to, a func, struct or other defined type a body", () => {
  const lines = DECLARATIONS.split("\n");
  declarationsOf(DECLARATIONS, "go");
  const at = (start: string): string => lines.find((l) => l.startsWith(start))!;
  const read = (start: string): [string, boolean] => [declares(at(start), "go"), isTypeDeclaration(at(start), "go")];
  assert.deepEqual(read("type Entry"), ["body", false], "a struct's methods are declared apart from it");
  assert.deepEqual(read("\tReader"), ["type", true]);
  assert.deepEqual(read("\tRows"), ["type", true], "a grouped alias");
  assert.deepEqual(read("\tList"), ["body", false], "a generic defined type, its type parameters passed over");
  assert.deepEqual(read("\tlimit"), ["value", false]);
  assert.deepEqual(read("\tWrite"), ["body", false], "a var set to a func literal");
  assert.deepEqual(read("\tTable"), ["unknown", false], "a composite literal may hold a func");
  assert.deepEqual(read("\tA ="), ["value", false]);
  assert.deepEqual(read("var Ready"), ["unknown", false], "a var set later may hold a func");
  assert.deepEqual(read("type Count"), ["body", false]);
  assert.deepEqual(read("func Map"), ["body", false]);
  assert.equal(declares("func (e *Entry) Method() string { return e.ID }", "go"), "unknown", "a method is no package-level declaration");
});

test("a Go import is read single and grouped, named, dot and blank, never from a comment or a string, and blanking keeps every offset", () => {
  const text = [
    "package api",
    "",
    "import \"fmt\"",
    "import st \"shop/store\"",
    "import (",
    "\t\"net/http\"",
    "\t_ \"shop/side\" // registers itself",
    "\t. \"shop/dot\"",
    "\t`shop/raw`",
    "\t// \"shop/commented\"",
    ")",
    "",
    "var s = \"import \\\"shop/in_string\\\"\"",
  ].join("\n");
  assert.deepEqual(importsIn(text).map((i) => `${i.alias ?? "-"} ${i.path}`), ["- fmt", "st shop/store", "- net/http", "_ shop/side", ". shop/dot", "- shop/raw"]);
  assert.equal(uncommented(text).length, text.length);
  assert.equal(codeOnly(text).length, text.length);
  assert.deepEqual(["shop/store", "gopkg.in/yaml.v3", "github.com/go-chi/chi/v5", "example.com/go-redis"].map(packageNameOf), ["store", "yaml", "chi", "redis"]);
});

test("a Go import path resolves under the module go.mod names, and the root's go.work, to the file of the package that declares each name the file uses through it; a package used for its side effects, dot-imported or never spelled is its first file; any other path resolves to nothing; a deleted file stands in for the names no file left declares", () => {
  const root = project({
    "go.mod": "module example.com/shop\n\ngo 1.22\n",
    "go.work": "go 1.22\n\nuse (\n\t.\n\t./tools\n)\n",
    "store/a_rows.go": "package store\n\ntype Row map[string]string\n",
    "store/secrets.go": "package store\n\nvar SecretColumns = []string{\"token\"}\n\nfunc Seal(row Row) Row { return row }\n",
    "store/secrets_test.go": "package store\n\nfunc TestOnly() {}\n",
    "side/side.go": "package side\n\nfunc init() {}\n",
    "tools/go.mod": "module example.com/tools\n",
    "tools/lint/lint.go": "package lint\n\nfunc Run() {}\n",
    "api/render.go": "package api\n",
  });
  const api = [
    "package api",
    "",
    "import (",
    "\t\"fmt\"",
    "\tst \"example.com/shop/store\"",
    "\t_ \"example.com/shop/side\"",
    "\t\"example.com/tools/lint\"",
    "\t\"example.com/other/thing\"",
    ")",
    "",
    "func Render(row st.Row) {",
    "\tfmt.Println(st.Seal(row), st.SecretColumns, thing.X)",
    "\tlint.Run()",
    "}",
  ].join("\n");
  const imports = (file: string, text: string, vanished?: ReadonlySet<string>): string[] => importsOf(root, file, text, "go", vanished).map((i) => `${i.name ?? "*"} <- ${i.module}`);
  assert.deepEqual(imports("api/render.go", api), ["* <- store/a_rows.go", "* <- store/secrets.go", "* <- side/side.go", "* <- tools/lint/lint.go"], "each name from the file that declares it; a blank import whole; a module go.work uses; the standard library and another module nothing");
  assert.deepEqual(imports("api/render.go", "package api\n\nimport . \"example.com/shop/store\"\n\nvar x = Seal\n"), ["* <- store/a_rows.go"], "a dot import is of the package whole");
  assert.deepEqual(imports("api/render.go", "package api\n\nimport \"example.com/shop/store\"\n"), ["* <- store/a_rows.go"], "an import whose names the file never spells is of the package whole");
  const gone = new Set(["store/b_cache.go"]);
  assert.deepEqual(imports("api/render.go", "package api\n\nimport \"example.com/shop/store\"\n\nvar c = store.Cache\nvar s = store.Seal\n", gone), ["* <- store/b_cache.go", "* <- store/secrets.go"], "a name no file left declares resolves to the deleted file, so its importer is found");
});

test("the Go interfaces slot: Go renames packages, never names, so no import list holds an alias; it has no default export; gopls takes no bounds; a dot import's names are spelled at each use", () => {
  assert.deepEqual(GO_INTERFACES.importLists("import st \"shop/store\"\n"), []);
  assert.deepEqual(GO_INTERFACES.defaultNames("package x\n"), []);
  assert.deepEqual(GO_INTERFACES.wildcardModules("api/render.go", "import . \"shop/store\"\n"), []);
  assert.equal(GO_INTERFACES.isDefaultExport("func Render() {}"), false);
  assert.equal(GO_INTERFACES.serverBounds, false);
});

test("mass reads a Go project as it reads the other languages: its files counted, its declarations found, and no language named not read", () => {
  const root = project({
    "go.mod": "module shop\n\ngo 1.22\n",
    "Shop.spec.md": "# Shop\n\nA shop.\n",
    "store/Store.spec.md": "# Store\n\nThe store.\n\n## invariants\n- sealed rows: Every row is sealed.\n  protects: SecretColumns\n  chokepoint: Seal\n  because: a token must not leak\n  kinds: none\n",
    "store/secrets.go": "package store\n\nvar SecretColumns = []string{\"token\"}\n\nfunc Seal(row map[string]string) map[string]string { return row }\n",
    "store/secrets_test.go": "package store\n\nfunc TestSeal() {}\n",
    "api/render.go": "package api\n\nimport \"shop/store\"\n\nfunc Render(row map[string]string) int {\n\treturn len(store.Seal(row))\n}\n",
    "cmd/shop/main.go": "package main\n\nfunc main() {}\n",
  });
  const report = computeMass(root);
  assert.deepEqual(report.languages.read, ["go"]);
  assert.deepEqual(report.languages.unread, []);
  assert.deepEqual(report.files.map((f) => f.file).filter((f) => f.endsWith(".go")).sort(), ["api/render.go", "cmd/shop/main.go", "store/secrets.go"]);
  assert.ok(report.total.symbols >= 4, `${report.total.symbols} symbols`);
  assert.doesNotMatch(formatMass(report), /NOT READ|not measured/);
});
