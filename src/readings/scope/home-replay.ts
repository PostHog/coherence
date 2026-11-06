/**
 * How the project took shape, replayed for a reader new to it: a sea of files
 * becoming named districts. The first step is the project before any component was
 * named, one mass of files, each as tall as it changes; then each step names
 * components, outward a level of folders at a time (the systems, then the domains
 * inside them), in the order their specs were first committed (the reading's
 * specs). Each step says what it named and what each named component is for, in
 * the spec's own words. Every step is the reading's own files grouped again by
 * the same rules (relief/groups.ts), so a replay shows nothing the reading
 * does not hold.
 */

import type { ReliefFileLanded, ReliefSpec } from "../relief/relief.ts";
import { regroup } from "../relief/groups.ts";
import type { ShellState } from "./model.ts";
import { reliefData, type ReliefData } from "./relief/data.ts";

/** A component a step names, and what it is for in its spec's words. */
export interface ReplayNamed {
  name: string;
  intent: string;
}

export interface ReplayStep {
  /** What this step says. */
  caption: string;
  /** The components this step names, with what each is for. */
  named: ReplayNamed[];
  /** The spec folders standing at this step. */
  folders: string[];
}

const depth = (folder: string): number => (folder === "." ? 0 : folder.split("/").length);

/** Names in a sentence: "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The steps of a replay: the sea, then each commit's components, outward a level at
 * a time; the root's own spec names it with the first level below. A date is
 * said only when the components were named on more than one occasion.
 */
export function replaySteps(project: string, files: number, specs: readonly ReliefSpec[], intents: ReadonlyMap<string, string> = new Map()): ReplayStep[] {
  const steps: ReplayStep[] = [{ caption: `${project} before any component had a name: ${files} files, each a block, taller where it changes most.`, named: [], folders: [] }];
  const standing: string[] = [];
  const commits: ReliefSpec[][] = [];
  for (const spec of specs) {
    const last = commits.at(-1);
    if (last !== undefined && last[0]!.sha === spec.sha) last.push(spec);
    else commits.push([spec]);
  }
  const dated = commits.length > 1;
  let first = true;
  for (const commit of commits) {
    const levels = new Map<number, ReliefSpec[]>();
    for (const spec of commit) {
      const d = Math.max(1, depth(spec.folder));
      levels.set(d, [...(levels.get(d) ?? []), spec]);
    }
    const when = commit[0]!.sha === "" ? "Not committed yet. " : dated ? `${commit[0]!.date}. ` : "";
    for (const d of [...levels.keys()].sort((a, b) => a - b)) {
      const named = levels.get(d)!;
      standing.push(...named.map((s) => s.folder));
      // The root's spec names the project itself, which the picture already is: the components are what a step shows.
      const components = named.filter((s) => s.folder !== ".");
      const shown = components.length > 0 ? components : named;
      const lead = first ? "A spec makes a folder a component and says what it is for. Its files gather on ground of their own: " : d === 1 ? "" : "Inside them, ";
      first = false;
      steps.push({
        caption: `${when}${lead}${listed(shown.map((s) => s.name))}.`,
        named: shown.map((s) => ({ name: s.name, intent: intents.get(s.folder) ?? "" })),
        folders: [...standing],
      });
    }
  }
  return steps;
}

/** One step's relief: the data to build the scene from, its files by folder, and what it says. */
export interface ReplayFrame {
  caption: string;
  named: ReplayNamed[];
  data: ReliefData;
  files: Record<string, ReliefFileLanded[]>;
}

/**
 * The frames of a replay, from every file the reading holds (`all`, the page's
 * loaded folders flattened). None when the relief is not read or holds no
 * spec history.
 */
export function replayFrames(state: ShellState, all: readonly ReliefFileLanded[]): ReplayFrame[] {
  const reading = state.relief;
  if (reading?.kind !== "read" || reading.specs === undefined || reading.specs.length === 0) return [];
  const names = new Map(reading.specs.map((s) => [s.folder, s.name]));
  const intents = new Map(state.spec.components.map((c) => [c.folder, c.intent]));
  // Every step stands on today's kept places, so the last step is today's picture and the replay has one ending; the
  // sea, and what today does not place (a folder that later divided), stand where their files stood (scene.ts).
  return replaySteps(state.project, all.length, reading.specs, intents).flatMap((step, i) => {
    const grouped = regroup(reading.landings, all, step.folders, names, i === 0, reading.folded ?? []);
    const data = reliefData({ ...state, relief: { ...reading, components: grouped.components, landings: grouped.landings, files: grouped.files } });
    return "absent" in data ? [] : [{ caption: step.caption, named: step.named, data, files: grouped.files }];
  });
}
