/**
 * The lifecycle state of one bullet, derived from what it carries and, when
 * runs exist, from the latest run that checked it.
 *
 *   requirement:       enforcement is absent, or an enforcement's refutation
 *                      has not been witnessed, or the decomposition checklist
 *                      has an applicable shape that is neither declared nor
 *                      dismissed (a missing kinds line means the checklist was
 *                      never run). A requirement whose check is failing stays a
 *                      requirement and is reported with its failing check.
 *   invariant:         all three hold.
 *   structural defect: an invariant whose satisfaction has been removed: the
 *                      bullet is otherwise complete and the latest run found a
 *                      bypass, a chokepoint that cannot be resolved, or a
 *                      failing totality oracle. A bullet that was never an
 *                      invariant cannot become one.
 *
 * Refutation is required per enforcement, not per bullet: a bullet carrying
 * both forms needs both. A chokepoint form is witnessed by the automatic
 * refutation in the latest run, which proved the check itself would report the
 * break. A totality oracle form is witnessed only by a refutation record in the
 * run store together with a later run that found the same totality oracle
 * passing; the
 * bullet's `refuted:` line is the human account of that event and satisfies
 * nothing on its own. A missing because does not change the state but is
 * reported as a lack, since every invariant carries its own.
 */

import type { Latest, LatestFor } from "../enforcement/record.ts";
import type { Invariant } from "./grammar.ts";

export type State = "requirement" | "invariant" | "structural defect";

export type Lack = "enforcement" | "refutation" | "kinds" | "checklist" | "because";

export const LACKS: readonly Lack[] = ["enforcement", "refutation", "kinds", "checklist", "because"];

export interface Derived {
  state: State;
  lacks: Lack[];
  /** Applicable shapes with no declared or dismissed line. */
  missingShapes: string[];
  /** Enforcements the latest run found passing, by form. */
  verified: Latest[];
  /** Enforcements the latest run found failing, by form. */
  defects: Latest[];
  /** Enforcement forms on this bullet whose refutation has not been witnessed. */
  unrefuted: string[];
}

const NONE: LatestFor = { chokepoint: undefined, totality: undefined };

/**
 * `totalityWitnessed` is the run store's answer for this bullet's totality oracle:
 * a refutation record exists for it and a run at or after that record found it
 * passing. The model computes it; nothing derives it from the spec text.
 */
export function deriveState(invariant: Invariant, applicable: readonly string[], latest: LatestFor = NONE, totalityWitnessed = false): Derived {
  const lacks: Lack[] = [];
  const forms = new Set(invariant.enforcements.map((e) => e.form));
  const unrefuted: string[] = [];
  if (forms.has("chokepoint") && latest.chokepoint?.refutation !== "automatic") unrefuted.push("chokepoint");
  if (forms.has("totality oracle") && !totalityWitnessed) unrefuted.push("totality oracle");
  if (invariant.enforcements.length === 0) {
    lacks.push("enforcement");
    lacks.push("refutation");
  } else if (unrefuted.length > 0) {
    lacks.push("refutation");
  }
  const answered = new Set(invariant.checklist.map((line) => line.shape));
  const missingShapes = applicable.filter((shape) => !answered.has(shape));
  if (invariant.kinds === undefined) lacks.push("kinds");
  else if (missingShapes.length > 0) lacks.push("checklist");
  if (invariant.because === undefined) lacks.push("because");

  const entries = [latest.chokepoint, latest.totality].filter((e): e is Latest => e !== undefined);
  const verified = entries.filter((e) => e.verdict === "pass");
  const defects = entries.filter((e) => e.verdict === "fail");
  // A structural defect is an invariant whose satisfaction has been removed; a bullet that never got there
  // stays a requirement, reported with its failing check.
  const complete = !lacks.some((lack) => lack !== "because");
  const state: State = !complete ? "requirement" : defects.length > 0 ? "structural defect" : "invariant";
  return { state, lacks, missingShapes, verified, defects, unrefuted };
}
