import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `Memory of N concurrent sessions: each in its own git worktree of a real project, driven through one Coherence
checkout's hooks as a host runs them, all at once. Each session starts, takes a prompt, reads a file, edits a file no
chokepoint governs and stops; then takes a prompt, edits the chokepoint file and stops. After each stop the runner waits
--settle seconds. Every process the sessions start carries a mark in its environment; the runner samples them every
500 ms (resident plus swapped memory, from /proc) and counts the language servers among them. Run it once against
main's checkout and once against the branch's, on the same project and N, and compare the two tables.

usage: node bench/memory/run.ts --cli <checkout>/src/cli.ts --project <git repo> --chokepoint-file <path in it>
                                [--sessions 2] [--settle 45] [--json <file>]
Linux only (reads /proc).`;

const { values } = parseArgs({
  options: {
    cli: { type: "string" },
    project: { type: "string" },
    "chokepoint-file": { type: "string" },
    sessions: { type: "string", default: "2" },
    settle: { type: "string", default: "45" },
    json: { type: "string" },
  },
});
if (values.cli === undefined || values.project === undefined || values["chokepoint-file"] === undefined || process.platform !== "linux") {
  process.stderr.write(`${USAGE}\n`);
  process.exit(64);
}
const cli = resolve(values.cli);
const project = resolve(values.project);
const chokepointFile = values["chokepoint-file"];
const sessionCount = Number(values.sessions);
const settleMs = Number(values.settle) * 1000;
const STEADY_WINDOW_MS = 10_000;
const LANGUAGE_SERVER = /tsserver\.js|typescript-language-server|\/lib\/tsc(\.exe)?\s.*--lsp|pyright-langserver|langserver\.index\.js/;

const benchId = `memory-${process.pid}-${Date.now().toString(36)}`;
const MARK = `COHERENCE_MEMORY_BENCH=${benchId}`;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "coherence-memory-")));

interface Sample {
  at: number;
  memoryMB: number;
  languageServerMB: number;
  languageServers: number;
}

interface HookTiming {
  session: number;
  label: string;
  event: string;
  ms: number;
  exit: number | null;
}

interface Phase {
  name: string;
  peakMB: number;
  steadyMB: number;
  steadyLanguageServerMB: number;
  peakLanguageServers: number;
  steadyLanguageServers: number;
}

function markedProcesses(): number[] {
  return readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number)
    .filter((pid) => {
      if (pid === process.pid) return false;
      try {
        return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(MARK);
      } catch {
        return false;
      }
    });
}

function memoryOf(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const resident = Number(/VmRSS:\s+(\d+) kB/.exec(status)?.[1] ?? 0);
    const swapped = Number(/VmSwap:\s+(\d+) kB/.exec(status)?.[1] ?? 0);
    return resident + swapped;
  } catch {
    return 0;
  }
}

function isLanguageServer(pid: number): boolean {
  try {
    return LANGUAGE_SERVER.test(readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" "));
  } catch {
    return false;
  }
}

function sample(): Sample {
  const pids = markedProcesses();
  const languageServerPids = pids.filter(isLanguageServer);
  const megabytesOf = (members: readonly number[]): number => Math.round(members.reduce((sum, pid) => sum + memoryOf(pid), 0) / 1024);
  return { at: Date.now(), memoryMB: megabytesOf(pids), languageServerMB: megabytesOf(languageServerPids), languageServers: languageServerPids.length };
}

function addWorktree(index: number): string {
  const path = join(scratch, `session-${index}`);
  execFileSync("git", ["-C", project, "worktree", "add", "--detach", path, "HEAD"], { stdio: "ignore" });
  const modules = join(project, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(path, "node_modules"));
  return path;
}

function runHook(root: string, session: string, event: string, input: Record<string, unknown>): Promise<{ ms: number; exit: number | null }> {
  const env: Record<string, string | undefined> = { ...process.env, COHERENCE_MEMORY_BENCH: benchId, CLAUDE_PROJECT_DIR: root };
  delete env["COHERENCE_NO_WARM_UP"];
  delete env["NODE_TEST_CONTEXT"];
  const started = performance.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "hook", event], { cwd: root, env, stdio: ["pipe", "ignore", "ignore"] });
    child.on("close", (exit) => done({ ms: Math.round(performance.now() - started), exit }));
    child.stdin.end(JSON.stringify({ session_id: session, cwd: root, transcript_path: join(root, ".bench-transcript.jsonl"), hook_event_name: event, ...input }));
  });
}

function appendLine(path: string): () => void {
  return () => appendFileSync(path, "\n");
}

async function drive(index: number, root: string, steps: readonly { label: string; event: string; input: Record<string, unknown>; act?: () => void }[], timings: HookTiming[]): Promise<void> {
  const session = `${benchId}-${index}`;
  for (const step of steps) {
    step.act?.();
    const { ms, exit } = await runHook(root, session, step.event, step.input);
    timings.push({ session: index, label: step.label, event: step.event, ms, exit });
  }
}

function tool(label: string, name: string, input: Record<string, unknown>, act?: () => void): { label: string; event: string; input: Record<string, unknown>; act?: () => void }[] {
  return [
    { label: `${label} (PreToolUse)`, event: "PreToolUse", input: { tool_name: name, tool_input: input } },
    { label: `${label} (PostToolUse)`, event: "PostToolUse", input: { tool_name: name, tool_input: input, tool_response: { success: true } }, ...(act === undefined ? {} : { act }) },
  ];
}

function firstTurn(root: string): { label: string; event: string; input: Record<string, unknown>; act?: () => void }[] {
  const notes = join(root, "BENCH-NOTES.md");
  return [
    { label: "SessionStart", event: "SessionStart", input: { source: "startup" } },
    { label: "UserPromptSubmit", event: "UserPromptSubmit", input: { prompt: "Write down what this project does." } },
    ...tool("read", "Read", { file_path: join(root, chokepointFile) }),
    ...tool("edit notes", "Write", { file_path: notes, content: "notes\n" }, () => writeFileSync(notes, "notes\n")),
    { label: "Stop", event: "Stop", input: { stop_hook_active: false } },
  ];
}

function secondTurn(root: string): { label: string; event: string; input: Record<string, unknown>; act?: () => void }[] {
  const target = join(root, chokepointFile);
  return [
    { label: "UserPromptSubmit (second)", event: "UserPromptSubmit", input: { prompt: "Tidy the chokepoint's module." } },
    ...tool("edit chokepoint file", "Edit", { file_path: target, old_string: "", new_string: "\n" }, appendLine(target)),
    { label: "Stop (second)", event: "Stop", input: { stop_hook_active: false } },
  ];
}

function summarize(name: string, samples: readonly Sample[], settledFrom: number): Phase {
  const steady = samples.filter((s) => s.at >= settledFrom);
  const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length));
  return {
    name,
    peakMB: Math.max(0, ...samples.map((s) => s.memoryMB)),
    steadyMB: mean(steady.map((s) => s.memoryMB)),
    steadyLanguageServerMB: mean(steady.map((s) => s.languageServerMB)),
    peakLanguageServers: Math.max(0, ...samples.map((s) => s.languageServers)),
    steadyLanguageServers: Math.max(0, ...steady.map((s) => s.languageServers)),
  };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

async function stopEverything(): Promise<void> {
  for (const pid of markedProcesses()) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      continue;
    }
  }
  const deadline = Date.now() + 10_000;
  while (markedProcesses().length > 0 && Date.now() < deadline) await new Promise((wake) => setTimeout(wake, 200));
  for (const pid of markedProcesses()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      continue;
    }
  }
}

const samples: Sample[] = [];
const timings: HookTiming[] = [];
const roots = Array.from({ length: sessionCount }, (_, index) => addWorktree(index));
const sampler = setInterval(() => samples.push(sample()), 500);
const phases: Phase[] = [];
try {
  const firstStarted = Date.now();
  await Promise.all(roots.map((root, index) => drive(index, root, firstTurn(root), timings)));
  await new Promise((wake) => setTimeout(wake, settleMs));
  phases.push(summarize("first turn: no chokepoint edit", samples.filter((s) => s.at >= firstStarted), Date.now() - STEADY_WINDOW_MS));
  const secondStarted = Date.now();
  await Promise.all(roots.map((root, index) => drive(index, root, secondTurn(root), timings)));
  await new Promise((wake) => setTimeout(wake, settleMs));
  phases.push(summarize("second turn: a chokepoint edit", samples.filter((s) => s.at >= secondStarted), Date.now() - STEADY_WINDOW_MS));
} finally {
  clearInterval(sampler);
  await stopEverything();
  rmSync(scratch, { recursive: true, force: true });
  execFileSync("git", ["-C", project, "worktree", "prune"], { stdio: "ignore" });
}

const events = [...new Set(timings.map((t) => t.label))];
const latencyRows = events.map((label) => {
  const ms = timings.filter((t) => t.label === label).map((t) => t.ms);
  return `| ${label} | ${percentile(ms, 0.5)} | ${percentile(ms, 0.95)} | ${Math.max(...ms)} |`;
});
const failed = timings.filter((t) => t.exit !== 0 && t.exit !== 2);
const report = [
  `## Memory: ${sessionCount} concurrent sessions on ${project}, Coherence at ${cli}`,
  "",
  "| phase | peak MB | steady MB | steady MB in language servers | peak language servers | steady language servers |",
  "|---|---:|---:|---:|---:|---:|",
  ...phases.map((p) => `| ${p.name} | ${p.peakMB} | ${p.steadyMB} | ${p.steadyLanguageServerMB} | ${p.peakLanguageServers} | ${p.steadyLanguageServers} |`),
  "",
  "| hook | p50 ms | p95 ms | max ms |",
  "|---|---:|---:|---:|",
  ...latencyRows,
  "",
  failed.length === 0 ? "Every hook exited 0 or 2." : `${failed.length} hook(s) exited otherwise: ${failed.map((t) => `${t.label} in session ${t.session} (${t.exit})`).join(", ")}`,
  "",
].join("\n");
process.stdout.write(report);
if (values.json !== undefined) writeFileSync(values.json, `${JSON.stringify({ cli, project, sessions: sessionCount, phases, timings, samples }, null, 2)}\n`);
