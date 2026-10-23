/**
 * Rust's facts for the interface map: what a declaration line's keyword
 * says can execute (interfaces.ts reads them through DECLARES).
 */

import type { InterfaceSymbol } from "../../src/plugins/api.ts";
import { itemOf } from "./rust-source.ts";

/**
 * A fn or a macro has a body, and so does a struct, enum or union, whose
 * impl blocks are its methods (as a TypeScript class's are); a trait or a
 * type alias declares a type; a const or static is a value; a module is
 * counted as able to execute, so never read as bodiless.
 */
export function rustDeclares(line: string): InterfaceSymbol["declares"] {
  const item = itemOf(line);
  const keyword = item?.top === true ? item.keyword : undefined;
  if (keyword === undefined || keyword === "mod") return "unknown";
  if (keyword === "macro_rules") return "body";
  if (keyword === "trait" || keyword === "type") return "type";
  if (keyword === "const" || keyword === "static") return "value";
  return "body";
}
