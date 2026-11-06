/**
 * How the relief groups a project's files into components and districts: the
 * deepest spec folder holding a file owns it, and a component holding others
 * gives up its loose folders as districts. Pure and free of Node, so the
 * reading (relief.ts) and the page's replay of how the project took shape
 * (scope/home-replay.ts) group by the same rules.
 */

import type { ReliefComponent, ReliefFile, ReliefFileLanded, ReliefLanding } from "./relief.ts";

/** A folder must hold this many code files before it stands as a district: the threshold mass names a folder by. */
export const DISTRICT_FILES = 3;

/** The folder a path belongs to: the deepest of the given folders holding it, "." holding everything. */
export function ownerIn(folders: readonly string[], path: string): string {
  let best = ".";
  for (const folder of folders) if (folder !== "." && (path === folder || path.startsWith(folder + "/")) && folder.length > best.length) best = folder;
  return best;
}

/**
 * A container's own files split by the folder below it that holds them. A
 * folder holding most of the container's own lines is opened into its
 * subfolders, so frontend/src is never one district holding nearly everything;
 * files loose in an opened folder stay with the container.
 */
export function districtsOf(folder: string, files: readonly ReliefFile[]): Map<string, ReliefFile[]> {
  const base = folder === "." ? "" : folder + "/";
  const total = files.reduce((n, f) => n + f.lines, 0) || 1;
  const split = (prefix: string, among: readonly ReliefFile[]): Map<string, ReliefFile[]> => {
    const groups = new Map<string, ReliefFile[]>();
    for (const f of among) {
      const rest = f.file.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) continue;
      const key = prefix + rest.slice(0, slash);
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    return groups;
  };
  const out = new Map<string, ReliefFile[]>();
  const todo = [...split(base, files)];
  while (todo.length > 0) {
    const [sub, held] = todo.pop()!;
    const lines = held.reduce((n, f) => n + f.lines, 0);
    const inner = split(sub + "/", held);
    if (lines > 0.75 * total && inner.size >= 2) todo.push(...inner);
    else if (held.length >= DISTRICT_FILES) out.set(sub, held);
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** A folder a spec declares folded into its component, project-relative: its own files, or with `subtree` its whole subtree. */
export interface ReliefFolded {
  folder: string;
  subtree: boolean;
}

/** Whether a file lies in a folded folder: directly in it, or anywhere below one folded with its subtree. */
function foldedIn(folded: readonly ReliefFolded[], file: string): boolean {
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
  return folded.some((f) => (f.subtree ? file.startsWith(`${f.folder}/`) : dir === f.folder));
}

/**
 * A project's files grouped for the given spec folders: the folders in order, each one's files largest first, the
 * components they stand as, and which of them a path belongs to. `sea` keeps a project with no spec as one mass of
 * files, as it stands before any component is named, rather than in its folders; `folded` names the folders the specs
 * fold into their components, which stay in the component's own block rather than standing as land no one holds.
 */
export function groupFiles(specFolders: readonly string[], names: ReadonlyMap<string, string>, all: readonly ReliefFile[], sea = false, folded: readonly ReliefFolded[] = []): { folders: string[]; held: ReliefFile[][]; components: ReliefComponent[]; owner: (path: string) => number } {
  const specced = [...new Set([".", ...specFolders])].sort();
  const files = new Map<string, ReliefFile[]>(specced.map((f) => [f, []]));
  for (const f of all) files.get(ownerIn(specced, f.file))!.push(f);

  // A component holding others gives up its own files' folders as districts; a leaf's subfolders are its spec's to claim.
  // A project with no spec yet stands in its folders too, so before adoption it reads as its folders, not one slab.
  const holdsOthers = (folder: string) => (folder === "." && specced.length === 1 && !sea) || specced.some((o) => o !== folder && (folder === "." || o.startsWith(folder + "/")));
  const districts = new Map<string, { of: string; files: ReliefFile[] }>();
  for (const folder of specced.filter(holdsOthers)) {
    // A folder the spec declares folded is the component's own, never land no one holds: its files stay in the component's block.
    const groups = districtsOf(folder, files.get(folder)!.filter((f) => !foldedIn(folded, f.file)));
    if (groups.size < 2) continue; // one district would only be the component again
    const moved = new Set<string>();
    for (const [sub, held] of groups) {
      districts.set(sub, { of: folder, files: held });
      for (const f of held) moved.add(f.file);
    }
    files.set(folder, files.get(folder)!.filter((f) => !moved.has(f.file)));
  }

  const folders = [...specced, ...districts.keys()].sort();
  const held = folders.map((folder) => (districts.get(folder)?.files ?? files.get(folder)!).slice().sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file)));
  const components: ReliefComponent[] = folders.map((folder, ci) => {
    const district = districts.get(folder);
    const mine = held[ci]!;
    return {
      folder,
      name: district ? folder.slice(district.of === "." ? 0 : district.of.length + 1) + "/" : (names.get(folder) ?? (folder === "." ? "root" : folder)),
      ...(district ? { district: true as const } : {}),
      ...(folder === "." && !specFolders.includes(".") ? { unnamed: true as const } : {}),
      files: mine.length,
      lines: mine.reduce((n, f) => n + f.lines, 0),
      unreached: mine.reduce((n, f) => n + (f.reached ? 0 : f.lines), 0),
    };
  });
  const index = new Map(folders.map((f, i) => [f, i]));
  const districtFolders = [...districts.keys()];
  // A path belongs to its deepest component, then within it to the district whose folder holds it, tests and all.
  const owner = (path: string): number => {
    const own = ownerIn(specced, path);
    const district = districtFolders.find((d) => path.startsWith(d + "/") && districts.get(d)!.of === own);
    return index.get(district ?? own)!;
  };

  return { folders, held, components, owner };
}

/**
 * A reading's files grouped again as though only some specs existed: the
 * components and districts those specs make, each folder's files with the
 * landings that changed them, and each landing's lines per component summed
 * from its files'. Landings keep their places, so a file's landing indices
 * still name the same landings.
 */
export function regroup(landings: readonly ReliefLanding[], files: readonly ReliefFileLanded[], specFolders: readonly string[], names: ReadonlyMap<string, string>, sea = false, folded: readonly ReliefFolded[] = []): { components: ReliefComponent[]; landings: ReliefLanding[]; files: Record<string, ReliefFileLanded[]> } {
  const landed = new Map(files.map((f) => [f.file, f]));
  const { folders, held, components } = groupFiles(specFolders, names, files.map(({ file, lines, reached }) => ({ file, lines, reached })), sea, folded);
  const perLanding = landings.map(() => new Map<number, number>());
  const out: Record<string, ReliefFileLanded[]> = {};
  held.forEach((mine, ci) => {
    out[folders[ci]!] = mine.map((f) => {
      const l = landed.get(f.file)?.l;
      for (const [li, changed] of l ?? []) perLanding[li]?.set(ci, (perLanding[li]!.get(ci) ?? 0) + changed);
      return l === undefined ? f : { ...f, l };
    });
  });
  return { components, landings: landings.map((l, li) => ({ ...l, c: [...perLanding[li]!] })), files: out };
}
