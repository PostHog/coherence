import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `Replays write-time advice against history: each copy at its birth, and a seeded sample of the other writes
the transcripts hold, each through the real hook entry point (cli.ts hook PreToolUse, or PostToolUse after a
shell write) in a scratch worktree at the commit before it, with the advice index kept as a session's refresh
keeps it. Prints one JSON line per write: what fired, whether it named the home the later fix used, and the
hook's wall time.

usage: node bench/advice-replay/run.ts --cli <checkout>/src/cli.ts --repo <git repo> --cases <cases.json>
                                       [--transcripts <folder>] [--sample 120] [--seed 194] [--out <file>]

cases.json is a list of { name, file, birth, copy, home?, name_?: the home's name the fix used, shell?: true }:
the birth commit wrote copy (a line it added to file). With --transcripts, the Edit or Write whose path ends
with file and whose text holds copy is replayed as written; otherwise the birth's added lines around copy.`;

const { values } = parseArgs({
  options: {
    cli: { type: "string" },
    repo: { type: "string" },
    cases: { type: "string" },
    transcripts: { type: "string" },
    sample: { type: "string", default: "0" },
    seed: { type: "string", default: "194" },
    out: { type: "string" },
  },
});
if (values.cli === undefined || values.repo === undefined || values.cases === undefined) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(64);
}
const cli = resolve(values.cli);
const repo = resolve(values.repo);
const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30 });
const env = { ...process.env, COHERENCE_TELEMETRY: "0", COHERENCE_NO_UPDATE_CHECK: "1", COHERENCE_NO_WARM_UP: "1" };
delete env["NODE_TEST_CONTEXT"];

interface Case {
  name: string;
  file: string;
  birth: string;
  copy: string;
  home?: string;
  homeName?: string;
  shell?: boolean;
  /** The home was born in the same commit: replay that commit's writes in order, each landed and followed by the hook after it, so the session's overlay knows the home by the time the copy is written. */
  sequence?: boolean;
}

/* --------------------------------------------------------- transcripts */

interface Written {
  tool: string;
  path: string;
  input: Record<string, unknown>;
  at: string;
  /** The transcript the write came from, and its place there: one session's writes, in the order it made them. */
  transcript: string;
  order: number;
}

function transcriptWrites(folder: string): Written[] {
  const out: Written[] = [];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".jsonl")) files.push(path);
    }
  };
  walk(folder);
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.includes('"tool_use"') || !/"name":"(?:Edit|Write|MultiEdit)"/.test(line)) continue;
      try {
        const record = JSON.parse(line) as { timestamp?: string; message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] } };
        for (const c of record.message?.content ?? []) {
          if (c.type !== "tool_use" || !["Edit", "Write", "MultiEdit"].includes(c.name ?? "") || typeof c.input?.["file_path"] !== "string") continue;
          out.push({ tool: c.name!, path: c.input["file_path"] as string, input: c.input, at: record.timestamp ?? "", transcript: file, order: out.length });
        }
      } catch {
        continue;
      }
    }
  }
  return out;
}

const textOf = (w: Written): string => [w.input["content"], w.input["new_string"], ...(Array.isArray(w.input["edits"]) ? (w.input["edits"] as Record<string, unknown>[]).map((e) => e["new_string"]) : [])].filter((t): t is string => typeof t === "string").join("\n");

/** The project-relative path a transcript's absolute path names, in this repository or any of its worktrees. */
function relativeOf(path: string): string | undefined {
  const m = /\/((?:src|plugins|bench|mods|grammars|docs|\.github)\/.+)$/.exec(path);
  return m?.[1];
}

/* ------------------------------------------------------------- worktrees */

const trees = new Map<string, string>();
function treeAt(commit: string): string {
  const kept = trees.get(commit);
  if (kept !== undefined) return kept;
  const dir = join(mkdtempSync(join(tmpdir(), "advice-replay-")), "tree");
  git(repo, "worktree", "add", "--detach", "--quiet", dir, commit);
  if (existsSync(join(repo, "node_modules"))) symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
  // The advice index as a session's start keeps it: the detached refresh, run here to its end.
  spawnSync("node", ["--disable-warning=ExperimentalWarning", cli, "query", "mirrors", "--refresh"], { cwd: dir, env, encoding: "utf8" });
  trees.set(commit, dir);
  return dir;
}

function dropTrees(): void {
  for (const dir of trees.values()) {
    try {
      git(repo, "worktree", "remove", "--force", dir);
    } catch {
      // pruned later
    }
    rmSync(resolve(dir, ".."), { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- replay */

let sessions = 0;
function hook(tree: string, name: string, event: Record<string, unknown>): { context: string; ms: number; exit: number } {
  const t0 = performance.now();
  const r = spawnSync("node", ["--disable-warning=ExperimentalWarning", cli, "hook", name], { cwd: tree, env, input: JSON.stringify(event), encoding: "utf8" });
  const ms = Math.round(performance.now() - t0);
  let context = "";
  try {
    context = (JSON.parse(r.stdout || "{}") as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "";
  } catch {
    context = "";
  }
  return { context: context.split("\n").filter((l) => l.startsWith("Restatement:")).join("\n"), ms, exit: r.status ?? -1 };
}

/** One write as a session makes it: the hook before, the write landed, the hook after, which folds what it defines into the session's overlay. A write through a shell is landed first and looked at by the hook after it. */
function landWrite(tree: string, session: string, tool: string, input: Record<string, unknown>, shell: boolean): { context: string; ms: number; exit: number } {
  const path = String(input["file_path"]);
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const edits = tool === "Write" ? [] : Array.isArray(input["edits"]) ? (input["edits"] as Record<string, unknown>[]) : [input];
  const next = tool === "Write" ? String(input["content"] ?? "") : edits.reduce((t, e) => (typeof e["old_string"] === "string" && e["old_string"] !== "" && t.includes(e["old_string"]) ? t.replace(e["old_string"], String(e["new_string"] ?? "")) : t), current);
  const land = (): void => {
    execFileSync("mkdir", ["-p", resolve(path, "..")]);
    writeFileSync(path, next);
  };
  if (shell) {
    land();
    return hook(tree, "PostToolUse", { session_id: session, cwd: tree, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "python3 write.py" }, tool_response: {} });
  }
  const before = hook(tree, "PreToolUse", { session_id: session, cwd: tree, hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });
  land();
  hook(tree, "PostToolUse", { session_id: session, cwd: tree, hook_event_name: "PostToolUse", tool_name: tool, tool_input: input, tool_response: {} });
  return before;
}

/**
 * The session's writes up to the copy, in order, as one session. From the
 * transcript where the copy's write is found: every code write that
 * transcript made in the two days before it. Otherwise from the commit's
 * diff: each code file's new text written whole, in the order git lists
 * the files.
 */
function replaySequence(tree: string, c: Case, match: Written | undefined): { source: string; copy: { context: string; ms: number; exit: number }; others: { file: string; context: string }[] } {
  const session = `replay-${process.pid}-${sessions++}`;
  const others: { file: string; context: string }[] = [];
  let copy = { context: "", ms: 0, exit: 0 };
  let source: string;
  if (match !== undefined) {
    source = "transcript, the session's writes in order";
    const from = Date.parse(match.at) - 2 * 86_400_000;
    const steps = writes.filter((w) => w.transcript === match.transcript && w.order <= match.order && Date.parse(w.at) >= from && relativeOf(w.path) !== undefined && /\.[cm]?[jt]sx?$/.test(w.path));
    for (const w of steps) {
      const file = relativeOf(w.path)!;
      const input = { ...w.input, file_path: join(tree, file) };
      const r = landWrite(tree, session, w.tool, input, w === match && c.shell === true);
      if (w === match) copy = r;
      else if (r.context !== "") others.push({ file, context: r.context });
    }
  } else {
    source = "diff, the commit's files in the order git lists them";
    const files = git(repo, "show", "--name-status", "--format=", c.birth).split("\n").filter((l) => /^[AM]\t/.test(l)).map((l) => l.slice(2)).filter((f) => /\.[cm]?[jt]sx?$/.test(f));
    for (const file of files) {
      const r = landWrite(tree, session, "Write", { file_path: join(tree, file), content: git(repo, "show", `${c.birth}:${file}`) }, file === c.file && c.shell === true);
      if (file === c.file) copy = r;
      else if (r.context !== "") others.push({ file, context: r.context });
    }
  }
  if (c.shell === true) source += ", the copy through the shell re-check";
  git(tree, "checkout", "--quiet", "--", ".");
  git(tree, "clean", "-fdq", "--", "src", "plugins");
  return { source, copy, others };
}

function replay(tree: string, tool: string, input: Record<string, unknown>, shellFile?: { file: string; text: string }): { context: string; ms: number; exit: number } {
  const session = `replay-${process.pid}-${sessions++}`;
  let event: Record<string, unknown>;
  let name = "PreToolUse";
  if (shellFile !== undefined) {
    writeFileSync(join(tree, shellFile.file), shellFile.text);
    name = "PostToolUse";
    event = { session_id: session, cwd: tree, hook_event_name: name, tool_name: "Bash", tool_input: { command: "python3 write.py" }, tool_response: {} };
  } else event = { session_id: session, cwd: tree, hook_event_name: name, tool_name: tool, tool_input: input };
  const t0 = performance.now();
  const r = spawnSync("node", ["--disable-warning=ExperimentalWarning", cli, "hook", name], { cwd: tree, env, input: JSON.stringify(event), encoding: "utf8" });
  const ms = Math.round(performance.now() - t0);
  if (shellFile !== undefined) git(tree, "checkout", "--quiet", "--", ".");
  let context = "";
  try {
    context = (JSON.parse(r.stdout || "{}") as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "";
  } catch {
    context = "";
  }
  const advice = context.split("\n").filter((l) => l.startsWith("Restatement:")).join("\n");
  return { context: advice, ms, exit: r.status ?? -1 };
}

const results: Record<string, unknown>[] = [];
const say = (row: Record<string, unknown>): void => {
  results.push(row);
  process.stdout.write(`${JSON.stringify(row)}\n`);
};

const cases = JSON.parse(readFileSync(values.cases, "utf8")) as Case[];
const writes = values.transcripts === undefined ? [] : transcriptWrites(values.transcripts);

for (const c of cases) {
  const parent = git(repo, "rev-parse", `${c.birth}^`).trim();
  const tree = treeAt(parent);
  // The write that made the copy: one of this file, holding it, made within two days before the birth commit.
  const born = Date.parse(git(repo, "show", "-s", "--format=%cI", c.birth).trim());
  const match = writes.find((w) => relativeOf(w.path) === c.file && textOf(w).includes(c.copy.trim()) && Date.parse(w.at) <= born + 3_600_000 && Date.parse(w.at) >= born - 2 * 86_400_000);
  if (c.sequence === true) {
    const { source, copy, others } = replaySequence(tree, c, match);
    const homeMatched = c.home === undefined ? undefined : copy.context.includes(c.home) && (c.homeName === undefined || copy.context.includes(c.homeName));
    say({ kind: "case", name: c.name, source, fired: copy.context !== "", homeMatched, ms: copy.ms, exit: copy.exit, message: copy.context, alongside: others });
    continue;
  }
  let source: string;
  let input: Record<string, unknown>;
  if (match !== undefined) {
    source = `transcript ${match.tool}`;
    input = { ...match.input, file_path: join(tree, c.file) };
  } else {
    source = "diff";
    const added = git(repo, "show", "--unified=3", "--format=", c.birth, "--", c.file).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
    const at = added.findIndex((l) => l.includes(c.copy.trim()));
    const text = (at < 0 ? [c.copy] : added.slice(Math.max(0, at - 6), at + 7)).join("\n");
    input = existsSync(join(tree, c.file)) ? { file_path: join(tree, c.file), old_string: "", new_string: text } : { file_path: join(tree, c.file), content: text };
  }
  const tool = match?.tool ?? ("content" in input ? "Write" : "Edit");
  const shell = c.shell === true ? { file: c.file, text: `${existsSync(join(tree, c.file)) ? readFileSync(join(tree, c.file), "utf8") : ""}\n${String(input["new_string"] ?? input["content"] ?? "")}\n` } : undefined;
  const r = replay(tree, tool, input, shell);
  const homeMatched = c.home === undefined ? undefined : r.context.includes(c.home) && (c.homeName === undefined || r.context.includes(c.homeName));
  say({ kind: "case", name: c.name, source: shell === undefined ? source : `${source}, through the shell re-check`, fired: r.context !== "", homeMatched, ms: r.ms, exit: r.exit, message: r.context });
}

// The other writes: a seeded sample, each at the main commit of its own time.
const sample = Number(values.sample);
if (sample > 0) {
  const others = writes.filter((w) => /\.[cm]?[jt]sx?$/.test(w.path) && relativeOf(w.path) !== undefined && w.at !== "" && textOf(w).length > 0);
  let x = Number(values.seed) >>> 0;
  const next = (): number => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) % 2147483647) / 2147483647;
  const picked = [...others].sort((a, b) => a.at.localeCompare(b.at)).map((w) => [next(), w] as const).sort((a, b) => a[0] - b[0]).slice(0, sample).map(([, w]) => w);
  for (const w of picked) {
    const base = git(repo, "rev-list", "-1", `--before=${w.at}`, "origin/main").trim();
    if (base === "") continue;
    const tree = treeAt(base);
    const rel = relativeOf(w.path)!;
    const r = replay(tree, w.tool, { ...w.input, file_path: join(tree, rel) });
    say({ kind: "other", at: w.at, base: base.slice(0, 8), file: rel, tool: w.tool, fired: r.context !== "", ms: r.ms, exit: r.exit, message: r.context });
  }
}
dropTrees();
if (values.out !== undefined) writeFileSync(values.out, JSON.stringify(results, null, 1));
