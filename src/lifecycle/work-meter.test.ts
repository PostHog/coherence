/**
 * The hooks' work does not grow with the project: each hook event runs
 * through runHook over the same synthetic project at 1× and at 10×, and the
 * work meter's counts, which no machine load can move, are compared.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runHook, type HookEvent, type HookInput } from "./hook.ts";
import { closeWork, lastHookWork, openWork, type Work } from "./work-meter.ts";
import { sizedProject, type SizedProject } from "./size-fixture.ts";
import { countingGit } from "../adapters/git-count-fixture.ts";
import { lexiconCoverage } from "./lexicon-coverage.ts";
import { loadLexicon } from "./lexicon.ts";
import { COHERENCE_LEXICON } from "./project.ts";

const SESSION = "sized";

/** One hook call's work, with every path spelled from the repository's top so two sizes compare. */
async function workOf(project: SizedProject, event: HookEvent, input: HookInput, fallback: string = project.root): Promise<Work> {
  // No instrument: a check the edit would make is answered as not run, never by a warm server started for a fixture.
  await runHook(event, { session_id: SESSION, cwd: project.root, ...input }, fallback, { door: async (_root, fn) => fn(undefined, undefined, "no instrument in this test") });
  const work = lastHookWork();
  assert.ok(work !== undefined, "runHook closed a scope");
  const local = (text: string): string => text.split(project.top).join("<top>");
  return { counts: work.counts, reads: work.reads.map(local), spawns: work.spawns.map(local) };
}

/** Both sizes, each built fresh, handed to `body`, and removed. */
async function atBothSizes<T>(body: (project: SizedProject) => Promise<T>): Promise<[T, T]> {
  const out: T[] = [];
  for (const scale of [1, 10]) {
    const project = sizedProject(scale);
    try {
      // The session's vocabulary baseline, as its start would keep it, so every reading a hook may take is taken.
      mkdirSync(join(project.root, ".coherence", "lexicon", "sessions"), { recursive: true });
      writeFileSync(join(project.root, ".coherence", "lexicon", "sessions", `${SESSION}.json`), "{}");
      out.push(await body(project));
    } finally {
      rmSync(project.top, { recursive: true, force: true });
    }
  }
  return [out[0]!, out[1]!];
}

const read = (project: SizedProject, file: string) => ({ tool_name: "Read", tool_input: { file_path: join(project.root, file) } });
const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });

test("a tool use that writes nothing does the same work at 1× and 10×, and reads no corpus and no coverage", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    // The first command fills the kept practice parses; what is measured is every tool use after it.
    await workOf(project, "PreToolUse", bash("ls"));
    const works: Record<string, Work> = {};
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
    assert.deepEqual(large[name], small[name], `${name} does the same work over 30 components as over 3`);
    assert.equal(small[name]!.counts["coverage reading"], 0, `${name} takes no coverage reading`);
    assert.equal(small[name]!.reads.filter((r) => r.startsWith("corpus ")).length, 0, `${name} reads no corpus`);
    assert.equal(small[name]!.counts["spec model"], 0, `${name} loads no spec model`);
  }
});

test("an edit inside one component reads that component and the file it wrote, the same at 1× and 10×", async () => {
  const [small, large] = await atBothSizes(async (project) => {
    const file = join(project.root, "src/c1/m.ts");
    const edit = (n: number) => {
      writeFileSync(file, readFileSync(file, "utf8") + `export const edited${n} = ${n};\n`);
      return { tool_name: "Edit", tool_input: { file_path: file, old_string: "x", new_string: `export const edited${n} = ${n};` } };
    };
    // The first edit fills the kept spec and practice parses, as the session's first tool uses do.
    await workOf(project, "PreToolUse", edit(0));
    await workOf(project, "PostToolUse", edit(0));
    const input = edit(1);
    return { pre: await workOf(project, "PreToolUse", input), post: await workOf(project, "PostToolUse", input) };
  });
  assert.deepEqual(large, small, "the edit does the same work beside 29 other components as beside 2");
  const allowed = (r: string) => r.replace(/^\S+ /, "").startsWith("<top>/proj/src/c1/");
  for (const [name, work] of Object.entries(small)) {
    assert.deepEqual(work.reads.filter((r) => !allowed(r)), [], `${name} reads nothing outside the edited component`);
    assert.equal(work.counts["spec model"], 0, `${name} loads no spec model: no chokepoint invariant is touched`);
    assert.equal(work.counts["server request"], 0, `${name} asks no language server`);
  }
  assert.equal(small.post.counts["coverage reading"], 1, "the edit takes one coverage reading, of its component");
  assert.ok(small.post.reads.some((r) => r === "source <top>/proj/src/c1/m.ts"), "the written file is read for the chokepoint check");
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
  assert.deepEqual(large, small, "the second prompt does the same work over 30 components as over 3");
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

/** A project of `lines` prose lines, each carrying `extra` and the fixture's words, with a lexicon of `concepts` names no line writes and `starts` names one line word starts. */
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

test("no source module spawns a child process except through the work meter", () => {
  const src = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const meter = join(src, "lifecycle", "work-meter.ts");
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith("-fixture.ts") && path !== meter) {
        if (/\bfrom\s+["'](?:node:)?child_process["']|\brequire\(\s*["'](?:node:)?child_process["']|\bimport\(\s*["'](?:node:)?child_process["']/.test(readFileSync(path, "utf8"))) offenders.push(relative(src, path));
      }
    }
  };
  walk(src);
  assert.deepEqual(offenders, [], "a module that takes child_process itself spawns where no hook's count can see it");
});
