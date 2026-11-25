/**
 * Witnessed holds: a test that names a copy holds it only if the test went
 * red when the copy changed. The reading finds the copies a test names; this
 * pass changes each copy (drops a member of a list, alters a value) in a
 * scratch worktree at the reading's commit, runs the tests that name it
 * through the project's own test command, and keeps the verdict under the
 * blobs of the home, the copy and the test, so it is earned again only when
 * one of the three changes.
 *
 * It never runs in a session's reading or in a hook: `query mirrors
 * --witness` runs it where tests already run (CI, a verify step), and until a
 * copy's verdict is kept the reading says it is "held, not yet refuted",
 * counted apart from held.
 *
 * The verdicts are a cache under .coherence/mirrors, transient like the kept
 * reading: a missing file means nothing witnessed yet, never a failure.
 */

import { execFileSync } from "../../lifecycle/work-meter.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { globPattern, readEnforcementConfig, setupClaims, type TestSetup } from "../../enforcement/config.ts";
import { runTotalityOracle } from "../../enforcement/totality.ts";
import type { HeldCopy, MirrorReading } from "./model.ts";

export const HOLDS_PATH = join(".coherence", "mirrors", "holds.json");
const HOLDS_VERSION = 1;

export interface Witnessed {
  verdict: "red" | "green";
  test: string;
  at: string;
  /** What was changed, and the test names that ran. */
  change: string;
  titles: string[];
}

/** The kept verdicts, by key; empty when none were kept or the file cannot be read. */
export function readWitnessed(root: string): Map<string, Witnessed> {
  try {
    const kept = JSON.parse(readFileSync(join(root, HOLDS_PATH), "utf8")) as { version?: number; verdicts?: Record<string, Witnessed> };
    if (kept.version !== HOLDS_VERSION || kept.verdicts === undefined) return new Map();
    return new Map(Object.entries(kept.verdicts));
  } catch {
    return new Map();
  }
}

function keepWitnessed(root: string, verdicts: ReadonlyMap<string, Witnessed>): void {
  const path = join(root, HOLDS_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: HOLDS_VERSION, verdicts: Object.fromEntries(verdicts) }, null, 1));
}

/** The copy changed: a list's first member dropped, or a value altered after its first character. Undefined when the copy is not where the reading placed it. */
export function changedCopy(text: string, hold: Pick<HeldCopy, "copy" | "value" | "members">): { text: string; change: string } | undefined {
  const lines = text.split("\n");
  const from = Math.max(0, hold.copy.line - 1);
  const window = lines.slice(from, from + 40).join("\n");
  const before = lines.slice(0, from).join("\n") + (from > 0 ? "\n" : "");
  const after = lines.slice(from + 40).join("\n");
  const rest = (changed: string): string => before + changed + (from + 40 < lines.length ? `\n${after}` : "");
  const member = hold.members?.[0];
  if (member !== undefined) {
    const re = new RegExp(`(["'\`])${member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1\\s*,?\\s*`);
    if (!re.test(window)) return undefined;
    return { text: rest(window.replace(re, "")), change: `dropped ${JSON.stringify(member)} from ${hold.copy.file}:${hold.copy.line}` };
  }
  const at = window.indexOf(hold.value);
  if (at < 0 || hold.value.length === 0) return undefined;
  const altered = `${hold.value.slice(0, 1)}Zq${hold.value.slice(1)}`;
  return { text: rest(window.slice(0, at) + altered + window.slice(at + hold.value.length)), change: `wrote ${JSON.stringify(altered)} for ${JSON.stringify(hold.value)} at ${hold.copy.file}:${hold.copy.line}` };
}

/** The titles of the tests in a test file whose body names the copy, by its name or its value. */
export function titlesNaming(text: string, hold: Pick<HeldCopy, "copy" | "value">): string[] {
  const out: string[] = [];
  const opener = /(?:^|[^\w.])(?:test|it)\(\s*(["'`])((?:\\.|(?!\1).)*)\1\s*,/g;
  const starts = [...text.matchAll(opener)].map((m) => ({ at: m.index!, title: m[2]!.replace(/\\(.)/g, "$1") }));
  const name = hold.copy.name;
  const named = name === undefined ? undefined : new RegExp(`(^|[^\\w$])${name.replace(/[$]/g, "\\$")}($|[^\\w$])`);
  starts.forEach((s, i) => {
    const body = text.slice(s.at, starts[i + 1]?.at ?? text.length);
    if (body.includes(hold.value) || (named !== undefined && named.test(body))) out.push(s.title);
  });
  return out;
}

/** The test command narrowed to one test file where it names its files by globs: the globs that would find the file give way to the file. */
export function narrowed(command: string[] | string | undefined, file: string): string[] | string | undefined {
  if (command === undefined) return undefined;
  const isGlob = (arg: string): boolean => /[*?]/.test(arg.replace(/^['"]|['"]$/g, "")) && !arg.includes("{filter}") && !arg.startsWith("-");
  const matches = (arg: string): boolean => globPattern(arg.replace(/^['"]|['"]$/g, "")).test(file);
  if (Array.isArray(command)) {
    if (!command.some((a) => isGlob(a) && matches(a))) return command;
    const out = command.filter((a) => !isGlob(a));
    return [...out, file];
  }
  const parts = command.split(/(\s+)/);
  if (!parts.some((p) => isGlob(p) && matches(p))) return command;
  let placed = false;
  return parts
    .map((p) => {
      if (!isGlob(p)) return p;
      if (placed) return "";
      placed = true;
      return `'${file}'`;
    })
    .join("");
}

export interface WitnessReport {
  witnessed: { hold: HeldCopy; verdict: "red" | "green"; change: string }[];
  skipped: { hold: HeldCopy; why: string }[];
}

/**
 * Witness every hold the reading found that has no kept verdict: in one
 * scratch worktree at the reading's commit (the project's node_modules
 * linked in), each test first passes unchanged, then runs with its copy
 * changed; red holds the copy, green does not. A test that fails unchanged,
 * a copy not where the reading placed it, or a test file whose tests do not
 * name the copy witnesses nothing and is said.
 */
export async function witnessHolds(root: string, reading: Pick<MirrorReading, "commit" | "holds">, options: { limit?: number; timeoutMs?: number } = {}): Promise<WitnessReport> {
  const kept = readWitnessed(root);
  const report: WitnessReport = { witnessed: [], skipped: [] };
  const pending = reading.holds.filter((h) => !kept.has(h.key)).slice(0, options.limit ?? Infinity);
  if (pending.length === 0) return report;
  const config = readEnforcementConfig(root);
  const scratch = mkdtempSync(join(tmpdir(), "coherence-holds-"));
  const tree = join(scratch, "tree");
  try {
    execFileSync("git", ["worktree", "add", "--detach", "--quiet", tree, reading.commit], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    for (const linked of ["node_modules", ".venv"]) if (existsSync(join(root, linked)) && !existsSync(join(tree, linked))) symlinkSync(join(root, linked), join(tree, linked));
    for (const hold of pending) {
      const setup: TestSetup = config.tests.find((t) => setupClaims(t, hold.test, config.declared, config.provided)) ?? config.tests[0]!;
      if (setup.test === undefined) {
        report.skipped.push({ hold, why: "no test command is configured (test in coherence.config.json)" });
        continue;
      }
      const titles = titlesNaming(readFileSync(join(tree, hold.test), "utf8"), hold);
      if (titles.length === 0) {
        report.skipped.push({ hold, why: `no test in ${hold.test} names ${hold.copy.name ?? JSON.stringify(hold.value)}` });
        continue;
      }
      const copyPath = join(tree, hold.copy.file);
      const original = readFileSync(copyPath, "utf8");
      const changed = changedCopy(original, hold);
      if (changed === undefined) {
        report.skipped.push({ hold, why: `the copy is not at ${hold.copy.file}:${hold.copy.line}` });
        continue;
      }
      const narrow: TestSetup = { ...setup, test: narrowed(setup.test, hold.test) };
      const run = async (): Promise<"pass" | "fail" | "not run"> => {
        let worst: "pass" | "fail" | "not run" = "pass";
        for (const title of titles) {
          const r = await runTotalityOracle(tree, narrow, title, options.timeoutMs ?? 300_000);
          if (r.verdict === "fail") return "fail";
          if (r.verdict !== "pass") worst = "not run";
        }
        return worst;
      };
      const unchanged = await run();
      if (unchanged !== "pass") {
        report.skipped.push({ hold, why: `${hold.test} does not pass unchanged (${unchanged}), so a red run would say nothing` });
        continue;
      }
      writeFileSync(copyPath, changed.text);
      let verdict: "pass" | "fail" | "not run";
      try {
        verdict = await run();
      } finally {
        writeFileSync(copyPath, original);
      }
      if (verdict === "not run") {
        report.skipped.push({ hold, why: `${hold.test} did not run with the copy changed` });
        continue;
      }
      const v = verdict === "fail" ? "red" : "green";
      kept.set(hold.key, { verdict: v, test: hold.test, at: new Date().toISOString(), change: changed.change, titles });
      report.witnessed.push({ hold, verdict: v, change: changed.change });
    }
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", tree], { cwd: root, stdio: "ignore" });
    } catch {
      // A worktree that cannot be removed is pruned by git later; the scratch folder goes now.
    }
    rmSync(scratch, { recursive: true, force: true });
  }
  keepWitnessed(root, kept);
  return report;
}
