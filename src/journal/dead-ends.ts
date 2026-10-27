/**
 * The dead-end reading: a subsystem that keeps collecting defects after it
 * was first guarded, across several classes and several rounds, inside a
 * window, with defects coming back through guards it already had. A guard
 * failure says one class's guard was weaker than claimed; a dead end says the
 * subsystem's design is what keeps failing, so each round's local guard is a
 * narrower door in a representation that is wrong, and the next round finds
 * a fault in the guard itself.
 *
 * A defect's subsystem is the component its record names (the defect verb
 * settles it at the write). A record older than that field, or written with
 * files in several components, is placed by derivation, and the reading says
 * how many it derived: each component holding a file it names, else the
 * component its close's guard names, the root only when nothing deeper is
 * named. One that names neither is placed nowhere and counted as such;
 * nothing is inferred from its prose.
 *
 * The journal is read across every worktree of the repository
 * (loadJournalAcrossWorktrees), each record once: an agent at a dead end
 * records its defects in the checkout it works in.
 *
 * A subsystem's count starts at its first guard: the earliest close of one of
 * its defects that names a guard whose refutation is witnessed. Families count
 * here as classes do: a family exempts a defect from guard-failure counting,
 * but a dead end spans classes and families alike. A defect with no class
 * counts as a defect and adds no class. A round is the commit HEAD named when
 * the defect was written: a review round's fixes land before the next round's
 * findings, so the findings of one round share a commit. A defect came back
 * through a guard when its own close names a guard that had already closed an
 * earlier defect of the subsystem before it was written: the defensive code
 * that guard stands for is where the new fault was.
 *
 * The reading is derived, never stored: an escalation is a record an agent
 * writes under its own session, so Coherence asks for one and never writes it.
 * A human's acknowledgement of an escalation that cites a subsystem's defect
 * answers it: the count starts again after the acknowledgement, so a
 * subsystem that keeps failing after the human chose trips it again.
 */

import { isAbsolute, relative } from "node:path";
import { citesOf, type JournalRecord } from "./record.ts";
import { defectStates, type DefectState, type GuardStanding } from "./defects.ts";
import { loadJournalAcrossWorktrees, type WorktreeRead } from "./store.ts";
import { componentHolding, guardStanding, type Component } from "../spec/model.ts";

/**
 * The window and thresholds a dead end must cross, tuned on Coherence's own
 * journal: the parse store crossed every one by its second round of blind
 * review, and no other component did in any 14-day window of its history.
 */
export const DEAD_END = {
  /** Days back from now that a defect may be recorded in and still count; the convergence reading's window. */
  days: 14,
  /** Defects in the subsystem since its first guard. */
  defects: 8,
  /** Distinct classes and families among them. */
  classes: 3,
  /** Distinct commits they were recorded at. */
  rounds: 3,
  /** Of them, defects that came back through a guard the subsystem already had. */
  returned: 3,
} as const;

export interface DeadEnd {
  /** The component folder. */
  subsystem: string;
  /** The close that first guarded it: the guard it named, the close, the defect it closed and when. */
  since: { guard: string; resolution: string; defect: string; at: string };
  /** The acknowledgement whose answer restarted the count, when a human answered an earlier dead end here. */
  answered?: string;
  /** The defects counted, oldest first. */
  defects: { id: string; at: string; class?: string; commit: string | null }[];
  /** Each class or family among them with its count, most first; a defect with no class adds none. */
  classes: { name: string; count: number }[];
  /** The distinct commits they were recorded at, oldest first; null where no git answered. */
  rounds: (string | null)[];
  /** Counted defects whose close names a guard that had already closed an earlier defect here before they were written. */
  returned: string[];
  window: { days: number; from: string };
  /** An escalation not yet acknowledged that cites one of the counted defects. */
  escalation?: string;
}

export interface DeadEndOptions {
  /** Every component folder of the project, "." for the root. */
  folders: readonly string[];
  /** The component folder holding a project-relative file: the spec model's own answer, so the reading never places a file another way. */
  holding: (file: string) => string | undefined;
  /** The project root: an absolute file inside it is read as its project-relative path, and one outside it is placed nowhere. */
  root: string;
  standing: (guard: string) => GuardStanding;
  now: Date;
  thresholds?: Partial<Record<keyof typeof DEAD_END, number>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How a defect was placed: by the component its record names, derived from its files or its guard, or nowhere. */
export type Placement = "recorded" | "files" | "guard" | "unplaced";

/** The subsystems a defect belongs to and how they were found: the component its record names, else derived from its files, else from its guard. */
export function placeDefect(state: DefectState, options: Pick<DeadEndOptions, "folders" | "holding" | "root">): { subsystems: string[]; by: Placement } {
  if (state.component !== undefined) return { subsystems: [state.component], by: "recorded" };
  const found = new Set<string>();
  for (const named of state.files ?? []) {
    const file = (isAbsolute(named) ? relative(options.root, named) : named).split("\\").join("/").replace(/^\.\//, "");
    if (file === "" || file === ".." || file.startsWith("../") || isAbsolute(file)) continue;
    const folder = options.holding(file);
    if (folder !== undefined) found.add(folder);
  }
  if (found.size > 1) found.delete(".");
  const byFiles = found.size > 0 && !(found.size === 1 && found.has("."));
  const guard = state.resolution?.guard;
  if (guard !== undefined) {
    const folder = guard.slice(0, Math.max(0, guard.lastIndexOf("/")));
    if (options.folders.includes(folder)) found.add(folder);
  }
  if (found.size > 1) found.delete(".");
  if (found.size === 0) return { subsystems: [], by: "unplaced" };
  return { subsystems: [...found].sort(), by: byFiles ? "files" : "guard" };
}

const byTime = <T extends { at: string }>(a: T, b: T): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/**
 * Every subsystem the journal shows at a dead end as of now, most defects
 * first. The spec model computes it once onto the defect floor, so spec
 * --check, orient and the convergence reading never disagree.
 */
export function deadEnds(records: readonly JournalRecord[], states: readonly DefectState[], options: DeadEndOptions): DeadEnd[] {
  const limits = { ...DEAD_END, ...options.thresholds };
  const to = options.now.toISOString();
  const from = new Date(options.now.getTime() - limits.days * DAY_MS).toISOString();
  // Only what was written by now: a later record, or a close written after now, is no part of this reading.
  const written = records.filter((r) => r.at <= to);
  const gone = new Set(written.flatMap((r) => (r.kind === "retraction" ? [r.of] : [])));
  const escalations = written.filter((r) => r.kind === "escalation" && !gone.has(r.id));
  const acknowledgements = written.flatMap((r) => (r.kind === "acknowledgement" && !gone.has(r.id) ? [r] : []));
  const known = states.filter((s) => s.at <= to).map((s): DefectState => {
    if (s.resolution === undefined || s.resolution.at <= to) return s;
    const { resolution: _later, ...open } = s;
    return open;
  });

  const bySubsystem = new Map<string, DefectState[]>();
  for (const state of known) {
    for (const subsystem of placeDefect(state, options).subsystems) bySubsystem.set(subsystem, [...(bySubsystem.get(subsystem) ?? []), state]);
  }

  const found: DeadEnd[] = [];
  for (const [subsystem, mine] of bySubsystem) {
    // The first guard: the earliest close among the subsystem's defects naming a guard whose refutation is witnessed.
    let first: DeadEnd["since"] | undefined;
    for (const s of mine) {
      const r = s.resolution;
      if (r?.guard === undefined || options.standing(r.guard) !== "witnessed") continue;
      if (first === undefined || r.at < first.at) first = { guard: r.guard, resolution: r.id, defect: s.id, at: r.at };
    }
    if (first === undefined) continue;
    // A human's answer to an escalation about this subsystem restarts the count after it.
    const ids = new Set(mine.map((s) => s.id));
    const about = new Set(escalations.filter((e) => citesOf(e).some((id) => ids.has(id))).map((e) => e.id));
    const answer = acknowledgements.filter((a) => about.has(a.of)).sort(byTime).at(-1);
    const start = [first.at, from, answer?.at ?? ""].sort().at(-1)!;
    const counted = mine.filter((s) => s.at > start).sort(byTime);
    const classCounts = new Map<string, number>();
    for (const s of counted) if (s.class !== undefined) classCounts.set(s.class, (classCounts.get(s.class) ?? 0) + 1);
    const rounds = [...new Set(counted.map((s) => s.commit ?? null))];
    const returned = counted.filter((s) => {
      const guard = s.resolution?.guard;
      return guard !== undefined && mine.some((t) => t.id !== s.id && t.resolution?.guard === guard && t.resolution.at < s.at);
    });
    if (counted.length < limits.defects || classCounts.size < limits.classes || rounds.length < limits.rounds || returned.length < limits.returned) continue;
    const countedIds = new Set(counted.map((s) => s.id));
    const open = escalations.find((e) => !acknowledgements.some((a) => a.of === e.id) && citesOf(e).some((id) => countedIds.has(id)));
    found.push({
      subsystem,
      since: first,
      ...(answer === undefined || answer.at <= first.at ? {} : { answered: answer.id }),
      defects: counted.map((s) => ({ id: s.id, at: s.at, ...(s.class === undefined ? {} : { class: s.class }), commit: s.commit ?? null })),
      classes: [...classCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      rounds,
      returned: returned.map((s) => s.id),
      window: { days: limits.days, from: from.slice(0, 10) },
      ...(open === undefined ? {} : { escalation: open.id }),
    });
  }
  return found.sort((a, b) => b.defects.length - a.defects.length || a.subsystem.localeCompare(b.subsystem));
}

/** What a dead end counted, as one phrase: the defects, the classes, the rounds, the returns, the first guard and the window. */
function counted(d: DeadEnd): string {
  return (
    `${d.defects.length} defects across ${d.classes.length} classes (${d.classes.map((c) => `${c.name} ${c.count}`).join(", ")}) over ${d.rounds.length} rounds, ` +
    `${d.returned.length} of them back through a guard it already had, since its first guard, "${d.since.guard}" (${d.since.resolution} closed ${d.since.defect} on ${d.since.at.slice(0, 10)}), in the ${d.window.days} days from ${d.window.from}`
  );
}

/** What to do: stop guarding, review the representation, and ask a human, or say the question already waits on one. */
function remedy(d: DeadEnd): string {
  const stop = `Stop adding guards to ${d.subsystem} and review its representation: weigh a different design before a narrower door in this one, and record the choice as a decision`;
  if (d.escalation !== undefined) return `${stop}; escalated as ${d.escalation}, awaiting a human (acknowledge ${d.escalation} --because "<redesign, or why the design stands>")`;
  return `${stop}; ask a human whether to redesign it: escalate "${d.subsystem} is at a dead end: redesign it or keep guarding?" --because "<what its defects share>" --cite ${d.defects.at(-1)!.id}`;
}

/** The dead-end reading of a project: the dead ends, the worktrees whose journals it read, and how it placed each defect. */
export interface DeadEndReading {
  deadEnds: DeadEnd[];
  worktrees: WorktreeRead[];
  /** Defects by how they were placed: the component their record names, derived from their files or guard, or nowhere. */
  placement: Record<Placement, number>;
  /** Lines of a journal, in any worktree, that would not parse. */
  damaged: number;
}

/**
 * The reading spec --check, orient and the convergence reading share: the
 * journal of every worktree, placed by the spec model's components and graded
 * by its guards, as of now.
 */
export function readDeadEnds(root: string, components: readonly Component[], now: Date = new Date(), thresholds?: DeadEndOptions["thresholds"]): DeadEndReading {
  const loaded = loadJournalAcrossWorktrees(root);
  const states = defectStates(loaded.records);
  const options: DeadEndOptions = {
    folders: components.map((c) => c.folder),
    holding: (file) => componentHolding(components, file)?.folder,
    root,
    standing: guardStanding(components),
    now,
    ...(thresholds === undefined ? {} : { thresholds }),
  };
  const placement: Record<Placement, number> = { recorded: 0, files: 0, guard: 0, unplaced: 0 };
  for (const state of states) placement[placeDefect(state, options).by] += 1;
  return { deadEnds: deadEnds(loaded.records, states, options), worktrees: loaded.worktrees, placement, damaged: loaded.damaged.length };
}

/** How many worktrees holding records no other did a line names, most first. */
const WORKTREES_NAMED = 5;

/** Which journals the reading read and how it placed the defects, as one line: the worktrees that held records no other did are named. */
export function readingScope(r: DeadEndReading): string {
  const own = r.worktrees.filter((w) => !w.self && w.only > 0).sort((a, b) => b.only - a.only || a.path.localeCompare(b.path));
  const named = own.slice(0, WORKTREES_NAMED).map((w) => `${w.path} (${w.only})`);
  if (own.length > WORKTREES_NAMED) named.push(`${own.length - WORKTREES_NAMED} more (query convergence --json names each)`);
  const p = r.placement;
  return (
    `read the journals of ${r.worktrees.length} worktree${r.worktrees.length === 1 ? "" : "s"}${own.length === 0 ? "" : `, records only in ${named.join(", ")}`}${r.damaged === 0 ? "" : `, ${r.damaged} unreadable line${r.damaged === 1 ? "" : "s"}`}; ` +
    `defects placed by the component their record names ${p.recorded}, derived from their files ${p.files}, from their guard ${p.guard}, unplaced ${p.unplaced}`
  );
}

/** One dead end as spec --check names it: everything counted, every defect by id, then what to do. */
export function deadEndLine(d: DeadEnd): string {
  return `DEAD END  ${d.subsystem}: ${counted(d)}: ${d.defects.map((x) => x.id).join(", ")}. ${remedy(d)}`;
}

/** spec --check's lines: each dead end, then one line of how many and what was read. */
export function deadEndLines(r: DeadEndReading): string[] {
  return [...r.deadEnds.map(deadEndLine), `dead ends: ${r.deadEnds.length}; ${readingScope(r)}`];
}

/** The dead ends as orient shows them, under a heading; nothing when there is none. Never shortened: the human must see the ids whole. */
export function deadEndBlock(r: DeadEndReading): string[] {
  if (r.deadEnds.length === 0) return [];
  return [
    `Dead ends (${r.deadEnds.length}): a subsystem keeps collecting defects after it was guarded, across classes and rounds, and they come back through its own guards; more guards there are narrower doors in a design that is wrong. The reading ${readingScope(r)}.`,
    ...r.deadEnds.map((d) => `⚠ ${d.subsystem}: ${counted(d)}: ${d.defects.map((x) => x.id).join(", ")}. ${remedy(d)}`),
  ];
}
