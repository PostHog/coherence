/**
 * Rust's entrance rules and the syntax they read by: a binary's main, a build
 * script, the route attributes actix-web and Rocket fix, a route registered
 * on an axum or actix-web router, a function exported across a foreign
 * boundary (C or wasm), and the binaries Cargo.toml names at a path of their
 * own (entrance-candidates.ts reads them through ENTRANCE_SYNTAX).
 */

import { posix } from "node:path";
import { escape, handlerName, languageOfFile, spanOf, throughOf, type EntranceCandidate, type EntranceSyntax } from "../../src/plugins/api.ts";
import { declaredModules, testRanges, uncommented, useLeaves } from "./rust-source.ts";

const FN = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:(?:default|const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+(?:r#)?([A-Za-z_]\w*)/;
const ROUTE_ATTRIBUTE = /^\s*#\[\s*(?:[\w:]*::)?(get|post|put|patch|delete|head|options|route)\s*\(\s*"([^"]*)"/;
const FOREIGN = /^\s*#\[\s*(no_mangle|unsafe\s*\(\s*no_mangle\s*\)|export_name\s*=|(?:[\w:]*::)?wasm_bindgen\b)/;
/** A handler argument: a path, or a call wrapping one, one level deep. */
const ARGUMENT = String.raw`([\w:]+(?:\s*\([^()]*\))?)`;
const METHOD = new RegExp(String.raw`(?:\b(?:get|post|put|patch|delete|head|options|trace|any)|\.to)\s*\(\s*${ARGUMENT}\s*\)`, "g");

/** Whether a file is a binary's root by Cargo's convention: src/main.rs, src/bin/x.rs or src/bin/x/main.rs. */
function binaryRoot(file: string): boolean {
  return /(^|\/)src\/main\.rs$/.test(file) || /(^|\/)src\/bin\/[^/]+\.rs$/.test(file) || /(^|\/)src\/bin\/[^/]+\/main\.rs$/.test(file);
}

/** The last segment of a path expression: handlers::create is create. */
function lastSegment(path: string): string {
  return path.split("::").pop() ?? path;
}

function rustCandidates(file: string, original: string, wrappers: readonly string[]): EntranceCandidate[] {
  const out: EntranceCandidate[] = [];
  // Read with comments blanked, so a doc example's route is never one; an item that compiles only for tests is never an entrance.
  const text = uncommented(original);
  const lines = text.split("\n");
  const tests = testRanges(original);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const inTest = (line: number): boolean => tests.some(([from, to]) => lineStarts[line - 1]! >= from && lineStarts[line - 1]! <= to);
  const add = (c: Omit<EntranceCandidate, "through">, span: string): void => {
    const through = throughOf(span, text, wrappers, RUST_ENTRANCES);
    if (inTest(c.line)) return;
    out.push(through === undefined ? c : { ...c, through });
  };
  /** The fn the attributes at line i are on: its name and the line the attributes start on. */
  const attributed = (i: number): { name: string; start: number } | undefined => {
    let start = i;
    while (start > 0 && /^\s*#\[/.test(lines[start - 1] ?? "")) start -= 1;
    for (let j = i; j < lines.length; j++) {
      const fn = FN.exec(lines[j] ?? "");
      if (fn !== null) return { name: fn[1]!, start };
      if (!/^\s*(#\[|\/\/|$)/.test(lines[j] ?? "") && !/^\s*[)\]"]/.test(lines[j] ?? "")) return undefined;
    }
    return undefined;
  };
  const seen = new Set<number>();
  const script = /(^|\/)build\.rs$/.test(file);
  lines.forEach((line, i) => {
    const main = /^(?:pub\s+)?(?:async\s+)?fn\s+main\s*\(/.test(line);
    if (main && binaryRoot(file)) add({ file, line: i + 1, symbol: "main", rule: "binary", why: `${file} is a binary's root by Cargo's layout, and main runs when the binary starts` }, spanOf(lines, i, RUST_ENTRANCES));
    if (main && script) add({ file, line: i + 1, symbol: "main", rule: "build script", why: "Cargo runs build.rs's main before it compiles the crate" }, spanOf(lines, i, RUST_ENTRANCES));
    const route = ROUTE_ATTRIBUTE.exec(line);
    const foreign = FOREIGN.exec(line);
    if (route === null && foreign === null) return;
    const target = attributed(i);
    if (target === undefined || seen.has(target.start)) return;
    seen.add(target.start);
    const span = spanOf(lines, target.start, RUST_ENTRANCES);
    if (route !== null) add({ file, line: target.start + 1, symbol: target.name, rule: "route attribute", why: `${target.name} carries #[${route[1]}("${route[2]}")]: a web route` }, span);
    else add({ file, line: target.start + 1, symbol: target.name, rule: "foreign export", why: `${target.name} carries #[${foreign![1]!.replace(/\s*=$/, "").replace(/\s+/g, "")}]: code outside Rust calls it by that name` }, span);
  });
  // A router's route is read over the whole text: a chain breaks across lines, its path and its handlers on the lines below.
  const lineAt = (index: number): number => text.slice(0, index).split("\n").length;
  for (const call of text.matchAll(/\.route\(\s*"([^"]*)"\s*,/g)) {
    const from = call.index + call[0].length;
    let depth = 1;
    let end = from;
    for (; end < text.length && depth > 0; end++) {
      if (text[end] === "(") depth += 1;
      else if (text[end] === ")") depth -= 1;
    }
    const args = text.slice(from, end - 1);
    const handlers = new Map<string, string>();
    for (const m of args.matchAll(METHOD)) {
      const symbol = lastSegment(handlerName(m[1]!));
      if (symbol !== "" && !handlers.has(symbol)) handlers.set(symbol, m[1]!);
    }
    for (const [symbol, handler] of handlers) {
      add({ file, line: lineAt(call.index), symbol, rule: "route registration", why: `a router's route "${call[1]}" is handled by ${handler}`, registered: true }, text.slice(call.index, end));
    }
  }
  return out;
}

/** Whether the file brings in or declares the name: a use naming it, or an item or module of that name. */
function binds(text: string, name: string): boolean {
  const n = escape(name);
  if (useLeaves(text).some((leaf) => (leaf.alias ?? leaf.path[leaf.path.length - 1]) === name)) return true;
  if (declaredModules(text).includes(name)) return true;
  return new RegExp(`^\\s*(?:pub(?:\\s*\\([^)]*\\))?\\s+)?(?:(?:default|const|async|unsafe|extern(?:\\s+"[^"]*")?)\\s+)*(?:fn|struct|enum|const|static)\\s+${n}\\b`, "m").test(text);
}

/** The [[bin]] targets every Cargo.toml in the project names at a path of its own, each a binary whose main is an entrance. */
function cargoBinaries(read: (file: string) => string | undefined, exists: (file: string) => boolean, files: readonly string[]): EntranceCandidate[] {
  const out: EntranceCandidate[] = [];
  for (const manifest of files.filter((f) => posix.basename(f) === "Cargo.toml")) {
    const text = read(manifest);
    if (text === undefined) continue;
    const folder = posix.dirname(manifest) === "." ? "" : posix.dirname(manifest);
    for (const table of text.split(/^\s*\[\[bin\]\]\s*$/m).slice(1)) {
      const body = table.split(/^\s*\[/m)[0]!;
      const path = /^\s*path\s*=\s*"([^"]+)"/m.exec(body)?.[1];
      const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(body)?.[1] ?? path;
      if (path === undefined) continue;
      const file = posix.join(folder, path);
      // A binary at Cargo's own layout is read from its file already.
      if (binaryRoot(file) || !exists(file)) continue;
      const line = (read(file) ?? "").split("\n").findIndex((l) => /^(?:pub\s+)?(?:async\s+)?fn\s+main\s*\(/.test(l));
      out.push({ file, line: line < 0 ? 1 : line + 1, symbol: "main", rule: "binary", why: `${manifest} names the binary "${name}" at ${path}, and main runs when it starts` });
    }
  }
  return out;
}

/** Rust's entrance syntax: an item begins at its attributes, and a line that closes a brace or continues a chain or a where clause goes on with it. */
export const RUST_ENTRANCES: EntranceSyntax = {
  isCode: (file) => languageOfFile(file) === "rust",
  definitionAt(lines, start) {
    let def = start;
    while (def < lines.length && /^\s*#\[/.test(lines[def] ?? "")) def += 1;
    return def;
  },
  continues: (text) => /^\s*(?:[}\])]|\.|where\b|->|\{)/.test(text),
  binds,
  decorates: false,
  candidates: rustCandidates,
  manifestCandidates: cargoBinaries,
  script: () => undefined,
  importedAmong: () => new Set(),
};
