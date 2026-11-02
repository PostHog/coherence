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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR } from "../../../lifecycle/state-files.ts";
import type { ShellState } from "../model.ts";
import { placementInputs, reliefData, type ReliefFileLanded } from "./data.ts";
import { fileOrder, placeComponents, type ReliefLayout } from "./layout.ts";

export const LAYOUT_FILE = "relief-layout.json";

export const layoutPath = (root: string): string => join(root, STATE_DIR, LAYOUT_FILE);

/** What is kept: each folder's places and files, and the newest landing the places were laid out against. */
export interface KeptLayout {
  at?: string;
  folders: ReliefLayout;
}

const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** The layout kept for this checkout: an entry of any other shape is dropped, a path kept twice is kept once, and a file missing or unreadable is no layout at all. */
export function readLayout(root: string): KeptLayout {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(layoutPath(root), "utf8"));
  } catch {
    return { folders: {} };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { folders: {} };
  const { at, folders } = parsed as Record<string, unknown>;
  const layout: KeptLayout = { folders: {}, ...(typeof at === "string" ? { at } : {}) };
  if (typeof folders !== "object" || folders === null || Array.isArray(folders)) return layout;
  for (const [folder, entry] of Object.entries(folders as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { own, sub, on, files, filesAt } = entry as Record<string, unknown>;
    const kept: ReliefLayout[string] = {};
    if (numbers(own)) kept.own = own;
    if (numbers(sub) && typeof on === "string") Object.assign(kept, { sub, on });
    if (Array.isArray(files) && files.every((f) => typeof f === "string")) {
      kept.files = [...new Set(files)];
      if (typeof filesAt === "string") kept.filesAt = filesAt;
    }
    if (Object.keys(kept).length > 0) layout.folders[folder] = inOrder(kept);
  }
  return layout;
}

/** Write the layout whole, through a file of its own renamed into place, so a reader never sees half of one. */
export function writeLayout(root: string, layout: KeptLayout): void {
  const path = layoutPath(root), temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, JSON.stringify(layout));
  renameSync(temporary, path);
}

/** An entry with its fields in one order, so the same layout is always the same text and a write that changes nothing is never made. */
function inOrder({ own, sub, on, files, filesAt }: ReliefLayout[string]): ReliefLayout[string] {
  return { ...(own && { own }), ...(sub && { sub }), ...(on !== undefined && { on }), ...(files && { files }), ...(filesAt !== undefined && { filesAt }) };
}

/** The indices of the landings newer than the one named, newest first; none when it is not among them (history rewritten, or out of the window). */
function since(landings: readonly { sha?: string }[], sha: string | undefined): Set<number> {
  const k = sha === undefined ? -1 : landings.findIndex((l) => l.sha === sha);
  return new Set(k < 0 ? [] : landings.slice(0, k).map((_, i) => i));
}

/**
 * The relief's layout for one checkout, laid out from what is kept and kept
 * as laid out. Components are placed again only when what placement reads
 * changed: held when the landings are the ones they were laid out against,
 * so a rebuild, a reload or a restart moves nothing, and nudged once when
 * new landings arrived. A folder's files are put in order once per reading,
 * nudged by the landings new since the order was last checked. `keep` false
 * lays out from what is kept and writes nothing (a snapshot); otherwise what
 * changed is written when `flush` is called, once for all the folders one
 * request laid out.
 */
export class LayoutKeeper {
  private readonly root: string;
  private readonly keep: boolean;
  private readonly log: (line: string) => void;
  private kept: KeptLayout;
  private written: string;
  private placedFrom: readonly unknown[] | undefined;
  private placedKey: string | undefined;
  private placed: ReliefLayout | undefined;

  constructor(root: string, keep = true, log: (line: string) => void = () => {}) {
    this.root = root;
    this.keep = keep;
    this.log = log;
    this.kept = readLayout(root);
    this.written = JSON.stringify(this.kept);
  }

  /**
   * Where the state's components stand, laid out from the places kept. Only
   * the places: the files reach the page in their order, through the files
   * route. Absent when the relief is not read. Kept at once.
   */
  components(state: ShellState): ReliefLayout | undefined {
    const inputs = placementInputs(state);
    if (this.placedFrom !== undefined && inputs.length === this.placedFrom.length && inputs.every((x, i) => x === this.placedFrom![i])) return this.placed;
    this.placedFrom = inputs;
    const data = reliefData(state);
    if ("absent" in data) return (this.placed = undefined);
    // The same content read again into new objects places nothing again.
    const key = JSON.stringify([data.components.map((c) => [c.folder, c.virtual ?? false, c.v]), data.landings.map((l) => [l.sha, l.n, l.c])]);
    if (key === this.placedKey) return this.placed;
    this.placedKey = key;
    const newest = data.landings[0]?.sha;
    const folders = this.kept.folders;
    let { layout } = placeComponents(data.components, data.landings, folders, this.kept.at !== undefined && newest !== this.kept.at ? "nudge" : "hold");
    // A nudge settles once more held, so the page, which holds what it is sent, draws exactly the places kept.
    if (newest !== this.kept.at) layout = placeComponents(data.components, data.landings, layout, "hold").layout;
    for (const [folder, entry] of Object.entries(folders)) {
      if (folder in layout) continue;
      // A component gone takes its places with it, and a folder gone its files.
      const { own: _own, sub: _sub, on: _on, ...rest } = entry;
      if (rest.files !== undefined && existsSync(join(this.root, folder))) folders[folder] = inOrder(rest);
      else delete folders[folder];
    }
    for (const [folder, places] of Object.entries(layout)) {
      const { own: _own, sub: _sub, on: _on, ...rest } = folders[folder] ?? {};
      folders[folder] = inOrder({ ...rest, ...places });
    }
    if (newest === undefined) delete this.kept.at;
    else this.kept.at = newest;
    this.flush();
    return (this.placed = layout);
  }

  /** A folder's files in the order they stand, laid out from the order kept and nudged by the landings since; the order is kept at the next flush. */
  files(folder: string, files: ReliefFileLanded[], landings: readonly { n: number; sha?: string }[]): ReliefFileLanded[] {
    const kept = this.kept.folders[folder];
    const newest = landings[0]?.sha;
    const order = fileOrder(files, landings, kept?.files, since(landings, kept?.filesAt));
    const at = new Map(files.map((f) => [f.file, f]));
    this.kept.folders[folder] = inOrder({ ...kept, files: order, ...(newest === undefined ? {} : { filesAt: newest }) });
    return order.map((f) => at.get(f)!);
  }

  /** Write what changed since the last write, if anything did. */
  flush(): void {
    if (!this.keep) return;
    const text = JSON.stringify(this.kept);
    if (text === this.written) return;
    try {
      writeLayout(this.root, this.kept);
      this.written = text;
    } catch (error) {
      // The layout is a convenience: a checkout where it cannot be kept still draws, laid out afresh next time.
      this.log(`scope: the relief's layout was not kept: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
