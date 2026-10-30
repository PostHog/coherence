/**
 * The relief's data from Scope's state: the relief reading's components,
 * files and landings, joined with what the rest of the state already holds,
 * the spec's invariants, crossings and refutations per component and the
 * component interfaces' call sites between components.
 */

import type { ShellState } from "../model.ts";
import { flowBoundsText, flowOf, flowPartialText } from "../structure-flow.ts";

export interface ReliefMeasures {
  lines: number;
  unreached: number;
  invariants: number;
  refutations: number;
  crossings: number;
  /** Call sites in other components that use this component's symbols: the load it carries. */
  leaned: number;
  defects: number;
}

export interface ReliefDataComponent {
  folder: string;
  name: string;
  spec: string;
  intent: string;
  /** A folder with no spec inside a component that holds others. */
  virtual?: true;
  files: { file: string; lines: number; reached: number }[];
  v: ReliefMeasures;
}

export interface ReliefData {
  project: string;
  trunk: string;
  snapshot: string;
  windows: { key: string; label: string; days: number | null }[];
  defaultWindow: string;
  leaveOut: string[];
  components: ReliefDataComponent[];
  landings: { sha: string; date: string; subject: string; n: number; c: [number, number][]; f: [number, number, number][] }[];
  /** Per ordered pair: [user, used, call sites, value call sites, the most used symbols as [name, sites, kind]]. */
  relies: [number, number, number, number, [string, number, string][]][];
  /** What the reading of the component interfaces was bounded to, and whether it stopped short: said first in the notes. */
  notes: string[];
}

/**
 * The interface reading's limits in the words query structure uses: when it
 * stopped at a budget or could not read some files, and what it was bounded
 * to. The relief draws reliance from that reading, so it says them too.
 */
export function reliefNotes(state: ShellState): string[] {
  if (state.componentInterfaces.kind !== "read") return [];
  const model = flowOf(state);
  const partial = flowPartialText(model);
  const bounded = flowBoundsText(model);
  const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1) + ".";
  return [...(partial === undefined ? [] : [upper(partial)]), ...(bounded === undefined ? [] : [upper(`Reliance and the Leaned on footprint come from component interfaces ${bounded}`)])];
}

/** The relief's data, or why there is none: the reading was not taken or could not be read. */
export function reliefData(state: ShellState): ReliefData | { absent: string } {
  const reading = state.relief;
  if (reading === undefined) return { absent: "This reading carries no relief: the page was built before the relief existed." };
  if (reading.kind !== "read") return { absent: reading.because };
  const specOf = new Map(state.spec.components.map((c) => [c.folder, c]));
  const index = new Map(reading.components.map((c, i) => [c.folder, i]));
  const pairs = new Map<string, { a: number; b: number; sites: number; values: number; symbols: [string, number, string][] }>();
  const leaned = reading.components.map(() => 0);
  if (state.componentInterfaces.kind === "read") {
    for (const use of state.componentInterfaces.symbols) {
      const a = index.get(use.from), b = index.get(use.to);
      if (a === undefined || b === undefined || a === b) continue;
      const key = `${a}>${b}`;
      const pair = pairs.get(key) ?? { a, b, sites: 0, values: 0, symbols: [] };
      pair.sites += use.sites;
      if (use.kind !== "type") pair.values += use.sites;
      pair.symbols.push([use.symbol, use.sites, use.kind ?? "value"]);
      pairs.set(key, pair);
      leaned[b] = (leaned[b] ?? 0) + use.sites;
    }
  }
  const components: ReliefDataComponent[] = reading.components.map((c, i) => {
    const spec = c.district ? undefined : specOf.get(c.folder);
    const invariants = spec?.invariants ?? [];
    return {
      folder: c.folder,
      name: c.name,
      spec: spec?.specPath ?? "",
      intent: spec?.intent ?? "",
      ...(c.district ? { virtual: true as const } : {}),
      files: c.files,
      v: {
        lines: c.lines,
        unreached: c.unreached,
        invariants: invariants.length,
        refutations: invariants.reduce((n, inv) => n + inv.refutations.length, 0),
        crossings: invariants.filter((inv) => inv.crossing !== undefined).length,
        leaned: leaned[i] ?? 0,
        defects: c.defects,
      },
    };
  });
  return {
    project: state.project,
    trunk: "HEAD",
    snapshot: reading.head,
    windows: [
      { key: "7", label: "7 days", days: 7 },
      { key: "30", label: "30 days", days: 30 },
      { key: "all", label: "All loaded", days: null },
    ],
    defaultWindow: "30",
    leaveOut: reading.leftOut,
    components,
    landings: reading.landings,
    notes: reliefNotes(state),
    relies: [...pairs.values()].map((p) => [p.a, p.b, p.sites, p.values, p.symbols.sort((x, y) => y[1] - x[1]).slice(0, 6)]),
  };
}
