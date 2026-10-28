/**
 * Where a TypeScript or JavaScript import leads: what no parse can say, since
 * a module's place is the compiler's rule, not its syntax. What a file
 * declares and imports is read through the TSX grammar and typescript.scm
 * (the manifest's treeSitter), so this module reads no text.
 */

import { readFileSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";
import { isSourceFile, toRelative, type ModuleResolution } from "../../src/plugins/api.ts";
import { specifierCandidates } from "./typescript.ts";

/** One compilerOptions.paths entry: the pattern's text before and after its one `*` (none for an exact pattern), and its targets, project-relative. */
interface PathAlias {
  prefix: string;
  suffix: string | undefined;
  targets: string[];
}

/** The project tsconfig.json's path aliases, per root, kept while the file is unchanged. */
const ALIASES = new Map<string, { stamp: string; aliases: PathAlias[] }>();

/** A tsconfig's text as JSON: comments and trailing commas dropped, strings kept whole. */
function jsonOfTsconfig(text: string): unknown {
  const bare = text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[^]*?\*\//g, (all, string: string | undefined) => string ?? "").replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(bare);
}

/**
 * The path aliases the project's own tsconfig.json declares at its root
 * (compilerOptions.paths, against baseUrl or the root): `@/*` to `./src/*`.
 * Its extends chain is not followed. None when there is no tsconfig, it is
 * unreadable, or it declares none.
 */
export function pathAliases(root: string): PathAlias[] {
  const path = resolve(root, "tsconfig.json");
  let stamp: string;
  try {
    const stat = statSync(path, { bigint: true });
    stamp = `${stat.mtimeNs} ${stat.size}`;
  } catch {
    return [];
  }
  const known = ALIASES.get(root);
  if (known !== undefined && known.stamp === stamp) return known.aliases;
  let aliases: PathAlias[] = [];
  try {
    const options = (jsonOfTsconfig(readFileSync(path, "utf8")) as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } }).compilerOptions;
    const base = typeof options?.baseUrl === "string" ? options.baseUrl : ".";
    const paths = options?.paths;
    if (paths !== null && typeof paths === "object") {
      aliases = Object.entries(paths as Record<string, unknown>).flatMap(([pattern, targets]): PathAlias[] => {
        if (!Array.isArray(targets) || (pattern.match(/\*/g) ?? []).length > 1) return [];
        const star = pattern.indexOf("*");
        const kept = targets.filter((t): t is string => typeof t === "string").map((t) => posix.normalize(posix.join(base, t)));
        return [{ prefix: star === -1 ? pattern : pattern.slice(0, star), suffix: star === -1 ? undefined : pattern.slice(star + 1), targets: kept }];
      });
    }
  } catch {
    aliases = [];
  }
  ALIASES.set(root, { stamp, aliases });
  return aliases;
}

/** Where a non-relative specifier leads through the project's path aliases, project-relative and extension-free, longest prefix first; none for a package. */
export function aliasedSpecifiers(aliases: readonly PathAlias[], specifier: string): string[] {
  const matching = aliases.filter((a) => (a.suffix === undefined ? specifier === a.prefix : specifier.startsWith(a.prefix) && specifier.endsWith(a.suffix) && specifier.length >= a.prefix.length + a.suffix.length));
  matching.sort((a, b) => b.prefix.length - a.prefix.length);
  return matching.flatMap((a) => {
    const middle = a.suffix === undefined ? "" : specifier.slice(a.prefix.length, specifier.length - a.suffix.length);
    return a.targets.map((t) => (a.suffix === undefined ? t : t.replace(/\*/g, () => middle)));
  });
}

/** A relative specifier names a project file (the file itself, its TypeScript twin of a .js specifier, or a folder's index), and so does one the project's tsconfig paths alias to such a file. */
export const TYPESCRIPT_RESOLVE: ModuleResolution = {
  resolveModule(root, from, specifier, vanished) {
    const joins = specifier.startsWith(".") ? [posix.normalize(posix.join(posix.dirname(from), specifier))] : aliasedSpecifiers(pathAliases(root), specifier);
    for (const joined of joins) {
      const found = resolveJoined(root, joined, vanished);
      if (found !== undefined) return found;
    }
    return undefined;
  },
  // Every file a wildcard re-export's specifier may name: without the file list, `./foo.js` is foo.ts in a NodeNext project and foo.js in a JavaScript one.
  modulePaths: (from, specifier) => specifierCandidates(from, specifier),
};

/** The project file a joined path names: the file itself, its TypeScript twin, or its folder's index. */
function resolveJoined(root: string, joined: string, vanished: ReadonlySet<string>): string | undefined {
  const candidates = [joined, ...[".ts", ".tsx", ".mts", ".cts"].map((ext) => joined.replace(/\.js$/, "") + ext), ...[".ts", ".tsx"].map((ext) => posix.join(joined, "index" + ext))];
  for (const candidate of candidates) {
    const rel = toRelative(root, resolve(root, candidate));
    if (rel === undefined) continue;
    if (vanished.has(rel) && isSourceFile(rel, "typescript")) return rel;
    try {
      if (statSync(resolve(root, rel)).isFile() && isSourceFile(rel, "typescript")) return rel;
    } catch {
      // Not there; try the next.
    }
  }
  return undefined;
}
