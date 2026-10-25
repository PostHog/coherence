/**
 * The CI check's report (ci.ts, mode comment): one Markdown document for the
 * pull request comment and the job summary, built from what Coherence
 * already holds. For each project (every project a registry lists, when run
 * at its top; else the one project): the spec problems spec --check names,
 * the chokepoint verdicts of the CI session's run, the spec gaps (entrances
 * with outside or unknown trust and no traced control, from the Structure
 * reading, taken when none describes the tree), and the guard failures of
 * the defect floor. Findings never make it fail; it fails only when
 * Coherence did not finish: a project with no run in the session, or a
 * chokepoint the run could not check. Either way the document says so.
 */

import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { registryOf, registryProblems } from "../adapters/project-config.ts";
import { loadRuns, type RunEntry, type RunRecord } from "../enforcement/record.ts";
import type { Io } from "../journal/cli.ts";
import { readComponentInterfaces } from "../readings/scope/component-interfaces.ts";
import { CLOSE_WAYS, currentGaps, gapsOf, readAndRecord, readGapBaseline, structureState, type Gap } from "../readings/scope/gaps.ts";
import { flowOf } from "../readings/scope/structure-flow.ts";
import { changedSince } from "../observation/observed.ts";
import { loadSpecModel, type SpecModel } from "../spec/model.ts";
import { CI_USAGE, REPORT_MARKER } from "./ci.ts";
import { mayHaveGaps } from "./hook.ts";

/** The spec gaps of one project, or why they are not known. */
export type GapsRead = { gaps: Gap[] } | { unread: string };

/** The files a pull request changed, relative to the project, or why they are not known. */
export type ChangedRead = { files: Set<string> } | { unread: string };

/** How the report learns a project's gaps; a test hands in one that needs no language server. */
export type GapReader = (root: string, model: SpecModel) => Promise<GapsRead>;

/** The gaps as orient reads them: the recorded reading when it still describes the tree, else one taken now. */
export const readGaps: GapReader = async (root, model) => {
  if (!mayHaveGaps(root, model)) return { gaps: [] };
  const kept = currentGaps(root);
  if (kept !== undefined) return { gaps: kept.gaps };
  const reading = await readAndRecord(root, () => readComponentInterfaces(root));
  if (reading.kind !== "read") return { unread: reading.because };
  if (reading.partial !== undefined) return { unread: "the Structure reading stopped at its budget, so its routes are partial" };
  if (reading.unanswered !== undefined) return { unread: `the language server could not answer for ${reading.unanswered.map((u) => u.file).join(", ")}, so the Structure reading's routes are partial` };
  const state = structureState(root, reading);
  return { gaps: gapsOf(state, flowOf(state)).gaps };
};

export interface ProjectReport {
  /** Relative to where the report ran, with forward slashes ("." for there). */
  name: string;
  model: SpecModel;
  /** The session's runs in this project, oldest first. */
  runs: RunRecord[];
  gaps: GapsRead;
  /** Gap keys the adoption baseline holds. */
  baselined: Set<string>;
  /** Undefined when the report was given no base to diff against. */
  changed?: ChangedRead | undefined;
}

export interface Report {
  markdown: string;
  /** Why Coherence did not finish, one line each; empty when it did. */
  unfinished: string[];
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function cell(text: string): string {
  // Inline code cannot hold a backtick; the rest of the text is escaped where Markdown would read it.
  return text.replace(/[\\`*_<>|[\]]/g, (c) => `\\${c}`);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function chokepointEntries(runs: readonly RunRecord[]): RunEntry[] {
  // The latest entry per bullet in this session: a rerun replaces an earlier verdict.
  const latest = new Map<string, RunEntry>();
  for (const run of runs) for (const entry of run.invariants) if (entry.form === "chokepoint") latest.set(`${entry.component}\u0000${entry.name}`, entry);
  return [...latest.values()];
}

/** A bullet as <component>/<name>, the entry component's without its "./". */
function bullet(e: RunEntry): string {
  return e.component === "." ? e.name : `${e.component}/${e.name}`;
}

const MARK: Record<string, string> = { pass: "✓", fail: "✕", "not run": "○" };

const CHANGED_HERE = " · **changed in this pull request**";

/** One project's section, and why its part did not finish. */
function projectSection(p: ProjectReport, session: string, heading: boolean): { lines: string[]; unfinished: string[]; touched: number } {
  const lines: string[] = [];
  const unfinished: string[] = [];
  let touched = 0;
  const changed = p.changed !== undefined && "files" in p.changed ? p.changed.files : new Set<string>();
  const mark = (...files: (string | undefined)[]): string => {
    if (!files.some((f) => f !== undefined && changed.has(f))) return "";
    touched++;
    return CHANGED_HERE;
  };
  const where = p.name === "." ? "" : ` in ${p.name}`;
  const c = p.model.counts;
  if (heading) lines.push(`### ${cell(p.name)}`, "");
  lines.push(`Spec size: ${plural(c.components, "component")}, ${plural(c.bullets, "bullet")} (${plural(c.invariants, "invariant")}, ${plural(c.requirements, "requirement")})`, "");

  if (p.model.problems.length > 0) {
    lines.push(`**Spec problems** (spec --check${where}): lines Coherence cannot read as written. Fix each one, then run \`coherence spec --check\` until it finds 0 problems.`, "");
    for (const problem of p.model.problems) lines.push(`- \`${problem.file}:${problem.line}\` ${cell(problem.message)}${mark(problem.file)}`);
    lines.push("");
  }

  const entries = chokepointEntries(p.runs);
  if (p.runs.length === 0) {
    unfinished.push(`no chokepoint run of session ${session}${where}`);
    lines.push(`**Chokepoints:** no run of session ${cell(session)} was recorded${where}, so no chokepoint was checked.`, "");
  } else if (entries.length === 0) {
    lines.push("**Chokepoints:** none declared.", "");
  } else {
    const fails = entries.filter((e) => e.verdict === "fail").length;
    const notRun = entries.filter((e) => e.verdict === "not run");
    lines.push(`**Chokepoints:** ${entries.length - fails - notRun.length} pass, ${fails} fail, ${notRun.length} not run`, "");
    if (fails > 0)
      lines.push(
        "A chokepoint fails when code reaches what it protects without going through it — for example, code that reads a table directly instead of going through the one function meant to guard it. Send each bypass below through the chokepoint, or fix the spec if the rule is wrong.",
        "",
      );
    for (const e of [...entries].sort((a, b) => order(a) - order(b))) {
      lines.push(`- ${MARK[e.verdict]} \`${bullet(e)}\` ${e.grade ?? e.verdict}: ${cell(e.reason)}${e.verdict === "fail" ? mark(...e.files, ...e.bypasses.map((b) => b.file)) : ""}`);
      for (const b of e.bypasses.slice(0, BYPASSES)) lines.push(`  - bypass \`${b.file}:${b.line}\` in ${cell(b.symbol)}`);
      if (e.bypasses.length > BYPASSES) lines.push(`  - and ${e.bypasses.length - BYPASSES} more; run --form chokepoint names them all`);
    }
    lines.push("");
    for (const e of notRun) unfinished.push(`chokepoint ${bullet(e)}${where} was not run: ${e.reason}`);
  }

  if ("unread" in p.gaps) {
    lines.push(`**Spec gaps:** not read: ${cell(p.gaps.unread)}.`, "");
  } else {
    const open = p.gaps.gaps.filter((g) => !p.baselined.has(`${g.component}\u0000${g.name}`));
    const held = p.gaps.gaps.length - open.length;
    const takes = open.length === 1 ? "takes" : "take";
    const was = held === 1 ? "was" : "were";
    lines.push(`**Spec gaps:** ${plural(open.length, "entrance")} ${takes} input from outside this code (trust outside or unknown), and the spec names no check on that input.${held === 0 ? "" : ` ${held} more ${was} already open when Coherence was adopted, so ${held === 1 ? "it is" : "they are"} not listed.`}`, "");
    for (const g of open) lines.push(`- \`${g.specPath}\` entrance **${cell(g.name)}** (trust ${cell(g.trust.join(", ") || "unknown")}), route: ${cell(g.route.stops.join(" -> "))}${mark(g.file, g.specPath)}`);
    if (open.length > 0) lines.push("", `To close a gap, ${CLOSE_WAYS}. \`coherence scaffold control "<entrance>"\` proposes the line.`);
    lines.push("");
  }

  const failures = p.model.defects?.guardFailures ?? [];
  if (failures.length > 0) {
    lines.push(
      `**Guard failures:** ${failures.length}`,
      "",
      "A kind of bug came back, even though a guard was meant to stop it. Check why each guard below let it through.",
      "",
      "These have no file to check against this pull request's changes, so none of them ever carry the changed-in-this-pull-request mark.",
      "",
    );
    for (const g of failures) lines.push(`- ${g.id} in class ${cell(g.class)}, which ${cell(g.guard)} has guarded since ${g.resolution} closed ${g.guardedBy}`);
    lines.push("");
  }
  return { lines, unfinished, touched };
}

/** How many bypass sites one verdict lists before it counts the rest. */
const BYPASSES = 5;

/** Failures first, then what was not run, then passes. */
function order(e: RunEntry): number {
  return e.verdict === "fail" ? 0 : e.verdict === "not run" ? 1 : 2;
}

/** Whether there is anything to fix, and which findings this pull request's own files hold, when the report knows them. */
function findingsLead(projects: readonly ProjectReport[], findings: number, touched: number, unfinished: readonly string[]): string[] {
  if (findings === 0) {
    if (unfinished.length > 0 || projects.some((p) => "unread" in p.gaps)) return ["Coherence could not check everything, so this might not list every finding.", ""];
    return ["Nothing to fix.", ""];
  }
  const changed = projects.filter((p) => p.changed !== undefined);
  if (changed.length === 0) return ["These findings do not fail this check. Some can come from files this pull request did not change.", ""];
  const lines = ["These findings do not fail this check.", ""];
  const allRead = changed.every((p) => "files" in p.changed!);
  for (const p of changed) if ("unread" in p.changed!) lines.push(`Coherence could not tell which files this pull request changed${p.name === "." ? "" : ` in ${cell(p.name)}`}: ${cell(p.changed.unread)}.`, "");
  if (changed.some((p) => "files" in p.changed!)) {
    if (touched === 0) lines.push(allRead ? "None of these findings are in files this pull request changed." : "None of the findings Coherence could check are in files this pull request changed.", "");
    else if (touched === 1) lines.push("1 of these findings is in a file this pull request changed. It is marked below.", "");
    else lines.push(`${touched} of these findings are in files this pull request changed. They are marked below.`, "");
  }
  return lines;
}

/** Whether a registry problem's file is one this pull request changed. */
function registryMark(problem: { file: string }, changed: ChangedRead | undefined): string {
  return changed !== undefined && "files" in changed && changed.files.has(problem.file) ? CHANGED_HERE : "";
}

/** The report over the projects, with the registry's own problems when the report ran at its top. */
export function renderReport(
  projects: readonly ProjectReport[],
  session: string,
  registry: { problems: { file: string; message: string }[]; changed: ChangedRead | undefined } | undefined,
): Report {
  const unfinished: string[] = [];
  const sections: string[] = [];
  let touched = 0;
  for (const p of projects) {
    const section = projectSection(p, session, projects.length > 1 || p.name !== ".");
    sections.push(...section.lines);
    unfinished.push(...section.unfinished);
    touched += section.touched;
  }
  const registryMarks = (registry?.problems ?? []).map((problem) => registryMark(problem, registry?.changed));
  touched += registryMarks.filter((m) => m !== "").length;
  const problems = projects.reduce((n, p) => n + p.model.problems.length, 0) + (registry?.problems.length ?? 0);
  const fails = projects.reduce((n, p) => n + chokepointEntries(p.runs).filter((e) => e.verdict === "fail").length, 0);
  const gaps = projects.reduce((n, p) => n + ("gaps" in p.gaps ? p.gaps.gaps.filter((g) => !p.baselined.has(`${g.component}\u0000${g.name}`)).length : 0), 0);
  const guards = projects.reduce((n, p) => n + (p.model.defects?.guardFailures.length ?? 0), 0);
  const head = [REPORT_MARKER, "## Coherence", ""];
  head.push(`**${plural(problems, "spec problem")} · ${plural(fails, "failing chokepoint")} · ${plural(gaps, "spec gap")} · ${plural(guards, "guard failure")}**${projects.length > 1 ? ` across ${plural(projects.length, "project")}` : ""}`, "");
  head.push(...findingsLead(projects, problems + fails + gaps + guards, touched, unfinished));
  if (unfinished.length > 0) {
    head.push("> [!WARNING]", "> Coherence did not finish, so this report is incomplete and the check fails:");
    for (const line of unfinished) head.push(`> - ${cell(line)}`);
    head.push("");
  }
  if (registry !== undefined && registry.problems.length > 0) {
    head.push("**Registry problems**", "");
    registry.problems.forEach((problem, i) => head.push(`- \`${problem.file}\` ${cell(problem.message)}${registryMarks[i]}`));
    head.push("");
  }
  const markdown = [...head, ...sections].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return { markdown, unfinished };
}

/** Build the report for `root`: every project a registry lists when `root` is its top, else `root` itself. */
export async function buildReport(given: string, session: string, readGapsOf: GapReader = readGaps, base?: string): Promise<Report> {
  const root = realOr(given);
  const registry = registryOf(root);
  // At a registry's top, which is no project of its own, the report covers every listed project, as spec --check and run do there.
  const atTop = registry !== undefined && !registry.leaves.includes(root) && registry.top === root;
  const roots = atTop ? registry.leaves : [root];
  const projects: ProjectReport[] = [];
  for (const project of roots) {
    const model = loadSpecModel(project);
    const runs = loadRuns(project).records.filter((r) => r.session === session);
    const baseline = readGapBaseline(project);
    projects.push({
      name: relative(root, project).split(sep).join("/") || ".",
      model,
      runs,
      gaps: await readGapsOf(project, model),
      baselined: baseline?.entrances ?? new Set(),
      changed: base === undefined ? undefined : changedRead(changedSince(project, base)),
    });
  }
  return renderReport(projects, session, atTop ? { problems: registryProblems(registry.top), changed: base === undefined ? undefined : changedRead(changedSince(root, base)) } : undefined);
}

function changedRead(files: string[] | string): ChangedRead {
  return typeof files === "string" ? { unread: files } : { files: new Set(files) };
}

/** The pull request's base commit as GitHub Actions recorded it at the event that started the run, fixed even when the base branch moves on while the run is in flight. */
function eventBaseSha(env: NodeJS.ProcessEnv): string | undefined {
  if (!env.GITHUB_EVENT_PATH) return undefined;
  try {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) as { pull_request?: { base?: { sha?: string } } };
    const sha = event.pull_request?.base?.sha;
    return sha === undefined || sha === "" ? undefined : sha;
  } catch {
    return undefined;
  }
}

/**
 * ci report --session <id> [--base <commit>]: the Markdown on stdout; exit 1 when Coherence did not finish.
 * Without --base, a pull request's run on GitHub Actions compares against the event's fixed base commit, falling
 * back to the base branch GITHUB_BASE_REF names when the event carries none — the base branch itself can move on
 * while the run is still going, which --base must not follow.
 */
export async function ciReportCommand(argv: string[], io: Io, readGapsOf: GapReader = readGaps, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let session: string | undefined;
  let base: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--session") session = argv[++i];
    else if (arg.startsWith("--session=")) session = arg.slice("--session=".length);
    else if (arg === "--base") base = argv[++i];
    else if (arg.startsWith("--base=")) base = arg.slice("--base=".length);
    else {
      io.err(`ci report: unexpected ${arg}\n${CI_USAGE}`);
      return 64;
    }
  }
  if (session === undefined || session === "") {
    io.err(`ci report: --session names the run's session, as the chokepoint run recorded it\n${CI_USAGE}`);
    return 64;
  }
  if (base === undefined) base = eventBaseSha(env) ?? (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : undefined);
  const report = await buildReport(io.cwd, session, readGapsOf, base);
  io.out(report.markdown.trimEnd());
  for (const line of report.unfinished) io.err(`ci report: ${line}`);
  return report.unfinished.length > 0 ? 1 : 0;
}
