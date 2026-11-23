/**
 * The warm hook process against the per-event hook, interleaved: each round
 * runs one session of the same events through `coherence hook <event>` (a
 * process per event, as a settings hook spawns it) and one through a single
 * `coherence hook-serve --socket` (as the Claude Code mod reaches it), the
 * order alternating by round. Times are wall clock at the caller, so the
 * per-event figure includes Node's start for the CLI and the socket round trip
 * for the warm process.
 *
 *   node bench/hook-serve/run.ts <project root> <rounds> <fixture|posthog|starts|compare> <out.json>
 *
 * `starts` times the per-event arm alone and prints medians and the kept reading's size; COHERENCE_BENCH_CLI names a built dist/cli.js to time.
 *
 * `compare` runs COHERENCE_BENCH_BASELINE_CLI (the previous build) and COHERENCE_BENCH_CLI (the new one) through the same session on a fresh shared clone of the project's HEAD, then prints each event's median time per build and every difference in hook stdout and kept vocabulary, with the clone's path, timestamps and times masked.
 *
 * Sessions are named spike-<arm>-<round>; the caller removes what they record.
 */

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const CLI = process.env["COHERENCE_BENCH_CLI"] ?? resolve(fileURLToPath(import.meta.url), "..", "..", "..", "src", "cli.ts");
const CHANGED_FILE = "coherence-bench-change.md";
const NODE = [process.execPath, "--disable-warning=ExperimentalWarning", CLI];

type Step = { label: string; event: string; input: Record<string, unknown>; before?: () => void };

function startSteps(root: string, session: string): Step[] {
  const base = { cwd: root, session_id: session };
  const prompt = (label: string): Step => ({ label, event: "UserPromptSubmit", input: { ...base, hook_event_name: "UserPromptSubmit", prompt: "harden auth" } });
  const stop = (label: string, before?: () => void): Step => ({ label, event: "Stop", input: { ...base, hook_event_name: "Stop", stop_hook_active: false }, ...(before ? { before } : {}) });
  const bash = { ...base, tool_name: "Bash", tool_input: { command: "git status" }, tool_use_id: `b-${session}` };
  return [
    { label: "session start", event: "SessionStart", input: { ...base, hook_event_name: "SessionStart", source: "startup" } },
    prompt("first prompt"),
    prompt("second prompt"),
    { label: "bash (pre)", event: "PreToolUse", input: { ...bash, hook_event_name: "PreToolUse" } },
    stop("stop, tree unchanged"),
    stop("stop, after a change", () => writeFileSync(join(root, CHANGED_FILE), `The bench session ${session} wrote this line.\n`)),
    prompt("prompt, after a change"),
    { label: "subagent start", event: "SubagentStart", input: { ...base, hook_event_name: "SubagentStart", agent_id: `a-${session}`, agent_type: "general-purpose" } },
  ];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function steps(root: string, kind: string, session: string): Step[] {
  const base = { cwd: root, session_id: session };
  const edit = (path: string, text: string) => ({ ...base, tool_name: "Edit", tool_input: { file_path: join(root, path), old_string: "zzz-never", new_string: text }, tool_use_id: `t-${path}-${text.length}` });
  const read = (path: string) => ({ ...base, tool_name: "Read", tool_input: { file_path: join(root, path) }, tool_use_id: `r-${path}` });
  const pair = (label: string, input: Record<string, unknown>): Step[] => [
    { label: `${label} (pre)`, event: "PreToolUse", input: { ...input, hook_event_name: "PreToolUse" } },
    { label: `${label} (post)`, event: "PostToolUse", input: { ...input, hook_event_name: "PostToolUse", tool_response: {} } },
  ];
  const [first, outside] = kind === "posthog" ? ["posthog/auth.py", "frontend/src/scenes/App.tsx"] : ["src/a.ts", "outside/b.ts"];
  const added = kind === "posthog" ? "def authenticate(self, request):" : "export const b = 2;";
  return [
    { label: "session start", event: "SessionStart", input: { ...base, hook_event_name: "SessionStart", source: "startup" } },
    { label: "prompt", event: "UserPromptSubmit", input: { ...base, hook_event_name: "UserPromptSubmit", prompt: "harden auth" } },
    ...pair("first edit", edit(first!, added)),
    ...pair("repeat edit", edit(first!, "x = 1")),
    ...pair("edit outside every leaf", edit(outside!, "const a = 1")),
    { label: "read (post)", event: "PostToolUse", input: { ...read(first!), hook_event_name: "PostToolUse", tool_response: {} } },
    { label: "stop", event: "Stop", input: { ...base, hook_event_name: "Stop", stop_hook_active: false } },
  ];
}

function env(root: string): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_PROJECT_DIR: root, COHERENCE_TELEMETRY: "0", COHERENCE_NO_UPDATE_CHECK: "1" };
}

async function viaCli(root: string, step: Step, cli = CLI): Promise<{ wall: number; exit: number | null; bytes: number; stdout: string }> {
  step.before?.();
  const began = performance.now();
  const ran = spawnSync(NODE[0]!, [NODE[1]!, cli, "hook", step.event], { cwd: root, input: JSON.stringify(step.input), encoding: "utf8", env: env(root), maxBuffer: 1 << 28 });
  return { wall: performance.now() - began, exit: ran.status, bytes: ran.stdout.length, stdout: ran.stdout };
}

function post(socket: string, body: string): Promise<string> {
  return new Promise((done, fail) => {
    const req = request({ socketPath: socket, method: "POST", path: "/hook" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", fail);
    req.end(body);
  });
}

async function warmSession(root: string, list: Step[]): Promise<{ start: number; rows: { label: string; wall: number; served: number; exit: number; bytes: number }[] }> {
  const began = performance.now();
  const child = spawn(NODE[0]!, [...NODE.slice(1), "hook-serve", "--socket"], { cwd: root, env: env(root), stdio: ["ignore", "pipe", "inherit"] });
  const first = await new Promise<string>((done) => createInterface({ input: child.stdout }).once("line", done));
  const start = performance.now() - began;
  const socket = (JSON.parse(first) as { ready: { socket: string } }).ready.socket;
  const rows = [];
  let id = 0;
  for (const step of list) {
    step.before?.();
    const t = performance.now();
    const answer = JSON.parse(await post(socket, JSON.stringify({ id: ++id, op: "hook", event: step.event, input: step.input }))) as { exit: number; ms: number; stdout: string };
    rows.push({ label: step.label, wall: performance.now() - t, served: answer.ms, exit: answer.exit, bytes: answer.stdout.length });
  }
  const exited = new Promise((done) => child.on("exit", done));
  child.kill("SIGTERM");
  await exited;
  return { start, rows };
}

function compareSteps(root: string, session: string): Step[] {
  const base = { cwd: root, session_id: session };
  const prompt = (label: string, before?: () => void): Step => ({ label, event: "UserPromptSubmit", input: { ...base, hook_event_name: "UserPromptSubmit", prompt: "harden auth" }, ...(before ? { before } : {}) });
  const tracked = spawnSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" }).stdout.split("\n").filter(Boolean).sort();
  if (tracked.length < 2) throw new Error("compare edits one tracked .md file and deletes another: the project needs at least two");
  const edited = tracked.find((path) => basename(path).toLowerCase() === "readme.md") ?? tracked[0]!;
  const deleted = tracked.filter((path) => path !== edited).at(-1)!;
  const added = "coherence-bench-added/notes.md";
  return [
    { label: "session start", event: "SessionStart", input: { ...base, hook_event_name: "SessionStart", source: "startup" } },
    prompt("prompt, tree unchanged"),
    prompt("prompt, after an edit", () => appendFileSync(join(root, edited), "\n- The Widget Crate keeps a line here for the bench.\n")),
    prompt("prompt, after an added file", () => {
      mkdirSync(join(root, dirname(added)), { recursive: true });
      writeFileSync(join(root, added), "# Widget Crate\n\nThe Widget Crate records each Widget Crate entry.\n\nA second line names the Widget Crate again, and the `Widget Crate` too.\n");
    }),
    prompt("prompt, after a deleted file", () => rmSync(join(root, deleted))),
    { label: "stop, after a change", event: "Stop", input: { ...base, hook_event_name: "Stop", stop_hook_active: false }, before: () => appendFileSync(join(root, added), "More Widget Crate prose.\n") },
  ];
}

const TIME_KEY = /(ms|Ms|At|mtime|time|Time)$/;
const MASKS: [RegExp, string][] = [
  [/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, "<time>"],
  [/\d{4}-\d\d-\d\d \d\d:\d\d UTC/g, "<time>"],
  [/\b1\d{12}(\.\d+)?\b/g, "<file time>"],
  [/vocabulary-\d+@[0-9a-f]+:[0-9a-f]+/g, "<state version>"],
  [/^\d+:\d+:(\d+):<file time>:<file time>$/g, "<device>:<inode>:$1:<file time>:<file time>"],
];

function maskedText(text: string): string {
  return MASKS.reduce((masking, [pattern, mask]) => masking.replace(pattern, mask), text);
}

function masked(text: string, clone: string, cli: string): unknown {
  const checkout = dirname(dirname(cli));
  const fromClone = (path: string): string => relative(realpathSync(clone), path);
  const spellings: [string, string][] = [cli, realpathSync(cli)].flatMap((path): [string, string][] => [[fromClone(path), "<cli>"], [path, "<cli>"]]);
  spellings.push(...[checkout, realpathSync(checkout)].flatMap((path): [string, string][] => [[fromClone(path), "<checkout>"], [path, "<checkout>"]]), [clone, "<root>"]);
  const unpathed = spellings.reduce((masking, [path, mask]) => masking.split(path).join(mask), text);
  try {
    return JSON.parse(unpathed, (key, value: unknown) => {
      if (key === "digest" && typeof value === "string") return "<digest of the compared content>";
      if (typeof value === "string") return maskedText(value);
      if (typeof value === "number" && (TIME_KEY.test(key) || /^1\d{12}/.test(String(value)))) return 0;
      return value;
    });
  } catch {
    return maskedText(unpathed);
  }
}

function firstDifference(before: unknown, after: unknown): string {
  if (typeof before !== "string" || typeof after !== "string") return `${JSON.stringify(before)?.slice(0, 120)} -> ${JSON.stringify(after)?.slice(0, 120)}`;
  let at = 0;
  while (at < before.length && before[at] === after[at]) at++;
  const from = Math.max(0, at - 40);
  return `at ${at}: ${JSON.stringify(before.slice(from, at + 80))} -> ${JSON.stringify(after.slice(from, at + 80))}`;
}

function differences(before: unknown, after: unknown, path = "", found: string[] = []): string[] {
  if (found.length >= 10) return found;
  if (typeof before !== "object" || typeof after !== "object" || before === null || after === null) {
    if (before !== after) found.push(`${path || "(whole)"}: ${firstDifference(before, after)}`);
    return found;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) differences((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], `${path}.${key}`, found);
  return found;
}

function keptOutputs(clone: string): Map<string, string> {
  const kept = new Map<string, string>();
  const vocabulary = join(clone, ".coherence", "cache", "vocabulary");
  for (const name of ["reading.json", "declared.json"]) if (existsSync(join(vocabulary, name))) kept.set(`vocabulary/${name}`, readFileSync(join(vocabulary, name), "utf8"));
  const sessions = join(clone, ".coherence", "lexicon", "sessions");
  if (existsSync(sessions)) for (const name of readdirSync(sessions).sort()) kept.set(`lexicon/sessions/${name}`, readFileSync(join(sessions, name), "utf8"));
  return kept;
}

/** The pid a refresh mark names, or undefined when the refresh already removed its mark or never finished writing one. */
function markedPid(mark: string): number | undefined {
  try {
    const { pid } = JSON.parse(readFileSync(mark, "utf8")) as { pid?: unknown };
    return typeof pid === "number" ? pid : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** Whether `pid` still runs inside `clone`: a mark outlives its refresh, and a reused pid never has the clone as its folder. */
function runsInside(pid: number, clone: string): boolean {
  try {
    return realpathSync(`/proc/${pid}/cwd`).startsWith(realpathSync(clone));
  } catch {
    return false;
  }
}

/** The detached refreshes a hook started in `clone`, each with its process group, stopped so none writes into the clone once it is removed. */
function stopBackgroundRefreshes(clone: string): void {
  const marks = readdirSync(join(clone, ".coherence"), { recursive: true, encoding: "utf8" }).filter((path) => /refresh[^/]*\.json$/.test(path));
  for (const mark of marks) {
    const pid = markedPid(join(clone, ".coherence", mark));
    if (pid === undefined || !runsInside(pid, clone)) continue;
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

async function compareBuilds(root: string, rounds: number, out: string): Promise<void> {
  const previous = process.env["COHERENCE_BENCH_BASELINE_CLI"];
  const next = process.env["COHERENCE_BENCH_CLI"];
  if (previous === undefined || next === undefined) throw new Error("compare needs COHERENCE_BENCH_BASELINE_CLI and COHERENCE_BENCH_CLI, each a built dist/cli.js");
  process.env["COHERENCE_NO_WARM_UP"] = "1";
  const clones = mkdtempSync(join(tmpdir(), "coherence-bench-compare-"));
  // Hook text names the CLI and fits a byte budget, so each build runs through a link of one length: a longer path would cut the text elsewhere.
  const linked = (cli: string, name: string): string => {
    const checkout = dirname(dirname(cli));
    symlinkSync(checkout, join(clones, name));
    return join(clones, name, relative(checkout, cli));
  };
  const builds = { previous: linked(previous, "build-a"), next: linked(next, "build-b") };
  const wallsByBuild = { previous: new Map<string, number[]>(), next: new Map<string, number[]>() };
  const outputsByBuild: Record<"previous" | "next", Map<string, unknown>> = { previous: new Map(), next: new Map() };
  try {
    for (let round = 1; round <= rounds; round++) {
      const order: ("previous" | "next")[] = round % 2 === 1 ? ["previous", "next"] : ["next", "previous"];
      for (const build of order) {
        const clone = join(clones, `${basename(root)}-${build}-${round}`);
        const cloned = spawnSync("git", ["clone", "-q", "--shared", root, clone], { encoding: "utf8" });
        if (cloned.status !== 0) throw new Error(`git clone failed: ${cloned.stderr}`);
        try {
          for (const step of compareSteps(clone, "bench-compare")) {
            const ran = await viaCli(clone, step, builds[build]);
            wallsByBuild[build].set(step.label, [...(wallsByBuild[build].get(step.label) ?? []), ran.wall]);
            if (round === 1) outputsByBuild[build].set(`stdout of ${step.label} (exit ${ran.exit})`, masked(ran.stdout, clone, builds[build]));
          }
          if (round === 1) for (const [name, text] of keptOutputs(clone)) outputsByBuild[build].set(name, masked(text, clone, builds[build]));
        } finally {
          try {
            if (existsSync(join(clone, ".coherence"))) stopBackgroundRefreshes(clone);
          } finally {
            rmSync(clone, { recursive: true, force: true });
          }
        }
        process.stderr.write(`round ${round} ${build} done\n`);
      }
    }
  } finally {
    rmSync(clones, { recursive: true, force: true });
  }
  const timings = [...wallsByBuild.previous.keys()].map((label) => ({ label, previousMs: Math.round(median(wallsByBuild.previous.get(label)!)), nextMs: Math.round(median(wallsByBuild.next.get(label)!)) }));
  const outputs = [...new Set([...outputsByBuild.previous.keys(), ...outputsByBuild.next.keys()])].map((name) => ({ name, differences: differences(outputsByBuild.previous.get(name), outputsByBuild.next.get(name)) }));
  writeFileSync(out, JSON.stringify({ root, rounds, builds, timings, outputs }, null, 2));
  for (const { label, previousMs, nextMs } of timings) process.stdout.write(`${label.padEnd(30)} ${(previousMs / 1000).toFixed(2)} s -> ${(nextMs / 1000).toFixed(2)} s\n`);
  for (const { name, differences: found } of outputs) process.stdout.write(found.length === 0 ? `same      ${name}\n` : `DIFFERS   ${name}\n${found.map((line) => `          ${line}`).join("\n")}\n`);
}

async function main(): Promise<void> {
  const [rootArg, roundsArg, kind = "fixture", out] = process.argv.slice(2);
  const root = resolve(rootArg!);
  const rounds = Number(roundsArg ?? 3);
  if (kind === "compare") return compareBuilds(root, rounds, out!);
  const power = spawnSync("pmset", ["-g"], { encoding: "utf8" }).stdout;
  const battery = spawnSync("pmset", ["-g", "batt"], { encoding: "utf8" }).stdout;
  const results: unknown[] = [];
  for (let round = 1; round <= rounds; round++) {
    const order = kind === "starts" ? ["cli"] : round % 2 === 1 ? ["cli", "warm"] : ["warm", "cli"];
    for (const arm of order) {
      const session = `spike-${arm}-${kind}-${round}-${Date.now()}`;
      const list = kind === "starts" ? startSteps(root, session) : steps(root, kind, session);
      if (arm === "cli") {
        const rows = [];
        for (const step of list) rows.push({ label: step.label, ...(await viaCli(root, step)) });
        results.push({ round, arm, session, rows });
      } else {
        results.push({ round, arm, session, ...(await warmSession(root, list)) });
      }
      process.stderr.write(`round ${round} ${arm} done\n`);
    }
  }
  const after = spawnSync("pmset", ["-g", "batt"], { encoding: "utf8" }).stdout;
  writeFileSync(out!, JSON.stringify({ root, kind, rounds, power, battery, after, results }, null, 2));
  if (kind === "starts") reportStarts(root, results as { arm: string; rows: { label: string; wall: number }[] }[]);
}

function reportStarts(root: string, results: { arm: string; rows: { label: string; wall: number }[] }[]): void {
  rmSync(join(root, CHANGED_FILE), { force: true });
  const wallsByLabel = new Map<string, number[]>();
  for (const result of results.filter((r) => r.arm === "cli")) for (const row of result.rows) wallsByLabel.set(row.label, [...(wallsByLabel.get(row.label) ?? []), row.wall]);
  for (const [label, walls] of wallsByLabel) process.stdout.write(`${label.padEnd(24)} ${(median(walls) / 1000).toFixed(2)} s\n`);
  const readingPath = join(root, ".coherence", "cache", "vocabulary", "reading.json");
  const readingBytes = (() => {
    try {
      return statSync(readingPath).size;
    } catch {
      return undefined;
    }
  })();
  process.stdout.write(`reading.json             ${readingBytes === undefined ? "absent" : `${(readingBytes / 1e6).toFixed(1)} MB`}\n`);
}

await main();
