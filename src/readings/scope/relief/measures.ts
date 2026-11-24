/**
 * The relief's footprint measures as Scope shows them: one entry per key of
 * FOOT_KEYS, the keys the layout sizes blocks by, with its label, unit and
 * what it counts. Typed here, since the scene that draws them is not yet: a
 * key FOOT_KEYS gains without an entry here fails the compile, not the page.
 */

import type { FOOT_KEYS } from "./layout.ts";

type FootKey = (typeof FOOT_KEYS)[number];

export interface FootMeasure {
  key: FootKey;
  label: string;
  unit: string;
  how: string;
}

export const FOOT = [
  { key: "lines", label: "Lines", unit: "lines", how: "the lines mass counts in the component's files (node src/cli.ts mass --json); mass leaves out test files" },
  { key: "unreached", label: "Unreached", unit: "unreached lines", how: "lines in files no enforcement reaches, per mass. Totality oracles name no files, so this is mostly where no chokepoint reaches" },
  { key: "invariants", label: "Invariants", unit: "bullets", how: "bullets in the component's spec" },
  { key: "refutations", label: "Refutations", unit: "refutations", how: "refuted: entries under the component's bullets" },
  { key: "crossings", label: "Crossings", unit: "crossing bullets", how: "bullets that carry a crossing" },
  { key: "leaned", label: "Leaned on", unit: "call sites in", how: "call sites in other components that use this component's symbols, values and types alike, from Scope's component interfaces: the load it carries" },
  { key: "defects", label: "Defects", unit: "open defects", how: "open defect records in the journal (a resolution closes one, a retraction withdraws it) naming a file in the component's folder; one naming no file counts nowhere" },
] as const satisfies readonly FootMeasure[];

// Every key the layout measures has an entry, and no entry names a key it does not.
type Listed = (typeof FOOT)[number]["key"];
export const FOOT_COMPLETE: [Exclude<FootKey, Listed>] extends [never] ? true : never = true;
