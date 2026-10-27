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
import { entranceRules, forProject, pluginWellKnown } from "./languages.ts";
import { BUNDLED_DIR } from "./registry.ts";
import { generatedApiReferences } from "../../plugins/convex/convex-reach.ts";
import { ConvexAdapter } from "../../plugins/convex/convex.ts";
import { checkChokepoint } from "../enforcement/check.ts";
import type { Definition, LanguageAdapter } from "../adapters/adapter.ts";

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
  assert.deepEqual((entry.bypasses ?? []).map((b) => `${b.file}:${b.line}`).sort(), ["convex/alias.ts:6", "convex/byname.ts:4", "convex/crons.ts:5", "convex/destructure.ts:3", "convex/leak.ts:11", "convex/namespace.ts:3", "convex/passed.ts:5", "src/relayed.ts:3"], "the cron, the aliased call across lines and every followed or unread use; the comment, the string and the longer name are none");
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
    "Convex function: convex/alias.ts:6 viaAlias",
    "Convex function: convex/byname.ts:4 byName",
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
  readEnforcementConfig(bare);
  assert.ok(forProject(enabled, () => entranceRules("typescript")).some((r) => r.rule === "Convex function"), "a question asked for a project inside forProject is answered for it, whichever was read last");
  assert.ok(!forProject(bare, () => entranceRules("typescript")).some((r) => r.rule === "Convex function"));
});

test("plugin check holds a plugin that extends a language to that language's duties: the Convex plugin passes TypeScript's minimum and its own check project, a Convex chokepoint graded through it", async () => {
  const checked = await checkPlugin(process.cwd(), "convex");
  assert.equal(checked.language, "typescript", "the language it extends");
  assert.deepEqual(checked.duties.map((d) => [d.name, d.verdict]), [["file rule", "pass"], ["declarations", "pass"], ["answers agree", "pass"], ["reference reading", "pass"], ["references", "pass"], ["server agrees", "pass"], ["chokepoint", "pass"], ["mass", "pass"], ["imports", "pass"], ["interfaces", "pass"], ["entrances", "pass"], ["one answer each", "pass"]], JSON.stringify(checked.duties));
  // The reference project is held over the check project that maps it, TypeScript's minimum; Convex's own maps none.
  for (const duty of checked.duties.filter((d) => d.name !== "one answer each" && d.name !== "reference reading")) assert.match(duty.reason, /the bundled minimum: .*; plugin convex's own: /, `${duty.name} is held over both projects`);
  assert.match(checked.duties.find((d) => d.name === "references")!.reason, /plugin convex's own: 9 of 9 references to send/);
});

/** The TypeScript adapter as a language server that links nothing through the generated API: what the Convex plugin wraps, with no server to start. */
function blindBase(): LanguageAdapter {
  const definition = (name: string, file: string, start: number, end: number): Definition => ({ name, kind: "symbol", file, range: { start: { line: start, character: 0 }, end: { line: end, character: 2 } }, selection: { line: start, character: 13 } });
  return {
    language: "typescript",
    ladder: { top: "reference-choked", because: "a stand-in", rungs: [{ grade: "reference-choked", enforcer: "Coherence's check", fact: "every reference is inside" }] },
    ready: async () => ({ ok: true }),
    resolve: async (name) => ({ ok: true, definition: name === "send" ? definition("send", "convex/telemetry.ts", 3, 3) : definition("record", "convex/events.ts", 4, 8) }),
    references: async () => [],
    visibility: async () => ({ enforced: false, visible: true, evidence: "exported" }),
    testFilter: (via) => via,
    refute: async () => ({ seen: true, staged: [], account: "a stand-in staged nothing" }),
    forget: async () => {},
    close: async () => {},
  };
}

test("a use of the generated API the Convex plugin cannot read through is a named gap that keeps the chokepoint from passing, never silence; an alias, a destructure, a namespace import and a re-exporting module are followed as references", async () => {
  const core = Object.fromEntries(["convex/_generated/api.d.ts", "convex/_generated/server.d.ts", "convex/telemetry.ts", "convex/events.ts"].map((f) => [f, FIXTURE[f]!]));
  const cases: { files: string[]; at: string; unread?: RegExp }[] = [
    { files: ["convex/alias.ts"], at: "convex/alias.ts:6" },
    { files: ["src/lib/api.ts", "src/relayed.ts"], at: "src/relayed.ts:3" },
    { files: ["convex/namespace.ts"], at: "convex/namespace.ts:3" },
    { files: ["convex/destructure.ts"], at: "convex/destructure.ts:3" },
    { files: ["convex/byname.ts"], at: "convex/byname.ts:4", unread: /names telemetry:send by string/ },
    { files: ["convex/passed.ts"], at: "convex/passed.ts:5", unread: /internal\.telemetry is passed on as a value/ },
  ];
  for (const { files, at, unread } of cases) {
    const root = project({ ...core, ...Object.fromEntries(files.map((f) => [f, FIXTURE[f]!])) });
    const graded = await checkChokepoint(new ConvexAdapter(root, blindBase()), { protects: "send", chokepoint: "record", component: ".", testFolders: ["__tests__"], root });
    assert.notEqual(graded.verdict, "pass", `${at}: ${graded.reason}`);
    assert.deepEqual(graded.bypasses.map((b) => `${b.file}:${b.line}`), [at], graded.reason);
    if (unread === undefined) assert.equal(graded.bypasses[0]!.unread, undefined, `${at} is read through, a reference`);
    else {
      assert.match(graded.bypasses[0]!.unread ?? "", unread);
      assert.match(graded.reason, /\(not read through: /, "the reason names the gap as one");
    }
  }
});
