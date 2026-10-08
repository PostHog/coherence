/**
 * What the hooks' work grows with: each hook event runs through runHook over
 * the same synthetic project at 1× and at 10× (ten times the components,
 * files, lines, practices, lexicon and history, at the same folder depth),
 * and two counts no machine load can move are compared: the work meter's,
 * and every call the process makes to the file system's reading and listing
 * functions, a listing weighed by the entries it returned, which also sees
 * work that slipped past the meter's doors. Each event has a budget: the
 * families of files it may pay for one by one (its practice files, the specs,
 * the run and journal file lists), each of which may grow at most tenfold;
 * everything else may not grow at all.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { runHook, type HookEvent, type HookInput } from "./hook.ts";
import { closeWork, countWork, lastHookWork, openWork, type Work } from "./work-meter.ts";
import { sizedProject, type SizedProject } from "./size-fixture.ts";
import { countingFs, type FsCount } from "./fs-count-fixture.ts";
import { countingGit } from "../adapters/git-count-fixture.ts";
import { lexiconCoverage } from "./lexicon-coverage.ts";
import { loadLexicon } from "./lexicon.ts";
import { COHERENCE_LEXICON } from "./project.ts";
import { cacheDir } from "./kept-parse.ts";
import { appendRun, entryKey, latestByEnforcement, loadRuns, parseLine, type RunRecord } from "../enforcement/record.ts";
import { latestSeeing, RunIndexUnavailable } from "../enforcement/run-index.ts";
import { chokepointIndex } from "../spec/model.ts";
import { peerFeed, writeCursor } from "../journal/feed.ts";
import { appendRecord } from "../journal/store.ts";
import type { JournalRecord } from "../journal/record.ts";
import { TypeScriptAdapter } from "../adapters/typescript.ts";
import type { LanguageAdapter } from "../adapters/adapter.ts";

const SESSION = "sized";

/** An instrument that answers nothing: a check an edit makes is said not run, and no language server is started for a fixture. */
const NO_INSTRUMENT = {
  language: "typescript",
  ladder: [],
  ready: async () => ({ ok: false, reason: "no instrument in this test" }),
  resolve: async () => ({ ok: false, reason: "not resolved: no instrument in this test" }),
  references: async () => [],
  visibility: async () => ({}),
  testFilter: (via: string) => via,
  refute: async () => ({ staged: [], seen: false }),
  forget: async () => {},
  close: async () => {},
} as unknown as LanguageAdapter;

interface Measured {
  work: Work;
  fs: FsCount;
  /** The hook's own text, for a test that also reads what it said. */
  said: string;
}

/** Spelled from the repository's top, so two sizes compare. */
function local(project: SizedProject, text: string): string {
  return text.split(project.top).join("<top>");
}

/** One hook call's work, the meter's and the file system's. */
async function workOf(project: SizedProject, event: HookEvent, input: HookInput, fallback: string = project.root): Promise<Measured> {
  // No instrument: a check the edit would make is answered as not run, never by a warm server started for a fixture.
  const { value, fs } = await countingFs(() => runHook(event, { session_id: SESSION, cwd: project.root, ...input }, fallback, { adapter: NO_INSTRUMENT, door: async (_root, fn) => fn(undefined, undefined, "no instrument in this test") }));
  const work = lastHookWork();
  assert.ok(work !== undefined, "runHook closed a scope");
  const paths = Object.fromEntries(Object.entries(fs.paths).map(([k, v]) => [local(project, k), v]));
  return {
    work: { counts: work.counts, reads: work.reads.map((r) => local(project, r)), spawns: work.spawns.map((s) => local(project, s)), outputs: Object.fromEntries(Object.entries(work.outputs).map(([k, v]) => [local(project, k), v])) },
    fs: { calls: fs.calls, paths },
    said: value.stdout === "" ? "" : ((JSON.parse(value.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? ""),
  };
}

/** The fixture's numbered families, written as one: every small component, note, part, run file and journal file. */
function family(key: string): string {
  return key
    .replace(/\bc\d+\b/g, "cN")
    .replace(/\bC\d+\b/g, "CN")
    .replace(/note-\d+/g, "note-N")
    .replace(/part-\d+/g, "part-N")
    .replace(/\/h\d+\.jsonl/g, "/hN.jsonl");
}

/** A call's work as weights by family: what the budget is judged on. */
function weighed(m: Measured): Map<string, number> {
  const out = new Map<string, number>();
  const add = (key: string, weight: number): void => {
    const k = family(key);
    out.set(k, (out.get(k) ?? 0) + weight);
  };
  for (const kind of ["coverage reading", "spec model", "server request", "phrase comparison"] as const) add(`meter ${kind}`, m.work.counts[kind]);
  for (const r of m.work.reads) add(`meter read ${r}`, 1);
  for (const s of m.work.spawns) add(`meter spawn ${s}`, 1);
  for (const [line, bytes] of Object.entries(m.work.outputs)) add(`spawn output ${line}`, bytes);
  for (const [key, weight] of Object.entries(m.fs.paths)) add(`fs ${key}`, weight);
  return out;
}

/** What an event may pay for one by one: families of files it must name, each at most tenfold when they grow tenfold. */
const PRACTICES = /proj\/src\/cN\/CN\.(practice|spec)\.md|ls-files .*\*\.practice\.md/;
const SPECS = /proj\/src\/cN\/(CN\.spec\.md|\.git|pyvenv\.cfg)$|ls-files .*\*\.spec\.md/;
const RUNS = /proj\/\.coherence\/runs(\/hN\.jsonl)?$/;
const JOURNAL = /proj\/\.coherence\/journal(\/hN\.jsonl)?$/;

/** Every way the large call's work exceeds the small's beyond its budget; none when it holds. */
function overBudget(small: Measured, large: Measured, allowed: readonly RegExp[]): string[] {
  const s = weighed(small);
  const l = weighed(large);
  const problems: string[] = [];
  for (const key of new Set([...s.keys(), ...l.keys()])) {
    const a = s.get(key) ?? 0;
    const b = l.get(key) ?? 0;
    // The bound is from above: work that shrinks at 10× (a cache folder that happens to hold fewer files) is never over it.
    if (b <= a) continue;
    // A family that grew tenfold may cost up to eleven times as much: its paths are a few characters longer at 10×.
    if (allowed.some((pattern) => pattern.test(key)) && a > 0 && b <= 11 * a) continue;
    problems.push(`${key}: ${a} at 1×, ${b} at 10×`);
  }
  return problems.sort();
}

/** Both sizes, each built fresh, its session started as a host starts one, handed to `body`, and removed. */
async function atBothSizes<T>(body: (project: SizedProject) => Promise<T>): Promise<[T, T]> {
  const out: T[] = [];
  for (const scale of [1, 10]) {
    const project = sizedProject(scale);
    try {
      // The session's start: its full reading keeps the vocabulary an edit reads, its baseline and its feed cursor.
      const start = await runHook("SessionStart", { session_id: SESSION, cwd: project.root }, project.root, {});
      start.commit?.();
      out.push(await body(project));
    } finally {
      rmSync(project.top, { recursive: true, force: true });
    }
  }
  return [out[0]!, out[1]!];
}

const read = (project: SizedProject, file: string) => ({ tool_name: "Read", tool_input: { file_path: join(project.root, file) } });
const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });

/** The project files a call read from disk, by any function, outside Coherence's own state. */
function projectReads(m: Measured): string[] {
  return Object.keys(m.fs.paths)
    .filter((p) => /^(readFileSync|promises\.readFile|callback\.readFile|openSync) <top>\/proj\//.test(p))
    .map((p) => p.replace(/^\S+ <top>\/proj\//, ""))
    .filter((p) => !p.startsWith(".coherence/"));
}

test("a tool use that writes nothing pays only for its practice files and the journal's file list, at 1× and 10×, and reads no corpus and no coverage", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    await workOf(project, "PreToolUse", bash("ls"));
    const works: Record<string, Measured> = {};
    for (const [name, event, input] of [
      ["PreToolUse Read", "PreToolUse", read(project, "src/c1/m.ts")],
      ["PostToolUse Read", "PostToolUse", read(project, "src/c1/m.ts")],
      ["PreToolUse ls", "PreToolUse", bash("ls")],
      ["PostToolUse ls", "PostToolUse", bash("ls")],
    ] as const) {
      works[name] = await workOf(project, event, input);
    }
    return works;
  });
  const budgets: Record<string, RegExp[]> = {
    // A command is read against every practice: each practice file, once, and the spec it pairs with.
    "PreToolUse Read": [],
    "PreToolUse ls": [PRACTICES],
    // The peer feed lists the journal's files and reads only those that changed since its last look.
    "PostToolUse Read": [JOURNAL],
    "PostToolUse ls": [JOURNAL],
  };
  for (const name of Object.keys(small)) {
    assert.deepEqual(overBudget(small[name]!, large[name]!, budgets[name]!), [], `${name} pays only for its budget over 30 components and their history`);
    assert.equal(small[name]!.work.counts["coverage reading"], 0, `${name} takes no coverage reading`);
    assert.equal(small[name]!.work.counts["spec model"], 0, `${name} loads no spec model`);
    assert.deepEqual(projectReads(small[name]!).filter((p) => !/\.practice\.md$/.test(p) && !["coherence.config.json", "lexicon.json", "package.json"].includes(p)), [], `${name} reads no project file but its config and practices`);
  }
});

test("an edit pays for the files it names, the specs and the history's file lists, at 1× and 10×, wherever the file lies and when it names a protected thing", async () => {
  const files: Record<string, { rel: string; line: (n: number) => string }> = {
    "small component": { rel: "src/c1/m.ts", line: (n) => `export const edited${n} = ${n};\n` },
    "large component": { rel: "src/big/part-0.md", line: (n) => `An edit numbered ${n}.\n` },
    "root file": { rel: "README.md", line: (n) => `An edit numbered ${n}.\n` },
    "file in no sub-component": { rel: "docs/note-0.md", line: (n) => `An edit numbered ${n}.\n` },
    // The check's own path: the edit names a protected thing, so the chokepoint invariant is run, and that run is in the budget too.
    "edit naming a protected thing": { rel: "src/c1/m.ts", line: (n) => `export const leaked${n} = SECRET_1;\n` },
  };
  const [small, large] = await atBothSizes(async (project) => {
    const out: Record<string, { pre: Measured; post: Measured }> = {};
    for (const [where, { rel, line }] of Object.entries(files)) {
      const file = join(project.root, rel);
      const edit = (n: number) => {
        writeFileSync(file, readFileSync(file, "utf8") + line(n));
        return { tool_name: "Edit", tool_input: { file_path: file, old_string: "x", new_string: line(n) } };
      };
      // The session's first edit of a file takes it in, as the first tool uses do; what is measured is the edit after it.
      await workOf(project, "PreToolUse", edit(0));
      await workOf(project, "PostToolUse", edit(0));
      const input = edit(1);
      out[where] = { pre: await workOf(project, "PreToolUse", input), post: await workOf(project, "PostToolUse", input) };
    }
    // The edit's check appended its run, ungraded: deriving a state would read the whole model and history, and the invariant floor counts it nowhere.
    const last = readFileSync(join(project.root, ".coherence", "runs", `${SESSION}.jsonl`), "utf8").trim().split("\n").at(-1)!;
    assert.ok((JSON.parse(last) as RunRecord).invariants.every((e) => e.ungraded === true && e.state === undefined), "the edit's check recorded its entries ungraded");
    return out;
  });
  for (const [where, { rel }] of Object.entries(files)) {
    for (const at of ["pre", "post"] as const) {
      const s = small[where]![at];
      const l = large[where]![at];
      // Before an edit, its practices; after it, every spec (read for its chokepoint lines), the run and journal file lists, and the run the check appends.
      const budget = at === "pre" ? [PRACTICES] : [SPECS, RUNS, JOURNAL];
      assert.deepEqual(overBudget(s, l, budget), [], `${where}, ${at}: pays only for its budget beside ten times the components, files and history`);
      assert.equal(s.work.counts["spec model"], 0, `${where}, ${at}: no whole spec model`);
      assert.equal(s.work.counts["server request"], l.work.counts["server request"], `${where}, ${at}: the same requests of the instrument`);
      assert.deepEqual([...new Set(projectReads(s))].filter((p) => p !== rel && !/\.(spec|practice)\.md$/.test(p) && !["coherence.config.json", "lexicon.json", "package.json"].includes(p)), [], `${where}, ${at}: no other project file is read`);
    }
    assert.equal(small[where]!.post.work.counts["coverage reading"], 1, `${where}: one reading, of the file it wrote`);
  }
  assert.match(small["edit naming a protected thing"]!.post.said, /could not check 1 chokepoint invariant at this edit: no instrument in this test/, "the touched invariant was put to the check, and the check's lack said");
});

test("an event outside every project does the same work at 1× and 10×, and reads nothing", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    const outside = { cwd: project.other };
    const note = join(project.other, "note-0.md");
    const write = { ...outside, tool_name: "Write", tool_input: { file_path: note, content: "x\n" } };
    await workOf(project, "PreToolUse", bash("ls"));
    return {
      "command a cd took out of the project": await workOf(project, "PreToolUse", bash(`cd ${project.other} && ls`)),
      "command in another folder": await workOf(project, "PostToolUse", { ...outside, ...bash("ls") }, project.top),
      "command before, in another folder": await workOf(project, "PreToolUse", { ...outside, ...bash("ls") }, project.top),
      "edit in another folder": await workOf(project, "PostToolUse", write, project.top),
      "edit before, in another folder": await workOf(project, "PreToolUse", write, project.top),
      "prompt in another folder": await workOf(project, "UserPromptSubmit", { ...outside, prompt: "hi" }, project.top),
    };
  });
  for (const [name, work] of Object.entries(small)) {
    // The command a cd took away still runs in the project's session: it is read against the project's own practices, as any command is.
    const budget = name === "command a cd took out of the project" ? [PRACTICES] : [];
    assert.deepEqual(overBudget(work, (large as Record<string, Measured>)[name]!, budget), [], `${name}: outside the project, its size changes nothing`);
    assert.deepEqual(work.work.reads.filter((r) => !/\.practice\.md$/.test(r)), [], `${name} reads no project file`);
    assert.equal(work.work.counts["coverage reading"] + work.work.counts["spec model"] + work.work.counts["server request"], 0, `${name} takes no reading`);
  }
});

test("a prompt over an unchanged tree reads no corpus, and pays only for the journal's file list, at 1× and 10×", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    await workOf(project, "UserPromptSubmit", { prompt: "first" });
    return workOf(project, "UserPromptSubmit", { prompt: "second" });
  });
  assert.deepEqual(overBudget(small, large, [JOURNAL]), [], "the second prompt pays only for the journal's file list over 30 components as over 3");
  assert.equal(small.work.counts["coverage reading"], 0, "no coverage reading over a tree that has not moved");
  assert.deepEqual(small.work.reads, [], "no project file read");
});

test("the hooks' git spawns all pass the work meter", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    const git = countingGit();
    try {
      const counted: string[] = [];
      for (const [event, input] of [["PreToolUse", bash("ls")], ["PostToolUse", bash("ls")], ["UserPromptSubmit", { prompt: "p" }]] as const) {
        git.reset();
        const m = await workOf(project, event, input);
        assert.equal(m.work.spawns.filter((s) => s.startsWith("git ")).length, git.calls().length, `${event}: the meter saw every git the shim saw`);
        counted.push(`${event} ${m.work.counts.spawn}`);
      }
      return counted;
    } finally {
      git.restore();
    }
  });
  assert.deepEqual(large, small);
});

/** A project of `lines` prose lines, each carrying `extra` and the fixture's words, with a lexicon of `concepts` names no line writes. */
async function phraseComparisons(lines: number, concepts: number, extra: string): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), "coherence-phrases-"));
  try {
    writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "phrases" }) + "\n");
    const names = [...Array.from({ length: concepts }, (_, n) => `zq${n} unwritten`), "lantern", "lantern hook"];
    writeFileSync(join(root, "lexicon.json"), JSON.stringify({ concepts: names.map((name) => ({ name, definition: "a fixture name" })) }));
    mkdirSync(join(root, "docs"));
    const text = Array.from({ length: lines }, (_, n) => `The widget turns on line ${n}${extra}.`).join("\n") + "\n";
    writeFileSync(join(root, "docs", "notes.md"), text);
    const layers = { coherence: await loadLexicon(COHERENCE_LEXICON), project: await loadLexicon(join(root, "lexicon.json")) };
    const scope = openWork();
    try {
      await lexiconCoverage(root, layers, ["docs"]);
    } finally {
      closeWork(scope);
    }
    return scope.work.counts["phrase comparison"];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the coverage scan compares a line only with the phrases its own words start, never with the whole lexicon", async () => {
  const base = await phraseComparisons(200, 10, "");
  assert.equal(await phraseComparisons(200, 1000, ""), base, "a lexicon a hundred times larger, of names no line's words start, adds no comparison");
  assert.equal(await phraseComparisons(400, 10, ""), 2 * base, "twice the lines, twice the comparisons");
  // "lantern" starts two names, one of them two words long: a single and a multi-word comparison each, plus the multi-word name's test for its plural.
  const worded = await phraseComparisons(200, 10, " with a lantern");
  assert.equal(worded - base, 200 * 3, "a word on every line that starts names adds what those names cost on each line, nothing more");
});

/* ------------------------------------------------------------ the spawn scan */

/** The meter: the one module that takes child_process. */
const SPAWN_ALLOWED = new Set(["lifecycle/work-meter.ts"]);
/** Test support that takes child_process to build fixtures, each by name. */
const FIXTURES_THAT_SPAWN = new Set(["adapters/git-count-fixture.ts", "lifecycle/size-fixture.ts", "readings/scope/undeclared-fixture.ts", "readings/scope/gaps-fixture.ts", "enforcement/server-fixture.ts"]);
/** Test support that loads a module by a computed name, each by name: the file system counter, which takes fs as CommonJS to replace its functions. */
const LOADERS_ALLOWED = new Set(["lifecycle/fs-count-fixture.ts"]);

const CHILD = /^(node:)?child_process$/;

/** A string literal's text, or undefined for anything computed. */
function literal(node: ts.Expression | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
  return undefined;
}

/**
 * What the scan refuses in one file, read by the compiler, so a comment or a
 * string is never code and code is never hidden in one: child_process named
 * as a module outside the meter, tests and named fixtures; and, everywhere
 * outside the meter and test support listed by name, every way to load a module or
 * run code by a computed name.
 */
function spawnOffences(rel: string, source: string): string[] {
  const out: string[] = [];
  const test = /\.(?:test|e2e)\.[cm]?[jt]s$/.test(rel);
  const mayNameChild = test || SPAWN_ALLOWED.has(rel) || FIXTURES_THAT_SPAWN.has(rel);
  const mayLoad = SPAWN_ALLOWED.has(rel) || LOADERS_ALLOWED.has(rel);
  const kind = /\.[cm]?js$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, kind);
  const say = (node: ts.Node, what: string): void => void out.push(`${rel}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${what}`);
  const child = (node: ts.Node, name: string | undefined): void => {
    if (name !== undefined && CHILD.test(name) && !mayNameChild) say(node, "names child_process");
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) child(node, literal(node.moduleSpecifier as ts.Expression));
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      child(node, literal(node.moduleReference.expression));
      if (!mayLoad) say(node, "import = require(");
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const name = literal(node.arguments[0]);
        if (name === undefined && !mayLoad) say(node, "import( of a computed name");
        child(node, name);
      }
      if (ts.isIdentifier(callee) && ["require", "eval", "Function"].includes(callee.text)) {
        child(node, literal(node.arguments[0]));
        if (!mayLoad) say(node, `${callee.text}(`);
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function" && !mayLoad) say(node, "new Function(");
    if (ts.isNewExpression(node) && !mayLoad) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
      const options = node.arguments?.[1];
      if (name === "Worker" && options !== undefined && (!ts.isObjectLiteralExpression(options) || options.properties.some((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === "eval"))) say(node, "new Worker( of code");
    }
    if (ts.isIdentifier(node) && ["getBuiltinModule", "createRequire"].includes(node.text) && !mayLoad) say(node, node.text);
    if (ts.isPropertyAccessExpression(node) && ["binding", "_linkedBinding"].includes(node.name.text) && ts.isIdentifier(node.expression) && node.expression.text === "process" && !mayLoad) say(node, "process.binding");
    if (ts.isPropertyAccessExpression(node) && node.name.text === "require" && !mayLoad) say(node, ".require");
    // A member reached by a computed name on what holds a loader: process["getBuilt" + "inModule"], globalThis[name].
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && ["process", "globalThis", "global", "module"].includes(node.expression.text) && literal(node.argumentExpression) === undefined && !mayLoad) say(node, `${node.expression.text}[ a computed name ]`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

test("no source module spawns a child process except through the work meter", () => {
  const src = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.[cm]?[jt]s$/.test(name) && !name.endsWith(".d.ts")) offenders.push(...spawnOffences(relative(src, path).split("\\").join("/"), readFileSync(path, "utf8")));
    }
  };
  walk(src);
  assert.deepEqual(offenders, [], "a module that takes child_process itself, or loads a module or runs code by a computed name, spawns where no hook's count can see it");
  // Every way around the import list the scan knows, each refused in an ordinary module, in every extension the scan reads.
  const evasions = [
    'import { spawnSync } from "node:child_process";',
    "import cp from 'child_process';",
    'export { spawnSync } from "node:child_process";',
    'const { spawnSync } = process.getBuiltinModule("node:child_process");',
    'const load = createRequire(import.meta.url); load("node:" + "child" + "_process");',
    'const cp = require("child" + "_process");',
    '/* x */ require("child_process");',
    'require?.("child_process");',
    "const name = 'child' + '_process'; await import(`node:${name}`);",
    "await import(name);",
    'process.binding("spawn_sync");',
    'process["getBuilt" + "inModule"]("child_process");',
    'eval("req" + "uire")("child" + "_process");',
    'new Function("return req" + "uire")()("child" + "_process");',
    'Function("return process")().getBuiltinModule;',
    'new Worker("require(\'child_process\')", { eval: true });',
    "module.require('child_process');",
  ];
  for (const text of evasions) {
    for (const rel of ["lifecycle/ordinary.ts", "lifecycle/ordinary.js", "lifecycle/ordinary.mjs", "lifecycle/ordinary.cjs"]) assert.notDeepEqual(spawnOffences(rel, text), [], `refused in ${rel}: ${text}`);
    if (!/^(import|export)/.test(text)) assert.notDeepEqual(spawnOffences("lifecycle/ordinary.test.ts", text), [], `refused in a test too: ${text}`);
  }
  for (const text of ['const { x } = await import("./x.ts");', '// require("child_process") is prose here', 'const s = "require(\'child_process\')";', 'const lib = await import("node-llama-cpp" as string);']) {
    assert.deepEqual(spawnOffences("lifecycle/ordinary.ts", text), [], `not refused: ${text}`);
  }
});

/* ------------------------------------------------------------ fixtures */

function gitRepo(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "coherence-kept-")));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return root;
}

const SPEC = (name: string) => `# A\n\nA component.\n\n## invariants\n- sealed: ${name} leaves only through seal.\n  protects: ${name}\n  chokepoint: seal\n  because: a fixture\n  kinds: none\n`;

test("in a project of two languages, an edit's check asks the language the last run graded the invariant in, with that run's whole file list", async () => {
  const spec = "# Fixture\n\nA store.\n\n## invariants\n- sealed store: SECRET leaves only through seal.\n  protects: SECRET\n  chokepoint: seal\n  because: a fixture\n  kinds: none\n";
  const root = gitRepo({
    "coherence.config.json": JSON.stringify({ language: ["typescript", "python"] }),
    "Fixture.spec.md": spec,
    "backend/store.py": "SECRET = 1\n\ndef seal():\n    return SECRET + 1\n",
    "src/use.ts": "export const fine = 1;\n",
  });
  try {
    // The last full run graded it through Python, over the Python files that hold the protected thing and its chokepoint.
    appendRun(root, { at: "2026-06-01T00:00:00.000Z", session: "earlier", agent: "t", binding: "none", commit: null, dirty: false, instrument: { language: "python", server: "warm" }, latency: 1, invariants: [{ component: ".", name: "sealed store", form: "chokepoint", verdict: "pass", grade: "reference-choked", refutation: "automatic", bypasses: [], testReferences: 0, files: ["backend/store.py", "backend/use.py"], latency: 1, reason: "t", language: "python" }] } as unknown as RunRecord);
    const [entry] = chokepointIndex(root, ["src/use.ts"]);
    assert.deepEqual(entry?.latest, [{ form: "chokepoint", files: ["backend/store.py", "backend/use.py"], language: "python" }], "the light path carries the last run's language and its whole file list");
    // A TypeScript edit that spells the Python symbol's name: the check is put to Python, as main puts it.
    writeFileSync(join(root, "src/use.ts"), "export const SECRET = 2;\n");
    const python = { ...NO_INSTRUMENT, language: "python" } as LanguageAdapter;
    await runHook("PostToolUse", { cwd: root, session_id: "m", tool_name: "Edit", tool_input: { file_path: join(root, "src/use.ts") } }, root, { adapter: python });
    const last = readFileSync(join(root, ".coherence", "runs", "m.jsonl"), "utf8").trim().split("\n").at(-1)!;
    assert.deepEqual((JSON.parse(last) as RunRecord).invariants.map((e) => e.language), ["python"], "the edit's check asked Python first, and recorded it so");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an edit is checked with GIT_LITERAL_PATHSPECS set as without it", async () => {
  const root = gitRepo({ "coherence.config.json": JSON.stringify({ name: "l" }), "src/a/A.spec.md": SPEC("SECRET_0"), "src/a/m.ts": "export const x = 1;\n" });
  const saved = Object.fromEntries(["GIT_LITERAL_PATHSPECS"].map((k) => [k, process.env[k]]));
  try {
    process.env["GIT_LITERAL_PATHSPECS"] = "1";
    const listed = (() => {
      try {
        return chokepointIndex(root).map((i) => i.name);
      } catch (error) {
        return [`threw: ${error instanceof Error ? error.message : String(error)}`];
      }
    })();
    assert.deepEqual(listed, ["sealed"], "the specs are listed by the light way whatever the environment says pathspecs mean");
    writeFileSync(join(root, "src/a/m.ts"), "export const leak = SECRET_0;\n");
    const answered = await runHook("PostToolUse", { cwd: root, session_id: "l", tool_name: "Edit", tool_input: { file_path: join(root, "src/a/m.ts") } }, root, { adapter: NO_INSTRUMENT });
    assert.match(answered.stdout, /could not check 1 chokepoint invariant at this edit/, "the edit naming the protected name is put to the check, as main puts it");
    assert.doesNotMatch(answered.stdout, /without its index/, "and by the light way: the listing itself was not misread");
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a spec listing that comes back empty where the project holds specs falls back to the whole model and says so", async () => {
  const root = gitRepo({ "coherence.config.json": JSON.stringify({ name: "e" }), "src/a/A.spec.md": SPEC("SECRET_0"), "src/a/m.ts": "export const x = 1;\n" });
  // A git that answers every glob pathspec with nothing, as any way of misreading one would: the listing is empty and nothing throws.
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const shim = mkdtempSync(join(tmpdir(), "coherence-empty-git-"));
  writeFileSync(join(shim, "git"), `#!/bin/sh\ncase "$*" in *":(glob)"*) exit 0 ;; esac\nexec '${real}' "$@"\n`);
  spawnSync("chmod", ["+x", join(shim, "git")]);
  const path = process.env["PATH"];
  try {
    process.env["PATH"] = `${shim}:${path ?? ""}`;
    assert.throws(() => chokepointIndex(root), /found none where the project holds some/, "an empty listing is a failure, not an answer");
    writeFileSync(join(root, "src/a/m.ts"), "export const leak = SECRET_0;\n");
    const answered = await runHook("PostToolUse", { cwd: root, session_id: "e", tool_name: "Edit", tool_input: { file_path: join(root, "src/a/m.ts") } }, root, { adapter: NO_INSTRUMENT });
    assert.match(answered.stdout, /without its index: the listing of the specs found none/, "the fallback is said");
    assert.match(answered.stdout, /could not check 1 chokepoint invariant at this edit/, "and the edit is still put to the check");
  } finally {
    process.env["PATH"] = path;
    rmSync(shim, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("an edit is checked against a spec changed at the same size with its modification time set back", async () => {
  const root = gitRepo({ "coherence.config.json": JSON.stringify({ name: "k" }), "src/a/A.spec.md": SPEC("SECRET_0"), "src/a/m.ts": "export const x = 1;\n" });
  try {
    const names = () => chokepointIndex(root).flatMap((i) => i.enforcements.flatMap((e) => (e.form === "chokepoint" ? [e.protects] : [])));
    assert.deepEqual(names(), ["SECRET_0"]);
    const spec = join(root, "src/a/A.spec.md");
    writeFileSync(spec, SPEC("SECRET_1"));
    assert.deepEqual(names(), ["SECRET_1"]);
    // The reviewer's repro: the same size, and the modification time set back to the nanosecond by touch -r.
    const was = statSync(spec);
    spawnSync("touch", ["-r", spec, `${spec}.times`]);
    writeFileSync(spec, SPEC("APIKEY_1"));
    spawnSync("touch", ["-r", `${spec}.times`, spec]);
    rmSync(`${spec}.times`);
    assert.equal(statSync(spec).size, was.size, "the change keeps the size");
    assert.equal(statSync(spec).mtimeMs, was.mtimeMs, "and the modification time");
    assert.deepEqual(names(), ["APIKEY_1"], "the changed spec is read: no parse of a spec is kept between calls");
    writeFileSync(join(root, "src/a/m.ts"), "export const APIKEY_1 = 1;\n");
    const answered = await runHook("PostToolUse", { cwd: root, session_id: "k", tool_name: "Edit", tool_input: { file_path: join(root, "src/a/m.ts") } }, root, { adapter: NO_INSTRUMENT });
    assert.match(answered.stdout, /could not check 1 chokepoint invariant at this edit/, "the edit naming the new protected name is put to the check, as main puts it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an edit's chokepoint check never goes silent because a cache cannot be used", { timeout: 120_000 }, async () => {
  const spec = "# Fixture\n\nA store.\n\n## invariants\n- sealed store: SECRET leaves only through seal.\n  protects: SECRET\n  chokepoint: seal\n  because: a fixture\n  kinds: none\n";
  const root = gitRepo({
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["src/**/*.ts"] }),
    "coherence.config.json": JSON.stringify({ language: "typescript" }),
    "Fixture.spec.md": spec,
    "src/store.ts": "export const SECRET = 1;\nexport function seal(): number {\n  return SECRET + 1;\n}\n",
    "src/use.ts": "export const fine = 1;\n",
  });
  const adapter = new TypeScriptAdapter(root);
  try {
    // Where the cache folder should be, a file: no index, no kept state, can be written or read (a read-only or root-owned cache fails the same way).
    mkdirSync(join(root, ".coherence"), { recursive: true });
    writeFileSync(cacheDir(root), "not a folder\n");
    writeFileSync(join(root, "src/use.ts"), 'import { SECRET } from "./store.ts";\nexport const leaked = SECRET;\n');
    const answered = await runHook("PostToolUse", { cwd: root, session_id: "c", tool_name: "Edit", tool_input: { file_path: join(root, "src/use.ts") } }, root, { adapter });
    const text = answered.stdout === "" ? "" : (JSON.parse(answered.stdout).hookSpecificOutput.additionalContext as string);
    assert.match(text, /Coherence checked this edit without its index: the run index could not be written/, "the hook says the check ran without its index, and why");
    assert.match(text, /Structural defect revealed at this edit[^]*✕ \.\/sealed store[^]*bypass src\/use\.ts:2/, "and the bypass is still revealed, as main reveals it");
  } finally {
    await adapter.close();
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ the run index */

function runOf(at: string, session: string, files: string[]): RunRecord {
  return { at, session, agent: "t", binding: "none", commit: null, dirty: false, instrument: { language: "typescript", server: "warm" }, latency: 1, invariants: [{ component: "src/a", name: "sealed", form: "chokepoint", verdict: "pass", refutation: "automatic", bypasses: [], testReferences: 0, files, latency: 1, reason: "t" }] } as unknown as RunRecord;
}

test("the run index answers as the run history does after appends, a replaced file, a torn or stale index, a held lock and a cache that cannot be written, and an append never throws", () => {
  const root = gitRepo({ "coherence.config.json": JSON.stringify({ name: "r" }), "src/a/A.spec.md": SPEC("SECRET_1") });
  const savedWait = process.env["COHERENCE_LOCK_WAIT_MS"];
  try {
    const key = entryKey("src/a", "sealed", "chokepoint");
    const fromHistory = (file: string) => latestByEnforcement(loadRuns(root).records).get(key)?.files.includes(file) === true;
    const fromIndex = (file: string) => latestSeeing(root, [file], parseLine).byFile.get(file)?.has(key) === true;
    const agree = (when: string) => {
      for (const file of ["src/a/x.ts", "src/a/y.ts", "src/a/z.ts", "src/a/w.ts", "src/b/y.ts"]) assert.equal(fromIndex(file), fromHistory(file), `${when}: ${file}`);
    };
    appendRun(root, runOf("2026-02-01T00:00:00.000Z", "s1", ["src/a/x.ts"]));
    agree("one append");
    appendRun(root, runOf("2026-02-02T00:00:00.000Z", "s2", ["src/a/y.ts", "src/b/y.ts"]));
    appendRun(root, runOf("2026-01-01T00:00:00.000Z", "s3", ["src/a/z.ts"]));
    agree("an earlier run appended later");
    const index = join(cacheDir(root), "run-index.json");
    // The crash the reviewer simulated: an index left wrong by a stop half way. Written whole and renamed, it is old or new, never half;
    // and one that is torn, or names the store as it no longer is, is rebuilt before it answers.
    writeFileSync(index, readFileSync(index, "utf8").slice(0, 40));
    agree("a torn index");
    const held = JSON.parse(readFileSync(index, "utf8")) as { latest: Record<string, { files: string[] }> };
    held.latest[key]!.files = [];
    writeFileSync(index, JSON.stringify(held));
    appendFileSync(join(root, ".coherence", "runs", "s2.jsonl"), "");
    // An index that names every file at its identity but is wrong inside cannot come from an append, a rename or a crash; one that a run
    // file outgrew can, and is caught: here a line appended without the fold.
    appendFileSync(join(root, ".coherence", "runs", "s1.jsonl"), JSON.stringify(runOf("2026-02-03T00:00:00.000Z", "s1", ["src/a/w.ts"])) + "\n");
    agree("an append the index never saw");
    // A file a checkout replaced, past the folder clock's tick.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    const s2 = join(root, ".coherence", "runs", "s2.jsonl");
    rmSync(s2);
    writeFileSync(s2, JSON.stringify(runOf("2026-02-04T00:00:00.000Z", "s2", ["src/b/y.ts"])) + "\n");
    agree("a replaced file");
    // A lock another writer holds: the append's fold gives up, the append still stands, and the reader that cannot rebuild says so.
    process.env["COHERENCE_LOCK_WAIT_MS"] = "100";
    writeFileSync(join(cacheDir(root), "run-index.lock"), "");
    appendRun(root, runOf("2026-02-05T00:00:00.000Z", "s4", ["src/a/x.ts"]));
    assert.ok(loadRuns(root).records.some((r) => r.session === "s4"), "the append stands though its fold gave up");
    assert.throws(() => latestSeeing(root, ["src/a/x.ts"], parseLine), (error: unknown) => error instanceof RunIndexUnavailable && /lock/.test(error.message), "a reader that cannot rebuild says why, never answers from the stale index");
    rmSync(join(cacheDir(root), "run-index.lock"));
    agree("the lock released");
    // A cache that cannot be written at all: every append still stands, and every lookup says why it cannot answer.
    rmSync(cacheDir(root), { recursive: true, force: true });
    writeFileSync(cacheDir(root), "not a folder\n");
    assert.doesNotThrow(() => appendRun(root, runOf("2026-02-06T00:00:00.000Z", "s5", ["src/a/y.ts"])), "an append never throws after it appended");
    assert.ok(loadRuns(root).records.some((r) => r.session === "s5"));
    assert.throws(() => latestSeeing(root, ["src/a/y.ts"], parseLine), RunIndexUnavailable);
  } finally {
    if (savedWait === undefined) delete process.env["COHERENCE_LOCK_WAIT_MS"];
    else process.env["COHERENCE_LOCK_WAIT_MS"] = savedWait;
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ the feed */

function decision(id: string, at: string, session: string): JournalRecord {
  return { id, kind: "decision", at, session, agent: "peer", commit: null, dirty: false, chose: `choice ${id}`, over: ["another"], because: "a fixture" } as unknown as JournalRecord;
}

test("the peer feed shows every record a peer appended, through a cleared cache and memo, a file that arrived from outside, and a peer who reads between appends", () => {
  const root = gitRepo({ "coherence.config.json": JSON.stringify({ name: "f" }) });
  try {
    appendRecord(root, decision("d-00000001", "2026-03-01T00:00:00.000Z", "peer1"));
    for (const reader of ["a", "b"]) writeCursor(root, reader, { at: "2026-03-01T00:00:00.000Z", id: "d-00000001" });
    peerFeed(root, "a").commit();
    appendRecord(root, decision("d-00000002", "2026-03-02T00:00:00.000Z", "peer1"));
    // The reviewer's case: one reader looks, the cache is cleared, more is appended, and the other reader looks.
    const a = peerFeed(root, "a");
    assert.match(a.text, /d-00000002/);
    a.commit();
    rmSync(join(root, ".coherence", "cache"), { recursive: true, force: true });
    rmSync(join(root, ".coherence", "feed", "a.seen"), { force: true });
    appendRecord(root, decision("d-00000003", "2026-03-03T00:00:00.000Z", "peer2"));
    const b = peerFeed(root, "b");
    assert.match(b.text, /d-00000002/, "reader b sees every record since its cursor");
    assert.match(b.text, /d-00000003/);
    const again = peerFeed(root, "a");
    assert.match(again.text, /d-00000003/, "reader a, its memo gone, still sees what came after its cursor");
    assert.doesNotMatch(again.text, /◆ d-00000002/, "and nothing it was shown twice");
    again.commit();
    assert.equal(peerFeed(root, "a").text, "", "nothing new, nothing said");
    // A journal file written by something other than appendRecord (a pull) is read, its identity having changed.
    writeFileSync(join(root, ".coherence", "journal", "pulled.jsonl"), JSON.stringify(decision("d-00000004", "2026-03-04T00:00:00.000Z", "pulled")) + "\n");
    assert.match(peerFeed(root, "a").text, /d-00000004/, "a record that arrived another way is seen");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ the kept vocabulary */

test("an edit over torn or missing vocabulary buckets reads in full, says so, names nothing false and writes nothing derived from them", async () => {
  for (const damage of ["torn term buckets", "a missing file bucket", "a term bucket in another shape"] as const) {
    const project = sizedProject(1);
    try {
      const start = await runHook("SessionStart", { session_id: SESSION, cwd: project.root }, project.root, {});
      start.commit?.();
      const state = join(cacheDir(project.root), "vocabulary");
      // Every bucket the state could hold is listed and damaged, so whichever ones this edit reads are damaged.
      const ids = Array.from({ length: 64 }, (_, n) => String(n).padStart(2, "0"));
      const meta = JSON.parse(readFileSync(join(state, "meta.json"), "utf8")) as Record<string, unknown>;
      writeFileSync(join(state, "meta.json"), JSON.stringify({ ...meta, buckets: { files: ids, terms: ids } }));
      if (damage === "torn term buckets") for (const id of ids) writeFileSync(join(state, "terms", `${id}.json`), "{");
      if (damage === "a term bucket in another shape") for (const id of ids) writeFileSync(join(state, "terms", `${id}.json`), JSON.stringify({ pool: { x: { named: "three" } }, words: {} }));
      if (damage === "a missing file bucket") for (const name of readdirSync(join(state, "files"))) rmSync(join(state, "files", name));
      // An ordinary edit: a line that names a term once, which no whole reading would call recurring; the edit reads that term's bucket.
      const file = join(project.root, "docs/note-0.md");
      writeFileSync(file, readFileSync(file, "utf8") + "The `zorbix` turns again.\n");
      const m = await workOf(project, "PostToolUse", { tool_name: "Edit", tool_input: { file_path: file } });
      assert.match(m.said, /Lexicon: read in full at this edit: (a kept bucket|its kept)/, `${damage}: the fallback is said`);
      assert.ok(m.work.reads.filter((r) => r.startsWith("corpus ")).length > 1, `${damage}: the corpus was read in full`);
      assert.doesNotMatch(m.said, /recur without a definition|sense at risk/, `${damage}: an ordinary edit is named nothing, as a whole reading names it nothing`);
      // The full reading kept the state again, whole: no bucket is left torn, none holds totals derived from the damaged parts.
      for (const kind of ["terms", "files"]) for (const name of readdirSync(join(state, kind))) assert.doesNotThrow(() => JSON.parse(readFileSync(join(state, kind, name), "utf8")), `${damage}: ${kind}/${name} is whole again`);
      const next = await workOf(project, "PostToolUse", { tool_name: "Edit", tool_input: { file_path: file } });
      assert.doesNotMatch(next.said, /read in full/, `${damage}: the next edit reads the state the full reading kept`);
    } finally {
      rmSync(project.top, { recursive: true, force: true });
    }
  }
});

test("a write no hook saw is caught at the next edit, which reads in full as main does", async () => {
  const project = sizedProject(1);
  try {
    const start = await runHook("SessionStart", { session_id: SESSION, cwd: project.root }, project.root, {});
    start.commit?.();
    // A generator, a checkout or a shell command the shell reader does not parse: the file changes and no hook hears of it.
    const unseen = join(project.root, "docs/note-1.md");
    writeFileSync(unseen, readFileSync(unseen, "utf8") + "The `rebate` is new.\nEach `rebate` is paid.\n");
    const file = join(project.root, "docs/note-0.md");
    writeFileSync(file, readFileSync(file, "utf8") + "A `rebate` is clawed back.\n");
    const m = await workOf(project, "PostToolUse", { tool_name: "Edit", tool_input: { file_path: file } });
    assert.match(m.said, /Lexicon: read in full at this edit: the tree moved since its vocabulary was kept, beyond what this edit wrote \(docs\/note-1\.md\)/, "the unseen write is said");
    assert.match(m.said, /"rebate" recur without a definition/, "and the term it made recur with this edit is named, as main names it");
  } finally {
    rmSync(project.top, { recursive: true, force: true });
  }
});

test("an edit whose kept vocabulary was left half-written reads in full and says so", async () => {
  const project = sizedProject(1);
  try {
    const start = await runHook("SessionStart", { session_id: SESSION, cwd: project.root }, project.root, {});
    start.commit?.();
    const meta = join(cacheDir(project.root), "vocabulary", "meta.json");
    writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, "utf8")), writing: true }));
    const file = join(project.root, "docs/note-0.md");
    writeFileSync(file, readFileSync(file, "utf8") + "The `rebate` is new.\nEach `rebate` is paid.\nA `rebate` is clawed back.\n");
    const m = await workOf(project, "PostToolUse", { tool_name: "Edit", tool_input: { file_path: file } });
    assert.match(m.said, /Lexicon: read in full at this edit: its kept vocabulary was left half-written/, "the fallback is said");
    assert.match(m.said, /"rebate" recur without a definition/, "and the full reading still names what the edit introduced");
    assert.ok(m.work.reads.filter((r) => r.startsWith("corpus ")).length > 1, "the corpus was read in full");
  } finally {
    rmSync(project.top, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ nested scopes */

test("a work scope opened inside another adds its counts to the outer one", () => {
  const outer = openWork();
  countWork("spawn");
  const inner = openWork();
  countWork("spawn", 2);
  countWork("file read");
  const innerWork = closeWork(inner);
  countWork("spawn");
  const outerWork = closeWork(outer);
  assert.equal(innerWork.counts.spawn, 2, "the inner scope's own count");
  assert.equal(outerWork.counts.spawn, 4, "the outer scope holds its own work and the inner's");
  assert.equal(outerWork.counts["file read"], 1);
});


