/**
 * The check's printed form: every component with its invariants and their
 * state, every problem with its file and line, and the counts.
 */

import type { Latest } from "../enforcement/record.ts";
import type { Component, ModelInvariant, SpecModel } from "./model.ts";
import { LACKS } from "./state.ts";

/** How the latest run left one enforcement, or "declared, unverified" when no run has checked it. */
export function verdictText(latest: Latest | undefined): string {
  if (latest === undefined) return "declared, unverified";
  const date = latest.at.slice(0, 10);
  const grade = latest.grade === undefined ? "" : ` ${latest.grade}`;
  switch (latest.verdict) {
    case "pass":
      return `verified ${date}${grade}`;
    case "fail":
      return `structural defect ${date}${grade}: ${latest.reason}`;
    case "not run":
      return `not run ${date}${grade}: ${latest.reason}`;
  }
}

function invariantLines(invariant: ModelInvariant): string[] {
  const lines: string[] = [];
  const lacks = invariant.lacks.length === 0 ? "" : `  lacks ${invariant.lacks.join(", ")}`;
  lines.push(`  ${invariant.name}  ${invariant.state}${lacks}`);
  for (const enforcement of invariant.enforcements) {
    const latest = invariant.latest.find((l) => l.form === enforcement.form);
    if (enforcement.form === "chokepoint") {
      lines.push(`      chokepoint ${enforcement.chokepoint} protects ${enforcement.protects}: ${verdictText(latest)}`);
    } else {
      lines.push(`      totality oracle "${enforcement.via}" over ${enforcement.over}: ${verdictText(latest)}`);
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
  if (component.practicePath !== undefined) {
    lines.push(`  practices  ${component.practicePath}`);
    for (const p of component.practices) {
      const evidenced = p.steps.filter((s) => s.leaves !== undefined).length;
      lines.push(`  ${p.name}  ${p.state}, version ${p.version}, ${p.enactments} enacted; ${p.steps.length} steps (${evidenced} name their evidence), ${p.pitfalls.length} pitfalls`);
    }
  }
  return lines;
}

export function formatCounts(model: SpecModel): string {
  const c = model.counts;
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  const lacking = LACKS.map((lack) => `${lack} ${c.lacking[lack]}`).join(", ");
  const defects = c.structuralDefects === 0 ? "" : `, ${plural(c.structuralDefects, "structural defect")}`;
  const runs =
    model.runs === undefined
      ? "no run yet: every enforcement is declared, unverified"
      : `latest run ${model.runs.latest} (${plural(model.runs.count, "run")}${model.runs.damaged === 0 ? "" : `, ${model.runs.damaged} unreadable`})`;
  const practices = model.components.flatMap((component) => component.practices);
  const practiceLine = practices.length === 0 ? [] : [`${plural(practices.length, "practice")}: ${practices.filter((p) => p.state === "established").length} established, ${practices.filter((p) => p.state === "candidate").length} candidate`];
  return [
    `${plural(c.components, "component")}, ${plural(c.bullets, "bullet")}: ${plural(c.invariants, "invariant")}, ${plural(c.requirements, "requirement")}${defects}`,
    `lacking: ${lacking}; unfilled placeholders ${c.unfilled}; ${plural(c.problems, "problem")}; ${runs}`,
    ...practiceLine,
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
