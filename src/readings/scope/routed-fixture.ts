/**
 * The routed fixture the scoped reading's checks share: a route crossing
 * three components, and a fourth no route of its entrances reaches. Not a
 * test file, so importing it registers no test.
 *
 * src/api declares two entrances carrying outside trust in, look and grab,
 * whose handlers both go on to src/service and then src/store, so they share
 * one route. look's handler wraps the work in check, the chokepoint of a
 * verified invariant in src/service, and grab's does not, so the route has
 * no traced control, and the closures proposed differ: a guard: line for
 * look, an invariant for grab. src/report declares an entrance of its own,
 * daily, and src/api's admin code calls into it, but neither look's nor
 * grab's reach enters it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ShellState } from "./model.ts";

export const ROUTED: Record<string, string> = {
  "coherence.config.json": JSON.stringify({ name: "Routed", language: "typescript" }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["**/*.ts"] }),
  "Routed.spec.md": ["# Routed", "", "Serves looks.", "", "## trust levels", "- public (outside): anyone on the network", "- inside: the service's own code", "", "## invariants", ""].join("\n"),
  "src/api/Api.spec.md": [
    "# Api", "", "Takes requests.", "",
    "## entrances",
    "- look: a caller looks", "  handler: look in src/api/api.ts", "  trust: public",
    "- grab: a caller grabs", "  handler: grab in src/api/api.ts", "  trust: public", "",
    "## invariants", "",
  ].join("\n"),
  "src/api/api.ts": 'import { serve } from "../service/serve.ts";\nimport { check } from "../service/check.ts";\nexport function look(): string {\n  return check(serve("l"));\n}\nexport function grab(): string {\n  return serve("g");\n}\n',
  "src/api/admin.ts": 'import { summary } from "../report/report.ts";\nexport function audit(): string {\n  return summary();\n}\n',
  "src/service/Service.spec.md": [
    "# Service", "", "Does the work.", "",
    "## invariants",
    "- one check: Every look is checked before its work runs.", "  protects: inner", "  chokepoint: check", "  because: the check is where a look is let in", "  kinds: none", "",
  ].join("\n"),
  "src/service/check.ts": "export function check(v: string): string {\n  inner();\n  return v;\n}\nfunction inner(): void {}\n",
  "src/service/serve.ts": 'import { put } from "../store/rows.ts";\nexport function serve(v: string): string {\n  return put(v);\n}\n',
  "src/store/Store.spec.md": "# Store\n\nKeeps rows.\n\n## invariants\n",
  "src/store/rows.ts": "export function put(v: string): string {\n  return v;\n}\n",
  "src/report/Report.spec.md": ["# Report", "", "Sums the day.", "", "## entrances", "- daily: the day's summary", "  handler: daily in src/report/report.ts", "  trust: inside", "", "## invariants", ""].join("\n"),
  "src/report/report.ts": 'export function summary(): string {\n  return "s";\n}\nexport function daily(): string {\n  return summary();\n}\n',
};

/** A fresh copy of the routed fixture in the system temporary directory. */
export function routedProject(): { root: string; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), "coherence-routed-"));
  for (const [path, text] of Object.entries(ROUTED)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** The state with one check verified, as a run that found it holding would leave it. */
export function checked(state: ShellState): ShellState {
  for (const c of state.spec.components) for (const i of c.invariants) if (i.name === "one check") i.state = "invariant";
  return state;
}
