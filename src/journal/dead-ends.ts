/**
 * The dead-end reading: a subsystem that keeps collecting defects after it
 * was first guarded, across several classes and several rounds, inside a
 * window, with each round bringing more than the rounds before it. A guard
 * failure says one class's guard was weaker than claimed; a dead end says the
 * subsystem's design is what keeps failing, so each round's local guard is a
 * narrower door in a representation that is wrong, and the next round finds
 * a fault in the guard itself.
 *
 * The alarm serves an agent that wants to work helpfully (d-9d919dd8): it
 * reads the records such an agent writes in the course of its work, and
 * guards against what that agent does by accident, never against an agent
 * choosing its records to silence it. So how a defect was closed decides
 * nothing: every defect placed in the subsystem after its first guard
 * counts, open or closed, closed under a guard it already had or a fresh
 * one, or by a decision, since an agent closes each in whatever way fits it.
 * A defect with no class counts too, and each as a class of its own, since
 * nothing says it shares one: leaving --class off by accident adds to the
 * alarm rather than hiding a dead end; spec --check names every unclassified
 * defect in its window. A retracted defect counts nowhere: a withdrawn report
 * is no fault. What tells a dead end from converging work is the arrivals:
 * converging work brings fewer defects each round, while at a dead end each
 * round's fixes bring more, so the later half of the rounds brings more than
 * the earlier.
 *
 * A defect's subsystem is the component its record names (the defect verb
 * settles it at the write, refuses a component that does not own every file
 * the defect names, and refuses a defect that says nothing of where it lies).
 * A record older than that field, or written with files in several
 * components, is placed by derivation, and the reading says how many it
 * derived: each component holding a file it names, else the component its
 * close's guard names, the root only when nothing deeper is named. One that
 * names neither is placed nowhere and counted as such; nothing is inferred
 * from its prose.
 *
 * The journal is read across every worktree of the repository
 * (loadJournalAcrossWorktrees), each record once: an agent at a dead end
 * records its defects in the checkout it works in.
 *
 * A subsystem's count starts at its first guard: the earliest close of one of
 * its defects that names a guard whose refutation is witnessed. Families count
 * here as classes do: a family exempts a defect from guard-failure counting,
 * but a dead end spans classes and families alike. A round is the commit HEAD
 * named when the defect was written: a review round's fixes land before the
 * next round's findings, so the findings of one round share a commit. The
 * window is the convergence reading's (windowOf): whole days ending today.
 *
 * The reading is derived, never stored: an escalation is a record an agent
 * writes under its own session, so Coherence asks for one and never writes it.
 * A human's acknowledgement of an escalation that cites a subsystem's defect
 * answers it, and only one that carries the human's words (--human) does, since
 * any agent can acknowledge: the count starts again after it, so a subsystem
 * that keeps failing after the human chose trips it again.
 */

import { citesOf, type Acknowledgement, type JournalRecord } from "./record.ts";
import { defectStates, type DefectState, type GuardStanding } from "./defects.ts";
import { loadJournalAcrossWorktrees, type WorktreeRead } from "./store.ts";
import { componentHolding, guardStanding, projectFile, type Component } from "../spec/model.ts";

/**
 * The thresholds a dead end must cross, tuned on Coherence's own journal by
 * replaying it every six hours of its history: the parse store crossed every
 * one by its ninth round of blind review, and no other component did at any
 * point, src/lifecycle and src/readings/scope included, whose arrivals fell
 * round over round at their peaks.
 */
export const DEAD_END = {
  /** The window's length in days, today included: the convergence reading's window, one function for both (windowOf). */
  days: 14,
  /** Defects in the subsystem since its first guard, open or closed, however closed. */
  defects: 8,
  /** Distinct classes and families among them, each unclassified defect counting as one more. */
  classes: 3,
  /** Distinct commits they were recorded at. */
  rounds: 3,
  /** How many more defects the later half of the rounds brought than the earlier half: arrivals that rise, where converging work's fall. */
  rise: 1,
} as const;

/**
 * The window a reading covers: the given number of whole days ending today,
 * from the start of the first day in UTC. The dead-end reading and the
 * convergence reading both take theirs from here, so they name one window.
 */
export function windowOf(now: Date, days: number): { days: number; from: string; to: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { days, from: new Date(today - (days - 1) * DAY_MS).toISOString(), to: new Date(today).toISOString().slice(0, 10) };
}

export interface DeadEnd {
  /** The component folder. */
  subsystem: string;
  /** The close that first guarded it: the guard it named, the close, the defect it closed and when. */
  since: { guard: string; resolution: string; defect: string; at: string };
  /** The human's acknowledgement whose answer restarted the count, when a human answered an earlier dead end here. */
  answered?: string;
  /** The defects counted, oldest first: every one placed here after the count started, open or closed, however closed. */
  defects: { id: string; at: string; class?: string; commit: string | null }[];
  /** Each class or family among them with its count, most first. */
  classes: { name: string; count: number }[];
  /** How many of them carry no class: counted as defects, and each as a class of its own. */
  unclassified: number;
  /** Each commit they were recorded at with how many, in the order their first defect arrived; null where no git answered. */
  rounds: { commit: string | null; defects: number }[];
  /** The arrivals of the earlier half of the rounds and of the later half (the middle round of an odd number in neither): a dead end's later rounds bring more. */
  trend: { earlier: number; later: number };
  window: { days: number; from: string; to: string };
  /** An escalation nobody has acknowledged that cites one of the counted defects. */
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

/**
 * The subsystems a defect belongs to and how they were found: the component
 * its record names; else each component below the root holding a file it
 * names (each path read with its "." and ".." resolved, projectFile); else
 * the component below the root its close's guard names; else the root, when
 * a file or the guard named it; else nowhere. Its files, else its guard: a
 * guard closes a defect from wherever its invariant is declared, so it names
 * where the defect lies only when the defect names no file that does.
 */
export function placeDefect(state: DefectState, options: Pick<DeadEndOptions, "folders" | "holding" | "root">): { subsystems: string[]; by: Placement } {
  if (state.component !== undefined) return { subsystems: [state.component], by: "recorded" };
  const files = new Set<string>();
  for (const named of state.files ?? []) {
    const file = projectFile(options.root, named);
    const folder = file === undefined ? undefined : options.holding(file);
    if (folder !== undefined) files.add(folder);
  }
  const deeper = [...files].filter((f) => f !== ".").sort();
  if (deeper.length > 0) return { subsystems: deeper, by: "files" };
  const guard = state.resolution?.guard;
  const guarded = guard === undefined ? undefined : guard.slice(0, Math.max(0, guard.lastIndexOf("/")));
  const byGuard = guarded !== undefined && options.folders.includes(guarded) ? guarded : undefined;
  if (byGuard !== undefined && byGuard !== ".") return { subsystems: [byGuard], by: "guard" };
  if (files.has(".")) return { subsystems: ["."], by: "files" };
  if (byGuard === ".") return { subsystems: ["."], by: "guard" };
  return { subsystems: [], by: "unplaced" };
}

const byTime = <T extends { at: string }>(a: T, b: T): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/** An acknowledgement that carries a human's words: the only answer that restarts a count, since any agent can acknowledge. */
const human = (r: JournalRecord): r is Acknowledgement => r.kind === "acknowledgement" && typeof r.human === "string" && r.human.trim() !== "";

/**
 * Every subsystem the journal shows at a dead end as of now, most defects
 * first. spec --check, orient and the convergence reading each call it
 * through readDeadEnds, with the same journal, components and window, so
 * they never disagree.
 */
export function deadEnds(records: readonly JournalRecord[], states: readonly DefectState[], options: DeadEndOptions): DeadEnd[] {
  const limits = { ...DEAD_END, ...options.thresholds };
  const to = options.now.toISOString();
  const window = windowOf(options.now, limits.days);
  // Only what was written by now: a later record, or a close written after now, is no part of this reading.
  const written = records.filter((r) => r.at <= to);
  const gone = new Set(written.flatMap((r) => (r.kind === "retraction" ? [r.of] : [])));
  const escalations = written.filter((r) => r.kind === "escalation" && !gone.has(r.id));
  const answers = written.filter(human).filter((a) => !gone.has(a.id));
  const acknowledged = new Set(written.flatMap((r) => (r.kind === "acknowledgement" && !gone.has(r.id) ? [r.of] : [])));
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
    const answer = answers.filter((a) => about.has(a.of)).sort(byTime).at(-1);
    const start = [first.at, window.from, answer?.at ?? ""].sort().at(-1)!;
    // Every defect after the start counts, whatever its close says: open, closed under a guard already here or a fresh one, or decided.
    const counted = mine.filter((s) => s.at > start).sort(byTime);
    const classCounts = new Map<string, number>();
    for (const s of counted) if (s.class !== undefined) classCounts.set(s.class, (classCounts.get(s.class) ?? 0) + 1);
    const unclassified = counted.filter((s) => s.class === undefined).length;
    const perRound = new Map<string | null, number>();
    for (const s of counted) perRound.set(s.commit ?? null, (perRound.get(s.commit ?? null) ?? 0) + 1);
    const rounds = [...perRound.entries()].map(([commit, defects]) => ({ commit, defects }));
    // Arrivals per round, earlier half against later half: converging work brings fewer each round, a dead end more.
    const half = Math.floor(rounds.length / 2);
    const sum = (part: typeof rounds): number => part.reduce((n, r) => n + r.defects, 0);
    const trend = { earlier: sum(rounds.slice(0, half)), later: sum(rounds.slice(rounds.length - half)) };
    // An unclassified defect could be of any class, so each counts as a class of its own: leaving --class off never keeps a subsystem under the threshold.
    const kinds = classCounts.size + unclassified;
    if (counted.length < limits.defects || kinds < limits.classes || rounds.length < limits.rounds || trend.later - trend.earlier < limits.rise) continue;
    const countedIds = new Set(counted.map((s) => s.id));
    // Awaiting a human: an escalation nobody has acknowledged. One an agent acknowledged without a human's words is answered as an escalation but restarts nothing here, so the reading asks again.
    const open = escalations.find((e) => !acknowledged.has(e.id) && citesOf(e).some((id) => countedIds.has(id)));
    found.push({
      subsystem,
      since: first,
      ...(answer === undefined || answer.at <= first.at ? {} : { answered: answer.id }),
      defects: counted.map((s) => ({ id: s.id, at: s.at, ...(s.class === undefined ? {} : { class: s.class }), commit: s.commit ?? null })),
      classes: [...classCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      unclassified,
      rounds,
      trend,
      window: { days: window.days, from: window.from.slice(0, 10), to: window.to },
      ...(open === undefined ? {} : { escalation: open.id }),
    });
  }
  return found.sort((a, b) => b.defects.length - a.defects.length || a.subsystem.localeCompare(b.subsystem));
}

/** What a dead end counted, as one phrase: the defects, the classes, the rounds and their arrivals, the first guard and the window. */
function counted(d: DeadEnd): string {
  const kinds = [...d.classes.map((c) => `${c.name} ${c.count}`), ...(d.unclassified === 0 ? [] : [`${d.unclassified} unclassified, each a class of its own`])];
  return (
    `${d.defects.length} defects across ${d.classes.length + d.unclassified} classes (${kinds.join(", ")}) over ${d.rounds.length} rounds whose arrivals rise ` +
    `(${d.rounds.map((r) => r.defects).join(", ")} a round; ${d.trend.later} in the later half against ${d.trend.earlier} in the earlier), ` +
    `open or closed alike, since its first guard, "${d.since.guard}" (${d.since.resolution} closed ${d.since.defect} on ${d.since.at.slice(0, 10)}), in the ${d.window.days} days from ${d.window.from} to ${d.window.to}`
  );
}

/** What to do: stop guarding, review the representation, and ask a human, or say the question already waits on one. */
function remedy(d: DeadEnd): string {
  const stop = `Stop adding guards to ${d.subsystem} and review its representation: weigh a different design before a narrower door in this one, and record the choice as a decision`;
  if (d.escalation !== undefined) return `${stop}; escalated as ${d.escalation}, awaiting a human (acknowledge ${d.escalation} --human "<what the human said>" --because "<redesign, or why the design stands>"; only an acknowledgement carrying --human restarts the count)`;
  return `${stop}; ask a human whether to redesign it: escalate "${d.subsystem} is at a dead end: redesign it or keep guarding?" --because "<what its defects share>" --cite ${d.defects.at(-1)!.id}`;
}

/** The dead-end reading of a project: the dead ends, the worktrees whose journals it read, how it placed each defect, and the defects in its window that carry no class. */
export interface DeadEndReading {
  deadEnds: DeadEnd[];
  worktrees: WorktreeRead[];
  /** Defects by how they were placed: the component their record names, derived from their files or guard, or nowhere. */
  placement: Record<Placement, number>;
  /** Lines of a journal, in any worktree, that would not parse, and store files that could not be read. */
  damaged: number;
  /** The window every count reads, from its first day to today. */
  window: { days: number; from: string; to: string };
  /** Defects recorded in the window that carry no class, oldest first: each answers to no guard, so the reading names them. */
  unclassified: string[];
}

/**
 * The reading spec --check, orient and the convergence reading share: the
 * journal of every worktree, placed by the spec model's components and graded
 * by its guards, as of now, over the window the thresholds' days give.
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
  const window = windowOf(now, thresholds?.days ?? DEAD_END.days);
  const to = now.toISOString();
  const unclassified = states.filter((s) => s.class === undefined && s.at >= window.from && s.at <= to).map((s) => s.id);
  return {
    deadEnds: deadEnds(loaded.records, states, options),
    worktrees: loaded.worktrees,
    placement,
    damaged: loaded.damaged.length,
    window: { days: window.days, from: window.from.slice(0, 10), to: window.to },
    unclassified,
  };
}

/** How many worktrees holding records no other did, and how many unclassified defects, a line names by path or id. */
const NAMED = 5;

/** Which journals the reading read, how it placed the defects and which in its window carry no class, as one line: the worktrees that held records no other did are named. */
export function readingScope(r: DeadEndReading): string {
  const own = r.worktrees.filter((w) => !w.self && w.only > 0).sort((a, b) => b.only - a.only || a.path.localeCompare(b.path));
  const named = own.slice(0, NAMED).map((w) => `${w.path} (${w.only})`);
  if (own.length > NAMED) named.push(`${own.length - NAMED} more (query convergence --json names each)`);
  const p = r.placement;
  const u = r.unclassified;
  const ids = [...u.slice(0, NAMED), ...(u.length > NAMED ? [`${u.length - NAMED} more`] : [])].join(", ");
  return (
    `read the journals of ${r.worktrees.length} worktree${r.worktrees.length === 1 ? "" : "s"}${own.length === 0 ? "" : `, records only in ${named.join(", ")}`}${r.damaged === 0 ? "" : `, ${r.damaged} unreadable line${r.damaged === 1 ? "" : "s"} or file${r.damaged === 1 ? "" : "s"}`}; ` +
    `defects placed by the component their record names ${p.recorded}, derived from their files ${p.files}, from their guard ${p.guard}, unplaced ${p.unplaced}; ` +
    `unclassified in the ${r.window.days} days from ${r.window.from} to ${r.window.to} ${u.length}` +
    (u.length === 0 ? "" : ` (${ids}): each counts toward a dead end as a class of its own and answers to no guard; classify <id> --class <name> --because "<why>"`)
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

/**
 * The dead ends as orient shows them, under a heading, never shortened: the
 * human must see the ids whole. With none, nothing: orient injects no total
 * (src/lifecycle/no totals are injected), so what the reading read and which
 * defects carry no class are spec --check's and the convergence reading's to
 * say, and orient speaks only with an alarm, with the counts it rests on.
 */
export function deadEndBlock(r: DeadEndReading): string[] {
  if (r.deadEnds.length === 0) return [];
  return [
    `Dead ends (${r.deadEnds.length}): a subsystem keeps collecting defects after it was guarded, across classes and rounds, and its arrivals rise round over round; more guards there are narrower doors in a design that is wrong. The reading ${readingScope(r)}.`,
    ...r.deadEnds.map((d) => `⚠ ${d.subsystem}: ${counted(d)}: ${d.defects.map((x) => x.id).join(", ")}. ${remedy(d)}`),
  ];
}
