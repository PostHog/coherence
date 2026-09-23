/**
 * The component interfaces an observation maps onto, with the positions the
 * mapping needs. The definition is Structure's (lexicon: component
 * interface; src/readings/scope/component-interfaces.ts on the Structure
 * line): every top-level declaration a non-test source file exports is
 * resolved as `name in file` and asked for its references; each reference
 * site in non-test code of another component adds the symbol to the interface
 * from the site's component to the declaring one. That reading keeps counts;
 * this one keeps what coverage is compared against: the declaration's range
 * and every site's position and syntactic form.
 *
 * Seam: when Structure's reading keeps its sites and ranges, this becomes a
 * call to it rather than a second walk.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageAdapter, Range, SiteForm } from "../adapters/adapter.ts";
import { configIgnore, projectSites } from "../adapters/project-files.ts";
import { componentOf, declarationsOf, isTest, sourceFiles } from "../economy/source.ts";
import type { EnforcementConfig } from "../enforcement/config.ts";
import type { SpecModel } from "../spec/model.ts";

export interface InterfaceSite {
  file: string;
  /** Zero-based, as the protocol counts. */
  line: number;
  character: number;
  form?: SiteForm;
}

/** One symbol a component interface carries, where it is declared, and where `from` references it. */
export interface InterfaceSymbol {
  from: string;
  to: string;
  symbol: string;
  file: string;
  range: Range;
  /**
   * What the declaration's keyword says can execute: `type` (a type or an
   * interface: nothing, ever), `value` (a literal, an enum), `body` (a
   * function, a class, an arrow a constant holds, a Python def), or `unknown`
   * (a constant whose value may hold a function; treated as able to execute).
   */
  declares: "type" | "value" | "body" | "unknown";
  sites: InterfaceSite[];
}

/** An entrance's handler, resolved, for the question whether any test executed it. */
export interface EntranceHandler {
  component: string;
  name: string;
  handler: string | undefined;
  file?: string;
  range?: Range;
  reason?: string;
}

export interface InterfaceMap {
  symbols: InterfaceSymbol[];
  entrances: EntranceHandler[];
}

/** The id a component interface goes by in a record: the ordered pair. */
export function interfaceId(from: string, to: string): string {
  return `${from} -> ${to}`;
}

/** What a declaration line's keyword says can execute. */
export function declares(line: string, language: string): InterfaceSymbol["declares"] {
  if (language === "python") return /^\s*(?:async\s+)?(?:def|class)\s/.test(line) ? "body" : "value";
  const m = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|const|let|var|class|interface|type|enum|namespace)\s/.exec(line);
  const keyword = m?.[1];
  if (keyword === "interface" || keyword === "type") return "type";
  if (keyword === "enum" || keyword === "namespace") return "value";
  if (keyword === "const" || keyword === "let" || keyword === "var") {
    const value = /=\s*(.*)$/.exec(line)?.[1]?.trim() ?? "";
    if (/^(async\s+)?(function\b|class\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(value)) return "body";
    if (/^([{["'`\d-]|new\s|true\b|false\b|null\b|undefined\b|Symbol\()/.test(value) || value === "") return "value";
    // Anything else (a call's result, an identifier) may hold a function: counted as able to execute, so never read as bodiless.
    return "unknown";
  }
  return "body";
}


/** Entrances, where the spec model carries them (the Structure line adds `## entrances`); none otherwise. */
function entrancesOf(model: SpecModel): { component: string; name: string; handler: string | undefined; file: string | undefined }[] {
  return model.components.flatMap((component) => {
    const declared = (component as unknown as { entrances?: { name: string; handler?: string; file?: string }[] }).entrances ?? [];
    return declared.map((e) => ({ component: component.folder, name: e.name, handler: e.handler, file: e.file }));
  });
}

/** Read every component interface with its positions, and every entrance's handler, through the adapter. */
export async function readInterfaceMap(root: string, adapter: LanguageAdapter, model: SpecModel, config: EnforcementConfig): Promise<InterfaceMap> {
  const testFolders = config.testFolders;
  const files = sourceFiles(root, config.language, configIgnore(root)).filter((file) => !isTest(file, testFolders));
  const tally = new Map<string, InterfaceSymbol>();
  for (const file of files) {
    const owner = componentOf(model, file)?.folder;
    if (owner === undefined) continue;
    const text = readFileSync(join(root, file), "utf8");
    const lines = text.split("\n");
    for (const declaration of declarationsOf(text, config.language)) {
      if (!declaration.exported) continue;
      const resolved = await adapter.resolve(`${declaration.name} in ${file}`, { component: owner, testFolders });
      if (!resolved.ok || resolved.definition.file !== file) continue;
      const kind = declares(lines[declaration.line - 1] ?? "", config.language);
      for (const site of projectSites(root, await adapter.references(resolved.definition))) {
        if (isTest(site.file, testFolders)) continue;
        const from = componentOf(model, site.file)?.folder;
        if (from === undefined || from === owner) continue;
        const key = `${from}\u0000${owner}\u0000${declaration.name}\u0000${file}`;
        const known = tally.get(key) ?? { from, to: owner, symbol: declaration.name, file, range: resolved.definition.range, declares: kind, sites: [] };
        known.sites.push({ file: site.file, line: site.line - 1, character: site.character, ...(site.form === undefined ? {} : { form: site.form }) });
        tally.set(key, known);
      }
    }
  }
  const entrances: EntranceHandler[] = [];
  for (const entrance of entrancesOf(model)) {
    if (entrance.handler === undefined) {
      entrances.push({ component: entrance.component, name: entrance.name, handler: undefined, reason: "no handler is named" });
      continue;
    }
    const handler = entrance.file === undefined ? entrance.handler : `${entrance.handler.split(/\s+in\s+/)[0]!} in ${entrance.file}`;
    const resolved = await adapter.resolve(handler, { component: entrance.component, testFolders });
    entrances.push(
      resolved.ok
        ? { component: entrance.component, name: entrance.name, handler: entrance.handler, file: resolved.definition.file, range: resolved.definition.range }
        : { component: entrance.component, name: entrance.name, handler: entrance.handler, reason: resolved.reason },
    );
  }
  const symbols = [...tally.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.symbol.localeCompare(b.symbol) || a.file.localeCompare(b.file));
  return { symbols, entrances };
}
