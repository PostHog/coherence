/**
 * Rust's facts for the component interface reading that are no reading of
 * its text: rust-analyzer reads its Cargo workspace, so it takes no bounds.
 * Which declaration is a type, its default exports (Rust has none, and its
 * queries capture none), and which names a file imports renamed or by a glob
 * are read through Rust's parser and rust.scm; an interfaces table states
 * none of them.
 */

import type { InterfaceFacts } from "../../src/plugins/api.ts";

export const RUST_INTERFACES: InterfaceFacts = {
  serverBounds: false,
};
