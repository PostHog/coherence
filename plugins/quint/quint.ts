/**
 * The one door to quint: every quint command the plugin runs (a model's
 * typecheck, its simulation, its bounded model check) is spawned here,
 * bounded by a deadline that kills its whole process tree, and read into one
 * outcome:
 *
 *   ok           the command exited 0
 *   violation    quint found a state that breaks the property
 *   error        quint refused the input: a parse or type error, an unknown name
 *   unavailable  quint, or what quint verify needs (Apalache, and the Java
 *                runtime it runs on), could not start or could not be fetched
 *   timeout      it did not finish in its time; nothing it said counts
 *
 * Only ok passes. A step that is unavailable or timed out is never read as a
 * pass: it leaves the bullet not run, with what to install.
 *
 * The binary is COHERENCE_QUINT when set, else quint on the PATH. Quint
 * keeps what it downloads (Apalache, the Rust evaluator) under QUINT_HOME,
 * which passes through.
 */

import { killTree, spawn } from "../../src/plugins/api.ts";

/** The quint release the plugin is written against, major and minor. */
export const QUINT_PIN = "0.33";

export type QuintOutcome = "ok" | "violation" | "error" | "unavailable" | "timeout";

export interface QuintResult {
  outcome: QuintOutcome;
  /** The command as run, for the reason. */
  command: string;
  stdout: string;
  stderr: string;
  /** One line: why the outcome is what it is. */
  reason: string;
}

/** The quint binary: COHERENCE_QUINT when set, else quint on the PATH. */
export function quintBin(): string {
  const named = process.env["COHERENCE_QUINT"];
  return named === undefined || named.trim() === "" ? "quint" : named;
}

/** What quint verify needs that was not there: a Java runtime for Apalache, or Apalache itself, which quint fetches on first use. */
const JAVA_MISSING = /Unable to locate a Java Runtime|java: (?:command )?not found|No Java runtime|JAVA_HOME is not set|java\.lang\.UnsupportedClassVersionError/i;
const CHECKER_UNAVAILABLE = /could not (?:connect|reach) .*Apalache|Failed to (?:start|connect to|download|fetch) Apalache|Downloading Apalache distribution[^\n]*(?:failed|error)|getaddrinfo|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i;

function lastLines(text: string, lines: number): string {
  return text.split("\n").filter((l) => l.trim() !== "").slice(-lines).join(" ");
}

/** Read one finished quint command into its outcome. */
export function quintOutcome(code: number | null, stdout: string, stderr: string): { outcome: QuintOutcome; reason: string } {
  const both = `${stdout}\n${stderr}`;
  if (code === 0) return { outcome: "ok", reason: "exited 0" };
  if (JAVA_MISSING.test(both)) return { outcome: "unavailable", reason: `Java not found: Apalache, the model checker quint verify runs, needs a Java runtime (${both.split("\n").find((l) => JAVA_MISSING.test(l))!.trim()})` };
  if (CHECKER_UNAVAILABLE.test(both)) return { outcome: "unavailable", reason: `Apalache could not be started or fetched: ${lastLines(stderr || stdout, 2)}` };
  // A shell that found no quint, or one it could not execute, exits 127 or 126: nothing was checked.
  if (code === 127 || code === 126) return { outcome: "unavailable", reason: `quint could not run (exit ${code}): ${lastLines(stderr || stdout, 2) || "no output"}` };
  if (/\[violation\]|Invariant violated/i.test(both)) return { outcome: "violation", reason: lastLines(stdout, 3) || "quint reported a violation" };
  return { outcome: "error", reason: lastLines(stderr || stdout, 3) || `exited ${code}` };
}

/** Run one quint command: argv after the binary, from `cwd`, killed with its whole tree after `timeoutMs`. Never throws: a binary that cannot start is unavailable. */
export function runQuint(argv: readonly string[], cwd: string, timeoutMs: number): Promise<QuintResult> {
  const bin = quintBin();
  const command = [bin, ...argv].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: Omit<QuintResult, "command">): void => {
      if (settled) return;
      settled = true;
      resolve({ ...result, command });
    };
    let child;
    try {
      child = spawn(bin, [...argv], { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
    } catch (error) {
      finish({ outcome: "unavailable", stdout, stderr, reason: `quint could not start (${bin}): ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    const timer = setTimeout(() => {
      killTree(child.pid);
      finish({ outcome: "timeout", stdout, stderr, reason: `did not finish in ${Math.round(timeoutMs / 1000)} s; it and every process it started were killed` });
    }, Math.max(1, timeoutMs));
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ outcome: "unavailable", stdout, stderr, reason: `quint could not start (${bin}): ${error.message}; install @informalsystems/quint@${QUINT_PIN} or set COHERENCE_QUINT` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ ...quintOutcome(code, stdout, stderr), stdout, stderr });
    });
  });
}
