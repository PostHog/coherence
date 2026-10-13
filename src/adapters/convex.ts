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
 * A scan, like the adapter's wildcard re-exports, over the file's code with
 * its comments and string contents blanked: a file's own import of `api` or
 * `internal` from this functions folder's `_generated/api` (a relative
 * specifier must resolve there; a path alias is taken at its word) names the
 * object, under whatever local name the file gives it, and a property chain
 * on that name along the module's path, across lines or not, ends in the
 * function. The object passed around under another name, or a local that
 * shadows the imported one, is not told apart.
 */

import { posix } from "node:path";
import { blankNonCode } from "./source-text.ts";

/** Where Convex generates its API object and its server builders, below the functions folder. */
const GENERATED_API_FILES = ["_generated/api.d.ts", "_generated/api.ts", "_generated/api.js"];
const GENERATED_SERVER_FILES = ["_generated/server.d.ts", "_generated/server.ts", "_generated/server.js"];

/** The names `_generated/api` exports the function references under. */
const GENERATED_OBJECTS = new Set(["api", "internal"]);

const IMPORT_LIST = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

/** A Convex function module: the functions folder that holds it, and the path the generated API reaches it by. */
export interface ConvexModule {
  /** The functions folder, project-relative: the nearest folder above the file holding `_generated/api`. */
  folder: string;
  /** The module's path below the folder, one property per segment: `model/telemetry.ts` is ["model", "telemetry"]. */
  path: string[];
}

/** The functions of one module a reference may name. */
export interface GeneratedApiTarget extends ConvexModule {
  names: readonly string[];
}

/** The Convex module a project file is, or undefined when no folder above it holds Convex's generated API and server builders, or the file is generated itself. */
export function convexModule(file: string, isFile: (path: string) => boolean): ConvexModule | undefined {
  for (let folder = posix.dirname(file); ; folder = posix.dirname(folder)) {
    const holds = (generated: readonly string[]): boolean => generated.some((name) => isFile(folder === "." ? name : `${folder}/${name}`));
    if (holds(GENERATED_API_FILES) && holds(GENERATED_SERVER_FILES)) {
      const below = folder === "." ? file : file.slice(folder.length + 1);
      if (below.startsWith("_generated/")) return undefined;
      return { folder, path: below.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "").split("/") };
    }
    if (folder === "." || folder === "/" || folder.startsWith("..")) return undefined;
  }
}

/** Whether an import specifier names this functions folder's generated API: a relative one must resolve there, a path alias must end there. */
function namesGeneratedApi(file: string, specifier: string, folder: string): boolean {
  const generated = folder === "." ? "_generated/api" : `${folder}/_generated/api`;
  const bare = specifier.replace(/\.js$/, "");
  if (bare.startsWith(".")) return posix.normalize(posix.join(posix.dirname(file), bare)) === generated;
  return folder === "." ? bare.endsWith("_generated/api") : bare.endsWith(`${posix.basename(folder)}/_generated/api`);
}

/** The local names a file imports this folder's generated API objects by: `api`, or `generated` for `internal as generated`. */
function generatedObjectNames(file: string, code: string, folder: string): string[] {
  const names: string[] = [];
  for (const statement of code.matchAll(IMPORT_LIST)) {
    if (!namesGeneratedApi(file, statement[2]!, folder)) continue;
    for (const item of statement[1]!.split(",")) {
      const named = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item);
      if (named !== null && GENERATED_OBJECTS.has(named[1]!)) names.push(named[2] ?? named[1]!);
    }
  }
  return names;
}

function escape(name: string): string {
  return name.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

/** The zero-based positions where a file reaches one of the target's functions through its folder's generated API. */
export function generatedApiReferences(file: string, text: string, target: GeneratedApiTarget): { line: number; character: number }[] {
  if (target.names.length === 0 || !text.includes("_generated/api")) return [];
  const objects = generatedObjectNames(file, blankNonCode(text, false), target.folder);
  if (objects.length === 0) return [];
  const code = blankNonCode(text, true);
  const chain = target.path.map((segment) => `\\s*\\.\\s*${escape(segment)}`).join("");
  const reference = new RegExp(`(?<![\\w$.])(?:${objects.map(escape).join("|")})${chain}\\s*\\.\\s*(?:${target.names.map(escape).join("|")})(?![\\w$])`, "g");
  const starts = [0];
  for (let k = 0; k < text.length; k++) if (text[k] === "\n") starts.push(k + 1);
  const found: { line: number; character: number }[] = [];
  for (const match of code.matchAll(reference)) {
    let line = starts.length - 1;
    while (starts[line]! > match.index) line -= 1;
    found.push({ line, character: match.index - starts[line]! });
  }
  return found;
}

/** The builder a Convex function's declaration calls, as its file imports it from _generated/server (`internalAction`), or undefined when the declaration is no registered function. */
export function convexBuilder(text: string, declaration: string): string | undefined {
  const callee = /=\s*([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/.exec(declaration)?.[1];
  if (callee === undefined) return undefined;
  for (const statement of blankNonCode(text, false).matchAll(IMPORT_LIST)) {
    if (!/(?:^|\/)_generated\/server(?:\.js)?$/.test(statement[2]!)) continue;
    for (const item of statement[1]!.split(",")) {
      const named = /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item);
      if (named !== null && (named[2] ?? named[1]) === callee) return named[1];
    }
  }
  return undefined;
}

/** The names a module exports a local declaration under, which are the names the generated API gives it: its own when declared with export, and every name an export list gives it. */
export function exportedNames(text: string, local: string): string[] {
  const code = blankNonCode(text, false);
  const names = new Set<string>();
  if (new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:const|let|var|function\\*?|class)\\s+${escape(local)}(?![\\w$])`, "m").test(code)) names.add(local);
  for (const list of code.matchAll(/\bexport\s*(?:type\s*)?\{([^}]*)\}(?!\s*from\b)/g)) {
    for (const item of list[1]!.split(",")) {
      const named = /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item);
      if (named !== null && named[1] === local) names.add(named[2] ?? named[1]);
    }
  }
  return [...names];
}

/** The generated object a registered function is reached through: internal for an internal* builder, api for the others. */
export function generatedObjectFor(builder: string): "api" | "internal" {
  return builder.startsWith("internal") ? "internal" : "api";
}
