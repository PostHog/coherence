/**
 * Rust's mirror reader (the lists slot): the literal a top-level const or
 * static is set to, read as the declared mirrors read a TypeScript list
 * (mirrors.ts reads it through SyntaxTables.lists). A list a Rust file keeps
 * by hand beside one elsewhere (a shader's bindings, a client's names, a
 * schema's kinds) is one of these:
 *
 *   pub const KINDS: &[&str] = &["box", "sphere", "plane"];
 *   static TABLE: [(&str, u32); 2] = [("a", 1), ("b", 2)];
 *
 * An array (behind any &, or in vec![…]) counts its string literals, a tuple
 * by its first element, as a TypeScript table's rows count by their first
 * column; a path (Kind::Box) counts by its last segment, the name it spells.
 * What it cannot read as a member (a number, a call, a nested array) is kept
 * as written, so a mirror over it compares nothing rather than something
 * wrong. Comments are skipped; a raw string reads as its contents.
 */

import type { Literal } from "../../src/plugins/api.ts";
import { codeOnly, itemOf, uncommented } from "./rust-source.ts";

/**
 * The top-level segments between the bracket opening at `open` and its
 * match, cut from `text` where `code` (the same text with its literals and
 * comments blanked, every offset kept) shows the brackets and commas;
 * undefined when it never closes.
 */
function segmentsOf(code: string, text: string, open: number): string[] | undefined {
  const segments: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "[" || c === "{" || c === "(") depth += 1;
    else if (c === "]" || c === "}" || c === ")") {
      depth -= 1;
      if (depth === 0) {
        const last = text.slice(from, i).trim();
        if (last !== "") segments.push(last);
        return segments;
      }
    } else if (c === "," && depth === 1) {
      segments.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  return undefined;
}

/** A segment that is one string literal, plain, byte or raw: its value. */
function stringValue(segment: string): string | undefined {
  const raw = /^b?r(#*)"([\s\S]*)"\1$/.exec(segment);
  if (raw !== null) return raw[2];
  const plain = /^b?"((?:\\[\s\S]|[^"\\])*)"$/.exec(segment);
  return plain === null ? undefined : plain[1]!.replace(/\\(.)/g, "$1");
}

function member(segment: string): string | undefined {
  const value = stringValue(segment);
  if (value !== undefined) return value;
  // A tuple counts by its first element: a table's rows by their first column.
  if (segment.startsWith("(")) {
    const inner = segmentsOf(codeOnly(segment), segment, 0);
    return inner === undefined || inner.length === 0 ? undefined : member(inner[0]!);
  }
  // A path spells its last segment: Kind::Box is Box.
  return /^(?:(?:r#)?[A-Za-z_]\w*::)+(?:r#)?([A-Za-z_]\w*)$/.exec(segment.replace(/\s+/g, ""))?.[1];
}

/** The literal a top-level const or static named `name` is set to, or undefined when none is set to an array. */
export function rustListOf(original: string, name: string): Literal | undefined {
  const text = uncommented(original);
  const code = codeOnly(original);
  const lines = code.split("\n");
  const at = lines.findIndex((line) => {
    const item = itemOf(line);
    return item?.top === true && (item.keyword === "const" || item.keyword === "static") && item.name === name;
  });
  if (at < 0) return undefined;
  const start = lines.slice(0, at).reduce((n, line) => n + line.length + 1, 0);
  // The = that sets it: past the type annotation, whose brackets ([&str; 3]) may hold a ; but no =.
  let i = start + lines[at]!.indexOf(name) + name.length;
  let depth = 0;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === "[" || c === "(" || c === "<") depth += 1;
    else if (c === "]" || c === ")" || (c === ">" && code[i - 1] !== "-")) depth -= 1;
    else if (c === ";" && depth === 0) return undefined;
    else if (c === "=" && depth === 0 && code[i + 1] !== "=" && code[i + 1] !== ">") break;
  }
  if (i >= code.length) return undefined;
  // Past any & and a vec! that hold the array.
  const rest = /^\s*(?:&\s*(?:'static\s+)?(?:mut\s+)?)*(?:vec!\s*)?/.exec(code.slice(i + 1))![0];
  const open = i + 1 + rest.length;
  if (code[open] !== "[") return undefined;
  const segments = segmentsOf(code, text, open);
  if (segments === undefined) return undefined;
  const members: string[] = [];
  const unread: string[] = [];
  for (const segment of segments) {
    if (segment === "") continue;
    const value = member(segment);
    if (value === undefined) unread.push(segment.length > 40 ? `${segment.slice(0, 37)}...` : segment);
    else members.push(value);
  }
  return { line: at + 1, kind: "array", members, unread };
}
