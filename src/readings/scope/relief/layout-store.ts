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

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR } from "../../../lifecycle/state-files.ts";
import type { ShellState } from "../model.ts";
import { placementInputs, reliefData, type ReliefFileLanded } from "./data.ts";
import { fileOrder, placeComponents, type ReliefLayout, type ReliefPlace } from "./layout.ts";

export const LAYOUT_FILE = "relief-layout.json";

export const layoutPath = (root: string): string => join(root, STATE_DIR, LAYOUT_FILE);

/** What is kept for one component's folder: its place, and its files in order with the newest landing that order was checked against. */
export interface KeptEntry extends ReliefPlace {
  files?: string[];
  filesAt?: string;
}

/** What is kept: each component folder's entry, and the newest landing the places were laid out against. */
export interface KeptLayout {
  at?: string;
  folders: Record<string, KeptEntry>;
}

/** The most nudges one placement makes: more new landings than this are taken together, a share each, oldest first. */
export const NUDGES_MAX = 24;

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
    const kept: KeptEntry = {};
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

/** Write the layout whole, through a file of its own renamed into place, so a reader never sees half of one; a write that fails leaves no file of its own behind. */
export function writeLayout(root: string, layout: KeptLayout): void {
  const path = layoutPath(root), temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temporary, JSON.stringify(layout));
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** An entry with its fields in one order, so the same layout is always the same text. */
function inOrder({ own, sub, on, files, filesAt }: { [K in keyof KeptEntry]?: KeptEntry[K] | undefined }): KeptEntry {
  return { ...(own && { own }), ...(sub && { sub }), ...(on !== undefined && { on }), ...(files && { files }), ...(filesAt !== undefined && { filesAt }) };
}

/** The indices of the landings newer than the one named, newest first; none when it is not among them (a checkout, an amend or a rebase moved HEAD, or it fell out of the window): only a landing is evidence. */
function since(landings: readonly { sha?: string }[], sha: string | undefined): Set<number> {
  const k = sha === undefined ? -1 : landings.findIndex((l) => l.sha === sha);
  return new Set(k < 0 ? [] : landings.slice(0, k).map((_, i) => i));
}

/** The new landings in at most NUDGES_MAX groups, oldest first: one landing a nudge when there are few. */
function nudges(fresh: ReadonlySet<number>): Set<number>[] {
  const oldestFirst = [...fresh].sort((a, b) => b - a), size = Math.ceil(oldestFirst.length / NUDGES_MAX);
  return Array.from({ length: Math.ceil(oldestFirst.length / Math.max(1, size)) }, (_, g) => new Set(oldestFirst.slice(g * size, (g + 1) * size)));
}

/** The file's modification time, or -1 when there is none. */
function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

/**
 * The relief's layout for one checkout, laid out from what is kept and kept
 * as laid out. Components are placed again only when what placement reads
 * changed: held, so a rebuild, a reload, a restart or a checkout moves
 * nothing, and nudged by each landing new since the places were kept, which
 * moves only what that landing touched. A folder's files are put in order
 * once per reading, nudged the same way. `keep` false lays out from what is
 * kept and writes nothing (a snapshot); otherwise what changed is written at
 * `flush`, once for all the folders one request laid out. A kept file edited
 * or removed by hand is read again before the next layout, so removing it
 * resets the layout.
 */
export class LayoutKeeper {
  private readonly root: string;
  private readonly keep: boolean;
  private readonly log: (line: string) => void;
  private readonly write: (root: string, layout: KeptLayout) => void;
  private kept: KeptLayout;
  private mtime: number;
  private dirty = false;
  private placedFrom: readonly unknown[] | undefined;
  private placedKey: string | undefined;
  private placed: ReliefLayout | undefined;

  constructor(root: string, keep = true, log: (line: string) => void = () => {}, write: (root: string, layout: KeptLayout) => void = writeLayout) {
    this.root = root;
    this.keep = keep;
    this.log = log;
    this.write = write;
    this.mtime = mtimeOf(layoutPath(root));
    this.kept = readLayout(root);
  }

  /** Read the kept file again when something other than this keeper changed or removed it, and lay out again from it. */
  private fresh(): void {
    const mtime = mtimeOf(layoutPath(this.root));
    if (mtime === this.mtime) return;
    this.mtime = mtime;
    this.kept = readLayout(this.root);
    this.dirty = false;
    this.placedFrom = this.placedKey = this.placed = undefined;
  }

  /**
   * Where the state's components stand, laid out from the places kept. Only
   * the places: the files reach the page in their order, through the files
   * route. Absent when the relief is not read. Kept at once.
   */
  components(state: ShellState): ReliefLayout | undefined {
    this.fresh();
    const inputs = placementInputs(state);
    if (this.placedFrom !== undefined && inputs.length === this.placedFrom.length && inputs.every((x, i) => x === this.placedFrom![i])) return this.placed;
    this.placedFrom = inputs;
    const data = reliefData(state);
    if ("absent" in data) return (this.placed = undefined);
    // The same content read again into new objects places nothing again.
    const key = JSON.stringify([data.components.map((c) => [c.folder, c.virtual ?? false, c.v]), data.landings.map((l) => [l.sha, l.n, l.c])]);
    if (key === this.placedKey) return this.placed;
    this.placedKey = key;
    const folders = this.kept.folders;
    let layout: ReliefLayout = folders;
    for (const nudge of nudges(since(data.landings, this.kept.at))) layout = placeComponents(data.components, data.landings, layout, nudge).layout;
    // Held until it holds: a layout laid out afresh, or grown, settles its last overlaps here, so what is kept is what the next hold gives back.
    for (let round = 0, before = ""; round < 4 && JSON.stringify(layout) !== before; round++) {
      before = JSON.stringify(layout);
      layout = placeComponents(data.components, data.landings, layout).layout;
    }
    // Only components are kept: a folder that is no longer one takes its place and its files with it.
    const next: Record<string, KeptEntry> = {};
    for (const [folder, places] of Object.entries(layout)) next[folder] = inOrder({ files: folders[folder]?.files, filesAt: folders[folder]?.filesAt, ...places });
    const at = data.landings[0]?.sha;
    const before = JSON.stringify(this.kept);
    this.kept = { ...(at === undefined ? {} : { at }), folders: next };
    if (JSON.stringify(this.kept) !== before) this.dirty = true;
    this.flush();
    return (this.placed = layout);
  }

  /** A folder's files in the order they stand, laid out from the order kept and nudged by the landings since; the order is kept at the next flush. */
  files(folder: string, files: ReliefFileLanded[], landings: readonly { n: number; sha?: string }[]): ReliefFileLanded[] {
    this.fresh();
    const kept = this.kept.folders[folder];
    const newest = landings[0]?.sha;
    const order = fileOrder(files, landings, kept?.files, since(landings, kept?.filesAt));
    const at = new Map(files.map((f) => [f.file, f]));
    const same = kept?.filesAt === newest && kept?.files !== undefined && kept.files.length === order.length && kept.files.every((f, i) => f === order[i]);
    if (!same) {
      this.kept.folders[folder] = inOrder({ ...kept, files: order, ...(newest === undefined ? {} : { filesAt: newest }) });
      this.dirty = true;
    }
    return order.map((f) => at.get(f)!);
  }

  /** Write what changed since the last write, if anything did. */
  flush(): void {
    if (!this.keep || !this.dirty) return;
    try {
      this.write(this.root, this.kept);
      this.dirty = false;
      this.mtime = mtimeOf(layoutPath(this.root));
    } catch (error) {
      // The layout is a convenience: a checkout where it cannot be kept still draws, laid out afresh next time.
      this.log(`scope: the relief's layout was not kept: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
