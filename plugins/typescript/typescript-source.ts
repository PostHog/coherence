/**
 * Where a TypeScript or JavaScript import leads: what no parse can say, since
 * a module's place is the compiler's rule, not its syntax. What a file
 * declares and imports is read through the TSX grammar and typescript.scm
 * (the manifest's treeSitter), so this module reads no text.
 */

import { statSync } from "node:fs";
import { posix, resolve } from "node:path";
import { isSourceFile, toRelative, type ModuleResolution } from "../../src/plugins/api.ts";
import { specifierCandidates } from "./typescript.ts";

/** Only a relative specifier names a project file: the file itself, its TypeScript twin of a .js specifier, or a folder's index. */
export const TYPESCRIPT_RESOLVE: ModuleResolution = {
  resolveModule(root, from, specifier, vanished) {
    if (!specifier.startsWith(".")) return undefined;
    const joined = posix.normalize(posix.join(posix.dirname(from), specifier));
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
  },
  // Every file a wildcard re-export's specifier may name: without the file list, `./foo.js` is foo.ts in a NodeNext project and foo.js in a JavaScript one.
  modulePaths: (from, specifier) => specifierCandidates(from, specifier),
};
