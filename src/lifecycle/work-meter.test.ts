/**
 * The hooks' work does not grow with the project: each hook event runs
 * through runHook over the same synthetic project at 1× and at 10× (ten
 * times the components, files, lines, practices, lexicon and history, at the
 * same folder depth), and two counts no machine load can move are compared:
 * the work meter's, and every call the process makes to the file system's
 * reading and listing functions, which also sees a read that slipped past
 * the meter's door.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runHook, type HookEvent, type HookInput } from "./hook.ts";
import { closeWork, countWork, lastHookWork, openWork, type Work } from "./work-meter.ts";
import { sizedProject, type SizedProject } from "./size-fixture.ts";
import { countingFs, type FsCount } from "./fs-count-fixture.ts";
import { countingGit } from "../adapters/git-count-fixture.ts";
import { lexiconCoverage } from "./lexicon-coverage.ts";
import { loadLexicon } from "./lexicon.ts";
import { COHERENCE_LEXICON } from "./project.ts";
import { keptParses, listedContent } from "./kept-parse.ts";
import { CODE_SALT_ENV, forgetCodeIdentity } from "../enforcement/code-fingerprint.ts";
import { appendRun, entryKey, latestByEnforcement, loadRuns, parseLine, type RunRecord } from "../enforcement/record.ts";
import { latestSeeing } from "../enforcement/run-index.ts";
import { chokepointIndex } from "../spec/model.ts";
import { peerFeed, writeCursor } from "../journal/feed.ts";
import { appendRecord } from "../journal/store.ts";
import type { JournalRecord } from "../journal/record.ts";

const SESSION = "sized";

interface Measured extends Work {
  fs: FsCount;
}

/** One hook call's work, the meter's and the file system's, with every path spelled from the repository's top so two sizes compare. */
async function workOf(project: SizedProject, event: HookEvent, input: HookInput, fallback: string = project.root): Promise<Measured> {
  // No instrument: a check the edit would make is answered as not run, never by a warm server started for a fixture.
  const { fs } = await countingFs(() => runHook(event, { session_id: SESSION, cwd: project.root, ...input }, fallback, { door: async (_root, fn) => fn(undefined, undefined, "no instrument in this test") }));
  const work = lastHookWork();
  assert.ok(work !== undefined, "runHook closed a scope");
  const local = (text: string): string => text.split(project.top).join("<top>");
  return { counts: work.counts, reads: work.reads.map(local), spawns: work.spawns.map(local), fs: { calls: fs.calls, paths: fs.paths.map(local) } };
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
function projectReads(work: Measured): string[] {
  return work.fs.paths
    .filter((p) => /^(readFileSync|promises\.readFile|callback\.readFile|openSync) <top>\/proj\//.test(p))
    .map((p) => p.replace(/^\S+ <top>\/proj\//, ""))
    .filter((p) => !p.startsWith(".coherence/"));
}

test("a tool use that writes nothing does the same work at 1× and 10×, and reads no corpus and no coverage", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    // The first command fills the kept practice parses; what is measured is every tool use after it.
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
  for (const name of Object.keys(small)) {
    assert.deepEqual(large[name]!.fs, small[name]!.fs, `${name} makes the same file system calls over 30 components and their history as over 3`);
    assert.deepEqual(large[name], small[name], `${name} does the same work over 30 components as over 3`);
    assert.equal(small[name]!.counts["coverage reading"], 0, `${name} takes no coverage reading`);
    assert.equal(small[name]!.reads.filter((r) => r.startsWith("corpus ")).length, 0, `${name} reads no corpus`);
    assert.equal(small[name]!.counts["spec model"], 0, `${name} loads no spec model`);
    assert.deepEqual(projectReads(small[name]!).filter((p) => !["coherence.config.json", "lexicon.json", "package.json"].includes(p)), [], `${name} reads no project file but its config`);
  }
});

test("an edit reads the files it names and a constant, the same at 1× and 10×, wherever the file lies", async () => {
  const files = { "small component": "src/c1/m.ts", "large component": "src/big/part-0.md", "root file": "README.md", "file in no sub-component": "docs/note-0.md" };
  const [small, large] = await atBothSizes(async (project) => {
    const out: Record<string, { pre: Measured; post: Measured }> = {};
    for (const [where, rel] of Object.entries(files)) {
      const file = join(project.root, rel);
      const edit = (n: number) => {
        writeFileSync(file, readFileSync(file, "utf8") + (rel.endsWith(".ts") ? `export const edited${n} = ${n};\n` : `An edit numbered ${n}.\n`));
        return { tool_name: "Edit", tool_input: { file_path: file, old_string: "x", new_string: `edit ${n}` } };
      };
      // The session's first edit of a file keeps its parses as the first tool uses do; what is measured is the edit after it.
      await workOf(project, "PreToolUse", edit(0));
      await workOf(project, "PostToolUse", edit(0));
      const input = edit(1);
      out[where] = { pre: await workOf(project, "PreToolUse", input), post: await workOf(project, "PostToolUse", input) };
    }
    return out;
  });
  for (const where of Object.keys(files)) {
    const rel = files[where as keyof typeof files];
    for (const at of ["pre", "post"] as const) {
      const s = small[where]![at];
      const l = large[where]![at];
      assert.deepEqual(l.fs, s.fs, `${where}, ${at}: the same file system calls beside ten times the components, files and history`);
      assert.deepEqual(l, s, `${where}, ${at}: the same work beside ten times the components, files and history`);
      assert.deepEqual(s.reads.filter((r) => !r.endsWith(`/proj/${rel}`)), [], `${where}, ${at}: the meter's reads are the edited file's alone`);
      assert.deepEqual([...new Set(projectReads(s))].filter((p) => p !== rel && !["coherence.config.json", "lexicon.json", "package.json"].includes(p)), [], `${where}, ${at}: no other project file is read`);
      assert.equal(s.counts["spec model"] + s.counts["server request"], 0, `${where}, ${at}: no spec model and no instrument: no chokepoint invariant is touched`);
    }
    assert.equal(small[where]!.post.counts["coverage reading"], 1, `${where}: one reading, of the file it wrote`);
  }
});

test("an event outside every project does the same work at 1× and 10×, and reads nothing", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    const outside = { cwd: project.other };
    const note = join(project.other, "note-0.md");
    const write = { ...outside, tool_name: "Write", tool_input: { file_path: note, content: "x\n" } };
    // The project's own practices are parsed once, as by any first command; a cd out of the project is then read against no project.
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
  assert.deepEqual(large, small, "outside the project, its size changes nothing");
  for (const [name, work] of Object.entries(small)) {
    assert.deepEqual(work.reads, [], `${name} reads no project file`);
    assert.equal(work.counts["coverage reading"] + work.counts["spec model"] + work.counts["server request"], 0, `${name} takes no reading`);
  }
});

test("a prompt over an unchanged tree reads no corpus, the same at 1× and 10×", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    await workOf(project, "UserPromptSubmit", { prompt: "first" });
    return workOf(project, "UserPromptSubmit", { prompt: "second" });
  });
  assert.deepEqual(large, small, "the second prompt does the same work and file system calls over 30 components as over 3");
  assert.equal(small.counts["coverage reading"], 0, "no coverage reading over a tree that has not moved");
  assert.deepEqual(small.reads, [], "no project file read");
});

test("the hooks' git spawns all pass the work meter", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    const git = countingGit();
    try {
      const counted: string[] = [];
      for (const [event, input] of [["PreToolUse", bash("ls")], ["PostToolUse", bash("ls")], ["UserPromptSubmit", { prompt: "p" }]] as const) {
        git.reset();
        const work = await workOf(project, event, input);
        assert.equal(work.spawns.filter((s) => s.startsWith("git ")).length, git.calls().length, `${event}: the meter saw every git the shim saw`);
        counted.push(`${event} ${work.counts.spawn}`);
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

/** The meter, and the test-support files, each by name, allowed what the scan refuses elsewhere. */
const SPAWN_ALLOWED = new Set(["lifecycle/work-meter.ts"]);
/** Test support that takes child_process to build fixtures, by name. */
const FIXTURES_THAT_SPAWN = new Set(["adapters/git-count-fixture.ts", "lifecycle/size-fixture.ts", "readings/scope/undeclared-fixture.ts", "readings/scope/gaps-fixture.ts"]);
/**
 * Test support that loads a module by a computed name, by name: the file
 * system counter; this file, which spells every refused form; and two tests
 * whose fixture is a script they hand a child node process.
 */
const LOADERS_ALLOWED = new Set(["lifecycle/fs-count-fixture.ts", "lifecycle/work-meter.test.ts", "enforcement/enforcement.test.ts", "enforcement/server.test.ts"]);

/** Ways to reach a module that no import list names: refused everywhere but the meter and test support listed by name. */
const LOADERS: [string, RegExp][] = [
  ["getBuiltinModule", /\bgetBuiltinModule\b/],
  ["createRequire", /\bcreateRequire\b/],
  ["require(", /(?<![\w$])require\s*\(/],
  ["import( of a computed name", /(?<![\w$.])import\s*\((?!\s*["'][^"'`$\\]*["']\s*(?:as\s+string\s*)?\))/],
  ["process.binding", /\bprocess\s*\.\s*(?:_linkedBinding|binding)\b/],
  ["eval(", /(?<![\w$.])eval\s*\(/],
  ["new Function(", /\bnew\s+Function\s*\(/],
];

/** What the scan refuses in one file's text: child_process named outside the meter and the fixtures, and any computed module load. */
function spawnOffences(rel: string, source: string): string[] {
  const out: string[] = [];
  // A line that is wholly a comment says, never does: prose about require( or import( is not a load.
  const text = source.split("\n").filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join("\n");
  const test = /\.(?:test|e2e)\.[cm]?[jt]s$/.test(rel);
  if (!test && !SPAWN_ALLOWED.has(rel) && !FIXTURES_THAT_SPAWN.has(rel) && /child_process/.test(text)) out.push(`${rel}: names child_process`);
  if (!SPAWN_ALLOWED.has(rel) && !LOADERS_ALLOWED.has(rel)) for (const [name, pattern] of LOADERS) if (pattern.test(text)) out.push(`${rel}: ${name}`);
  return out;
}

test("no source module spawns a child process except through the work meter", () => {
  const src = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.[cm]?[jt]s$/.test(name)) offenders.push(...spawnOffences(relative(src, path).split("\\").join("/"), readFileSync(path, "utf8")));
    }
  };
  walk(src);
  assert.deepEqual(offenders, [], "a module that takes child_process itself, or loads a module by a computed name, spawns where no hook's count can see it");
  // Every way around the import list the scan knows, each refused in an ordinary module.
  const evasions = [
    'import { spawnSync } from "node:child_process";',
    "import cp from 'child_process';",
    'const { spawnSync } = process.getBuiltinModule("node:child_process");',
    'const load = createRequire(import.meta.url); load("node:" + "child" + "_process");',
    'const cp = require("child" + "_process");',
    "const name = 'child' + '_process'; await import(`node:${name}`);",
    "await import(name);",
    'process.binding("spawn_sync");',
    'eval("req" + "uire")("child" + "_process");',
    'new Function("return req" + "uire")()("child" + "_process");',
  ];
  for (const text of evasions) {
    for (const rel of ["lifecycle/ordinary.ts", "lifecycle/ordinary.js", "lifecycle/ordinary.mjs", "lifecycle/ordinary.cjs"]) assert.notDeepEqual(spawnOffences(rel, text), [], `refused in ${rel}: ${text}`);
    if (!/child_process/.test(text)) assert.notDeepEqual(spawnOffences("lifecycle/ordinary.test.ts", text), [], `refused in a test too: ${text}`);
  }
  assert.deepEqual(spawnOffences("lifecycle/ordinary.ts", 'const { x } = await import("./x.ts");'), [], "a literal import is an import list");
});

/* ------------------------------------------------------------ kept parses */

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

test("a kept parse is never served for a file whose content changed, at the same size with its time set back, or for other code", async () => {
  const root = gitRepo({ "coherence.config.json": JSON.stringify({ name: "k" }), "src/a/A.spec.md": SPEC("SECRET_0"), "src/a/m.ts": "export const x = 1;\n" });
  try {
    const names = () => chokepointIndex(root).flatMap((i) => i.enforcements.flatMap((e) => (e.form === "chokepoint" ? [e.protects] : [])));
    assert.deepEqual(names(), ["SECRET_0"]);
    // An uncommitted change, kept: what a store keyed by a stat would key by its size and time.
    const spec = join(root, "src/a/A.spec.md");
    writeFileSync(spec, SPEC("SECRET_1"));
    assert.deepEqual(names(), ["SECRET_1"]);
    // The reviewer's repro: the same size, and the modification time set back to what it was.
    const was = statSync(spec);
    // touch -r keeps the times to the nanosecond, as the reviewer restored them.
    spawnSync("touch", ["-r", spec, `${spec}.times`]);
    writeFileSync(spec, SPEC("APIKEY_1"));
    spawnSync("touch", ["-r", `${spec}.times`, spec]);
    rmSync(`${spec}.times`);
    assert.equal(statSync(spec).size, was.size, "the change keeps the size");
    assert.equal(statSync(spec).mtimeMs, was.mtimeMs, "and the modification time");
    assert.deepEqual(names(), ["APIKEY_1"], "the changed spec is read again");
    // And at the hook: an edit that names the new protected name is checked, as main always checks it.
    writeFileSync(join(root, "src/a/m.ts"), "export const APIKEY_1 = 1;\n");
    await runHook("PostToolUse", { cwd: root, session_id: "k", tool_name: "Edit", tool_input: { file_path: join(root, "src/a/m.ts") } }, root, { door: async (_r, fn) => fn(undefined, undefined, "no instrument in this test") });
    assert.equal(lastHookWork()?.counts["spec model"], 1, "the touched invariant is checked: the spec model is loaded for it");
    // Other code: a store kept by another code identity is discarded and every file parsed again.
    const listed = listedContent(root, [":(glob)**/*.spec.md"], "spec")!;
    let parses = 0;
    const parse = (text: string) => {
      parses += 1;
      return text.length;
    };
    keptParses(root, "kept-test", "t-1", ["spec/grammar.ts"], listed, "spec", parse);
    keptParses(root, "kept-test", "t-1", ["spec/grammar.ts"], listed, "spec", parse);
    assert.equal(parses, 1, "the same code and content: parsed once");
    const saved = process.env[CODE_SALT_ENV];
    try {
      process.env[CODE_SALT_ENV] = "another release";
      forgetCodeIdentity();
      keptParses(root, "kept-test", "t-1", ["spec/grammar.ts"], listed, "spec", parse);
      assert.equal(parses, 2, "other code: parsed again");
    } finally {
      if (saved === undefined) delete process.env[CODE_SALT_ENV];
      else process.env[CODE_SALT_ENV] = saved;
      forgetCodeIdentity();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ the run index */

function runOf(at: string, session: string, files: string[]): RunRecord {
  return { at, session, agent: "t", binding: "none", commit: null, dirty: false, instrument: { language: "typescript", server: "warm" }, latency: 1, invariants: [{ component: "src/a", name: "sealed", form: "chokepoint", verdict: "pass", refutation: "automatic", bypasses: [], testReferences: 0, files, latency: 1, reason: "t" }] } as unknown as RunRecord;
}

test("the run index answers which chokepoint's latest run saw a file, as the run history does, through appends and a file git replaced", () => {
  const root = gitRepo({ "coherence.config.json": JSON.stringify({ name: "r" }), "src/a/A.spec.md": SPEC("SECRET_1") });
  try {
    const key = entryKey("src/a", "sealed", "chokepoint");
    const fromHistory = (file: string) => latestByEnforcement(loadRuns(root).records).get(key)?.files.includes(file) === true;
    const fromIndex = (file: string) => latestSeeing(root, [file], parseLine).get(file)?.has(key) === true;
    appendRun(root, runOf("2026-02-01T00:00:00.000Z", "s1", ["src/a/x.ts"]));
    assert.equal(fromIndex("src/a/x.ts"), true);
    appendRun(root, runOf("2026-02-02T00:00:00.000Z", "s2", ["src/a/y.ts"]));
    for (const file of ["src/a/x.ts", "src/a/y.ts"]) assert.equal(fromIndex(file), fromHistory(file), `${file}: the latest run's files`);
    // An earlier run appended later is not the latest.
    appendRun(root, runOf("2026-01-01T00:00:00.000Z", "s3", ["src/a/z.ts"]));
    assert.equal(fromIndex("src/a/z.ts"), false);
    assert.equal(fromIndex("src/a/y.ts"), true);
    // A run file replaced from outside (a checkout writes a new file): the folder changes, and the index is rebuilt from the files as they are.
    const s2 = join(root, ".coherence", "runs", "s2.jsonl");
    // A checkout comes later than the run it replaces: past the folder clock's tick, which on Linux can hold one time for several milliseconds.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    rmSync(s2);
    writeFileSync(s2, JSON.stringify(runOf("2026-02-03T00:00:00.000Z", "s2", ["src/a/w.ts"])) + "\n");
    for (const file of ["src/a/x.ts", "src/a/y.ts", "src/a/w.ts"]) assert.equal(fromIndex(file), fromHistory(file), `${file}: after the replacement`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ the feed */

function decision(id: string, at: string, session: string): JournalRecord {
  return { id, kind: "decision", at, session, agent: "peer", commit: null, dirty: false, chose: `choice ${id}`, over: ["another"], because: "a fixture" } as unknown as JournalRecord;
}

test("the peer feed reads what was appended since its last look, and a journal file that arrived outside the log", () => {
  const root = gitRepo({ "coherence.config.json": JSON.stringify({ name: "f" }) });
  try {
    appendRecord(root, decision("d-00000001", "2026-03-01T00:00:00.000Z", "peer1"));
    writeCursor(root, "me", { at: "2026-03-01T00:00:00.000Z", id: "d-00000001" });
    // The first look reads the whole journal once and keeps its offset.
    peerFeed(root, "me").commit();
    appendRecord(root, decision("d-00000002", "2026-03-02T00:00:00.000Z", "peer1"));
    const appended = peerFeed(root, "me");
    assert.match(appended.text, /d-00000002/, "an appended record reaches the feed from the log");
    appended.commit();
    assert.equal(peerFeed(root, "me").text, "", "and is not shown twice");
    // A journal file written by something other than appendRecord (a pull) changes the folder: the next look reads the whole journal.
    writeFileSync(join(root, ".coherence", "journal", "pulled.jsonl"), JSON.stringify(decision("d-00000003", "2026-03-03T00:00:00.000Z", "pulled")) + "\n");
    assert.match(peerFeed(root, "me").text, /d-00000003/, "a record that arrived outside the log is still seen");
  } finally {
    rmSync(root, { recursive: true, force: true });
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
