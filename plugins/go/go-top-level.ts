/**
 * What the spec model asks of a Go file: whether its top level declares a
 * name. A package-level func, type, var or const, written alone
 * (`func Write(`, `type Entry struct`) or inside a grouped declaration
 * (`var (` … `)`), each name of a list (`var a, b int`) among them. A method
 * (`func (e *Entry) Name(`) is not a package-level name, and neither is a
 * local inside a function body, a struct's field or a name in a comment or
 * a raw string. Read through go-source.ts, the plugin's one model of Go.
 */

import { declarationsIn } from "./go-source.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether the text declares the name at its top level. */
export function goDeclaresAtTop(text: string, name: string): boolean {
  if (!IDENT.test(name)) return false;
  return declarationsIn(text).some((d) => d.names.includes(name));
}
