/**
 * coherence plugin calibrate: the text reading's declarations held to the
 * language server's own account of each file, over a real project. The text
 * readings are Coherence's instruments (mass, the economy, the interface
 * reading count by them), and an instrument is calibrated against an
 * independent reference: here the server the language's adapter drives.
 *
 * Two counts, never one verdict. A name the reading finds and the server
 * does not is a misread (a name read out of a string or a comment). A name
 * the server reports and the reading leaves out is counted by its symbol kind,
 * since a reading may leave a kind out by design (Python's lowercase module
 * variables), and a kind left out wholesale shows which.
 *
 * Advisory: a reading, it fails nothing. Its languages' servers are started
 * as a run starts them, so it costs what the server costs to load.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LanguageAdapter } from "../adapters/adapter.ts";
import { configIgnore } from "../adapters/project-files.ts";
import { declarationsOf, sourceFiles } from "../economy/source.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { coreAdapter, forProject } from "./languages.ts";

/** LSP SymbolKind names, by number. */
const KINDS: Record<number, string> = { 1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class", 6: "method", 7: "property", 8: "field", 9: "constructor", 10: "enum", 11: "interface", 12: "function", 13: "variable", 14: "constant", 15: "string", 16: "number", 17: "boolean", 18: "array", 19: "object", 20: "key", 21: "null", 22: "enum member", 23: "struct", 24: "event", 25: "operator", 26: "type parameter" };

/** One language's calibration, or why it was not taken. */
export type Calibration =
  | { language: string; files: number; declared: number; agreed: number; readerOnly: string[]; readerOnlyCount: number; serverOnly: { kind: string; count: number; example: string }[] }
  | { language: string; notRun: string };

/** The calibration of each language the project reads, over its first `limit` source files in path order. */
export async function calibrate(rootGiven: string, limit = 200): Promise<Calibration[]> {
  const root = resolve(rootGiven);
  const config = readEnforcementConfig(root);
  const ignore = configIgnore(root);
  const out: Calibration[] = [];
  for (const language of config.languages) {
    out.push(
      await forProject(root, async (): Promise<Calibration> => {
        let adapter: LanguageAdapter | undefined;
        try {
          adapter = coreAdapter(language, root);
        } catch (error) {
          return { language, notRun: `its adapter could not be built: ${error instanceof Error ? error.message : String(error)}` };
        }
        if (adapter === undefined) return { language, notRun: "no plugin's adapter answers for it" };
        try {
          if (adapter.topLevelSymbols === undefined) return { language, notRun: "its adapter offers no topLevelSymbols to calibrate against" };
          const ready = await adapter.ready();
          if (!ready.ok) return { language, notRun: `its language server is not up: ${ready.reason}` };
          const files = sourceFiles(root, language, ignore).slice(0, limit);
          let declared = 0;
          let agreed = 0;
          const readerOnly: string[] = [];
          let readerOnlyCount = 0;
          const serverOnly = new Map<string, { count: number; example: string }>();
          for (const file of files) {
            let text: string;
            try {
              text = readFileSync(join(root, file), "utf8");
            } catch {
              continue;
            }
            const read = declarationsOf(text, language);
            const symbols = await adapter.topLevelSymbols(file);
            const named = new Set(symbols.map((s) => s.name));
            const reading = new Set(read.map((d) => d.name));
            for (const d of read) {
              declared++;
              if (named.has(d.name)) agreed++;
              else {
                readerOnlyCount++;
                if (readerOnly.length < 10) readerOnly.push(`${file}:${d.line} ${d.name}`);
              }
            }
            for (const s of symbols) {
              if (reading.has(s.name)) continue;
              const kind = KINDS[s.kind] ?? `kind ${s.kind}`;
              const known = serverOnly.get(kind) ?? { count: 0, example: `${file}:${s.line} ${s.name}` };
              known.count++;
              serverOnly.set(kind, known);
            }
          }
          return { language, files: files.length, declared, agreed, readerOnly, readerOnlyCount, serverOnly: [...serverOnly].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.count - a.count) };
        } finally {
          await adapter.close();
        }
      }),
    );
  }
  return out;
}

/** The calibration as the command prints it. */
export function calibrationText(calibrations: readonly Calibration[]): string {
  const lines: string[] = [];
  for (const c of calibrations) {
    if ("notRun" in c) {
      lines.push(`${c.language}: not run: ${c.notRun}`);
      continue;
    }
    lines.push(`${c.language}: ${c.files} files, the text reading's ${c.declared} declarations against the language server's top-level symbols`);
    lines.push(`  ${c.agreed} of ${c.declared} the server reports too`);
    if (c.readerOnlyCount > 0) {
      lines.push(`  MISREAD  ${c.readerOnlyCount} the reading declares and the server reports no top-level symbol of: a name read from a string, a comment or another scope${c.readerOnlyCount > c.readerOnly.length ? `; the first ${c.readerOnly.length}` : ""}:`);
      for (const r of c.readerOnly) lines.push(`    ${r}`);
    }
    if (c.serverOnly.length > 0) {
      lines.push("  the server reports, the reading leaves out (by design, or missed), by kind:");
      for (const s of c.serverOnly) lines.push(`    ${String(s.count).padStart(6)} ${s.kind.padEnd(14)} e.g. ${s.example}`);
    }
  }
  return lines.join("\n");
}
