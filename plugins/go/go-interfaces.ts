/**
 * Go's facts for the interface map: what a declaration line's keyword says
 * can execute (interfaces.ts reads them through the declares slot).
 */

import type { InterfaceSymbol } from "../../src/plugins/api.ts";
import { declarationAt } from "./go-source.ts";

/**
 * A func has a body, and so does a struct or any other defined type, whose
 * methods are declared apart from it (as a Rust struct's impl blocks are);
 * an interface or a type alias declares a type; a const is a value; a var
 * is read by what it is set to: a func literal is a body, a basic literal
 * or nil a value, anything else (a call's result, no value at all, set
 * later) may hold a func, so it is counted as able to execute.
 */
export function goDeclares(line: string): InterfaceSymbol["declares"] {
  const declared = declarationAt(line);
  if (declared === undefined) return "unknown";
  if (declared.form === "alias" || declared.form === "interface") return "type";
  if (declared.form === "const") return "value";
  if (declared.form === "var") {
    if (/^func\b/.test(declared.value)) return "body";
    if (/^(?:[\d"'`.-]|true\b|false\b|nil\b)/.test(declared.value)) return "value";
    return "unknown";
  }
  return "body";
}
