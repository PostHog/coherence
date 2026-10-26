/**
 * Go's entrance rules and the syntax they read by: a command's func main, a
 * handler registered on a net/http ServeMux (or a router of the same shape),
 * a route on a gin, echo, chi or fiber router, and a func cgo exports to C
 * (entrance-candidates.ts reads them through the entrances slot).
 */

import { posix } from "node:path";
import { handlerName, languageOfFile, throughOf, type EntranceCandidate, type EntranceSyntax } from "../../src/plugins/api.ts";
import { codeOnly, packageClause, uncommented } from "./go-source.ts";

/** A registration on a ServeMux: `mux.HandleFunc(`, `http.Handle(`, with a string pattern first. */
const SERVE_MUX = /\b[A-Za-z_]\w*\s*\.\s*(HandleFunc|Handle)\s*\(\s*("(?:[^"\\\n]|\\.)*"|`[^`]*`)\s*,/g;
/** A route on a framework's router: `r.GET(`, `e.POST(`, `r.Get(`, with a string path first. */
const ROUTER_METHOD = /\b[A-Za-z_]\w*\s*\.\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any|Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(\s*("(?:[^"\\\n]|\\.)*"|`[^`]*`)\s*,/g;
/** The routers whose method routes the router rule reads, by import path. */
const ROUTERS = /^github\.com\/(?:gin-gonic\/gin|labstack\/echo(?:\/v\d+)?|go-chi\/chi(?:\/v\d+)?|gofiber\/fiber(?:\/v\d+)?)$/;
/** A ServeMux pattern: an optional method, an optional host, then a path (`GET /rows/{id}`, `example.com/`, `/`). */
const PATTERN = /^(?:[A-Z]+\s+)?[^\s/]*\//;

/** A call's arguments past the first, from just after its comma to its closing parenthesis, split at the commas outside brackets. */
function restArguments(text: string, from: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 1;
  let start = from;
  let i = from;
  for (; i < text.length && depth > 0; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    if ((c === "," && depth === 1) || depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return { args: args.filter((a) => a !== ""), end: i };
}

/**
 * The name a handler expression gives: `handleRows`, `api.Render`,
 * `s.handleRows` and `http.HandlerFunc(handleRows)` are each the last
 * identifier; a handler a call with no arguments builds (`api.Handler()`)
 * is the builder's name. An inline func literal, or a handler a call builds
 * from other values (`http.FileServer(http.Dir("."))`), names none.
 */
function goHandlerName(expression: string): string {
  // A trailing comma before a closing parenthesis (gofmt's, when a call breaks across lines) is no argument.
  const e = expression.trim().replace(/,\s*\)/g, ")");
  if (/^func\b/.test(e)) return "";
  const named = handlerName(e);
  if (named !== "") return named;
  return /([A-Za-z_]\w*)\s*\(\s*\)\s*$/.exec(e)?.[1] ?? "";
}

/** Each package-level func of the code-only text, by name, with its one-based line: `func main(`, `func Map[K any](`; a method's receiver comes before its name, so a method is none. */
function funcsIn(code: string): { name: string; line: number }[] {
  return [...code.matchAll(/^func[ \t]+([A-Za-z_]\w*)[ \t]*[[(]/gm)].map((m) => ({ name: m[1]!, line: lineAt(code, m.index) }));
}

/** Whether the file imports one of the routers: a quoted path of one in its imports, which Go puts before any other declaration, so the text before the first is read. */
function importsRouter(text: string, code: string): boolean {
  const first = /^(?:func|type|var|const)\b/m.exec(code);
  const imports = text.slice(0, first === null ? text.length : first.index);
  return [...imports.matchAll(/"((?:[^"\\\n]|\\.)*)"|`([^`]*)`/g)].some((m) => ROUTERS.test(m[1] ?? m[2] ?? ""));
}

/** The one-based line of a character offset in the text. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function goCandidates(file: string, original: string, wrappers: readonly string[]): EntranceCandidate[] {
  const out: EntranceCandidate[] = [];
  // Read with comments blanked, so an example in a doc comment is never one; its strings kept, so a route's pattern is read.
  const text = uncommented(original);
  const code = codeOnly(original);
  const add = (c: Omit<EntranceCandidate, "through">, span: string): void => {
    const through = throughOf(span, text, wrappers, GO_ENTRANCES);
    out.push(through === undefined ? c : { ...c, through });
  };
  const funcs = funcsIn(code);
  if (packageClause(text) === "main") {
    const main = funcs.find((d) => d.name === "main");
    if (main !== undefined) {
      const folder = posix.dirname(file);
      const command = folder === "." ? undefined : posix.basename(folder);
      add({ file, line: main.line, symbol: "main", rule: "binary", ...(command === undefined ? {} : { name: `binary ${command}` }), why: `${file} is in package main, and its main runs when the command ${command === undefined ? "built from the module's root" : command} starts` }, "");
    }
  }
  const register = (pattern: RegExp, rule: string, why: (method: string, path: string, handler: string) => string, accepts: (path: string) => boolean): void => {
    for (const call of text.matchAll(pattern)) {
      // A registration whose call is in a comment is blanked already; one inside a string is not code.
      if (code[call.index] === " ") continue;
      const path = call[2]!.slice(1, -1);
      if (!accepts(path)) continue;
      const { args, end } = restArguments(text, call.index + call[0].length);
      const handler = args[args.length - 1];
      if (handler === undefined) continue;
      const symbol = goHandlerName(handler);
      if (symbol === "") continue;
      add({ file, line: lineAt(text, call.index), symbol, rule, why: why(call[1]!, path, handler), registered: true }, text.slice(call.index, end));
    }
  };
  register(SERVE_MUX, "http route", (method, path, handler) => `${method}("${path}") registers ${handler} on a ServeMux`, (path) => PATTERN.test(path));
  if (importsRouter(text, code)) {
    register(ROUTER_METHOD, "router route", (method, path, handler) => `a router's ${method}("${path}") is handled by ${handler}`, (path) => path === "" || path.startsWith("/"));
  }
  // A cgo export: `//export Name` directly above func Name, which C calls by that name.
  const lines = original.split("\n");
  for (const d of funcs) {
    const above = lines[d.line - 2]?.replace(/\r$/, "");
    if (above !== undefined && new RegExp(`^//export\\s+${d.name}\\s*$`).test(above)) add({ file, line: d.line, symbol: d.name, rule: "cgo export", why: `${d.name} carries //export: C code calls it by that name` }, "");
  }
  return out;
}

/**
 * Whether a call to the name is a call to that symbol: Go resolves a bare
 * name in the file's package, which every file of the package declares into,
 * so one file's text cannot rule it out; it is bound unless the file binds
 * the name locally (`name :=`, a `var name` inside a function).
 */
function binds(text: string, name: string): boolean {
  const code = codeOnly(text);
  const n = name.replace(/[$]/g, "\\$&");
  return !new RegExp(`(?:^|[\\s,(])${n}\\s*(?:,\\s*[A-Za-z_]\\w*\\s*)*:=|^\\s+var\\s+${n}\\b`, "m").test(code);
}

/** Go's entrance syntax: a definition starts at its own line, and a line that closes a bracket goes on with the statement. */
export const GO_ENTRANCES: EntranceSyntax = {
  isCode: (file) => languageOfFile(file) === "go",
  definitionAt: (_lines, start) => start,
  continues: (text) => /^\s*[}\])]/.test(text),
  binds,
  decorates: false,
  candidates: goCandidates,
  manifestCandidates: () => [],
  script: () => undefined,
  importedAmong: () => new Set(),
};
