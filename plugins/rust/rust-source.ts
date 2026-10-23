/**
 * Rust's facts for the plain source scan: which items a line declares at the
 * top level, which names a file brings in by `use` and `mod`, and where a
 * module path resolves (source.ts reads them through SOURCE_SYNTAX).
 *
 * A path resolves by Cargo's layout, not by rust-analyzer: a file's crate
 * root is found from its path (crateRootOf), and a module's file is
 * <parent>/<name>.rs or <parent>/<name>/mod.rs.
 * A #[path] attribute and a module declared inline (`mod a { … }`) are not
 * followed; a path into another crate of the workspace resolves to nothing.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";
import type { SourceSyntax } from "../../src/plugins/api.ts";

/** An item at column zero: under any visibility and qualifier, its keyword, then its name. */
export const RUST_ITEM = /^(pub(?:\s*\([^)]*\))?\s+)?(?:(?:default|const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|union|trait|type|const|static(?:\s+mut)?|mod)\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)/;
const MACRO = /^macro_rules!\s*([A-Za-z_][A-Za-z0-9_]*)/;

/** One leaf of a use tree: the path it names, with `*` for a glob and `self` for the module itself, and the name it is brought in as. */
export interface UseLeaf {
  path: string[];
  alias?: string;
}

/** A raw string, a char or string literal, a block comment or a line comment, in the order Rust reads them. */
const LITERAL_OR_COMMENT = /(?<![\w])b?r(#*)"[\s\S]*?"\1|'(?:\\.|[^'\\\n])'|"(?:\\[\s\S]|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** The text with its comments blanked to spaces, every offset and line kept, so nothing in a comment is read; a string, raw string or char literal is kept whole, so a // inside one is no comment. */
export function uncommented(text: string): string {
  return text.replace(LITERAL_OR_COMMENT, (m) => (/^(?:b?r#*)?["']/.test(m) ? m : m.replace(/[^\n]/g, " ")));
}

/** The text with its comments and the contents of its literals blanked, every offset kept: only code is left, so a use or mod in a string is never read. */
export function codeOnly(text: string): string {
  return text.replace(LITERAL_OR_COMMENT, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * The character ranges of the text that compile only for tests: the body of
 * an item marked #[cfg(test)], #[test] or #[<runtime>::test], from its
 * attribute to its closing brace. Read over the uncommented text.
 */
export function testRanges(text: string): [number, number][] {
  const code = codeOnly(text);
  const ranges: [number, number][] = [];
  for (const m of code.matchAll(/#\[\s*(?:cfg\s*\(\s*test\s*\)|(?:[\w:]*::)?test)\s*\]/g)) {
    const open = code.indexOf("{", m.index);
    const semi = code.indexOf(";", m.index);
    if (open < 0 || (semi >= 0 && semi < open)) continue;
    let depth = 0;
    let end = open;
    for (; end < code.length; end++) {
      if (code[end] === "{") depth += 1;
      else if (code[end] === "}" && --depth === 0) break;
    }
    ranges.push([m.index, end]);
  }
  return ranges;
}

/** Splits at the commas outside braces. */
function topLevelParts(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

function walk(tree: string, prefix: readonly string[], out: UseLeaf[]): void {
  const s = tree.trim();
  const brace = s.indexOf("{");
  if (brace >= 0 && s.endsWith("}")) {
    const head = s.slice(0, brace).replace(/::\s*$/, "").trim();
    const base = head === "" ? [...prefix] : [...prefix, ...segments(head)];
    for (const part of topLevelParts(s.slice(brace + 1, -1))) walk(part, base, out);
    return;
  }
  const m = /^(.*?)(?:\s+as\s+(?:r#)?([A-Za-z_]\w*))?$/s.exec(s);
  if (m === null || m[1]!.trim() === "") return;
  const leaf: UseLeaf = { path: [...prefix, ...segments(m[1]!)] };
  if (m[2] !== undefined) leaf.alias = m[2];
  out.push(leaf);
}

/** A path's segments; a leading `::` (the extern prelude) is kept as an empty first segment. */
function segments(path: string): string[] {
  const parts = path.replace(/\s+/g, "").split("::").map((p) => p.replace(/^r#/, ""));
  return parts[0] === "" ? ["", ...parts.slice(1).filter((p) => p !== "")] : parts.filter((p) => p !== "");
}

/** Every leaf of every use declaration in the text, in order: `pub use` re-exports included. */
export function useLeaves(text: string): UseLeaf[] {
  const out: UseLeaf[] = [];
  for (const m of codeOnly(text).matchAll(/(?:^|[;{}\s])(?:pub(?:\s*\([^)]*\))?\s+)?use\s+([^;]+);/g)) walk(m[1]!, [], out);
  return out;
}

/** The text of each use declaration's tree, where its `original as alias` renames are read from. */
export function useTrees(text: string): string[] {
  return [...codeOnly(text).matchAll(/(?:^|[;{}\s])(?:pub(?:\s*\([^)]*\))?\s+)?use\s+([^;]+);/g)].map((m) => m[1]!);
}

/** The modules a file declares out of line: `mod a;`, never an inline `mod a { … }`. */
export function declaredModules(text: string): string[] {
  return [...codeOnly(text).matchAll(/^\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+(?:r#)?([A-Za-z_]\w*)\s*;/gm)].map((m) => m[1]!);
}

/**
 * The root file of the crate a project file belongs to, by Cargo's layout
 * alone: src/lib.rs, src/main.rs, build.rs and src/bin/x.rs are each a root
 * of their own, a file under src/bin/x/ belongs to src/bin/x/main.rs, and
 * any other file under a src/ folder to that folder's lib.rs (whose folder is
 * all that resolution reads). Undefined for a file under no src/ folder.
 */
export function crateRootOf(file: string): string | undefined {
  if (/(^|\/)build\.rs$/.test(file)) return file;
  const parts = file.split("/");
  const src = parts.lastIndexOf("src");
  if (src < 0) return undefined;
  const base = parts.slice(0, src + 1).join("/");
  const rest = parts.slice(src + 1);
  if (rest.length === 1 && (rest[0] === "lib.rs" || rest[0] === "main.rs")) return file;
  if (rest[0] === "bin" && rest.length === 2) return file;
  if (rest[0] === "bin" && rest.length > 2) return posix.join(base, "bin", rest[1]!, "main.rs");
  return posix.join(base, "lib.rs");
}

/** The module path a file defines within its crate: [] for the crate root, [a, b] for a/b.rs or a/b/mod.rs. */
export function modulePathOf(file: string, crateRoot: string): string[] {
  if (file === crateRoot) return [];
  const rel = posix.relative(posix.dirname(crateRoot), file).replace(/\.rs$/, "").split("/");
  return rel[rel.length - 1] === "mod" ? rel.slice(0, -1) : rel;
}

/** The file that defines a module path of the crate, or undefined when neither layout holds one. */
export function moduleFileOf(exists: (file: string) => boolean, crateRoot: string, path: readonly string[]): string | undefined {
  if (path.length === 0) return crateRoot;
  const base = posix.join(posix.dirname(crateRoot), ...path);
  return [`${base}.rs`, posix.join(base, "mod.rs")].find(exists);
}

/**
 * The module file a use path names from a file (absolutePath), or undefined
 * for a path into another crate or a module neither layout holds.
 */
export function resolvePath(exists: (file: string) => boolean, from: string, path: readonly string[], crateRoot: string | undefined = crateRootOf(from)): string | undefined {
  if (crateRoot === undefined || path.length === 0 || path[0] === "") return undefined;
  const absolute = absolutePath(from, crateRoot, path);
  return absolute === undefined ? undefined : moduleFileOf(exists, crateRoot, absolute);
}

/** A use path as a module path from its crate's root: crate::, self:: and super:: read, and a bare path read as one of the file's own modules. Undefined past the crate root or into the extern prelude. */
export function absolutePath(from: string, crateRoot: string, path: readonly string[]): string[] | undefined {
  if (path.length === 0 || path[0] === "") return undefined;
  const here = modulePathOf(from, crateRoot);
  let absolute: string[];
  if (path[0] === "crate") absolute = path.slice(1);
  else if (path[0] === "self") absolute = [...here, ...path.slice(1)];
  else if (path[0] === "super") {
    let up = 0;
    while (path[up] === "super") up += 1;
    if (up > here.length) return undefined;
    absolute = [...here.slice(0, here.length - up), ...path.slice(up)];
  } else absolute = [...here, ...path];
  return absolute;
}

/** A Cargo manifest's text, or undefined when it cannot be read. */
function manifestText(root: string, file: string): string | undefined {
  try {
    return readFileSync(resolve(root, file), "utf8");
  } catch {
    return undefined;
  }
}

/** The body of one [table] of a TOML text: its lines up to the next table header. */
export function tomlTable(text: string, name: string): string | undefined {
  const at = new RegExp(`^\\s*\\[${name.replace(/\./g, "\\.")}\\]\\s*$`, "m").exec(text);
  if (at === null) return undefined;
  const rest = text.slice(at.index + at[0].length);
  return rest.slice(0, /^\s*\[/m.exec(rest)?.index ?? rest.length);
}

/** The member folders a workspace manifest lists, a glob in the last segment (crates/*, axum-*) expanded to the folders it matches that hold a Cargo.toml. */
function workspaceMembers(root: string, manifest: string): string[] {
  const list = /^\s*members\s*=\s*\[([^\]]*)\]/m.exec(tomlTable(manifest, "workspace") ?? "")?.[1];
  const folders: string[] = [];
  for (const [, member] of list?.matchAll(/"([^"]+)"/g) ?? []) {
    if (!member!.includes("*")) {
      folders.push(posix.normalize(member!));
      continue;
    }
    const parent = posix.dirname(member!);
    const glob = new RegExp(`^${posix.basename(member!).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    try {
      for (const entry of readdirSync(resolve(root, parent), { withFileTypes: true })) if (entry.isDirectory() && glob.test(entry.name) && existsSync(resolve(root, parent, entry.name, "Cargo.toml"))) folders.push(posix.join(parent, entry.name));
    } catch {
      // A glob over a folder that is not there lists nothing.
    }
  }
  return folders;
}

/** The crates of a project's root workspace: each library's root by the name a path spells it, and every target root a manifest names at a path of its own. */
export interface Workspace {
  /** By package name, - read as _: the library root. */
  crates: Map<string, string>;
  /** The [lib] and [[bin]] paths the manifests name, each a crate root wherever it lies. */
  roots: string[];
}

/** Each root's workspace, with the modification time of the root manifest it was read at. */
const WORKSPACES = new Map<string, { at: number; workspace: Workspace }>();

/**
 * The project's root workspace, read once per root and again when its
 * Cargo.toml changes. A crate of the workspace is the project's own code, so
 * a path into it resolves as a path into the importing crate does.
 */
export function workspaceOf(root: string): Workspace {
  let at: number;
  try {
    at = statSync(resolve(root, "Cargo.toml")).mtimeMs;
  } catch {
    return { crates: new Map(), roots: [] };
  }
  const known = WORKSPACES.get(root);
  if (known !== undefined && known.at === at) return known.workspace;
  const workspace: Workspace = { crates: new Map(), roots: [] };
  const top = manifestText(root, "Cargo.toml");
  for (const folder of top === undefined ? [] : ["", ...workspaceMembers(root, top)]) {
    const manifest = folder === "" ? top! : manifestText(root, posix.join(folder, "Cargo.toml"));
    if (manifest === undefined) continue;
    const lib = /^\s*path\s*=\s*"([^"]+)"/m.exec(tomlTable(manifest, "lib") ?? "")?.[1];
    if (lib !== undefined) workspace.roots.push(posix.join(folder, lib));
    for (const table of manifest.split(/^\s*\[\[bin\]\]\s*$/m).slice(1)) {
      const bin = /^\s*path\s*=\s*"([^"]+)"/m.exec(table.split(/^\s*\[/m)[0]!)?.[1];
      if (bin !== undefined) workspace.roots.push(posix.join(folder, bin));
    }
    const pkg = /^\s*name\s*=\s*"([^"]+)"/m.exec(tomlTable(manifest, "package") ?? "")?.[1];
    if (pkg !== undefined) workspace.crates.set(pkg.replace(/-/g, "_"), posix.join(folder, lib ?? "src/lib.rs"));
  }
  WORKSPACES.set(root, { at, workspace });
  return workspace;
}

/** A file's crate root: the nearest a manifest names at a path of its own (a [[bin]] at crates/core/main.rs), else Cargo's layout (crateRootOf). */
export function crateRootIn(workspace: Workspace, file: string): string | undefined {
  const folder = (f: string): string => (posix.dirname(f) === "." ? "" : posix.dirname(f));
  const within = (r: string): boolean => file === r || folder(r) === "" || file.startsWith(`${folder(r)}/`);
  const named = workspace.roots.filter(within).sort((a, b) => folder(b).length - folder(a).length)[0];
  const layout = crateRootOf(file);
  if (named === undefined) return layout;
  if (layout === undefined || file === named) return named;
  return folder(named).length > folder(layout).length ? named : layout;
}

/** Whether the file is there under exactly that spelling: a case-insensitive disk (macOS's) finds flags/HiArgs.rs for flags/hiargs.rs, and a path's segment is a module's name only as written. */
function spelled(root: string, file: string): boolean {
  if (!existsSync(resolve(root, file))) return false;
  try {
    return readdirSync(resolve(root, posix.dirname(file))).includes(posix.basename(file));
  } catch {
    return false;
  }
}

/** A pub item is seen outside its file (pub(crate) and pub(super) included); a private one only in its module. */
export const RUST_SOURCE: SourceSyntax = {
  declarationOf(line) {
    const item = RUST_ITEM.exec(line);
    if (item !== null) return { name: item[3]!, exported: item[1] !== undefined };
    const macro = MACRO.exec(line);
    return macro === null ? undefined : { name: macro[1]!, exported: false };
  },
  resolveModule(root, from, specifier, vanished) {
    const exists = (file: string): boolean => vanished.has(file) || spelled(root, file);
    const path = specifier.split("::");
    const workspace = workspaceOf(root);
    const own = resolvePath(exists, from, path, crateRootIn(workspace, from));
    if (own !== undefined) return own;
    // A path into another crate of the workspace: its first segment names the crate, the rest a module from its root.
    const crateRoot = workspace.crates.get(path[0] === "" ? path[1] ?? "" : path[0]!);
    return crateRoot === undefined ? undefined : moduleFileOf(exists, crateRoot, path.slice(path[0] === "" ? 2 : 1));
  },
  importsOf(text, add) {
    for (const leaf of useLeaves(text)) {
      const last = leaf.path[leaf.path.length - 1]!;
      const prefix = leaf.path.slice(0, -1);
      if (last === "*" || last === "self") {
        if (prefix.length > 0) add(undefined, prefix.join("::"));
        continue;
      }
      // `use a::b` names an item of a or the module a::b; each is handed on, and only the one that resolves is kept.
      if (prefix.length > 0) add(last, prefix.join("::"));
      add(undefined, leaf.path.join("::"));
    }
    for (const name of declaredModules(text)) add(undefined, `self::${name}`);
  },
};
