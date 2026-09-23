/**
 * What economy and mass read from the tree without an instrument: which
 * files are source, which top-level names a file declares, which names it
 * imports and from where, and which component a file lies in. A plain scan,
 * never a parse; the adapter confirms what matters through resolve and
 * references, and mass says when a number came from the scan alone.
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { isTestPath } from "../adapters/adapter.ts";
import { projectFiles, underIgnored } from "../adapters/project-files.ts";
import type { Language } from "../adapters/index.ts";
import type { Component, SpecModel } from "../spec/model.ts";

/** Folders never walked, whatever the config says; the same set the spec walker skips. */
export const EXCLUDED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", ".coherence", ".claude", ".codex", "public"]);

const EXTENSIONS: Record<Language, readonly string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  python: [".py"],
};

export function isSourceFile(file: string, language: Language): boolean {
  if (/\.d\.ts$/.test(file)) return false;
  return EXTENSIONS[language].some((ext) => file.endsWith(ext));
}

/**
 * Every source file of the project for the language, project-relative with
 * forward slashes, sorted: the project's own files (projectFiles), never
 * under a dot folder or a folder no walk enters.
 */
export function sourceFiles(root: string, language: Language, ignore: readonly string[] = []): string[] {
  const skip = new Set([...EXCLUDED_FOLDERS, ...ignore]);
  return projectFiles(resolve(root)).filter((rel) => {
    if (!isSourceFile(rel, language)) return false;
    return !rel.split("/").slice(0, -1).some((name) => name.startsWith(".")) && !underIgnored(rel, skip);
  });
}

/** A path as project-relative with forward slashes, or undefined when it lies outside the root. */
export function toRelative(root: string, path: string): string | undefined {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const rel = relative(resolve(root), absolute).split(sep).join("/");
  if (rel === "" || rel === ".." || rel.startsWith("../")) return undefined;
  return rel;
}

export interface Declaration {
  name: string;
  /** One-based. */
  line: number;
  exported: boolean;
}

const TS_DECLARATION = /^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;
const PY_DECLARATION = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)|^([A-Z_][A-Z0-9_]*)\s*(?::[^=]+)?=/;

/** The top-level names a file declares, by a plain scan of line starts. */
export function declarationsOf(text: string, language: Language): Declaration[] {
  const found: Declaration[] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");
    let name: string | undefined;
    let exported = false;
    if (language === "typescript") {
      const m = TS_DECLARATION.exec(line);
      if (m !== null) {
        name = m[2];
        exported = m[1] !== undefined;
      }
    } else {
      const m = PY_DECLARATION.exec(line);
      if (m !== null) {
        name = m[1] ?? m[2];
        exported = !(name ?? "").startsWith("_");
      }
    }
    if (name === undefined || seen.has(name)) return;
    seen.add(name);
    found.push({ name, line: index + 1, exported });
  });
  return found;
}

export interface Import {
  /** The imported name, or undefined for a whole-module import (namespace or side effect). */
  name: string | undefined;
  /** The module file, project-relative, when it resolves to a file under the root. */
  module: string;
}

const NONE: ReadonlySet<string> = new Set();

const TS_NAMED = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const TS_DEFAULT = /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']([^"']+)["']/g;
const TS_NAMESPACE = /import\s+(?:type\s+)?\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*["']([^"']+)["']/g;
const TS_SIDE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const PY_FROM = /^from\s+([\w.]+)\s+import\s+([^\n]+)$/gm;
const PY_IMPORT = /^import\s+([\w.]+)/gm;

/**
 * Resolve a module specifier from a file to a project-relative source file,
 * or undefined for a package or a file not under the root. A path in
 * `vanished` (a file the working change deleted or renamed away) resolves as
 * though it were still on disk, so its importers can be found.
 */
export function resolveModule(root: string, from: string, specifier: string, language: Language, vanished: ReadonlySet<string> = NONE): string | undefined {
  if (language === "python") {
    const dots = /^(\.*)(.*)$/.exec(specifier)!;
    const up = dots[1]!.length;
    const parts = dots[2] === "" ? [] : dots[2]!.split(".");
    let base = posix.dirname(from);
    for (let i = 1; i < up; i++) base = posix.dirname(base);
    const candidates = up === 0 ? [posix.join(...parts) + ".py", posix.join(...parts, "__init__.py")] : [posix.join(base, ...parts) + ".py", posix.join(base, ...parts, "__init__.py")];
    return candidates.find((c) => vanished.has(c) || existsSync(resolve(root, c)));
  }
  if (!specifier.startsWith(".")) return undefined;
  const joined = posix.normalize(posix.join(posix.dirname(from), specifier));
  const candidates = [joined, ...[".ts", ".tsx", ".mts", ".cts"].map((ext) => joined.replace(/\.js$/, "") + ext), ...[".ts", ".tsx"].map((ext) => posix.join(joined, "index" + ext))];
  for (const candidate of candidates) {
    const rel = toRelative(root, resolve(root, candidate));
    if (rel === undefined) continue;
    if (vanished.has(rel) && isSourceFile(rel, language)) return rel;
    try {
      if (statSync(resolve(root, rel)).isFile() && isSourceFile(rel, language)) return rel;
    } catch {
      // Not there; try the next.
    }
  }
  return undefined;
}

/** The names a file imports from files under the root, with the module each comes from; `vanished` as for resolveModule. */
export function importsOf(root: string, file: string, text: string, language: Language, vanished: ReadonlySet<string> = NONE): Import[] {
  const found: Import[] = [];
  const add = (name: string | undefined, specifier: string): void => {
    const module = resolveModule(root, file, specifier, language, vanished);
    if (module === undefined || module === file) return;
    found.push({ name, module });
  };
  if (language === "typescript") {
    for (const m of text.matchAll(TS_NAMED)) {
      for (const piece of m[1]!.split(",")) {
        const cleaned = piece.replace(/^\s*type\s+/, "").trim();
        if (cleaned === "") continue;
        const original = cleaned.split(/\s+as\s+/)[0]!.trim();
        add(original, m[2]!);
      }
    }
    for (const m of text.matchAll(TS_DEFAULT)) add("default", m[2]!);
    for (const m of text.matchAll(TS_NAMESPACE)) add(undefined, m[1]!);
    for (const m of text.matchAll(TS_SIDE)) add(undefined, m[1]!);
  } else {
    for (const m of text.matchAll(PY_FROM)) {
      for (const piece of m[2]!.replace(/[()]/g, "").split(",")) {
        const name = piece.trim().split(/\s+as\s+/)[0]!.trim();
        if (name !== "" && name !== "*") add(name, m[1]!);
      }
    }
    for (const m of text.matchAll(PY_IMPORT)) add(undefined, m[1]!);
  }
  const seen = new Set<string>();
  return found.filter((i) => {
    const key = `${i.name ?? "*"} ${i.module}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The component whose folder is the nearest ancestor of the file, or undefined when no spec lies above it. */
export function componentOf(model: SpecModel, file: string): Component | undefined {
  let best: Component | undefined;
  for (const component of model.components) {
    const inside = component.folder === "." || file === component.folder || file.startsWith(component.folder + "/");
    if (!inside) continue;
    if (best === undefined || component.folder.length > best.folder.length) best = component;
  }
  return best;
}

/** Whether a project-relative file is a test by folder or by name. */
export function isTest(file: string, testFolders: readonly string[]): boolean {
  return isTestPath(file, testFolders);
}
