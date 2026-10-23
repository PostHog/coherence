/**
 * The abstract plugin spec: every plugin held to the bullets its shape calls
 * for, whether or not its author wrote a spec; its own spec setting one aside
 * only with why; and a bullet that holds with the plugin's reading emptied
 * failing, since it proves nothing of the plugin.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { computeMass } from "../economy/mass.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { parseSpec } from "../spec/grammar.ts";
import { abstractBullets, holdsFor, overrideProblems, SHAPES, unsaidReadings } from "./abstract.ts";
import { checkPlugin, DUTY_NAMES, EMPTIED, LANGUAGE_DUTIES } from "./check.ts";
import { bundledPlugins } from "./languages.ts";
import { SYNTAX_SLOTS, type LoadedPlugin, type PluginManifest } from "./plugin.ts";
import { BUNDLED_DIR } from "./registry.ts";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-abstract-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return root;
}

const plugin = (manifest: Partial<PluginManifest>): LoadedPlugin => ({ name: "p", version: "0.1.0", dir: "/nowhere", source: "./p", manifest: { name: "p", version: "0.1.0", pluginApi: 2, ...manifest } });
const held = (manifest: Partial<PluginManifest>): string[] => abstractBullets().filter((b) => holdsFor(b, plugin(manifest))).map((b) => b.name);

test("the abstract plugin spec is the duties plugin check runs: each bullet names a duty it grades, each duty is a bullet, each holds for a shape a manifest can have, and each read from a slot says its empty answer", () => {
  const bullets = abstractBullets();
  assert.deepEqual(bullets.map((b) => b.name).sort(), [...DUTY_NAMES].sort());
  const slots: readonly string[] = SYNTAX_SLOTS;
  for (const bullet of bullets) {
    assert.ok(bullet.holds.length > 0, `${bullet.name} holds for no shape`);
    for (const shape of bullet.holds) assert.ok((SHAPES as readonly string[]).includes(shape) || slots.includes(/^slot\s+(\w+)$/.exec(shape)?.[1] ?? ""), `${bullet.name} holds for "${shape}", no shape a manifest has`);
    assert.notEqual(bullet.reads, "", `${bullet.name} says what it reads`);
    if (EMPTIED[bullet.name as keyof typeof EMPTIED] !== undefined) assert.ok(bullet.emptied !== undefined, `${bullet.name} is graded again emptied, so it says its empty answer`);
  }
});

test("every plugin is held to the abstract spec by its shape, whether or not it wrote a spec: a provider owes every reading of its language, one that extends a language owes its adapter's and the slots it fills, a verifier its forms, a lexicon layer no clash", () => {
  assert.deepEqual(held({ provides: { language: "zz" } }), [...LANGUAGE_DUTIES], "a provider that fills no slot still owes each reading, and fails or overrides it");
  assert.deepEqual(held({ extends: "typescript", syntax: { entrances: "e.ts#E" }, lexicon: "lexicon.json" }), ["entrances", "references", "chokepoint", "one answer each", "lexicon"]);
  assert.deepEqual(held({ verifiers: [{ form: "zz", evidence: "zz-checked", command: ["zz", "{name}"] }] }), ["verifier forms"]);
  assert.deepEqual(held({}), [], "nothing holds for a plugin of no shape, which plugin check refuses");
});

test("a plugin's own spec sets an abstract bullet aside only under ## overrides with because: one without why, one naming no bullet, or one beside no plugin.json is a spec problem, and plugin check says each override with its why", async () => {
  const parsed = parseSpec("# Zz\n\nThe zz plugin.\n\n## overrides\n- source: nothing reads it\n  because: zz has no imports\n- entrances: none detected\n- reach: nothing\n  because: a reason\n", "plugins/zz/Zz.spec.md");
  assert.deepEqual(parsed.overrides.map((o) => [o.name, o.because]), [["source", "zz has no imports"], ["entrances", undefined], ["reach", "a reason"]]);
  assert.match(parsed.problems.map((p) => p.message).join("\n"), /override entrances needs because:/);
  const plugged = project({ "plugins/zz/plugin.json": "{}" });
  assert.deepEqual(overrideProblems(parsed.overrides, join(plugged, "plugins/zz")).map((p) => p.message), [`override reach names no bullet of the abstract plugin spec (plugins/Plugin.abstract.md); its bullets: ${abstractBullets().map((b) => b.name).join(", ")}`]);
  assert.match(overrideProblems(parsed.overrides, plugged)[0]!.message, /belongs in a plugin's spec, beside its plugin\.json/);

  const go = await checkPlugin(process.cwd(), "go", { only: ["source", "entrances"] });
  assert.deepEqual(go.duties.map((d) => [d.name, d.verdict]), [["source", "overridden"], ["entrances", "overridden"]]);
  assert.match(go.duties[1]!.reason, /declared under ## entrances, never detected; because no entrance rule is written for Go yet/);
});

/** The zz plugin's check project, its interfaces asked of one line alone. */
const CHECK = { files: { "a.zz": "type Row\nverb list\n" }, language: { files: ["a.zz"], not: [] }, declarations: [{ file: "a.zz", name: "list", declared: true }], protects: "Row", chokepoint: "list", references: [], grade: "broken", bypasses: [] };

/** A plugin for a language of its own, zz: a top-level slot, an interfaces slot that knows `type` lines, and an adapter that answers nothing. */
function zz(extra: Record<string, string> = {}): string {
  return project({
    "coherence.config.json": JSON.stringify({ language: ["zz"], plugins: { zz: "./plugins/zz" } }),
    "plugins/zz/plugin.json": JSON.stringify({ name: "zz", version: "0.1.0", pluginApi: 2, provides: { language: "zz" }, module: "./index.ts", extensions: [".zz"], syntax: { topLevel: "zz.ts#zzTopLevel", interfaces: "zz.ts#ZZ_INTERFACES" } }),
    "plugins/zz/index.ts": 'export default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => via, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n',
    "plugins/zz/zz.ts": 'export const zzTopLevel = (text, name) => text.split("\\n").some((l) => l.endsWith(` ${name}`));\nexport const ZZ_INTERFACES = { isTypeDeclaration: (line) => line.startsWith("type "), isDefaultExport: () => false, serverBounds: false, importLists: () => [], defaultNames: () => [], wildcardModules: () => [] };\n',
    "plugins/zz/check.json": JSON.stringify({ ...CHECK, interfaces: { types: [{ line: "verb list", type: false }], wildcards: [] } }),
    ...extra,
  });
}

test("a bullet a plugin passes with its slot emptied proves nothing of it, and fails: plugin check grades each slot's bullet again with the plugin's answer taken away", async () => {
  const root = zz();
  const vacuous = await checkPlugin(root, "./plugins/zz", { only: ["interfaces", "declarations"] });
  const interfaces = vacuous.duties.find((d) => d.name === "interfaces")!;
  assert.equal(interfaces.verdict, "fail", "only a line read as no type: the empty answer reads it so too");
  assert.match(interfaces.reason, /^holds with the plugin's interfaces emptied too, so check\.json asks nothing the plugin alone answers/);
  assert.equal(vacuous.duties.find((d) => d.name === "declarations")!.verdict, "pass", "a name declared, which the emptied topLevel slot cannot say");

  writeFileSync(join(root, "plugins/zz/check.json"), JSON.stringify({ ...CHECK, interfaces: { types: [{ line: "verb list", type: false }, { line: "type Row", type: true }], wildcards: [] } }));
  const proven = await checkPlugin(root, "./plugins/zz", { only: ["interfaces"] });
  assert.deepEqual(proven.duties.map((d) => [d.name, d.verdict]), [["interfaces", "pass"]]);
  assert.match(proven.duties[0]!.reason, /with the plugin's interfaces emptied it fails$/);
});

test("a plugin that leaves a reading out says so: with no override the session start names each reading plugin check will fail, and with its spec's overrides it names them as not held and mass names the language not read with the override's why", async () => {
  const { startReading } = await import("../lifecycle/hook.ts");
  const silent = zz();
  assert.match((await startReading(silent)).text, /^Plugin zz gives no source, declares, entrances reading and its spec overrides none of them: plugin check zz fails each until the plugin reads it or its spec says why under ## overrides\.$/m);

  const said = zz({ "plugins/zz/Zz.spec.md": "# Zz\n\nThe zz plugin.\n\n## overrides\n- source: no text scan reads zz\n  because: zz has no imports to read\n- declares: read as unknown\n  because: nothing asks it\n- entrances: declared, never detected\n  because: zz has no entrances of its own\n" });
  const text = (await startReading(said)).text;
  assert.doesNotMatch(text, /Plugin zz gives no/);
  assert.match(text, /^Plugin zz is not held to source, declares, entrances of the abstract plugin spec, as its own spec says with why; those readings of its language are not read\.$/m);
  readEnforcementConfig(said);
  const unread = computeMass(said).languages.unread;
  assert.deepEqual(unread.map((u) => u.language), ["zz"]);
  assert.equal(unread[0]!.because, "no text scan reads zz, because zz has no imports to read");
});

test("every bundled plugin holds the abstract spec's text readings over its check project, each failing with its slot emptied, or overrides it with why, and leaves no reading unsaid", async () => {
  const text = ["file rule", "declarations", "source", "interfaces", "declares", "entrances"];
  for (const name of ["typescript", "python", "rust", "go", "convex"]) {
    const checked = await checkPlugin(process.cwd(), name, { only: text });
    for (const duty of checked.duties) assert.ok(duty.verdict === "overridden" || (duty.verdict === "pass" && /emptied it fails/.test(duty.reason)), `${name} ${duty.name}: ${duty.verdict}: ${duty.reason}`);
    assert.ok(checked.duties.length > 0, name);
  }
  // The defaults, and Go, which a project opts into.
  const all = [...bundledPlugins(), { name: "go", version: "", dir: join(BUNDLED_DIR, "go"), source: "bundled", manifest: JSON.parse(readFileSync(join(BUNDLED_DIR, "go", "plugin.json"), "utf8")) as PluginManifest }];
  for (const p of all) assert.deepEqual(unsaidReadings(p), [], `${p.name} leaves a reading unsaid`);
});
