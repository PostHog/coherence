/**
 * A reader for the subset of TOML a tach.toml uses: tables, arrays of tables,
 * bare, quoted and dotted keys, basic and literal single-line strings,
 * integers, booleans, arrays spanning lines with comments and trailing
 * commas, and inline tables (a dependency written { path = "x", deprecated =
 * true }). Anything outside the subset (a multi-line string, a float, a date)
 * is refused by name, with the line, so a configuration the reader cannot
 * carry faithfully is never half read.
 *
 * Adapted from the fuller reader on the import-boundaries branch
 * (src/scaffold/toml.ts), which drafts specs from tach.toml; that branch
 * reconciles the two.
 */

export class TomlError extends Error {
  readonly line: number;
  constructor(file: string, line: number, reason: string) {
    super(`${file}:${line}: ${reason}`);
    this.line = line;
  }
}

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

const BARE_KEY = /[A-Za-z0-9_-]/;

export function parseToml(text: string, file: string): TomlTable {
  let at = 0;
  let line = 1;
  const root: TomlTable = {};
  const headed = new Set<TomlTable>();
  const tableArrays = new Set<TomlValue[]>();
  const fail = (reason: string): never => {
    throw new TomlError(file, line, reason);
  };
  const peek = (offset = 0): string => text[at + offset] ?? "";
  const advance = (): string => {
    const ch = text[at] ?? "";
    at += 1;
    if (ch === "\n") line += 1;
    return ch;
  };
  const skipSpaces = (): void => {
    while (peek() === " " || peek() === "\t") advance();
  };
  const skipComment = (): void => {
    if (peek() === "#") while (at < text.length && peek() !== "\n") advance();
  };
  const skipBlank = (): void => {
    for (;;) {
      skipSpaces();
      skipComment();
      if (peek() === "\n" || peek() === "\r") advance();
      else return;
    }
  };
  const endOfLine = (): void => {
    skipSpaces();
    skipComment();
    if (peek() === "\r") advance();
    if (at < text.length && peek() !== "\n") fail(`unexpected ${JSON.stringify(peek())} after a value; one key = value per line`);
    if (peek() === "\n") advance();
  };
  const string = (): string => {
    const quote = peek();
    if (text.startsWith(quote.repeat(3), at)) fail("a multi-line string is outside the TOML this reader accepts");
    advance();
    let out = "";
    for (;;) {
      if (at >= text.length || peek() === "\n") fail("an unterminated string");
      const ch = advance();
      if (ch === quote) return out;
      if (ch !== "\\" || quote === "'") {
        out += ch;
        continue;
      }
      const esc = advance();
      const simple: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
      if (Object.hasOwn(simple, esc)) out += simple[esc];
      else if (esc === "u" || esc === "U") {
        const width = esc === "u" ? 4 : 8;
        const hex = text.slice(at, at + width);
        if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== width) fail(`a malformed \\${esc} escape`);
        out += String.fromCodePoint(parseInt(hex, 16));
        at += width;
      } else fail(`an unknown escape \\${esc}`);
    }
  };
  const keyPart = (): string => {
    skipSpaces();
    if (peek() === '"' || peek() === "'") return string();
    let out = "";
    while (peek() !== "" && BARE_KEY.test(peek())) out += advance();
    if (out === "") fail(`unexpected ${JSON.stringify(peek() || "the end")} where a key belongs`);
    return out;
  };
  const dottedKey = (): string[] => {
    const parts = [keyPart()];
    skipSpaces();
    while (peek() === ".") {
      advance();
      parts.push(keyPart());
      skipSpaces();
    }
    return parts;
  };
  const value = (): TomlValue => {
    skipSpaces();
    const ch = peek();
    if (ch === '"' || ch === "'") return string();
    if (ch === "[") {
      advance();
      const items: TomlValue[] = [];
      for (;;) {
        skipBlank();
        if (peek() === "]") {
          advance();
          return items;
        }
        if (at >= text.length) fail("an unterminated array");
        items.push(value());
        skipBlank();
        if (peek() === ",") advance();
        else if (peek() !== "]") fail(`expected , or ] in an array, found ${JSON.stringify(peek() || "the end")}`);
      }
    }
    if (ch === "{") {
      advance();
      const table: TomlTable = {};
      skipSpaces();
      if (peek() === "}") {
        advance();
        return table;
      }
      for (;;) {
        const key = dottedKey();
        skipSpaces();
        if (peek() !== "=") fail("expected = after a key in an inline table");
        advance();
        assign(table, key, value());
        skipSpaces();
        if (peek() === ",") {
          advance();
          continue;
        }
        if (peek() === "}") {
          advance();
          return table;
        }
        fail(`expected , or } in an inline table, found ${JSON.stringify(peek() || "the end")}`);
      }
    }
    let word = "";
    while (at < text.length && /[A-Za-z0-9_+\-.:]/.test(peek())) word += advance();
    if (word === "true") return true;
    if (word === "false") return false;
    if (/^[+-]?(0|[1-9](_?[0-9])*)$/.test(word)) return Number(word.replace(/_/g, ""));
    return fail(word === "" ? `unexpected ${JSON.stringify(ch || "the end")} where a value belongs` : `${JSON.stringify(word)} is outside the TOML this reader accepts (a string, an integer, a boolean, an array, an inline table)`);
  };
  const descend = (from: TomlTable, keys: readonly string[], forHeader: boolean): TomlTable => {
    let table = from;
    for (const key of keys) {
      const existing = table[key];
      if (existing === undefined) {
        const made: TomlTable = {};
        table[key] = made;
        table = made;
      } else if (Array.isArray(existing)) {
        const last = existing[existing.length - 1];
        if (!forHeader || !tableArrays.has(existing) || last === undefined || typeof last !== "object" || Array.isArray(last)) fail(`${key} is an array, not a table`);
        table = last as TomlTable;
      } else if (typeof existing === "object") table = existing;
      else fail(`${key} is already defined`);
    }
    return table;
  };
  function assign(table: TomlTable, keys: readonly string[], v: TomlValue): void {
    const parent = descend(table, keys.slice(0, -1), false);
    const last = keys[keys.length - 1]!;
    if (Object.hasOwn(parent, last)) fail(`${keys.join(".")} is defined twice`);
    parent[last] = v;
  }

  let current = root;
  for (;;) {
    skipBlank();
    if (at >= text.length) return root;
    if (peek() === "[") {
      const isArray = peek(1) === "[";
      at += isArray ? 2 : 1;
      const keys = dottedKey();
      skipSpaces();
      if (isArray ? !text.startsWith("]]", at) : peek() !== "]") fail(`expected ${isArray ? "]]" : "]"} to close the header`);
      at += isArray ? 2 : 1;
      endOfLine();
      const parent = descend(root, keys.slice(0, -1), true);
      const last = keys[keys.length - 1]!;
      const existing = parent[last];
      if (isArray) {
        const made: TomlTable = {};
        if (existing === undefined) {
          const array: TomlValue[] = [made];
          tableArrays.add(array);
          parent[last] = array;
        } else if (Array.isArray(existing) && tableArrays.has(existing)) existing.push(made);
        else fail(`${keys.join(".")} is already defined, not as an array of tables`);
        current = made;
      } else {
        if (existing === undefined) {
          const made: TomlTable = {};
          parent[last] = made;
          current = made;
        } else if (typeof existing === "object" && !Array.isArray(existing) && !headed.has(existing)) current = existing;
        else fail(`[${keys.join(".")}] is defined twice`);
        headed.add(current);
      }
      continue;
    }
    const key = dottedKey();
    skipSpaces();
    if (peek() !== "=") fail(`expected = after the key ${key.join(".")}`);
    advance();
    assign(current, key, value());
    endOfLine();
  }
}
