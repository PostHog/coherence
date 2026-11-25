import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runHook } from "../../lifecycle/hook.ts";
import { adviceFor, adviceStopText, foldWrites, loadAdvice, recordAdviceIndex, withOverlay, type AdviceIndex } from "./advice.ts";
import { mirrorsCommand } from "./cli.ts";

/* ------------------------------------------------------------ fixtures */

const HOMES: Record<string, string> = {
  "coherence.config.json": JSON.stringify({ name: "zqadvice" }),
  "src/journal/stores.ts": 'export const LINE_EXTENSION = ".zqjsonl";\nexport const SHARD_SUFFIX = /\\.[0-9a-f]{8}\\.(zqjsonl|zqjsonseq)\\b/;\nconst STDIO = ["zqpipe", "zqignore", "zqinherit", "zqoverlapped"];\nexport const quiet = (s: string): boolean => STDIO.includes(s);\nimport { pad } from "./util.ts";\nexport const padded = pad;\n',
  "src/journal/util.ts": "export const pad = (s: string): string => s.padStart(8);\n",
  "src/lifecycle/times.ts": 'export interface ZqTime { zqat: string; zqevent: string; zqms: number }\nfunction parseZqTimes(text: string): ZqTime[] {\n  return text.split("\\n").flatMap((line) => {\n    try {\n      const v = JSON.parse(line) as Partial<ZqTime>;\n      return typeof v.zqat === "string" && typeof v.zqevent === "string" && typeof v.zqms === "number" ? [v as ZqTime] : [];\n    } catch {\n      return [];\n    }\n  });\n}\nexport const times = parseZqTimes;\n',
  "src/main.ts": 'import { LINE_EXTENSION, SHARD_SUFFIX, quiet } from "./journal/stores.ts";\nimport { times } from "./lifecycle/times.ts";\nexport const all = [LINE_EXTENSION, SHARD_SUFFIX, quiet, times];\n',
};

/** A project whose homes are kept in an advice index, as a session start's refresh keeps one. */
async function warmed(files: Record<string, string> = {}): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "coherence-advice-"));
  for (const [path, text] of Object.entries({ ...HOMES, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "the homes");
  const io = { out: (): void => {}, err: (): void => {} };
  // A reading of HEAD with the default options is the one kept, with its advice index, as a session's refresh keeps it.
  assert.equal(await mirrorsCommand(root, [], io), 0);
  return root;
}

const SESSION = "advice-session";

async function preToolUse(root: string, tool: string, toolInput: Record<string, unknown> | string): Promise<{ stdout: string; exit: number; context: string }> {
  const result = await runHook("PreToolUse", { session_id: SESSION, cwd: root, hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput }, root, { refresh: async () => {}, mirrors: () => {} });
  result.commit?.();
  const answered = result.stdout.trim() === "" ? {} : (JSON.parse(result.stdout) as { hookSpecificOutput?: { additionalContext?: string } });
  return { stdout: result.stdout, exit: result.exit, context: answered.hookSpecificOutput?.additionalContext ?? "" };
}

const COPY = 'export const SUFFIX = ".zqjsonl";\n';

/** A Write as a session makes it: told before, written, then the hook after it, which folds what the write defines into the session's overlay. */
async function land(root: string, file: string, content: string): Promise<string> {
  const before = await preToolUse(root, "Write", { file_path: join(root, file), content });
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
  const after = await runHook("PostToolUse", { session_id: SESSION, cwd: root, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(root, file), content }, tool_response: {} }, root, { refresh: async () => {}, mirrors: () => {} });
  after.commit?.();
  assert.equal(after.exit, 0);
  assert.doesNotMatch(after.stdout, /permissionDecision|"decision"|"block"|"deny"/, "the hook after a write only adds context");
  return before.context;
}

/* ---------------------------------------------------------- invariants */

test("write-time advice never blocks or denies: on every host's writing tool it exits 0 and adds context, never a decision", async () => {
  const root = await warmed();
  try {
    const inputs: [string, Record<string, unknown> | string][] = [
      ["Write", { file_path: join(root, "src/a/one.ts"), content: COPY }],
      ["Edit", { file_path: join(root, "src/a/two.ts"), old_string: "", new_string: COPY }],
      ["apply_patch", { input: `*** Begin Patch\n*** Add File: src/a/three.ts\n+${COPY.trim()}\n*** End Patch` }],
      ["write_file", { path: join(root, "src/a/four.ts"), content: COPY }],
    ];
    for (const [tool, input] of inputs) {
      rmSync(join(root, ".coherence", "mirrors", "advised"), { recursive: true, force: true });
      const r = await preToolUse(root, tool, input);
      assert.equal(r.exit, 0, tool);
      assert.match(r.context, /Restatement: "\.zqjsonl" is `LINE_EXTENSION` in src\/journal\/stores\.ts:1\. Reuse it: import \{ LINE_EXTENSION \} from "\.\.\/journal\/stores\.ts"\./, tool);
      assert.doesNotMatch(r.stdout, /permissionDecision|"decision"|"block"|"deny"/, `${tool} only adds context`);
    }
    // And through a home this session wrote, folded into its overlay.
    rmSync(join(root, ".coherence", "mirrors", "advised"), { recursive: true, force: true });
    await land(root, "src/fresh/home.ts", 'export const FRESH = "zq-fresh-home-value";\n');
    const overlay = await preToolUse(root, "Write", { file_path: join(root, "src/fresh/copy.ts"), content: 'export const F = "zq-fresh-home-value";\n' });
    assert.equal(overlay.exit, 0);
    assert.match(overlay.context, /`FRESH` in src\/fresh\/home\.ts:1/);
    assert.doesNotMatch(overlay.stdout, /permissionDecision|"decision"|"block"|"deny"/, "the overlay's advice only adds context");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write-time advice is silent when no advice index is kept, or the kept one cannot be read", async () => {
  const root = await warmed();
  try {
    // A warm process has the index loaded; once the kept index is gone, it says nothing from what it loaded.
    assert.match((await preToolUse(root, "Write", { file_path: join(root, "src/a/zero.ts"), content: COPY })).context, /LINE_EXTENSION/);
    rmSync(join(root, ".coherence", "mirrors", "advised"), { recursive: true, force: true });
    rmSync(join(root, ".coherence", "mirrors", "advice.json"));
    assert.equal((await preToolUse(root, "Write", { file_path: join(root, "src/a/one.ts"), content: COPY })).context, "", "no index, no word");
    writeFileSync(join(root, ".coherence", "mirrors", "advice.json"), "{ not json");
    assert.equal((await preToolUse(root, "Write", { file_path: join(root, "src/a/two.ts"), content: COPY })).context, "", "an unreadable index says nothing");
    assert.equal(loadAdvice(root), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write-time advice says a family once a session, and nothing more once the session declined it: a second write after being told, or a differs on purpose comment", async () => {
  const root = await warmed();
  try {
    const first = await preToolUse(root, "Write", { file_path: join(root, "src/a/one.ts"), content: COPY });
    assert.match(first.context, /LINE_EXTENSION/);
    assert.equal((await preToolUse(root, "Write", { file_path: join(root, "src/a/two.ts"), content: COPY })).context, "", "told once; the second write declines it");
    assert.equal((await preToolUse(root, "Write", { file_path: join(root, "src/a/three.ts"), content: COPY })).context, "", "and nothing after a decline");
    const declined = await preToolUse(root, "Write", { file_path: join(root, "src/b/x.ts"), content: '// differs on purpose from src/journal/stores.ts:SHARD_SUFFIX: a looser read for the legacy layout\nexport const S = /\\.[0-9a-f]{8}\\.(zqjsonl|zqjsonseq)\\b/;\n' });
    assert.equal(declined.context, "", "a differs on purpose comment declines its family at once");
    assert.equal((await preToolUse(root, "Write", { file_path: join(root, "src/b/y.ts"), content: "export const T = /\\.[0-9a-f]{8}\\.(zqjsonl|zqjsonseq)\\b/;\n" })).context, "", "and the family stays quiet");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write-time advice speaks only for a named constant, a list within one member of a named list used as a set, a pattern that accepts what a named rule accepts, and a parser of a type a named function parses with the same checks, and never for a bare literal, prose, another party's value, a generated file, a test, or content that already imports the home", async () => {
  const root = await warmed();
  try {
    const say = async (file: string, content: string): Promise<string> => {
      rmSync(join(root, ".coherence", "mirrors", "advised"), { recursive: true, force: true });
      return (await preToolUse(root, "Write", { file_path: join(root, file), content })).context;
    };
    assert.match(await say("src/a/list.ts", 'export const MY = ["zqpipe", "zqignore", "zqinherit"];\n'), /this list is `STDIO` in src\/journal\/stores\.ts:3; it lacks "zqoverlapped"\. Reuse it: export it there as `STDIO` first, then import \{ STDIO \} from "\.\.\/journal\/stores\.ts"\./);
    assert.match(await say("src/a/rule.ts", 'export const isShard = (n: string): boolean => new RegExp(`^${n}\\\\.[0-9a-f]{8}\\\\.(zqjsonl|zqjsonseq)$`).test(n);\n'), /this pattern accepts what `SHARD_SUFFIX` in src\/journal\/stores\.ts:2 accepts/);
    const chain = await say("src/a/chain.ts", 'export const isLog = (n: string): boolean => n.endsWith(".zqjsonl") || n.endsWith(".zqjsonseq");\n');
    assert.match(chain, /`LINE_EXTENSION`/, "the chain's own constant is named");
    assert.doesNotMatch(chain, /SHARD_SUFFIX/, "a chain that accepts more than the rule is no copy of it");
    assert.match(await say("src/a/parse.ts", 'import type { ZqTime } from "../lifecycle/times.ts";\nexport function readZq(text: string): ZqTime[] {\n  return text.split("\\n").flatMap((l) => { const t = JSON.parse(l) as Partial<ZqTime>; return typeof t.zqat === "string" && typeof t.zqevent === "string" && typeof t.zqms === "number" ? [t as ZqTime] : []; });\n}\n'), /parses ZqTime with the same zqat, zqevent, zqms checks as `parseZqTimes` in src\/lifecycle\/times\.ts:2\. Reuse it: export it there as `parseZqTimes` first, then import \{ parseZqTimes \}/);
    assert.match(await say("src/journal/util.ts", `export const pad = (s: string): string => s.padStart(8);\n${COPY}`), /src\/journal\/stores\.ts imports src\/journal\/util\.ts, so importing back would make a cycle: move `LINE_EXTENSION` to a module both can import/, "a home whose file imports the copy's is never offered as an import");
    for (const [file, content, why] of [
      ["src/a/bare.ts", 'export const x = (): string => "zq-no-named-home";\n', "a bare literal with no named home"],
      ["src/a/prose.ts", 'export const m = "the .zqjsonl shard went missing";\n', "prose that holds a word of a home"],
      ["src/a/http.ts", 'export const h = "WWW-Authenticate";\n', "another party's value"],
      ["src/a/client.gen.ts", COPY, "a generated file"],
      ["src/a/one.test.ts", COPY, "a test"],
      ["src/a/imports.ts", `import { LINE_EXTENSION } from "../journal/stores.ts";\n${COPY}`, "content that already imports the home"],
    ] as const) assert.equal(await say(file, content), "", why);

    // A shell command's writes are looked up after it, by the same classes.
    rmSync(join(root, ".coherence", "mirrors", "advised"), { recursive: true, force: true });
    mkdirSync(join(root, "src", "c"), { recursive: true });
    writeFileSync(join(root, "src", "c", "shell.ts"), COPY);
    const after = await runHook("PostToolUse", { session_id: SESSION, cwd: root, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "python3 write.py" }, tool_response: {} }, root, { refresh: async () => {}, mirrors: () => {} });
    assert.match(after.stdout, /LINE_EXTENSION/, "a file a shell command wrote is looked up after it");

    // A file a writing tool wrote is not the shell's: an edit that copies nothing leaves the file's older copy unsaid, at the edit and after the next command.
    rmSync(join(root, ".coherence", "mirrors", "advised"), { recursive: true, force: true });
    rmSync(join(root, "src", "c", "shell.ts"));
    const old = join(root, "src", "c", "old.ts");
    writeFileSync(old, COPY);
    const edit = { file_path: old, old_string: COPY, new_string: `${COPY}export const z = 1;\n` };
    assert.equal((await preToolUse(root, "Edit", { ...edit, new_string: "export const z = 1;\n" })).context, "", "the edit copies nothing");
    writeFileSync(old, `${COPY}export const z = 1;\n`);
    (await runHook("PostToolUse", { session_id: SESSION, cwd: root, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: edit, tool_response: {} }, root, { refresh: async () => {}, mirrors: () => {} })).commit?.();
    const next = await runHook("PostToolUse", { session_id: SESSION, cwd: root, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: {} }, root, { refresh: async () => {}, mirrors: () => {} });
    assert.doesNotMatch(next.stdout, /Restatement/, "the command changed nothing, so the tool's file is not looked at again");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a home this session wrote is advised against later in the session: what a write defines is folded into the session's overlay, by the same strict classes, once a family, and never without a kept index", async () => {
  const root = await warmed();
  try {
    // The kept index knows nothing of these: they are written in this session.
    assert.equal(await land(root, "src/journal/shards.ts", 'export const SHARD = /\\.[0-9a-f]{8}\\.(zqlogl|zqlogseq)$/;\nexport const EVENTS = ["ZqStart", "ZqPre", "ZqTool", "ZqStop"] as const;\nexport const NOTE = "a message, not a home";\n'), "", "the home itself is told nothing");
    const rule = await land(root, "src/lifecycle/status.ts", 'export const isShard = (s: string, n: string): boolean => new RegExp(`^${s}\\\\.[0-9a-f]{8}\\\\.(zqlogl|zqlogseq)$`).test(n);\n');
    assert.match(rule, /accepts what `SHARD` in src\/journal\/shards\.ts:1 accepts/, "a rule this session wrote is a home for its later copies");
    const list = await land(root, "src/lifecycle/install.ts", 'const FLAT: ReadonlySet<string> = new Set(["ZqStart", "ZqPre", "ZqStop"]);\nexport const flat = (e: string): boolean => FLAT.has(e);\n');
    assert.match(list, /this list is `EVENTS` in src\/journal\/shards\.ts:2; it lacks "ZqTool"/, "and so is a list");
    assert.equal(await land(root, "src/lifecycle/again.ts", 'export const isShard2 = (n: string): boolean => /\\.[0-9a-f]{8}\\.(zqlogl|zqlogseq)$/.test(n);\n'), "", "a family told once is declined by its next copy");
    assert.equal(await land(root, "src/lifecycle/note.ts", 'export const m = "a message, not a home";\n'), "", "prose defines no home");

    // With no kept index, the overlay alone never speaks.
    rmSync(join(root, ".coherence", "mirrors", "advice.json"));
    rmSync(join(root, ".coherence", "mirrors", "advised"), { recursive: true, force: true });
    assert.equal(await land(root, "src/other/home.ts", 'export const OTHER = "zq-other-home-value";\n'), "");
    assert.equal(await land(root, "src/other/copy.ts", 'export const O = "zq-other-home-value";\n'), "", "cold: nothing folded, nothing said");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write-time advice looks a write up within the hook latency budget: a few milliseconds against an index of thousands of homes", (t) => {
  // Lookups are by map and by a shared word, so their time does not grow with the index: the same write against an index a hundred times larger costs about the same.
  const indexOf = (n: number): AdviceIndex => ({
    version: 1, commit: "0".repeat(40), at: "2026-11-25T00:00:00Z", importExtension: true, testFolders: ["test", "tests", "__tests__"], quiet: [],
    constants: Array.from({ length: n }, (_, i) => ({ value: `zq-constant-${i}`, name: `C${i}`, file: `src/c${i % 50}.ts`, line: 1, exported: true, copies: [] })),
    lists: Array.from({ length: Math.floor(n / 2.5) }, (_, i) => ({ members: [`zqa${i}`, `zqb${i}`, `zqc${i}`, `zqd${i}`], name: `L${i}`, file: `src/l${i % 50}.ts`, line: 1, exported: true, copies: [] })),
    rules: Array.from({ length: 500 }, (_, i) => ({ site: { file: `src/r${i}.ts`, line: 1, form: "regex" as const, text: `\\.zqr${i}$`, flags: "" }, atoms: [`zqr${i}`], name: `R${i}`, file: `src/r${i}.ts`, line: 1, exported: true, copies: [] })),
    parsers: [],
  });
  const text = Array.from({ length: 400 }, (_, i) => `export const v${i} = ["zqa${i}", "zqb${i}", "zqc${i}"]; const s${i} = "zq-constant-${i}"; const r${i} = /\\.zqr${i % 500}$/;`).join("\n");
  const timed = (n: number): { p50: number; p95: number } => {
    const root = mkdtempSync(join(tmpdir(), "coherence-advice-big-"));
    try {
      recordAdviceIndex(root, indexOf(n));
      const loaded = loadAdvice(root)!;
      const times: number[] = [];
      for (let k = 0; k < 15; k++) {
        const t0 = performance.now();
        adviceFor(loaded, "src/new.ts", text);
        times.push(performance.now() - t0);
      }
      times.sort((x, y) => x - y);
      return { p50: times[7]!, p95: times[14]! };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const small = timed(500);
  const large = timed(50_000);
  assert.ok(large.p50 < 4 * small.p50 + 5, `a 100 times larger index costs ${(large.p50 / small.p50).toFixed(1)} times as much (${small.p50.toFixed(1)} ms, ${large.p50.toFixed(1)} ms)`);
  assert.ok(large.p95 < 250, `p95 ${large.p95.toFixed(1)} ms for a 400-line write against 70,500 homes`);

  // The overlay path: a session that wrote a thousand homes still looks a write up inside the budget.
  const root = mkdtempSync(join(tmpdir(), "coherence-advice-overlay-"));
  try {
    recordAdviceIndex(root, indexOf(500));
    const files = Array.from({ length: 50 }, (_, f) => ({ file: `src/written${f}.ts`, text: Array.from({ length: 20 }, (_, k) => `export const W${f}_${k} = "zq-written-${f}-${k}";`).join("\n") }));
    foldWrites(root, "overlay-session", files);
    // Each hook call reads the overlay and folds it in afresh, then looks the edit up: that whole path is what is timed.
    const times: number[] = [];
    let found: ReturnType<typeof adviceFor> = [];
    for (let k = 0; k < 15; k++) {
      const t0 = performance.now();
      const merged = withOverlay(root, "overlay-session", loadAdvice(root)!);
      found = adviceFor(merged, "src/new.ts", 'export const x = "zq-written-7-3";\n');
      times.push(performance.now() - t0);
      assert.equal(merged.index.constants.length, 1500, "the thousand homes are folded in");
    }
    times.sort((x, y) => x - y);
    t.diagnostic(`lookup p50 ${small.p50.toFixed(1)} / ${large.p50.toFixed(1)} ms (700 / 70,500 homes); with an overlay of 1,000 homes p50 ${times[7]!.toFixed(1)} ms, p95 ${times[14]!.toFixed(1)} ms`);
    assert.ok(times[14]! < 50, `an ordinary edit stays a few milliseconds with the overlay (p95 ${times[14]!.toFixed(1)} ms)`);
    assert.match(found[0]?.text ?? "", /`W7_3` in src\/written7\.ts:4/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the stop sweep names each fact the session wrote more than once, in one line, from the session's own advice state alone, never waiting", async () => {
  const root = await warmed();
  try {
    await preToolUse(root, "Write", { file_path: join(root, "src/a/one.ts"), content: COPY });
    await preToolUse(root, "Write", { file_path: join(root, "src/a/two.ts"), content: COPY });
    rmSync(join(root, ".coherence", "mirrors", "advice.json"));
    const t0 = performance.now();
    const line = adviceStopText(root, SESSION);
    assert.ok(performance.now() - t0 < 20, "a read of one small file");
    assert.equal(typeof line, "string", "synchronous: nothing is awaited");
    assert.match(line, /^Restatements: this session wrote a fact more than once: LINE_EXTENSION \(src\/journal\/stores\.ts, written 2 times\)\./);
    assert.equal(line.split("\n").length, 1, "one line");
    assert.equal(adviceStopText(root, "another-session"), "", "a session that copied nothing hears nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a write that binds the home's own name is said at the stop, and only when the home still binds it: a move is told nothing", async () => {
  for (const moved of [false, true]) {
    const root = await warmed();
    try {
      const again = 'export const LINE_EXTENSION = ".zqjsonl";\n';
      assert.equal(await land(root, "src/b/lines.ts", again), "", "the write alone cannot tell a move from a copy, so it is told nothing");
      if (moved) writeFileSync(join(root, "src/journal/stores.ts"), 'export { LINE_EXTENSION } from "../b/lines.ts";\n');
      const line = adviceStopText(root, SESSION);
      if (moved) assert.equal(line, "", "the home moved: nothing to say");
      else assert.match(line, /^Restatements: LINE_EXTENSION is defined in both src\/journal\/stores\.ts and src\/b\/lines\.ts\. Give each one home/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
