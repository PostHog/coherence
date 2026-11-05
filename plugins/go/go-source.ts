/**
 * Where a Go import leads, and what the plugin's other readings read of Go's
 * text: what no parse can say, since a package's place is Go's module
 * layout, not its syntax. What a file declares, imports and uses through an
 * import is read through Go's parser and go.scm (the manifest's treeSitter).
 *
 * A path resolves by the module layout, not by gopls: the nearest go.mod
 * above the importing file names its module path, and a path under it is
 * the folder below that go.mod; a go.work at the root adds the modules it
 * uses. A replace directive and a path into any other module (the standard
 * library, a dependency, a vendored copy) resolve to nothing.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";
import type { ModuleResolution } from "../../src/plugins/api.ts";

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

/* ----------------------------------------------------------------- imports */

/** The name a package is referred to by when its import gives none: its path's last element, a major version (`/v2`, `.v3`) passed over. */
export function packageNameOf(path: string): string {
  const parts = path.split("/");
  let last = parts[parts.length - 1] ?? "";
  if (/^v\d+$/.test(last) && parts.length > 1) last = parts[parts.length - 2]!;
  return last.replace(/\.v\d+$/, "").replace(/^go-/, "").replace(/[^A-Za-z0-9_].*$/, "");
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
 * A Go import is of a package, a folder of files: resolveModule names the
 * package as a module, its folder and every file of it, and the import
 * brings in each exported name the file uses through the name it binds
 * (st.Seal: boundName, the alias the spec gives taking its place), so the
 * core joins each name to the file that declares it (economy/source.ts
 * importsOf). A package imported for its side effects, dot-imported, or
 * whose names the file never spells is imported whole, and reaches every
 * file of it. A file of the package the change deleted (vanished) stays
 * among its files, so its importers are found. Go has no glob import the
 * word index keys by a path: a dot import's names are spelled at each use.
 */
export const GO_RESOLVE: ModuleResolution = {
  resolveModule(root, from, specifier, vanished) {
    const folder = packageFolderOf(root, from, specifier);
    if (folder === undefined) return undefined;
    const present = packageFiles(root, folder);
    const gone = [...vanished].filter((f) => isPackageFile(f) && (posix.dirname(f) === "." ? "" : posix.dirname(f)) === folder && !present.includes(f));
    return { module: folder, files: [...present, ...gone].sort() };
  },
  modulePaths: () => [],
  boundName: packageNameOf,
};
