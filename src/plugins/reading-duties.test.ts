/**
 * plugin check's reading duties: a language plugin is held to what each
 * reading that scans its text recovers over its check project, so a reading
 * whose answer is only its type (a scan that reads nothing) fails by name,
 * and a language whose check project names no readings fails each as
 * nothing to check (d-6569dec0: no plugin waives a reading).
 */

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { budget } from "../enforcement/test-budgets.ts";
import { checkPlugin } from "./check.ts";
import { PLUGIN_SOURCES } from "./eject.ts";
import { PARSER_RESOLVE, writeParserPlugin } from "./fixtures/parser-plugin.ts";

const fixtures: string[] = [];

after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-reading-duties-"));
  fixtures.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const READINGS = ["mass", "imports", "interfaces", "entrances"];

const STAND_IN = 'export default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => via, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n';

test("plugin check holds a language plugin to every reading of its text: a source scan that reads nothing fails mass, imports and interfaces by what each missed, and a language with no readings named fails each as nothing to check", async () => {
  // A plugin in typescript's place that reads through TypeScript's parser with queries that capture nothing: a scan that answers in its type and reads nothing, as Rust's source slot did at 04d5fde.
  const root = project({
    "blind/plugin.json": JSON.stringify({ name: "blind", version: "0.1.0", pluginApi: 2, provides: { language: "typescript" }, extends: "typescript", module: "./index.ts", treeSitter: { parser: "tree-sitter-tsx.wasm", queries: "blind.scm", resolve: "resolve.ts#RESOLVE" } }),
    "blind/index.ts": "export default { adapter: ({ base }) => base };\n",
    "blind/blind.scm": "; captures nothing: no import and no declaration is read\n",
    "blind/resolve.ts": PARSER_RESOLVE,
  });
  cpSync(join(PLUGIN_SOURCES, "typescript", "tree-sitter-tsx.wasm"), join(root, "blind", "tree-sitter-tsx.wasm"));
  cpSync(join(PLUGIN_SOURCES, "typescript", "check.json"), join(root, "blind", "check.json"));
  // A plugin that provides a language no bundled plugin does, read through a parser, its check.json naming no readings, as every plugin before the reading duties.
  writeParserPlugin(join(root, "zz"), {}, {
    "index.ts": STAND_IN,
    "check.json": JSON.stringify({ files: { "app/a.zz": "def reset():\n    pass\n" }, language: { files: ["app/a.zz"], not: [] }, declarations: [{ file: "app/a.zz", name: "reset", declared: true }], protects: "reset", chokepoint: "reset", references: ["app/a.zz:1"], grade: "reference-choked", bypasses: [] }),
  });

  const blind = await checkPlugin(root, "./blind");
  const byName = (name: string) => blind.duties.find((d) => d.name === name)!;
  for (const name of ["mass", "imports", "interfaces"]) assert.equal(byName(name).verdict, "fail", `${name}: ${byName(name).reason}`);
  assert.match(byName("mass").reason, /src\/store\/secrets\.ts: missed SECRET_COLUMNS, seal/);
  assert.match(byName("imports").reason, /missed .*src\/api\/render\.ts -> src\/store\/secrets\.ts \(SECRET_COLUMNS, seal\)/);
  assert.match(byName("interfaces").reason, /missed src\/api -> src\/store \(Row, SECRET_COLUMNS, seal\)/);
  assert.equal(byName("entrances").verdict, "pass", "entrance detection reads its own slot, which the blind plugin leaves the bundled one");

  const zz = await checkPlugin(root, "./zz");
  for (const name of READINGS) {
    const duty = zz.duties.find((d) => d.name === name)!;
    assert.equal(duty.verdict, "fail", `${name}: ${duty.reason}`);
    assert.match(duty.reason, /nothing to check: no check project names what the \w+ reading recovers/);
  }
});

// The bundled plugins that provide a language, read from their manifests: one test each, so each plugin check pays only for its own server.
const PROVIDERS = readdirSync(PLUGIN_SOURCES)
  .filter((name) => existsSync(join(PLUGIN_SOURCES, name, "plugin.json")))
  .map((name) => [name, JSON.parse(readFileSync(join(PLUGIN_SOURCES, name, "plugin.json"), "utf8")) as { provides?: { language?: string }; notScanned?: string }] as const)
  .filter(([, manifest]) => manifest.provides?.language !== undefined);

// Grouped under the titles the bullets name, so a run that maps tests back by exact title finds every one (a via names a test or a group, never a prefix of titles).
describe("every bundled language plugin's check project names what each reading recovers, and the plugin recovers it", () => {
  test("the bundled language plugins, none carrying notScanned", () => {
    assert.deepEqual(PROVIDERS.map(([name]) => name).sort(), ["go", "python", "rust", "typescript"]);
    assert.deepEqual(PROVIDERS.filter(([, manifest]) => manifest.notScanned !== undefined).map(([name]) => name), [], "no bundled plugin carries notScanned");
  });

  describe("every bundled language plugin passes every duty of its own plugin check", () => {
    for (const [language] of PROVIDERS) {
      test(language, async (t) => {
        budget(t, 20, "d-23f7f8eb");
        const checked = await checkPlugin(process.cwd(), language);
        for (const name of READINGS) {
          const duty = checked.duties.find((d) => d.name === name)!;
          assert.equal(duty.verdict, "pass", `${language} ${name}: ${duty.reason}`);
        }
        // Every duty, the adapter's among them: a check project edited for one duty and stale for another fails here, not at an adopter's plugin check (df-11317061).
        assert.deepEqual(checked.duties.filter((d) => d.verdict !== "pass").map((d) => `${d.name}: ${d.reason}`), [], `${language}'s own plugin check`);
      });
    }
  });
});
