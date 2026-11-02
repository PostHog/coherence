/**
 * The relief's layout, kept in `.coherence/relief-layout.json` so where a
 * reader learned things stand outlives the page, a reload and the warm server
 * itself. Like the rest of `.coherence` but the journal, runs and work orders,
 * it is this checkout's own state, never committed: two people's layouts
 * would only fight in a merge.
 *
 * The warm server lays the relief out from what is kept here and keeps the
 * result (LayoutKeeper); its HTTP stays read-only. A snapshot reads it and
 * writes nothing.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR } from "../../../lifecycle/state-files.ts";
import type { ShellState } from "../model.ts";
import { placementInputs, reliefData, type ReliefFileLanded } from "./data.ts";
import { fileOrder, placeComponents, type ReliefLayout } from "./layout.ts";

export const LAYOUT_FILE = "relief-layout.json";

export const layoutPath = (root: string): string => join(root, STATE_DIR, LAYOUT_FILE);

const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** The layout kept for this checkout: an entry of any other shape is dropped, and a file missing or unreadable is no layout at all. */
export function readLayout(root: string): ReliefLayout {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(layoutPath(root), "utf8"));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const layout: ReliefLayout = {};
  for (const [folder, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { own, sub, files } = entry as Record<string, unknown>;
    const kept: ReliefLayout[string] = {};
    if (numbers(own)) kept.own = own;
    if (numbers(sub)) kept.sub = sub;
    if (Array.isArray(files) && files.every((f) => typeof f === "string")) kept.files = files;
    if (Object.keys(kept).length > 0) layout[folder] = kept;
  }
  return layout;
}

/** Write the layout whole, through a file of its own renamed into place, so a reader never sees half of one. */
export function writeLayout(root: string, layout: ReliefLayout): void {
  const path = layoutPath(root), temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, JSON.stringify(layout));
  renameSync(temporary, path);
}

/**
 * The relief's layout for one checkout: seeded from what is kept, extended as
 * the state and the files are laid out, and written back when either changes
 * it. `keep` false lays out from what is kept and writes nothing (a snapshot).
 */
export class LayoutKeeper {
  private readonly root: string;
  private readonly keep: boolean;
  private readonly log: (line: string) => void;
  private layout: ReliefLayout;
  private written: string;
  private placedFrom: readonly unknown[] | undefined;
  private placed: ReliefLayout | undefined;

  constructor(root: string, keep = true, log: (line: string) => void = () => {}) {
    this.root = root;
    this.keep = keep;
    this.log = log;
    this.layout = readLayout(root);
    this.written = JSON.stringify(this.layout);
  }

  /**
   * Where the state's components stand, seeded from the layout kept: placed
   * again only when what placement reads changed (the same inputs give the
   * same places). Only the places: the files reach the page in their order,
   * through the files route. Absent when the relief is not read.
   */
  components(state: ShellState): ReliefLayout | undefined {
    const inputs = placementInputs(state);
    if (this.placedFrom !== undefined && inputs.length === this.placedFrom.length && inputs.every((x, i) => x === this.placedFrom![i])) return this.placed;
    const data = reliefData(state);
    this.placedFrom = inputs;
    if ("absent" in data) return (this.placed = undefined);
    const { layout } = placeComponents(data.components, data.landings, this.layout);
    for (const [folder, places] of Object.entries(layout)) this.layout[folder] = { ...this.layout[folder], ...places };
    this.save();
    return (this.placed = layout);
  }

  /** A folder's files in the order they stand, seeded from the order kept; the order is kept for the next. */
  files(folder: string, files: ReliefFileLanded[], landings: readonly { n: number }[]): ReliefFileLanded[] {
    const order = fileOrder(files, landings, this.layout[folder]?.files);
    const at = new Map(files.map((f) => [f.file, f]));
    const before = this.layout[folder]?.files;
    if (before === undefined || before.length !== order.length || before.some((f, i) => f !== order[i])) {
      this.layout[folder] = { ...this.layout[folder], files: order };
      this.save();
    }
    return order.map((f) => at.get(f)!);
  }

  private save(): void {
    if (!this.keep) return;
    const text = JSON.stringify(this.layout);
    if (text === this.written) return;
    try {
      writeLayout(this.root, this.layout);
      this.written = text;
    } catch (error) {
      // The layout is a convenience: a checkout where it cannot be kept still draws, laid out afresh next time.
      this.log(`scope: the relief's layout was not kept: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
