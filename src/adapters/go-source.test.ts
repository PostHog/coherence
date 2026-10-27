/**
 * The Go plugin's readings of its text through Go's parser and go.scm (the
 * manifest's treeSitter) and plugins/go/go-source.ts: what a file declares
 * at the package level and what each declares, what a file imports and
 * which of the package's files each name it uses comes from, where an
 * import path resolves by go.mod and go.work, and that mass reads Go as it
 * reads the other languages.
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
import { parsedOf, syntaxOf } from "../plugins/languages.ts";
import { codeOnly, packageNameOf, uncommented } from "../../plugins/go/go-source.ts";

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

/** Go's topLevel slot, derived from its parser. */
const atTop = (text: string, name: string): boolean => parsedOf("go", "topLevel")!(text, name);

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
  "var Sum = 1 + 2",
  "var Once = func() int { return 1 }()",
  "var β, Γ = `raw`, -1",
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
  "var generated = `",
  "package fake",
  "func Fake() {}",
  "`",
  "",
  "func After() {}",
  "",
  "func main() { fmt.Println(Version) }",
].join("\n");

test("a Go file declares a package-level func, type, var or const, alone or in a grouped block, each name of a list; exported when its name starts upper case; a method, a field, a local, the blank identifier and a name in a comment or a raw string (a package clause in one among it) declare nothing", () => {
  const found = declarationsOf(DECLARATIONS, "go").map((d) => [d.name, d.exported]);
  assert.deepEqual(found, [
    ["Entry", true],
    ["Reader", true],
    ["Rows", true],
    ["List", true],
    ["limit", false],
    ["depth", false],
    ["usage", false],
    ["Write", true],
    ["Table", true],
    ["A", true],
    ["B", true],
    ["Ready", true],
    ["Sum", true],
    ["Once", true],
    ["β", false],
    ["Γ", true],
    ["Version", true],
    ["Count", true],
    ["Arr", true],
    ["Map", true],
    ["generated", false],
    ["After", true],
    ["main", false],
  ]);
  for (const name of ["depth", "limit", "Reader", "B", "Map", "β", "After"]) assert.ok(atTop(DECLARATIONS, name), `${name} is declared at the top level`);
  for (const name of ["ID", "Name", "Read", "Hidden", "Commented", "Fake", "_", "Method", "local", "inner", "store", "fmt"]) assert.ok(!atTop(DECLARATIONS, name), `${name} is not`);
});

test("what a Go declaration declares, read in its file: an interface or alias is a type only, a const a value, a var by its first value, a func, struct or other defined type a body", () => {
  const kinds = new Map(declarationsOf(DECLARATIONS, "go").map((d) => [d.name, d.declares]));
  const read = (name: string): string | undefined => kinds.get(name);
  assert.equal(read("Entry"), "body", "a struct's methods are declared apart from it");
  assert.equal(read("Reader"), "type", "a grouped interface");
  assert.equal(read("Rows"), "type", "a grouped alias");
  assert.equal(read("List"), "body", "a generic defined type, its type parameters passed over");
  assert.equal(read("limit"), "value");
  assert.equal(read("usage"), "value", "a raw string, whatever lines it spans");
  assert.equal(read("Write"), "body", "a var set to a func literal");
  assert.equal(read("Once"), "unknown", "a func literal called: the var holds what it returns");
  assert.equal(read("Table"), "unknown", "a composite literal may hold a func");
  assert.equal(read("Sum"), "value", "no operator yields a func");
  assert.equal(read("Γ"), "value", "each name of a list read by the list's first value");
  assert.equal(read("A"), "value");
  assert.equal(read("Ready"), "unknown", "a var set later may hold a func");
  assert.equal(read("Count"), "body");
  assert.equal(read("Map"), "body");
  assert.equal(declares("func (e *Entry) Method() string { return e.ID }", "go"), "unknown", "a method is no package-level declaration");
});

test("a Go import is read single and grouped, named, dot and blank, never from a comment or a string, each whole package narrowed to the exported names the file uses through the name it binds; blanking keeps every offset", () => {
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
    "\t\"gopkg.in/yaml.v3\"",
    ")",
    "",
    "var s = \"import \\\"shop/in_string\\\"\"",
    "var src = `",
    "package fake",
    "import \"shop/in_raw\"",
    "`",
    "",
    "func Handle(w http.ResponseWriter, rows ...st.Row) {",
    "\tfmt.Println(st.Seal(rows), st.lower, yaml.Marshal, raw.X)",
    "\tdot := 1",
    "\t_ = dot.Field",
    "}",
  ].join("\n");
  const imports: string[] = [];
  parsedOf("go", "source")!.importsOf(text, (name, specifier) => imports.push(`${name ?? "*"} <- ${specifier}`));
  assert.deepEqual(imports, ["Println <- fmt", "Row <- shop/store", "Seal <- shop/store", "ResponseWriter <- net/http", "* <- shop/side", "* <- shop/dot", "X <- shop/raw", "Marshal <- gopkg.in/yaml.v3"], "a variadic ...st.Row is a use; an unexported st.lower is none; a local named as a dot-imported package is no qualifier of it");
  assert.deepEqual(syntaxOf("go", "interfaces")!.importLists(text), ["shop/store as st, shop/side as _, shop/dot as ."]);
  assert.equal(uncommented(text).length, text.length);
  assert.equal(codeOnly(text).length, text.length);
  assert.deepEqual(["shop/store", "gopkg.in/yaml.v3", "github.com/go-chi/chi/v5", "example.com/go-redis"].map(packageNameOf), ["store", "yaml", "chi", "redis"]);
});

test("a Go import path resolves under the module go.mod names, and the root's go.work, to the package, each name the file uses through it joining the file that declares it; a package used for its side effects, dot-imported or never spelled joins every file of it; any other path resolves to nothing; a deleted file stays among its files, so a name no file left declares still finds its importer", () => {
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
  assert.deepEqual(imports("api/render.go", api), ["Row <- store/a_rows.go", "Seal <- store/secrets.go", "SecretColumns <- store/secrets.go", "* <- side/side.go", "Run <- tools/lint/lint.go"], "each name from the file that declares it; a blank import whole; a module go.work uses; the standard library and another module nothing");
  assert.deepEqual(imports("api/render.go", "package api\n\nimport . \"example.com/shop/store\"\n\nvar x = Seal\n"), ["* <- store/a_rows.go", "* <- store/secrets.go"], "a dot import is of the package whole");
  assert.deepEqual(imports("api/render.go", "package api\n\nimport \"example.com/shop/store\"\n"), ["* <- store/a_rows.go", "* <- store/secrets.go"], "an import whose names the file never spells is of the package whole");
  const gone = new Set(["store/b_cache.go"]);
  assert.deepEqual(imports("api/render.go", "package api\n\nimport \"example.com/shop/store\"\n\nvar c = store.Cache\nvar s = store.Seal\n", gone), ["Cache <- store/a_rows.go", "Cache <- store/b_cache.go", "Cache <- store/secrets.go", "Seal <- store/secrets.go"], "a name no file left declares joins every file of the package, the deleted one among them, so its importer is found");
});

test("the Go interfaces slot: an interface or alias line is a type declaration, it has no default export, gopls takes no bounds, and a dot import keys no wildcard path, since its names are spelled at each use", () => {
  const interfaces = syntaxOf("go", "interfaces")!;
  assert.equal(interfaces.isTypeDeclaration("type Reader interface{ Read() }"), true);
  assert.equal(interfaces.isTypeDeclaration("type Rows = []Row"), true);
  assert.equal(interfaces.isTypeDeclaration("type Row struct{}"), false);
  assert.deepEqual(interfaces.defaultNames("package x\n"), []);
  assert.deepEqual(interfaces.wildcardModules("api/render.go", "package api\n\nimport . \"shop/store\"\n"), []);
  assert.equal(interfaces.isDefaultExport("func Render() {}"), false);
  assert.equal(interfaces.serverBounds, false);
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
