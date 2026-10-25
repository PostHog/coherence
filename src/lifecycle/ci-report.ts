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
import { CLOSE_STEPS, currentGaps, gapsOf, readAndRecord, readGapBaseline, structureState, type Gap } from "../readings/scope/gaps.ts";
import { flowOf } from "../readings/scope/structure-flow.ts";
import { changedSince } from "../observation/observed.ts";
import { loadSpecModel, type SpecModel } from "../spec/model.ts";
import { CI_USAGE, REPORT_MARKER } from "./ci.ts";
import { mayHaveGaps } from "./hook.ts";

/** The spec gaps of one project, or why they are not known. */
export type GapsRead = { gaps: Gap[] } | { unread: string };

/** The files a pull request changed, relative to the project, or why they are not known. */
export type ChangedRead = { files: Set<string> } | { unread: string };

/** The changed files a read holds, or none when there is no read or it failed. */
function changedFiles(changed: ChangedRead | undefined): Set<string> {
  return changed !== undefined && "files" in changed ? changed.files : new Set();
}

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

const MARK = { fail: "✕", "not run": "○" } as const;

const CHANGED_HERE = " · 📍 **changed in this pull request**";

/** A section's bold heading with its icon and finding count, e.g. "**📄 Spec file errors (1)**". */
function heading(icon: string, name: string, count: number): string {
  return `**${icon} ${name} (${count})**`;
}

/** A section's bold label with its icon, ending in a colon, for a line that explains itself rather than counting findings. */
function label(icon: string, name: string): string {
  return `**${icon} ${name}:**`;
}

/** Text a familiar reader can skip, folded under a summary line; GitHub needs the blank lines to read Markdown inside it. */
function folded(summary: string, ...paragraphs: string[]): string[] {
  return ["<details>", `<summary>${summary}</summary>`, "", ...paragraphs.flatMap((paragraph) => [paragraph, ""]), "</details>", ""];
}

const HOW_TO_FIX = "What this means and how to fix it";

/** A blank line then a folded "what this means and how to fix it" explanation; the shape every findings section repeats. */
function howToFix(...paragraphs: string[]): string[] {
  return ["", ...folded(HOW_TO_FIX, ...paragraphs)];
}

/** A blank line then a folded explanation that only says what a finding means, with no fix to promise. */
function whatThisMeans(...paragraphs: string[]): string[] {
  return ["", ...folded("What this means", ...paragraphs)];
}

/** The route's stops beyond the entrance's own component, as a short plain clause, e.g. " It reaches: `store`."; empty when the route goes no further. */
/** Text as one Markdown code span whatever it holds: a fence longer than its longest run of backticks, padded where it starts or ends with one. */
function code(text: string): string {
  const flat = text.replace(/\r?\n/g, " ");
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

function routeReach(g: Gap): string {
  const rest = g.route.stops.filter((stop) => stop !== g.component);
  return rest.length === 0 ? "" : ` It reaches: ${code(rest.join(" -> "))}.`;
}

/** One project's section, and why its part did not finish. */
function projectSection(p: ProjectReport, session: string, showHeading: boolean): { lines: string[]; unfinished: string[]; touched: number } {
  const lines: string[] = [];
  const unfinished: string[] = [];
  let touched = 0;
  const changed = changedFiles(p.changed);
  const mark = (...files: (string | undefined)[]): string => {
    if (!files.some((f) => f !== undefined && changed.has(f))) return "";
    touched++;
    return CHANGED_HERE;
  };
  const where = p.name === "." ? "" : ` in ${p.name}`;
  if (showHeading) lines.push(`### ${cell(p.name)}`, "");

  if (p.model.problems.length > 0) {
    const runIn = p.name === "." ? "" : ` in ${code(p.name)}`;
    lines.push(heading("📄", "Spec file errors", p.model.problems.length), "");
    for (const problem of p.model.problems) lines.push(`- ${code(`${problem.file}:${problem.line}`)} ${cell(problem.message)}${mark(problem.file)}`);
    lines.push(...howToFix(`Coherence cannot read these lines in the spec files. Fix each line. Then run \`npx --no -- coherence spec --check\`${runIn} again.`));
  }

  const entries = chokepointEntries(p.runs);
  if (p.runs.length === 0) {
    unfinished.push(`no check run was recorded for session ${session}${where}`);
    lines.push(`${label("⛔", "Rules")} Coherence has no record of running its check (session ${code(session)})${where}, so it did not check the rules.`, "");
  } else {
    const fails = entries.filter((e) => e.verdict === "fail");
    const notRun = entries.filter((e) => e.verdict === "not run");
    if (fails.length > 0) {
      lines.push(heading("⛔", "Broken rules", fails.length), "");
      for (const e of fails) {
        lines.push(`- ${MARK.fail} ${code(bullet(e))}: ${cell(e.reason)}${mark(...e.files, ...e.bypasses.map((b) => b.file))}`);
        for (const b of e.bypasses.slice(0, BYPASSES)) lines.push(`  - used without the function at ${code(`${b.file}:${b.line}`)}, in ${cell(b.symbol)}`);
        if (e.bypasses.length > BYPASSES) lines.push(`  - and ${e.bypasses.length - BYPASSES} more. To see all of them, run \`npx --no -- coherence run --form chokepoint\`.`);
      }
      lines.push(...howToFix("Each of these rules says that some code or data must only be used through one function. The code above uses it without that function. Fix the code so it uses the function. If the rule is wrong, fix the rule in the spec."));
    }
    if (notRun.length > 0) {
      lines.push(heading("⏸️", "Rules Coherence could not check", notRun.length), "");
      for (const e of notRun) lines.push(`- ${MARK["not run"]} ${code(bullet(e))}: ${cell(e.reason)}`);
      lines.push("");
    }
    for (const e of notRun) unfinished.push(`rule ${bullet(e)}${where} was not checked: ${e.reason}`);
  }

  if ("unread" in p.gaps) {
    lines.push(`${label("🚪", "Unchecked inputs")} Coherence could not trace the code: ${cell(p.gaps.unread)}.`, "");
  } else {
    const open = p.gaps.gaps.filter((g) => !p.baselined.has(`${g.component}\u0000${g.name}`));
    const held = p.gaps.gaps.length - open.length;
    if (open.length > 0) {
      const older = held === 0 ? "" : held === 1 ? " 1 more place was already like this when Coherence was added. This list does not show it." : ` ${held} more places were already like this when Coherence was added. This list does not show them.`;
      lines.push(heading("🚪", "Unchecked inputs", open.length), "");
      for (const g of open) {
        const from = g.trust.length === 0 ? "The spec does not say where the input comes from." : `The input comes from: ${cell(g.trust.join(", "))}.`;
        lines.push(`- **${cell(g.name)}** in ${code(g.specPath)}. ${from}${routeReach(g)}${mark(g.file, g.specPath)}`);
      }
      lines.push(
        ...howToFix(
          `Input from outside this code comes in at these places. The spec does not say what checks that input.${older}`,
          "To close one of these, find the place by its name in the `## entrances` section of its spec file. Add one line under it:",
          CLOSE_STEPS.map((step) => `- ${step}`).join("\n"),
          'To get the line to add, run `npx --no -- coherence scaffold control "<name>"`.',
        ),
      );
    }
  }

  const failures = p.model.defects?.guardFailures ?? [];
  if (failures.length > 0) {
    lines.push(heading("🐛", "Bugs that came back", failures.length), "");
    for (const g of failures) lines.push(`- ${code(g.id)}: kind ${code(g.class)}. Guard: ${code(g.guard)}, added when ${code(g.resolution)} closed ${code(g.guardedBy)}.`);
    lines.push(...whatThisMeans("A guard is a rule that was added to stop one kind of bug. These bugs came back after their guard was added. Find out why the guard did not stop each one. Coherence cannot tell if this pull request caused them."));
  }
  return { lines, unfinished, touched };
}

/** How many bypass sites one verdict lists before it counts the rest. */
const BYPASSES = 5;

/** Where the report read changed files: each project, and the registry top when it has problems of its own. */
interface ChangedWhere {
  where: string;
  changed: ChangedRead | undefined;
}

/** The colour GitHub gives a quoted alert block: green, blue, purple, or yellow. */
type AlertKind = "TIP" | "NOTE" | "IMPORTANT" | "WARNING";

/** Sentences as one GitHub alert block, a quoted blank line between them. */
function alert(kind: AlertKind, sentences: readonly string[]): string[] {
  return [`> [!${kind}]`, ...sentences.flatMap((sentence, i) => (i === 0 ? [`> ${sentence}`] : [">", `> ${sentence}`])), ""];
}

/** Whether there is anything to fix, and which findings this pull request's own files hold, when the report knows them. */
function findingsLead(projects: readonly ProjectReport[], reads: readonly ChangedWhere[], findings: number, touched: number, unfinished: readonly string[]): string[] {
  if (findings === 0) {
    if (unfinished.length > 0 || projects.some((p) => "unread" in p.gaps)) return alert("WARNING", ["Coherence could not check everything. This list can be incomplete."]);
    return alert("TIP", ["Nothing to fix."]);
  }
  const changed = reads.filter((r) => r.changed !== undefined);
  if (changed.length === 0) return alert("NOTE", ["These findings do not make this check fail. Some findings can come from files that this pull request does not change."]);
  const sentences = ["These findings do not make this check fail."];
  const allRead = changed.every((r) => "files" in r.changed!);
  for (const r of changed) if ("unread" in r.changed!) sentences.push(`Coherence could not find the files that this pull request changes${r.where}: ${cell(r.changed.unread)}.`);
  if (changed.some((r) => "files" in r.changed!)) {
    if (touched === 0) sentences.push(allRead ? "None of these findings are in files that this pull request changes. You do not need to fix them in this pull request." : "None of the findings that Coherence could check are in files that this pull request changes.");
    else if (touched === 1) sentences.push("1 finding is in a file that this pull request changes. It has the mark 📍 **changed in this pull request**.");
    else sentences.push(`${touched} findings are in files that this pull request changes. They have the mark 📍 **changed in this pull request**.`);
  }
  return alert(touched > 0 ? "IMPORTANT" : "NOTE", sentences);
}

/** Whether a registry problem's file is one this pull request changed. */
function registryMark(problem: { file: string }, changed: ChangedRead | undefined): string {
  return changedFiles(changed).has(problem.file) ? CHANGED_HERE : "";
}

/** What Coherence is, in one place, for a reader who has not met it. */
const ABOUT = "Coherence compares the code with its spec files (`*.spec.md`). A spec file lists the rules for one part of the code.";

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
  const components = projects.reduce((n, p) => n + p.model.counts.components, 0);
  const rules = projects.reduce((n, p) => n + p.model.counts.bullets, 0);
  const checked = projects.reduce((n, p) => n + chokepointEntries(p.runs).length, 0);
  const passing = projects.reduce((n, p) => n + chokepointEntries(p.runs).filter((e) => e.verdict === "pass").length, 0);
  const read = `This check read ${plural(components, "part of the code", "parts of the code")} and ${plural(rules, "rule")}.`;
  const ran = checked === 0 ? "" : ` It checked ${plural(checked, "rule")}. ${plural(passing, "rule")} ${passing === 1 ? "passes" : "pass"}.`;
  const head = [REPORT_MARKER, "## Coherence", ""];
  head.push(
    `**📄 ${plural(problems, "spec file error")} · ⛔ ${plural(fails, "broken rule")} · 🚪 ${plural(gaps, "unchecked input")} · 🐛 ${plural(guards, "bug that came back", "bugs that came back")}**${projects.length > 1 ? ` in ${plural(projects.length, "project")}` : ""}`,
    "",
    ...folded("What is Coherence?", ABOUT, read + ran),
  );
  const reads: ChangedWhere[] = projects.map((p) => ({ where: p.name === "." ? "" : ` in ${cell(p.name)}`, changed: p.changed }));
  if (registry !== undefined && registry.problems.length > 0) reads.push({ where: " for the list of projects in `coherence.config.json`", changed: registry.changed });
  head.push(...findingsLead(projects, reads, problems + fails + gaps + guards, touched, unfinished));
  if (unfinished.length > 0) {
    head.push("> [!WARNING]", "> Coherence did not finish. This report is not complete, and the check fails:");
    for (const line of unfinished) head.push(`> - ${cell(line)}`);
    head.push("");
  }
  if (registry !== undefined && registry.problems.length > 0) {
    head.push(heading("⚙️", "Project list errors", registry.problems.length), "");
    registry.problems.forEach((problem, i) => head.push(`- ${code(problem.file)} ${cell(problem.message)}${registryMarks[i]}`));
    head.push("", ...folded(HOW_TO_FIX, "Coherence cannot read the list of projects in `coherence.config.json`. Fix each line above."));
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
