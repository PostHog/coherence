/**
 * The reading of every component interface: the set of resolved references
 * from one component to another, taken through the language adapter.
 *
 * Every top-level declaration a non-test source file exports is resolved as
 * `name in file` and asked for its references; each reference site in
 * non-test code of another component adds the symbol to the interface from
 * the site's component to the declaring one, marked when it declares a type
 * only. Each entrance's handler is resolved the same way, with its static
 * reach: the declarations its code references and every one those reference,
 * through value references only, and the component interfaces that reach
 * uses. A private declaration is resolved too, but only for the reach: it is
 * referenced from its own file and is never an interface. Nothing here is
 * stored: the builder passes the reading into the page state, and every list
 * is sorted, so one tree reads the same every time. The adapter is started
 * in this process and never writes into the tree it reads, so a read-only
 * project can be read.
 *
 * This is Node-only; the browser bundle never imports it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageAdapter } from "../../adapters/adapter.ts";
import { projectSites } from "../../adapters/project-files.ts";
import { adapterFor } from "../../adapters/index.ts";
import { componentOf, declarationsOf, isTest, sourceFiles } from "../../economy/source.ts";
import { readEnforcementConfig } from "../../enforcement/config.ts";
import { loadSpecModel } from "../../spec/model.ts";
import type { EntranceResolution, InterfaceReading, InterfaceSymbol, ReachReference } from "./model.ts";

/** The config's ignore list: folders the spec walk skips are not read for declarations either. */
function ignoredFolders(root: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "coherence.config.json"), "utf8"));
    const ignore = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["ignore"] : undefined;
    return Array.isArray(ignore) ? ignore.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

/** Whether a declaration line declares a type only (an interface or a type alias): a route never follows one. */
export function isTypeDeclaration(line: string, language: string): boolean {
  return language === "typescript" && /^(?:export\s+)?(?:declare\s+)?(?:interface|type)\s/.test(line.trim());
}

interface ReachNode {
  component: string;
  name: string;
  file: string;
  type: boolean;
}

/**
 * A handler's static reach: every declaration its code references, and every
 * one those reference, through value references only (a type is never
 * followed), and the component interfaces that reach uses: each reference
 * from a reached declaration into another component's value declaration.
 */
export function reachOf(start: string, nodes: ReadonlyMap<string, ReachNode>, calls: ReadonlyMap<string, ReadonlyMap<string, number>>): ReachReference[] {
  const seen = new Set([start]);
  const queue = [start];
  const used = new Map<string, ReachReference>();
  while (queue.length > 0) {
    const at = queue.shift()!;
    const from = nodes.get(at);
    for (const [to, sites] of calls.get(at) ?? []) {
      const target = nodes.get(to);
      if (target === undefined || target.type) continue;
      if (from !== undefined && target.component !== from.component) {
        const key = `${from.component}\u0000${target.component}\u0000${target.name}\u0000${target.file}`;
        const known = used.get(key);
        if (known === undefined) used.set(key, { from: from.component, to: target.component, symbol: target.name, file: target.file, sites });
        else known.sites += sites;
      }
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return [...used.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.symbol.localeCompare(b.symbol) || a.file.localeCompare(b.file));
}

/** Read every component interface of the project at `root` through `adapter` (started here when not given). */
export async function readComponentInterfaces(root: string, given?: LanguageAdapter): Promise<InterfaceReading> {
  const config = readEnforcementConfig(root);
  const model = loadSpecModel(root, { runs: false });
  const adapter = given ?? adapterFor(config.language, root);
  try {
    const ready = await adapter.ready();
    if (!ready.ok) return { kind: "unread", because: `the ${config.language} instrument did not answer: ${ready.reason}` };
    const testFolders = config.testFolders;
    const files = sourceFiles(root, config.language, ignoredFolders(root)).filter((file) => !isTest(file, testFolders));
    const tally = new Map<string, InterfaceSymbol>();
    const unowned = { files: 0, lines: 0 };
    let declarations = 0;
    // The static reach: every resolved declaration, and each reference site's enclosing top-level declaration to it.
    const nodes = new Map<string, ReachNode>();
    const calls = new Map<string, Map<string, number>>();
    const call = (from: string, to: string): void => {
      const out = calls.get(from) ?? new Map<string, number>();
      calls.set(from, out);
      out.set(to, (out.get(to) ?? 0) + 1);
    };
    for (const file of files) {
      const owner = componentOf(model, file)?.folder;
      const text = readFileSync(join(root, file), "utf8");
      if (owner === undefined) {
        unowned.files += 1;
        unowned.lines += text.split("\n").length;
        continue;
      }
      const lines = text.split("\n");
      for (const declaration of declarationsOf(text, config.language)) {
        const type = isTypeDeclaration(lines[declaration.line - 1] ?? "", config.language);
        const node = `${file}#${declaration.name}`;
        nodes.set(node, { component: owner, name: declaration.name, file, type });
        if (declaration.exported) declarations += 1;
        const resolved = await adapter.resolve(`${declaration.name} in ${file}`, { component: owner, testFolders });
        if (!resolved.ok || resolved.definition.file !== file) continue;
        for (const site of projectSites(root, await adapter.references(resolved.definition))) {
          if (isTest(site.file, testFolders)) continue;
          // A private declaration is reached only from its own file: it widens a handler's reach, never an interface.
          if (!declaration.exported && site.file !== file) continue;
          const from = componentOf(model, site.file)?.folder;
          if (from === undefined) continue;
          const enclosing = site.symbol?.split(".")[0];
          if (enclosing !== undefined && enclosing !== "" && !(site.file === file && enclosing === declaration.name)) call(`${site.file}#${enclosing}`, node);
          if (from === owner || !declaration.exported) continue;
          const key = `${from}\u0000${owner}\u0000${declaration.name}\u0000${file}`;
          const known = tally.get(key);
          if (known === undefined) tally.set(key, { from, to: owner, symbol: declaration.name, file, sites: 1, ...(type ? { kind: "type" as const } : {}) });
          else known.sites += 1;
        }
      }
    }
    const entrances: EntranceResolution[] = [];
    for (const component of model.components) {
      for (const entrance of component.entrances) {
        if (entrance.handler === undefined) {
          entrances.push({ component: component.folder, name: entrance.name, reason: "no handler is named" });
          continue;
        }
        const name = entrance.handler.split(/\s+in\s+/)[0]!;
        const handler = entrance.file === undefined ? entrance.handler : `${name} in ${entrance.file}`;
        const resolved = await adapter.resolve(handler, { component: component.folder, testFolders });
        entrances.push(
          resolved.ok
            ? { component: component.folder, name: entrance.name, file: resolved.definition.file, reach: reachOf(`${resolved.definition.file}#${name}`, nodes, calls) }
            : { component: component.folder, name: entrance.name, reason: resolved.reason },
        );
      }
    }
    const symbols = [...tally.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.symbol.localeCompare(b.symbol) || a.file.localeCompare(b.file),
    );
    return { kind: "read", language: config.language, declarations, symbols, entrances, unowned };
  } catch (error) {
    return { kind: "unread", because: `the ${config.language} instrument failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (given === undefined) await adapter.close();
  }
}
