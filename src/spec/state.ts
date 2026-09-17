/**
 * The lifecycle state of one bullet, derived from what it carries.
 *
 *   requirement: enforcement is absent, or no refutation has been witnessed,
 *                or the decomposition checklist has an applicable shape that
 *                is neither declared nor dismissed (a missing kinds line
 *                means the checklist was never run).
 *   invariant:   all three hold.
 *
 * structural defect (an invariant whose enforcement no longer detects) is
 * the language server's verdict and belongs to slice three; nothing here
 * pretends to it. A missing because does not change the state but is
 * reported as a lack, since every invariant carries its own.
 */

import type { Invariant } from "./grammar.ts";

export type State = "requirement" | "invariant";

export type Lack = "enforcement" | "refutation" | "kinds" | "checklist" | "because";

export const LACKS: readonly Lack[] = ["enforcement", "refutation", "kinds", "checklist", "because"];

export interface Derived {
  state: State;
  lacks: Lack[];
  /** Applicable shapes with no declared or dismissed line. */
  missingShapes: string[];
}

export function deriveState(invariant: Invariant, applicable: readonly string[]): Derived {
  const lacks: Lack[] = [];
  if (invariant.enforcements.length === 0) lacks.push("enforcement");
  if (invariant.refutations.length === 0) lacks.push("refutation");
  const answered = new Set(invariant.checklist.map((line) => line.shape));
  const missingShapes = applicable.filter((shape) => !answered.has(shape));
  if (invariant.kinds === undefined) lacks.push("kinds");
  else if (missingShapes.length > 0) lacks.push("checklist");
  if (invariant.because === undefined) lacks.push("because");
  const state: State = lacks.some((lack) => lack !== "because") ? "requirement" : "invariant";
  return { state, lacks, missingShapes };
}
