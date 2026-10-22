/**
 * A Convex deployment's entrances, read with the TypeScript compiler's
 * parser and added to what the TypeScript plugin's rules detect: the public
 * functions any client can call, the routes of an HTTP router, and the
 * functions a cron table runs. An internal function is not one: only the
 * deployment's own code can call it, so the entrance that reaches it carries
 * its trust.
 *
 * The functions folder is the one a file's own import of
 * `_generated/server` or `_generated/api` names, read from the specifier (a
 * relative one resolves to it; a path alias ending in `<folder>/_generated/...`
 * names the nearest folder above the file by that name), so a file outside
 * the folder Convex deploys is never read as a function.
 */

import { posix } from "node:path";
import type * as TS from "typescript";
import type { EntranceCandidate, EntranceSyntax } from "../../src/plugins/api.ts";
import { typescriptCompiler } from "../../src/plugins/api.ts";
import { parse } from "./convex-api.ts";

/** The builders whose functions any client of the deployment can call; the internal* builders' only the deployment's own code can. */
const PUBLIC_BUILDERS: ReadonlySet<string> = new Set(["query", "mutation", "action", "httpAction"]);
const CRON_SCHEDULES: ReadonlySet<string> = new Set(["interval", "cron", "hourly", "daily", "weekly", "monthly"]);

function ts(): typeof TS {
  return typescriptCompiler("the Convex plugin reads a Convex project's entrances with its parser");
}

/** The functions folder a generated-module specifier in `file` names, or undefined when it names none. */
function folderNamed(file: string, specifier: string, module: "api" | "server"): string | undefined {
  const bare = specifier.replace(/\.(js|ts|d\.ts)$/, "");
  const suffix = `_generated/${module}`;
  if (bare !== suffix && !bare.endsWith(`/${suffix}`)) return undefined;
  if (bare.startsWith(".")) {
    const folder = posix.normalize(posix.join(posix.dirname(file), bare.slice(0, -suffix.length) || "."));
    return folder.replace(/\/$/, "") || ".";
  }
  // A path alias: the nearest folder above the file named as the alias names it.
  const name = posix.basename(bare.slice(0, -suffix.length - 1));
  for (let folder = posix.dirname(file); folder !== "."; folder = posix.dirname(folder)) if (posix.basename(folder) === name) return folder;
  return undefined;
}

/** What a file imports from its functions folder's generated modules and from convex/server, local name to exported name. */
interface Imports {
  folder: string | undefined;
  server: Map<string, string>;
  api: Map<string, string>;
  convexServer: Map<string, string>;
  /** Every other named import, local name to the name it is exported under. */
  named: Map<string, string>;
}

function importsOf(file: string, source: TS.SourceFile): Imports {
  const compiler = ts();
  const out: Imports = { folder: undefined, server: new Map(), api: new Map(), convexServer: new Map(), named: new Map() };
  for (const statement of source.statements) {
    if (!compiler.isImportDeclaration(statement) || !compiler.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !compiler.isNamedImports(bindings)) continue;
    const specifier = statement.moduleSpecifier.text;
    const server = folderNamed(file, specifier, "server");
    const api = folderNamed(file, specifier, "api");
    const into = server !== undefined ? out.server : api !== undefined ? out.api : specifier === "convex/server" ? out.convexServer : out.named;
    if (server !== undefined || api !== undefined) out.folder ??= server ?? api;
    for (const element of bindings.elements) into.set(element.name.text, (element.propertyName ?? element.name).text);
  }
  return out;
}

/** The path a client calls a function of `file` by, below the functions folder: `model/player.ts`'s join is model.player.join. */
function calledAs(file: string, folder: string, name: string): string | undefined {
  const module = file.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "");
  if (folder !== "." && !module.startsWith(`${folder}/`)) return undefined;
  const below = folder === "." ? module : module.slice(folder.length + 1);
  return below.startsWith("..") ? undefined : `${below.split("/").join(".")}.${name}`;
}

/** The property names along a chain on an identifier, through dots and static brackets: `internal.cleanup["sweep"]` is internal, cleanup, sweep. */
function chain(node: TS.Expression): string[] | undefined {
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
    } else break;
  }
  return compiler.isIdentifier(at) ? [at.text, ...segments] : undefined;
}

/** The value of a property named `key` in an object literal. */
function property(object: TS.ObjectLiteralExpression, key: string): TS.Expression | undefined {
  const compiler = ts();
  for (const element of object.properties) {
    if (compiler.isPropertyAssignment(element) && (compiler.isIdentifier(element.name) || compiler.isStringLiteral(element.name)) && element.name.text === key) return element.initializer;
    if (compiler.isShorthandPropertyAssignment(element) && element.name.text === key) return element.name;
  }
  return undefined;
}

/** The entrances Convex's own shapes make in one file. */
export function convexCandidates(file: string, text: string): EntranceCandidate[] {
  if (!/_generated\/|convex\/server/.test(text)) return [];
  const compiler = ts();
  const source = parse(file, text);
  const imports = importsOf(file, source);
  const lineOf = (node: TS.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const found: EntranceCandidate[] = [];
  // The variables made by convex/server's httpRouter() and cronJobs(), by local name.
  const made = new Map<string, "httpRouter" | "cronJobs">();
  for (const statement of source.statements) {
    if (!compiler.isVariableStatement(statement)) continue;
    const exported = (compiler.getModifiers(statement) ?? []).some((m) => m.kind === compiler.SyntaxKind.ExportKeyword);
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (!compiler.isIdentifier(declaration.name) || init === undefined || !compiler.isCallExpression(init) || !compiler.isIdentifier(init.expression)) continue;
      const callee = init.expression.text;
      const factory = imports.convexServer.get(callee);
      if (factory === "httpRouter" || factory === "cronJobs") made.set(declaration.name.text, factory);
      const builder = imports.server.get(callee);
      if (!exported || builder === undefined || !PUBLIC_BUILDERS.has(builder) || builder === "httpAction" || imports.folder === undefined) continue;
      const path = calledAs(file, imports.folder, declaration.name.text);
      if (path === undefined) continue;
      found.push({ file, line: lineOf(statement), symbol: declaration.name.text, rule: "Convex function", why: `export const ${declaration.name.text} = ${callee}(...), ${builder} from ${imports.folder === "." ? "" : `${imports.folder}/`}_generated/server: any client of the deployment calls it as ${path}` });
    }
  }
  if (made.size === 0) return found;
  const visit = (node: TS.Node): void => {
    if (compiler.isCallExpression(node) && compiler.isPropertyAccessExpression(node.expression) && compiler.isIdentifier(node.expression.expression)) {
      const table = node.expression.expression.text;
      const method = node.expression.name.text;
      const kind = made.get(table);
      if (kind === "httpRouter" && method === "route") route(node, table);
      else if (kind === "cronJobs" && CRON_SCHEDULES.has(method)) cron(node, table, method);
    }
    compiler.forEachChild(node, visit);
  };
  const route = (call: TS.CallExpression, router: string): void => {
    const spec = call.arguments[0];
    if (spec === undefined || !compiler.isObjectLiteralExpression(spec)) return;
    const path = property(spec, "path") ?? property(spec, "pathPrefix");
    const handler = property(spec, "handler");
    if (path === undefined || !compiler.isStringLiteralLike(path) || handler === undefined) return;
    const method = property(spec, "method");
    const where = `${method !== undefined && compiler.isStringLiteralLike(method) ? method.text : "any method"} ${path.text}${property(spec, "pathPrefix") === path ? "*" : ""}`;
    // An inline httpAction(...) is the route's own code: the file is its handler. A named one is registered here and declared where it is imported from.
    const inline = compiler.isCallExpression(handler);
    const local = compiler.isIdentifier(handler) ? handler.text : undefined;
    const symbol = inline || local === undefined ? "" : (imports.named.get(local) ?? imports.server.get(local) ?? local);
    found.push({ file, line: lineOf(call), symbol, rule: "Convex HTTP route", why: `${where} routed by ${router}.route(...) to ${inline ? "an inline handler" : (local ?? handler.getText(source))}`, ...(symbol === "" ? {} : { registered: true as const }) });
  };
  const cron = (call: TS.CallExpression, table: string, schedule: string): void => {
    const name = call.arguments[0];
    const target = call.arguments.find((argument) => {
      const segments = compiler.isPropertyAccessExpression(argument) || compiler.isElementAccessExpression(argument) ? chain(argument) : undefined;
      return segments !== undefined && imports.api.has(segments[0]!) && segments.length >= 3;
    });
    if (target === undefined) return;
    const segments = chain(target as TS.Expression)!;
    const label = name !== undefined && compiler.isStringLiteralLike(name) ? `"${name.text}" ` : "";
    found.push({ file, line: lineOf(call), symbol: segments.at(-1)!, rule: "Convex cron", why: `the cron ${label}${table}.${schedule}(...) registers: Convex runs ${imports.api.get(segments[0]!)}.${segments.slice(1).join(".")} on that schedule, with no caller`, registered: true });
  };
  visit(source);
  return found;
}

/** The TypeScript plugin's entrance syntax with Convex's shapes added: a Convex candidate takes the place of any other rule's at its line. */
export function convexEntrances(beneath: EntranceSyntax | undefined): EntranceSyntax {
  if (beneath === undefined) throw new Error("the Convex plugin extends typescript, whose plugin supplies no entrance syntax to add to");
  return {
    ...beneath,
    candidates(file, text, wrappers) {
      const convex = beneath.isCode(file) ? convexCandidates(file, text) : [];
      const lines = new Set(convex.map((c) => c.line));
      return [...beneath.candidates(file, text, wrappers).filter((c) => !lines.has(c.line)), ...convex];
    },
  };
}
