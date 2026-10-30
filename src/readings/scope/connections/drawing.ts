/**
 * The connections view as the reader sees it: the cards, lines, doors, chips
 * and entrance tokens of model.ts drawn as plain SVG, with a rail of origins
 * on the left (where work enters, then every component), a trail of the
 * origins followed, and an inspector on the right for what is selected.
 * Ported from the prototype the owner reviewed (2026-10-30). Built once into
 * its own root element and kept alive across Scope's renders (mount.ts), so
 * the origin, the spawns, the pins and the pan and zoom survive a state
 * update.
 *
 * Placement is the drawing's alone and stored nowhere but in the pins: a
 * card's column is its hops from the origin, and within a column cards are
 * ordered by where their neighbours toward the origin sit, so a layout is a
 * pure function of the origin, the spawned cards and the pins. Dragging a
 * card pins it; a new origin drops every pin.
 */

import type { FlowModel, FlowRoute, FlowState } from "../structure-flow.ts";
import { connectionsDefaultOrigin, connectionsOf, connectionsOriginId, connectionsOriginOf, connectionsReaching, type ConnectionsOrigin, type ConnectionsView } from "./model.ts";

export interface Connections {
  root: HTMLElement;
  /** Draw from a new flow model, keeping the origin, the spawns and the pins where they still name something. */
  update(model: FlowModel): void;
  /** Root the view at the origin a deep link names; false when the model has none by that id. */
  land(id: string): boolean;
  /** The view is on the page again: name its origin in the address and fit it when it has not been fitted. */
  resume(): void;
  dispose(): void;
}

type Selection = { kind: "card"; id: string; core?: boolean } | { kind: "door"; id: string } | { kind: "line"; from: string; to: string } | { kind: "token" };
type Point = { x: number; y: number };

const W = 210, H = 66, COLW = 320, ROWH = 94;
const NS = "http://www.w3.org/2000/svg";
/** The entrance token's place among the cards. */
const TOKEN = "\u0000entrance";

const MARKUP = `<div class="cx-head">
    <div class="cx-trail" data-x="trail"></div>
    <div class="cx-tools"><button type="button" data-x="fit">Fit</button><button type="button" data-x="unpin">Unpin all</button></div>
  </div>
  <div class="cx-body">
    <aside class="cx-rail" data-x="rail" aria-label="Origins"></aside>
    <div class="cx-stage">
      <svg data-x="svg" role="img" aria-label="Component interfaces from the origin"><g data-x="world"></g></svg>
      <details class="cx-key"><summary>Key</summary><div data-x="key"></div></details>
      <div class="cx-hint">drag a card to pin it · drag the ground to pan · scroll to zoom<br>double-click a card to start from it · <b>+N</b> spawns what lies further out</div>
    </div>
    <section class="cx-inspector" data-x="inspector" aria-live="polite"></section>
  </div>`;

const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const short = (f: string): string => (f === "." ? "(root)" : f.replace(/^src\//, ""));
const worst = (states: readonly FlowState[]): FlowState => (states.includes("broken") ? "broken" : states.includes("requirement") ? "requirement" : "verified");
const routeName = (r: FlowRoute): string => (r.names.length > 2 ? `${r.names[0]} +${r.names.length - 1}` : r.names.join(", "));
/**
 * How wide a line of monospace text is: every mark set centred or flush right (a door's identifiers, +N, a token's
 * trust line) is set in the page's mono face, whose advance is 0.6 em, so it is placed from its start, not aligned.
 */
const mono = (text: string, px: number): number => text.length * px * 0.6;
const width = (sites: number): number => 1.2 + Math.min(6, Math.log2(1 + sites) * 0.75);

/** A cubic from one card to another: forward across columns, a side curve within one, or round against the flow. */
function geom(a: Point, b: Point): { d: string; p: number[]; forward: boolean } {
  const dx = b.x - a.x;
  if (dx > W * 0.9) {
    const x1 = a.x + W / 2, y1 = a.y, x2 = b.x - W / 2, y2 = b.y, c = Math.max(50, (x2 - x1) / 2);
    return { d: `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`, p: [x1, y1, x1 + c, y1, x2 - c, y2, x2, y2], forward: true };
  }
  if (Math.abs(dx) <= W * 0.9) {
    const x1 = a.x + W / 2, y1 = a.y + (b.y > a.y ? 8 : -8), x2 = b.x + W / 2, y2 = b.y + (b.y > a.y ? -8 : 8);
    const out = 26 + Math.min(70, Math.abs(y2 - y1) * 0.18);
    return { d: `M${x1},${y1} C${x1 + out},${y1} ${x2 + out},${y2} ${x2},${y2}`, p: [x1, y1, x1 + out, y1, x2 + out, y2, x2, y2], forward: false };
  }
  const x1 = a.x - W / 2, y1 = a.y + 10, x2 = b.x + W / 2, y2 = b.y + 10, c = Math.max(60, (x1 - x2) / 2);
  return { d: `M${x1},${y1} C${x1 - c},${y1 + 40} ${x2 + c},${y2 + 40} ${x2},${y2}`, p: [x1, y1, x1 - c, y1 + 40, x2 + c, y2 + 40, x2, y2], forward: false };
}

function at(p: number[], t: number): [number, number] {
  const u = 1 - t;
  return [u * u * u * p[0]! + 3 * u * u * t * p[2]! + 3 * u * t * t * p[4]! + t * t * t * p[6]!, u * u * u * p[1]! + 3 * u * u * t * p[3]! + 3 * u * t * t * p[5]! + t * t * t * p[7]!];
}

export function createConnections(first: FlowModel): Connections {
  let M = first;
  const root = document.createElement("div");
  root.className = "connections";
  root.innerHTML = MARKUP;
  const $ = <T extends Element = HTMLElement>(name: string): T => root.querySelector(`[data-x="${name}"]`) as T;
  const svg = $<SVGSVGElement>("svg");
  const world = $<SVGGElement>("world");

  let node = new Map(M.nodes.map((n) => [n.folder, n]));
  let route = new Map(M.routes.map((r) => [r.id, r]));
  let edgeOf = new Map(M.edges.map((e) => [`${e.from}\u0000${e.to}`, e]));
  let core = new Set(M.coreDependencies.map((c) => c.folder));
  const index = (): void => {
    node = new Map(M.nodes.map((n) => [n.folder, n]));
    route = new Map(M.routes.map((r) => [r.id, r]));
    edgeOf = new Map(M.edges.map((e) => [`${e.from}\u0000${e.to}`, e]));
    core = new Set(M.coreDependencies.map((c) => c.folder));
  };
  const label = (f: string): string => node.get(f)?.name ?? f;
  const identifier = (text: string) => M.identifiers.find((i) => i.text === text);

  const S = {
    origin: connectionsDefaultOrigin(M),
    trail: [] as ConnectionsOrigin[],
    spawned: new Set<string>(),
    cores: new Set<string>(),
    pins: new Map<string, Point>(),
    sel: null as Selection | null,
    hover: null as string | null,
    view: { x: 0, y: 0, k: 1 },
    fit: true,
    /** Whether the origin was chosen, by the reader or a link, rather than opened on: only a chosen one joins the trail. */
    chosen: false,
  };
  let V: ConnectionsView | undefined;
  let pos = new Map<string, Point>();
  let disposed = false;

  const same = (a: ConnectionsOrigin, b: ConnectionsOrigin): boolean => (a.kind === "route" ? b.kind === "route" && a.id === b.id : b.kind === "component" && a.folder === b.folder);
  const writeHash = (): void => {
    if (S.origin !== undefined && root.isConnected) history.replaceState(null, "", `#${connectionsOriginId(S.origin)}`);
  };

  function setOrigin(o: ConnectionsOrigin, push = true): void {
    if (push && S.chosen && S.origin !== undefined) {
      const i = S.trail.findIndex((t) => same(t, o));
      if (i >= 0) S.trail = S.trail.slice(0, i);
      else if (!same(S.origin, o)) S.trail.push(S.origin);
    }
    S.origin = o;
    S.chosen = true;
    S.spawned = new Set();
    S.cores = new Set();
    S.pins = new Map();
    S.sel = o.kind === "component" ? { kind: "card", id: o.folder } : { kind: "token" };
    writeHash();
    draw(true);
  }

  /* ------------------------------------------------------------ layout */

  /** Rows outward from the origin, each column ordered by where its neighbours toward the origin sit; pins win. */
  function layout(v: ConnectionsView): Map<string, Point> {
    const column = new Map(v.cards.map((c) => [c.folder, c.column]));
    if (v.route !== undefined) column.set(TOKEN, 0);
    const cols = new Map<number, string[]>();
    for (const [f, c] of column) cols.set(c, [...(cols.get(c) ?? []), f]);
    const row = new Map<string, number>([[v.origin.kind === "component" ? v.origin.folder : TOKEN, 0]]);
    const keys = [...cols.keys()];
    const order = [...keys.filter((c) => c > 0).sort((a, b) => a - b), ...keys.filter((c) => c < 0).sort((a, b) => b - a)];
    const touches = (a: string, b: string): boolean => edgeOf.has(`${a}\u0000${b}`) || edgeOf.has(`${b}\u0000${a}`) || (a === TOKEN && v.entry?.to === b);
    for (const c of order) {
      const toward = c > 0 ? c - 1 : c + 1;
      const bary = (f: string): number => {
        const ys = (cols.get(toward) ?? []).filter((g) => touches(g, f) && row.has(g)).map((g) => row.get(g)!);
        return ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
      };
      const fs = cols.get(c)!.map((f) => [f, bary(f)] as const).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
      fs.forEach(([f], i) => row.set(f, i - (fs.length - 1) / 2));
    }
    const out = new Map<string, Point>();
    for (const [f, c] of column) out.set(f, S.pins.get(f) ?? { x: c * COLW, y: (row.get(f) ?? 0) * ROWH });
    return out;
  }

  /* ----------------------------------------------------------- drawing */

  function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number | undefined>, parent?: Element): SVGElementTagNameMap[K] {
    const x = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) x.setAttribute(k, String(v));
    parent?.appendChild(x);
    return x;
  }
  const onPress = (target: Element, run: (ev: PointerEvent) => void): void => {
    target.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      run(ev as PointerEvent);
    });
  };

  function selectedCard(): string | undefined {
    return S.sel?.kind === "card" && S.sel.core !== true ? S.sel.id : undefined;
  }

  function compute(): ConnectionsView | undefined {
    if (S.origin === undefined) return undefined;
    return connectionsOf(M, { origin: S.origin, spawned: [...S.spawned], cores: [...S.cores], selected: selectedCard() });
  }

  function draw(fit = false): void {
    if (disposed) return;
    V = compute();
    world.replaceChildren();
    if (V === undefined) {
      drawRail();
      drawTrail();
      $("inspector").innerHTML = `<p class="cx-muted">This reading has no component to start from.</p>`;
      return;
    }
    const v = V;
    pos = layout(v);
    const gLines = el("g", {}, world), gCards = el("g", {}, world);
    const sel = S.sel;
    const doorSel = sel?.kind === "door" ? sel.id : undefined;
    const focused = sel?.kind === "card" || sel?.kind === "door" ? sel.id : undefined;
    const focus = focused === undefined ? undefined : new Set([focused, ...v.lines.filter((l) => l.from === focused || l.to === focused).flatMap((l) => [l.from, l.to])]);

    if (v.route !== undefined && v.entry !== undefined) {
      const g = geom(pos.get(TOKEN)!, pos.get(v.entry.to)!);
      el("path", { class: "edge work", d: g.d, "stroke-width": 4 }, gLines);
      el("path", { class: "edge moving", d: g.d, "stroke-width": 2 }, gLines);
      if (v.entry.identifiers.length > 0) {
        const ids = v.entry.identifiers.map(identifier);
        const [x, y] = at(g.p, 0.5);
        mark(gLines, x, y, v.entry.identifiers, worst(ids.map((i) => i?.verdict.state ?? "requirement")), ids.some((i) => i?.crossing !== undefined), false, false, () => select({ kind: "token" }));
      }
    }

    for (const l of v.lines) {
      const g = geom(pos.get(l.from)!, pos.get(l.to)!);
      const edge = edgeOf.get(`${l.from}\u0000${l.to}`);
      const on = sel?.kind === "line" && sel.from === l.from && sel.to === l.to;
      const dim = doorSel !== undefined ? !(l.to === doorSel && (edge?.chokepoints.length ?? 0) > 0) : focused !== undefined && !(l.from === focused || l.to === focused);
      const cls = ["edge", l.work ? "work" : v.route !== undefined ? "other" : "", edge?.loadBearing ? "lb" : "", g.forward ? "" : "back", on ? "on" : "", dim ? "dim" : ""].filter(Boolean).join(" ");
      const sw = !g.forward ? 1.2 : v.route !== undefined ? (l.work ? width(l.workSites) + 0.6 : 1) : width(l.sites);
      el("path", { class: cls, d: g.d, "stroke-width": sw, "data-a": l.from, "data-b": l.to }, gLines);
      if (l.work && g.forward) el("path", { class: `edge moving${dim ? " dim" : ""}`, d: g.d, "stroke-width": Math.max(1.2, sw - 1.5), "data-a": l.from, "data-b": l.to }, gLines);
      onPress(el("path", { class: "hit", d: g.d }, gLines), () => select({ kind: "line", from: l.from, to: l.to }));
    }

    if (v.tokens.length > 0 && selectedCard() !== undefined) drawReaching(gLines, gCards, selectedCard()!, v);
    if (v.route !== undefined) drawToken(gCards, v.route, pos.get(TOKEN)!);
    for (const c of v.cards) drawCard(gCards, c, pos.get(c.folder)!, focus);
    // A chokepoint stands at its callee's door: drawn once where the work arrives, whichever callers come through it.
    for (const d of v.doors) {
      const p = pos.get(d.component)!;
      const ids = d.chokepoints.map((c) => c.identifier);
      mark(gCards, p.x - W / 2, p.y, ids, d.state, d.crossing, focus !== undefined && !focus.has(d.component), doorSel === d.component, () => select({ kind: "door", id: d.component }), d.component);
    }
    setTransform();
    applyHover();
    // The tokens of the routes reaching a selected card stand left of the drawing: refit when they would fall outside it.
    if (fit || S.fit || offscreen(world.querySelector(".reaching"))) fitView();
    drawTrail();
    drawRail();
    drawInspector();
    drawKey();
  }

  function offscreen(g: Element | null): boolean {
    if (g === null || !root.isConnected) return false;
    const b = g.getBoundingClientRect(), r = svg.getBoundingClientRect();
    return b.left < r.left || b.right > r.right || b.top < r.top || b.bottom > r.bottom;
  }

  function select(s: Selection | null): void {
    S.sel = s;
    draw();
  }

  /** An identifier mark: on a door, set off left of the card's edge, or centred on the entrance line. */
  function mark(parent: Element, x: number, y: number, ids: readonly string[], state: FlowState, crossing: boolean, dim: boolean, on: boolean, run: () => void, door?: string): void {
    const g = el("g", { class: `door ${state}${dim ? " dim" : ""}${on ? " sel" : ""}`, ...(door === undefined ? {} : { "data-f": door }) }, parent);
    const text = ids.length > 2 ? `${ids[0]} +${ids.length - 1}` : ids.join(" ");
    const w = 10 + text.length * 6.6;
    if (door !== undefined) x -= w / 2 + 3;
    if (crossing) el("line", { class: "trust", x1: x - w / 2 - 6, y1: y - 22, x2: x - w / 2 - 6, y2: y + 22 }, g);
    el("rect", { x: x - w / 2, y: y - 9, width: w, height: 18, rx: 4 }, g);
    el("text", { x: x - mono(text, 10.5) / 2, y }, g).textContent = text;
    onPress(g, run);
  }

  function drawToken(parent: Element, r: FlowRoute, p: Point): void {
    const on = S.sel?.kind === "token";
    const g = el("g", { class: `token${r.noTracedControl ? " gap" : ""}${on ? " sel" : ""}`, transform: `translate(${p.x},${p.y})` }, parent);
    const names = r.names.length > 3 ? [...r.names.slice(0, 3), `+${r.names.length - 3} more`] : r.names;
    const w = Math.max(120, ...names.map((n) => n.length * 7.4 + 30)), h = 16 + names.length * 16;
    // A card whose right edge points into the system.
    el("path", { d: `M${-w / 2},${-h / 2} H${w / 2 - 12} L${w / 2 + 4},0 L${w / 2 - 12},${h / 2} H${-w / 2} Z` }, g);
    names.forEach((n, i) => (el("text", { x: -w / 2 + 12, y: -h / 2 + 20 + i * 16 }, g).textContent = n));
    const tag = r.noTracedControl ? "no traced control" : r.noControl ? "no control needed" : (r.trust.join(", ") || "trust unknown") + (r.trustSource === "derived" ? " · derived" : "");
    el("text", { class: "t", x: w / 2 + 4 - mono(tag, 10.5), y: h / 2 + 16 }, g).textContent = tag;
    g.addEventListener("pointerdown", (ev) => startDrag(ev, TOKEN));
  }

  /** Every route whose reach gets to the selected card, as a token left of the drawing, with a line into the card. */
  function drawReaching(gLines: Element, gCards: Element, f: string, v: ConnectionsView): void {
    const target = pos.get(f)!;
    const minX = Math.min(...[...pos.values()].map((p) => p.x));
    const tx = minX - COLW * 0.85, gap = 52;
    const g = el("g", { class: "reaching" }, gCards);
    const line = (x1: number, y1: number, hops: number): void => {
      const x2 = target.x - W / 2, y2 = target.y, c = Math.max(60, (x2 - x1) / 2);
      el("path", { class: `edge reach${hops > 0 ? " far" : ""}`, d: `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`, "stroke-width": 1.6 }, gLines);
    };
    const own = v.tokens.find((t) => t.origin);
    if (own !== undefined && own.hops > 0) {
      const p = pos.get(TOKEN)!;
      line(p.x + 70, p.y, own.hops);
    }
    const others = v.tokens.filter((t) => !t.origin);
    others.forEach((t, i) => {
      const r = route.get(t.route);
      if (r === undefined) return;
      const y = target.y + (i - (others.length - 1) / 2) * gap;
      const names = routeName(r);
      const w = Math.max(96, names.length * 6.8 + 26), h = 22;
      const tok = el("g", { class: `token mini${t.noTracedControl ? " gap" : ""}`, transform: `translate(${tx - w / 2},${y})` }, g);
      el("path", { d: `M${-w / 2},${-h / 2} H${w / 2 - 9} L${w / 2 + 2},0 L${w / 2 - 9},${h / 2} H${-w / 2} Z` }, tok);
      el("text", { x: -w / 2 + 9, y: 4 }, tok).textContent = names;
      const where = t.hops === 0 ? "enters here" : `enters at ${label(t.enters)} · ${plural(t.hops, "hop")}`;
      const trust = `${where} · ${t.trust.join(", ") || "trust unknown"}`;
      el("text", { class: "t", x: w / 2 + 2 - mono(trust, 10), y: h / 2 + 12 }, tok).textContent = trust;
      onPress(tok, () => setOrigin({ kind: "route", id: t.route }));
      line(tx + 2, y, t.hops);
    });
  }

  function drawCard(parent: Element, c: ConnectionsView["cards"][number], p: Point, focus: Set<string> | undefined): void {
    const n = node.get(c.folder);
    if (n === undefined) return;
    const isOrigin = S.origin?.kind === "component" && S.origin.folder === c.folder;
    const isSel = S.sel?.kind === "card" && S.sel.id === c.folder;
    const g = el("g", { class: `node${isOrigin ? " origin" : ""}${isSel ? " sel" : ""}${focus !== undefined && !focus.has(c.folder) ? " dim" : ""}`, transform: `translate(${p.x - W / 2},${p.y - H / 2})`, "data-f": c.folder }, parent);
    el("rect", { class: "card", width: W, height: H, rx: 8 }, g);
    el("rect", { class: `bar ${n.state ?? "none"}`, x: 0, y: 8, width: 3, height: H - 16, rx: 1.5 }, g);
    el("text", { x: 14, y: 22 }, g).textContent = n.name.length > 24 ? `${n.name.slice(0, 23)}…` : n.name;
    el("text", { class: "f", x: 14, y: 38 }, g).textContent = c.folder;
    const bits: string[] = [];
    if (n.invariants.length > 0) bits.push(plural(n.invariants.length, "invariant"));
    if (n.entrances.length > 0 && S.origin?.kind === "component") bits.push(plural(n.entrances.length, "entrance"));
    const inside = passedInside(c.folder);
    if (inside.length > 0) bits.push(`${plural(inside.length, "chokepoint")} inside`);
    el("text", { class: "b", x: 14, y: 55 }, g).textContent = bits.join(" · ");
    if (S.pins.has(c.folder)) el("circle", { class: "pin", cx: W - 9, cy: 9, r: 3 }, g);
    // The core dependencies it uses, as chips under the card.
    let cx = 8;
    for (const chipOf of c.chips) {
      const t = `⌁ ${short(chipOf)}`, w = t.length * 6.2 + 12;
      const chip = el("g", { class: "chip", transform: `translate(${cx},${H + 4})` }, g);
      el("rect", { width: w, height: 16, rx: 8 }, chip);
      el("text", { x: 6, y: 8 }, chip).textContent = t;
      onPress(chip, () => {
        S.sel = { kind: "card", id: chipOf, core: true };
        drawInspector();
      });
      cx += w + 4;
    }
    if (c.more > 0) {
      const m = el("g", { class: "more", transform: `translate(${c.column < 0 ? -14 : W + 14},${H / 2})` }, g);
      el("circle", { r: 12 }, m);
      el("text", { x: -mono(`+${c.more}`, 10.5) / 2 }, m).textContent = `+${c.more}`;
      onPress(m, () => {
        S.spawned.add(c.folder);
        draw(true);
      });
    }
    g.addEventListener("pointerdown", (ev) => startDrag(ev, c.folder));
  }

  /** The chokepoints the origin route's work passes inside a component: traced by the reading, on no line. */
  function passedInside(f: string): [string, string][] {
    const r = S.origin?.kind === "route" ? route.get(S.origin.id) : undefined;
    if (r === undefined) return [];
    const out = new Map<string, string>();
    const inFolder = (component: string): boolean => component === f || (f !== "." && component.startsWith(`${f}/`));
    for (const id of r.entrances) for (const g of M.entrances.find((e) => e.id === id)?.guards ?? []) if (inFolder(g.component)) out.set(g.name, g.how);
    for (const t of r.traced) if (inFolder(t.component) && !out.has(t.name)) out.set(t.name, t.kind);
    return [...out];
  }

  /** Hovering a card lights it and its neighbours by class alone, so the cards under the pointer are never rebuilt. */
  function applyHover(): void {
    const f = S.hover !== null && pos.has(S.hover) ? S.hover : null;
    world.classList.toggle("hovering", f !== null);
    const near = new Set([f]);
    if (f !== null) for (const l of V?.lines ?? []) if (l.from === f || l.to === f) (near.add(l.from), near.add(l.to));
    world.querySelectorAll<SVGElement>("[data-a]").forEach((x) => x.classList.toggle("hdim", f !== null && x.dataset["a"] !== f && x.dataset["b"] !== f));
    world.querySelectorAll<SVGElement>(".node, .door[data-f]").forEach((x) => x.classList.toggle("hdim", f !== null && !near.has(x.dataset["f"] ?? null)));
  }

  /* --------------------------------------------- pan, zoom, drag to pin */

  let drag: { f?: string; pan?: boolean; dx: number; dy: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null = null;
  let lastClick = { id: null as string | null, t: 0 };
  const toWorld = (ev: PointerEvent): Point => {
    const b = svg.getBoundingClientRect();
    return { x: (ev.clientX - b.left - S.view.x) / S.view.k, y: (ev.clientY - b.top - S.view.y) / S.view.k };
  };
  function startDrag(ev: PointerEvent, f: string): void {
    ev.stopPropagation();
    const w = toWorld(ev), p = pos.get(f)!;
    drag = { f, dx: w.x - p.x, dy: w.y - p.y, sx: ev.clientX, sy: ev.clientY, vx: 0, vy: 0, moved: false };
    svg.setPointerCapture(ev.pointerId);
  }
  svg.addEventListener("pointerdown", (ev) => {
    drag = { pan: true, dx: 0, dy: 0, sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y, moved: false };
    svg.classList.add("panning");
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener("pointermove", (ev) => {
    if (drag === null) {
      if (ev.buttons !== 0) return;
      const f = (ev.target as Element).closest?.<SVGElement>(".node")?.dataset["f"] ?? null;
      if (f !== S.hover) {
        S.hover = f;
        applyHover();
      }
      return;
    }
    if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.pan === true) {
      S.view.x = drag.vx + ev.clientX - drag.sx;
      S.view.y = drag.vy + ev.clientY - drag.sy;
      setTransform();
      return;
    }
    const w = toWorld(ev);
    S.pins.set(drag.f!, { x: w.x - drag.dx, y: w.y - drag.dy });
    draw();
  });
  svg.addEventListener("pointerup", () => {
    const d = drag;
    drag = null;
    svg.classList.remove("panning");
    if (d === null || d.moved) return;
    if (d.pan === true) return select(null);
    const now = performance.now();
    if (lastClick.id === d.f && now - lastClick.t < 380 && d.f !== TOKEN) {
      lastClick = { id: null, t: 0 };
      return setOrigin({ kind: "component", folder: d.f! });
    }
    lastClick = { id: d.f!, t: now };
    select(d.f === TOKEN ? { kind: "token" } : { kind: "card", id: d.f! });
  });
  svg.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const b = svg.getBoundingClientRect(), mx = ev.clientX - b.left, my = ev.clientY - b.top;
      const k = Math.min(2.5, Math.max(0.25, S.view.k * Math.exp(-ev.deltaY * 0.0015)));
      S.view.x = mx - ((mx - S.view.x) * k) / S.view.k;
      S.view.y = my - ((my - S.view.y) * k) / S.view.k;
      S.view.k = k;
      setTransform();
    },
    { passive: false },
  );
  function setTransform(): void {
    world.setAttribute("transform", `translate(${S.view.x},${S.view.y}) scale(${S.view.k})`);
  }
  /** Fit the drawing to the stage; put off until the view is on the page and laid out. */
  function fitView(): void {
    const r = svg.getBoundingClientRect();
    if (!root.isConnected || r.width === 0) {
      S.fit = true;
      return;
    }
    const b = world.getBBox();
    if (b.width === 0) return;
    S.fit = false;
    const k = Math.min(1.3, (r.width - 80) / b.width, (r.height - 60) / b.height);
    S.view = { k, x: (r.width - b.width * k) / 2 - b.x * k, y: (r.height - b.height * k) / 2 - b.y * k };
    setTransform();
  }
  $("fit").addEventListener("click", () => fitView());
  $("unpin").addEventListener("click", () => {
    S.pins.clear();
    draw();
  });
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && root.isConnected && S.sel !== null) select(null);
  };
  document.addEventListener("keydown", onKey);
  const resizing = new ResizeObserver(() => {
    if (root.isConnected) fitView();
  });
  resizing.observe(svg);

  /* ------------------------------------------- the rail, trail, inspector */

  function originName(o: ConnectionsOrigin): string {
    if (o.kind === "component") return label(o.folder);
    const r = route.get(o.id);
    return r === undefined ? o.id : routeName(r);
  }

  function drawTrail(): void {
    const t = $("trail");
    t.replaceChildren();
    const all = S.origin === undefined ? S.trail : [...S.trail, S.origin];
    all.forEach((o, i) => {
      if (i > 0) {
        const s = document.createElement("span");
        s.className = "sep";
        s.textContent = "›";
        t.append(s);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = (o.kind === "route" ? "→ " : "") + originName(o);
      if (i === all.length - 1) b.className = "now";
      else
        b.onclick = () => {
          S.trail = S.trail.slice(0, i);
          setOrigin(o, false);
        };
      t.append(b);
    });
  }

  function drawRail(): void {
    const p = $("rail");
    const h = (text: string): void => {
      const x = document.createElement("h3");
      x.textContent = text;
      p.append(x);
    };
    const scroll = p.scrollTop;
    p.replaceChildren();
    if (M.routes.length > 0) h("Start from where work enters");
    for (const r of M.routes) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `pick${S.origin?.kind === "route" && S.origin.id === r.id ? " now" : ""}`;
      const gap = r.noTracedControl ? '<span class="tag gap">no traced control</span>' : "";
      b.innerHTML = `${esc(r.names.length > 3 ? `${r.names.slice(0, 2).join(", ")} +${r.names.length - 2}` : r.names.join(", "))}${gap}<span class="sub">${esc(r.trust.join(", ") || "trust unknown")} · ${plural(r.stops.length, "stop")}</span>`;
      b.onclick = () => setOrigin({ kind: "route", id: r.id });
      p.append(b);
    }
    h("Start from a component");
    for (const n of M.nodes) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `pick${S.origin?.kind === "component" && S.origin.folder === n.folder ? " now" : ""}`;
      b.innerHTML = `${esc(n.name)}${core.has(n.folder) ? '<span class="tag core">core</span>' : ""}<span class="sub">${esc(n.folder)}</span>`;
      b.onclick = () => setOrigin({ kind: "component", folder: n.folder });
      p.append(b);
    }
    p.scrollTop = scroll;
  }

  const pill = (state: string, text: string): string => `<span class="pill ${esc(state)}">${esc(text)}</span>`;

  function drawInspector(): void {
    const I = $("inspector"), s = S.sel;
    let h = "";
    if (s === null || V === undefined) h = originSummary();
    else if (s.kind === "token") h = S.origin?.kind === "route" ? tokenReading(route.get(S.origin.id)) : originSummary();
    else if (s.kind === "card") h = cardReading(s.id);
    else if (s.kind === "line") h = lineReading(s.from, s.to);
    else h = doorReading(s.id);
    I.innerHTML = h;
    I.querySelectorAll<HTMLElement>("[data-c]").forEach((b) => (b.onclick = () => setOrigin({ kind: "component", folder: b.dataset["c"]! })));
    I.querySelectorAll<HTMLElement>("[data-r]").forEach((b) => (b.onclick = () => setOrigin({ kind: "route", id: b.dataset["r"]! })));
    I.querySelectorAll<HTMLElement>("[data-spawn]").forEach(
      (b) =>
        (b.onclick = () => {
          S.spawned.add(b.dataset["spawn"]!);
          draw(true);
        }),
    );
    I.querySelectorAll<HTMLElement>("[data-core]").forEach(
      (b) =>
        (b.onclick = () => {
          S.cores.add(b.dataset["core"]!);
          S.sel = { kind: "card", id: b.dataset["core"]! };
          draw(true);
        }),
    );
    I.querySelectorAll<HTMLElement>("[data-e]").forEach(
      (b) =>
        (b.onclick = () => {
          const [from, to] = b.dataset["e"]!.split("|") as [string, string];
          select({ kind: "line", from, to });
        }),
    );
  }

  function originSummary(): string {
    if (V === undefined || S.origin === undefined) return `<p class="cx-muted">Pick where to start from on the left.</p>`;
    return `<h3>Showing</h3><p>${plural(V.cards.length, "component")} of ${M.nodes.length} and ${plural(V.lines.length, "component interface")} of ${M.edges.length}, from <b>${esc(originName(S.origin))}</b>.</p><p class="cx-muted">Select a card, a line or a door to read it.</p>`;
  }

  function cardReading(f: string): string {
    const n = node.get(f);
    if (n === undefined) return originSummary();
    const card = V?.cards.find((c) => c.folder === f);
    const counts = new Map<string, number>();
    for (const i of n.invariants) counts.set(i.verdict.state, (counts.get(i.verdict.state) ?? 0) + 1);
    let h = `<h2>${esc(n.name)}</h2><div class="folder">${esc(f)}${core.has(f) ? " · core dependency" : ""}</div><p>${esc(n.intent)}</p>`;
    h += `<p>${[...counts].map(([k, v]) => pill(k, `${v} ${k}`)).join(" ") || '<span class="cx-muted">no invariants</span>'}</p>`;
    if (card === undefined && core.has(f)) h += `<button type="button" class="act" data-core="${esc(f)}">Draw it as a card</button>`;
    if (!(S.origin?.kind === "component" && S.origin.folder === f)) h += `<button type="button" class="act" data-c="${esc(f)}">Start from here</button>`;
    if ((card?.more ?? 0) > 0) h += `<button type="button" class="act" data-spawn="${esc(f)}">Spawn ${card!.more} further out</button>`;
    const inside = passedInside(f);
    if (inside.length > 0) h += `<h3>Chokepoints this work passes inside it</h3><ul>${inside.map(([name, how]) => `<li>${esc(name)}<span class="n">${esc(how)}</span></li>`).join("")}</ul>`;
    const reach = connectionsReaching(M, f, S.origin);
    if (reach.length > 0) {
      h += `<h3>Entrances that reach it (${reach.length} of ${M.routes.length})</h3><ul>`;
      for (const t of reach) {
        const r = route.get(t.route);
        if (r === undefined) continue;
        h += `<li><button type="button" class="link" data-r="${esc(r.id)}">${esc(routeName(r))}</button><span class="n">${t.hops === 0 ? "enters here" : `${plural(t.hops, "hop")} via ${esc(label(t.enters))}`} · ${esc(r.trust.join(", ") || "trust unknown")}</span></li>`;
      }
      h += "</ul>";
    }
    const list = (title: string, edges: typeof M.edges, other: (e: (typeof M.edges)[number]) => string): string => {
      if (edges.length === 0) return "";
      const rows = [...edges]
        .sort((a, b) => b.sites - a.sites)
        .map((e) => {
          const o = other(e);
          const ids = e.chokepoints.map((c) => pill(c.verdict.state, M.identifiers.find((i) => i.chokepoint === c.id)?.text ?? "C")).join(" ");
          return `<li><button type="button" class="link" data-e="${esc(e.from)}|${esc(e.to)}">${esc(label(o))}</button> ${ids}<span class="n">${e.sites} sites${pos.has(o) ? "" : " · not drawn"}</span></li>`;
        })
        .join("");
      return `<h3>${title} (${edges.length})</h3><ul>${rows}</ul>`;
    };
    h += list("Calls", M.edges.filter((e) => e.from === f), (e) => e.to) + list("Called by", M.edges.filter((e) => e.to === f), (e) => e.from);
    if (n.boundary.length > 0) h += `<h3>Crossings inside it</h3><ul>${n.boundary.map((x) => `<li>${esc(x.name)}<span class="n">${esc(x.from)} → ${esc(x.to)}</span></li>`).join("")}</ul>`;
    return h;
  }

  function doorReading(f: string): string {
    const door = V?.doors.find((d) => d.component === f);
    let h = `<h3>Chokepoints at the door of</h3><h2><button type="button" class="link" data-c="${esc(f)}">${esc(label(f))}</button></h2><div class="folder">${esc(f)}</div>`;
    for (const c of door?.chokepoints ?? []) {
      h += `<h3>${pill(c.bypassed ? "broken" : c.state, c.identifier)} ${esc(c.name)}</h3><p class="cx-muted">${esc(c.state)} · protects <code>${esc(c.protects)}</code></p>`;
      if (c.crossing !== undefined) h += `<p>Trust changes here: <b>${esc(c.crossing.from)}</b> → <b>${esc(c.crossing.to)}</b></p>`;
      h += `<p>${c.callers.length === 1 ? "1 caller reaches" : `${c.callers.length} callers reach`} what it protects, each through it: ${c.callers.map((x) => `<button type="button" class="link" data-e="${esc(x)}|${esc(f)}">${esc(label(x))}</button>${pos.has(x) ? "" : ' <span class="cx-muted">(not drawn)</span>'}`).join(", ")}.</p>`;
    }
    return h;
  }

  function lineReading(from: string, to: string): string {
    const e = edgeOf.get(`${from}\u0000${to}`);
    if (e === undefined) return originSummary();
    const l = V?.lines.find((x) => x.from === from && x.to === to);
    let h = `<h3>Component interface</h3><h2>${esc(label(from))} → ${esc(label(to))}</h2><div class="folder">${esc(from)} → ${esc(to)}</div>`;
    h += `<p>${plural(e.sites, "reference site")} through ${plural(e.symbols.length, "symbol")}${e.loadBearing ? " · <b>load-bearing</b>" : ""}.</p>`;
    if (l?.work === true) h += `<p>This entrance's work uses it through <code>${l.workSymbols.map(esc).join("</code>, <code>")}</code>.</p>`;
    else if (S.origin?.kind === "route") h += `<p class="cx-muted">The interface exists, but this entrance's work does not use it.</p>`;
    if (e.chokepoints.length > 0) h += `<h3>Chokepoints standing on it</h3><ul>${e.chokepoints.map((c) => `<li>${pill(c.verdict.state, M.identifiers.find((i) => i.chokepoint === c.id)?.text ?? "C")} ${esc(c.name)}<span class="n">${esc(c.verdict.label)}</span></li>`).join("")}</ul><p class="cx-muted">protects ${e.chokepoints.map((c) => `<code>${esc(c.protects)}</code>`).join(", ")}</p>`;
    if (e.crossings.length > 0) h += `<h3>Trust changes here</h3><ul>${e.crossings.map((c) => `<li>${esc(c.name)}<span class="n">${esc(c.from)} → ${esc(c.to)}</span></li>`).join("")}</ul>`;
    if (e.bypasses.length > 0) h += `<h3>Bypass sites</h3><ul>${e.bypasses.map((x) => `<li><code>${esc(x.file)}:${x.line}</code><span class="n">${esc(x.symbol)}</span></li>`).join("")}</ul>`;
    const shown = e.symbols.slice(0, 12);
    h += `<h3>Symbols, most used first</h3><ul>${shown.map((s) => `<li><code>${esc(s.symbol)}</code><span class="n">${s.sites} · ${esc(s.file.split("/").pop())}</span></li>`).join("")}${e.symbols.length > shown.length ? `<li class="cx-muted">+${e.symbols.length - shown.length} more</li>` : ""}</ul>`;
    if (e.routes.length > 0) h += `<h3>Structural routes along it</h3><ul>${e.routes.map((id) => route.get(id)).filter((r) => r !== undefined).map((r) => `<li><button type="button" class="link" data-r="${esc(r.id)}">${esc(r.names.join(", "))}</button></li>`).join("")}</ul>`;
    return h;
  }

  function tokenReading(r: FlowRoute | undefined): string {
    if (r === undefined) return originSummary();
    const es = r.entrances.map((id) => M.entrances.find((e) => e.id === id)).filter((e) => e !== undefined);
    let h = `<h3>Where work enters</h3><h2>${esc(r.names.join(", "))}</h2>`;
    h += `<p>${esc(es[0]?.meaning ?? "")}</p><p class="cx-muted">handled by <code>${esc(es[0]?.handler ?? "—")}</code></p>`;
    h += `<p>Trust in: <b>${esc(r.trust.join(", ") || "unknown")}</b> <span class="cx-muted">(${esc(r.trustSource)})</span>${r.noTracedControl ? ` · ${pill("requirement", "no traced control")}` : ""}${r.noControl ? " · no control needed" : ""}</p>`;
    h += `<h3>Route</h3><p>${r.stops.map((s) => `<button type="button" class="link" data-c="${esc(s)}">${esc(label(s))}</button>`).join(" → ")}${r.rail !== undefined ? ` → <span class="cx-muted">${esc(label(r.rail))} (core)</span>` : ""}</p>`;
    if (r.traced.length > 0) h += `<h3>Controls traced on it</h3><ul>${r.traced.map((t) => `<li>${t.identifier !== undefined ? pill(t.verdict.state, t.identifier) : ""} ${esc(t.name)}<span class="n">${esc(t.kind)} · ${esc(short(t.component))}</span></li>`).join("")}</ul>`;
    if (r.partial.length > 0) h += `<h3>Passed by only some of its entrances</h3><ul>${r.partial.map((t) => `<li>${esc(t.name)}<span class="n">${t.entrances} of ${r.entrances.length}</span></li>`).join("")}</ul>`;
    const off = es.flatMap((e) => e.switchedOff ?? []);
    if (off.length > 0) h += `<h3>Switched off</h3><ul>${off.map((o) => `<li>${esc(o.name)}<span class="n">${esc(o.unless)}</span></li>`).join("")}</ul>`;
    const passes = new Set(es.flatMap((e) => e.passes));
    h += `<p class="cx-muted">Its handler's reach passes ${plural(passes.size, "component")}; ${V?.cards.length ?? 0} are drawn. Use <b>+N</b> on a card to follow the rest.</p>`;
    return h;
  }

  function drawKey(): void {
    const line = (cls: string, sw: number): string => `<svg viewBox="0 0 34 12"><path class="edge ${cls}" d="M2,6 H32" stroke-width="${sw}"/></svg>`;
    const work = S.origin?.kind === "route";
    $("key").innerHTML = [
      work ? `<div>${line("work", 3)}this entrance's work, caller → callee</div><div>${line("other", 1)}an interface the work doesn't use</div>` : `<div>${line("lb", 3)}component interface, caller → callee; thicker = more reference sites</div>`,
      `<div>${line("back", 1.5)}within a column, or against the flow</div>`,
      `<div>${line("reach", 1.6)}selected: an entrance that reaches it (dashed: hops away)</div>`,
      `<div><span class="pill verified">X14</span>&nbsp;chokepoint at a component's door: what it protects is reached only through it</div>`,
      `<div><span class="pill requirement">req</span>&nbsp;not yet enforced · <span class="pill broken">C3</span>&nbsp;broken: a caller goes around it</div>`,
      `<div><svg viewBox="0 0 34 12"><line class="trust" x1="17" y1="0" x2="17" y2="12"/></svg>trust changes on this interface</div>`,
      `<div><svg viewBox="0 0 34 12"><rect x="2" y="1" width="30" height="10" rx="5" fill="none" stroke="currentColor" stroke-dasharray="3 2"/></svg>core dependency used, kept off the canvas</div>`,
    ].join("");
  }

  draw(true);

  return {
    root,
    update(model) {
      M = model;
      index();
      if (S.origin === undefined || connectionsOf(M, { origin: S.origin }) === undefined) {
        S.origin = connectionsDefaultOrigin(M);
        S.trail = [];
        S.sel = null;
      }
      S.trail = S.trail.filter((o) => connectionsOf(M, { origin: o }) !== undefined);
      draw();
    },
    land(id) {
      const o = connectionsOriginOf(M, id);
      if (o === undefined) return false;
      if (S.origin === undefined || !same(S.origin, o)) setOrigin(o);
      return true;
    },
    resume() {
      if (disposed || !root.isConnected) return;
      writeHash();
      if (S.fit) requestAnimationFrame(() => fitView());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("keydown", onKey);
      resizing.disconnect();
      root.remove();
    },
  };
}
