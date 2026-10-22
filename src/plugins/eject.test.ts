/**
 * The eject, enhance and swap workflow: a bundled plugin copied into a
 * project with its tests, its import of the core named as a plugin outside
 * the package names it, the config pointed at the copy; and plugin check
 * holding any plugin to what every language plugin owes, a plugin that
 * reports no references failing by name.
 */

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { cli } from "../lifecycle/cli-fixture.ts";
import { checkPlugin } from "./check.ts";
import { ejectPlugin, EjectError, PACKAGE_SPECIFIER, PLUGIN_SOURCES } from "./eject.ts";

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
  assert.deepEqual(filesUnder(copy), filesUnder(join(PLUGIN_SOURCES, "typescript")), "every file of the bundled plugin, its check.json among them");
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
    "deaf/index.ts": "export default { adapter: ({ base }) => ({ language: base.language, ladder: base.ladder, ready: () => base.ready(), resolve: (n, h) => base.resolve(n, h), references: async () => [], visibility: (d, c) => base.visibility(d, c), testFilter: (v) => base.testFilter(v), refute: (p, o, e) => base.refute(p, o, e), forget: (f) => base.forget(f), close: async () => {} }) };\n",
  });
  cpSync(join(PLUGIN_SOURCES, "typescript", "check.json"), join(root, "deaf", "check.json"));
  const deaf = await checkPlugin(root, "./deaf");
  const references = deaf.duties.find((o) => o.name === "references")!;
  assert.equal(references.verdict, "fail");
  assert.match(references.reason, /^reports no references to SECRET_COLUMNS; 5 exist/);
  assert.notEqual(deaf.duties.find((o) => o.name === "chokepoint")!.verdict, "pass", "and no chokepoint is graded clean through it");

  rmSync(join(root, "deaf", "check.json"));
  const untested = await checkPlugin(root, "./deaf");
  assert.ok(untested.duties.every((o) => o.verdict === "fail" && /carries no check\.json/.test(o.reason)), "a plugin with no check project passes nothing");
});
