/**
 * The plugin interface over a fixture plugin loaded by path (fixtures/sample):
 * its adapter wraps the TypeScript adapter and answers a chokepoint check, its
 * verifier proves bullets through its via forms, its lexicon layer joins the
 * stack, and the registry refuses what cannot be run. A project without a
 * plugins key reads nothing of any plugin.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { instrumentFor } from "../adapters/index.ts";
import { locateServer } from "../adapters/typescript.ts";
import { checkChokepoint } from "../enforcement/check.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { performRun } from "../enforcement/run.ts";
import { declaredClasses } from "../journal/defects.ts";
import { countingFs } from "../lifecycle/fs-count-fixture.ts";
import { rejectedNames, renderCompact } from "../lifecycle/lexicon.ts";
import { loadProjectLexicons } from "../lifecycle/project.ts";
import { loadSpecModel } from "../spec/model.ts";
import { PluginAdapter } from "./adapter.ts";
import { BUNDLED_DIR } from "./registry.ts";

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "sample");
const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-plugins-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return root;
}

const TSCONFIG = `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true }, "include": ["src/**/*.ts"] }`;
const SECRETS = `export const SECRET_COLUMNS = { tokens: ["token"] };

export function seal(pattern: keyof typeof SECRET_COLUMNS, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const column of SECRET_COLUMNS[pattern]) delete out[column];
  return out;
}
`;
const RENDER = `import { seal } from "../store/secrets.ts";

export function render(row: Record<string, unknown>): string {
  return JSON.stringify(seal("tokens", row));
}
`;

const SPEC = `# Demo

A store with one door out.

## invariants
- sealed egress: A secret column is read only through seal.
  protects: SECRET_COLUMNS
  chokepoint: seal
  because: a row that leaves carries no token
  kinds: none
- the model holds: The sample model holds.
  over: the sample model
  via: [sample prove] holds
  because: the model states it once over every sequence
  kinds: none
- the model breaks: The sample model breaks.
  over: the sample model
  via: [sample prove] breaks
  because: a counterexample is a failure
  kinds: none
- the exit holds: The sample exit holds.
  over: the sample exit
  via: [sample exit] ok
  because: a command a plugin names is graded by its exit
  kinds: none
`;

test("a plugin that extends a language answers its chokepoint checks: the adapter is the plugin's, wrapping the core's, and the run entry names the plugin", async () => {
  const root = project({
    "tsconfig.json": TSCONFIG,
    "coherence.config.json": JSON.stringify({ language: "typescript", plugins: { sample: SAMPLE } }),
    "Demo.spec.md": SPEC,
    "src/store/secrets.ts": SECRETS,
    "src/api/render.ts": RENDER,
  });
  assert.ok(locateServer(process.cwd()).found, "typescript-language-server must be installed: npm install");
  const config = readEnforcementConfig(root);
  assert.deepEqual(config.plugins.map((p) => [p.name, p.version]), [["sample", "0.1.0"]]);
  const adapter = instrumentFor("typescript", root, config);
  assert.ok(adapter instanceof PluginAdapter, "the plugin wraps the language it extends");
  assert.deepEqual((adapter as PluginAdapter).plugins, [{ name: "sample", version: "0.1.0" }]);
  try {
    const checked = await checkChokepoint(adapter, { protects: "SECRET_COLUMNS", chokepoint: "seal", component: ".", testFolders: config.testFolders, root });
    assert.equal(checked.verdict, "pass", checked.reason);
    assert.match(checked.visibility ?? "", /^the sample plugin answered: /, "the visibility evidence is the plugin's adapter's");
    const outcome = await performRun(root, { session: "plugins", agent: "test", adapter, form: "chokepoint", server: false });
    const entry = outcome.record.invariants.find((e) => e.name === "sealed egress")!;
    assert.equal(entry.verdict, "pass", entry.reason);
    assert.deepEqual(entry.plugins, [{ name: "sample", version: "0.1.0" }], "the entry names the plugin that answered");
  } finally {
    await adapter.close();
  }
});

test("a via form is proved by the plugin that declares it, graded like a test with its evidence label; a form no plugin declares is a spec problem naming the forms loaded", async () => {
  const root = project({
    "coherence.config.json": JSON.stringify({ language: "typescript", plugins: { sample: SAMPLE } }),
    "Demo.spec.md": SPEC.replace("  via: [sample exit] ok", "  via: [sample exit] ok\n- an unknown form: Nothing proves it.\n  over: nothing\n  via: [nobody proves] this\n  because: a form no plugin declares\n  kinds: none"),
  });
  const model = loadSpecModel(root);
  const unknown = model.problems.find((p) => p.message.includes("[nobody proves]"));
  assert.ok(unknown !== undefined, "a form no plugin declares is a spec problem");
  assert.match(unknown.message, /the forms loaded: \[sample prove\] \(sample\), \[sample exit\] \(sample\)/);
  assert.equal(model.problems.filter((p) => p.message.includes("via [sample prove] is a form")).length, 0, "a declared form is no problem");
  const outcome = await performRun(root, { session: "plugins", agent: "test", form: "totality oracle", invariants: ["the model holds", "the model breaks", "the exit holds"], server: false });
  const by = new Map(outcome.record.invariants.map((e) => [e.name, e]));
  assert.equal(by.get("the model holds")!.verdict, "pass", by.get("the model holds")!.reason);
  assert.equal(by.get("the model breaks")!.verdict, "fail");
  assert.match(by.get("the model breaks")!.reason, /counterexample/);
  assert.equal(by.get("the exit holds")!.verdict, "pass", by.get("the exit holds")!.reason);
  assert.deepEqual([by.get("the model holds")!.evidence, by.get("the exit holds")!.evidence], ["model-checked", "exit-checked"]);
  assert.deepEqual(by.get("the model holds")!.plugins, [{ name: "sample", version: "0.1.0" }]);
});

test("two plugins that provide one language are refused with both named, and so is a plugin written for another pluginApi", () => {
  const manifest = (name: string, extra: Record<string, unknown>): Record<string, string> => ({ [`plugins/${name}/plugin.json`]: JSON.stringify({ name, version: "1.0.0", pluginApi: 1, module: "./index.ts", ...extra }) });
  const twice = project({
    ...manifest("one", { provides: { language: "typescript" } }),
    ...manifest("two", { provides: { language: "typescript" } }),
    "coherence.config.json": JSON.stringify({ plugins: { one: "./plugins/one", two: "./plugins/two" } }),
  });
  assert.throws(() => readEnforcementConfig(twice), /plugins one and two both provide language typescript; keep one/);
  const older = project({
    ...manifest("old", { pluginApi: 0, provides: { language: "typescript" } }),
    "coherence.config.json": JSON.stringify({ plugins: { old: "./plugins/old" } }),
  });
  assert.throws(() => readEnforcementConfig(older), /plugin old was written for pluginApi 0; this Coherence runs pluginApi 1/);
  const misnamed = project({ ...manifest("real", {}), "coherence.config.json": JSON.stringify({ plugins: { alias: "./plugins/real" } }) });
  assert.throws(() => readEnforcementConfig(misnamed), /the plugin keyed alias names itself "real"/);
  assert.ok(loadSpecModel(twice).problems.some((p) => p.file === "coherence.config.json" && /both provide language typescript/.test(p.message)), "the spec check says it too");
});

test("a plugin's lexicon layer joins the stack: its terms count as declared and show their layer, its rejected names stay its own, its defect classes are read, and a clash is reported until the project settles it", async () => {
  const root = project({ "coherence.config.json": JSON.stringify({ plugins: { sample: SAMPLE } }) });
  const layers = await loadProjectLexicons(root);
  const goal = layers.coherence.concepts.find((c) => c.name === "proof goal");
  assert.equal(goal?.layer, "sample", "the plugin's concept joins the tool layer, tagged with its plugin");
  assert.equal(layers.coherence.concepts.filter((c) => c.name === "journal").length, 1, "a clashing concept never merges silently");
  assert.deepEqual(layers.clashes?.map((c) => [c.plugin, c.name, c.with]), [["sample", "journal", "Coherence"]]);
  assert.ok(!rejectedNames(layers.coherence).some((r) => r.name === "lemma"), "a plugin's rejected name governs only its own terms");
  assert.match(renderCompact(layers.coherence, layers.project), /\nPlugin sample vocabulary \(1 concepts, 0\.1\.0\):\n- proof goal: /);
  assert.ok(declaredClasses(root).has("sample-drift"), "a class a plugin's layer declares is a legal --class");
  assert.ok(loadSpecModel(root).problems.some((p) => /plugin sample's concept "journal" names "journal", which Coherence already declares/.test(p.message)), "the spec check reports the clash");
  const settled = project({ "coherence.config.json": JSON.stringify({ plugins: { sample: SAMPLE } }), "lexicon.json": JSON.stringify({ concepts: [{ name: "journal", definition: "This project's journal." }] }) });
  assert.deepEqual((await loadProjectLexicons(settled)).clashes, [], "the project lexicon declaring the name settles the clash");
});

test("a project without a plugins key reads nothing of any plugin: no manifest, no lexicon layer, no bundled folder", async () => {
  const root = project({ "coherence.config.json": JSON.stringify({ language: "typescript" }), "Demo.spec.md": "# Demo\n\n## invariants\n" });
  const { fs } = await countingFs(async () => {
    readEnforcementConfig(root);
    loadSpecModel(root);
    await loadProjectLexicons(root);
    declaredClasses(root);
  });
  const read = Object.keys(fs.paths).filter((key) => key.includes("plugin.json") || key.includes(BUNDLED_DIR) || key.includes(SAMPLE));
  assert.deepEqual(read, [], "no plugin path is touched");
  assert.equal(readEnforcementConfig(root).plugins.length, 0);
});

test("a session start carries a plugin's vocabulary only while its surface is in use: a language it extends among the project's, or a via form it proves on a bullet", async () => {
  const { startReading } = await import("../lifecycle/hook.ts");
  const python = project({ "coherence.config.json": JSON.stringify({ language: "python", plugins: { sample: SAMPLE } }), "Demo.spec.md": "# Demo\n\n## invariants\n" });
  assert.doesNotMatch((await startReading(python)).text, /Plugin sample vocabulary/, "a Python project with no sample via is out of the plugin's way");
  const proved = project({ "coherence.config.json": JSON.stringify({ language: "python", plugins: { sample: SAMPLE } }), "Demo.spec.md": SPEC });
  assert.match((await startReading(proved)).text, /Plugin sample vocabulary/, "a bullet proved by its form puts it in the way");
  const typescript = project({ "coherence.config.json": JSON.stringify({ language: "typescript", plugins: { sample: SAMPLE } }), "Demo.spec.md": "# Demo\n\n## invariants\n" });
  assert.match((await startReading(typescript)).text, /Plugin sample vocabulary/, "a language it extends puts it in the way");
});
