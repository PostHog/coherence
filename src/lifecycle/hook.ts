/**
 * The hook: what each harness event injects or answers.
 *
 * SessionStart and SubagentStart carry orient's first slice: any escalation
 * awaiting a human first (an escalation heads every read), then the compact
 * lexicon, then the session id as the exact --session value every journal
 * write must carry, a decide template, the journal read command, and a short
 * fixed instruction. Both hosts read it from
 * `hookSpecificOutput.additionalContext`.
 * Stop and SubagentStop run the lexicon check over the files changed in the
 * working tree. On Stop the findings are shown to the human and the session
 * ends. On SubagentStop a rejected name in a changed file, a spec problem, or
 * a structural defect refuses the stop: exit 2 with the reason on stderr,
 * which both hosts read as "continue, and here is why" (Claude Code:
 * https://code.claude.com/docs/en/hooks; Codex: https://learn.chatgpt.com/docs/hooks).
 * An unknown noun is a nomination, reported and never refused. A debt the
 * session has recorded as unable, naming the file, the name, or the
 * invariant, is advisory: the wall is on record and the reader decides.
 * A stop hook that is already active (`stop_hook_active`) never refuses again,
 * so a subagent cannot be held forever.
 * The Stop snapshot of the read trace reaches the instrument the same way the
 * run does, through enforcement's one door to the warm server, so a
 * production snapshot carries hops rather than a hop-less closure.
 * PostToolUse for a file-writing tool is revelation at the edit: the
 * chokepoint invariants that may involve the written file are re-checked
 * through the warm server, and a bypass is printed as additionalContext so
 * the agent sees the structural defect in the same turn, with the two
 * honest options. Stop and SubagentStop also carry the structural defects
 * the latest run left; one refuses a subagent stop.
 * The session's work order rides with orient and regulate: the start prints
 * the active order the session owns (objective, success, boundary) and the
 * rule that maintenance outside the boundary is not this session's to do;
 * the stop says the order is still active and how it is closed.
 * UserPromptSubmit and PostToolUse carry the peer feed: the subjects of what
 * other sessions recorded since this session's cursor, never full records.
 * The cursor advances only after the feed was handed to the host: runHook
 * renders and returns the advance as `commit`, and the command line calls it
 * once its stdout write has succeeded, never before.
 * Spec gaps (d-a1095ef2) ride with both: orient adds one bounded line when
 * entrances outside the adoption baseline carry untrusted work in with no
 * traced control, read from the last complete Structure reading while it
 * still describes the tree (gaps.ts); when it does not, from that reading
 * with the current spec, labeled as the reading before the latest changes,
 * after a bounded wait at a session start for a refresh of this tree that is
 * nearly done. A stop, and a session start that finds the reading stale,
 * starts one refresh in the background, never waited on there (df-84db9e4f). Regulate
 * names the gaps this session touched, advisory: no traced control is not a
 * demonstrated bypass, so a gap never refuses a stop. Undeclared entrances
 * ride with both too (undeclared.ts), detected now by a scan that needs no
 * reading: orient's one line counts them against what was detected and names
 * the folder holding the most with the scaffold command that proposes their
 * bullets; regulate names those in the files the session changed, advisory.
 * The root of every event is confined to the project the hook was installed
 * for: the harness names the working directory on stdin, and a cwd outside
 * that tree is refused with exit 78 rather than read or written.
 * The hook voice is the project's own text at each event (d-d884e343, in the
 * reference): `.coherence/hooks/<Event>.override.md` replaces what the event
 * would say, an empty one is a deliberate silence, and
 * `.coherence/hooks/<Event>.append.md` follows it; an event with nothing of
 * its own to say still speaks a declared file. A refusal is enforcement, so
 * no override reaches its reason; an append follows it. A file whose real
 * path leaves the project root is named as not read, never followed.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { failingRejected, formatReport, hasFindings, runCheck, type CheckReport } from "./check.ts";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import { mayTouch, performRun, withWarmAdapter } from "../enforcement/run.ts";
import { keepProjectFiles } from "../adapters/project-files.ts";
import { openFeed, peerFeed } from "../journal/feed.ts";
import { namedLine, openEscalations } from "../journal/read.ts";
import { recordReadTrace, snapshotTrace } from "../economy/trace.ts";
import { loadSpecModel, type SpecModel } from "../spec/model.ts";
import { loadJournal } from "../journal/store.ts";
import { citesOf, type AnyRecord, type Unable } from "../journal/record.ts";
import { loadOrders, loadWork, ownedIn, type WorkOrder } from "../journal/work.ts";
import { loadLexicon, rejectedNames, renderCompactWithin, type InjectionLevel, type Lexicon } from "./lexicon.ts";
import { COHERENCE_LEXICON, installedRoot, isCoherenceItself, loadProjectLexicons, within } from "./project.ts";

import { attentionText, lexiconCoverage, type Coverage } from "./lexicon-coverage.ts";
import { awaitRefresh, currentGaps, declaredThisSession, lastGaps, orientGapText, readGapBaseline, refreshInBackground, refreshUnderWay, regulateGapText, saveSessionGaps, sessionGaps, structureFingerprint, unreadGapText, type GapState } from "../readings/scope/gaps.ts";
import { loadSpec } from "../readings/scope/build.ts";
import { orientUndeclaredText, regulateUndeclaredText, undeclaredNow } from "../readings/scope/undeclared.ts";
import { baselinePath, coverageChanges, introducedCandidates, priorBaseline, saveBaseline } from "./lexicon-cli.ts";

const run = promisify(execFile);

export const HOOK_EVENTS = [
  "SessionStart",
  "SubagentStart",
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
  "SubagentStop",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(name: string): name is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(name);
}

/** The exit code both hosts read as a refusal with the reason on stderr. */
export const REFUSE_EXIT = 2;

/**
 * The exit code for an event whose cwd is not inside the project root this
 * hook was installed for (sysexits EX_CONFIG). Not the refusal code: the
 * agent is told nothing and held on nothing, because the event was not this
 * project's to answer.
 */
export const OUTSIDE_ROOT_EXIT = 78;

/**
 * The most characters a start injection may carry. Claude Code replaces hook
 * output over 10,000 characters with a file preview; Codex spills context over
 * a default 2,500-token threshold (about 10,000 characters at four per token).
 * The instruction rides inside this budget.
 */
export const CONTEXT_BUDGET = 9_500;

/** The rule in Coherence's own repository, where its rejected names are defects everywhere; with the session block above it the whole tail stays under 120 words. */
export const INSTRUCTION = [
  "Use these names. A rejected name in prose, a spec, a journal record, or an",
  "identifier is a defect: replace it. A new noun the lexicon lacks must be",
  "declared there as a concept, or mapped as an alias of an existing concept,",
  "before this session ends. Coherence's names describe the tool; the",
  "project's names describe its domain, and inside the project its sense wins.",
].join(" ");

/**
 * The rule in an adopter, matching what the check enforces there: Coherence's
 * rejected names cover only text that names Coherence's concepts, the
 * project's own rejected names are defects everywhere, and the check fails
 * only on findings newer than the adoption baseline. The example swap is drawn
 * from the lexicon, so Coherence's own source never spells a rejected name.
 */
export function adopterInstruction(example: { concept: string; rejected: string }): string {
  return [
    "Use Coherence's names when you mean its concepts in specs, journal records",
    `and the config: say ${example.concept}, not ${example.rejected}. Its rejected names cover only`,
    "that use; this project's own words and senses stand everywhere else. The",
    "project's rejected names are defects: replace them. Declare a new domain noun",
    "in the lexicon, or map it as an alias, before this session ends. The check",
    "fails only on findings newer than the adoption baseline.",
  ].join(" ");
}

/** The example the adopter rule shows: the invariant concept and its first one-word rejected name. */
export function adopterExample(coherence: Lexicon): { concept: string; rejected: string } {
  const found = rejectedNames(coherence).find((n) => n.concept === "invariant" && !n.name.includes(" "));
  return { concept: "invariant", rejected: found?.name ?? "another name" };
}

/** The agent name a journal write carries when the harness names none: the main thread. */
const MAIN_AGENT = "main";

export interface HookInput {
  cwd?: string;
  session_id?: string;
  agent_type?: string;
  stop_hook_active?: boolean;
  [key: string]: unknown;
}

export interface HookResult {
  stdout: string;
  stderr: string;
  exit: number;
  /**
   * The advance to make once `stdout` has reached the host: the feed cursor
   * moves past what the text covered. Present only when a feed was rendered;
   * the caller that prints is the one that commits, after its write succeeded.
   */
  commit?: () => void;
}

export interface ChangedFiles {
  /** Modified against HEAD plus untracked; empty when git could not answer. */
  files: string[];
  /** Why git could not answer, when it could not: the command and git's own reason. Absent when it answered. */
  failure?: string;
}

/** The most bytes one git listing may carry before it is a failure worth reporting rather than a truncated answer. */
const GIT_LISTING_LIMIT = 64 * 1024 * 1024;

/**
 * Files changed in the working tree at `root`: modified against HEAD plus
 * untracked. Outside a repository the answer is no files, since there is no
 * tree to be clean or dirty; any other failure is reported, never read as a
 * clean tree.
 */
export async function changedFiles(root: string): Promise<ChangedFiles> {
  const listings: string[] = [];
  for (const args of [["diff", "--name-only", "HEAD"], ["ls-files", "--others", "--exclude-standard"]]) {
    try {
      listings.push((await run("git", args, { cwd: root, maxBuffer: GIT_LISTING_LIMIT })).stdout);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (/not a git repository/i.test(raw)) return { files: [] };
      const reason = raw.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("Command failed")) ?? raw;
      return { files: [], failure: `git ${args.join(" ")} failed: ${reason}` };
    }
  }
  const all = [...new Set(listings.join("\n").split("\n").map((l) => l.trim()).filter((l) => l !== ""))];
  // Only the project's own files (a nested repository lists as one folder entry, never the project's); a deletion stays.
  const own = keepProjectFiles(root, all);
  return { files: all.filter((f) => own.has(f) || !existsSync(resolve(root, f))) };
}

/**
 * Escalations no human has acknowledged, under a heading, or nothing. Never
 * shortened: a human must see them whole. Each record an escalation cites
 * (a decision, a work order, any record) is named beneath it by id, kind
 * and subject, so the human sees what the question is about.
 */
export function escalationBlock(root: string): string {
  const journal = loadJournal(root).records;
  const open = openEscalations(journal);
  if (open.length === 0) return "";
  const cited = open.some((e) => citesOf(e).length > 0);
  const byId = new Map<string, AnyRecord>(cited ? [...journal, ...loadWork(root).records].map((record) => [record.id, record]) : []);
  const lines = [`Escalations awaiting a human (${open.length}); answer one with: acknowledge <id> --because "<what the human decided>"`];
  for (const e of open) {
    lines.push(`▲ ${e.id}  ${e.agent}  ${e.what} — ${e.because}`);
    if (e.human !== undefined) lines.push(`  human (as the agent attributes): ${e.human}`);
    for (const id of citesOf(e)) {
      const record = byId.get(id);
      lines.push(`  about ${record === undefined ? `${id} (not found)` : namedLine(record)}`);
    }
  }
  return lines.join("\n") + "\n\n";
}

function sessionOf(input: HookInput): string | undefined {
  const child = [input.agent_id, input.agentId].find((id): id is string => typeof id === "string" && id !== "");
  if(child) return child;
  // Native child events without a child id cannot honestly charge the parent's session.
  if(typeof input.hook_event_name === "string" && input.hook_event_name.startsWith("Subagent")) return undefined;
  return typeof input.session_id === "string" && input.session_id !== "" ? input.session_id : undefined;
}

function agentOf(input: HookInput): string {
  return typeof input.agent_type === "string" && input.agent_type !== "" ? input.agent_type : MAIN_AGENT;
}

/** The walls this session recorded as unable: a debt one of them names is advisory at the stop, never refused. */
function unableWalls(root: string, input: HookInput): Unable[] {
  const session = sessionOf(input);
  if (session === undefined) return [];
  return loadJournal(root).records.filter((r): r is Unable => r.kind === "unable" && r.session === session);
}

/** The unable record whose text names one of the keys, when one does: the wall that stands between the session and this debt. */
function excusedBy(walls: readonly Unable[], keys: readonly string[]): Unable | undefined {
  const wanted = keys.map((k) => k.toLowerCase()).filter((k) => k !== "");
  return walls.find((wall) => {
    const text = `${wall.what}\n${wall.because}`.toLowerCase();
    return wanted.some((k) => text.includes(k));
  });
}

const ADVISORY = (wall: Unable): string => `advisory: recorded unable ${wall.id} (${wall.what})`;

/** The rule an owning session reads at orient. */
export const BOUNDARY_RULE = "Maintenance outside the boundary is not this session's to do: record it (unable, defect, conjecture) and leave it.";

function orderLines(order: WorkOrder): string[] {
  return [`  objective: ${order.objective}`, `  success:   ${order.success}`, `  boundary:  ${order.boundary}`];
}

/** The work orders the session owns, for orient: the active one it binds to, or why nothing binds, and an open one it has not taken up. */
export function workBlock(root: string, input: HookInput): string {
  const session = sessionOf(input);
  if (session === undefined) return "";
  const orders = loadOrders(root);
  const active = ownedIn(orders, session, "active");
  const open = ownedIn(orders, session, "open");
  if (active.length === 0 && open.length === 0) return "";
  const agent = agentOf(input);
  const lines: string[] = [];
  if (active.length === 1) {
    const order = active[0]!;
    lines.push(`Work order ${order.id} (active; every journal write and run this session makes binds to it):`, ...orderLines(order), `  ${BOUNDARY_RULE}`);
  } else if (active.length > 1) {
    lines.push(`This session owns ${active.length} active work orders, so nothing binds by inference; pass --work <id> on each write:`);
    for (const order of active) lines.push(`  ${order.id}  ${order.objective}`);
    lines.push(`  ${BOUNDARY_RULE}`);
  }
  for (const order of open) {
    lines.push(`Work order ${order.id} is open, not active; nothing binds to it until: work move ${order.id} active --because "<taking it up>" --session ${session} --agent ${agent}`, ...orderLines(order));
  }
  return lines.join("\n") + "\n\n";
}

/** What regulate says about an order still active at the stop: it is closed with work close, and nothing else closes it. */
export function workStopText(root: string, input: HookInput): string {
  const session = sessionOf(input);
  if (session === undefined) return "";
  const active = ownedIn(loadOrders(root), session, "active");
  if (active.length === 0) return "";
  const agent = agentOf(input);
  return active
    .map((order) => `Work order ${order.id} is still active (${order.objective}). When its success criterion holds, close it: work close ${order.id} --because "<what was done>" --session ${session} --agent ${agent}`)
    .join("\n");
}

/**
 * This checkout's cli: the one the hook is running from, wherever the adopter
 * keeps it, by the path it was invoked through when that is this file (a
 * sibling reached through a link reads as ../coherence, not as the link's
 * target).
 */
const OWN_CLI = ((): string => {
  // Compiled, this module is .js and so is the cli beside it.
  const own = fileURLToPath(new URL(`../cli${extname(fileURLToPath(import.meta.url))}`, import.meta.url));
  const invoked = process.argv[1];
  try {
    if (invoked !== undefined && realpathSync(invoked) === realpathSync(own)) return resolve(invoked);
  } catch {
    // An invocation path that cannot be resolved is not used.
  }
  return own;
})();

/**
 * How a session at this root invokes the tool: its own source tree, or the
 * checkout this hook ran from, as a path from the root (`node
 * ../coherence/src/cli.ts`) or, when that climbs further than a sibling of a
 * worktree's main checkout, absolute. It is never a path into the project's
 * node_modules, which a pnpm-safe install leaves alone.
 */
export async function cliName(root: string, cli: string = OWN_CLI): Promise<string> {
  if (await isCoherenceItself(root)) return "node src/cli.ts";
  // Both sides are compared as real paths, except the checkout's own folder, which keeps the name it was reached by.
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const checkout = dirname(dirname(cli));
  const rel = relative(real(root), join(real(dirname(checkout)), basename(checkout), relative(checkout, cli)));
  const path = rel.split(sep).filter((part) => part === "..").length <= 4 ? rel : cli;
  return `node ${/[\s"'$`\\]/.test(path) ? JSON.stringify(path) : path}`;
}

/** The session id as the exact --session value, write and read commands, and the rule. */
export async function sessionBlock(root: string, input: HookInput): Promise<string> {
  const session = sessionOf(input);
  const agent = agentOf(input);
  const cli = await cliName(root);
  const id = session ?? "<the id your harness shows>";
  return [
    `Session: ${session ?? "unknown"}`,
    `Every journal write needs --session ${id} --agent ${agent}. Record a choice as:`,
    `  ${cli} decide "<chose>" --over "<rejected>" --because "<why>" --session ${id} --agent ${agent}`,
    "Read the project journal from the project root:",
    `  ${cli} journal`,
    (await isCoherenceItself(root)) ? INSTRUCTION : adopterInstruction(adopterExample(await loadLexicon(COHERENCE_LEXICON))),
  ].join("\n") + "\n";
}

const OPEN_REQUIREMENT_LINES = 12;

function specModelOrNull(root: string): SpecModel | { error: string } {
  try {
    return loadSpecModel(root);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Requirements still short of invariant, and grammar problems, for orient. */
export function specBlock(root: string): string {
  const model = specModelOrNull(root);
  if ("error" in model) return `Spec: not readable (${model.error})\n\n`;
  if (model.components.length === 0) return "";
  const open = model.components.flatMap((c) => c.invariants.filter((i) => i.state === "requirement").map((i) => ({ c, i })));
  const lines: string[] = [];
  if (model.problems.length > 0) lines.push(`Spec problems (${model.problems.length}); run: spec --check`);
  if (open.length > 0) {
    lines.push(`Open requirements (${open.length} of ${model.counts.bullets} bullets). A requirement becomes an invariant when it has enforcement, a witnessed refutation, and its checklist; scaffold prints the shape.`);
    for (const { c, i } of open.slice(0, OPEN_REQUIREMENT_LINES)) lines.push(`○ ${c.folder}/${i.name} — lacks: ${i.lacks.join(", ")}`);
    if (open.length > OPEN_REQUIREMENT_LINES) lines.push(`  and ${open.length - OPEN_REQUIREMENT_LINES} more; run: spec --check`);
  }
  return lines.length === 0 ? "" : lines.join("\n") + "\n\n";
}

export interface SpecDebt {
  text: string;
  problems: number;
  defects: number;
  /** Problems and structural defects no unable record of the session names: what a subagent stop is refused for. */
  owed: number;
}

/**
 * What the spec owes at stop: problems and structural defects refuse a
 * subagent stop, unless the session recorded unable naming the spec file or
 * the invariant, which makes that item advisory; open requirements are shown
 * and left to the human.
 */
export function specStopText(root: string, changed: readonly string[] = [], walls: readonly Unable[] = []): SpecDebt {
  const model = specModelOrNull(root);
  if ("error" in model) return { text: `Spec: not readable (${model.error})`, problems: 0, defects: 0, owed: 0 };
  if (model.components.length === 0) return { text: "", problems: 0, defects: 0, owed: 0 };
  const touched = new Set(changed.map((p) => p.split(sep).join("/")));
  const open = model.components.flatMap((c) => c.invariants.filter((i) => i.state === "requirement").map((i) => ({ c, i })));
  const broken = model.components.flatMap((c) => c.invariants.filter((i) => i.state === "structural defect").map((i) => ({ c, i })));
  const mine = open.filter(({ c }) => touched.has(c.specPath));
  const lines: string[] = [];
  let owed = 0;
  for (const p of model.problems) {
    const wall = excusedBy(walls, [p.file]);
    if (wall === undefined) owed += 1;
    lines.push(`PROBLEM  ${p.file}:${p.line}  ${p.message}${wall === undefined ? "" : `\n         ${ADVISORY(wall)}`}`);
  }
  for (const { c, i } of broken) {
    const wall = excusedBy(walls, [`${c.folder}/${i.name}`, i.name]);
    if (wall === undefined) owed += 1;
    for (const d of i.defects) lines.push(`✕ ${c.folder}/${i.name} — structural defect (${d.form}, run ${d.at.slice(0, 10)}): ${d.reason}${wall === undefined ? "" : `\n  ${ADVISORY(wall)}`}`);
  }
  if (broken.length > 0) lines.push(`A structural defect stands until the reference is routed through the chokepoint or a human acknowledges a retirement (escalate, then acknowledge).`);
  for (const { c, i } of mine.slice(0, OPEN_REQUIREMENT_LINES)) lines.push(`○ ${c.folder}/${i.name} — still a requirement; lacks: ${i.lacks.join(", ")}`);
  if (mine.length > OPEN_REQUIREMENT_LINES) lines.push(`  and ${mine.length - OPEN_REQUIREMENT_LINES} more in specs this session changed`);
  if (open.length > 0) lines.push(`${open.length} requirement${open.length === 1 ? "" : "s"} open in the project${mine.length > 0 ? `, ${mine.length} in specs this session changed` : ""}; run: spec --check`);
  return { text: lines.join("\n"), problems: model.problems.length, defects: broken.length, owed };
}

/**
 * The lexicon check over the changed files at stop, as text, and what of it
 * is owed: a rejected name refuses a subagent stop unless the session
 * recorded unable naming the file or the name; an unknown noun is a
 * nomination the tool cannot prove, so it is reported and never refused.
 */
export function lexiconStopText(report: CheckReport | undefined, walls: readonly Unable[] = []): { text: string; owed: number } {
  if (report === undefined || !hasFindings(report)) return { text: "", owed: 0 };
  const lines = formatReport(report).trimEnd().split("\n");
  const failing = failingRejected(report);
  let owed = 0;
  const out: string[] = [];
  let next = 0;
  for (const line of lines) {
    out.push(line);
    if (!line.startsWith("REJECTED NAME")) continue;
    const finding = failing[next];
    next += 1;
    if (finding === undefined) continue;
    const wall = excusedBy(walls, [finding.file, finding.name]);
    if (wall === undefined) owed += 1;
    else out.push(`               ${ADVISORY(wall)}`);
  }
  return { text: out.join("\n") + "\n", owed };
}

/** Tools that read a file and name it the same way a writing tool does. */
const READING_TOOLS: ReadonlySet<string> = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "read_file", "list_files", "search"]);

/** The project-relative path a tool event wrote, or undefined when the event wrote no file under the root. */
export function writtenFiles(root: string, input: HookInput): string[] {
  if (typeof input.tool_name === "string" && READING_TOOLS.has(input.tool_name)) return [];
  const record = typeof input.tool_input === "object" && input.tool_input !== null ? input.tool_input as Record<string,unknown> : {};
  const paths = [record["file_path"],record["notebook_path"],record["path"]].filter((v):v is string=>typeof v === "string" && v !== "");
  if(typeof input.tool_name === "string" && input.tool_name.split(".").at(-1)==="apply_patch") {
    const patch=typeof input.tool_input === "string" ? input.tool_input : [record["patch"],record["input"],record["command"]].find((v):v is string=>typeof v === "string");
    if(patch?.trimStart().startsWith("*** Begin Patch") && patch.trimEnd().endsWith("*** End Patch")) {
      for(const match of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) paths.push(match[1]!.trim());
    }
  }
  return [...new Set(paths.flatMap(path=> {
    const absolute=resolve(root,path);
    if(!within(root,absolute)) return [];
    const rel=relative(resolve(root),absolute).split(sep).join("/");
    return rel && rel!==".." && !rel.startsWith("../") ? [rel] : [];
  }))];
}

/** Compatibility for a caller asking about one ordinary edit; patch-aware callers use every path. */
export function writtenFile(root: string, input: HookInput): string | undefined {
  return writtenFiles(root,input)[0];
}

/**
 * Revelation at the edit: re-check the chokepoint invariants the written file
 * may involve and describe any structural defect, or nothing.
 */
export async function editContext(root: string, input: HookInput, options: HookOptions = {}): Promise<string> {
  // Only the project's own files are evidence: an edit in a nested checkout (an agent's worktree under the root) or to an
  // ignored file is not an edit to this project, and re-checking it would load that checkout into this project's instrument.
  const written = writtenFiles(root, input);
  const own = keepProjectFiles(root, written);
  const files = written.filter((file) => own.has(file));
  if (files.length === 0) return "";
  const model = specModelOrNull(root);
  if ("error" in model || model.components.length === 0) return "";
  const touched = model.components.flatMap((c) => c.invariants.filter((i) => i.enforcements.some((e) => e.form === "chokepoint") && files.some(file=> {
    const absolute=resolve(root,file);
    return mayTouch(i,file,existsSync(absolute) ? readFileSync(absolute,"utf8") : undefined);
  })).map((i) => i.name));
  if (touched.length === 0) return "";
  const session = sessionOf(input) ?? "unknown-session";
  const agent = agentOf(input);
  const outcome = await performRun(root, { session, agent, form: "chokepoint", invariants: touched, model, adapter: options.adapter, refresh: files });
  if (outcome.instrumentReason !== undefined) return `Coherence could not check ${touched.length} chokepoint invariant${touched.length === 1 ? "" : "s"} at this edit: ${outcome.instrumentReason}\n`;
  const failed = outcome.details.filter((d) => d.entry.verdict === "fail");
  if (failed.length === 0) return "";
  const cli = await cliName(root);
  const lines = [`Structural defect revealed at this edit (${files.join(", ")}); recorded in ${outcome.file ?? "the run"}:`];
  for (const d of failed) {
    const e = d.entry;
    const here = e.bypasses.filter((b) => files.includes(b.file));
    const elsewhere = e.bypasses.length - here.length;
    lines.push(`✕ ${e.component}/${e.name} — chokepoint ${d.chokepoint?.input.chokepoint ?? ""} protects ${d.chokepoint?.input.protects ?? ""}: ${e.grade ?? "broken"}`);
    for (const b of here) lines.push(`    bypass ${b.file}:${b.line} in ${b.symbol} (this edit)`);
    if (elsewhere > 0) lines.push(`    ${elsewhere} bypass${elsewhere === 1 ? "" : "es"} elsewhere: ${e.bypasses.filter((b) => !files.includes(b.file)).map((b) => `${b.file}:${b.line} in ${b.symbol}`).join(", ")}`);
    if (e.bypasses.length === 0) lines.push(`    ${e.reason}`);
  }
  lines.push("Two honest options: route the reference through the chokepoint, or escalate a retirement for a human, who must acknowledge it:");
  lines.push(`  ${cli} escalate "retire <invariant>" --because "<what changed and why the chokepoint no longer holds>" --session ${session} --agent ${agent}`);
  lines.push("The invariant stays in force, and alarming, until a person acknowledges.");
  return lines.join("\n") + "\n";
}

/**
 * What orient knows of the spec gaps: the gaps now, when the recorded reading
 * still describes the tree, and the fingerprint it was checked against; when
 * it does not, the gaps as the last reading had them with the current spec
 * (`last`, undefined when none was ever kept) and whether a refresh is under way.
 */
export interface GapReading {
  fingerprint: string | undefined;
  now: (GapState & { at: string }) | undefined;
  last?: (GapState & { at: string }) | undefined;
  refreshing?: boolean;
}

/**
 * The longest a session start waits for a refresh of this very tree that the
 * last reading's duration says is nearly done: well inside the 60 s hook
 * timeout with the rest of the start's work (df-84db9e4f).
 */
export const START_WAIT_MS = 15_000;

/**
 * Whether any declared entrance could be a gap: one that declares no
 * control: none and carries untrusted work in, its trust unknown (undeclared,
 * which a crossing may still derive) or a level outside the system's control
 * or declared nowhere. Without one, no reading is worth starting.
 */
function mayHaveGaps(root: string): boolean {
  const model = specModelOrNull(root);
  if ("error" in model) return false;
  const trusted = new Set(model.trustLevels.filter((l) => !l.outside).map((l) => l.name));
  return model.components.some((c) => c.entrances.some((e) => e.noControl === undefined && (e.trust === undefined || !trusted.has(e.trust))));
}

/**
 * The gaps as orient reads them: `now` from a reading that still describes
 * the tree; else `last`, the last reading's gaps with the current spec, less
 * those it visibly closes. Cheap: a content fingerprint and a parse. With
 * `waitMs`, a stale reading first waits that long at most for a refresh of
 * this tree the last reading's duration says is nearly done.
 */
export async function gapReading(root: string, options: { waitMs?: number } = {}): Promise<GapReading> {
  if (!mayHaveGaps(root)) return { fingerprint: undefined, now: undefined };
  try {
    const fingerprint = structureFingerprint(root);
    const now = currentGaps(root, fingerprint) ?? (options.waitMs ? await awaitRefresh(root, fingerprint, options.waitMs) : undefined);
    if (now !== undefined) return { fingerprint, now };
    return { fingerprint, now: undefined, last: lastGaps(root), refreshing: refreshUnderWay(root) !== undefined };
  } catch {
    return { fingerprint: undefined, now: undefined };
  }
}

/**
 * Orient's gap line under the spec block, and the entrance coverage line
 * beneath it, or nothing. The coverage line is detected now (undeclared.ts),
 * so it needs neither a reading nor an entrance that could be a gap.
 */
export async function gapBlock(root: string, reading?: GapReading): Promise<string> {
  const gaps = reading ?? (await gapReading(root));
  const cli = await cliName(root);
  let text = "";
  if (gaps.fingerprint === undefined) text = "";
  else if (gaps.now !== undefined) text = orientGapText(gaps.now, readGapBaseline(root), cli);
  else if (gaps.last !== undefined) text = orientGapText(gaps.last, readGapBaseline(root), cli, { at: gaps.last.at, refreshing: gaps.refreshing === true });
  else text = unreadGapText(cli, gaps.refreshing === true);
  // What the gap count speaks for: one line, the busiest folder of undeclared entrances and the command that proposes them.
  const coverage = orientUndeclaredText(undeclaredNow(root), cli);
  const lines = [text, coverage].filter((line) => line !== "");
  return lines.length === 0 ? "" : `${lines.join("\n")}\n\n`;
}

/**
 * The start injection: escalations (never shortened), what the spec and the
 * work orders owe, the vocabulary at the richest level that leaves the whole
 * under the budget, and the session block. When the escalations alone crowd
 * the budget, the vocabulary steps down to names and then to one line that
 * points at the lexicon command.
 */
export async function startContext(root: string, input: HookInput = {}, report?: Coverage): Promise<string> {
  return (await startReading(root, input, report)).text;
}

/** The start injection with the level the vocabulary was delivered at, so a reading of the hook can say what orient carries. */
export async function startReading(root: string, input: HookInput = {}, report?: Coverage, gaps?: GapReading): Promise<{ text: string; detail: InjectionLevel; coverage: Coverage }> {
  const { coherence, project } = await loadProjectLexicons(root);
  const head = escalationBlock(root) + specBlock(root) + (await gapBlock(root, gaps)) + workBlock(root, input);
  const reading=report ?? await lexiconCoverage(root);
  const commands=await cliName(root);
  // The ranked short list, or nothing: a total nobody can act on trains a reader to skip the line.
  const signal=attentionText(reading, commands);
  const coverage=signal ? `\n${signal}\n` : "";
  const tail = coverage + `\n${await sessionBlock(root, input)}`;
  const { text, detail } = renderCompactWithin(coherence, project, CONTEXT_BUDGET - head.length - tail.length, await cliName(root), await isCoherenceItself(root));
  return { text: head + text + tail, detail, coverage: reading };
}

/**
 * The vocabulary line at an edit: only what this edit introduced, named. A
 * term that newly recurs without a definition, or a use whose sense is now at
 * risk; an ordinary edit that uses a known word says nothing.
 */
async function vocabularyAtEdit(root: string, changes: ReturnType<typeof coverageChanges>): Promise<string> {
  const cli = await cliName(root);
  const fresh = changes.filter((c) => c.state === "unresolved").slice(0, 5);
  const risky = changes.filter((c) => c.state !== "unresolved").slice(0, 3);
  const lines: string[] = [];
  if (fresh.length) lines.push(`Lexicon: this edit made ${fresh.map((c) => `"${c.term}"`).join(", ")} recur without a definition; declare it (${cli} lexicon propose declare <term> --definition "<text>" --because "<why>") or map it as an alias of an existing concept.`);
  if (risky.length) lines.push(`Lexicon: sense at risk at this edit: ${risky.map((c) => `${c.term} in ${c.component} (${c.reason.replace(/^sense at risk: /, "")})`).join("; ")}; check it against the definition: ${cli} lexicon review <term>.`);
  return lines.join("\n") + "\n";
}

/** Regulate's vocabulary line: the undefined terms this session introduced and the risks no edit has shown yet, named; nothing otherwise. */
async function vocabularyAtStop(root: string, reading: Coverage, prior: Record<string, string>): Promise<string> {
  const cli = await cliName(root);
  const introduced = introducedCandidates(reading, prior).slice(0, 5);
  const risky = coverageChanges(reading, prior).filter((c) => c.state !== "unresolved").slice(0, 3);
  const lines: string[] = [];
  if (introduced.length) lines.push(`Lexicon: this session left ${introduced.map((t) => `"${t}"`).join(", ")} recurring without a definition; declare or map each (${cli} lexicon propose declare <term> ...).`);
  if (risky.length) lines.push(`Lexicon: sense at risk: ${risky.map((c) => `${c.term} in ${c.component} (${c.reason.replace(/^sense at risk: /, "")})`).join("; ")}; ${cli} lexicon review <term>.`);
  return lines.join("\n");
}

/** The feed for a boundary event: the text to inject and the advance to commit once it is in the host's hands. */
export function feedContext(root: string, input: HookInput): { text: string; commit: () => void } {
  const session = sessionOf(input);
  if (session === undefined) return { text: "", commit: () => {} };
  return peerFeed(root, session);
}

async function checkChanged(root: string, paths: readonly string[]): Promise<CheckReport | undefined> {
  if (paths.length === 0) return undefined;
  const { coherence, project } = await loadProjectLexicons(root);
  return runCheck({ root, paths: [...paths], coherence, project });
}

/**
 * The one door to the warm instrument, as enforcement exports it. The hook
 * holds it as a value so a test can stand a fake in its place; production
 * never passes one and gets the real door.
 */
export type WarmDoor = typeof withWarmAdapter;

export const WARM_DOOR: WarmDoor = withWarmAdapter;

export interface HookOptions {
  /** An adapter to check with instead of the warm server (tests). */
  adapter?: LanguageAdapter | undefined;
  /**
   * Start a Structure reading in the background when the recorded one is
   * stale or absent. The command line passes STRUCTURE_REFRESH; absent (a
   * test), nothing is started.
   */
  refresh?: ((root: string, fingerprint: string) => void) | undefined;
  /** The door to the warm instrument; enforcement's own by default. */
  door?: WarmDoor | undefined;
  /** How long a session start may wait for a nearly done refresh; START_WAIT_MS by default. */
  startWaitMs?: number | undefined;
}

/**
 * At a session's stop, start one reading of the tree it leaves when the
 * recorded one no longer describes it, so the next session starts on a fresh
 * one (df-84db9e4f). Detached and never waited on: the stop returns at once.
 * Only the session's own stop: a subagent stops while its session still
 * edits, and each stop would supersede the last one's reading.
 */
export function refreshAtStop(root: string, options: HookOptions): void {
  if (options.refresh === undefined || !mayHaveGaps(root)) return;
  try {
    const fingerprint = structureFingerprint(root);
    if (currentGaps(root, fingerprint) === undefined) options.refresh(root, fingerprint);
  } catch {
    // A refresh that cannot start only means the next session reads the last reading, labeled.
  }
}

/**
 * The read-trace snapshot at a stop, with an instrument. A test hands its own
 * adapter in; production has none of its own, so the snapshot goes through
 * enforcement's one door to the warm server and the closure it predicts is
 * computed through references rather than skipped. A door that cannot connect
 * hands back its reason, which the snapshot records as the instrument it had.
 */
async function snapshotAtStop(root: string, session: string, changed: readonly string[], options: HookOptions): Promise<void> {
  if (options.adapter !== undefined) {
    await snapshotTrace(root, session, { adapter: options.adapter, changed });
    return;
  }
  const door = options.door ?? WARM_DOOR;
  await door(root, (adapter, server, reason) => snapshotTrace(root, session, { adapter, server, instrumentReason: reason, changed }));
}

/** The refresh the command line starts: this checkout's query structure, which records the reading it takes. */
export const STRUCTURE_REFRESH = (root: string, fingerprint: string): void => {
  refreshInBackground(root, [process.execPath, OWN_CLI, "query", "structure"], fingerprint);
};

/** Regulate's gap lines: the gaps this session touched, advisory, or nothing. */
export async function gapStopText(root: string, input: HookInput, changed: readonly string[]): Promise<string> {
  if (changed.length === 0 || !mayHaveGaps(root)) return "";
  try {
    const session = sessionOf(input);
    const now = currentGaps(root);
    const start = session === undefined ? undefined : sessionGaps(root, session);
    const spec = loadSpec(root);
    const declared = declaredThisSession(root, changed, spec);
    return regulateGapText({ changed, now, start, declared, spec, cli: await cliName(root) });
  } catch {
    return "";
  }
}

/** Regulate's coverage lines: the undeclared entrances in the files this session changed, advisory, or nothing. */
export async function undeclaredStopText(root: string, changed: readonly string[]): Promise<string> {
  if (changed.length === 0) return "";
  return regulateUndeclaredText(changed, undeclaredNow(root), await cliName(root));
}

/** Where a project keeps its hook voice: `<Event>.override.md` and `<Event>.append.md` under the root. */
export const HOOK_VOICE_DIR = join(".coherence", "hooks");

/** What a project declared for one event. */
export interface HookVoice {
  /** The text in place of what the event would say; "" is a deliberate silence. Absent when none is declared. */
  override?: string;
  /** The text that follows what the event says, or follows the override. */
  append?: string;
  /** A declared file that was not read, and why: outside the root, or unreadable. */
  problems: string[];
}

/** One declared file, trimmed, read where it really is and only when that is inside the root; undefined when absent. */
function voiceFile(root: string, event: HookEvent, kind: "override" | "append", problems: string[]): string | undefined {
  const name = join(HOOK_VOICE_DIR, `${event}.${kind}.md`);
  const path = join(root, name);
  if (!existsSync(path)) return undefined;
  try {
    // A link, of the file or of a folder above it, is followed only to see where it leads; a file outside the project is not read.
    const real = realpathSync(path);
    if (!within(root, real)) {
      problems.push(`${name} leads outside the project root; not read`);
      return undefined;
    }
    return readFileSync(real, "utf8").trim();
  } catch (error) {
    // A torn file costs the project its text for this event, never the session.
    problems.push(`${name} not read: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** The project's hook voice for one event: two stat calls when nothing is declared. */
export function readHookVoice(root: string, event: HookEvent): HookVoice {
  const problems: string[] = [];
  const override = voiceFile(root, event, "override", problems);
  const append = voiceFile(root, event, "append", problems);
  return { ...(override === undefined ? {} : { override }), ...(append === undefined ? {} : { append }), problems };
}

/** The values a voice file may name as {{session}}, {{agent}} and {{cli}}. */
export interface VoiceTokens {
  session?: string | undefined;
  agent?: string | undefined;
  cli?: string | undefined;
}

/**
 * The override in place of the canonical text, or the canonical text, then
 * the append, then a line for each declared file that was not read. Only the
 * three tokens are substituted, and only when a value was supplied: an
 * unsupplied one stays literal so the reader sees it was never filled.
 */
export function composeVoice(canonical: string, voice: HookVoice, tokens: VoiceTokens): string {
  const fill = (text: string): string => text.replace(/\{\{(session|agent|cli)\}\}/g, (whole, key: keyof VoiceTokens) => tokens[key] ?? whole);
  const base = voice.override === undefined ? canonical : fill(voice.override);
  const append = voice.append === undefined ? "" : fill(voice.append);
  const problems = voice.problems.map((p) => `Hook voice: ${p}`).join("\n");
  return [base, append, problems].filter((part) => part !== "").join("\n\n");
}

/** The canonical text with the project's voice over it; the canonical text alone, unchanged, when nothing is declared. */
async function voiced(root: string, input: HookInput, canonical: string, voice: HookVoice): Promise<string> {
  if (voice.override === undefined && voice.append === undefined && voice.problems.length === 0) return canonical;
  return composeVoice(canonical, voice, { session: sessionOf(input), agent: agentOf(input), cli: await cliName(root) });
}

/** Run one event. `input` is the parsed stdin the host sent; `root` defaults to its cwd. */
export async function runHook(event: HookEvent, input: HookInput, fallbackRoot: string, options: HookOptions = {}): Promise<HookResult> {
  const project = installedRoot(fallbackRoot);
  const given = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : fallbackRoot;
  // The cwd arrives on stdin from the harness; a tree that is not the one this hook was installed for is none of its business.
  if (project !== undefined && !within(project, given)) {
    return { stdout: "", stderr: `hook ${event}: the working directory "${given}" is not inside the project root this hook was installed for (${project}); nothing was read and nothing was written\n`, exit: OUTSIDE_ROOT_EXIT };
  }
  const root = project ?? given;
  const voice = readHookVoice(root, event);
  switch (event) {
    case "SessionStart":
    case "SubagentStart": {
      const reading=await lexiconCoverage(root);
      // Only a session start waits, and only for a refresh of this tree that is nearly done; a subagent starts at once.
      let gaps = await gapReading(root, event === "SessionStart" ? { waitMs: options.startWaitMs ?? START_WAIT_MS } : {});
      // A stale or absent reading starts one in the background (a no-op while one of this tree runs), then orient reads the last one, labeled.
      // Only a session start: a subagent inherits the session's reading, and one refresh per tree is enough.
      if (event === "SessionStart" && gaps.now === undefined && gaps.fingerprint !== undefined) {
        options.refresh?.(root, gaps.fingerprint);
        gaps = { ...gaps, refreshing: refreshUnderWay(root) !== undefined };
      }
      const context = await voiced(root, input, (await startReading(root, input, reading, gaps)).text, voice);
      const session = sessionOf(input);
      if (session !== undefined) openFeed(root, session);
      // An empty override silences the start; the session still began, so its baseline is still kept.
      const stdout = context === "" ? "" : JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }) + "\n";
      const commit = (): void => {
        saveBaseline(root, session!, reading);
        // The gaps as this session found them, for regulate once its own edits make the reading stale.
        const found = gaps.now ?? gaps.last;
        if (found !== undefined) saveSessionGaps(root, session!, found);
      };
      return { stdout, stderr: "", exit: 0, ...(session ? { commit } : {}) };
    }
    case "UserPromptSubmit":
    case "PostToolUse": {
      const feed = feedContext(root, input);
      const session=sessionOf(input);
      if (event === "PostToolUse" && session) recordReadTrace(root, session, input);
      const edit = event === "PostToolUse" ? await editContext(root, input, options) : "";
      const reading=session && existsSync(baselinePath(root,session)) ? await lexiconCoverage(root) : undefined;
      const changes=reading && session ? coverageChanges(reading,priorBaseline(root,session)) : [];
      const vocabulary=changes.length ? await vocabularyAtEdit(root, changes) : "";
      const context = await voiced(root, input, [feed.text,edit,vocabulary].filter(Boolean).join("\n"), voice);
      if (context === "") return { stdout: "", stderr: "", exit: 0 };
      const stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
      // An override took the feed's and the vocabulary line's place, so neither reached the host and neither advances.
      const delivered = voice.override === undefined && (feed.text !== "" || changes.length > 0);
      const commit=()=> { if(feed.text) feed.commit(); if(changes.length && reading && session) saveBaseline(root,session,reading); };
      return {stdout:stdout+"\n",stderr:"",exit:0,...(delivered ? {commit} : {})};
    }
    case "Stop":
    case "SubagentStop": {
      // The tree this session leaves is the one the next starts on: read it now, in the background, never waited on (df-84db9e4f).
      if (event === "Stop") refreshAtStop(root, options);
      const changed = await changedFiles(root);
      const report = await checkChanged(root, changed.files);
      const session=sessionOf(input);
      if (session) await snapshotAtStop(root, session, changed.files, options);
      const walls = unableWalls(root, input);
      const spec = specStopText(root, changed.files, walls);
      const lexicon = lexiconStopText(report, walls);
      const workText = workStopText(root, input);
      const reading=session && existsSync(baselinePath(root,session)) ? await lexiconCoverage(root) : undefined;
      const coverageText=reading && session ? await vocabularyAtStop(root, reading, priorBaseline(root, session)) : "";
      const changedText = changed.failure === undefined ? "" : `Changed files: not known (${changed.failure}); the lexicon check ran over nothing`;
      const gapText = await gapStopText(root, input, changed.files);
      const undeclaredText = await undeclaredStopText(root, changed.files);
      const parts: string[] = [];
      if (changedText !== "") parts.push(changedText);
      if (lexicon.text !== "") parts.push(`Lexicon check:\n${lexicon.text}`);
      if (spec.text !== "") parts.push(`Spec:\n${spec.text}`);
      if (workText !== "") parts.push(`Work:\n${workText}`);
      if (coverageText) parts.push(coverageText);
      if (gapText !== "") parts.push(gapText);
      if (undeclaredText !== "") parts.push(undeclaredText);
      const text = parts.join("\n");
      // A refusal is spent only on what the tool can prove is owed and no recorded wall excuses: a rejected name in a changed file, a spec problem, a structural defect.
      // A spec gap is not among them: no traced control is not a demonstrated bypass, so gapText never counts toward the refusal; nor does an undeclared entrance.
      const refuse = event === "SubagentStop" && input.stop_hook_active !== true && lexicon.owed + spec.owed > 0;
      if (refuse) {
        // The refusal is enforcement: no override reaches its reason, and an append only follows it.
        const { override: _unheard, ...heard } = voice;
        const reason = await voiced(root, input, `Regulate found what this session owes; settle it before stopping.\n${text}`, heard);
        return { stdout: "", stderr: reason, exit: REFUSE_EXIT };
      }
      const message = await voiced(root, input, parts.length === 0 ? "" : `Regulate (${event}):\n${text}`, voice);
      if (message === "") return { stdout: "", stderr: "", exit: 0 };
      return { stdout: JSON.stringify({ systemMessage: message }) + "\n", stderr: "", exit: 0 };
    }
  }
}

/** Read and parse the event JSON the host writes to stdin; an empty or malformed stdin is an empty event. */
export async function readStdinJson(stream: NodeJS.ReadableStream): Promise<HookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as HookInput) : {};
  } catch {
    return {};
  }
}
