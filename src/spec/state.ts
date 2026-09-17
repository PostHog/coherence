/**
 * The lifecycle state of one bullet, derived from what it carries and, when
 * runs exist, from the latest run that checked it.
 *
 *   requirement:       enforcement is absent, or no refutation has been
 *                      witnessed, or the decomposition checklist has an
 *                      applicable shape that is neither declared nor
 *                      dismissed (a missing kinds line means the checklist
 *                      was never run).
 *   invariant:         all three hold.
 *   structural defect: the latest run found a bypass, a chokepoint that
 *                      cannot be resolved, or a failing totality oracle.
 *                      The enforcement no longer detects, whatever else the
 *                      bullet carries.
 *
 * A chokepoint-form bullet's refutation is satisfied by an automatic
 * refutation in the latest run: the instrument proved it would report a
 * second reference, so nobody stages the break by hand. A totality oracle's
 * must be witnessed and written on the bullet. A missing because does not
 * change the state but is reported as a lack, since every invariant carries
 * its own.
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
  /** Enforcements the latest run found failing, by form: the structural defects. */
  defects: Latest[];
}

const NONE: LatestFor = { chokepoint: undefined, totality: undefined };

export function deriveState(invariant: Invariant, applicable: readonly string[], latest: LatestFor = NONE): Derived {
  const lacks: Lack[] = [];
  const hasChokepoint = invariant.enforcements.some((e) => e.form === "chokepoint");
  const automatic = hasChokepoint && latest.chokepoint !== undefined && latest.chokepoint.refutation === "automatic";
  if (invariant.enforcements.length === 0) lacks.push("enforcement");
  if (invariant.refutations.length === 0 && !automatic) lacks.push("refutation");
  const answered = new Set(invariant.checklist.map((line) => line.shape));
  const missingShapes = applicable.filter((shape) => !answered.has(shape));
  if (invariant.kinds === undefined) lacks.push("kinds");
  else if (missingShapes.length > 0) lacks.push("checklist");
  if (invariant.because === undefined) lacks.push("because");

  const entries = [latest.chokepoint, latest.totality].filter((e): e is Latest => e !== undefined);
  const verified = entries.filter((e) => e.verdict === "pass");
  const defects = entries.filter((e) => e.verdict === "fail");
  const state: State = defects.length > 0 ? "structural defect" : lacks.some((lack) => lack !== "because") ? "requirement" : "invariant";
  return { state, lacks, missingShapes, verified, defects };
}
