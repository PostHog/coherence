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

import type { Latest, LatestFor, RefutationState } from "../enforcement/record.ts";
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
 * The refutation states that witness a chokepoint form: the check's own
 * classification called every staged synthetic site a bypass, or the rung's
 * enforcer is the language itself and it refused the synthetic outside
 * reference (ruling rs-e93ecdd6), or a checker that draws a module boundary
 * (tach) refused a staged outside import. A refusal is the firing of the enforcement
 * the rung names, so it satisfies the requirement the same way.
 */
const CHOKEPOINT_WITNESSED: ReadonlySet<RefutationState> = new Set<RefutationState>(["automatic", "refused by the language", "refused by the checker"]);

/**
 * `totalityWitnessed` is the run store's answer for this bullet's totality oracle:
 * a refutation record exists for it and a run at or after that record found it
 * passing. The model computes it; nothing derives it from the spec text.
 */
export function deriveState(invariant: Invariant, applicable: readonly string[], latest: LatestFor = NONE, totalityWitnessed = false): Derived {
  const lacks: Lack[] = [];
  const forms = new Set(invariant.enforcements.map((e) => e.form));
  const unrefuted: string[] = [];
  if (forms.has("chokepoint") && !CHOKEPOINT_WITNESSED.has(latest.chokepoint?.refutation ?? "missing")) unrefuted.push("chokepoint");
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

  // Only the forms the bullet carries now: an entry for a form it no longer declares is history, not a verdict
  // on what it claims today, and reading it would leave a retired chokepoint failing the bullet forever.
  const entries = [forms.has("chokepoint") ? latest.chokepoint : undefined, forms.has("totality oracle") ? latest.totality : undefined].filter(
    (e): e is Latest => e !== undefined,
  );
  const verified = entries.filter((e) => e.verdict === "pass");
  const defects = entries.filter((e) => e.verdict === "fail");
  // A structural defect is an invariant whose satisfaction has been removed; a bullet that never got there
  // stays a requirement, reported with its failing check.
  const complete = !lacks.some((lack) => lack !== "because");
  const state: State = !complete ? "requirement" : defects.length > 0 ? "structural defect" : "invariant";
  return { state, lacks, missingShapes, verified, defects, unrefuted };
}
