/**
 * The parses a session start pre-reads: each language its project reads
 * through a parser, every source file of it read once, so the project's kept
 * parses (syntax-trees.ts) hold every file as it stands and a later reading
 * of the whole project (mass, the economy's closure, the Structure reading)
 * parses only what changed. Run by the warm-up the session start launches,
 * detached, so no hook waits on it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configIgnore } from "../adapters/project-files.ts";
import { registryForLeaf } from "../adapters/project-config.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { forProject, sourceProvider, storeRootOf } from "../plugins/languages.ts";
import { warmParses } from "../plugins/syntax-trees.ts";
import { sourceFiles } from "./source.ts";

/**
 * Pre-read the project's files of every language it reads through a parser,
 * and, when the project is a leaf of a registry, the repository top's too:
 * the commands run there (mass, status) read every leaf, and the store they
 * read is the one the leaves share (storeRootOf). What each root and language
 * read, and how many of those it parsed rather than found kept.
 */
export function warmProjectParses(rootGiven: string): { root: string; language: string; read: number; parsed: number; skipped?: true }[] {
  const root = resolve(rootGiven);
  const top = registryForLeaf(root)?.top;
  return [root, ...(top === undefined || resolve(top) === root ? [] : [resolve(top)])].flatMap((at) => warmRoot(at).map((w) => ({ root: at, ...w })));
}

function warmRoot(root: string): { language: string; read: number; parsed: number; skipped?: true }[] {
  const config = readEnforcementConfig(root);
  const ignore = configIgnore(root);
  return forProject(root, () =>
    config.languages.flatMap((language) => {
      const plugin = sourceProvider(language);
      if (plugin?.manifest.treeSitter === undefined) return [];
      const files = sourceFiles(root, language, ignore);
      const texts = (function* () {
        for (const file of files) {
          try {
            yield readFileSync(resolve(root, file), "utf8");
          } catch {
            // A file gone since the walk listed it is no text to keep.
          }
        }
      })();
      return [{ language, ...warmParses(plugin, storeRootOf(root)!, texts) }];
    }),
  );
}
