/**
 * How every record store appends: one record, one whole line. A file whose
 * last line has no newline (a write that crashed partway, or a merge that
 * kept one side's unterminated last line) gets the newline first, so the
 * new record never runs on into that line: the torn line stays one line a
 * reader reports as damaged, and the record after it reads whole.
 *
 * Readers take the other half: they order and fold records by their
 * content, never by their place in a file, and a line that appears twice,
 * which a union merge can keep, is read once. Together the two make a union
 * merge of two branches' appends to one session file safe to take whole.
 */

import { appendFileSync, closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Whether the file ends partway through a line: it holds bytes and the last is not a newline. A missing file does not. */
function endsTorn(file: string): boolean {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return false;
  }
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

/** Append `line` (one JSON record and its newline) to a store file, ending a torn last line first. */
export function appendWhole(file: string, line: string): void {
  appendFileSync(file, endsTorn(file) ? `\n${line}` : line, "utf8");
}

/**
 * The lines of a store file a reader takes: each with its 1-based line
 * number, the blank ones left out, and a line identical to one already
 * taken (across every file `seen` has met) left out too, since it is the
 * same record twice, not a second record.
 */
export function storeLines(text: string, seen: Set<string>): { line: string; number: number }[] {
  const out: { line: string; number: number }[] = [];
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push({ line, number: index + 1 });
  });
  return out;
}
