/**
 * A source file's code apart from its comments and strings, for the scans
 * that read TypeScript as text (entrance detection, Convex's generated API
 * references): a shape written in a comment or a string is no code.
 */

/**
 * The text with every comment blanked, and every string's contents too when
 * asked, each character replaced by a space so offsets and lines stand. A
 * template literal is a string whole, its substitutions included.
 */
export function blankNonCode(text: string, strings: boolean): string {
  const out = text.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && (c === "`" || text[j] !== "\n")) j += text[j] === "\\" ? 2 : 1;
      if (strings) blank(i + 1, Math.min(j, text.length));
      i = j + 1;
    } else i += 1;
  }
  return out.join("");
}
