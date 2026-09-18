/**
 * Economy: the context closure of a change, computed from the model.
 *
 * Given files, the closure is what a reader must load to modify them
 * safely:
 *
 *   given       the files themselves
 *   hop out     the files defining what the given files reference: each
 *               imported name is resolved through the adapter and kept only
 *               when a reference site in a given file uses it outside an
 *               import specifier
 *   hop in      the files referencing what the given files define: each
 *               top-level declaration is resolved as `name in file` and every
 *               reference site outside the given files is a hop in
 *   spec        the spec of every component a closure file lies in
 *   invariant   every invariant whose protected thing or chokepoint lives in
 *               a given file: its spec, and the other side's file
 *
 * Nothing is stored; the closure is a reading over references. With no
 * instrument the hops are skipped and invariants come from the files the
 * latest run touched, and the closure says so. Deterministic for one tree:
 * entries sort by path and every why sorts within its entry.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Definition, LanguageAdapter } from "../adapters/adapter.ts";
import type { Language } from "../adapters/index.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { loadSpecModel, type ModelInvariant, type SpecModel } from "../spec/model.ts";
import { componentOf, declarationsOf, importsOf, isTest, toRelative } from "./source.ts";

export interface ClosureEntry {
  file: string;
  bytes: number;
  /** Why the file is in the closure, one line each, sorted. */
  why: string[];
}

export interface Instrument {
  language: string;
  /** none when no adapter answered; the reason says why. */
  server: "cold" | "warm" | "none";
  reason?: string;
}

export interface Closure {
  given: string[];
  entries: ClosureEntry[];
  bytes: number;
  /** bytes / 4, rounded up. */
  tokens: number;
  instrument: Instrument;
  /** Whether the hops were computed through references or skipped. */
  hops: "references" | "skipped";
}

export interface ClosureOptions {
  adapter?: LanguageAdapter | undefined;
  /** How the adapter was reached, for the report. */
  server?: "cold" | "warm" | undefined;
  /** Why no adapter is available, when none is. */
  instrumentReason?: string | undefined;
  model?: SpecModel | undefined;
}

export function tokenEstimate(bytes: number): number {
  return Math.ceil(bytes / 4);
}

class Builder {
  private readonly entries = new Map<string, Set<string>>();
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  add(file: string, why: string): void {
    const set = this.entries.get(file) ?? new Set<string>();
    set.add(why);
    this.entries.set(file, set);
  }

  has(file: string): boolean {
    return this.entries.has(file);
  }

  files(): string[] {
    return [...this.entries.keys()].sort();
  }

  build(): ClosureEntry[] {
    return this.files().map((file) => {
      let bytes = 0;
      try {
        bytes = statSync(resolve(this.root, file)).size;
      } catch {
        bytes = 0;
      }
      return { file, bytes, why: [...this.entries.get(file)!].sort() };
    });
  }
}

function chokepointForms(invariant: ModelInvariant): { protects: string; chokepoint: string }[] {
  return invariant.enforcements.flatMap((e) => (e.form === "chokepoint" ? [{ protects: e.protects, chokepoint: e.chokepoint }] : []));
}

/** The closure of a change to `paths` (absolute or project-relative). */
export async function predictClosure(rootGiven: string, paths: readonly string[], options: ClosureOptions = {}): Promise<Closure> {
  const root = resolve(rootGiven);
  const config = readEnforcementConfig(root);
  const language: Language = config.language;
  const model = options.model ?? loadSpecModel(root);
  const given = [...new Set(paths.map((p) => toRelative(root, p)).filter((p): p is string => p !== undefined))].sort();
  for (const file of given) {
    const absolute = resolve(root, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`${file}: not a file under ${root}`);
  }
  const givenSet = new Set(given);
  const out = new Builder(root);
  for (const file of given) out.add(file, "given");

  const adapter = options.adapter;
  const instrument: Instrument =
    adapter === undefined
      ? { language, server: "none", reason: options.instrumentReason ?? "no adapter" }
      : { language: adapter.language, server: options.server ?? "cold" };

  const texts = new Map<string, string>();
  for (const file of given) texts.set(file, readFileSync(resolve(root, file), "utf8"));

  if (adapter !== undefined) {
    const hint = (file: string): { component: string; testFolders: readonly string[] } => ({ component: componentOf(model, file)?.folder ?? ".", testFolders: config.testFolders });

    // Hop in: who references what the given files declare.
    for (const file of given) {
      for (const declaration of declarationsOf(texts.get(file)!, language)) {
        const resolved = await adapter.resolve(`${declaration.name} in ${file}`, hint(file));
        if (!resolved.ok) continue;
        for (const site of await adapter.references(resolved.definition)) {
          if (givenSet.has(site.file)) continue;
          const kind = isTest(site.file, config.testFolders) ? "test references" : "references";
          out.add(site.file, `${kind} ${declaration.name} (${file}) at line ${site.line}${site.symbol === undefined ? "" : ` in ${site.symbol}`}`);
        }
      }
    }

    // Hop out: what the given files reference, confirmed by a reference site in the given file (an import specifier is one).
    for (const file of given) {
      for (const imported of importsOf(root, file, texts.get(file)!, language)) {
        if (givenSet.has(imported.module)) continue;
        const name = imported.name === undefined ? imported.module : `${imported.name} in ${imported.module}`;
        const resolved = await adapter.resolve(name, hint(imported.module));
        if (!resolved.ok) continue;
        const sites = await adapter.references(resolved.definition);
        const used = sites.filter((s) => s.file === file);
        if (used.length === 0) continue;
        const label = imported.name === undefined ? "the module" : imported.name;
        out.add(imported.module, `defines ${label}, referenced by ${file} at line${used.length === 1 ? "" : "s"} ${used.map((s) => s.line).join(", ")}`);
      }
    }

    // Invariants whose protected thing or chokepoint lives in a given file.
    for (const component of model.components) {
      for (const invariant of component.invariants) {
        for (const form of chokepointForms(invariant)) {
          const resolvedProtects = await adapter.resolve(form.protects, { component: component.folder, testFolders: config.testFolders });
          const resolvedChokepoint = await adapter.resolve(form.chokepoint, { component: component.folder, testFolders: config.testFolders });
          const protectedDef: Definition | undefined = resolvedProtects.ok ? resolvedProtects.definition : undefined;
          const chokepointDef: Definition | undefined = resolvedChokepoint.ok ? resolvedChokepoint.definition : undefined;
          const here = [protectedDef?.file, chokepointDef?.file].some((f) => f !== undefined && givenSet.has(f));
          if (!here) continue;
          const label = `${component.folder}/${invariant.name}`;
          out.add(component.specPath, `invariant ${label} reaches a given file`);
          if (protectedDef !== undefined) out.add(protectedDef.file, `protected thing ${form.protects} of ${label}`);
          if (chokepointDef !== undefined) out.add(chokepointDef.file, `chokepoint ${form.chokepoint} of ${label}`);
        }
      }
    }
  } else {
    // No instrument: the latest run's entry files stand in for resolution; the hops are skipped.
    for (const component of model.components) {
      for (const invariant of component.invariants) {
        const latest = invariant.latest.find((l) => l.form === "chokepoint");
        if (latest === undefined || !latest.files.some((f) => givenSet.has(f))) continue;
        const label = `${component.folder}/${invariant.name}`;
        out.add(component.specPath, `invariant ${label} reaches a given file (from the run at ${latest.at.slice(0, 10)})`);
        for (const f of latest.files) out.add(f, `touched by the chokepoint check of ${label} (from the run at ${latest.at.slice(0, 10)})`);
      }
    }
  }

  // The spec of every component a closure file lies in.
  for (const file of out.files()) {
    if (file.endsWith(".spec.md")) continue;
    const component = componentOf(model, file);
    if (component === undefined) continue;
    out.add(component.specPath, `spec of ${component.folder === "." ? "the entry component" : component.folder}, which holds ${file}`);
  }

  const entries = out.build();
  const bytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  return { given, entries, bytes, tokens: tokenEstimate(bytes), instrument, hops: adapter === undefined ? "skipped" : "references" };
}

export interface FormatOptions {
  /** The most entries printed; the rest are counted. */
  limit?: number | undefined;
}

export const DEFAULT_LIMIT = 40;

export function formatClosure(closure: Closure, options: FormatOptions = {}): string {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const lines: string[] = [];
  lines.push(`economy of a change to ${closure.given.join(", ")}: ${closure.entries.length} file${closure.entries.length === 1 ? "" : "s"}, ~${closure.tokens} tokens (${closure.bytes} bytes / 4)`);
  for (const entry of closure.entries.slice(0, limit)) {
    lines.push(`${entry.file}  (~${tokenEstimate(entry.bytes)} tokens)`);
    for (const why of entry.why) lines.push(`    ${why}`);
  }
  if (closure.entries.length > limit) lines.push(`  and ${closure.entries.length - limit} more; --json for the whole closure`);
  const i = closure.instrument;
  lines.push(i.server === "none" ? `hops skipped: instrument unavailable (${i.reason ?? "no adapter"}); invariants taken from the latest run` : `hops through references; instrument ${i.language} (${i.server})`);
  return lines.join("\n");
}
