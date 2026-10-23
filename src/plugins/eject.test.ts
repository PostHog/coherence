/**
 * The eject, enhance and swap workflow: a bundled plugin copied into a
 * project with its tests, its import of the core named as a plugin outside
 * the package names it, the config pointed at the copy; and plugin check
 * holding any plugin to what every language plugin owes, a plugin that
 * reports no references failing by name.
 */

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { cli } from "../lifecycle/cli-fixture.ts";
import { checkPlugin } from "./check.ts";
import { ejectedSource, ejectPlugin, EjectError, PACKAGE_SPECIFIER, PLUGIN_SOURCES } from "./eject.ts";
import { readPlugins } from "./registry.ts";

const fixtures: string[] = [];

after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-eject-"));
  fixtures.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`])).sort();
}

test("plugin eject copies a bundled plugin's source and its check.json into the project, its core import named as the package's, the config pointed at it; and refuses a folder that exists or an entry the config has", async () => {
  const root = project({ "coherence.config.json": JSON.stringify({ language: "typescript", ignore: ["generated"] }, null, 4) + "\n" });
  const said = await cli(["plugin", "eject", "typescript"], { cwd: root });
  assert.equal(said.status, 0, said.stderr);
  const copy = join(root, "coherence-plugins", "typescript");
  assert.deepEqual(filesUnder(copy), [...filesUnder(join(PLUGIN_SOURCES, "typescript")), "package.json"].sort(), "every file of the bundled plugin, its check.json among them, and a package.json naming its modules ES modules");
  assert.deepEqual(JSON.parse(readFileSync(join(copy, "package.json"), "utf8")), { type: "module", private: true });
  assert.ok(filesUnder(copy).includes("check.json"), "its tests come with it");
  for (const file of filesUnder(copy).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(copy, file), "utf8");
    assert.doesNotMatch(text, /"\.\.\/\.\.\/src\//, `${file} reaches into no core module`);
  }
  assert.match(readFileSync(join(copy, "index.ts"), "utf8"), new RegExp(`from "${PACKAGE_SPECIFIER}"`), "the core is the package's plugin interface");
  const config = JSON.parse(readFileSync(join(root, "coherence.config.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(config, { language: "typescript", ignore: ["generated"], plugins: { typescript: "./coherence-plugins/typescript" } }, "the rest of the config kept");
  assert.match(readFileSync(join(root, "coherence.config.json"), "utf8"), /^ {4}"language"/m, "its indentation kept");
  assert.match(said.stdout, /^ejected plugin typescript into \.\/coherence-plugins\/typescript: \d+ files$/m);
  assert.match(said.stdout, /plugin check \.\/coherence-plugins\/typescript$/m, "what to run next");

  assert.throws(() => ejectPlugin(root, "typescript", "elsewhere"), (e: unknown) => e instanceof EjectError && /already runs plugin typescript/.test(e.message), "an entry the config has");
  const opted = project({ "coherence.config.json": JSON.stringify({ language: "go", plugins: { go: "bundled" } }) });
  assert.equal(ejectPlugin(opted, "go").folder, "./coherence-plugins/go", "a plugin the project runs bundled ejects");
  assert.deepEqual(JSON.parse(readFileSync(join(opted, "coherence.config.json"), "utf8")), { language: "go", plugins: { go: "./coherence-plugins/go" } }, "its copy takes the bundled entry's place");
  assert.throws(() => ejectPlugin(root, "python", "coherence-plugins/typescript"), (e: unknown) => e instanceof EjectError && /coherence-plugins\/typescript exists/.test(e.message), "a folder that exists");
  assert.throws(() => ejectPlugin(root, "python", "../outside"), (e: unknown) => e instanceof EjectError && /not a folder inside the project/.test(e.message));
  assert.throws(() => ejectPlugin(root, "cobol"), (e: unknown) => e instanceof EjectError && /no bundled plugin is named "cobol"; the bundled plugins are .*typescript/.test(e.message));
  assert.ok(!existsSync(join(root, "elsewhere")) && !existsSync(join(root, "outside")), "a refusal writes nothing");
});

test("plugin check holds a plugin to every duty, bundled or by path, and a plugin that reports no references fails, by name", async () => {
  const bundled = await checkPlugin(process.cwd(), "typescript");
  assert.deepEqual(bundled.duties.map((o) => [o.name, o.verdict]), [["file rule", "pass"], ["declarations", "pass"], ["references", "pass"], ["chokepoint", "pass"]], JSON.stringify(bundled.duties));

  // A plugin that takes typescript's place and answers every references query with nothing.
  const root = project({
    "deaf/plugin.json": JSON.stringify({ name: "deaf", version: "0.1.0", pluginApi: 2, provides: { language: "typescript" }, extends: "typescript", module: "./index.ts" }),
    "deaf/index.ts": "export default { adapter: ({ base }) => ({ language: base.language, ladder: base.ladder, ready: () => base.ready(), resolve: (n, h) => base.resolve(n, h), references: async () => [], visibility: (d, c) => base.visibility(d, c), testFilter: (v) => base.testFilter(v), refute: (p, o, e, c) => base.refute(p, o, e, c), forget: (f) => base.forget(f), close: async () => {} }) };\n",
  });
  cpSync(join(PLUGIN_SOURCES, "typescript", "check.json"), join(root, "deaf", "check.json"));
  const deaf = await checkPlugin(root, "./deaf");
  const references = deaf.duties.find((o) => o.name === "references")!;
  assert.equal(references.verdict, "fail");
  assert.match(references.reason, /^the bundled minimum: reports no references to SECRET_COLUMNS; 5 exist/);
  assert.notEqual(deaf.duties.find((o) => o.name === "chokepoint")!.verdict, "pass", "and no chokepoint is graded clean through it");

  rmSync(join(root, "deaf", "check.json"));
  const untested = await checkPlugin(root, "./deaf");
  assert.equal(untested.duties.find((o) => o.name === "references")!.verdict, "fail", "a plugin with no check.json of its own is still held to the bundled minimum for its language");
});

test("plugin check hands the adapter its scratch project's real path, so a server that answers in real paths reports sites inside it", async () => {
  // macOS keeps the temporary folder behind a link (/var is /private/var); a server answers in the real path, so a root that is not one loses every site.
  const root = project({
    "real/plugin.json": JSON.stringify({ name: "real", version: "0.1.0", pluginApi: 2, provides: { language: "typescript" }, extends: "typescript", module: "./index.ts" }),
    "real/index.ts": 'import { realpathSync } from "node:fs";\nexport default { adapter: ({ root, base }) => ({ language: base.language, ladder: base.ladder, ready: async () => (realpathSync(root) === root ? base.ready() : { ok: false, reason: `handed ${root}, whose real path is ${realpathSync(root)}` }), resolve: (n, h) => base.resolve(n, h), references: (d) => base.references(d), visibility: (d, c) => base.visibility(d, c), testFilter: (v) => base.testFilter(v), refute: (p, o, e, c) => base.refute(p, o, e, c), forget: (f) => base.forget(f), close: async () => {} }) };\n',
  });
  const checked = await checkPlugin(root, "./real");
  assert.deepEqual(checked.duties.map((o) => [o.name, o.verdict]), [["file rule", "pass"], ["declarations", "pass"], ["references", "pass"], ["chokepoint", "pass"]], JSON.stringify(checked.duties));
});

test("plugin check passes nothing over nothing: a check.json with no cases fails each duty as nothing to check, {} is refused by name, the bundled minimum stands under a copy's own, and a duty that throws is named while the others report", async () => {
  const deafAdapter = (references: string): string =>
    `export default { adapter: ({ base }) => ({ language: base.language, ladder: base.ladder, ready: () => base.ready(), resolve: (n, h) => base.resolve(n, h), references: ${references}, visibility: (d, c) => base.visibility(d, c), testFilter: (v) => base.testFilter(v), refute: (p, o, e, c) => base.refute(p, o, e, c), forget: (f) => base.forget(f), close: async () => {} }) };\n`;
  const manifest = (name: string): string => JSON.stringify({ name, version: "0.1.0", pluginApi: 2, provides: { language: "typescript" }, extends: "typescript", module: "./index.ts" });
  const root = project({
    "honest/plugin.json": manifest("honest"),
    "honest/index.ts": deafAdapter("(d) => base.references(d)"),
    "throws/plugin.json": manifest("throws"),
    "throws/index.ts": deafAdapter('async () => { throw new Error("deaf by design"); }'),
  });
  const minimum = JSON.parse(readFileSync(join(PLUGIN_SOURCES, "typescript", "check.json"), "utf8")) as Record<string, unknown>;

  writeFileSync(join(root, "honest", "check.json"), JSON.stringify({ ...minimum, language: { files: [], not: [] }, declarations: [], references: [] }));
  const empty = await checkPlugin(root, "./honest");
  const byName = (name: string) => empty.duties.find((o) => o.name === name)!;
  for (const name of ["file rule", "declarations", "references"]) {
    assert.equal(byName(name).verdict, "fail", name);
    assert.match(byName(name).reason, /plugin honest's own: nothing to check/, `${name}: ${byName(name).reason}`);
    assert.match(byName(name).reason, /the bundled minimum: \d+ of \d+/, "the minimum is held besides it, never replaced");
  }

  writeFileSync(join(root, "honest", "check.json"), "{}");
  const shapeless = await checkPlugin(root, "./honest");
  assert.ok(shapeless.duties.every((o) => o.verdict === "fail" && /plugin honest's .*check\.json is no check project: it lacks files.*language.*declarations.*protects.*references/.test(o.reason)), JSON.stringify(shapeless.duties));

  const thrown = await checkPlugin(root, "./throws");
  assert.deepEqual(thrown.duties.map((o) => o.name), ["file rule", "declarations", "references", "chokepoint"], "every duty reported");
  const failed = thrown.duties.find((o) => o.name === "references")!;
  assert.equal(failed.verdict, "fail");
  assert.match(failed.reason, /threw: deaf by design/);
  assert.equal(thrown.duties.find((o) => o.name === "file rule")!.verdict, "pass", "the duties that did not throw still report");
  assert.equal(thrown.duties.find((o) => o.name === "declarations")!.verdict, "pass");
});

test("plugin eject writes only the plugins key's text: every other byte of the config kept, a plugins key already there replaced in place", () => {
  const inline = '{\n  "language": "typescript",\n  "ignore": ["generated", "vendor"],\n  "tests": [{ "command": "npm test" }]\n}\n';
  const fresh = project({ "coherence.config.json": inline });
  ejectPlugin(fresh, "typescript");
  assert.equal(
    readFileSync(join(fresh, "coherence.config.json"), "utf8"),
    '{\n  "language": "typescript",\n  "ignore": ["generated", "vendor"],\n  "tests": [{ "command": "npm test" }],\n  "plugins": {\n    "typescript": "./coherence-plugins/typescript"\n  }\n}\n',
  );
  const placed = '{\n\t"plugins": { "rust": "bundled" },\n\t"language": ["typescript", "rust"]\n}';
  const already = project({ "coherence.config.json": placed });
  ejectPlugin(already, "typescript");
  assert.equal(readFileSync(join(already, "coherence.config.json"), "utf8"), '{\n\t"plugins": {\n\t\t"rust": "bundled",\n\t\t"typescript": "./coherence-plugins/typescript"\n\t},\n\t"language": ["typescript", "rust"]\n}');
});

test("plugin eject and a config's plugin path stay inside the project once symbolic links are followed, and a link that leads nowhere is refused by name", () => {
  const outside = project({ "keep.txt": "outside\n" });
  const root = project({ "coherence.config.json": "{}\n" });
  symlinkSync(outside, join(root, "escape"));
  symlinkSync(join(outside, "gone"), join(root, "dangling"));
  assert.throws(() => ejectPlugin(root, "typescript", "escape/ts"), (e: unknown) => e instanceof EjectError && /escape\/ts is not a folder inside the project/.test(e.message), "a folder inside the project that links out of it");
  assert.throws(() => ejectPlugin(root, "typescript", "dangling"), (e: unknown) => e instanceof EjectError && /dangling exists as a symbolic link that leads nowhere/.test(e.message), "a link at the target that leads nowhere");
  assert.throws(() => ejectPlugin(root, "typescript", "dangling/ts"), (e: unknown) => e instanceof EjectError && /dangling\/ts passes through a symbolic link that leads nowhere/.test(e.message), "a link on the way that leads nowhere");
  assert.deepEqual(readdirSync(outside), ["keep.txt"], "nothing written outside");
  assert.equal(readFileSync(join(root, "coherence.config.json"), "utf8"), "{}\n", "and nothing to the config");

  const read = (source: string): string[] => readPlugins(root, { ts: source }, "coherence.config.json", [], () => undefined).problems;
  assert.match(read("./escape/ts").join("\n"), /plugins\.ts is "\.\/escape\/ts", which leaves the project/);
  assert.match(read("./dangling/ts").join("\n"), /plugins\.ts is "\.\/dangling\/ts", which passes through a symbolic link that leads nowhere/);
});

test("eject's guard reads every import with the parser: a dynamic import, a require or an export from that leaves the plugin's folder is refused, and the core's own import is rewritten in whatever quotes it is written", () => {
  for (const text of ["const m = await import('../../src/adapters/adapter.ts');\n", 'const m = require("../../src/adapters/adapter.ts");\n', 'export * from "../python/python.ts";\n', "import type { A } from '../../src/adapters/adapter.ts';\n"]) {
    assert.throws(() => ejectedSource("index.ts", text), (e: unknown) => e instanceof EjectError && /index\.ts imports \.\.\/.* which leaves the plugin's folder/.test(e.message), text);
  }
  assert.equal(ejectedSource("index.ts", "import { a } from '../../src/plugins/api.ts';\nconst b = await import('./b.ts');\n"), `import { a } from "${PACKAGE_SPECIFIER}";\nconst b = await import('./b.ts');\n`);
});

test("plugin check holds a plugin that both extends a language and proves via forms to both: the language's four duties, then one duty per form, in that order", async () => {
  const typescript = JSON.parse(readFileSync(join(PLUGIN_SOURCES, "typescript", "check.json"), "utf8")) as Record<string, unknown>;
  const root = project({
    "both/plugin.json": JSON.stringify({ name: "both", version: "0.1.0", pluginApi: 2, extends: "typescript", module: "./index.ts", verifiers: [{ form: "both exit", evidence: "exit-checked", command: ["node", "-e", "process.exit(process.argv[1] === 'ok' ? 0 : 1)", "{name}"] }] }),
    "both/index.ts": "export default { adapter: ({ base }) => ({ language: base.language, ladder: base.ladder, ready: () => base.ready(), resolve: (n, h) => base.resolve(n, h), references: (d) => base.references(d), visibility: (d, c) => base.visibility(d, c), testFilter: (v) => base.testFilter(v), refute: (p, o, e, c) => base.refute(p, o, e, c), forget: (f) => base.forget(f), close: async () => {} }) };\n",
    "both/check.json": JSON.stringify({ ...typescript, proofs: [{ via: "[both exit] ok", verdict: "pass" }, { via: "[both exit] no", verdict: "fail" }] }),
  });
  const checked = await checkPlugin(root, "./both");
  assert.equal(checked.language, "typescript + verifier");
  assert.deepEqual(checked.duties.map((d) => [d.name, d.verdict]), [["file rule", "pass"], ["declarations", "pass"], ["references", "pass"], ["chokepoint", "pass"], ["[both exit]", "pass"]], JSON.stringify(checked.duties));
});
