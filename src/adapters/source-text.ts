/**
 * A source file's code apart from its comments and strings, for the scans
 * that read TypeScript as text (entrance detection, Convex's generated API
 * references): a shape written in a comment or a string is no code.
 */

/** The words after which a slash opens a regex literal rather than dividing. */
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

/**
 * The text with every comment blanked, and the contents of every string,
 * template text and regex literal too when asked, each character replaced by
 * a space so offsets and lines stand. A template literal's substitutions stay
 * code. A slash opens a regex literal where an operand may begin, and divides
 * after an operand.
 */
export function blankNonCode(text: string, strings: boolean): string {
  const out = text.split("");
  const blank = (from: number, to: number): void => {
    if (!strings) return;
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const blankComment = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const substitutions: number[] = [];
  let depth = 0;
  let operandMayBegin = true;

  /** Read template text from `from` to the closing backtick or a substitution; the index after it, and whether a substitution opened. */
  const templateText = (from: number): { next: number; opened: boolean } => {
    let j = from;
    while (j < text.length) {
      if (text[j] === "\\") j += 2;
      else if (text[j] === "`") {
        blank(from, j);
        return { next: j + 1, opened: false };
      } else if (text[j] === "$" && text[j + 1] === "{") {
        blank(from, j);
        substitutions.push(depth);
        depth += 1;
        return { next: j + 2, opened: true };
      } else j += 1;
    }
    blank(from, text.length);
    return { next: text.length, opened: false };
  };

  /** The index after the regex literal opening at `from`, or undefined when the line ends first. */
  const regexEnd = (from: number): number | undefined => {
    let inClass = false;
    for (let j = from + 1; j < text.length; j++) {
      const c = text[j];
      if (c === "\n") return undefined;
      if (c === "\\") j += 1;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        blank(from + 1, j);
        let k = j + 1;
        while (k < text.length && /[a-z]/i.test(text[k]!)) k += 1;
        return k;
      }
    }
    return undefined;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      blankComment(i, stop);
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blankComment(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      blank(i + 1, Math.min(j, text.length));
      i = j + 1;
      operandMayBegin = false;
    } else if (c === "`") {
      const read = templateText(i + 1);
      i = read.next;
      operandMayBegin = read.opened;
    } else if (c === "/" && operandMayBegin && regexEnd(i) !== undefined) {
      i = regexEnd(i)!;
      operandMayBegin = false;
    } else if (c === "{") {
      depth += 1;
      i += 1;
      operandMayBegin = true;
    } else if (c === "}") {
      depth -= 1;
      if (substitutions.at(-1) === depth) {
        substitutions.pop();
        const read = templateText(i + 1);
        i = read.next;
        operandMayBegin = read.opened;
      } else {
        i += 1;
        operandMayBegin = true;
      }
    } else if (/[\w$]/.test(c)) {
      let j = i;
      while (j < text.length && /[\w$]/.test(text[j]!)) j += 1;
      operandMayBegin = REGEX_AFTER_WORD.has(text.slice(i, j));
      i = j;
    } else if (/\s/.test(c)) i += 1;
    else {
      operandMayBegin = c !== ")" && c !== "]";
      i += 1;
    }
  }
  return out.join("");
}
