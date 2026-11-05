/**
 * Rust's entrance rules and the syntax they read by: a binary's main, an
 * example's main, a build script, the route attributes actix-web and Rocket
 * fix, a route registered on an axum or actix-web router, a function exported
 * across a foreign boundary (C, wasm-bindgen or UniFFI, a free fn or an
 * exported impl's method), and the binaries Cargo.toml names at a path of
 * their own (entrance-candidates.ts reads them through ENTRANCE_SYNTAX).
 */

import { posix } from "node:path";
import { handlerName, languageOfFile, spanOf, throughOf, type EntranceCandidate, type EntranceSyntax } from "../../src/plugins/api.ts";
import { binaryOf, codeOnly, declaredModules, exampleOf, itemOf, manifestOf, testRanges, uncommented, useLeaves } from "./rust-source.ts";

const ROUTE_ATTRIBUTE = /^\s*#\[\s*(?:[\w:]*::)?(get|post|put|patch|delete|head|options|route)\s*\(\s*"([^"]*)"/;
// The attributes that export a fn by its name: C's unmangled symbol, wasm-bindgen's binding (plain, by path or under cfg_attr, its arguments captured) and UniFFI's.
const UNMANGLED = /#\[\s*(no_mangle|unsafe\s*\(\s*no_mangle\s*\)|export_name\s*=)/;
const WASM_BINDGEN = /#\[\s*(?:cfg_attr\s*\([^\]]*?,\s*)?(?:[\w:]*::)?wasm_bindgen\b\s*(?:\(([^\]]*)\))?/;
const UNIFFI_EXPORT = /#\[\s*(?:cfg_attr\s*\([^\]]*?,\s*)?(?:::)?uniffi::export\b/;
/** An impl header, its generics passed: what follows is the type, or the trait for the type. */
const IMPL = /^\s*(?:unsafe\s+)?impl\b(?:\s*<[^{]*?>)?\s+([^{]*)/;
/** An extern block, whose fns the host provides: imports, never exports. */
const EXTERN_BLOCK = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:unsafe\s+)?extern(?:\s+"[^"]*")?\s*\{/;
/** A handler argument: a path, or a call wrapping one, one level deep. */
const ARGUMENT = String.raw`([\w:]+(?:\s*\([^()]*\))?)`;
const METHOD = new RegExp(String.raw`(?:\b(?:get|post|put|patch|delete|head|options|trace|any)|\.to)\s*\(\s*${ARGUMENT}\s*\)`, "g");

/** The fn a line declares, at any depth. */
function fnOf(line: string): string | undefined {
  const item = itemOf(line);
  return item?.keyword === "fn" ? item.name : undefined;
}

/** Whether the line declares the module's own fn main. */
function isMain(line: string): boolean {
  const item = itemOf(line);
  return item?.top === true && item.keyword === "fn" && item.name === "main";
}

/** The type an impl header is for: impl Viewer and impl<T> Shape for Ring<T> are Viewer and Ring. */
function implType(header: string): string | undefined {
  const target = /\bfor\s+(.+)$/.exec(header)?.[1] ?? header;
  return /^&?\s*(?:'\w+\s+)?(?:mut\s+)?(?:(?:r#)?[A-Za-z_]\w*::)*(?:r#)?([A-Za-z_]\w*)/.exec(target.trim())?.[1];
}

/** Whether a wasm_bindgen attribute's arguments name the flag (constructor, getter, skip), as one of its comma-separated arguments and never a value. */
function flag(args: string, name: string): boolean {
  return new RegExp(`(?:^|,)\\s*${name}\\s*(?=[,=]|$)`).test(args.trim());
}

/** A fn code outside Rust calls by name: where its attributes start, its symbol, and why. */
interface ForeignExport {
  start: number;
  symbol: string;
  why: string;
}

/** A block the scan is inside: an impl (its type, and what exports it), an extern block, or any other. */
interface Block {
  kind: "impl" | "extern" | "other";
  type?: string;
  exports?: "wasm" | "uniffi";
  trait?: boolean;
}

/**
 * The fns a file exports across a foreign boundary, read line by line with
 * its blocks tracked by their braces (over the code alone, so a brace in a
 * string is none): a free fn under an exporting attribute; a pub method of a
 * #[wasm_bindgen] impl, a trait's impl excepted (wasm-bindgen exports
 * inherent impls alone) and a #[wasm_bindgen(skip)] one too; a method of a
 * #[uniffi::export] impl, pub, or any of a trait impl's; never a fn of an
 * extern block, which the host provides.
 */
function foreignExports(lines: readonly string[], code: readonly string[]): ForeignExport[] {
  const out: ForeignExport[] = [];
  const stack: Block[] = [];
  let attributes = "";
  let attributesAt = -1;
  let open = 0;
  /** The block the next brace opens, when a header above it says what it is. */
  let next: Block | undefined;
  for (let i = 0; i < code.length; i++) {
    const line = code[i]!;
    // The attributes at the line's start, each whole across lines (#[wasm_bindgen(\n js_name = x\n)]), read from the text as written.
    let at = 0;
    for (;;) {
      if (open === 0) {
        const lead = /^\s*/.exec(line.slice(at))![0].length;
        if (!line.startsWith("#[", at + lead)) break;
        if (attributesAt < 0) attributesAt = i;
        at += lead;
      }
      let j = at;
      for (; j < line.length; j++) {
        if (line[j] === "[") open += 1;
        else if (line[j] === "]" && --open === 0) {
          j += 1;
          break;
        }
      }
      attributes += ` ${(lines[i] ?? "").slice(at, j).trim()}`;
      at = j;
      if (open > 0) break;
    }
    const rest = line.slice(at);
    if (open > 0 || rest.trim() === "") continue;
    const inner = stack[stack.length - 1];
    const fn = itemOf(rest);
    const impl = IMPL.exec(rest);
    if (EXTERN_BLOCK.test(rest)) next = { kind: "extern" };
    else if (impl !== null) {
      const header = impl[1]!;
      const type = implType(header);
      const trait = /\bfor\s/.test(header);
      // An impl whose type cannot be read names no method, so it exports none the scan can name.
      const exports = type === undefined ? undefined : WASM_BINDGEN.test(attributes) && !trait ? "wasm" : UNIFFI_EXPORT.test(attributes) ? "uniffi" : undefined;
      next = { kind: "impl", ...(type === undefined ? {} : { type }), ...(exports === undefined ? {} : { exports }), trait };
    } else if (fn?.keyword === "fn") {
      next = { kind: "other" };
      const start = attributesAt < 0 ? i : attributesAt;
      // pub alone: pub(crate) and pub(super) are not seen outside the crate.
      const pub = /^\s*pub\s/.test(rest);
      if (stack.some((b) => b.kind === "extern")) {
        // An import, which the host provides.
      } else if (inner?.kind === "impl") {
        const symbol = `${inner.type}::${fn.name}`;
        const wasm = WASM_BINDGEN.exec(attributes);
        const args = wasm?.[1] ?? "";
        if (inner.exports === "wasm" && pub && !flag(args, "skip")) {
          const why = flag(args, "constructor")
            ? `${symbol} is the #[wasm_bindgen(constructor)] of a #[wasm_bindgen] impl: JavaScript's new ${inner.type}(…) calls it`
            : flag(args, "getter") || flag(args, "setter")
              ? `${symbol} is a #[wasm_bindgen(${flag(args, "getter") ? "getter" : "setter"})] of a #[wasm_bindgen] impl: JavaScript reaches it as a ${inner.type}'s property`
              : `${symbol} is a pub method of a #[wasm_bindgen] impl: JavaScript calls it on a ${inner.type}`;
          out.push({ start, symbol, why });
        }
        // A trait impl's methods carry no visibility of their own: UniFFI exports every one.
        if (inner.exports === "uniffi" && (pub || inner.trait === true)) {
          const why = /#\[\s*(?:::)?uniffi::constructor\b/.test(attributes)
            ? `${symbol} is a #[uniffi::constructor] of a #[uniffi::export] impl: Swift, Kotlin or Python constructs a ${inner.type} through it`
            : `${symbol} is a method of a #[uniffi::export] impl: Swift, Kotlin or Python calls it on a ${inner.type}`;
          out.push({ start, symbol, why });
        }
      } else {
        const wasm = WASM_BINDGEN.exec(attributes);
        const unmangled = UNMANGLED.exec(attributes);
        if (wasm !== null && !flag(wasm[1] ?? "", "skip")) {
          const why = flag(wasm[1] ?? "", "start")
            ? `${fn.name} carries #[wasm_bindgen(start)]: it runs when JavaScript instantiates the module`
            : `${fn.name} carries #[wasm_bindgen]: code outside Rust calls it by that name`;
          out.push({ start, symbol: fn.name, why });
        } else if (UNIFFI_EXPORT.test(attributes)) {
          out.push({ start, symbol: fn.name, why: `${fn.name} carries #[uniffi::export]: Swift, Kotlin or Python calls it through the bindings UniFFI generates` });
        } else if (unmangled !== null) {
          out.push({ start, symbol: fn.name, why: `${fn.name} carries #[${unmangled[1]!.replace(/\s*=$/, "").replace(/\s+/g, "")}]: code outside Rust calls it by that name` });
        }
      }
    } else if (fn !== undefined) next = undefined;
    for (const c of rest) {
      if (c === "{") {
        stack.push(next ?? { kind: "other" });
        next = undefined;
      } else if (c === "}") stack.pop();
    }
    // A header that ends in ; opens no block: a trait's or an extern block's fn without a body.
    if (/;\s*$/.test(rest)) next = undefined;
    attributes = "";
    attributesAt = -1;
  }
  return out;
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
      const fn = fnOf(lines[j] ?? "");
      if (fn !== undefined) return { name: fn, start };
      if (!/^\s*(#\[|\/\/|$)/.test(lines[j] ?? "") && !/^\s*[)\]"]/.test(lines[j] ?? "")) return undefined;
    }
    return undefined;
  };
  const seen = new Set<number>();
  const script = /(^|\/)build\.rs$/.test(file);
  const binary = binaryOf(file);
  const example = exampleOf(file);
  lines.forEach((line, i) => {
    const main = isMain(line);
    if (main && binary !== undefined) add({ file, line: i + 1, symbol: "main", rule: "binary", name: `binary ${binary}`, why: `${file} is a binary's root by Cargo's layout, and main runs when the binary starts` }, spanOf(lines, i, RUST_ENTRANCES));
    if (main && example !== undefined) add({ file, line: i + 1, symbol: "main", rule: "example", name: `example ${example}`, why: `${file} is an example's root by Cargo's layout, and main runs when cargo run --example ${example} starts it` }, spanOf(lines, i, RUST_ENTRANCES));
    if (main && script) add({ file, line: i + 1, symbol: "main", rule: "build script", name: `build script ${posix.basename(posix.dirname(file)).replace(/^\.$/, "crate")}`, why: "Cargo runs build.rs's main before it compiles the crate" }, spanOf(lines, i, RUST_ENTRANCES));
    const route = ROUTE_ATTRIBUTE.exec(line);
    if (route === null) return;
    const target = attributed(i);
    if (target === undefined || seen.has(target.start)) return;
    seen.add(target.start);
    add({ file, line: target.start + 1, symbol: target.name, rule: "route attribute", why: `${target.name} carries #[${route[1]}("${route[2]}")]: a web route` }, spanOf(lines, target.start, RUST_ENTRANCES));
  });
  for (const { start, symbol, why } of foreignExports(lines, codeOnly(original).split("\n"))) {
    add({ file, line: start + 1, symbol, rule: "foreign export", why }, spanOf(lines, start, RUST_ENTRANCES));
  }
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
  if (useLeaves(text).some((leaf) => (leaf.alias ?? leaf.path[leaf.path.length - 1]) === name)) return true;
  if (declaredModules(text).includes(name)) return true;
  return text.split("\n").some((line) => itemOf(line)?.name === name);
}

/** The [[bin]] targets every Cargo.toml in the project names at a path of its own, each a binary whose main is an entrance. */
function cargoBinaries(read: (file: string) => string | undefined, exists: (file: string) => boolean, files: readonly string[]): EntranceCandidate[] {
  const out: EntranceCandidate[] = [];
  for (const manifest of files.filter((f) => posix.basename(f) === "Cargo.toml")) {
    const text = read(manifest);
    if (text === undefined) continue;
    const folder = posix.dirname(manifest) === "." ? "" : posix.dirname(manifest);
    for (const bin of manifestOf(text, manifest).bins) {
      if (bin.path === undefined) continue;
      const file = posix.join(folder, bin.path);
      // A binary at Cargo's own layout is read from its file already.
      if (binaryOf(file) !== undefined || !exists(file)) continue;
      const name = bin.name ?? posix.basename(bin.path).replace(/\.rs$/, "");
      const line = (read(file) ?? "").split("\n").findIndex(isMain);
      out.push({ file, line: line < 0 ? 1 : line + 1, symbol: "main", rule: "binary", name: `binary ${name}`, why: `${manifest} names the binary "${name}" at ${bin.path}, and main runs when it starts` });
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
