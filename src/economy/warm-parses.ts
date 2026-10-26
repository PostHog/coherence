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
import { readEnforcementConfig } from "../enforcement/config.ts";
import { forProject, sourceProvider } from "../plugins/languages.ts";
import { warmParses } from "../plugins/syntax-trees.ts";
import { sourceFiles } from "./source.ts";

/** Pre-read the project's files of every language it reads through a parser; what each language read, and how many of those it parsed rather than found kept. */
export function warmProjectParses(rootGiven: string): { language: string; read: number; parsed: number }[] {
  const root = resolve(rootGiven);
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
      return [{ language, ...warmParses(plugin, root, texts) }];
    }),
  );
}
