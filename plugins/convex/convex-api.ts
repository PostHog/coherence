/**
 * Convex's generated API, read with the TypeScript compiler's parser. A
 * Convex project calls its functions through the object `convex dev`
 * generates into `<functions folder>/_generated/api`: `internal.telemetry.send`
 * is the `send` export of `telemetry.ts`, `api.model.telemetry.track` the
 * `track` export of `model/telemetry.ts`. The object's type is computed from
 * the modules, so the language server never links such a property back to
 * the export, and a chokepoint over a Convex function would see no reference
 * at all. The Convex plugin adds these sites to what the TypeScript adapter
 * reports.
 *
 * Read from the syntax tree, never from the text: a comment, a string, a
 * template's text or a regular expression literal is never a reference and
 * never hides one. A local that shadows the imported object is not told
 * apart, and the object passed around under another name is not followed.
 */

import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type * as TS from "typescript";
import { typescriptCompiler } from "../../src/plugins/api.ts";

/** Where Convex generates its API object and its server builders, below the functions folder. */
const GENERATED_API_FILES = ["_generated/api.d.ts", "_generated/api.ts", "_generated/api.js"];
const GENERATED_SERVER_FILES = ["_generated/server.d.ts", "_generated/server.ts", "_generated/server.js"];

/** The names `_generated/api` exports the function references under. */
const GENERATED_OBJECTS: ReadonlySet<string> = new Set(["api", "internal"]);

/** A Convex function module: the functions folder that holds it, and the path the generated API reaches it by. */
export interface ConvexModule {
  /** The functions folder, project-relative, "." for the root: the nearest folder above the file holding both `_generated/api` and `_generated/server`. */
  folder: string;
  /** The module's path below the folder, one property per segment: `model/telemetry.ts` is ["model", "telemetry"]. */
  path: string[];
}

function ts(): typeof TS {
  return typescriptCompiler("the Convex plugin reads a Convex project's code with its parser");
}

/** A file's syntax tree. */
export function parse(file: string, text: string): TS.SourceFile {
  const compiler = ts();
  return compiler.createSourceFile(file, text, compiler.ScriptTarget.Latest, true, /\.[cm]?jsx?$/.test(file) ? compiler.ScriptKind.JSX : compiler.ScriptKind.TSX);
}

/** The functions folder a project-relative path sits under, read on disk so a gitignored _generated folder still counts; undefined outside one. */
export function functionsFolder(root: string, file: string): string | undefined {
  for (let folder = posix.dirname(file); ; folder = posix.dirname(folder)) {
    const holds = (generated: readonly string[]): boolean => generated.some((name) => existsSync(join(root, folder === "." ? name : `${folder}/${name}`)));
    if (holds(GENERATED_API_FILES) && holds(GENERATED_SERVER_FILES)) return folder;
    if (folder === "." || folder.startsWith("..")) return undefined;
  }
}

/** The Convex module a project file is, or undefined when no folder above it holds Convex's generated API and server builders, or the file is generated itself. */
export function convexModule(root: string, file: string): ConvexModule | undefined {
  const folder = functionsFolder(root, file);
  if (folder === undefined) return undefined;
  const below = folder === "." ? file : file.slice(folder.length + 1);
  if (below.split("/").includes("_generated")) return undefined;
  return { folder, path: below.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "").split("/") };
}

/**
 * Whether an import specifier in `file` names the folder's generated module
 * (`_generated/api` or `_generated/server`): a relative one must resolve
 * there, a path alias must end in the folder's own name and the module, at
 * a segment boundary (`myconvex/_generated/api` is not `convex`'s).
 */
export function namesGenerated(file: string, specifier: string, folder: string, module: "api" | "server"): boolean {
  const bare = specifier.replace(/\.(js|ts|d\.ts)$/, "");
  const generated = folder === "." ? `_generated/${module}` : `${folder}/_generated/${module}`;
  if (bare.startsWith(".")) return posix.normalize(posix.join(posix.dirname(file), bare)) === generated;
  const tail = folder === "." ? `_generated/${module}` : `${posix.basename(folder)}/_generated/${module}`;
  return bare === tail || bare.endsWith(`/${tail}`);
}

/** The local names a file imports from the folder's generated module, each with the name it is exported under: `generated` -> `internal` for `internal as generated`. */
export function importedFrom(source: TS.SourceFile, file: string, folder: string, module: "api" | "server"): Map<string, string> {
  const compiler = ts();
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (!compiler.isImportDeclaration(statement) || !compiler.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!namesGenerated(file, statement.moduleSpecifier.text, folder, module)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !compiler.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) names.set(element.name.text, (element.propertyName ?? element.name).text);
  }
  return names;
}

/** The property names along a chain of property and static element accesses rooted at an identifier: `internal.cleanup["sweep"]` is internal, cleanup, sweep. */
function chainOf(node: TS.Expression): { root: TS.Identifier; segments: string[] } | undefined {
  const compiler = ts();
  const segments: string[] = [];
  let at: TS.Expression = node;
  for (;;) {
    if (compiler.isPropertyAccessExpression(at)) {
      segments.unshift(at.name.text);
      at = at.expression;
    } else if (compiler.isElementAccessExpression(at) && compiler.isStringLiteralLike(at.argumentExpression)) {
      segments.unshift(at.argumentExpression.text);
      at = at.expression;
    } else if (compiler.isParenthesizedExpression(at) || compiler.isNonNullExpression(at)) {
      at = at.expression;
    } else break;
  }
  return compiler.isIdentifier(at) ? { root: at, segments } : undefined;
}

/** The innermost named declarations enclosing a node, outermost first, as `outer.inner`; undefined at module top level. */
export function enclosingName(node: TS.Node): string | undefined {
  const compiler = ts();
  const names: string[] = [];
  for (let at: TS.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    const named = (at as { name?: TS.Node }).name;
    const declares = compiler.isFunctionDeclaration(at) || compiler.isClassDeclaration(at) || compiler.isMethodDeclaration(at) || compiler.isVariableDeclaration(at) || compiler.isPropertyAssignment(at);
    if (declares && named !== undefined && compiler.isIdentifier(named)) names.unshift(named.text);
  }
  return names.length === 0 ? undefined : names.join(".");
}

/** One place a file reaches a function through the generated API: zero-based line and character of the chain's root, and the declaration enclosing it. */
export interface GeneratedApiSite {
  line: number;
  character: number;
  symbol: string | undefined;
}

/**
 * Where a file reaches one of a module's exported functions through its
 * folder's generated API: a chain on `api` or `internal` (under whatever name
 * the file imports it by) along the module's path, then one of `names`.
 */
export function generatedApiReferences(file: string, text: string, target: ConvexModule & { names: readonly string[] }): GeneratedApiSite[] {
  if (target.names.length === 0 || !text.includes("_generated/api")) return [];
  const source = parse(file, text);
  const objects = new Set([...importedFrom(source, file, target.folder, "api")].filter(([, exported]) => GENERATED_OBJECTS.has(exported)).map(([local]) => local));
  if (objects.size === 0) return [];
  const compiler = ts();
  const wanted = new Set(target.names);
  const found: GeneratedApiSite[] = [];
  const visit = (node: TS.Node): void => {
    // A chain is read once, at its outermost access: the accesses inside it are its own prefixes.
    const outermost = (compiler.isPropertyAccessExpression(node) || compiler.isElementAccessExpression(node)) && !((compiler.isPropertyAccessExpression(node.parent) || compiler.isElementAccessExpression(node.parent)) && node.parent.expression === node);
    if (outermost) {
      const chain = chainOf(node as TS.Expression);
      if (chain !== undefined && objects.has(chain.root.text) && chain.segments.length === target.path.length + 1 && target.path.every((segment, i) => chain.segments[i] === segment) && wanted.has(chain.segments[target.path.length]!)) {
        const at = source.getLineAndCharacterOfPosition(chain.root.getStart(source));
        found.push({ line: at.line, character: at.character, symbol: enclosingName(node) });
      }
    }
    compiler.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The names a module exports a local declaration under, which are the names the generated API gives it: its own name when an export modifier declares it, and every name an export list gives it ("default" for a default export). */
export function exportedNames(file: string, text: string, local: string): string[] {
  const compiler = ts();
  const source = parse(file, text);
  const names = new Set<string>();
  for (const statement of source.statements) {
    const exported = compiler.canHaveModifiers(statement) && (compiler.getModifiers(statement) ?? []).some((m) => m.kind === compiler.SyntaxKind.ExportKeyword);
    const isDefault = exported && (compiler.getModifiers(statement as TS.HasModifiers) ?? []).some((m) => m.kind === compiler.SyntaxKind.DefaultKeyword);
    if (exported && compiler.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (compiler.isIdentifier(declaration.name) && declaration.name.text === local) names.add(local);
    } else if (exported && (compiler.isFunctionDeclaration(statement) || compiler.isClassDeclaration(statement)) && statement.name?.text === local) {
      names.add(isDefault ? "default" : local);
    } else if (compiler.isExportDeclaration(statement) && statement.moduleSpecifier === undefined && statement.exportClause !== undefined && compiler.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) if ((element.propertyName ?? element.name).text === local) names.add(element.name.text);
    } else if (compiler.isExportAssignment(statement) && !statement.isExportEquals && compiler.isIdentifier(statement.expression) && statement.expression.text === local) {
      names.add("default");
    }
  }
  return [...names];
}

/** Every name a module exports a value under: what a protected module is reached through. */
export function moduleExports(file: string, text: string): string[] {
  const compiler = ts();
  const source = parse(file, text);
  const names = new Set<string>();
  for (const statement of source.statements) {
    const modifiers = compiler.canHaveModifiers(statement) ? (compiler.getModifiers(statement) ?? []) : [];
    if (!modifiers.some((m) => m.kind === compiler.SyntaxKind.ExportKeyword)) {
      if (compiler.isExportDeclaration(statement) && statement.moduleSpecifier === undefined && statement.exportClause !== undefined && compiler.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text);
      }
      continue;
    }
    if (compiler.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (compiler.isIdentifier(declaration.name)) names.add(declaration.name.text);
    } else if ((compiler.isFunctionDeclaration(statement) || compiler.isClassDeclaration(statement)) && statement.name !== undefined) {
      names.add(modifiers.some((m) => m.kind === compiler.SyntaxKind.DefaultKeyword) ? "default" : statement.name.text);
    }
  }
  return [...names];
}

/**
 * The builder a module's exported declaration calls (`internalAction` for
 * `export const send = internalAction({...})`), as the module imports it from
 * its own folder's `_generated/server`; undefined when the declaration is no
 * registered Convex function.
 */
export function convexBuilder(file: string, text: string, folder: string, local: string): string | undefined {
  const compiler = ts();
  const source = parse(file, text);
  const builders = importedFrom(source, file, folder, "server");
  for (const statement of source.statements) {
    if (!compiler.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!compiler.isIdentifier(declaration.name) || declaration.name.text !== local) continue;
      const init = declaration.initializer;
      if (init !== undefined && compiler.isCallExpression(init) && compiler.isIdentifier(init.expression)) return builders.get(init.expression.text);
    }
  }
  return undefined;
}

/** The generated object a registered function is reached through: internal for an internal* builder, api for the others. */
export function generatedObjectFor(builder: string): "api" | "internal" {
  return builder.startsWith("internal") ? "internal" : "api";
}
