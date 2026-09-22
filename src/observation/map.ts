/**
 * What executed, as positions in the project's files, and the pure questions
 * the mapping asks of it. Every runner's coverage is normalized here to spans
 * in the language server's coordinates (zero-based line and character), so a
 * reference site the adapter reported and a range V8, istanbul, or coverage.py
 * reported compare directly.
 *
 * Coverage says what executed, never who called whom. A component interface
 * is crossed in a test when a reference site in `from` sat in code that
 * executed in that test AND the referenced symbol's own body executed in the
 * same test: the two co-executed. The record says co-executed, never called.
 */

import { positionBefore, type Position, type Range } from "../adapters/adapter.ts";

/**
 * One executed (or explicitly unexecuted) range. `module` is a file's top
 * level (load time, attributable to no test); `function` a function's whole
 * body; `block` a range inside a function that ran, whose count overrides the
 * function's; `line` one line coverage.py reported executed.
 */
export interface Span {
  start: Position;
  end: Position;
  count: number;
  kind: "module" | "function" | "block" | "line";
  /** A function's name as the runtime reported it, when it did. */
  name?: string;
}

/** What executed in one project file, in one test or one run. */
export interface ExecutedFile {
  /** Project-relative, forward slashes. */
  file: string;
  spans: Span[];
}

/** A zero-based position for every UTF-16 offset of a text, as V8 counts offsets. */
export function positionsOf(text: string): (offset: number) => Position {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset: number): Position => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low, character: offset - starts[low]! };
  };
}

function contains(span: { start: Position; end: Position }, position: Position): boolean {
  return !positionBefore(position, span.start) && positionBefore(position, span.end);
}

function smaller(a: Span, b: Span): boolean {
  // The later start is inside; on a tie, the earlier end.
  if (positionBefore(b.start, a.start)) return true;
  if (positionBefore(a.start, b.start)) return false;
  return positionBefore(a.end, b.end);
}

function innermost(spans: readonly Span[]): Span | undefined {
  let best: Span | undefined;
  for (const span of spans) if (best === undefined || smaller(span, best)) best = span;
  return best;
}

/**
 * Whether the code at a position executed. `load time` when it sits at a
 * module's top level, outside every function: that runs when the module
 * loads, which no test owns, so it is never evidence for a test.
 */
export function siteExecuted(spans: readonly Span[], position: Position): "executed" | "not executed" | "load time" {
  const lines = spans.filter((s) => s.kind === "line");
  if (lines.length > 0) return lines.some((s) => s.start.line === position.line && s.count > 0) ? "executed" : "not executed";
  const fn = innermost(spans.filter((s) => s.kind === "function" && contains(s, position)));
  if (fn === undefined) return "load time";
  if (fn.count === 0) return "not executed";
  const block = innermost(spans.filter((s) => s.kind === "block" && contains(s, position) && !positionBefore(s.start, fn.start) && !positionBefore(fn.end, s.end)));
  // A function nested inside the block but not run is excluded above: the innermost function decided first.
  return block === undefined || block.count > 0 ? "executed" : "not executed";
}

/**
 * Whether a declaration's body executed: a function starting inside its
 * range ran (a function, a method of a class, an arrow a constant holds), or,
 * where only lines are known, a line after its first executed. The first line
 * of a Python `def` or `class` runs at import, which is not the body.
 */
export function bodyExecuted(spans: readonly Span[], range: Range): boolean {
  for (const span of spans) {
    if (span.count <= 0) continue;
    if (span.kind === "function" && !positionBefore(span.start, range.start) && !positionBefore(range.end, span.start)) return true;
    if (span.kind === "line" && span.start.line > range.start.line && span.start.line <= range.end.line) return true;
  }
  return false;
}

/** Whether any function (not a module's top level) executed in the file. */
export function anyFunctionExecuted(spans: readonly Span[]): boolean {
  return spans.some((s) => (s.kind === "function" || s.kind === "line") && s.count > 0);
}

/* ------------------------------------------------------------ the frame */

/** One stack frame, project-relative. */
export interface Frame {
  file: string;
  /** One-based, as a stack prints it. */
  line: number;
}

const JS_FRAME = /\(?((?:file:\/\/)?\/[^\s():]+):(\d+):\d+\)?\s*$/;
const PY_FRAME = /^(?:\s*File "([^"]+)", line (\d+)|([^\s:]+\.py):(\d+):)/;

/**
 * The frames of a failure's text, innermost first, as absolute paths or
 * paths as printed: V8's `at fn (file:///x.ts:12:5)` lines (printed innermost
 * first), and Python's `File "x.py", line 12` and pytest's `x.py:12: in fn`
 * lines (printed innermost last, so reversed here).
 */
export function framesOf(text: string): { path: string; line: number }[] {
  const js: { path: string; line: number }[] = [];
  const py: { path: string; line: number }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*at\s/.test(line)) {
      const m = JS_FRAME.exec(line);
      if (m !== null) js.push({ path: decodeURIComponent(m[1]!.replace(/^file:\/\//, "")), line: Number(m[2]) });
      continue;
    }
    const p = PY_FRAME.exec(line);
    if (p !== null) py.push({ path: (p[1] ?? p[3])!, line: Number(p[2] ?? p[4]) });
  }
  return [...js, ...py.reverse()];
}
