/**
 * TypeScript's entrance rules and the syntax they read by: the shapes
 * Next.js, Remix, TanStack Start and the HTTP routers fix, how a statement
 * spans its lines, what binds a name, which scripts run rather than are
 * imported (entrance-candidates.ts reads them through ENTRANCE_SYNTAX).
 */

import { posix } from "node:path";
import { languageOfFile } from "./language-files.ts";
import { blankNonCode } from "./source-text.ts";
import { escape, handlerName, lineOf, NEXT_ROUTE_METHODS, REMIX_ROUTE_EXPORTS, spanOf, throughOf, type EntranceCandidate, type EntranceSyntax } from "./entrance-candidates.ts";

/** The text from its first code: leading whitespace and comments skipped by a walk, never a backtracking pattern. */
function leadingCode(text: string): string {
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else return text.slice(i);
  }
}

/** The local names a file's code imports from a module whose specifier matches, each with the name it is exported under (`raw` -> `mutation` for `mutation as raw`) and the specifier. */
function importsFrom(code: string, specifier: RegExp): Map<string, { exported: string; from: string }> {
  const names = new Map<string, { exported: string; from: string }>();
  for (const statement of code.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (!specifier.test(statement[2]!)) continue;
    for (const item of statement[1]!.split(",")) {
      const named = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item);
      if (named !== null) names.set(named[2] ?? named[1]!, { exported: named[1]!, from: statement[2]! });
    }
  }
  return names;
}

/** The variables a file assigns from calling a factory it imports from the module: `http` for `const http = httpRouter()`. */
function madeBy(code: string, factory: string, specifier: RegExp): string[] {
  const local = [...importsFrom(code, specifier)].find(([, imported]) => imported.exported === factory)?.[0];
  if (local === undefined) return [];
  return [...code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*${escape(local)}\\s*\\(\\s*\\)`, "g"))].map((m) => m[1]!);
}

/** The path a Convex client calls a function by: the file below the functions folder its _generated/server import names, then the export; undefined for a file outside that folder, which Convex does not deploy. */
function convexApiPath(file: string, generatedServer: string, name: string): string | undefined {
  const module = file.replace(/\.(ts|tsx|mts|cts|js|mjs)$/, "");
  if (!generatedServer.startsWith(".")) return `${posix.basename(module)}.${name}`;
  const folder = posix.normalize(posix.join(posix.dirname(file), generatedServer.replace(/\/_generated\/server(?:\.js)?$/, "")));
  if (folder.startsWith("..") || (folder !== "." && !module.startsWith(`${folder}/`))) return undefined;
  const below = folder === "." ? module : module.slice(folder.length + 1);
  return `${below.split("/").join(".")}.${name}`;
}

/** The path segments of a generated API reference starting at `from` in the text (`internal.cleanup['sweep']` is ["cleanup", "sweep"]), read through dots and static brackets. */
function generatedApiPath(text: string, from: number): string[] {
  const segments: string[] = [];
  const step = /^\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(["'])([^"'\n]+)\2\s*\])/;
  let rest = text.slice(from).replace(/^(?:internal|api)/, "");
  for (let m = step.exec(rest); m !== null; m = step.exec(rest)) {
    segments.push(m[1] ?? m[3]!);
    rest = rest.slice(m[0].length);
  }
  return segments;
}

/** A local name as a handler resolves it: the name its module exports it under, and the project file that declares it, through the file's own import of it. */
type Declaration = { symbol: string; declaredIn?: string };

/** The lines of the call that opens at line i, from its first parenthesis to the one that closes it, read on the code with comments and strings blanked: the code and the text of those lines, and the last line's index. */
function callSpan(code: readonly string[], lines: readonly string[], i: number): { code: string; text: string; end: number } {
  let depth = 0;
  let opened = false;
  for (let j = i; j < code.length; j++) {
    for (const c of code[j]!) {
      if (c === "(") {
        depth += 1;
        opened = true;
      } else if (c === ")") depth -= 1;
      if (opened && depth === 0) return { code: code.slice(i, j + 1).join("\n"), text: lines.slice(i, j + 1).join("\n"), end: j };
    }
  }
  return { code: code[i] ?? "", text: lines[i] ?? "", end: i };
}

/** Whether an object literal opening in the code has a fetch method of its own: a fetch( directly inside it, after its brace or a comma, never in a nested object or a method's body. */
function hasFetchMethod(code: string): boolean {
  const open = code.indexOf("{");
  if (open < 0) return false;
  let depth = 0;
  let previous = "";
  for (let k = open; k < code.length; k++) {
    const c = code[k]!;
    if (depth === 1 && (previous === "{" || previous === ",") && /^\s*(?:async\s+)?fetch\s*\(/.test(code.slice(k))) return true;
    if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") {
      depth -= 1;
      if (depth === 0) return false;
    }
    if (!/\s/.test(c)) previous = c;
  }
  return false;
}

/** The builders Convex generates into _generated/server whose functions any client of the deployment can call; the internal* builders' functions only the deployment's own code can. */
const CONVEX_PUBLIC_BUILDERS: ReadonlySet<string> = new Set(["query", "mutation", "action"]);
const CONVEX_GENERATED_SERVER = /(?:^|\/)_generated\/server(?:\.js)?$/;
const CONVEX_SERVER = /^convex\/server$/;
const CONVEX_CRON_SCHEDULES = "interval|cron|hourly|daily|weekly|monthly";

function typescriptCandidates(file: string, text: string, wrappers: readonly string[], exists: (file: string) => boolean): EntranceCandidate[] {
  const out: EntranceCandidate[] = [];
  const lines = text.split("\n");
  const code = blankNonCode(text, true).split("\n");
  const importCode = blankNonCode(text, false);
  // The file's own top-level helpers, so a route whose handlers are a local `handle` calling the wrapper is registered through it.
  const helpers = new Map<string, number>();
  lines.forEach((line, i) => {
    const m = /^(?:export\s+)?(?:async\s+)?(?:function\*?\s*|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/.exec(line);
    if (m !== null && !helpers.has(m[1]!)) helpers.set(m[1]!, i);
  });
  const add = (c: Omit<EntranceCandidate, "through">, span: string): void => {
    let through = throughOf(span, text, wrappers, TYPESCRIPT_ENTRANCES);
    if (through === undefined) {
      // One level into the file's own helpers the statement names, never further.
      const named = [...helpers].filter(([name, at]) => at !== c.line - 1 && new RegExp(`(?<![\\w$.])${escape(name)}(?![\\w$])`).test(span));
      if (named.length > 0) through = throughOf(named.map(([, at]) => spanOf(lines, at, TYPESCRIPT_ENTRANCES)).join("\n"), text, wrappers, TYPESCRIPT_ENTRANCES);
    }
    out.push(through === undefined ? c : { ...c, through });
  };
  const wrapperSet = new Set(wrappers);
  const nextRoute = /(^|\/)app\/(.+\/)?route\.(ts|tsx|js|mjs)$/.test(file);
  const pagesApi = /(^|\/)pages\/api\/.+\.(ts|tsx|js|mjs)$/.test(file);
  const remixRoute = /(^|\/)app\/routes\/.+\.(ts|tsx|js|jsx)$/.test(file);
  const useServer = /^["']use server["']/.test(leadingCode(text));
  // Next.js's request proxy (proxy.ts since Next.js 16, middleware.ts before it), at the project root or under src/.
  const proxyFile = /^(?:src\/)?(proxy|middleware)\.(ts|js|mjs)$/.exec(file)?.[1];
  const nextPage = /(^|\/)app\/(.+\/)?page\.(tsx|jsx|ts|js)$/.test(file) && !remixRoute;
  const convexBuilders = importsFrom(importCode, CONVEX_GENERATED_SERVER);
  const imports = importsFrom(importCode, /./);
  const declarationOf = (local: string): Declaration => {
    const imported = imports.get(local);
    if (imported === undefined) return new RegExp(`(?:const|let|var|function\\*?|class)\\s+(?:\\{[^}]*)?(?<![\\w$])${escape(local)}(?![\\w$])`).test(importCode) ? { symbol: local, declaredIn: file } : { symbol: local };
    if (!imported.from.startsWith(".")) return { symbol: imported.exported };
    const module = posix.normalize(posix.join(posix.dirname(file), imported.from.replace(/\.(js|mjs|ts)$/, "")));
    const declaredIn = [".ts", ".tsx", ".js", ".mjs", "/index.ts"].map((ext) => module + ext).find(exists);
    return declaredIn === undefined ? { symbol: imported.exported } : { symbol: imported.exported, declaredIn };
  };
  const httpRouters = madeBy(importCode, "httpRouter", CONVEX_SERVER);
  const cronTables = madeBy(importCode, "cronJobs", CONVEX_SERVER);
  if (nextRoute || proxyFile !== undefined) {
    // What a route or proxy file exports by name without declaring it: an export list, re-exported or local, or a destructuring
    // (export { GET, POST } from "@/app/(auth)/auth", export { auth as proxy }, export const { GET, POST } = handlers).
    const wanted = (name: string): boolean => (nextRoute ? NEXT_ROUTE_METHODS.has(name) : name === proxyFile);
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}|^export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/gm)) {
      const listed = m[1] !== undefined;
      const reexported = listed && /^\s*from\s*["']/.test(text.slice(m.index + m[0].length));
      for (const item of (m[1] ?? m[2]!).split(",")) {
        const named = listed ? /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item) : /^\s*(?:[A-Za-z_$][\w$]*\s*:\s*)?([A-Za-z_$][\w$]*)\s*$/.exec(item);
        const name = named === null ? undefined : (named[2] ?? named[1]!);
        if (name === undefined || !wanted(name)) continue;
        const line = lineOf(text, m.index);
        const how = reexported ? "re-exported" : "exported by name";
        const c = nextRoute
          ? { file, line, symbol: name, rule: "route handler", why: `${name} ${how} in a Next.js route file: answers ${name} requests` }
          : { file, line, symbol: name, rule: "request proxy", why: `${name} ${how} in ${file}: Next.js runs it before every request it matches` };
        add(c, spanOf(lines, line - 1, TYPESCRIPT_ENTRANCES));
      }
    }
    if (proxyFile !== undefined) {
      const at = lines.findIndex((l) => /^export\s+default\b/.test(l));
      if (at >= 0) add({ file, line: at + 1, symbol: "", rule: "request proxy", why: `the default export of ${file}: Next.js runs it before every request it matches` }, spanOf(lines, at, TYPESCRIPT_ENTRANCES));
    }
  }
  const at = nextPage ? lines.findIndex((l) => /^export\s+default\b/.test(l)) : -1;
  if (at >= 0) {
    add({ file, line: at + 1, symbol: "", rule: "page route", why: "the default export of a Next.js app/**/page file: renders its route on the server for every visitor" }, spanOf(lines, at, TYPESCRIPT_ENTRANCES));
  }
  const defaultAt = code.findIndex((l) => /^export\s+default\s*\{/.test(l));
  if (defaultAt >= 0 && hasFetchMethod(code.slice(defaultAt).join("\n"))) {
    add({ file, line: defaultAt + 1, symbol: "", rule: "fetch handler", why: "the default export is an object with a fetch method: the runtime (a Cloudflare Worker, Bun or Deno) calls it for every request" }, spanOf(lines, defaultAt, TYPESCRIPT_ENTRANCES));
  }
  // A Convex registration's call is read whole; no other rule reads the lines inside it.
  let consumed = -1;
  lines.forEach((line, i) => {
    if (i <= consumed) return;
    const registration = convexRoute(file, code, lines, i, httpRouters, declarationOf, add) ?? convexCron(file, code, lines, i, cronTables, exists, add);
    if (registration !== undefined) {
      consumed = registration;
      return;
    }
    const declared = proxyFile === undefined ? null : /^export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/.exec(line);
    if (declared !== null && declared[1] === proxyFile) {
      add({ file, line: i + 1, symbol: proxyFile!, rule: "request proxy", why: `export ${proxyFile} in ${file}: Next.js runs it before every request it matches` }, spanOf(lines, i, TYPESCRIPT_ENTRANCES));
      return;
    }
    const exported = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/.exec(line);
    if (exported !== null) {
      const [, name, callee] = exported as unknown as [string, string, string];
      const span = spanOf(lines, i, TYPESCRIPT_ENTRANCES);
      if (callee === "createServerFn") {
        add({ file, line: i + 1, symbol: name, rule: "server function", why: `export const ${name} = createServerFn(...): a TanStack Start server function a browser can call` }, span);
        return;
      }
      if (callee === "createServerFileRoute" || callee === "createAPIFileRoute" || (callee === "createFileRoute" && /\bserver\s*:\s*\{[\s\S]*\bhandlers\b/.test(span))) {
        add({ file, line: i + 1, symbol: name, rule: "server route", why: `export const ${name} = ${callee}(...)${callee === "createFileRoute" ? " with server handlers" : ""}: a route that answers requests on the server` }, span);
        return;
      }
      const builder = convexBuilders.get(callee);
      const calledAs = builder === undefined ? undefined : convexApiPath(file, builder.from, name);
      if (builder !== undefined && calledAs !== undefined && CONVEX_PUBLIC_BUILDERS.has(builder.exported) && /^export\b/.test(code[i] ?? "")) {
        add({ file, line: i + 1, symbol: name, rule: "Convex function", why: `export const ${name} = ${callee}(...), ${builder.exported} imported from ./_generated/server: any client of the deployment can call it`, calledAs }, span);
        return;
      }
      if (wrapperSet.has(callee)) {
        add({ file, line: i + 1, symbol: name, rule: "wrapped export", why: `export const ${name} = ${callee}(...): created by ${callee}, which a declared entrance names` }, span);
        return;
      }
    }
    const fn = /^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\b|\(|function\b)/.exec(line);
    const fnName = fn?.[1] ?? fn?.[2];
    if (fnName !== undefined) {
      const span = spanOf(lines, i, TYPESCRIPT_ENTRANCES);
      if (nextRoute && NEXT_ROUTE_METHODS.has(fnName)) add({ file, line: i + 1, symbol: fnName, rule: "route handler", why: `export ${fnName} in a Next.js route file: answers ${fnName} requests` }, span);
      else if (remixRoute && REMIX_ROUTE_EXPORTS.has(fnName)) add({ file, line: i + 1, symbol: fnName, rule: "route handler", why: `export ${fnName} in app/routes: runs on the server for its route` }, span);
      else if (useServer && /^export\s+(?:async\s+function|const\s+\w+\s*(?::[^=]+)?=\s*async\b)/.test(line)) add({ file, line: i + 1, symbol: fnName, rule: "server action", why: `export ${fnName} in a 'use server' file: a server action a browser can call` }, span);
    }
    if (pagesApi && /^export\s+default\b/.test(line)) add({ file, line: i + 1, symbol: "", rule: "route handler", why: "the default export under pages/api: a Next.js API route" }, spanOf(lines, i, TYPESCRIPT_ENTRANCES));
    const table = /\b(?:pattern|path|route)\s*:\s*["'`](\/[^"'`]*)["'`][^\n]*?\bhandler\s*:\s*([A-Za-z_$][\w$.]*(?:\s*\(\s*[A-Za-z_$][\w$.]*\s*\))?)/.exec(line);
    if (table !== null) {
      const symbol = handlerName(table[2]!);
      if (symbol !== "") add({ file, line: i + 1, symbol, rule: "route table", why: `a route table entry: ${table[1]} handled by ${table[2]!.trim()}`, registered: true }, line);
      return;
    }
    // A statement, never text inside a string: the call opens its line, as `app.get(...)`, `await router.post(...)` or a chained `.get(...)`.
    const method = /^\s*(?:await\s+)?(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)?\.(get|post|put|patch|delete|all|head|options)\(\s*["'`](\/[^"'`]*)["'`]\s*,([^\n]*)$/.exec(line);
    if (method !== null) {
      const last = /,?\s*([A-Za-z_$][\w$.]*)\s*\)\s*;?\s*$/.exec(method[3]!);
      const symbol = last === null ? "" : handlerName(last[1]!);
      add({ file, line: i + 1, symbol, rule: "route method", why: `${method[1]!.toUpperCase()} ${method[2]} registered by a .${method[1]}() call${symbol === "" ? " with an inline handler" : ` to ${symbol}`}`, ...(symbol === "" ? {} : { registered: true as const }) }, spanOf(lines, i, TYPESCRIPT_ENTRANCES));
    }
  });
  return out;
}

type Add = (c: Omit<EntranceCandidate, "through">, span: string) => void;

/** A route on a Convex HTTP router opening at line i, read on the code: a router.route({ path, method, handler }) call, or a library's routes registered with addHttpRoutes(router). The index of its last line, or undefined. */
function convexRoute(file: string, code: readonly string[], lines: readonly string[], i: number, routers: readonly string[], declarationOf: (local: string) => Declaration, add: Add): number | undefined {
  const line = code[i] ?? "";
  for (const router of routers) {
    const library = new RegExp(`^\\s*([A-Za-z_$][\\w$]*)\\.addHttpRoutes\\(\\s*${escape(router)}\\s*\\)`).exec(line);
    if (library !== null) {
      add({ file, line: i + 1, ...declarationOf(library[1]!), rule: "Convex HTTP route", why: `${library[1]}.addHttpRoutes(${router}): the routes ${library[1]} registers on the deployment's HTTP router`, registered: true }, lines[i] ?? "");
      return i;
    }
    if (!new RegExp(`^\\s*${escape(router)}\\.route\\(`).test(line)) continue;
    const call = callSpan(code, lines, i);
    const path = /\b(path|pathPrefix)\s*:\s*["'`](\/[^"'`]*)["'`]/.exec(call.text);
    const method = /\bmethod\s*:\s*["'`](\w+)["'`]/.exec(call.text)?.[1] ?? "any method";
    const handler = /\bhandler\s*:\s*([A-Za-z_$][\w$.]*)\s*(\()?/.exec(call.code);
    if (path === null || handler === null) return call.end;
    const inline = handler[2] !== undefined && /^httpAction$|\.httpAction$/.test(handler[1]!);
    const local = inline ? "" : handlerName(handler[2] === undefined ? handler[1]! : `${handler[1]}(${/\(\s*([A-Za-z_$][\w$.]*)\s*\)/.exec(call.code.slice(handler.index))?.[1] ?? ""})`);
    const where = `${method} ${path[2]}${path[1] === "pathPrefix" ? "*" : ""}`;
    const registered = local === "" ? { symbol: "" } : { ...declarationOf(local), registered: true as const };
    add({ file, line: i + 1, ...registered, rule: "Convex HTTP route", why: `${where} routed by ${router}.route(...) ${inline ? `to an inline ${handler[1]}` : `to ${handler[1]}`}`, calledAs: where }, call.text);
    return call.end;
  }
  return undefined;
}

/** A cron registered on a Convex cron table at line i: Convex runs the function the generated API names on the deployment's schedule, with no caller. The index of its last line, or undefined. */
function convexCron(file: string, code: readonly string[], lines: readonly string[], i: number, tables: readonly string[], exists: (file: string) => boolean, add: Add): number | undefined {
  for (const table of tables) {
    const call = new RegExp(`^\\s*${escape(table)}\\.(${CONVEX_CRON_SCHEDULES})\\(`).exec(code[i] ?? "");
    if (call === null) continue;
    const span = callSpan(code, lines, i);
    const target = /\b(?:internal|api)\b/.exec(span.code);
    const segments = target === null ? [] : generatedApiPath(span.text, target.index);
    if (segments.length < 2) return span.end;
    const symbol = segments.at(-1)!;
    const module = posix.join(posix.dirname(file), ...segments.slice(0, -1));
    const declaredIn = [".ts", ".tsx", ".js", ".mjs"].map((ext) => module + ext).find(exists);
    const name = /["'`]([^"'`]+)["'`]/.exec(span.text)?.[1] ?? symbol;
    add({ file, line: i + 1, symbol, rule: "Convex cron", why: `the cron "${name}" ${table}.${call[1]}(...) registers: Convex runs ${target![0]}.${segments.join(".")} on that schedule, with no caller`, registered: true, calledAs: name, ...(declaredIn === undefined ? {} : { declaredIn }) }, span.text);
    return span.end;
  }
  return undefined;
}

const TS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm;

/** The code files some other code file imports by a relative path. */
function importedFiles(files: readonly string[], read: (file: string) => string | undefined): Set<string> {
  const all = new Set(files);
  const out = new Set<string>();
  for (const file of files) {
    const text = read(file);
    if (text === undefined) continue;
    for (const m of text.matchAll(TS_IMPORT)) {
      const joined = posix.normalize(posix.join(posix.dirname(file), m[1]!));
      const stem = joined.replace(/\.(js|mjs|cjs|jsx)$/, "");
      for (const c of [joined, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"].map((e) => stem + e), ...[".ts", ".tsx", ".js"].map((e) => posix.join(joined, "index" + e))]) {
        if (all.has(c) && c !== file) out.add(c);
      }
    }
  }
  return out;
}

/** Whether the file imports or declares the name: an import clause naming it, or a function, class or binding of it. */
function binds(text: string, name: string): boolean {
  const n = escape(name);
  for (const m of text.matchAll(/\bimport\s[^"'`;]*?\bfrom\s*["'][^"']+["']/g)) if (new RegExp(`(?<![\\w$])${n}(?![\\w$])`).test(m[0])) return true;
  return new RegExp(`(?:function\\*?|const|let|var|class)\\s+${n}(?![\\w$])`).test(text) || new RegExp(`(?:const|let|var)\\s*\\{[^}]*(?<![\\w$])${n}(?![\\w$])[^}]*\\}\\s*=`).test(text);
}

/** TypeScript's entrance syntax: a statement goes on through a line that closes a bracket or continues a chain; a script is one no project file imports. */
export const TYPESCRIPT_ENTRANCES: EntranceSyntax = {
  isCode: (file) => languageOfFile(file) === "typescript",
  definitionAt: (_lines, start) => start,
  continues: (text) => /^\s*[)\]}.]/.test(text),
  binds,
  decorates: false,
  candidates: typescriptCandidates,
  manifestCandidates: () => [],
  script(file, folder, _read, imported) {
    if (imported.has(file)) return undefined;
    return { file, line: 1, symbol: "", rule: "script", why: `a script directly under ${folder}/ that no project file imports` };
  },
  importedAmong: importedFiles,
};
