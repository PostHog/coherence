/**
 * A reader for the subset of TOML a boundary declaration file uses: tables,
 * arrays of tables, bare, quoted and dotted keys, basic and literal strings
 * (single- and multi-line), integers, floats, booleans, arrays spanning lines
 * with comments and trailing commas, and inline tables. Dates and times are
 * refused, as anything else outside the subset is: by name, with the line.
 *
 * It exists so drafting specs from tach.toml needs no new dependency. Every
 * table remembers the line its header (or first key) stood on, so what is
 * drafted from it can say where it came from.
 */

export class TomlError extends Error {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  constructor(file: string, line: number, reason: string) {
    super(`${file}:${line}: ${reason}`);
    this.file = file;
    this.line = line;
    this.reason = reason;
  }
}

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

/** The line a table's header stood on; arrays of tables give each element its own. */
const LINES = new WeakMap<TomlTable, number>();
export function lineOf(table: TomlTable): number | undefined {
  return LINES.get(table);
}

const BARE_KEY = /[A-Za-z0-9_-]/;

export function parseToml(text: string, file: string): TomlTable {
  let at = 0;
  let line = 1;
  const root: TomlTable = {};
  LINES.set(root, 1);
  /** Tables made by a header, so a second [x] for the same x is refused. */
  const headed = new Set<TomlTable>();
  /** Tables defined inline, which are closed to later additions. */
  const closed = new Set<TomlTable>();
  /** Arrays made by [[x]] headers, the only arrays a header may extend. */
  const tableArrays = new Set<TomlValue[]>();

  const fail = (reason: string, where = line): never => {
    throw new TomlError(file, where, reason);
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
  /** Whitespace, newlines and comments, as inside an array. */
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

  const basicString = (): string => {
    const multi = text.startsWith('"""', at);
    at += multi ? 3 : 1;
    if (multi && peek() === "\n") advance();
    else if (multi && peek() === "\r" && peek(1) === "\n") { advance(); advance(); }
    let out = "";
    for (;;) {
      if (at >= text.length) fail("an unterminated string");
      if (multi ? text.startsWith('"""', at) : peek() === '"') {
        at += multi ? 3 : 1;
        return out;
      }
      const ch = advance();
      if (ch === "\n" && !multi) fail("a newline inside a single-line string", line - 1);
      if (ch !== "\\") {
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
      } else if (multi && (esc === "\n" || esc === " " || esc === "\t" || esc === "\r")) {
        while (/[ \t\r\n]/.test(peek())) advance();
      } else fail(`an unknown escape \\${esc}`);
    }
  };

  const literalString = (): string => {
    const multi = text.startsWith("'''", at);
    at += multi ? 3 : 1;
    if (multi && peek() === "\n") advance();
    let out = "";
    for (;;) {
      if (at >= text.length) fail("an unterminated string");
      if (multi ? text.startsWith("'''", at) : peek() === "'") {
        at += multi ? 3 : 1;
        return out;
      }
      const ch = advance();
      if (ch === "\n" && !multi) fail("a newline inside a single-line string", line - 1);
      out += ch;
    }
  };

  const keyPart = (): string => {
    skipSpaces();
    if (peek() === '"') {
      if (text.startsWith('"""', at)) fail("a key cannot be a multi-line string");
      return basicString();
    }
    if (peek() === "'") {
      if (text.startsWith("'''", at)) fail("a key cannot be a multi-line string");
      return literalString();
    }
    let out = "";
    while (BARE_KEY.test(peek()) && peek() !== "") out += advance();
    if (out === "") fail(peek() === "" || peek() === "\n" ? "a key is missing" : `unexpected ${JSON.stringify(peek())} where a key belongs`);
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
    if (ch === '"') return basicString();
    if (ch === "'") return literalString();
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
      LINES.set(table, line);
      skipSpaces();
      if (peek() === "}") {
        advance();
        closed.add(table);
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
          closed.add(table);
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
    if (/^0x[0-9A-Fa-f_]+$|^0o[0-7_]+$|^0b[01_]+$/.test(word)) return Number(word.replace(/_/g, ""));
    if (/^[+-]?(0|[1-9](_?[0-9])*)(\.[0-9](_?[0-9])*)?([eE][+-]?[0-9](_?[0-9])*)?$/.test(word)) return Number(word.replace(/_/g, ""));
    if (/^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/.test(word)) fail("dates and times are outside the TOML this reader accepts");
    return fail(word === "" ? (ch === "" || ch === "\n" ? "a value is missing after =" : `unexpected ${JSON.stringify(ch)} where a value belongs`) : `${JSON.stringify(word)} is not a TOML value; quote a string`);
  };

  /** Walk to (creating) the table a dotted key's prefix names. */
  const descend = (from: TomlTable, keys: readonly string[], forHeader: boolean): TomlTable => {
    let table = from;
    for (const key of keys) {
      const existing = table[key];
      if (existing === undefined) {
        const made: TomlTable = {};
        LINES.set(made, line);
        table[key] = made;
        table = made;
        continue;
      }
      if (Array.isArray(existing)) {
        if (!forHeader || !tableArrays.has(existing)) fail(`${key} is an array, not a table`);
        const last = existing[existing.length - 1];
        if (last === undefined || typeof last !== "object" || Array.isArray(last)) fail(`${key} is an array, not a table`);
        table = last as TomlTable;
        continue;
      }
      if (typeof existing !== "object" || closed.has(existing)) fail(`${key} is already defined`);
      table = existing as TomlTable;
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
      const headerLine = line;
      const isArray = peek(1) === "[";
      at += isArray ? 2 : 1;
      const keys = dottedKey();
      skipSpaces();
      if (isArray ? !text.startsWith("]]", at) : peek() !== "]") fail(`expected ${isArray ? "]]" : "]"} to close the header`);
      at += isArray ? 2 : 1;
      endOfLine();
      const parent = descend(root, keys.slice(0, -1), true);
      const last = keys[keys.length - 1]!;
      if (isArray) {
        const existing = parent[last];
        const made: TomlTable = {};
        LINES.set(made, headerLine);
        if (existing === undefined) {
          const arr: TomlValue[] = [made];
          tableArrays.add(arr);
          parent[last] = arr;
        } else if (Array.isArray(existing) && tableArrays.has(existing)) existing.push(made);
        else fail(`${keys.join(".")} is already defined, not as an array of tables`, headerLine);
        current = made;
      } else {
        const existing = parent[last];
        if (existing === undefined) {
          const made: TomlTable = {};
          LINES.set(made, headerLine);
          parent[last] = made;
          current = made;
        } else if (typeof existing === "object" && !Array.isArray(existing) && !headed.has(existing) && !closed.has(existing)) {
          current = existing;
        } else fail(`[${keys.join(".")}] is defined twice`, headerLine);
        headed.add(current);
      }
      continue;
    }
    const key = dottedKey();
    skipSpaces();
    if (peek() !== "=") fail(`expected = after the key ${keys(key)}`);
    advance();
    const keyLine = line;
    const v = value();
    if (typeof v === "object" && !Array.isArray(v) && !LINES.has(v)) LINES.set(v, keyLine);
    assign(current, key, v);
    endOfLine();
  }

  function keys(parts: readonly string[]): string {
    return parts.join(".");
  }
}
