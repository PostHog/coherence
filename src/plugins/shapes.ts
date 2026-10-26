/**
 * coherence plugin shapes: which shapes of import a project's code takes, by
 * count, beside how many of each its language plugin's check projects hold.
 * A shape the project writes and no check project holds is one plugin check
 * never puts to the plugin, so a reader could miss every one of them and pass:
 * Python's check project held no import spanning lines while 14% of PostHog's
 * imports span lines, and the reader that missed them passed (df-7ac38ee4).
 *
 * Read through each language's parser and queries (syntax-trees.ts); a
 * language whose plugin names no parser is said so, never counted as holding
 * no imports. Advisory: a reading, never a duty, and it fails nothing.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configIgnore } from "../adapters/project-files.ts";
import { resolveModule, sourceFiles } from "../economy/source.ts";
import { checkProjects, inScratch } from "./check.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { forProject, sourceProvider } from "./languages.ts";
import type { LoadedPlugin } from "./plugin.ts";
import { capturesStatements, IMPORT_SHAPES, importShapes, type ImportShape } from "./syntax-trees.ts";

/** One shape's count in the project and in the plugin's check projects, with where the project first writes it. */
export interface ShapeRow {
  shape: ImportShape;
  here: number;
  checked: number;
  example?: string;
}

/** One language's census, or why it was not taken. */
export type LanguageShapes = { language: string; plugin: string; files: number; rows: ShapeRow[]; blocksKnown: boolean } | { language: string; plugin: string | undefined; notRead: string };

/**
 * The shapes each check project plugin check holds the plugin to puts to it:
 * the projects plugin check reads (the bundled one for the language, and the
 * plugin's own), and of their imports only those that resolve to a file of
 * the check project, which are the ones the imports duty compares; an import
 * of something outside it is in the text and checked by nothing.
 */
async function checkedShapes(plugin: LoadedPlugin, language: string): Promise<Map<ImportShape, number>> {
  const counted = new Map<ImportShape, number>();
  const projects = checkProjects(plugin, language);
  if ("refusal" in projects) return counted;
  const seen = new Set<string>();
  for (const { project } of projects) {
    await inScratch(project, plugin, language, (scratch) => {
      for (const file of project.language.files) {
        const text = project.files[file];
        if (text === undefined || seen.has(`${file}\u0000${text}`)) continue;
        seen.add(`${file}\u0000${text}`);
        for (const { shapes, specifier } of importShapes(plugin, text)) {
          if (resolveModule(scratch, file, specifier, language) === undefined) continue;
          for (const shape of shapes) counted.set(shape, (counted.get(shape) ?? 0) + 1);
        }
      }
    });
  }
  return counted;
}

/** The census of every language the project reads. */
export async function shapeCensus(rootGiven: string): Promise<LanguageShapes[]> {
  const root = resolve(rootGiven);
  const config = readEnforcementConfig(root);
  const ignore = configIgnore(root);
  const out: LanguageShapes[] = [];
  for (const language of config.languages) {
    const plugin = forProject(root, () => sourceProvider(language));
    const checked = plugin?.manifest.treeSitter === undefined ? new Map<ImportShape, number>() : await checkedShapes(plugin, language);
    out.push(forProject(root, (): LanguageShapes => {
      if (plugin === undefined) return { language, plugin: undefined, notRead: "no plugin provides it" };
      if (plugin.manifest.treeSitter === undefined) return { language, plugin: plugin.name, notRead: `plugin ${plugin.name} reads ${language} with hand-written readers, not a parser, so its imports' shapes are not read` };
      const rows = new Map<ImportShape, ShapeRow>(IMPORT_SHAPES.map((shape) => [shape, { shape, here: 0, checked: 0 }]));
      const files = sourceFiles(root, language, ignore);
      for (const file of files) {
        let text: string;
        try {
          text = readFileSync(join(root, file), "utf8");
        } catch {
          continue;
        }
        for (const { line, shapes } of importShapes(plugin, text)) {
          for (const shape of shapes) {
            const row = rows.get(shape)!;
            row.here++;
            row.example ??= `${file}:${line}`;
          }
        }
      }
      for (const [shape, count] of checked) rows.get(shape)!.checked = count;
      return { language, plugin: plugin.name, files: files.length, rows: [...rows.values()], blocksKnown: capturesStatements(plugin) };
    }));
  }
  return out;
}

/** The census as the command prints it: each shape's count here and in the check projects, and each the project writes that no check project holds named. */
export function shapesText(census: readonly LanguageShapes[]): string {
  const lines: string[] = [];
  for (const entry of census) {
    if ("notRead" in entry) {
      lines.push(`${entry.language}: not read: ${entry.notRead}`);
      continue;
    }
    lines.push(`${entry.language}, through plugin ${entry.plugin}'s parser: ${entry.files} files`);
    lines.push(`  ${"shape".padEnd(16)}${"here".padStart(9)}${"check".padStart(8)}  first here`);
    for (const row of entry.rows) {
      const unknown = row.shape === "inside a block" && !entry.blocksKnown;
      lines.push(`  ${row.shape.padEnd(16)}${(unknown ? "?" : String(row.here)).padStart(9)}${(unknown ? "?" : String(row.checked)).padStart(8)}  ${row.example ?? ""}`);
    }
    const untested = entry.rows.filter((r) => r.here > 0 && r.checked === 0 && !(r.shape === "inside a block" && !entry.blocksKnown));
    for (const row of untested) lines.push(`  UNTESTED  ${row.here} ${row.shape} import${row.here === 1 ? "" : "s"} here, none in the check projects: plugin check never puts this shape to the plugin, so a reader that misses every one passes. Add one (${row.example}) to the plugin's check.json files and readings.imports.`);
    if (!entry.blocksKnown) lines.push(`  the queries capture no whole statement (@import), so whether an import sits inside a block is not known`);
  }
  return lines.join("\n");
}
