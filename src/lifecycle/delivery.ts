/**
 * What each hook event delivers for this project: the reading it carries
 * (orient at SessionStart and SubagentStart, the peer feed at prompt and tool
 * boundaries, regulate at Stop and SubagentStop) and what that reading holds
 * here, measured from the same functions the hook itself calls. `hooks
 * status` prints it beneath the wiring, so the person reading it sees what a
 * session will actually be told, not only which commands are installed.
 *
 * There is no per-project override of the hook's text: the glossary makes the
 * instruction a fixed document the hook points at, and what varies between
 * projects is state (escalations, the spec, work orders, the vocabulary),
 * which is what this reading reports.
 */

import { loadJournal } from "../journal/store.ts";
import { openEscalations } from "../journal/read.ts";
import { loadOrders } from "../journal/work.ts";
import { loadSpecModel } from "../spec/model.ts";
import { CONTEXT_BUDGET, HOOK_EVENTS, changedFiles, startReading, type HookEvent } from "./hook.ts";
import type { HostStatus } from "./install.ts";
import { loadProjectGlossaries } from "./project.ts";
import { attention, type Coverage } from "./glossary-coverage.ts";

export type Reading = "orient" | "peer feed" | "regulate";

export const READING_OF: Record<HookEvent, Reading> = {
  SessionStart: "orient",
  SubagentStart: "orient",
  UserPromptSubmit: "peer feed",
  PostToolUse: "peer feed",
  Stop: "regulate",
  SubagentStop: "regulate",
};

export interface Delivery {
  event: HookEvent;
  reading: Reading;
  /** One line per thing the event carries, with this project's figures. */
  carries: string[];
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The spec's standing as regulate and orient read it, or why it could not be read. */
function specFigures(root: string): { problems: number; open: number; defects: number; chokepoints: number } | { error: string } {
  try {
    const model = loadSpecModel(root);
    const invariants = model.components.flatMap((c) => c.invariants);
    return {
      problems: model.problems.length,
      open: invariants.filter((i) => i.state === "requirement").length,
      defects: invariants.filter((i) => i.state === "structural defect").length,
      chokepoints: invariants.filter((i) => i.enforcements.some((e) => e.form === "chokepoint")).length,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** What orient says of the vocabulary: the terms it would name now, never a count; nothing is said when nothing is owed. */
function vocabularySignal(coverage: Coverage): string {
  const { undefinedTerms, senses } = attention(coverage);
  const terms = undefinedTerms.slice(0, 5).map((t) => t.term);
  const risky = [...new Set(senses.map((s) => s.term))].slice(0, 3);
  if (terms.length === 0 && risky.length === 0) return "vocabulary signal: nothing now (no recurring term lacks a definition and no sense is at risk), so nothing is injected";
  return `vocabulary signal, named and ranked: ${terms.length ? `undefined ${terms.join(", ")}` : "no undefined term"}; ${risky.length ? `sense at risk ${risky.join(", ")}` : "no sense at risk"}`;
}

/** Every event's delivery for the project at `root`, measured now. */
export async function deliveries(root: string): Promise<Delivery[]> {
  const records = loadJournal(root).records;
  const escalations = openEscalations(records).length;
  const orders = loadOrders(root).filter((o) => o.state === "open" || o.state === "active").length;
  const spec = specFigures(root);
  const { coherence, project } = await loadProjectGlossaries(root);
  const start = await startReading(root, {});
  const changed = await changedFiles(root);

  const specLine = "error" in spec
    ? `spec: not readable (${spec.error})`
    : `spec: ${plural(spec.problems, "problem")}, ${plural(spec.open, "open requirement")}`;
  const vocabulary = project === undefined
    ? `vocabulary: Coherence's ${plural(coherence.concepts.length, "concept")}, no project glossary`
    : `vocabulary: Coherence's ${plural(coherence.concepts.length, "concept")} and the project's ${plural(project.concepts.length, "concept")}`;
  const orient = [
    `escalations awaiting a human: ${escalations} (shown whole, never shortened)`,
    specLine,
    `the session's own work order, when it owns one (${plural(orders, "order")} open or active in the project)`,
    `${vocabulary}, delivered at detail "${start.detail}"`,
    vocabularySignal(start.coverage),
    "the session id with the decide and journal commands, and the rule",
    `size now: ${start.text.length.toLocaleString("en-US")} of ${CONTEXT_BUDGET.toLocaleString("en-US")} characters`,
  ];
  const feed = [
    "subjects of the decisions and escalations other sessions recorded since this session's cursor, twelve at most; never whole records",
    "only what an edit introduced: a term that now recurs without a definition, or a use whose sense is at risk, named; silent otherwise",
  ];
  const edit = "error" in spec
    ? "revelation at the edit: none (the spec is not readable)"
    : `revelation at the edit: a written file re-checks those of ${plural(spec.chokepoints, "chokepoint invariant")} it may involve`;
  const changedLine = changed.failure === undefined
    ? `the glossary check over the changed files (${changed.files.length} now)`
    : `the glossary check over the changed files (not known now: ${changed.failure})`;
  const debt = "error" in spec ? specLine : `spec: ${plural(spec.problems, "problem")}, ${plural(spec.defects, "structural defect")}, ${plural(spec.open, "open requirement")}`;
  const regulate = [changedLine, debt, "the reminder that an active work order is closed with work close", "the read trace snapshotted for calibrate"];

  const carries: Record<HookEvent, string[]> = {
    SessionStart: orient,
    SubagentStart: [...orient.slice(0, -1), `${orient[orient.length - 1]} (a subagent is oriented as a session is)`],
    UserPromptSubmit: feed,
    PostToolUse: [...feed, edit, "the read trace: the file a read tool named"],
    Stop: [...regulate, "never refuses: the human is present and decides"],
    SubagentStop: [...regulate, "refuses the stop (exit 2) on a rejected name in a changed file, a spec problem, or a structural defect, unless the session recorded unable naming it"],
  };
  return HOOK_EVENTS.map((event) => ({ event, reading: READING_OF[event], carries: carries[event] }));
}

/** The deliveries under the wiring: an event no agent host wires delivers nothing, and says so. */
export function formatDeliveries(list: Delivery[], statuses: HostStatus[]): string {
  const lines = ["what each event delivers for this project:"];
  for (const d of list) {
    const wired = statuses.filter((s) => s.installed.some((i) => i.event === d.event)).map((s) => s.host);
    if (wired.length === 0) {
      lines.push(`  ${d.event} (${d.reading}): not wired on any agent host; delivers nothing`);
      continue;
    }
    lines.push(`  ${d.event} (${d.reading}) via ${wired.join(", ")}:`);
    for (const c of d.carries) lines.push(`    ${c}`);
  }
  return lines.join("\n") + "\n";
}
