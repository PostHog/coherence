import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runHook } from "../../lifecycle/hook.ts";
import { adviceFor, adviceStopText, loadAdvice, recordAdviceIndex, type AdviceIndex } from "./advice.ts";
import { mirrorsCommand } from "./cli.ts";

/* ------------------------------------------------------------ fixtures */

const HOMES: Record<string, string> = {
  "coherence.config.json": JSON.stringify({ name: "zqadvice" }),
  "src/journal/stores.ts": 'export const LINE_EXTENSION = ".zqjsonl";\nexport const SHARD_SUFFIX = /\\.[0-9a-f]{8}\\.(zqjsonl|zqjsonseq)\\b/;\nconst STDIO = ["zqpipe", "zqignore", "zqinherit", "zqoverlapped"];\nexport const quiet = (s: string): boolean => STDIO.includes(s);\n',
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write-time advice is silent when no advice index is kept, or the kept one cannot be read", async () => {
  const root = await warmed();
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write-time advice looks a write up within the hook latency budget: a few milliseconds against an index of thousands of homes", () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-advice-big-"));
  try {
    const index: AdviceIndex = {
      version: 1, commit: "0".repeat(40), at: "2026-11-25T00:00:00Z", importExtension: true, testFolders: ["test", "tests", "__tests__"], quiet: [],
      constants: Array.from({ length: 5000 }, (_, i) => ({ value: `zq-constant-${i}`, name: `C${i}`, file: `src/c${i % 50}.ts`, line: 1, exported: true, copies: [] })),
      lists: Array.from({ length: 2000 }, (_, i) => ({ members: [`zqa${i}`, `zqb${i}`, `zqc${i}`, `zqd${i}`], name: `L${i}`, file: `src/l${i % 50}.ts`, line: 1, exported: true, copies: [] })),
      rules: Array.from({ length: 500 }, (_, i) => ({ site: { file: `src/r${i}.ts`, line: 1, form: "regex" as const, text: `\\.zqr${i}$`, flags: "" }, atoms: [`zqr${i}`], name: `R${i}`, file: `src/r${i}.ts`, line: 1, exported: true, copies: [] })),
      parsers: [],
    };
    recordAdviceIndex(root, index);
    const loaded = loadAdvice(root)!;
    const text = Array.from({ length: 400 }, (_, i) => `export const v${i} = ["zqa${i}", "zqb${i}", "zqc${i}"]; const s${i} = "zq-constant-${i}"; const r${i} = /\\.zqr${i % 500}$/;`).join("\n");
    const times: number[] = [];
    for (let k = 0; k < 30; k++) {
      const t0 = performance.now();
      adviceFor(loaded, "src/new.ts", text);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    assert.ok(p95 < 250, `p95 ${p95.toFixed(1)} ms for a 400-line write against 7,500 homes`);
    const small = 'export const S = "zq-constant-7";\n';
    const t0 = performance.now();
    adviceFor(loaded, "src/new.ts", small);
    assert.ok(performance.now() - t0 < 20, "an ordinary edit is a few milliseconds");
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
