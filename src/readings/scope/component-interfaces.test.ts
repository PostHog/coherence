/**
 * The component interface reading at scale: bounded to the declared
 * components, prefiltered by one word index, and bounded in time and in the
 * language server's memory.
 *
 * Three kinds of evidence. A text-level stub server, which reports a
 * reference wherever a file spells the name (a real server reports no more),
 * counts every references question, so what is never asked is proved never
 * asked. Real servers over small projects that carry every escape hatch the
 * word index must not cut (a star import, an alias written in another file,
 * a renamed re-export, a wildcard re-export, a default export) prove the
 * prefiltered reading and the exhaustive one are the same. And Coherence's
 * own tree, read both ways through one warm server, is the whole-project
 * sameness check.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Definition, LanguageAdapter, ReferenceSite, Resolved } from "../../adapters/adapter.ts";
import { PythonAdapter } from "../../../plugins/python/python.ts";
import { TypeScriptAdapter } from "../../../plugins/typescript/typescript.ts";
import { projectFiles } from "../../adapters/project-files.ts";
import { COHERENCE_LEXICON } from "../../lifecycle/project.ts";
import { answerStructure } from "../query/query.ts";
import { buildScopePage } from "./build.ts";
import { proposeClosures, renderProposal, type Proposal } from "../../scaffold/control.ts";
import { callArguments, readComponentInterfaces, switchesOff } from "./component-interfaces.ts";
import { predictClosure } from "../../economy/closure.ts";
import { readInterfaceMap } from "../../observation/interfaces.ts";
import { loadSpecModel } from "../../spec/model.ts";
import { parseSpec } from "../../spec/grammar.ts";
import { readEnforcementConfig } from "../../enforcement/config.ts";
import { adapterCode, keptLine } from "./kept-answers.ts";
import { RpcError } from "../../adapters/jsonrpc.ts";
import { STRUCTURE_DIR, lastReading, recordReading, structureFingerprint, structureState } from "./gaps.ts";
import { readInterfacesApart } from "./apart.ts";
import type { InterfaceReading } from "./model.ts";
import { bothWays, sameMap } from "./both-ways.ts";
import { checked, routedProject } from "./routed-fixture.ts";
import { scopedUnsettled } from "./scoped-route.ts";
import { reliefNotes } from "./relief/data.ts";
import { flowOf } from "./structure-flow.ts";

const COHERENCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function project(files: Record<string, string>): { root: string; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), "coherence-bounded-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

const DECLARATION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|class|def)\s+([A-Za-z_$][\w$]*)/;

/**
 * A server that answers from the text alone: a name is resolved where a file
 * declares it at top level, and every whole-word spelling of it in any file,
 * the declaration aside, is a reference, enclosed by the nearest top-level
 * declaration above it. It never reports a site the text does not spell,
 * which is exactly what the word index relies on of a real server.
 */
class TextServer implements LanguageAdapter {
  readonly language = "typescript";
  readonly ladder = { top: "reference-choked" as const, because: "stub", rungs: [] };
  readonly asked: string[] = [];
  /** Every question put to it, a resolve or a references, by the file it is about. */
  readonly questions: string[] = [];
  readonly stall = new Set<string>();
  /** Files it fails every question about, with its words, as gopls fails a file outside the host's build. */
  readonly fail = new Map<string, string>();
  /** Files the server itself answers with an error, as tsserver returns its own crash on a question. */
  readonly refuse = new Map<string, string>();
  /** How many times a reading started it. */
  started = 0;
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  async ready(): Promise<{ ok: true }> {
    this.started += 1;
    return { ok: true };
  }
  private lines(file: string): string[] {
    return readFileSync(join(this.root, file), "utf8").split("\n");
  }
  async resolve(name: string): Promise<Resolved> {
    const [symbol, file] = name.split(/\s+in\s+/) as [string, string];
    this.questions.push(file);
    const line = this.lines(file).findIndex((l) => DECLARATION.exec(l)?.[1] === symbol);
    if (line === -1) return { ok: false, reason: `no ${symbol} in ${file}` };
    const character = this.lines(file)[line]!.indexOf(symbol);
    const at = { line, character };
    return { ok: true, definition: { name: symbol, kind: "symbol", file, range: { start: at, end: at }, selection: at } };
  }
  async references(definition: Definition): Promise<ReferenceSite[]> {
    this.asked.push(definition.name);
    this.questions.push(definition.file);
    if (this.stall.has(definition.name)) return new Promise(() => {});
    const failed = this.fail.get(definition.file);
    if (failed !== undefined) throw new Error(failed);
    const refused = this.refuse.get(definition.file);
    if (refused !== undefined) throw new RpcError("textDocument/references", -32603, refused);
    const sites: ReferenceSite[] = [];
    for (const file of projectFiles(this.root).filter((f) => /\.(ts|py)$/.test(f))) {
      let enclosing: string | undefined;
      this.lines(file).forEach((text, line) => {
        const declared = DECLARATION.exec(text)?.[1];
        if (declared !== undefined) enclosing = declared;
        for (const m of text.matchAll(new RegExp(`\\b${definition.name}\\b`, "g"))) {
          if (file === definition.file && line === definition.selection.line) continue;
          sites.push({ file, line: line + 1, character: m.index!, symbol: declared === definition.name && file === definition.file ? undefined : enclosing });
        }
      });
    }
    return sites;
  }
  async visibility(): Promise<never> {
    throw new Error("not asked");
  }
  testFilter(via: string): string {
    return via;
  }
  async refute(): Promise<never> {
    throw new Error("not asked");
  }
  async forget(): Promise<void> {}
  async close(): Promise<void> {}
}

/**
 * The bounded project: two components under src, an entrance, a folder the
 * config's ignore list bounds away (vendor), and a folder no spec owns
 * (loose). `lonely` is named nowhere else, `onlyVendor` only past the
 * bounds, `onlyLoose` only in code no component owns.
 */
const BOUNDED: Record<string, string> = {
  "coherence.config.json": JSON.stringify({ name: "bounded", entryDir: "src", language: "typescript", ignore: ["vendor"] }),
  "src/api/Api.spec.md": "# Api\n\nAsks the store.\n\n## entrances\n- go: work arrives\n  handler: go in src/api/api.ts\n\n## invariants\n",
  "src/store/Store.spec.md": "# Store\n\nHolds rows.\n\n## invariants\n",
  "src/store/rows.ts": "export function write(v: string): string {\n  return shape(v);\n}\nfunction shape(v: string): string {\n  return v;\n}\nexport function lonely(): void {}\nexport function onlyVendor(): void {}\nexport function onlyLoose(): void {}\n",
  "src/api/api.ts": "import { write } from \"../store/rows.ts\";\nexport function go(): string {\n  return write(\"a\");\n}\n",
  "src/api/api.test.ts": "import { lonely } from \"../store/rows.ts\";\nlonely();\n",
  "vendor/use.ts": "import { write, onlyVendor } from \"../src/store/rows.ts\";\nexport function vend(): void {\n  write(\"v\");\n  onlyVendor();\n}\n",
  "loose/use.ts": "import { write, onlyLoose } from \"../src/store/rows.ts\";\nexport function roam(): void {\n  write(\"l\");\n  onlyLoose();\n}\n",
};

test("interfaces read only within the declared components", async () => {
  const { root, remove } = project(BOUNDED);
  try {
    const server = new TextServer(root);
    const read = await readComponentInterfaces(root, server);
    assert.equal(read.kind, "read");
    if (read.kind !== "read") return;
    assert.deepEqual(read.symbols.map((s) => `${s.from} -> ${s.to} ${s.symbol} ${s.sites}`), ["src/api -> src/store write 2"], "the interface between the declared components, import and call");
    assert.ok(!server.asked.some((name) => ["vend", "roam"].includes(name)), `a declaration outside every declared component is never asked: ${server.asked.join(", ")}`);
    assert.deepEqual(read.bounds, { components: 2, files: 2, candidates: 1, asked: server.asked.length }, "two components, two files of component code (the test is not one), one candidate");
    assert.deepEqual(read.unowned, { files: 1, lines: 6 }, "loose/use.ts is code no component owns; vendor is past the bounds");
    // write is asked (src/api names it); its sites in loose/ (inside the bounds, no component) are outside; vendor/ is past the bounds and never counted.
    assert.deepEqual(read.outside, { sites: 2, files: 1, into: [{ component: "src/store", sites: 2 }] }, "an import and a call in loose/use.ts, counted into the store; none from vendor/");
    assert.ok(read.symbols.every((s) => s.from.startsWith("src/")), "no outside caller is drawn as a component");
    const { state } = await buildScopePage({ root, lexiconPath: COHERENCE_LEXICON, project: "Bounded", componentInterfaces: read });
    const evidence = reliefNotes(state).join(" ");
    assert.match(evidence, /read only within the 2 declared components/);
    assert.match(evidence, /2 reference sites from 1 file in no declared component counted, not drawn: 2 into src\/store; a declaration only such code names is not asked, and code past the config's bounds is not read/);
    assert.match(answerStructure(state).text, /^evidence: .*read only within the 2 declared components.*2 reference sites from 1 file in no declared component counted, not drawn/m, "query structure says the same");
  } finally {
    remove();
  }
});

test("a name no other component spells is never asked for its references", async () => {
  const { root, remove } = project(BOUNDED);
  try {
    const server = new TextServer(root);
    const read = await readComponentInterfaces(root, server);
    assert.equal(read.kind, "read");
    for (const name of ["lonely", "onlyVendor", "onlyLoose"]) assert.ok(!server.asked.includes(name), `${name} is spelled by no other component's code, so it is never asked (asked: ${server.asked.join(", ")})`);
    // The handler's reach still reads the component's own code: go -> write -> shape.
    assert.deepEqual(server.asked, ["write", "shape"], "write is spelled in src/api; the reach reads what its entered files spell beyond a declaration, so write's call to shape; go, the handler, is referenced nowhere");
  } finally {
    remove();
  }
});

const TS_CONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["**/*.ts"] });

test("the prefilter never hides a cross-component reference", { timeout: 600_000 }, async (t) => {
  // The bounded fixture through the text server.
  const bounded = project(BOUNDED);
  try {
    sameMap(await readComponentInterfaces(bounded.root, new TextServer(bounded.root), { exhaustive: true, keep: false }), await readComponentInterfaces(bounded.root, new TextServer(bounded.root), { keep: false }), "the bounded fixture");
  } finally {
    bounded.remove();
  }
  // TypeScript: a wildcard re-export, a renamed re-export used under its new name only, an alias on import, and a default export imported under another name.
  const ts = project({
    "coherence.config.json": JSON.stringify({ name: "hatches", entryDir: ".", language: "typescript" }),
    "tsconfig.json": TS_CONFIG,
    "src/lib/Lib.spec.md": "# Lib\n\nThe library.\n\n## invariants\n",
    "src/app/App.spec.md": "# App\n\nUses the library.\n\n## entrances\n- start: work arrives\n  handler: start in src/app/main.ts\n\n## invariants\n",
    "src/relay/Relay.spec.md": "# Relay\n\nRe-exports the library wholesale.\n\n## invariants\n",
    "src/lib/core.ts": "export function renamed(): number {\n  return 1;\n}\nexport function aliased(): number {\n  return 2;\n}\nexport function starred(): number {\n  return 3;\n}\nexport default function defaulted(): number {\n  return 4;\n}\n",
    "src/lib/index.ts": "export { renamed as outward } from \"./core.ts\";\n",
    "src/relay/all.ts": "export * from \"../lib/core.ts\";\n",
    "src/app/main.ts": "import { outward } from \"../lib/index.ts\";\nimport { aliased as other } from \"../lib/core.ts\";\nimport anything from \"../lib/core.ts\";\nexport function start(): number {\n  return outward() + other() + anything();\n}\n",
  });
  // Python: a star import, an alias on import, and a name only an __all__ string and a getattr spell.
  const py = project({
    "coherence.config.json": JSON.stringify({ name: "hatches", entryDir: ".", language: "python" }),
    "lib/Lib.spec.md": "# Lib\n\nThe library.\n\n## invariants\n",
    "app/App.spec.md": "# App\n\nUses the library.\n\n## entrances\n- start: work arrives\n  handler: start in app/main.py\n\n## invariants\n",
    "lib/__init__.py": "",
    "app/__init__.py": "",
    "lib/core.py": "def starred():\n    return 1\n\n\ndef aliased():\n    return 2\n\n\ndef stringly():\n    return 3\n",
    "app/main.py": "from lib.core import *\nfrom lib.core import aliased as other\nimport lib.core\n\n__all__ = [\"start\"]\n\n\ndef start():\n    return starred() + other() + getattr(lib.core, \"stringly\")()\n",
  });
  try {
    const tsReadings = await bothWays(new TypeScriptAdapter(ts.root), ts.root);
    if (tsReadings.filtered.kind === "unread") t.diagnostic(`no TypeScript instrument: ${tsReadings.filtered.because}`);
    else {
      sameMap(tsReadings.exhaustive, tsReadings.filtered, "the TypeScript escape hatches");
      const edges = tsReadings.filtered.kind === "read" ? tsReadings.filtered.symbols.map((s) => `${s.from} -> ${s.to} ${s.symbol}`) : [];
      for (const edge of ["src/relay -> src/lib starred", "src/app -> src/lib aliased", "src/app -> src/lib defaulted"]) assert.ok(edges.includes(edge), `${edge} survives the prefilter: ${edges.join("; ")}`);
    }
    const pyReadings = await bothWays(new PythonAdapter(py.root), py.root);
    if (pyReadings.filtered.kind === "unread") t.diagnostic(`no Python instrument: ${pyReadings.filtered.because}`);
    else {
      sameMap(pyReadings.exhaustive, pyReadings.filtered, "the Python escape hatches");
      const edges = pyReadings.filtered.kind === "read" ? pyReadings.filtered.symbols.map((s) => `${s.from} -> ${s.to} ${s.symbol}`) : [];
      for (const edge of ["app -> lib starred", "app -> lib aliased"]) assert.ok(edges.includes(edge), `${edge} survives the prefilter: ${edges.join("; ")}`);
    }
  } finally {
    ts.remove();
    py.remove();
  }
  // Coherence's own tree, read both ways, is bench/interfaces/own-tree.ts in the bench job: it reads the whole tree twice, so it would cost the unit suite more with every merge.
});

test("the interface reading is bounded in time and says when it is partial", { timeout: 30_000 }, async () => {
  const { root, remove } = project(BOUNDED);
  try {
    const server = new TextServer(root);
    server.stall.add("write");
    const started = Date.now();
    const read = await readComponentInterfaces(root, server, { budget: { seconds: 1 } });
    const took = Date.now() - started;
    assert.ok(took < 3_000, `a stalled server never holds the reading past its budget: ${took} ms`);
    assert.equal(read.kind, "read");
    if (read.kind !== "read") return;
    assert.equal(read.partial?.limit, "time");
    assert.equal(read.partial?.budget, "1 s");
    assert.deepEqual(read.partial?.unread, ["src/api", "src/store"], "the store's write was never answered, and the api's entrance reach was never read");
    assert.match(read.entrances[0]?.reason ?? "", /^not read: the interface reading stopped at its time budget \(1 s\)/);
    const { state } = await buildScopePage({ root, lexiconPath: COHERENCE_LEXICON, project: "Bounded", componentInterfaces: read });
    assert.match(reliefNotes(state)[0] ?? "", /^Partial map: the interface reading stopped at its time budget \(1 s\).*src\/api, src\/store were not all read/, "the Structure view says it first");
    assert.match(answerStructure(state).text, /^partial map: the interface reading stopped at its time budget \(1 s\)/, "query structure leads with it");
    // Memory: a server over its ceiling stops the reading before the next question.
    const heavy = await readComponentInterfaces(root, new TextServer(root), { budget: { memoryMB: 100 }, memory: async () => 250 });
    assert.equal(heavy.kind === "read" && heavy.partial?.limit, "memory");
    assert.equal(heavy.kind === "read" && heavy.partial?.observed, "250 MB");
    const complete = await readComponentInterfaces(root, new TextServer(root), { budget: { seconds: 60 } });
    assert.equal(complete.kind === "read" && complete.partial, undefined, "a reading that finished says nothing of the kind");
    const { state: whole } = await buildScopePage({ root, lexiconPath: COHERENCE_LEXICON, project: "Bounded", componentInterfaces: complete });
    assert.ok(!reliefNotes(whole).some((note) => /^Partial map/.test(note)), "a finished reading says nothing of the kind");
  } finally {
    remove();
  }
  // The budget from the config's interfaceBudget, and a flag's outranking it.
  const configured = project({ ...BOUNDED, "coherence.config.json": JSON.stringify({ name: "bounded", entryDir: "src", language: "typescript", ignore: ["vendor"], interfaceBudget: { seconds: 1, memoryMB: 100 } }) });
  try {
    const stalled = new TextServer(configured.root);
    stalled.stall.add("write");
    const byConfig = await readComponentInterfaces(configured.root, stalled);
    assert.equal(byConfig.kind === "read" && byConfig.partial?.budget, "1 s", "the config's seconds");
    const byFlag = await readComponentInterfaces(configured.root, new TextServer(configured.root), { budget: { memoryMB: 50 }, memory: async () => 75 });
    assert.equal(byFlag.kind === "read" && byFlag.partial?.budget, "50 MB", "the flag's memory ceiling outranks the config's");
  } finally {
    configured.remove();
  }
});

test("a file the language server cannot answer for is named and left unread while the rest of the language is read", async () => {
  // A second store file only one host's build holds, which the api calls beside the store's write.
  const { root, remove } = project({
    ...BOUNDED,
    "src/store/clock_windows.ts": "export function tick(): number {\n  return 1;\n}\n",
    "src/api/api.ts": "import { write } from \"../store/rows.ts\";\nimport { tick } from \"../store/clock_windows.ts\";\nexport function go(): string {\n  tick();\n  return write(\"a\");\n}\n",
  });
  try {
    const server = new TextServer(root);
    server.fail.set("src/store/clock_windows.ts", "no package metadata for file src/store/clock_windows.ts");
    const read = await readComponentInterfaces(root, server, { keep: false });
    assert.equal(read.kind, "read", `one file's failure leaves the language read: ${read.kind === "unread" ? read.because : ""}`);
    if (read.kind !== "read") return;
    assert.deepEqual(read.unanswered, [{ file: "src/store/clock_windows.ts", component: "src/store", reason: "no package metadata for file src/store/clock_windows.ts" }]);
    assert.ok(read.symbols.some((s) => s.from === "src/api" && s.to === "src/store" && s.symbol === "write"), "every other file is read: the api's use of the store's write is drawn");
    assert.equal(read.partial, undefined, "no budget was spent");
    const { state } = await buildScopePage({ root, lexiconPath: COHERENCE_LEXICON, project: "Bounded", componentInterfaces: read });
    assert.match(reliefNotes(state)[0] ?? "", /^Partial map: the language server could not answer for 1 file, which was left unread while the rest was read.*src\/store\/clock_windows\.ts \(no package metadata/, "the Structure view says it first");
    assert.match(answerStructure(state).text, /^partial map: the language server could not answer for 1 file[^\n]*src\/store\/clock_windows\.ts/, "query structure leads with it");
    const whole = await readComponentInterfaces(root, new TextServer(root), { keep: false });
    assert.equal(whole.kind === "read" && whole.unanswered, undefined, "a server that answers every file leaves nothing unanswered");
    // The economy of a change to that file: the closure is said, with the file's line naming what the server could not answer.
    const economy = await predictClosure(root, ["src/store/clock_windows.ts"], { adapter: server });
    const why = Object.fromEntries(economy.entries.map((e) => [e.file, e.why]));
    assert.ok(why["src/store/clock_windows.ts"]?.some((w) => /^the typescript server could not answer for it \(no package metadata for file src\/store\/clock_windows\.ts\), so what references it is not read$/.test(w)), JSON.stringify(why));
    assert.deepEqual(why["src/store/Store.spec.md"], ["spec of src/store, which holds src/store/clock_windows.ts"], "the rest of the closure is still read");
    // The observation's interface map: the file is named, the store's write still read.
    const observed = await readInterfaceMap(root, server, loadSpecModel(root, { runs: false }), readEnforcementConfig(root), "typescript");
    assert.deepEqual(observed.unanswered, [{ file: "src/store/clock_windows.ts", reason: "no package metadata for file src/store/clock_windows.ts" }]);
    assert.ok(observed.symbols.some((s) => s.from === "src/api" && s.to === "src/store" && s.symbol === "write"), "the observation reads every other file");
  } finally {
    remove();
  }
});

test("a question the server refused is kept like an answer until its file changes, and a crash is asked again", async () => {
  const { root, remove } = project({
    ...BOUNDED,
    "src/store/clock_windows.ts": "export function tick(): number {\n  return 1;\n}\n",
    "src/api/api.ts": "import { write } from \"../store/rows.ts\";\nimport { tick } from \"../store/clock_windows.ts\";\nexport function go(): string {\n  tick();\n  return write(\"a\");\n}\n",
  });
  try {
    const server = new TextServer(root);
    server.fail.set("src/store/clock_windows.ts", "language server exited (SIGKILL)");
    await readComponentInterfaces(root, server);
    const healthy = new TextServer(root);
    await readComponentInterfaces(root, healthy);
    assert.ok(healthy.asked.includes("tick"), "a crash is asked again");
    // A failure the server returned is kept like an answer: the unchanged tree never starts the server for it, and still names the file.
    const clock = join(root, "src/store/clock_windows.ts");
    writeFileSync(clock, "export function tick(): number {\n  return 2;\n}\n");
    const refusing = new TextServer(root);
    refusing.refuse.set("src/store/clock_windows.ts", "Maximum call stack size exceeded");
    await readComponentInterfaces(root, refusing);
    const again = new TextServer(root);
    const kept = await readComponentInterfaces(root, again);
    assert.equal(again.started, 0, "the server is never started for a question it already refused");
    assert.ok(kept.kind === "read" && kept.kept?.asked === 0, "nothing is asked anew");
    assert.deepEqual(kept.kind === "read" && kept.unanswered, [{ file: "src/store/clock_windows.ts", component: "src/store", reason: "textDocument/references: Maximum call stack size exceeded (-32603)" }]);
    // A change to that file drops the kept failure, so the server is asked again.
    writeFileSync(clock, "export function tick(): number {\n  return 3;\n}\n");
    const changed = new TextServer(root);
    await readComponentInterfaces(root, changed);
    assert.ok(changed.asked.includes("tick"), "the changed file's question is asked again");
  } finally {
    remove();
  }
});

/** What a proposal says, as the scaffold prints it and as the route it stands on carries it. */
function proposalShape(p: Proposal): unknown {
  const { route } = p;
  return { text: renderProposal(p, "coherence"), entrance: p.entrance.name, closures: p.closures, route: { names: route.names, stops: route.stops, rail: route.rail, trust: route.trust, controls: route.controls, traced: route.traced, partial: route.partial, noTracedControl: route.noTracedControl } };
}

test("a scoped reading proposes for its entrances what the whole reading proposes, and never asks about a component their routes do not reach", async () => {
  const { root, remove } = routedProject();
  try {
    const whole = await readComponentInterfaces(root, new TextServer(root));
    const server = new TextServer(root);
    // Keeping nothing, so every question the scoped reading needs reaches the server and is counted.
    const scoped = await readComponentInterfaces(root, server, { scope: { entrances: [{ component: "src/api", name: "look" }] }, keep: false });
    assert.equal(scoped.kind, "read");
    if (scoped.kind !== "read" || whole.kind !== "read") return;
    assert.deepEqual(scoped.scoped?.entrances.map((e) => e.name), ["look", "grab"], "grab is declared where look is, so it may share look's route, and is read too");
    assert.deepEqual(scoped.scoped?.components, ["src/api", "src/service", "src/store"], "where the routes are declared and handled, and every component their reach enters");
    assert.ok(scoped.scoped?.maybe.some((m) => m.from === "src/api" && m.to === "src/report"), "the admin code's call into src/report may be an interface, never asked");
    assert.deepEqual(server.questions.filter((file) => file.startsWith("src/report/")), [], `src/report is never asked about: ${server.questions.join(", ")}`);
    assert.ok(server.questions.length > 0 && !server.asked.includes("summary") && !server.asked.includes("daily"));
    const wholeState = checked(structureState(root, whole));
    const scopedState = checked(structureState(root, scoped));
    const wholeModel = flowOf(wholeState);
    const scopedModel = flowOf(scopedState);
    assert.equal(scopedUnsettled(scopedState, scopedModel), undefined, "every fact the route rule reads is settled");
    const route = scopedModel.routes.find((r) => r.names.includes("look"))!;
    assert.deepEqual(route.stops, ["src/api", "src/service", "src/store"], "a route crossing three components");
    assert.deepEqual(route.names, ["look", "grab"]);
    const ours = (ps: Proposal[]): unknown[] => ps.filter((p) => ["look", "grab"].includes(p.entrance.name)).map(proposalShape);
    const fromScoped = proposeClosures(root, scopedState, scopedModel, "typescript");
    const fromWhole = proposeClosures(root, wholeState, wholeModel, "typescript");
    assert.deepEqual(fromScoped.map((p) => p.entrance.name), ["look", "grab"], "the scoped reading proposes for its entrances only");
    assert.deepEqual(ours(fromScoped), ours(fromWhole), "the same route, traced controls and closures as the whole reading");
    const look = fromScoped.find((p) => p.entrance.name === "look")!.closures[0]!;
    assert.deepEqual(look.kind === "guard" ? [look.line, look.how] : look.kind, ["guard: check", "traced"], "look passes the verified check its route-mate does not");
    assert.equal(fromScoped.find((p) => p.entrance.name === "grab")!.closures[0]!.kind, "invariant");
    // Where a fact the route reads was not read, the reading cannot stand for the whole one, and says which.
    const unread = structuredClone(scoped);
    unread.scoped = { ...unread.scoped!, components: ["src/api", "src/service"], maybe: [...unread.scoped!.maybe, { from: "src/service", to: "src/store" }] };
    const unreadState = checked(structureState(root, unread));
    assert.match(scopedUnsettled(unreadState, flowOf(unreadState)) ?? "", /src\/store/);
  } finally {
    remove();
  }
});

test("a chokepoint whose every call in a handler passes the option its unless: line names as true credits that handler nothing, and is named switched off; a call with the check on, or the option not a literal true, keeps the credit", async () => {
  const { root, remove } = routedProject();
  try {
    const write = (path: string, text: string): void => writeFileSync(join(root, path), text);
    write("src/service/check.ts", "export function check(v: string, options?: { skip: boolean }): string {\n  if (!options?.skip) inner();\n  return v;\n}\nfunction inner(): void {}\n");
    write(
      "src/api/api.ts",
      [
        'import { serve } from "../service/serve.ts";',
        'import { check } from "../service/check.ts";',
        "export function look(): string {",
        '  return check(serve("l"));',
        "}",
        "export function peek(): string {",
        '  return check(serve("p"), { skip: true });',
        "}",
        "export function poke(): string {",
        "  const skip = Math.random() > 2;",
        '  return check(serve("k"), { skip });',
        "}",
        "export function grab(): string {",
        '  return serve("g");',
        "}",
        "",
      ].join("\n"),
    );
    const spec = (unless: boolean): void => {
      write("src/api/Api.spec.md", ["# Api", "", "Takes requests.", "", "## entrances", ...["look", "peek", "poke", "grab"].flatMap((n) => [`- ${n}: a caller ${n}s`, `  handler: ${n} in src/api/api.ts`, "  trust: public"]), "", "## invariants", ""].join("\n"));
      write("src/service/Service.spec.md", ["# Service", "", "Does the work.", "", "## invariants", "- one check: Every look is checked before its work runs.", "  protects: inner", "  chokepoint: check", ...(unless ? ["  unless: skip"] : []), "  because: the check is where a look is let in", "  kinds: none", ""].join("\n"));
    };
    const read = async (): Promise<Map<string, { guards: string[]; off: string[] }>> => {
      const reading = await readComponentInterfaces(root, new TextServer(root));
      assert.equal(reading.kind, "read");
      if (reading.kind !== "read") return new Map();
      return new Map(reading.entrances.filter((e) => e.component === "src/api").map((e) => [e.name, { guards: (e.guards ?? []).map((g) => `${g.name} ${g.how}`), off: (e.switchedOff ?? []).map((o) => `${o.name} ${o.unless}`) }]));
    };
    spec(false);
    const without = await read();
    assert.deepEqual(without.get("peek"), { guards: ["one check wrapper"], off: [] }, "with no unless: line, a call that switches the check off is credited as one that runs it: the reading cannot tell them apart");
    spec(true);
    const declared = await read();
    assert.deepEqual(declared.get("look"), { guards: ["one check wrapper"], off: [] }, "a call with the check on keeps its credit");
    assert.deepEqual(declared.get("peek"), { guards: [], off: ["one check skip"] }, "every call passing skip: true: no credit, and named switched off");
    assert.deepEqual(declared.get("poke"), { guards: ["one check wrapper"], off: [] }, "the option passed as a variable proves nothing switched off, so the credit stands");
    assert.deepEqual(declared.get("grab"), { guards: [], off: [] });
    const state = checked(structureState(root, await readComponentInterfaces(root, new TextServer(root))));
    const model = flowOf(state);
    assert.deepEqual(model.entrances.find((e) => e.name === "peek")?.switchedOff?.map((o) => o.name), ["one check"], "Structure carries it");
    assert.match(answerStructure(state).text, /switched off: one check \(src\/service\), called with skip: true/, "and the query names it on the route");
    assert.deepEqual(callArguments('a(check(x, { y: ")" }), z); check(q)', "check"), ['x, { y: ")" }', "q"], "arguments read with brackets and strings balanced");
    assert.equal(switchesOff("check(a, { skip: true }); check(b)", "check", "skip"), false, "one call with the check on is enough to keep it");
    assert.equal(switchesOff("check(a, { skip: trueish })", "check", "skip"), false);
    assert.equal(switchesOff("lib.check(a, { skip: true })", "check", "skip"), true, "a qualified call is a call");
    const parsed = (lines: string[]): ReturnType<typeof parseSpec> => parseSpec(["# S", "", "Does.", "", "## invariants", ...lines, ""].join("\n"), "S.spec.md");
    const chokepoint = parsed(["- c: C holds.", "  protects: inner", "  chokepoint: check", "  unless: skip", "  because: b", "  kinds: none"]);
    assert.deepEqual([chokepoint.problems, chokepoint.invariants[0]!.enforcements[0]], [[], { form: "chokepoint", protects: "inner", chokepoint: "check", line: 7, unless: "skip" }], "the chokepoint form carries the option");
    assert.match(parsed(["- t: T holds.", "  over: all", "  via: a test", "  unless: skip", "  because: b", "  kinds: none"]).problems.map((x) => x.message).join("\n"), /unless: on t belongs to the chokepoint form/, "a totality oracle has no option to switch off");
    assert.match(parsed(["- c: C holds.", "  protects: inner", "  chokepoint: check", "  unless: skip: true", "  because: b", "  kinds: none"]).problems.map((x) => x.message).join("\n"), /unless: on c names one option/, "one property name, never an expression");
  } finally {
    remove();
  }
});

test("a scoped reading is never recorded as the tree's reading", async () => {
  const { root, remove } = routedProject();
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    const scoped = await readComponentInterfaces(root, new TextServer(root), { scope: { entrances: [{ component: "src/api", name: "look" }] } });
    assert.ok(scoped.kind === "read" && scoped.scoped !== undefined);
    assert.equal(recordReading(root, scoped, structureFingerprint(root)), false, "a scoped reading is refused");
    assert.equal(lastReading(root), undefined, "and nothing is kept");
    const whole = await readComponentInterfaces(root, new TextServer(root));
    assert.equal(recordReading(root, whole, structureFingerprint(root)), true, "the whole reading of the same tree is kept");
  } finally {
    remove();
  }
});

/** A reading less what it did with the kept answers: what two readings of one tree must agree on. */
function mapOf(reading: InterfaceReading): unknown {
  if (reading.kind !== "read") return reading;
  const { kept: _kept, ...map } = reading;
  return map;
}

test("the interface reading on a worker thread is the reading in process: each question goes to the adapter the caller holds, the reading is kept for the hooks, and a stop ends the worker", async () => {
  const { root, remove } = routedProject();
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    const held = new TextServer(root);
    const languages: string[] = [];
    const apart = await readInterfacesApart(root, (language) => (languages.push(language), held));
    assert.equal(apart.kind, "read");
    assert.ok(held.questions.length > 0 && languages.every((l) => l === "typescript"), "the worker asked the caller's adapter, for the project's language");
    assert.deepEqual(lastReading(root)?.reading, apart, "and the reading is kept for the hooks, as in process");
    const here = await readComponentInterfaces(root, new TextServer(root), { keep: false });
    assert.deepEqual(mapOf(apart), mapOf(here), "the map is the one the reading in process draws");

    // A server that never answers, asked again since nothing is kept, and a stop: the reading is refused and its worker ended.
    rmSync(join(root, STRUCTURE_DIR), { recursive: true, force: true });
    const silent = { ...new TextServer(root), language: "typescript", ready: () => new Promise<never>(() => {}) } as unknown as LanguageAdapter;
    const stop = new AbortController();
    let asked = false;
    const stopped = readInterfacesApart(root, () => ((asked = true), silent), stop.signal);
    for (let i = 0; i < 400 && !asked; i++) await new Promise((r) => setTimeout(r, 25));
    assert.ok(asked, "the reading asked the silent server");
    stop.abort();
    await assert.rejects(stopped, /was stopped/);
  } finally {
    remove();
  }
});

test("a spec edit asks the language server only what no reading asked before, and rereads no source", async () => {
  const { root, remove } = routedProject();
  try {
    const first = await readComponentInterfaces(root, new TextServer(root));
    assert.equal(first.kind === "read" && first.kept?.whole, "no answers were kept for this tree yet", "the first reading says it had nothing kept to reuse");
    // The specs' shape changes and no source does: an entrance on a declaration the reading asked about, a guard: on it, and a chokepoint.
    const service = join(root, "src/service/Service.spec.md");
    writeFileSync(service, readFileSync(service, "utf8").replace("## invariants", "## entrances\n- serve: a peer serves\n  handler: serve in src/service/serve.ts\n  trust: public\n  guard: check\n\n## invariants"));
    const store = join(root, "src/store/Store.spec.md");
    writeFileSync(store, `${readFileSync(store, "utf8")}- one put: Every row is put through serve.\n  protects: put\n  chokepoint: serve\n  because: serve is where a row is shaped\n  kinds: none\n`);
    const server = new TextServer(root);
    const kept = await readComponentInterfaces(root, server);
    assert.deepEqual(server.questions, [], "nothing is asked: every answer the reading needs was kept");
    assert.equal(server.started, 0, "the server is never started");
    assert.ok(kept.kind === "read" && kept.kept !== undefined && kept.kept.reused > 0, "the kept answers were reused");
    assert.deepEqual({ ...kept.kept, reused: 0 }, { reused: 0, asked: 0, changed: 0, dropped: 0 });
    assert.match(keptLine(kept.kept) ?? "", /^kept language-server answers: \d+ reused, 0 asked anew; no source file changed since they were kept$/);
    const fresh = await readComponentInterfaces(root, new TextServer(root), { keep: false });
    assert.ok(fresh.kind === "read" && fresh.entrances.some((e) => e.name === "serve" && e.reach !== undefined), "the new entrance is resolved and reached");
    assert.deepEqual(mapOf(kept), mapOf(fresh), "the reading a server asked everything gives: the new entrance, its reach and guard, the new chokepoint traced");
    // A handler no reading asked about is the one thing asked, and only about its own file.
    const api = join(root, "src/api/Api.spec.md");
    writeFileSync(api, readFileSync(api, "utf8").replace("## invariants", "- audit: an admin audits\n  handler: audit in src/api/admin.ts\n  trust: public\n\n## invariants"));
    const next = new TextServer(root);
    const again = await readComponentInterfaces(root, next);
    assert.ok(next.questions.length > 0 && next.questions.every((file) => file === "src/api/admin.ts"), `only the new handler is asked about: ${next.questions.join(", ")}`);
    assert.deepEqual(mapOf(again), mapOf(await readComponentInterfaces(root, new TextServer(root), { keep: false })));
  } finally {
    remove();
  }
});

test("a source edit asks again only what the changed file could have changed, and the reading is the one a fresh server gives", async () => {
  const { root, remove } = routedProject();
  try {
    const all = new TextServer(root);
    await readComponentInterfaces(root, all);
    // serve now sums the day too: a new interface from src/service into src/report, spelled only in the changed file.
    writeFileSync(join(root, "src/service/serve.ts"), 'import { put } from "../store/rows.ts";\nimport { summary } from "../report/report.ts";\nexport function serve(v: string): string {\n  summary();\n  return put(v);\n}\n');
    const server = new TextServer(root);
    const kept = await readComponentInterfaces(root, server);
    const fresh = await readComponentInterfaces(root, new TextServer(root), { keep: false });
    assert.ok(kept.kind === "read" && kept.symbols.some((s) => s.from === "src/service" && s.to === "src/report" && s.symbol === "summary"), "the new interface is read");
    assert.deepEqual(mapOf(kept), mapOf(fresh), "the reading a server asked everything gives");
    assert.ok(kept.kept !== undefined && kept.kept.changed === 1 && kept.kept.dropped > 0 && kept.kept.reused > 0, JSON.stringify(kept.kept));
    assert.match(keptLine(kept.kept) ?? "", /1 file changed since they were kept, which dropped \d+ answers?$/);
    const touched = new Set(["serve", "put", "summary"]);
    assert.ok(server.asked.length > 0 && server.asked.every((name) => touched.has(name)), `only what serve.ts declares or spells is asked again: ${server.asked.join(", ")}`);
    assert.ok(server.asked.length < all.asked.length, "fewer than the whole reading asked");
  } finally {
    remove();
  }
});

test("kept answers are never used silently: when what the server's answers rest on changes, every question is asked again and the reading says why", async () => {
  const { root, remove } = routedProject();
  try {
    await readComponentInterfaces(root, new TextServer(root));
    const tsconfig = join(root, "tsconfig.json");
    writeFileSync(tsconfig, readFileSync(tsconfig, "utf8").replace('"strict":true', '"strict":false'));
    const server = new TextServer(root);
    const reread = await readComponentInterfaces(root, server);
    const everything = new TextServer(root);
    await readComponentInterfaces(root, everything, { keep: false });
    assert.ok(reread.kind === "read" && reread.kept?.reused === 0, "nothing kept is reused");
    assert.equal(server.questions.length, everything.questions.length, "every question is asked again");
    assert.match(keptLine(reread.kept) ?? "", /^kept language-server answers: none from an earlier reading used \(what the server's answers rest on changed \(tsconfig\.json\)\); every question was asked of the server \(\d+\)$/);
    // An unreadable store is said too, and never trusted.
    writeFileSync(join(root, ".coherence", "structure", "answers-typescript.json"), "{");
    const broken = await readComponentInterfaces(root, new TextServer(root));
    assert.equal(broken.kind === "read" && broken.kept?.whole, "the kept answers are unreadable");
  } finally {
    remove();
  }
});

test("the kept answers rest on every module the language adapters reach: their entry and each module any of them imports, wherever it lives", () => {
  const code = adapterCode();
  const held = new Set(code);
  const src = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  assert.ok(held.has(join(src, "adapters", "index.ts")), "the adapters' entry");
  for (const file of code) {
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(/^(?:import|export)\s[^;]*?\sfrom\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
      const target = resolve(dirname(file), specifier!);
      assert.ok(held.has(target), `${file} imports ${specifier}, so a change to it may change an answer`);
    }
  }
  for (const reached of ["adapters/installed.ts", "../plugins/python/tach.ts", "adapters/toml.ts", "adapters/project-config.ts", "lifecycle/work-meter.ts"]) assert.ok(held.has(join(src, reached)), reached);
});
