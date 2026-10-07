/**
 * The totality oracle pass: run the test the bullet's `via` names through
 * the configured test command. The `via` value, in the adapter's test-filter form, is appended
 * to an argv array or substituted for {filter} in a string template. The
 * verdict is pass when the command exits 0 and, when `testMatch` is
 * configured, its output matches; fail otherwise; not run when no command
 * is configured or it cannot be started. Not configured is reported, never
 * assumed passing.
 *
 * A runner whose setup is costly (a workers pool, a database) should not
 * start once per test named: when the config names a `testJson` command,
 * every test the bullets name runs in one invocation with a combined name pattern and
 * a jest-shaped JSON report, and the results map back by test name. The
 * one-at-a-time path remains for runners that cannot report per test.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnforcementConfig } from "./config.ts";
import type { Verdict } from "./record.ts";

export interface TotalityResult {
  verdict: Verdict;
  reason: string;
  /** The command as run, for the report. */
  command: string | undefined;
  /** The last lines of output, for a failure. */
  tail: string;
  /** How many reported tests mapped to this via, when the runner reported per test: 0 says no test of that name ran. */
  matched?: number;
  /** Milliseconds the tests under this via ran, as the runner measured them; absent when the report carried no duration for one of them. */
  testMs?: number;
  /** The detector did not finish inside its time: the reason says how long it had, and nothing it did counts. */
  unfinished?: true;
}

export const TOTALITY_TIMEOUT_MS = 10 * 60 * 1000;

function commandFor(config: EnforcementConfig, filter: string): { command: string; args: string[]; shell: boolean } | undefined {
  if (config.test === undefined) return undefined;
  if (Array.isArray(config.test)) {
    const [command, ...args] = config.test;
    return { command: command!, args: [...args, filter], shell: false };
  }
  const line = config.test.includes("{filter}") ? config.test.split("{filter}").join(shellQuote(filter)) : `${config.test} ${shellQuote(filter)}`;
  return { command: line, args: [], shell: true };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runTotalityOracle(root: string, config: EnforcementConfig, filter: string, timeoutMs = TOTALITY_TIMEOUT_MS): Promise<TotalityResult> {
  const spec = commandFor(config, config.testFilterForm === "pytest" ? filter : escapeRegExp(filter));
  if (spec === undefined) {
    return { verdict: "not run", reason: "no test command configured; set test in coherence.config.json (an argv array the filter is appended to, or a string with {filter})", command: undefined, tail: "" };
  }
  const shown = spec.shell ? spec.command : [spec.command, ...spec.args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (result: TotalityResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      child = spawn(spec.command, spec.args, { cwd: root, shell: spec.shell, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: process.env["CI"] ?? "1" } });
    } catch (error) {
      finish({ verdict: "not run", reason: `test command could not start: ${error instanceof Error ? error.message : String(error)}`, command: shown, tail: "" });
      return;
    }
    const timer = setTimeout(() => {
      killTree(child.pid);
      finish({ verdict: "fail", reason: `the detector did not finish in ${Math.round(timeoutMs / 1000)} s; its test process and every process it started were killed`, command: shown, tail: tailOf(output), unfinished: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ verdict: "not run", reason: `test command could not start: ${error.message}`, command: shown, tail: "" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const matched = config.testMatch === undefined ? true : config.testMatch.test(output);
      if (code === 0 && matched) finish({ verdict: "pass", reason: `${shown} exited 0${config.testMatch === undefined ? "" : ` and its output matched ${config.testMatch}`}`, command: shown, tail: "" });
      else if (code === 0) finish({ verdict: "fail", reason: `${shown} exited 0 but its output did not match ${config.testMatch}; no test ran under that name`, command: shown, tail: tailOf(output) });
      else finish({ verdict: "fail", reason: `${shown} exited ${code}`, command: shown, tail: tailOf(output) });
    });
  });
}

function tailOf(output: string, lines = 12): string {
  return output.split("\n").filter((l) => l.trim() !== "").slice(-lines).join("\n");
}

/* ------------------------------------------------------- one invocation */

export interface AssertionResult {
  ancestorTitles?: string[];
  title?: string;
  fullName?: string;
  status?: string;
  /** Jest's field: for a failure, the message and stack the runner reported. */
  failureMessages?: string[];
  /** Jest's field: how long the test ran, in milliseconds. */
  duration?: number;
}

export interface JsonReport {
  /** The test file, where the runner names it (jest, vitest, and the node:test reporter do). */
  testResults?: { name?: string; assertionResults?: AssertionResult[] }[];
}

/** A test title as a runner name filter: every regex metacharacter escaped, so a title with parentheses selects itself and nothing else. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The combined name pattern one invocation takes: every filter, escaped, as regex alternatives; or, for pytest's -k, the names as written joined with `or`. */
export function combinedFilter(filters: readonly string[], form: "regex" | "pytest" = "regex"): string {
  const unique = [...new Set(filters)];
  return form === "pytest" ? unique.join(" or ") : unique.map(escapeRegExp).join("|");
}

/* --------------------------------------------------------- report shapes */

/** Decode the few entities an XML attribute can carry. */
function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * pytest's JUnit XML (`--junitxml=<out>`) as the jest shape: one testcase per
 * test with `classname` (module and class, dotted) and `name`; a nested
 * failure or error element is a fail, a skipped element a skip. No XML
 * library: the elements are regular enough for a scan.
 */
export function reportFromJunit(xml: string): JsonReport {
  const results: AssertionResult[] = [];
  const cases = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(cases)) {
    const attributes = match[1] ?? "";
    const attribute = (key: string): string => decodeXml(new RegExp(`\\b${key}="([^"]*)"`).exec(attributes)?.[1] ?? "");
    const inner = match[3] ?? "";
    const status = /<(failure|error)\b/.test(inner) ? "failed" : /<skipped\b/.test(inner) ? "skipped" : "passed";
    const classname = attribute("classname");
    const title = attribute("name");
    const seconds = Number.parseFloat(attribute("time"));
    const ancestorTitles = classname === "" ? [] : classname.split(".");
    const failure = status === "failed" ? /<(?:failure|error)\b[^>]*>([\s\S]*?)<\/(?:failure|error)>/.exec(inner)?.[1] : undefined;
    results.push({ ancestorTitles, title, fullName: classname === "" ? title : `${classname}.${title}`, status, ...(failure === undefined ? {} : { failureMessages: [decodeXml(failure)] }), ...(Number.isFinite(seconds) ? { duration: seconds * 1000 } : {}) });
  }
  return { testResults: [{ assertionResults: results }] };
}

/** pytest-json-report's shape (`tests[].nodeid`, `tests[].outcome`) as the jest shape. */
type PytestPhase = { longrepr?: unknown; duration?: number };

function reportFromPytestJson(report: { tests?: { nodeid?: string; outcome?: string; setup?: PytestPhase; call?: PytestPhase; teardown?: PytestPhase }[] }): JsonReport {
  const results: AssertionResult[] = (report.tests ?? []).map((t) => {
    const segments = (t.nodeid ?? "").split("::");
    const title = segments[segments.length - 1] ?? "";
    const outcome = t.outcome ?? "";
    const status = outcome === "passed" || outcome === "xfailed" ? "passed" : outcome === "failed" || outcome === "error" || outcome === "xpassed" ? "failed" : "skipped";
    const longrepr = t.call?.longrepr;
    // A test's time is its three phases, in seconds, as pytest-json-report measured each.
    const phases = [t.setup, t.call, t.teardown].map((phase) => phase?.duration).filter((d): d is number => typeof d === "number");
    return { ancestorTitles: segments.slice(0, -1), title, fullName: t.nodeid ?? title, status, ...(typeof longrepr === "string" ? { failureMessages: [longrepr] } : {}), ...(phases.length === 0 ? {} : { duration: phases.reduce((a, b) => a + b, 0) * 1000 }) };
  });
  return { testResults: [{ assertionResults: results }] };
}

/** Whatever report the runner wrote, as the jest shape: JUnit XML, pytest-json-report, or jest itself. */
export function parseReport(text: string): JsonReport {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) return reportFromJunit(trimmed);
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  if (Array.isArray(parsed["tests"]) && !("testResults" in parsed)) return reportFromPytestJson(parsed as { tests?: { nodeid?: string; outcome?: string }[] });
  return parsed as JsonReport;
}

/**
 * Whether a reported test belongs to the test a `via` value names, by exact
 * title: the value is the test's own title, one of the titles above it, or its
 * full name. A substring mapping let a bullet's verdict come from a different
 * test whose title merely contained its name, which is the whole mapping the
 * batched pass rests on.
 *
 * The one stated fallback is a runner that truncates titles in its report: a
 * reported title ending in an ellipsis matches the via it is a prefix of, and
 * nothing else. Nothing else falls back.
 */
export function belongsTo(result: AssertionResult, via: string): boolean {
  if (result.title === via || result.fullName === via) return true;
  if (result.ancestorTitles?.includes(via) === true) return true;
  return truncatedTo(result.title, via) || truncatedTo(result.fullName, via);
}

/** A title the runner cut short: the ellipsis it ends with, and the rest a prefix of the via. */
function truncatedTo(reported: string | undefined, via: string): boolean {
  if (reported === undefined) return false;
  const cut = /^(.+?)(?:\.\.\.|…)$/.exec(reported);
  return cut !== null && via.startsWith(cut[1]!) && cut[1]!.length < via.length;
}

/** The verdict for each test a bullet names from one jest-shaped report. */
export function verdictsFromReport(report: JsonReport, filters: readonly string[], command: string): Map<string, TotalityResult> {
  const results = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  const out = new Map<string, TotalityResult>();
  for (const via of filters) {
    const mine = results.filter((r) => belongsTo(r, via));
    if (mine.length === 0) {
      out.set(via, { verdict: "fail", reason: `no test ran under the name "${via}" in ${command}`, command, tail: "", matched: 0 });
      continue;
    }
    const failed = mine.filter((r) => r.status === "failed");
    const passed = mine.filter((r) => r.status === "passed");
    const timed = mine.every((r) => typeof r.duration === "number") ? { testMs: Math.round(mine.reduce((sum, r) => sum + (r.duration ?? 0), 0)) } : {};
    if (failed.length > 0) {
      out.set(via, { verdict: "fail", reason: `${failed.length} of ${mine.length} tests under "${via}" failed: ${failed.map((r) => r.fullName ?? r.title ?? "?").slice(0, 3).join("; ")}`, command, tail: "", matched: mine.length, ...timed });
    } else if (passed.length === mine.length) {
      out.set(via, { verdict: "pass", reason: `${passed.length} test${passed.length === 1 ? "" : "s"} under "${via}" passed in one invocation of ${command}`, command, tail: "", matched: mine.length, ...timed });
    } else {
      out.set(via, { verdict: "not run", reason: `${mine.length - passed.length} of ${mine.length} tests under "${via}" were skipped or pending`, command, tail: "", matched: mine.length, ...timed });
    }
  }
  return out;
}

/**
 * Every test a bullet names in one invocation of the config's `testJson` command,
 * mapped back by name. Undefined when the config names no such command,
 * so the caller falls back to one test per invocation.
 */
/** The one invocation, as spawned. */
export interface CommandSpec {
  command: string;
  args: string[];
  shell: boolean;
  /** Variables added to the environment the runner inherits. */
  env?: Record<string, string>;
}

/**
 * An observed pass (src/observation) rides the same invocation: it may add
 * coverage flags and environment to the one command, and it is handed the
 * parsed report before the report is removed. It never adds an invocation.
 */
export interface BatchObserver {
  wrap(spec: CommandSpec): CommandSpec;
  /** The report the runner wrote, parsed; undefined when none was written or it did not parse. */
  report(report: JsonReport | undefined): void;
}

export async function runTotalityBatch(root: string, config: EnforcementConfig, filters: readonly string[], timeoutMs = TOTALITY_TIMEOUT_MS, observer?: BatchObserver): Promise<Map<string, TotalityResult> | undefined> {
  if (config.testJson === undefined || filters.length === 0) return undefined;
  const out = join(tmpdir(), `coherence-totality-${randomBytes(4).toString("hex")}.${config.testFilterForm === "pytest" ? "xml" : "json"}`);
  const filter = combinedFilter(filters, config.testFilterForm);
  const substitute = (arg: string): string => arg.split("{filter}").join(filter).split("{out}").join(out);
  const plain: CommandSpec = Array.isArray(config.testJson)
    ? { command: config.testJson[0]!, args: config.testJson.slice(1).map(substitute), shell: false }
    : { command: config.testJson.split("{filter}").join(shellQuote(filter)).split("{out}").join(shellQuote(out)), args: [] as string[], shell: true };
  const spec = observer === undefined ? plain : observer.wrap(plain);
  // The combined pattern and the report path are long and the same for every entry: shown collapsed.
  const shown = (Array.isArray(config.testJson) ? config.testJson.join(" ") : config.testJson)
    .split("{filter}")
    .join(`<${filters.length} names>`)
    .split("{out}")
    .join("<report>");
  const notRun = (reason: string, tail = "", unfinished = false): Map<string, TotalityResult> =>
    new Map(filters.map((via) => [via, { verdict: "not run" as Verdict, reason, command: shown, tail, matched: 0, ...(unfinished ? { unfinished: true } : {}) }]));
  let parsed: JsonReport | undefined;
  let unfinished: string | undefined;
  let heard = "";
  try {
    const output = await new Promise<{ code: number | null; text: string }>((resolve, reject) => {
      let text = "";
      const child = spawn(spec.command, spec.args, { cwd: root, shell: spec.shell, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: process.env["CI"] ?? "1", ...spec.env } });
      const timer = setTimeout(() => {
        // The runner's own children (a test file each) outlive a killed parent and keep looping: the whole tree goes.
        killTree(child.pid);
        unfinished = `the detector did not finish in ${Math.round(timeoutMs / 1000)} s; its test process and every process it started were killed`;
        heard = text;
        reject(new Error(unfinished));
      }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, text });
      });
    });
    if (!existsSync(out)) return notRun(`${shown} exited ${output.code} and wrote no report at {out}`, tailOf(output.text));
    try {
      parsed = parseReport(readFileSync(out, "utf8"));
    } catch (error) {
      return notRun(`the report ${shown} wrote is neither jest-shaped JSON, JUnit XML, nor pytest-json-report (${error instanceof Error ? error.message : String(error)})`, tailOf(output.text));
    }
    return verdictsFromReport(parsed, filters, shown);
  } catch (error) {
    if (unfinished !== undefined) return notRun(unfinished, tailOf(heard), true);
    return notRun(`test command could not run: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(out, { force: true });
    observer?.report(parsed);
  }
}

/** Kill a process and every process below it, found through ps; a process already gone is skipped. */
export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  const listed = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  const children = new Map<number, number[]>();
  for (const line of (listed.stdout ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line);
    if (m !== null) children.set(Number(m[2]), [...(children.get(Number(m[2])) ?? []), Number(m[1])]);
  }
  const all: number[] = [];
  const walk = (at: number): void => {
    all.push(at);
    for (const child of children.get(at) ?? []) walk(child);
  };
  walk(pid);
  for (const each of all) {
    try {
      process.kill(each, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}
