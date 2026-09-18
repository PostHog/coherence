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

import { spawn } from "node:child_process";
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
      child.kill("SIGKILL");
      finish({ verdict: "fail", reason: `test command gave no verdict in ${Math.round(timeoutMs / 1000)} s`, command: shown, tail: tailOf(output) });
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

interface AssertionResult {
  ancestorTitles?: string[];
  title?: string;
  fullName?: string;
  status?: string;
}

interface JsonReport {
  testResults?: { assertionResults?: AssertionResult[] }[];
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
    const ancestorTitles = classname === "" ? [] : classname.split(".");
    results.push({ ancestorTitles, title, fullName: classname === "" ? title : `${classname}.${title}`, status });
  }
  return { testResults: [{ assertionResults: results }] };
}

/** pytest-json-report's shape (`tests[].nodeid`, `tests[].outcome`) as the jest shape. */
function reportFromPytestJson(report: { tests?: { nodeid?: string; outcome?: string }[] }): JsonReport {
  const results: AssertionResult[] = (report.tests ?? []).map((t) => {
    const segments = (t.nodeid ?? "").split("::");
    const title = segments[segments.length - 1] ?? "";
    const outcome = t.outcome ?? "";
    const status = outcome === "passed" || outcome === "xfailed" ? "passed" : outcome === "failed" || outcome === "error" || outcome === "xpassed" ? "failed" : "skipped";
    return { ancestorTitles: segments.slice(0, -1), title, fullName: t.nodeid ?? title, status };
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
 * Whether a reported test belongs to the test a `via` value names. The
 * runner selected by pattern match on the full name, so the mapping matches
 * the same way: the value is contained in a describe title above the test,
 * in its own title, or in the full name.
 */
function belongsTo(result: AssertionResult, via: string): boolean {
  if (result.title?.includes(via)) return true;
  if (result.ancestorTitles?.some((title) => title.includes(via))) return true;
  return result.fullName?.includes(via) ?? false;
}

/** The verdict for each test a bullet names from one jest-shaped report. */
export function verdictsFromReport(report: JsonReport, filters: readonly string[], command: string): Map<string, TotalityResult> {
  const results = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  const out = new Map<string, TotalityResult>();
  for (const via of filters) {
    const mine = results.filter((r) => belongsTo(r, via));
    if (mine.length === 0) {
      out.set(via, { verdict: "fail", reason: `no test ran under the name "${via}" in ${command}`, command, tail: "" });
      continue;
    }
    const failed = mine.filter((r) => r.status === "failed");
    const passed = mine.filter((r) => r.status === "passed");
    if (failed.length > 0) {
      out.set(via, { verdict: "fail", reason: `${failed.length} of ${mine.length} tests under "${via}" failed: ${failed.map((r) => r.fullName ?? r.title ?? "?").slice(0, 3).join("; ")}`, command, tail: "" });
    } else if (passed.length === mine.length) {
      out.set(via, { verdict: "pass", reason: `${passed.length} test${passed.length === 1 ? "" : "s"} under "${via}" passed in one invocation of ${command}`, command, tail: "" });
    } else {
      out.set(via, { verdict: "not run", reason: `${mine.length - passed.length} of ${mine.length} tests under "${via}" were skipped or pending`, command, tail: "" });
    }
  }
  return out;
}

/**
 * Every test a bullet names in one invocation of the config's `testJson` command,
 * mapped back by name. Undefined when the config names no such command,
 * so the caller falls back to one test per invocation.
 */
export async function runTotalityBatch(root: string, config: EnforcementConfig, filters: readonly string[], timeoutMs = TOTALITY_TIMEOUT_MS): Promise<Map<string, TotalityResult> | undefined> {
  if (config.testJson === undefined || filters.length === 0) return undefined;
  const out = join(tmpdir(), `coherence-totality-${randomBytes(4).toString("hex")}.${config.testFilterForm === "pytest" ? "xml" : "json"}`);
  const filter = combinedFilter(filters, config.testFilterForm);
  const substitute = (arg: string): string => arg.split("{filter}").join(filter).split("{out}").join(out);
  const spec = Array.isArray(config.testJson)
    ? { command: config.testJson[0]!, args: config.testJson.slice(1).map(substitute), shell: false }
    : { command: config.testJson.split("{filter}").join(shellQuote(filter)).split("{out}").join(shellQuote(out)), args: [] as string[], shell: true };
  // The combined pattern and the report path are long and the same for every entry: shown collapsed.
  const shown = (Array.isArray(config.testJson) ? config.testJson.join(" ") : config.testJson)
    .split("{filter}")
    .join(`<${filters.length} names>`)
    .split("{out}")
    .join("<report>");
  const notRun = (reason: string, tail = ""): Map<string, TotalityResult> => new Map(filters.map((via) => [via, { verdict: "not run" as Verdict, reason, command: shown, tail }]));
  try {
    const output = await new Promise<{ code: number | null; text: string }>((resolve, reject) => {
      let text = "";
      const child = spawn(spec.command, spec.args, { cwd: root, shell: spec.shell, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: process.env["CI"] ?? "1" } });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`gave no verdict in ${Math.round(timeoutMs / 1000)} s`));
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
    let report: JsonReport;
    try {
      report = parseReport(readFileSync(out, "utf8"));
    } catch (error) {
      return notRun(`the report ${shown} wrote is neither jest-shaped JSON, JUnit XML, nor pytest-json-report (${error instanceof Error ? error.message : String(error)})`, tailOf(output.text));
    }
    return verdictsFromReport(report, filters, shown);
  } catch (error) {
    return notRun(`test command could not run: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(out, { force: true });
  }
}
