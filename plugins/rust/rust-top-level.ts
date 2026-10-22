/**
 * What the spec model asks of a Rust file: whether its top level declares a
 * name, an item at column zero (a fn, struct, enum, union, trait, type alias,
 * const, static or mod, under any visibility, async, const, unsafe or extern
 * qualifier) or a macro_rules! macro, so a handler written in Rust (a wasm or
 * FFI export, a dispatcher) is declared as TypeScript's and Python's are.
 */

/** Whether the text declares the name at its top level. */
export function rustDeclaresAtTop(text: string, name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  const item = new RegExp(`^(?:pub(?:\\([^)]*\\))?\\s+)?(?:(?:default|const|async|unsafe|extern(?:\\s+"[^"]*")?)\\s+)*(?:fn|struct|enum|union|trait|type|const|static(?:\\s+mut)?|mod)\\s+${name}\\b`, "m");
  return item.test(text) || new RegExp(`^macro_rules!\\s*${name}\\b`, "m").test(text);
}
