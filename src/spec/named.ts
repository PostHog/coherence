/**
 * How a spec value names a symbol: an identifier, optionally `in <path>`. A
 * handler, a guard, a chokepoint and what one protects are all written so.
 * Group 1 is the symbol, group 2 the path when one is written; anything else
 * (a module path, prose) does not match.
 *
 * Pure, with no import: the spec model, the readings, the closure, the
 * scaffold and the browser bundle all read it.
 */
export const NAMED_SYMBOL = /^([A-Za-z_$][\w$]*)(?:\s+in\s+(\S+))?$/;
