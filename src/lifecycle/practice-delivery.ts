/**
 * Practices delivered through the hook: whole at the moment a trigger fires,
 * one line at orient, and what is owed at the stop.
 *
 * PreToolUse reads the tool use about to happen (the command it runs, the
 * files it writes and the text it adds) against every practice's triggers.
 * A practice fired for the first time this session at this version is
 * delivered whole, steps first and pitfalls after; fired again, one line
 * names it. Each firing is kept under .coherence/practices/<session>.jsonl,
 * transient like the feed cursors, so regulate can name a practice that
 * fired and was never enacted. The hook never blocks the tool: a practice is
 * method, and a refusal would train a session to work around it.
 */

import { spawnSync } from "./work-meter.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { keptParses, listedContent } from "./kept-parse.ts";
import { basename, dirname, join, resolve, sep } from "node:path";
import { SPEC_SUFFIX, loadSpecModel, projectPractices, type SpecModel } from "../spec/model.ts";
import { PRACTICE_SUFFIX, firedBy, parsePractices, renderPractice, triggerText, type ToolUse } from "../spec/practice.ts";
import { KERNEL_PREFIX, isCoherenceTree, kernelPractices, type ModelPractice } from "../spec/practices.ts";
import { configIgnore, underIgnored } from "../adapters/project-files.ts";
import { loadJournal } from "../journal/store.ts";
import type { Enactment } from "../journal/record.ts";
import { enactTemplate } from "../journal/verbs.ts";
import { holdsProject, projectRoot, within } from "./project.ts";
import { shellCommandOf, simpleCommands, type SimpleCommand } from "./shell-writes.ts";

export const PRACTICES_DIR = join(".coherence", "practices");

/** One firing: which practice, at which version, what fired it, when, and whether it was delivered whole. */
export interface Firing {
  at: string;
  practice: string;
  version: string;
  trigger: string;
  whole: boolean;
  /** The project the firing command ran in, when a cd took it out of the session's own (another worktree, another checkout): its journal holds the enactment. */
  root?: string;
}

function firingsFile(root: string, session: string): string {
  return join(root, PRACTICES_DIR, `${session.replace(/[^\w.-]/g, "_")}.jsonl`);
}

/** The firings this session has had, oldest first; a torn line is skipped. */
export function firings(root: string, session: string): Firing[] {
  const file = firingsFile(root, session);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      try {
        return line.trim() === "" ? [] : [JSON.parse(line) as Firing];
      } catch {
        return [];
      }
    });
}

function keepFirings(root: string, session: string, fired: readonly Firing[]): void {
  if (fired.length === 0) return;
  mkdirSync(join(root, PRACTICES_DIR), { recursive: true });
  appendFileSync(firingsFile(root, session), fired.map((f) => JSON.stringify(f)).join("\n") + "\n");
}

/** What a tool use offers a trigger, read from the event: the command, the files written, the text added. */
export function toolUseOf(input: Record<string, unknown>, writes: string[]): ToolUse {
  const record = typeof input["tool_input"] === "object" && input["tool_input"] !== null ? (input["tool_input"] as Record<string, unknown>) : {};
  const command = shellCommandOf(record);
  // A command that writes files carries what it writes in its own text (a heredoc's body, a sed replacement), so it counts as text added.
  const texts: string[] = writes.length > 0 && command !== undefined ? [command] : [];
  for (const key of ["new_string", "content", "new_source", "patch", "input"]) {
    const value = record[key];
    if (typeof value === "string") texts.push(value);
  }
  const edits = record["edits"];
  if (Array.isArray(edits)) for (const e of edits) if (typeof e === "object" && e !== null && typeof (e as Record<string, unknown>)["new_string"] === "string") texts.push((e as Record<string, string>)["new_string"]!);
  if (typeof input["tool_input"] === "string") texts.push(input["tool_input"]);
  return { command, ...(command === undefined ? {} : { commands: simpleCommands(command) }), writes, added: texts.join("\n") };
}

/**
 * The tool use split by the project each part acts on: the session's own
 * root takes the writes and every command that runs in it; a command a cd
 * took into another project (a second worktree, another checkout) is read
 * against that project's practices, whose journal is where its enactment
 * will be recorded. Only a cd out of the root asks where it landed, and a
 * command that landed in no Coherence project (no config, no .coherence)
 * fires nothing: no folder that is not a project is ever read for practices.
 */
function useByRoot(root: string, cwd: string, use: ToolUse): Map<string, ToolUse> {
  const home: SimpleCommand[] = [];
  const away = new Map<string, SimpleCommand[]>();
  for (const command of (use.commands ?? []) as SimpleCommand[]) {
    const target = command.dir === undefined || command.dir === "" ? undefined : resolve(cwd, command.dir);
    const other = target === undefined || within(root, target) ? root : projectRoot(target);
    if (other === root) home.push(command);
    else if (holdsProject(other)) away.set(other, [...(away.get(other) ?? []), command]);
  }
  const out = new Map<string, ToolUse>([[root, use.commands === undefined ? use : { ...use, commands: home }]]);
  for (const [other, commands] of away) out.set(other, { command: use.command, commands, writes: [], added: "" });
  return out;
}

export interface PracticeContext {
  text: string;
  /** Keep the firings once the text has reached the host. */
  commit: () => void;
}

/** The practices this tool use fires: each whole on its first firing at its version this session, one line after. */
export function practiceContext(root: string, session: string | undefined, use: ToolUse, cli: string, agent: string, now: () => Date = () => new Date(), cwd: string = root): PracticeContext {
  // A tool use that runs no command and writes nothing can fire no trigger: nothing is read for it.
  if (use.command === undefined && use.writes.length === 0) return { text: "", commit: () => {} };
  const fired: { practice: ModelPractice; trigger: string; at: string }[] = [];
  for (const [at, part] of useByRoot(root, cwd, use)) {
    let practices: ModelPractice[];
    try {
      practices = deliveryPractices(at);
    } catch {
      continue;
    }
    for (const practice of practices) {
      const trigger = firedBy(practice, part);
      if (trigger !== undefined) fired.push({ practice, trigger, at });
    }
  }
  if (fired.length === 0) return { text: "", commit: () => {} };
  const before = session === undefined ? [] : firings(root, session);
  const lines: string[] = [];
  const kept: Firing[] = [];
  for (const { practice, trigger, at } of fired) {
    const delivered = before.some((f) => f.practice === practice.id && f.version === practice.version && f.whole);
    const where = at === root ? "" : ` in ${at}`;
    if (delivered) {
      lines.push(`Practice ${practice.id} applies here (${trigger}${where}); delivered whole earlier this session. Enact it when done.`);
    } else {
      lines.push(`This ${trigger}${where} fires a practice. Follow it, and record it with enact when done${where === "" ? "" : `, run from${where}`}.`, ...renderPractice(practice.id, practice));
      if (session !== undefined) lines.push("Record it:", enactTemplate(practice, cli, session, agent, trigger));
    }
    kept.push({ at: now().toISOString(), practice: practice.id, version: practice.version, trigger, whole: !delivered, ...(at === root ? {} : { root: at }) });
  }
  return { text: lines.join("\n") + "\n", commit: () => (session === undefined ? undefined : keepFirings(root, session, kept)) };
}

/**
 * Orient's one line: the project's own practices with what fires each, and a
 * count of Coherence's, which arrive whole when their triggers fire anyway.
 * The line rides inside the start budget the vocabulary also needs, so
 * the kernel practices are counted, not listed. A project with none of its own is
 * pointed at the practice that harvests them.
 */
export function practiceOrientText(root: string, cli: string): string {
  let practices: ModelPractice[];
  try {
    practices = projectPractices(root);
  } catch {
    return "";
  }
  if (practices.length === 0) return "";
  const own = practices.filter((p) => !p.id.startsWith(KERNEL_PREFIX));
  const kernel = practices.length - own.length;
  const record = `record one carried out with ${cli} enact "<practice>"`;
  if (own.length === 0) {
    // A project with no spec has not been adopted yet; one with specs but no practice of its own has methods nobody has kept.
    const adopted = hasSpec(root);
    const next = adopted ? `none of this project's own yet. To find the ones it already has: ${cli} query practice "harvest practices"` : `this project has no spec yet. To adopt Coherence here, step by step: ${cli} query practice "adopt Coherence"`;
    return `Practices: ${kernel} of Coherence's kernel, delivered when they fire; ${next}\n\n`;
  }
  const listed = own.map((p) => `${p.id} [${p.triggers.map(triggerText).join(", ")}]${p.state === "candidate" ? " (candidate)" : ""}`);
  const also = kernel === 0 ? "" : `; and ${kernel} of Coherence's kernel`;
  return `Practices, each delivered whole when what fires it is about to run (${record}): ${listed.join("; ")}${also}\n\n`;
}

/**
 * Regulate's practice lines, advisory: a practice that fired this session and
 * that the session has not enacted since, with the command that records it,
 * and a step enacted done without the evidence it names.
 */
export function practiceStopText(root: string, session: string | undefined, cli: string, agent: string, model?: SpecModel): string {
  if (session === undefined) return "";
  const fired = firings(root, session);
  // An enactment is recorded where its command ran: the session's own journal, and each other project a firing's command was in.
  const records: Enactment[] = [];
  for (const at of new Set([root, ...fired.flatMap((f) => (f.root === undefined ? [] : [f.root]))])) {
    try {
      records.push(...loadJournal(at).records.filter((r): r is Enactment => r.kind === "enactment" && r.session === session));
    } catch {
      // A journal that cannot be read holds no enactment this stop can see.
    }
  }
  const lines: string[] = [];
  let practices: ModelPractice[] | undefined;
  const owed = new Map<string, Firing>();
  for (const f of fired) {
    if (records.some((e) => e.practice === f.practice && e.at >= f.at)) continue;
    if (!owed.has(f.practice)) owed.set(f.practice, f);
  }
  for (const [id, f] of owed) {
    practices ??= (() => {
      try {
        return projectPractices(root, model);
      } catch {
        return [];
      }
    })();
    const steps = practices.find((p) => p.id === id)?.steps.length;
    const where = f.root === undefined ? "" : `, from ${f.root}`;
    lines.push(`Practice ${id} fired (${f.trigger}${where}) and has no enactment since: ${cli} enact "${id}" --trigger "${f.trigger}" --session ${session} --agent ${agent}${steps === undefined ? "" : ` with --step <n>=done|deviated:<why>|skipped:<why> for each of its ${steps} steps`} (${cli} query practice "${id}" prints them).`);
  }
  for (const e of records) {
    e.steps.forEach((step, index) => {
      const outcome = e.results[String(index + 1)];
      if (step.leaves !== undefined && outcome?.result === "done" && (outcome.evidence === undefined || outcome.evidence.trim() === "")) {
        lines.push(`Enactment ${e.id} marks step ${index + 1} of ${e.practice} done without the evidence it names (${step.leaves}): claimed, not shown.`);
      }
    });
  }
  return lines.length === 0 ? "" : `Practices (advisory):\n${lines.join("\n")}`;
}

/**
 * The agent query's practice question: every practice with what fires it, its
 * state and how often it was enacted; or, named, one practice whole, as the
 * hook would deliver it.
 */
export function practiceAnswer(root: string, given: string | undefined): { text: string; code: number } {
  let practices: ModelPractice[];
  try {
    practices = projectPractices(root);
  } catch (error) {
    return { text: `query practice: the practices could not be read (${error instanceof Error ? error.message : String(error)})`, code: 64 };
  }
  if (given === undefined) {
    if (practices.length === 0) return { text: "no practice: a practice file beside a component's spec holds them (scaffold practice)", code: 0 };
    return { text: practices.map((p) => `${p.id}  ${p.state}, version ${p.version}, enacted ${p.enactments}; when ${p.triggers.map(triggerText).join(" | ")}\n  ${p.sentence}`).join("\n"), code: 0 };
  }
  const exact = practices.find((p) => p.id === given) ?? (practices.filter((p) => p.name === given).length === 1 ? practices.find((p) => p.name === given) : undefined);
  if (exact === undefined) return { text: `query practice: no single practice "${given}"; known: ${practices.map((p) => p.id).join("; ")}`, code: 64 };
  return { text: [...renderPractice(exact.id, exact), `  ${exact.state}; enacted ${exact.enactments} time${exact.enactments === 1 ? "" : "s"}`, `  because: ${exact.because ?? ""}`].join("\n"), code: 0 };
}

/** Whether the project declares any component: a spec somewhere under its root. */
function hasSpec(root: string): boolean {
  try {
    return loadSpecModel(root, { runs: false }).components.length > 0;
  } catch {
    return false;
  }
}

/**
 * The practices a tool use may fire, read the light way the hook can afford
 * before every command and edit: git lists the practice files alone, each is
 * kept only beside its spec of the same stem and outside every ignored
 * folder, and is parsed; the kernel practices join in an adopter. No spec
 * model, no journal: delivery needs a practice's triggers, steps and version,
 * never its state, and the spec check is what holds the pairing and the
 * evidence. Outside git, the spec model's own reading stands in. Each
 * file's parse is kept while its content stands (kept-parse.ts), so a tool
 * use reads only a practice file whose content changed since the last one.
 */
export function deliveryPractices(root: string): ModelPractice[] {
  // The practice files and the specs they pair with, named by content: two git spawns, no stat or read of a file git calls clean.
  const listed = listedContent(root, [`:(glob)**/*${PRACTICE_SUFFIX}`, `:(glob)**/*${SPEC_SUFFIX}`], "practice", (rel) => rel.endsWith(PRACTICE_SUFFIX));
  if (listed === undefined) return projectPractices(root);
  const skip = new Set(configIgnore(root));
  const folderOf = (rel: string): string => (dirname(rel) === "." ? "." : dirname(rel));
  const present = listed.filter((f) => !underIgnored(f.rel, skip));
  const specs = new Set(present.filter((f) => f.rel.endsWith(SPEC_SUFFIX)).map((f) => f.rel));
  const paired = present.filter((f) => f.rel.endsWith(PRACTICE_SUFFIX) && specs.has(join(folderOf(f.rel), `${basename(f.rel).slice(0, -PRACTICE_SUFFIX.length)}${SPEC_SUFFIX}`).split(sep).join("/")));
  const parsed = keptParses(root, "delivery-practices", DELIVERY_PARSE_SHAPE, ["spec/practice.ts"], paired, "practice", (text, rel) => parsePractices(text, rel).practices);
  const out: ModelPractice[] = [];
  for (const { rel } of paired) {
    const folder = folderOf(rel);
    for (const practice of parsed.get(rel) ?? []) {
      out.push({ ...practice, id: `${folder}/${practice.name}`, component: folder, file: rel, state: "candidate", enactments: 0 });
    }
  }
  return isCoherenceTree(root) ? out : [...out, ...kernelPractices()];
}

/** The shape of a kept practice parse; a store of another shape, or one other code made, is read again. */
const DELIVERY_PARSE_SHAPE = "practices-1";
