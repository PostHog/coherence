/**
 * Rust's own facts for the component interface reading, which no parse says
 * (component-interfaces.ts reads them through INTERFACE_SYNTAX): the import
 * answers, which declaration is a type, and which names a file imports
 * renamed or by a glob, are derived from Rust's parser and rust.scm.
 */

import type { InterfaceSyntax } from "../../src/plugins/api.ts";

/** Rust has no default export; rust-analyzer reads its Cargo workspace, so it takes no bounds. */
export const RUST_INTERFACES: Partial<InterfaceSyntax> = {
  isDefaultExport: () => false,
  serverBounds: false,
  defaultNames: () => [],
};
