/**
 * Parses kept across hook calls. A hook is a fresh process each time, so a
 * parse it needs of every spec or practice file would read every one of them
 * at every tool call; kept here, a file's parse is reused while its size and
 * modification time stand, and only a file that changed is read again,
 * through the work meter's door. The store is transient state under
 * .coherence/cache, regenerated whenever it is missing or torn.
 *
 * A file rewritten within the same millisecond to the same size keeps its
 * old parse, the same trust the prompt's tree key places in a stat.
 */

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readProjectText, type ReadKind } from "./work-meter.ts";

interface Kept<T> {
  version: string;
  files: Record<string, { size: number; mtimeMs: number; value: T }>;
}

/** Where a store is kept: transient, as the feed cursors and traces are. */
export function keptParsePath(root: string, store: string): string {
  return join(root, ".coherence", "cache", `${store}.json`);
}

function loadKept<T>(path: string, version: string): Kept<T> {
  try {
    const kept = JSON.parse(readFileSync(path, "utf8")) as Kept<T>;
    if (kept.version === version && typeof kept.files === "object" && kept.files !== null) return kept;
  } catch {
    // Missing or torn: every file is read again, and the store is written whole.
  }
  return { version, files: {} };
}

/**
 * The parse of each file in `rels` (project-relative), reused from the store
 * while the file's stat matches, read and parsed otherwise. A file that cannot
 * be stat'd or read is left out. The store keeps exactly the files asked for;
 * `version` names the parse's shape, and a store of another version is
 * discarded.
 */
export function keptParses<T>(root: string, store: string, version: string, rels: readonly string[], what: ReadKind, parse: (text: string, rel: string) => T): Map<string, T> {
  const path = keptParsePath(root, store);
  const kept = loadKept<T>(path, version);
  const out = new Map<string, T>();
  const next: Kept<T> = { version, files: {} };
  let moved = Object.keys(kept.files).length !== rels.length;
  for (const rel of rels) {
    let stat;
    try {
      stat = statSync(join(root, rel));
    } catch {
      moved = true;
      continue;
    }
    const held = kept.files[rel];
    if (held !== undefined && held.size === stat.size && held.mtimeMs === stat.mtimeMs) {
      out.set(rel, held.value);
      next.files[rel] = held;
      continue;
    }
    let value: T;
    try {
      value = parse(readProjectText(join(root, rel), what), rel);
    } catch {
      moved = true;
      continue;
    }
    // Kept as JSON gives it back, so a parse read from the store and one made now are the same value.
    value = JSON.parse(JSON.stringify(value)) as T;
    out.set(rel, value);
    next.files[rel] = { size: stat.size, mtimeMs: stat.mtimeMs, value };
    moved = true;
  }
  if (moved) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      // Written aside and renamed into place: two hooks at once never leave a torn store.
      const aside = `${path}.${process.pid}`;
      writeFileSync(aside, JSON.stringify(next));
      renameSync(aside, path);
    } catch {
      // Without the store the next call reads again; nothing is lost but time.
    }
  }
  return out;
}
