/**
 * Convex's generated API, read as references. A Convex project calls its
 * functions through the object `convex dev` generates into
 * `<functions folder>/_generated/api`: `internal.telemetry.send` is the
 * `send` export of `telemetry.ts`, `api.model.telemetry.track` the `track`
 * export of `model/telemetry.ts`. The object's type is computed from the
 * modules (ApiFromModules, FilterApi), so the language server never links
 * such a property back to the export, and a chokepoint over a Convex
 * function would see no reference at all. The TypeScript adapter adds these
 * sites to what the server reports.
 *
 * A scan, like the adapter's wildcard re-exports: a file's own import of
 * `api` or `internal` from a `_generated/api` module names the object, under
 * whatever local name the file gives it, and a property chain on that name
 * along the module's path ends in the function. A chain split across lines,
 * or the object passed around under another name, is not read.
 */

import { posix } from "node:path";

/** Where Convex generates its API object, below the functions folder. */
const GENERATED_API_FILES = ["_generated/api.d.ts", "_generated/api.ts", "_generated/api.js"];

/** The names `_generated/api` exports the function references under. */
const GENERATED_OBJECTS = new Set(["api", "internal"]);

const IMPORT_FROM_GENERATED_API = /\bimport\s*\{([^}]*)\}\s*from\s*["']([^"']*_generated\/api(?:\.js)?)["']/g;

/** A Convex function module: the functions folder that holds it, and the path the generated API reaches it by. */
export interface ConvexModule {
  /** The functions folder, project-relative: the nearest folder above the file holding `_generated/api`. */
  folder: string;
  /** The module's path below the folder, one property per segment: `model/telemetry.ts` is ["model", "telemetry"]. */
  path: string[];
}

/** The Convex module a project file is, or undefined when no folder above it holds a generated API or the file is generated itself. */
export function convexModule(file: string, isFile: (path: string) => boolean): ConvexModule | undefined {
  for (let folder = posix.dirname(file); ; folder = posix.dirname(folder)) {
    if (GENERATED_API_FILES.some((generated) => isFile(folder === "." ? generated : `${folder}/${generated}`))) {
      const below = folder === "." ? file : file.slice(folder.length + 1);
      if (below.startsWith("_generated/")) return undefined;
      return { folder, path: below.replace(/\.(ts|tsx|mts|cts|js|mjs)$/, "").split("/") };
    }
    if (folder === "." || folder === "/") return undefined;
  }
}

/** The local names a file imports the generated API objects by: `api`, or `generated` for `internal as generated`. */
function generatedObjectNames(text: string): string[] {
  const names: string[] = [];
  for (const statement of text.matchAll(IMPORT_FROM_GENERATED_API)) {
    for (const item of statement[1]!.split(",")) {
      const named = /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item);
      if (named !== null && GENERATED_OBJECTS.has(named[1]!)) names.push(named[2] ?? named[1]!);
    }
  }
  return names;
}

function escape(name: string): string {
  return name.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

/**
 * The zero-based positions where a file reaches a function of the module
 * through the generated API: `name`, or any function of the module when
 * `name` is undefined (the protected thing is the module).
 */
export function generatedApiReferences(lines: readonly string[], modulePath: readonly string[], name: string | undefined): { line: number; character: number }[] {
  const objects = generatedObjectNames(lines.join("\n"));
  if (objects.length === 0) return [];
  const chain = modulePath.map((segment) => `\\s*\\.\\s*${escape(segment)}`).join("");
  const member = name === undefined ? "[A-Za-z_$][\\w$]*" : escape(name);
  const reference = new RegExp(`(?<![\\w$.])(?:${objects.map(escape).join("|")})${chain}\\s*\\.\\s*${member}(?![\\w$])`, "g");
  const found: { line: number; character: number }[] = [];
  lines.forEach((text, line) => {
    for (const match of text.matchAll(reference)) found.push({ line, character: match.index });
  });
  return found;
}
