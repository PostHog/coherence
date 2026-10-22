/**
 * The Convex plugin (plugins/convex): opt-in and bundled, extending
 * TypeScript. A project that names it has a Convex function reached through
 * the generated API read as a reference, and its deployment's functions,
 * routes and crons detected as entrances; a project that does not name it
 * reads nothing of it.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { performRun } from "../enforcement/run.ts";
import type { RunEntry } from "../enforcement/record.ts";
import { instrumentFor } from "../adapters/index.ts";
import { detectEntranceCandidates } from "../adapters/entrance-candidates.ts";
import { countingFs } from "../lifecycle/fs-count-fixture.ts";
import { loadProjectLexicons } from "../lifecycle/project.ts";
import { loadSpecModel } from "../spec/model.ts";
import { checkPlugin } from "./check.ts";
import { entranceRules, pluginWellKnown } from "./languages.ts";
import { BUNDLED_DIR } from "./registry.ts";
import { generatedApiReferences } from "../../plugins/convex/convex-api.ts";

const CONVEX = join(BUNDLED_DIR, "convex");
const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-convex-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return root;
}

/** The Convex project the plugin's check.json carries: a protected internal action, its chokepoint, a leak through an aliased API, a cron, routes. */
const FIXTURE = (JSON.parse(readFileSync(join(CONVEX, "check.json"), "utf8")) as { files: Record<string, string> }).files;

const SPEC = `# Telemetry

What leaves the deployment.

## invariants
- one way out: Telemetry is sent only when an event is recorded.
  protects: send
  chokepoint: record
  because: an event sent twice is counted twice
  kinds: none
`;

const ENABLED = JSON.stringify({ language: "typescript", plugins: { convex: "bundled" } });

test("the Convex plugin grades a Convex project's chokepoint: a function reached through the generated API outside it is a bypass, its refutation stages that path, and the run names the plugin; without the plugin the same project sees none of it", async () => {
  const graded = async (config: string): Promise<RunEntry> => {
    const root = project({ ...FIXTURE, "coherence.config.json": config, "Telemetry.spec.md": SPEC });
    const adapter = instrumentFor("typescript", root, readEnforcementConfig(root));
    try {
      return (await performRun(root, { session: "convex", agent: "test", adapter, form: "chokepoint", server: false })).record.invariants.find((e) => e.name === "one way out")!;
    } finally {
      await adapter.close();
    }
  };
  const entry = await graded(ENABLED);
  assert.equal(entry.grade, "broken", entry.reason);
  assert.deepEqual((entry.bypasses ?? []).map((b) => `${b.file}:${b.line}`).sort(), ["convex/crons.ts:5", "convex/leak.ts:11"], "the cron and the aliased call across lines; the comment, the string and the longer name are none");
  assert.equal(entry.refutation, "automatic", entry.reason);
  assert.deepEqual(entry.plugins, [{ name: "convex", version: "0.1.0" }], "the entry names the plugin that answered");

  const blind = await graded(JSON.stringify({ language: "typescript" }));
  assert.deepEqual(blind.bypasses ?? [], [], "the language server alone never links internal.telemetry.send back to send");
});

test("a reference through the generated API is read from the syntax tree: under any local name, across lines and static brackets, never in a comment, a string, a template or a regular expression, never a longer name or another folder's API", () => {
  const target = { folder: "convex", path: ["telemetry"], names: ["send"] };
  const at = (file: string, text: string): string[] => generatedApiReferences(file, text, target).map((s) => `${s.line + 1}:${s.symbol ?? "top"}`);
  const text = [
    'import { internal as gen, api } from "./_generated/api";', // 1
    "// gen.telemetry.send", // 2
    'const a = "gen.telemetry.send";', // 3
    "const b = `${gen.telemetry.send}` + `gen.telemetry.send`;", // 4
    "const c = /gen.telemetry.send/;", // 5
    "const d = gen.telemetry.sendAll;", // 6
    'export function e() { return gen["telemetry"]["send"]; }', // 7
    "const f = api", // 8
    "  .telemetry", // 9
    "  .send;", // 10
  ].join("\n");
  assert.deepEqual(at("convex/caller.ts", text), ["4:b", "7:e", "8:f"]);
  assert.deepEqual(at("convex/caller.ts", 'import { internal } from "@/myconvex/_generated/api";\nconst x = internal.telemetry.send;\n'), [], "an alias ending in another folder's name names another API");
  assert.deepEqual(at("src/client.ts", 'import { api } from "@/convex/_generated/api";\nconst x = api.telemetry.send;\n'), ["2:x"], "a path alias ending in the folder's name, from outside it");
  assert.deepEqual(at("other/caller.ts", 'import { internal } from "./_generated/api";\nconst x = internal.telemetry.send;\n'), [], "a relative import resolving to another folder's API");
});

test("a Convex deployment's public functions, HTTP routes and crons are entrances when the project runs the Convex plugin: an internal function, a file outside the functions folder and a namesake are not", () => {
  const files = Object.keys(FIXTURE);
  const read = (file: string): string | undefined => FIXTURE[file];
  const detect = (config: string): string[] => {
    const root = project({ "coherence.config.json": config });
    readEnforcementConfig(root);
    return detectEntranceCandidates(root, { language: "typescript", files, wrappers: [], testFolders: ["__tests__"], read }).map((c) => `${c.rule}: ${c.file}:${c.line} ${c.symbol}`).sort();
  };
  const convex = detect(ENABLED).filter((c) => c.startsWith("Convex"));
  assert.deepEqual(convex, [
    "Convex HTTP route: convex/http.ts:6 webhook",
    "Convex HTTP route: convex/http.ts:7 ",
    "Convex cron: convex/crons.ts:5 send",
    "Convex function: convex/events.ts:5 record",
    "Convex function: convex/leak.ts:7 flush",
  ]);
  assert.deepEqual(detect(JSON.stringify({ language: "typescript" })).filter((c) => c.startsWith("Convex")), [], "a project that does not name the plugin detects none of them");
});

test("a project that does not name the Convex plugin pays nothing for it: no file of the plugin read, no rule, no well-known name, no vocabulary; one that names it gets each", async () => {
  const bare = project({ "coherence.config.json": JSON.stringify({ language: "typescript" }), "Demo.spec.md": "# Demo\n\n## invariants\n" });
  const { fs } = await countingFs(async () => {
    readEnforcementConfig(bare);
    loadSpecModel(bare);
    await loadProjectLexicons(bare);
  });
  assert.deepEqual(Object.keys(fs.paths).filter((key) => key.includes(CONVEX)), [], "no path of the plugin is touched");
  readEnforcementConfig(bare);
  assert.ok(!entranceRules("typescript").some((r) => r.rule.startsWith("Convex")));
  assert.ok(!pluginWellKnown().includes("Convex"));
  assert.ok(!(await loadProjectLexicons(bare)).coherence.concepts.some((c) => c.name === "Convex function"));

  const enabled = project({ "coherence.config.json": ENABLED, "Demo.spec.md": "# Demo\n\n## invariants\n" });
  readEnforcementConfig(enabled);
  assert.deepEqual(entranceRules("typescript").filter((r) => r.rule.startsWith("Convex")).map((r) => r.rule), ["Convex function", "Convex HTTP route", "Convex cron"]);
  assert.ok(pluginWellKnown().includes("Convex"));
  assert.equal((await loadProjectLexicons(enabled)).coherence.concepts.find((c) => c.name === "Convex function")?.layer, "convex", "its vocabulary is its own layer");
});

test("plugin check holds a plugin that extends a language to that language's duties: the Convex plugin passes TypeScript's minimum and its own check project, a Convex chokepoint graded through it", async () => {
  const checked = await checkPlugin(process.cwd(), "convex");
  assert.equal(checked.language, "typescript", "the language it extends");
  assert.deepEqual(checked.duties.map((d) => [d.name, d.verdict]), [["file rule", "pass"], ["declarations", "pass"], ["references", "pass"], ["chokepoint", "pass"]], JSON.stringify(checked.duties));
  for (const duty of checked.duties) assert.match(duty.reason, /the bundled minimum: .*; plugin convex's own: /, `${duty.name} is held over both projects`);
  assert.match(checked.duties.find((d) => d.name === "references")!.reason, /plugin convex's own: 3 of 3 references to send/);
});
