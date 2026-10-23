/**
 * Rust's facts for the component interface reading: which declaration lines
 * are types, what the word index reads of a file's use trees, and the
 * modules a file glob-imports (component-interfaces.ts reads them through
 * INTERFACE_SYNTAX, kept-answers.ts through KEPT_MODULES).
 */

import { posix } from "node:path";
import type { InterfaceSyntax } from "../../src/plugins/api.ts";
import { absolutePath, crateRootOf, itemOf, useLeaves, useTrees } from "./rust-source.ts";

/** The module files a file glob-imports (`use crate::a::*`), in both layouts the word index may key a module by: a.rs and a/mod.rs. */
function globModules(file: string, text: string): string[] {
  const crateRoot = crateRootOf(file);
  if (crateRoot === undefined) return [];
  const modules: string[] = [];
  for (const leaf of useLeaves(text)) {
    if (leaf.path[leaf.path.length - 1] !== "*") continue;
    const absolute = absolutePath(file, crateRoot, leaf.path.slice(0, -1));
    if (absolute === undefined) continue;
    if (absolute.length === 0) {
      modules.push(crateRoot);
      continue;
    }
    const base = posix.join(posix.dirname(crateRoot), ...absolute);
    modules.push(`${base}.rs`, `${base}/mod.rs`);
  }
  return modules;
}

/** A type alias declares a type only; Rust has no default export; rust-analyzer reads its Cargo workspace, so it takes no bounds. */
export const RUST_INTERFACES: InterfaceSyntax = {
  isTypeDeclaration(line) {
    const item = itemOf(line);
    return item?.top === true && item.keyword === "type";
  },
  isDefaultExport: () => false,
  serverBounds: false,
  importLists: useTrees,
  defaultNames: () => [],
  wildcardModules: globModules,
};

/** The module files a changed file glob-imports, in every spelling a kept answer can name them by. */
export const rustKeptModules: (file: string, text: string) => string[] = globModules;
