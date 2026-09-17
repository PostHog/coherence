/**
 * The check's printed form: every component with its invariants and their
 * state, every problem with its file and line, and the counts.
 */

import type { Component, ModelInvariant, SpecModel } from "./model.ts";
import { LACKS } from "./state.ts";

function invariantLines(invariant: ModelInvariant): string[] {
  const lines: string[] = [];
  const lacks = invariant.lacks.length === 0 ? "" : `  lacks ${invariant.lacks.join(", ")}`;
  lines.push(`  ${invariant.name}  ${invariant.state}${lacks}`);
  for (const enforcement of invariant.enforcements) {
    if (enforcement.form === "chokepoint") {
      lines.push(`      chokepoint ${enforcement.chokepoint} protects ${enforcement.protects}: declared, unverified`);
    } else {
      lines.push(`      totality oracle "${enforcement.via}" over ${enforcement.over}: declared, unverified`);
    }
  }
  if (invariant.crossing !== undefined) lines.push(`      crossing ${invariant.crossing.from} -> ${invariant.crossing.to}`);
  for (const refutation of invariant.refutations) lines.push(`      refuted ${refutation.date}: ${refutation.broke}`);
  if (invariant.kinds !== undefined) {
    const kinds = invariant.kinds === "none" ? "none" : invariant.kinds.join(", ");
    const declared = invariant.checklist.filter((line) => line.outcome === "declared").length;
    const dismissed = invariant.checklist.length - declared;
    const missing = invariant.missingShapes.length === 0 ? "" : `; missing ${invariant.missingShapes.join(", ")}`;
    lines.push(`      kinds ${kinds}: ${invariant.applicable.length} shapes apply, ${declared} declared, ${dismissed} dismissed${missing}`);
  }
  if (invariant.unfilled.length > 0) lines.push(`      unfilled: ${invariant.unfilled.join(", ")}`);
  return lines;
}

function componentLines(component: Component): string[] {
  const lines: string[] = [`${component.name}  ${component.specPath}`];
  if (component.trustLevels !== undefined) lines.push(`  trust levels: ${component.trustLevels.map((level) => level.name).join(", ")}`);
  if (component.invariants.length === 0) lines.push("  (no invariants)");
  for (const invariant of component.invariants) lines.push(...invariantLines(invariant));
  return lines;
}

export function formatCounts(model: SpecModel): string {
  const c = model.counts;
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  const lacking = LACKS.map((lack) => `${lack} ${c.lacking[lack]}`).join(", ");
  return [
    `${plural(c.components, "component")}, ${plural(c.bullets, "bullet")}: ${plural(c.invariants, "invariant")}, ${plural(c.requirements, "requirement")}`,
    `lacking: ${lacking}; unfilled placeholders ${c.unfilled}; ${plural(c.problems, "problem")}`,
  ].join("\n");
}

export function formatReport(model: SpecModel): string {
  const lines: string[] = [];
  for (const component of model.components) lines.push(...componentLines(component));
  if (model.components.length === 0) lines.push(`no spec under ${model.root}`);
  for (const problem of model.problems) lines.push(`PROBLEM  ${problem.file}:${problem.line}  ${problem.message}`);
  lines.push(formatCounts(model));
  return lines.join("\n") + "\n";
}

export function hasProblems(model: SpecModel): boolean {
  return model.problems.length > 0;
}
