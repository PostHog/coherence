/**
 * What the spec model asks of a Rust file: whether its top level declares a
 * name, an item at column zero (a fn, struct, enum, union, trait, type alias,
 * const, static or mod, under any visibility, async, const, unsafe or extern
 * qualifier) or a macro_rules! macro, so a handler written in Rust (a wasm or
 * FFI export, a dispatcher) is declared as TypeScript's and Python's are.
 */

import { RUST_SOURCE } from "./rust-source.ts";

/** Whether the text declares the name at its top level. */
export function rustDeclaresAtTop(text: string, name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  return text.split("\n").some((line) => RUST_SOURCE.declarationOf(line.replace(/\r$/, ""))?.name === name);
}
