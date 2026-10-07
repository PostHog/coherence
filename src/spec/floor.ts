/**
 * The invariant floor: a bullet the run store graded an invariant is not
 * demoted silently (df-f3826eaa).
 *
 * The reference point is the run store, never git. Each run entry records the
 * state the run left its bullet in (`state`, which the run reads from
 * loadSpecModel); an entry from before that field counts as graded an
 * invariant when it passed with a witnessed refutation (a chokepoint's own,
 * in the same entry; for a totality oracle, a refutation record at or before
 * the run). The latest such entry is the bullet's floor. A bullet with a
 * floor that is now missing, a requirement, or without an enforcement form it
 * was graded with is a problem until a decision recorded at or after the
 * floor names the bullet (`<component>/<name>`) in what it chose, or in what
 * it turned away (--over, where a name the lexicon has rejected since may
 * still be quoted). A run of the demoted bullet grades it a requirement, so
 * the floor stays where it was and the decision keeps clearing it; promoted
 * again and demoted again, the floor moves and asks for a new decision.
 *
 * A bullet renamed or moved in the same edit is recognized without a decision
 * when a bullet that lacks nothing but its refutation (the run store keys a
 * witness by name, so a rename costs it until the next run or refute)
 * carries an enforcement the floor recorded (`enforces`: the same via: test
 * title, or the same chokepoint, in the same form). An entry from before
 * `enforces` was recorded names no enforcement, so such a rename needs the
 * decision.
 */

import { entryKey, type Form, type RefutationRecord, type RunEntry, type RunRecord } from "../enforcement/record.ts";
import type { Decision, JournalRecord } from "../journal/record.ts";
import type { Problem } from "./grammar.ts";
import type { Component, ModelInvariant } from "./model.ts";

/** The refutation states a chokepoint entry carries when its own run witnessed the break (state.ts). */
const CHOKEPOINT_WITNESSED = new Set(["automatic", "refused by the language", "refused by the checker"]);

/** What one bullet's floor holds: when the run store last graded it an invariant, and with which forms. */
interface Floor {
  component: string;
  name: string;
  at: string;
  forms: Map<Form, { at: string; enforces: string[] | undefined }>;
}

export interface InvariantFloorGap {
  /** component/name. */
  id: string;
  component: string;
  name: string;
  /** What it lost: the bullet itself, an enforcement form, its refutation, kinds, or checklist. */
  lost: string[];
  /** The latest run that graded what was lost an invariant. */
  gradedAt: string;
}

/** The enforcements a bullet's form names: its via: test titles for a totality oracle, its chokepoints for a chokepoint. */
export function enforcesOf(invariant: Pick<ModelInvariant, "enforcements">, form: Form): string[] {
  return invariant.enforcements.flatMap((e) => (e.form !== form ? [] : e.form === "chokepoint" ? [e.chokepoint.trim()] : [e.via.trim()]));
}

/** Whether an entry graded its bullet an invariant: its recorded state, or for an entry from before that was recorded, a pass with a witnessed refutation. */
function gradedInvariant(entry: RunEntry, at: string, firstRefuted: ReadonlyMap<string, string>): boolean {
  if (entry.state !== undefined) return entry.state === "invariant";
  if (entry.verdict !== "pass") return false;
  if (entry.form === "chokepoint") return CHOKEPOINT_WITNESSED.has(entry.refutation);
  const refuted = firstRefuted.get(entryKey(entry.component, entry.name, entry.form));
  return refuted !== undefined && refuted <= at;
}

/** Every bullet's floor in the run store, keyed component/name. Runs are oldest first. */
function floorsOf(runs: readonly RunRecord[], refutations: readonly RefutationRecord[]): Map<string, Floor> {
  const firstRefuted = new Map<string, string>();
  for (const r of refutations) {
    const key = entryKey(r.component, r.name, r.form);
    if (!firstRefuted.has(key)) firstRefuted.set(key, r.at);
  }
  const floors = new Map<string, Floor>();
  for (const run of runs) {
    for (const entry of run.invariants) {
      if (!gradedInvariant(entry, run.at, firstRefuted)) continue;
      const key = `${entry.component}/${entry.name}`;
      const floor = floors.get(key) ?? { component: entry.component, name: entry.name, at: run.at, forms: new Map() };
      floor.at = run.at;
      floor.forms.set(entry.form, { at: run.at, enforces: entry.enforces });
      floors.set(key, floor);
    }
  }
  return floors;
}

/** The decide command that records why an invariant left the floor. */
export function demoteCommand(id: string): string {
  return `decide "demote ${id}: <retired, the code changed, or moved to where>" --because "<why>"`;
}

function namesBullet(chose: string, id: string): boolean {
  if (!chose.includes(id)) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w/-])${escaped}($|[^\\w/-])`).test(chose);
}

/**
 * The bullets the run store graded an invariant that have since lost it, before
 * any decision clears them. Each names what it lost and the run that graded it.
 */
export function rawFloorGaps(components: readonly Component[], runs: readonly RunRecord[], refutations: readonly RefutationRecord[]): InvariantFloorGap[] {
  if (runs.length === 0) return [];
  const now = new Map<string, ModelInvariant>();
  for (const c of components) for (const i of c.invariants) now.set(`${c.folder}/${i.name}`, i);
  // A rename's target stands when it lacks nothing but the refutation: the run store keys a witness by name, so the rename itself costs that.
  const standing = [...now.values()].filter((i) => i.state !== "requirement" || i.lacks.every((lack) => lack === "refutation" || lack === "because"));
  const gaps: InvariantFloorGap[] = [];
  for (const [id, floor] of floorsOf(runs, refutations)) {
    const current = now.get(id);
    if (current === undefined) {
      // A rename or a move: a standing bullet carries an enforcement the floor recorded, in the same form.
      const renamed = [...floor.forms].some(([form, { enforces }]) => enforces !== undefined && enforces.length > 0 && standing.some((s) => enforcesOf(s, form).some((e) => enforces.includes(e))));
      if (!renamed) gaps.push({ id, component: floor.component, name: floor.name, lost: ["the bullet itself"], gradedAt: floor.at });
      continue;
    }
    const lost: string[] = [];
    let gradedAt = "";
    const forms = new Set(current.enforcements.map((e) => e.form));
    for (const [form, { at }] of floor.forms) {
      if (forms.has(form)) continue;
      lost.push(`its ${form} enforcement`);
      if (at > gradedAt) gradedAt = at;
    }
    if (current.state === "requirement") {
      for (const lack of current.lacks) {
        if (lack === "because" || (lack === "enforcement" && lost.length > 0)) continue;
        lost.push(lack === "enforcement" ? "its enforcement" : `its ${lack}`);
      }
      if (floor.at > gradedAt) gradedAt = floor.at;
    }
    if (lost.length > 0) gaps.push({ id, component: floor.component, name: floor.name, lost, gradedAt });
  }
  return gaps;
}

/** The gaps no decision clears: one recorded at or after the floor, unretracted, naming the bullet. */
export function invariantFloorGaps(gaps: readonly InvariantFloorGap[], records: readonly JournalRecord[]): InvariantFloorGap[] {
  if (gaps.length === 0) return [];
  const retracted = new Set(records.flatMap((r) => (r.kind === "retraction" ? [r.of] : [])));
  const decisions = records.filter((r): r is Decision => r.kind === "decision" && !retracted.has(r.id));
  const named = (d: Decision, id: string): boolean => namesBullet(d.chose, id) || (Array.isArray(d.over) && d.over.some((o) => namesBullet(o, id)));
  return gaps.filter((gap) => !decisions.some((d) => d.at >= gap.gradedAt && named(d, gap.id)));
}

/** The floor's problems, each on the bullet's line, or its component's spec when the bullet is gone. */
export function invariantFloorProblems(components: readonly Component[], gaps: readonly InvariantFloorGap[]): Problem[] {
  return gaps.map((gap) => {
    const component = components.find((c) => c.folder === gap.component);
    const bullet = component?.invariants.find((i) => i.name === gap.name);
    return {
      file: component?.specPath ?? gap.component,
      line: bullet?.line ?? 1,
      message: `invariant ${gap.id} was graded an invariant by the run of ${gap.gradedAt} and has lost ${gap.lost.join(", ")}; an invariant is not demoted silently: ${demoteCommand(gap.id)}`,
    };
  });
}
