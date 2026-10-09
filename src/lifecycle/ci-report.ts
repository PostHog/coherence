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

import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { registryOf, registryProblems } from "../adapters/project-config.ts";
import { loadRuns, type RunEntry, type RunRecord } from "../enforcement/record.ts";
import type { Io } from "../journal/cli.ts";
import { readComponentInterfaces } from "../readings/scope/component-interfaces.ts";
import { currentGaps, gapsOf, readAndRecord, readGapBaseline, structureState, type Gap } from "../readings/scope/gaps.ts";
import { flowOf } from "../readings/scope/structure-flow.ts";
import { loadSpecModel, type SpecModel } from "../spec/model.ts";
import { CI_USAGE, REPORT_MARKER } from "./ci.ts";
import { mayHaveGaps } from "./hook.ts";

/** The spec gaps of one project, or why they are not known. */
export type GapsRead = { gaps: Gap[] } | { unread: string };

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

/** One project's section, and why its part did not finish. */
function projectSection(p: ProjectReport, session: string, heading: boolean): { lines: string[]; unfinished: string[] } {
  const lines: string[] = [];
  const unfinished: string[] = [];
  const where = p.name === "." ? "" : ` in ${p.name}`;
  const c = p.model.counts;
  if (heading) lines.push(`### ${cell(p.name)}`, "");
  lines.push(`${plural(c.components, "component")}, ${plural(c.bullets, "bullet")} (${plural(c.invariants, "invariant")}, ${plural(c.requirements, "requirement")}), ${plural(c.problems, "problem")}`, "");

  if (p.model.problems.length > 0) {
    lines.push(`**Spec problems** (spec --check${where})`, "");
    for (const problem of p.model.problems) lines.push(`- \`${problem.file}:${problem.line}\` ${cell(problem.message)}`);
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
    for (const e of [...entries].sort((a, b) => order(a) - order(b))) {
      lines.push(`- ${MARK[e.verdict]} \`${bullet(e)}\` ${e.grade ?? e.verdict}: ${cell(e.reason)}`);
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
    lines.push(`**Spec gaps:** ${plural(open.length, "entrance")} with outside or unknown trust and no traced control${held === 0 ? "" : `, and ${held} more held by the adoption baseline`}`, "");
    for (const g of open) lines.push(`- \`${g.specPath}\` entrance ${cell(g.name)} (trust ${cell(g.trust.join(", ") || "unknown")}): ${cell(g.route.stops.join(" -> "))}`);
    if (open.length > 0) lines.push("", "Close one with `guard: <chokepoint>`, an invariant that names it on its `entrances:` line, or `control: none — <reason>`; `scaffold control` proposes it.");
    lines.push("");
  }

  const failures = p.model.defects?.guardFailures ?? [];
  if (failures.length > 0) {
    lines.push(`**Guard failures:** ${failures.length}`, "");
    for (const g of failures) lines.push(`- ${g.id} in class ${cell(g.class)}, which ${cell(g.guard)} has guarded since ${g.resolution} closed ${g.guardedBy}`);
    lines.push("");
  }
  return { lines, unfinished };
}

/** How many bypass sites one verdict lists before it counts the rest. */
const BYPASSES = 5;

/** Failures first, then what was not run, then passes. */
function order(e: RunEntry): number {
  return e.verdict === "fail" ? 0 : e.verdict === "not run" ? 1 : 2;
}

/** The report over the projects, with the registry's own problems when the report ran at its top. */
export function renderReport(projects: readonly ProjectReport[], session: string, registry: { problems: { file: string; message: string }[] } | undefined): Report {
  const unfinished: string[] = [];
  const sections: string[] = [];
  for (const p of projects) {
    const section = projectSection(p, session, projects.length > 1 || p.name !== ".");
    sections.push(...section.lines);
    unfinished.push(...section.unfinished);
  }
  const problems = projects.reduce((n, p) => n + p.model.problems.length, 0) + (registry?.problems.length ?? 0);
  const fails = projects.reduce((n, p) => n + chokepointEntries(p.runs).filter((e) => e.verdict === "fail").length, 0);
  const gaps = projects.reduce((n, p) => n + ("gaps" in p.gaps ? p.gaps.gaps.filter((g) => !p.baselined.has(`${g.component}\u0000${g.name}`)).length : 0), 0);
  const guards = projects.reduce((n, p) => n + (p.model.defects?.guardFailures.length ?? 0), 0);
  const head = [REPORT_MARKER, "## Coherence", ""];
  head.push(`**${plural(problems, "spec problem")} · ${plural(fails, "failing chokepoint")} · ${plural(gaps, "spec gap")} · ${plural(guards, "guard failure")}**${projects.length > 1 ? ` across ${plural(projects.length, "project")}` : ""}`, "");
  if (unfinished.length > 0) {
    head.push("> [!WARNING]", "> Coherence did not finish, so this report is incomplete and the check fails:");
    for (const line of unfinished) head.push(`> - ${cell(line)}`);
    head.push("");
  }
  if (registry !== undefined && registry.problems.length > 0) {
    head.push("**Registry problems**", "");
    for (const problem of registry.problems) head.push(`- \`${problem.file}\` ${cell(problem.message)}`);
    head.push("");
  }
  const markdown = [...head, ...sections].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return { markdown, unfinished };
}

/** Build the report for `root`: every project a registry lists when `root` is its top, else `root` itself. */
export async function buildReport(given: string, session: string, readGapsOf: GapReader = readGaps): Promise<Report> {
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
    });
  }
  return renderReport(projects, session, atTop ? { problems: registryProblems(registry.top) } : undefined);
}

/** ci report --session <id>: the Markdown on stdout; exit 1 when Coherence did not finish. */
export async function ciReportCommand(argv: string[], io: Io, readGapsOf: GapReader = readGaps): Promise<number> {
  let session: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--session") session = argv[++i];
    else if (arg.startsWith("--session=")) session = arg.slice("--session=".length);
    else {
      io.err(`ci report: unexpected ${arg}\n${CI_USAGE}`);
      return 64;
    }
  }
  if (session === undefined || session === "") {
    io.err(`ci report: --session names the run's session, as the chokepoint run recorded it\n${CI_USAGE}`);
    return 64;
  }
  const report = await buildReport(io.cwd, session, readGapsOf);
  io.out(report.markdown.trimEnd());
  for (const line of report.unfinished) io.err(`ci report: ${line}`);
  return report.unfinished.length > 0 ? 1 : 0;
}
