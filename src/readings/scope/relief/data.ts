/**
 * The relief's data from Scope's state: the relief reading's components and
 * landings, joined with what the rest of the state already holds, the spec's
 * invariants, crossings and refutations per component, the component
 * interfaces' call sites between components, and the journal's open defects.
 * Each component's files are counted here and load by folder when the scene
 * asks for them (mount.ts), so the data never grows with the code.
 */

import type { ReliefFileLanded } from "../../relief/relief.ts";
import { defectsOfJournal } from "../derive.ts";
import type { ShellState } from "../model.ts";
import { flowBoundsText, flowOf, flowPartialText } from "../structure-flow.ts";

export type { ReliefFileLanded };

export interface ReliefMeasures {
  lines: number;
  unreached: number;
  invariants: number;
  refutations: number;
  crossings: number;
  /** Call sites in other components that use this component's symbols: the load it carries. */
  leaned: number;
  /** Open defects naming a file in it. */
  defects: number;
}

export interface ReliefDataComponent {
  folder: string;
  name: string;
  spec: string;
  intent: string;
  /** A folder with no spec inside a component that holds others. */
  virtual?: true;
  /** How many files it holds; the files themselves load by folder. */
  files: number;
  v: ReliefMeasures;
}

export interface ReliefData {
  project: string;
  trunk: string;
  snapshot: string;
  /** The reading the data came from: files are fetched under it, and files fetched under another are another reading's. */
  stamp: string;
  /** In a snapshot, how many folders holding files it left out of what it embeds. */
  filesLeftOut?: number;
  windows: { key: string; label: string; days: number | null }[];
  defaultWindow: string;
  leaveOut: string[];
  components: ReliefDataComponent[];
  landings: { sha: string; date: string; subject: string; n: number; c: [number, number][] }[];
  /** Per ordered pair: [user, used, call sites, value call sites, the most used symbols as [name, sites, kind]]. */
  relies: [number, number, number, number, [string, number, string][]][];
  /** What the reading of the component interfaces was bounded to, and whether it stopped short: said first in the notes. */
  notes: string[];
}

/**
 * What the relief could not read, first: the landings, when git failed for a
 * reason other than having no history. Then the interface reading's limits in
 * the words query structure uses: when it stopped at a budget or could not
 * read some files, and what it was bounded to. The relief draws reliance from
 * that reading, so it says them too.
 */
export function reliefNotes(state: ShellState): string[] {
  const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1) + ".";
  const unread = state.relief?.kind === "read" ? state.relief.landingsUnread : undefined;
  const landings = unread === undefined ? [] : [upper(`landings not read: ${unread}; the heights are flat for that, not because nothing landed`)];
  if (state.componentInterfaces.kind !== "read") return landings;
  const model = flowOf(state);
  const partial = flowPartialText(model);
  const bounded = flowBoundsText(model);
  return [...landings, ...(partial === undefined ? [] : [upper(partial)]), ...(bounded === undefined ? [] : [upper(`Reliance and the Leaned on footprint come from component interfaces ${bounded}`)])];
}

/** The journal's open defects and the files each names, as one line of text: what the relief counts from the journal, and nothing else of it. */
export function openDefectsKey(records: ShellState["journal"]["records"]): string {
  return defectsOfJournal(records)
    .filter((defect) => defect.resolution === undefined)
    .map((defect) => `${defect.id}\t${(defect.files ?? []).join("\t")}`)
    .join("\n");
}

/**
 * What reliefData reads from the state: each object the state holds, and of
 * the journal only its open defects, as text. A merge replaces what it
 * changed and keeps the rest, so while every object is the same and the open
 * defects are too the data is the same, and a render need not join it again;
 * an append to the journal that opens or closes no defect joins nothing.
 */
export function reliefInputs(state: ShellState): readonly unknown[] {
  return [state.project, state.relief, state.spec, state.componentInterfaces, openDefectsKey(state.journal.records)];
}

/** Why the state has no relief to draw, or undefined when it has one: the reading was not taken or could not be read. */
export function reliefAbsence(state: ShellState): string | undefined {
  const reading = state.relief;
  if (reading === undefined) return "This reading carries no relief: the page was built before the relief existed.";
  return reading.kind === "read" ? undefined : reading.because;
}

/** The relief's data, or why there is none: the reading was not taken or could not be read. */
export function reliefData(state: ShellState): ReliefData | { absent: string } {
  const reading = state.relief;
  if (reading?.kind !== "read") return { absent: reliefAbsence(state)! };
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
  // An open defect counts once toward each component holding one of its files: the deepest folder, a district included.
  const depth = (folder: string): number => (folder === "." ? 0 : folder.length + 1);
  const holderOf = (path: string): number => {
    let best = -1;
    reading.components.forEach((c, i) => {
      const holds = c.folder === "." || path === c.folder || path.startsWith(c.folder + "/");
      if (holds && (best < 0 || depth(c.folder) > depth(reading.components[best]!.folder))) best = i;
    });
    return best;
  };
  const defects = reading.components.map(() => 0);
  for (const defect of defectsOfJournal(state.journal.records)) {
    if (defect.resolution !== undefined) continue;
    for (const ci of new Set((defect.files ?? []).map(holderOf))) if (ci >= 0) defects[ci]! += 1;
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
        defects: defects[i] ?? 0,
      },
    };
  });
  return {
    project: state.project,
    trunk: "HEAD",
    snapshot: reading.head,
    stamp: reading.stamp,
    ...(reading.filesLeftOut === undefined ? {} : { filesLeftOut: reading.filesLeftOut }),
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
