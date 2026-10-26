/**
 * Go's facts for the plain source scan: which names a file declares at its
 * package level, which packages it imports and which of their names it
 * uses, and where an import path resolves (source.ts reads them through the
 * source slot).
 *
 * A path resolves by the module layout, not by gopls: the nearest go.mod
 * above the importing file names its module path, and a path under it is
 * the folder below that go.mod; a go.work at the root adds the modules it
 * uses. A replace directive and a path into any other module (the standard
 * library, a dependency, a vendored copy) resolve to nothing.
 *
 * This file is the plugin's one model of Go: what code is (comments and
 * literals set apart, a raw string across lines included), what a
 * declaration is (alone or in a grouped `var (`, `const (`, `type (`
 * block), what an import is and what makes a name exported. The other
 * files read Go through it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";
import type { SourceSyntax } from "../../src/plugins/api.ts";

/** Whether a Go identifier is exported: its first character is an upper-case letter. */
export function exported(name: string): boolean {
  return /^\p{Lu}/u.test(name);
}

/** The package clause's name in a Go file's text. */
export function packageClause(text: string): string | undefined {
  return /^package\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(text)?.[1];
}

/* ------------------------------------------------------------------ code */

/** What a line starts inside: a raw string or a block comment opened on a line above. */
interface Lexical {
  raw: boolean;
  block: boolean;
}

/**
 * One line with its comments blanked to spaces, every offset kept, and
 * `literals` set the contents of its string, rune and raw string literals
 * too; `state` carries a raw string or block comment across lines.
 */
function blankLine(line: string, state: Lexical, literals: boolean): string {
  const out = line.split("");
  const blank = (from: number, to: number, keep: boolean): void => {
    if (keep) return;
    for (let k = from; k < to; k++) out[k] = " ";
  };
  let i = 0;
  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf("*/", i);
      const stop = end < 0 ? line.length : end + 2;
      blank(i, stop, false);
      i = stop;
      if (end >= 0) state.block = false;
      continue;
    }
    if (state.raw) {
      const end = line.indexOf("`", i);
      const stop = end < 0 ? line.length : end + 1;
      blank(i, stop, !literals);
      i = stop;
      if (end >= 0) state.raw = false;
      continue;
    }
    const c = line[i]!;
    if (c === "/" && line[i + 1] === "/") {
      blank(i, line.length, false);
      break;
    }
    if (c === "/" && line[i + 1] === "*") {
      state.block = true;
      blank(i, i + 2, false);
      i += 2;
      continue;
    }
    if (c === "`") {
      state.raw = true;
      blank(i, i + 1, !literals);
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + 1, line.length);
      blank(i, stop, !literals);
      i = stop;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** The text with its comments blanked, every offset kept; a literal is kept whole, so an import path and a route pattern are read. */
export function uncommented(text: string): string {
  const state: Lexical = { raw: false, block: false };
  return text.split("\n").map((line) => blankLine(line, state, false)).join("\n");
}

/** The text with its comments and the contents of its literals blanked, every offset kept: only code is left. */
export function codeOnly(text: string): string {
  const state: Lexical = { raw: false, block: false };
  return text.split("\n").map((line) => blankLine(line, state, true)).join("\n");
}

/* ----------------------------------------------------------- declarations */

/** What a declaration's keyword and shape say it is. */
export type GoForm = "func" | "alias" | "interface" | "struct" | "defined" | "const" | "var";

/** A package-level declaration, read the one way every Go reading reads one. */
export interface GoDeclaration {
  /** The names it declares, in order, the blank identifier left out: `var a, b int` declares two. */
  names: string[];
  keyword: "func" | "type" | "var" | "const";
  form: GoForm;
  /** Whether its first name is exported. */
  exported: boolean;
  /** For a var: the text after `=`, trimmed; empty when it has none. */
  value: string;
  /** Inside a grouped block, one level in. */
  grouped: boolean;
}

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const NAMES = new RegExp(`^(${IDENT}(?:\\s*,\\s*${IDENT})*)`);

/** The type's form from the text after its name: `= T` an alias, `interface` or `struct`, else a defined type; type parameters (`[T any]`) are passed over, an array type (`[4]int`) is not one. */
function typeForm(rest: string): GoForm {
  let after = rest.trimStart();
  const params = /^\[\s*[A-Za-z_]\w*\s+[^\]]/.exec(after);
  if (params !== null) {
    let depth = 0;
    let i = 0;
    for (; i < after.length; i++) {
      if (after[i] === "[") depth += 1;
      else if (after[i] === "]" && --depth === 0) break;
    }
    after = after.slice(i + 1).trimStart();
  }
  if (after.startsWith("=")) return "alias";
  if (/^interface\b/.test(after)) return "interface";
  if (/^struct\b/.test(after)) return "struct";
  return "defined";
}

/** A declaration of `keyword` whose names start the code text. */
function declarationFrom(keyword: "type" | "var" | "const", code: string, grouped: boolean): GoDeclaration | undefined {
  const m = NAMES.exec(code);
  if (m === null) return undefined;
  const names = m[1]!.split(/\s*,\s*/).filter((n) => n !== "_");
  if (names.length === 0) return undefined;
  const rest = code.slice(m[0].length);
  const form: GoForm = keyword === "type" ? typeForm(rest) : keyword;
  const value = keyword === "var" ? (/=\s*(.*)$/.exec(rest)?.[1]?.trim() ?? "") : "";
  return { names, keyword, form, exported: exported(names[0]!), value, grouped };
}

/** The net count of opening brackets over closing ones in a code-only line. */
function depthChange(code: string): number {
  let depth = 0;
  for (const c of code) {
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
  }
  return depth;
}

/**
 * Reads a file's lines in order and says what each declares at the package
 * level. It carries what a line alone cannot say: a raw string or block
 * comment opened above, and whether the line sits in a grouped block (and
 * at which bracket depth, so a member's multi-line value or a struct's
 * fields are never members). A package clause starts a file afresh.
 */
export class GoReader {
  private lexical: Lexical = { raw: false, block: false };
  private group: "type" | "var" | "const" | undefined;
  private depth = 0;

  /** What the line declares, or undefined. */
  feed(raw: string): GoDeclaration | undefined {
    const line = raw.replace(/\r$/, "");
    if (/^package\s+[A-Za-z_]\w*\s*(?:\/\/.*)?$/.test(line)) {
      this.lexical = { raw: false, block: false };
      this.group = undefined;
      this.depth = 0;
      return undefined;
    }
    const inside = this.lexical.raw || this.lexical.block;
    const code = blankLine(line, this.lexical, true);
    if (inside) {
      if (this.group !== undefined) this.close(code);
      return undefined;
    }
    if (this.group !== undefined) {
      // A line at column zero that begins a new statement ends a block left open (a file cut short).
      if (/^[A-Za-z_]/.test(code)) {
        this.group = undefined;
        this.depth = 0;
      } else {
        const at = this.depth;
        const keyword = this.group;
        this.close(code);
        return at === 1 && /^\s+[A-Za-z_]/.test(code) ? declarationFrom(keyword, code.trimStart(), true) : undefined;
      }
    }
    const func = new RegExp(`^func\\s+(${IDENT})\\s*[\\[(]`).exec(code);
    if (func !== null) return func[1] === "_" ? undefined : { names: [func[1]!], keyword: "func", form: "func", exported: exported(func[1]!), value: "", grouped: false };
    const opens = /^(type|var|const)\s*\(/.exec(code);
    if (opens !== null) {
      this.depth = depthChange(code.slice(opens[0].length - 1));
      if (this.depth > 0) this.group = opens[1] as "type" | "var" | "const";
      return undefined;
    }
    const single = /^(type|var|const)\s+/.exec(code);
    return single === null ? undefined : declarationFrom(single[1] as "type" | "var" | "const", code.slice(single[0].length), false);
  }

  /** Carries the block's bracket depth past a line, ending it when the depth comes back to zero. */
  private close(code: string): void {
    this.depth += depthChange(code);
    if (this.depth <= 0) {
      this.group = undefined;
      this.depth = 0;
    }
  }
}

/** Every package-level declaration of a file's text, with its one-based line. */
export function declarationsIn(text: string): (GoDeclaration & { line: number })[] {
  const reader = new GoReader();
  const found: (GoDeclaration & { line: number })[] = [];
  text.split("\n").forEach((line, i) => {
    const declared = reader.feed(line);
    if (declared !== undefined) found.push({ ...declared, line: i + 1 });
  });
  return found;
}

/**
 * The declarations the source slot read last, by the line's text: a grouped
 * member's line (`\tLimit = 3`) does not say alone whether it is a var, a
 * const or a type, so the interfaces and declares slots, asked of a line
 * the scan read just before, read the answer it gave. Kept small: cleared
 * past a bound, never a store.
 */
const MEMBERS = new Map<string, GoDeclaration>();
const MEMBERS_BOUND = 20_000;

/**
 * What one line declares, read the one way every Go reading reads it: a
 * column-zero line alone, a grouped member through what the source scan
 * read of it.
 */
export function declarationAt(line: string): GoDeclaration | undefined {
  const text = line.replace(/\r$/, "");
  if (/^\s/.test(text)) return MEMBERS.get(text);
  return new GoReader().feed(text);
}

/** The reader the source slot feeds: declarationsOf hands it every line of one file in order, and the package clause each file opens with starts it afresh. */
const STREAM = new GoReader();

/* ----------------------------------------------------------------- imports */

/** One import spec: the path, and the name it is bound to when the spec gives one (an identifier, `_` or `.`). */
export interface GoImport {
  path: string;
  alias?: string;
  /** One-based. */
  line: number;
}

const SPEC = /^\s*(?:([A-Za-z_]\w*|\.)\s+)?(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`)/;

/** Every import spec of the text, single (`import "fmt"`) and grouped (`import (` … `)`), named, dot and blank. */
export function importsIn(text: string): GoImport[] {
  const lines = uncommented(text).split("\n");
  const out: GoImport[] = [];
  const take = (spec: string, line: number): void => {
    const m = SPEC.exec(spec);
    if (m === null) return;
    const path = m[2] ?? m[3] ?? "";
    if (path === "") return;
    out.push(m[1] === undefined ? { path, line } : { path, alias: m[1], line });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const group = /^import\s*\((.*)$/.exec(line);
    if (group !== null) {
      // A spec may share the opening line, and several may share one line, split by semicolons.
      let rest = group[1]!;
      let j = i;
      for (;;) {
        const close = rest.indexOf(")");
        for (const spec of (close < 0 ? rest : rest.slice(0, close)).split(";")) take(spec, j + 1);
        if (close >= 0 || j + 1 >= lines.length) break;
        j += 1;
        rest = lines[j]!;
      }
      i = j;
      continue;
    }
    const single = /^import\s+(.*)$/.exec(line);
    if (single !== null) take(single[1]!, i + 1);
  }
  return out;
}

/** The name a package is referred to by when its import gives none: its path's last element, a major version (`/v2`, `.v3`) passed over. */
export function packageNameOf(path: string): string {
  const parts = path.split("/");
  let last = parts[parts.length - 1] ?? "";
  if (/^v\d+$/.test(last) && parts.length > 1) last = parts[parts.length - 2]!;
  return last.replace(/\.v\d+$/, "").replace(/^go-/, "").replace(/[^A-Za-z0-9_].*$/, "");
}

/** Every `x.Name` the code spells, by x: a qualified identifier names an imported package's member this way. */
export function selectorsIn(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of codeOnly(text).matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)/g)) {
    const names = out.get(m[1]!) ?? new Set<string>();
    names.add(m[2]!);
    out.set(m[1]!, names);
  }
  return out;
}

/* -------------------------------------------------------------- packages */

/** A file's text, or undefined when it cannot be read. */
function textOf(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The module path a go.mod names. */
export function modulePathOf(text: string): string | undefined {
  return /^module\s+"?([^\s"]+)"?/m.exec(text)?.[1];
}

/** The folders a go.work uses, relative to it. */
export function workspaceUses(text: string): string[] {
  const uses: string[] = [];
  const code = uncommented(text);
  for (const m of code.matchAll(/^use\s*\(([^)]*)\)/gm)) for (const line of m[1]!.split("\n")) if (line.trim() !== "") uses.push(line.trim().replace(/^"|"$/g, ""));
  for (const m of code.matchAll(/^use\s+(?!\()(\S+)/gm)) uses.push(m[1]!.replace(/^"|"$/g, ""));
  return uses.map((u) => posix.normalize(u));
}

/** The modification time of a file, or -1 when it is not there. */
function stamp(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

/** Each folder's nearest go.mod, with the time of the go.mod it was read at: an import is resolved once per name a file spells, so a module is not looked for again each time. */
const MODULES = new Map<string, { mod: string; at: number; module: { folder: string; path: string } | undefined }>();

/** The nearest go.mod at or above a project folder: its folder (project-relative, "" at the root) and its module path. */
export function moduleOf(root: string, folder: string): { folder: string; path: string } | undefined {
  const start = folder === "." ? "" : folder;
  const key = `${resolve(root)}\u0000${start}`;
  const known = MODULES.get(key);
  if (known !== undefined && stamp(known.mod) === known.at) return known.module;
  let at = start;
  for (;;) {
    const mod = resolve(root, at, "go.mod");
    const text = textOf(mod);
    if (text !== undefined || at === "") {
      const path = text === undefined ? undefined : modulePathOf(text);
      const module = path === undefined ? undefined : { folder: at, path };
      MODULES.set(key, { mod, at: stamp(mod), module });
      return module;
    }
    at = posix.dirname(at) === "." ? "" : posix.dirname(at);
  }
}

/** The import path of a project folder's package: its module's path joined with the folder below the go.mod. */
export function importPathOf(root: string, folder: string): string | undefined {
  const module = moduleOf(root, folder);
  if (module === undefined) return undefined;
  const below = module.folder === "" ? folder : posix.relative(module.folder, folder);
  return below === "" || below === "." ? module.path : `${module.path}/${below}`;
}

/** The project folder an import path names, read from the importing file's module and the root's go.work; undefined outside the project's modules. */
export function packageFolderOf(root: string, from: string, path: string): string | undefined {
  const within = (module: { folder: string; path: string }): string | undefined => {
    if (path !== module.path && !path.startsWith(`${module.path}/`)) return undefined;
    const below = path.slice(module.path.length).replace(/^\//, "");
    return posix.join(module.folder, below).replace(/^\.$/, "");
  };
  const fromFolder = posix.dirname(from) === "." ? "" : posix.dirname(from);
  const own = moduleOf(root, fromFolder);
  const found = own === undefined ? undefined : within(own);
  if (found !== undefined) return found;
  for (const module of workspaceOf(root)) {
    const named = within(module);
    if (named !== undefined) return named;
  }
  return undefined;
}

/** Each root's go.work modules, with the time of the go.work they were read at. */
const WORKSPACES = new Map<string, { at: number; modules: { folder: string; path: string }[] }>();

/** The modules the root's go.work uses, each its folder and module path; none without a go.work. */
export function workspaceOf(root: string): { folder: string; path: string }[] {
  const work = resolve(root, "go.work");
  const at = stamp(work);
  const known = WORKSPACES.get(work);
  if (known !== undefined && known.at === at) return known.modules;
  const modules: { folder: string; path: string }[] = [];
  const text = at < 0 ? undefined : textOf(work);
  for (const use of text === undefined ? [] : workspaceUses(text)) {
    const folder = use === "." ? "" : use;
    const mod = textOf(resolve(root, folder, "go.mod"));
    const path = mod === undefined ? undefined : modulePathOf(mod);
    if (path !== undefined) modules.push({ folder, path });
  }
  WORKSPACES.set(work, { at, modules });
  return modules;
}

/** Whether a file is one of a package's own Go files: a .go file that is not a test. */
export function isPackageFile(file: string): boolean {
  return file.endsWith(".go") && !file.endsWith("_test.go");
}

/** A package folder's own Go files, project-relative and sorted. */
export function packageFiles(root: string, folder: string): string[] {
  try {
    return readdirSync(resolve(root, folder), { withFileTypes: true })
      .filter((e) => e.isFile() && isPackageFile(e.name))
      .map((e) => (folder === "" ? e.name : `${folder}/${e.name}`))
      .sort();
  } catch {
    return [];
  }
}

/**
 * A Go import is of a package, a folder of files: importsOf hands the path
 * once per exported name the file uses through it, and resolveModule names
 * the package as a module, its folder and every file of it, so the core
 * joins each name to the file that declares it (economy/source.ts importsOf).
 * A package imported for its side effects, dot-imported, or whose names the
 * file never spells is handed whole, and reaches every file of it. A file of
 * the package the change deleted (vanished) stays among its files, so its
 * importers are found.
 */
export const GO_SOURCE: SourceSyntax = {
  declarationOf(line) {
    const declared = STREAM.feed(line);
    if (declared === undefined) return undefined;
    if (declared.grouped) {
      if (MEMBERS.size >= MEMBERS_BOUND) MEMBERS.clear();
      MEMBERS.set(line.replace(/\r$/, ""), declared);
    }
    return { name: declared.names[0]!, exported: declared.exported, ...(declared.names.length > 1 ? { also: declared.names.slice(1) } : {}) };
  },
  resolveModule(root, from, specifier, vanished) {
    const folder = packageFolderOf(root, from, specifier);
    if (folder === undefined) return undefined;
    const present = packageFiles(root, folder);
    const gone = [...vanished].filter((f) => isPackageFile(f) && (posix.dirname(f) === "." ? "" : posix.dirname(f)) === folder && !present.includes(f));
    return { module: folder, files: [...present, ...gone].sort() };
  },
  importsOf(text, add) {
    const selectors = selectorsIn(text);
    for (const spec of importsIn(text)) {
      if (spec.alias === "_" || spec.alias === ".") {
        add(undefined, spec.path);
        continue;
      }
      const used = [...(selectors.get(spec.alias ?? packageNameOf(spec.path)) ?? [])].filter(exported).sort();
      if (used.length === 0) add(undefined, spec.path);
      for (const name of used) add(name, spec.path);
    }
  },
};
