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

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configIgnore } from "../adapters/project-files.ts";
import { sourceFiles } from "../economy/source.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { forProject, sourceProvider } from "./languages.ts";
import type { LoadedPlugin } from "./plugin.ts";
import { BUNDLED_DIR } from "./registry.ts";
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

/** The check projects plugin check holds a language's plugin to: the bundled one for the language and the plugin's own, each read as its files. */
function checkTexts(plugin: LoadedPlugin): string[] {
  const texts: string[] = [];
  for (const file of [join(BUNDLED_DIR, plugin.name, "check.json"), join(plugin.dir, "check.json")]) {
    if (!existsSync(file)) continue;
    try {
      const project = JSON.parse(readFileSync(file, "utf8")) as { files?: Record<string, string>; language?: { files?: string[] } };
      for (const path of project.language?.files ?? []) {
        const text = project.files?.[path];
        if (text !== undefined && !texts.includes(text)) texts.push(text);
      }
    } catch {
      // A check.json that will not read is plugin check's to refuse; the census counts what it can.
    }
  }
  return texts;
}

/** The census of every language the project reads. */
export function shapeCensus(rootGiven: string): LanguageShapes[] {
  const root = resolve(rootGiven);
  const config = readEnforcementConfig(root);
  const ignore = configIgnore(root);
  return forProject(root, () =>
    config.languages.map((language): LanguageShapes => {
      const plugin = sourceProvider(language);
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
      for (const text of checkTexts(plugin)) for (const { shapes } of importShapes(plugin, text)) for (const shape of shapes) rows.get(shape)!.checked++;
      return { language, plugin: plugin.name, files: files.length, rows: [...rows.values()], blocksKnown: capturesStatements(plugin) };
    }),
  );
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
