/**
 * Where an installed package is, asked of Node's package resolver and never
 * spelled as a path: the language servers both adapters start and the
 * tsserver the TypeScript one drives. Under pnpm, Coherence's own
 * dependencies sit beside its package in the store, not inside it, so a path
 * built as <Coherence>/node_modules/<package> names nothing; the resolver,
 * asked from a file of Coherence's own, finds them wherever the package
 * manager put them. A package's exports map can refuse a subpath (TypeScript
 * 7 exports no lib/tsserver.js), so a package's folder is found by its
 * manifest, through the folders the resolver's own lookup walks, and a file
 * inside it is read from there.
 *
 * This module is the one place an adapter learns where a package is
 * (Adapters.spec.md, "packages found by the resolver"); a server that is no
 * package (rust-analyzer) is found on the machine by its own plugin.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A file of Coherence's own, which the resolver walks up from to find Coherence's dependencies. */
export const COHERENCE_FROM = fileURLToPath(import.meta.url);

export interface InstalledPackage {
  /** The package's folder. */
  dir: string;
  version: string;
  manifest: Record<string, unknown>;
}

/** The file the resolver starts from for a project: one at its root, which need not exist. */
export function projectFrom(root: string): string {
  return join(root, "package.json");
}

/**
 * A package as Node's resolver finds it from a file: its manifest resolved,
 * or, when the package's exports refuse that subpath, the first folder of the
 * resolver's lookup that holds it.
 */
export function installedPackage(name: string, from: string): InstalledPackage | undefined {
  const require = createRequire(from);
  const candidates: string[] = [];
  try {
    candidates.push(require.resolve(`${name}/package.json`));
  } catch {
    // not installed, or its exports refuse the manifest: the lookup folders below
  }
  for (const folder of require.resolve.paths(name) ?? []) candidates.push(join(folder, name, "package.json"));
  for (const manifestPath of candidates) {
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      if (manifest["name"] !== name) continue;
      return { dir: dirname(manifestPath), version: typeof manifest["version"] === "string" ? manifest["version"] : "unknown", manifest };
    } catch {
      continue;
    }
  }
  return undefined;
}

/** A regular file inside a package, or undefined when the package does not hold it. */
export function packageFile(found: InstalledPackage, file: string): string | undefined {
  const path = join(found.dir, file);
  try {
    return statSync(path).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

/** The script a package's manifest names for a bin, when the package holds it. */
function binScript(found: InstalledPackage, bin: string): string | undefined {
  const bins = found.manifest["bin"];
  const named = typeof bins === "string" ? (found.manifest["name"] === bin ? bins : undefined) : bins !== null && typeof bins === "object" ? (bins as Record<string, unknown>)[bin] : undefined;
  return typeof named === "string" ? packageFile(found, named) : undefined;
}

/** How to start a language server: a package's script run by this Node, or a binary on PATH, with every place looked. */
export type ServerLocation = { found: true; command: string; args: string[]; path: string; looked: string[] } | { found: false; looked: string[] };

/**
 * A language server's binary: the package resolved from the project, then
 * from Coherence's own module, then the bin on PATH, in that order; absent,
 * the places looked, each named.
 */
export function locateServer(pkg: string, bin: string, root: string, coherenceFrom: string = COHERENCE_FROM, path: string = process.env["PATH"] ?? ""): ServerLocation {
  const looked: string[] = [];
  for (const [whose, from] of [["the project", projectFrom(root)], ["Coherence", coherenceFrom]] as const) {
    const found = installedPackage(pkg, from);
    const script = found === undefined ? undefined : binScript(found, bin);
    looked.push(found === undefined ? `${pkg} resolved from ${whose} (${dirname(from)}): not installed` : `${pkg} ${found.version} resolved from ${whose} (${found.dir})${script === undefined ? `: no ${bin} bin` : ""}`);
    if (script !== undefined) return { found: true, command: process.execPath, args: [script], path: script, looked };
  }
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, bin);
    if (existsSync(candidate)) return { found: true, command: candidate, args: [], path: candidate, looked: [...looked, `${bin} on PATH (${candidate})`] };
  }
  looked.push(`${bin} on PATH: none`);
  return { found: false, looked };
}
