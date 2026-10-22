/**
 * What the spec model asks of a TypeScript or JavaScript file: whether its
 * top level declares a name. A destructured binding counts, on one line or
 * across several and however deeply nested, as a factory's products are
 * exported (export const { handlers: { GET, POST }, auth } = NextAuth(...));
 * so does an export list, with or without a from, under the name it exports
 * (export { GET, POST } from "./auth", export { handle as GET }): the
 * re-exporting file is where a framework finds the name, and the source is
 * not followed (d-7155e46f).
 */

/** Whether the text declares the name at its top level. */
export function typescriptDeclaresAtTop(text: string, name: string): boolean {
  const escaped = name.replace(/\$/g, "\\$");
  if (destructuredAtTop(text).has(name) || exportListed(text).has(name)) return true;
  return new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum|namespace)\\s+${escaped}\\b`, "m").test(text);
}

/** The text of the braces opening at `open`, through its matching close, or undefined when it never closes. */
function braced(text: string, open: number): string | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return undefined;
}

/** The names a top-level object destructuring binds, on one line or several, nested or not: a name followed by , } or = (a key followed by : binds nothing). */
function destructuredAtTop(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/^(?:export\s+)?(?:const|let|var)\s*(?=\{)/gm)) {
    const open = m.index + m[0].length;
    const pattern = braced(text, open);
    if (pattern === undefined || !/^\s*(?::[^=]+)?=/.test(text.slice(open + pattern.length))) continue;
    for (const b of pattern.matchAll(/(?<=[\s,{:])([A-Za-z_$][\w$]*)(?=\s*[,}=])/g)) names.add(b[1]!);
  }
  return names;
}

/** The names a top-level export list exports, with or without a from: export { a, b as c } from "x" exports a and c. */
function exportListed(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const item of m[1]!.split(",")) {
      const named = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""));
      if (named !== null) names.add(named[2] ?? named[1]!);
    }
  }
  return names;
}
