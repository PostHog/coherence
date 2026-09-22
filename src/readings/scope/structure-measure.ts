/**
 * The Structure map's measure: read a rendered SVG the way a reader's eye
 * does and count what makes a map unreadable. Text boxes come from font
 * metrics embedded here (Helvetica's, which Arial shares and which the map's
 * text is set in), never from the renderer's own layout, so the check cannot
 * agree with the layout merely because both made the same mistake.
 *
 * Counts: pairs of visible text boxes that overlap; text that is truncated
 * (ends in an ellipsis) or clipped (leaves the canvas, or leaves the box it
 * is declared to sit within); line segments that are not horizontal,
 * vertical, or at 45 degrees (a curve is one such segment); and crossings
 * between distinct drawn lines outside any station box, where routes meet by
 * design.
 *
 * Pure and Node-free: it reads a string. The before-and-after measure and
 * the check in structure-flow.test.ts both call it.
 */

/** Advance widths in thousandths of an em, for the ASCII range 32..126. */
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
const WIDE: Record<string, number> = { "·": 278, "–": 556, "—": 1000, "…": 1000, "→": 1000, "←": 1000, "✕": 1000, "▸": 1000, "−": 584 };

/** The rendered width of `text` at `size` px: the embedded advance widths, with a small allowance for the system face. */
export function textWidth(text: string, size: number, bold = false, letterSpacing = 0): number {
  const table = bold ? BOLD : REGULAR;
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    units += code >= 32 && code <= 126 ? table[code - 32]! : (WIDE[ch] ?? 1000);
  }
  return (units / 1000) * size * 1.04 + letterSpacing * [...text].length;
}

export interface TextBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  within: string | undefined;
}

export interface LineShape {
  id: string;
  points: [number, number][];
  /** Segments: straight ones as their ends; a curve counts as one segment that is not octilinear. */
  offAngle: number;
  segments: number;
}

export interface SvgMeasure {
  width: number;
  height: number;
  texts: TextBox[];
  overlaps: [string, string][];
  truncated: string[];
  clipped: string[];
  segments: number;
  offAngle: number;
  crossings: number;
  lines: LineShape[];
}

interface Element {
  tag: string;
  attrs: Record<string, string>;
}

function attrsOf(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[m[1]!] = m[2]!;
  return attrs;
}

function svgUnescape(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function classes(el: Element): string[] {
  return (el.attrs["class"] ?? "").split(/\s+/).filter(Boolean);
}

/** Font of a text element: its own attributes first, else the classes the earlier map used. */
function fontOf(el: Element, stack: Element[]): { size: number; bold: boolean; upper: boolean; spacing: number } {
  const size = el.attrs["font-size"];
  if (size !== undefined) return { size: Number(size), bold: el.attrs["font-weight"] === "700" || el.attrs["font-weight"] === "bold", upper: false, spacing: 0 };
  const c = classes(el);
  if (c.includes("flow-node-name")) return { size: 13, bold: true, upper: false, spacing: 0 };
  if (c.includes("flow-node-mark") || c.includes("flow-node-tag")) return { size: 10.5, bold: true, upper: false, spacing: 0 };
  if (c.includes("flow-node-folder") || c.includes("flow-node-counts")) return { size: 10.5, bold: false, upper: false, spacing: 0 };
  if (c.includes("flow-caption")) return { size: 11, bold: false, upper: true, spacing: 0.66 };
  if (c.includes("structure-proposed-word")) return { size: 11, bold: true, upper: false, spacing: 0 };
  if (c.includes("flow-label-chokepoint") || c.includes("flow-label-defect")) return { size: 11, bold: true, upper: false, spacing: 0 };
  if (stack.some((s) => classes(s).includes("flow-label"))) return { size: 11, bold: false, upper: false, spacing: 0 };
  return { size: 12, bold: false, upper: false, spacing: 0 };
}

/** Whether an element on this stack is shown: the earlier map hid an edge's label unless its edge was labelled. */
function shown(stack: Element[]): boolean {
  for (let i = 0; i < stack.length; i++) {
    const c = classes(stack[i]!);
    if (stack[i]!.attrs["display"] === "none" || stack[i]!.attrs["visibility"] === "hidden") return false;
    if (c.includes("flow-label") && !(i > 0 && classes(stack[i - 1]!).includes("flow-labelled"))) return false;
  }
  return true;
}

/** Points of a path's `d`, flattening curves; with each segment's octilinearity. */
function pathShape(d: string): { points: [number, number][]; segments: number; offAngle: number; runs: [number, number][][] } {
  const tokens = [...d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e-?\d+)?)/g)].map((m) => m[1] ?? Number(m[2]));
  let i = 0;
  let cmd = "M";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  let segments = 0;
  let offAngle = 0;
  const num = (): number => tokens[i++] as number;
  const straight = (nx: number, ny: number): void => {
    const dx = nx - x;
    const dy = ny - y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      segments += 1;
      const ok = Math.abs(dx) < 0.51 || Math.abs(dy) < 0.51 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.51;
      if (!ok) offAngle += 1;
    }
    x = nx;
    y = ny;
    run.push([x, y]);
  };
  while (i < tokens.length) {
    if (typeof tokens[i] === "string") cmd = tokens[i++] as string;
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        const nx = num() + (rel ? x : 0);
        const ny = num() + (rel ? y : 0);
        if (run.length > 1) runs.push(run);
        x = nx;
        y = ny;
        startX = x;
        startY = y;
        run = [[x, y]];
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
        straight(num() + (rel ? x : 0), num() + (rel ? y : 0));
        break;
      case "H":
        straight(num() + (rel ? x : 0), y);
        break;
      case "V":
        straight(x, num() + (rel ? y : 0));
        break;
      case "Z":
        straight(startX, startY);
        break;
      case "C": {
        const p = [num(), num(), num(), num(), num(), num()].map((v, k) => v + (rel ? (k % 2 === 0 ? x : y) : 0));
        const [x1, y1, x2, y2, x3, y3] = p as [number, number, number, number, number, number];
        const x0 = x;
        const y0 = y;
        for (let t = 1; t <= 16; t++) {
          const s = t / 16;
          const a = (1 - s) ** 3;
          const b = 3 * (1 - s) ** 2 * s;
          const c = 3 * (1 - s) * s * s;
          const e = s ** 3;
          run.push([a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3]);
        }
        x = x3;
        y = y3;
        segments += 1;
        offAngle += 1;
        break;
      }
      default: {
        // S, Q, T, A: not drawn by this map; each is one curved segment ending at its last pair.
        const arity = { S: 4, Q: 4, T: 2, A: 7 }[cmd.toUpperCase() as "S" | "Q" | "T" | "A"];
        const values = Array.from({ length: arity }, () => num());
        const nx = values[arity - 2]! + (rel ? x : 0);
        const ny = values[arity - 1]! + (rel ? y : 0);
        run.push([nx, ny]);
        x = nx;
        y = ny;
        segments += 1;
        offAngle += 1;
      }
    }
  }
  if (run.length > 1) runs.push(run);
  return { points: runs.flat(), segments, offAngle, runs };
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): [number, number] | undefined {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0]! * s[1]! - r[1]! * s[0]!;
  if (Math.abs(denom) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * s[1]! - (c[1] - a[1]) * s[0]!) / denom;
  const u = ((c[0] - a[0]) * r[1]! - (c[1] - a[1]) * r[0]!) / denom;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return undefined;
  return [a[0] + t * r[0]!, a[1] + t * r[1]!];
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
}

/**
 * Measure a rendered map. A drawn line is a `path` in an edge group of the
 * earlier map (not its wide hit target) or any `path` or `line` whose class
 * includes `flow-line`; a station box is a `rect` whose group is a node or
 * a station.
 */
export function measureSvg(svg: string): SvgMeasure {
  const stack: Element[] = [];
  const texts: TextBox[] = [];
  const lines: (LineShape & { runs: [number, number][][] })[] = [];
  const stations: { x: number; y: number; w: number; h: number }[] = [];
  const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
  let width = 0;
  let height = 0;
  let open: { el: Element; content: string; stack: Element[] } | undefined;
  let skipDepth = 0;
  const tokenizer = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>|([^<]+)/g;
  for (const m of svg.matchAll(tokenizer)) {
    if (m[5] !== undefined) {
      if (open !== undefined && skipDepth === 0) open.content += m[5];
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2]!;
    const selfClosing = m[4] === "/";
    if (closing) {
      if (tag === "title" || tag === "style") skipDepth = Math.max(0, skipDepth - 1);
      if (tag === "text" && open !== undefined) {
        const el = open.el;
        const content = svgUnescape(open.content.trim());
        if (content !== "" && shown(open.stack.concat([el]))) {
          const font = fontOf(el, open.stack);
          const shownText = font.upper ? content.toUpperCase() : content;
          const w = textWidth(shownText, font.size, font.bold, font.spacing);
          // The map sets every text from its left edge.
          const x = Number(el.attrs["x"] ?? 0);
          const y = Number(el.attrs["y"] ?? 0) - font.size * 0.78;
          texts.push({ text: content, x, y, w, h: font.size * 1.0, within: el.attrs["data-within"] });
        }
        open = undefined;
      }
      if (tag !== "text" && tag !== "title" && tag !== "style") stack.pop();
      continue;
    }
    const el: Element = { tag, attrs: attrsOf(m[3] ?? "") };
    if (tag === "svg" && width === 0) {
      const vb = (el.attrs["viewBox"] ?? "").split(/\s+/).map(Number);
      width = vb[2] ?? Number(el.attrs["width"] ?? 0);
      height = vb[3] ?? Number(el.attrs["height"] ?? 0);
    }
    if (tag === "title" || tag === "style") {
      if (!selfClosing) skipDepth += 1;
      continue;
    }
    if (tag === "text") {
      open = { el, content: "", stack: [...stack] };
      if (selfClosing) open = undefined;
      continue;
    }
    const visible = shown([...stack, el]);
    if (tag === "rect") {
      const box = { x: Number(el.attrs["x"] ?? 0), y: Number(el.attrs["y"] ?? 0), w: Number(el.attrs["width"] ?? 0), h: Number(el.attrs["height"] ?? 0) };
      if (el.attrs["id"] !== undefined) rects.set(el.attrs["id"], box);
      const group = stack[stack.length - 1];
      if (group !== undefined && (classes(group).includes("flow-node") || classes(group).includes("flow-station"))) stations.push(box);
    }
    const inEdge = stack.some((s) => classes(s).includes("flow-edge"));
    const isLine = (tag === "path" || tag === "line") && visible && (classes(el).includes("flow-line") || (tag === "path" && inEdge && !classes(el).includes("flow-edge-hit")));
    if (isLine) {
      const d = tag === "line" ? `M ${el.attrs["x1"]} ${el.attrs["y1"]} L ${el.attrs["x2"]} ${el.attrs["y2"]}` : el.attrs["d"] ?? "";
      const shape = pathShape(d);
      lines.push({ id: el.attrs["data-line"] ?? `line-${lines.length}`, ...shape });
    }
    if (!selfClosing && tag !== "path" && tag !== "line" && tag !== "rect" && tag !== "circle" && tag !== "marker" && tag !== "polygon") stack.push(el);
    else if (!selfClosing && (tag === "marker")) stack.push(el);
  }

  const overlaps: [string, string][] = [];
  for (let a = 0; a < texts.length; a++) {
    for (let b = a + 1; b < texts.length; b++) if (overlap(texts[a]!, texts[b]!)) overlaps.push([texts[a]!.text, texts[b]!.text]);
  }
  const truncated = texts.filter((t) => t.text.includes("…")).map((t) => t.text);
  const clipped = texts
    .filter((t) => {
      if (t.x < 0 || t.y < 0 || t.x + t.w > width || t.y + t.h > height) return true;
      if (t.within === undefined) return false;
      const box = rects.get(t.within);
      return box === undefined || t.x < box.x || t.x + t.w > box.x + box.w || t.y < box.y || t.y + t.h > box.y + box.h;
    })
    .map((t) => t.text);

  // Crossings: distinct lines whose segments cross outside every station box.
  const inside = (p: [number, number]): boolean => stations.some((s) => p[0] >= s.x - 1 && p[0] <= s.x + s.w + 1 && p[1] >= s.y - 1 && p[1] <= s.y + s.h + 1);
  let crossings = 0;
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      if (lines[a]!.id === lines[b]!.id) continue;
      for (const ra of lines[a]!.runs) {
        for (let i = 0; i + 1 < ra.length; i++) {
          for (const rb of lines[b]!.runs) {
            for (let j = 0; j + 1 < rb.length; j++) {
              const hit = segmentsCross(ra[i]!, ra[i + 1]!, rb[j]!, rb[j + 1]!);
              if (hit !== undefined && !inside(hit)) crossings += 1;
            }
          }
        }
      }
    }
  }
  return {
    width,
    height,
    texts,
    overlaps,
    truncated,
    clipped,
    segments: lines.reduce((sum, line) => sum + line.segments, 0),
    offAngle: lines.reduce((sum, line) => sum + line.offAngle, 0),
    crossings,
    lines: lines.map(({ runs: _runs, ...line }) => line),
  };
}
