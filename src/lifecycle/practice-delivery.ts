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

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSpecModel, projectPractices } from "../spec/model.ts";
import { firedBy, renderPractice, triggerText, type ToolUse } from "../spec/practice.ts";
import { KERNEL_PREFIX, type ModelPractice } from "../spec/practices.ts";
import { loadJournal } from "../journal/store.ts";
import type { Enactment } from "../journal/record.ts";
import { enactTemplate } from "../journal/verbs.ts";
import { shellCommandOf } from "./shell-writes.ts";

export const PRACTICES_DIR = join(".coherence", "practices");

/** One firing: which practice, at which version, what fired it, when, and whether it was delivered whole. */
export interface Firing {
  at: string;
  practice: string;
  version: string;
  trigger: string;
  whole: boolean;
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
  return { command, writes, added: texts.join("\n") };
}

export interface PracticeContext {
  text: string;
  /** Keep the firings once the text has reached the host. */
  commit: () => void;
}

/** The practices this tool use fires: each whole on its first firing at its version this session, one line after. */
export function practiceContext(root: string, session: string | undefined, use: ToolUse, cli: string, agent: string, now: () => Date = () => new Date()): PracticeContext {
  let practices: ModelPractice[];
  try {
    practices = projectPractices(root);
  } catch {
    return { text: "", commit: () => {} };
  }
  const fired = practices.flatMap((practice) => {
    const trigger = firedBy(practice, use);
    return trigger === undefined ? [] : [{ practice, trigger }];
  });
  if (fired.length === 0) return { text: "", commit: () => {} };
  const before = session === undefined ? [] : firings(root, session);
  const lines: string[] = [];
  const kept: Firing[] = [];
  for (const { practice, trigger } of fired) {
    const delivered = before.some((f) => f.practice === practice.id && f.version === practice.version && f.whole);
    if (delivered) {
      lines.push(`Practice ${practice.id} applies here (${trigger}); delivered whole earlier this session. Enact it when done.`);
    } else {
      lines.push(`This ${trigger} fires a practice. Follow it, and record it with enact when done.`, ...renderPractice(practice.id, practice));
      if (session !== undefined) lines.push("Record it:", enactTemplate(practice, cli, session, agent, trigger));
    }
    kept.push({ at: now().toISOString(), practice: practice.id, version: practice.version, trigger, whole: !delivered });
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
export function practiceStopText(root: string, session: string | undefined, cli: string, agent: string): string {
  if (session === undefined) return "";
  const fired = firings(root, session);
  let records: Enactment[];
  try {
    records = loadJournal(root).records.filter((r): r is Enactment => r.kind === "enactment" && r.session === session);
  } catch {
    records = [];
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
        return projectPractices(root);
      } catch {
        return [];
      }
    })();
    const practice = practices.find((p) => p.id === id);
    lines.push(`Practice ${id} fired (${f.trigger}) and has no enactment since; record what was done, and what was deviated from or skipped, with why:`);
    if (practice !== undefined) lines.push(`  ${enactTemplate(practice, cli, session, agent, f.trigger).replace(/\n/g, "\n  ")}`);
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
