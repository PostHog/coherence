/**
 * Rust's facts for the interface map: what a declaration line's keyword
 * says can execute (interfaces.ts reads them through DECLARES).
 */

import type { InterfaceSymbol } from "../../src/plugins/api.ts";
import { RUST_ITEM } from "./rust-source.ts";

/**
 * A fn or a macro has a body, and so does a struct, enum or union, whose
 * impl blocks are its methods (as a TypeScript class's are); a trait or a
 * type alias declares a type; a const or static is a value; a module is
 * counted as able to execute, so never read as bodiless.
 */
export function rustDeclares(line: string): InterfaceSymbol["declares"] {
  if (/^macro_rules!/.test(line)) return "body";
  const keyword = RUST_ITEM.exec(line)?.[2];
  if (keyword === undefined || keyword === "mod") return "unknown";
  if (keyword === "trait" || keyword === "type") return "type";
  if (keyword === "const" || keyword.startsWith("static")) return "value";
  return "body";
}
