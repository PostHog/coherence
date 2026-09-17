/**
 * The totality oracle pass: run the test the bullet's `via` names through
 * the configured test command. The `via` value, in the adapter's test-filter form, is appended
 * to an argv array or substituted for {filter} in a string template. The
 * verdict is pass when the command exits 0 and, when `testMatch` is
 * configured, its output matches; fail otherwise; not run when no command
 * is configured or it cannot be started. Not configured is reported, never
 * assumed passing.
 */

import { spawn } from "node:child_process";
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
  const spec = commandFor(config, filter);
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
