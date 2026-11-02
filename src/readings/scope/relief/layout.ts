/**
 * Where the relief places what it draws, as one module the page and the warm
 * server both run: components by co-change on their parents' platforms, and
 * each component's files in an order that keeps files that land together
 * side by side. The warm server lays it out seeded from the layout it kept
 * last (`.coherence/relief-layout.json`, layout-store.ts) and keeps the
 * result, so a reload, a restart or one more landing leaves what a reader
 * learned where it was; the page settles its components from that seed and
 * draws the files in the order the server sends them.
 *
 * Nothing here touches the DOM or node: the page's bundle carries it.
 */

/** Each folder's place as the last layout left it: a component's own block and its subtree's centre, and its files in order, by path. */
export type ReliefLayout = Record<string, { own?: number[]; sub?: number[]; files?: string[] }>;

/** The footprint measures: a block is spaced for the largest it can take, so no measure makes blocks overlap. */
export const FOOT_KEYS = ["lines", "unreached", "invariants", "refutations", "crossings", "leaned", "defects"] as const;
/** The total footprint area every measure shares, so shares compare. */
export const AREA = 5200;
/** The margin a platform keeps round what stands on it. */
export const MARGIN = 5;
/** Landings touching more files than this are a bulk move and say nothing about what lands together. */
export const CO_CHANGE_MAX = 40;
const GAP = 3;

interface Placed {
  folder: string;
  virtual?: true;
  v: Partial<Record<(typeof FOOT_KEYS)[number], number>>;
}
interface Landed {
  n: number;
  /** [component index, lines changed] for each component the landing touched. */
  c: readonly (readonly [number, number])[];
}

/** The share of landings two sets have in common: both over either. */
export function jac(a: ReadonlySet<number>, b: ReadonlySet<number>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

/** A component stands on the platform of the nearest component whose folder holds it; a folder with no spec holds nothing. */
export function nesting(C: readonly Placed[]): { parent: number[]; kids: number[][]; level: number[]; under: (ci: number) => number[] } {
  const holds = (outer: string, inner: string) => inner !== outer && (outer === "." || inner.startsWith(outer + "/"));
  const parent = C.map((c) => {
    let best = -1, len = -1;
    C.forEach((o, oi) => {
      const l = o.folder === "." ? 0 : o.folder.length;
      if (!o.virtual && holds(o.folder, c.folder) && l > len) { best = oi; len = l; }
    });
    return best;
  });
  const kids = C.map((_, ci) => C.map((_, k) => k).filter((k) => parent[k] === ci));
  const level = C.map((_, ci) => { let n = 0; for (let p = parent[ci]!; p >= 0; p = parent[p]!) n++; return n; });
  const under = (ci: number): number[] => [ci, ...kids[ci]!.flatMap(under)];
  return { parent, kids, level, under };
}

interface Item {
  hx: number;
  hz: number;
  set: ReadonlySet<number>;
  seed?: number[] | undefined;
}

/**
 * Lay out items by co-change, then push apart so no rectangle overlaps at its
 * largest. A seeded item starts where the last layout left it and is held
 * there, so it drifts only as far as its co-change has really changed; a
 * newcomer starts beside its strongest co-change neighbour.
 */
function settle(items: readonly Item[]): [number, number][] {
  const n = items.length, J = items.map((a) => items.map((b) => (a === b ? 1 : jac(a.set, b.set))));
  const rad = items.map((it) => Math.max(it.hx, it.hz));
  const warm = items.some((it) => it.seed);
  const P: [number, number][] = items.map((it, i) => { if (it.seed) return [it.seed[0]!, it.seed[1]!]; const a = (i / n) * Math.PI * 2; return [Math.cos(a) * 40, Math.sin(a) * 40]; });
  if (warm) items.forEach((it, i) => {
    if (it.seed) return;
    let best = -1;
    items.forEach((o, j) => { if (o.seed && (best < 0 || J[i]![j]! > J[i]![best]!)) best = j; });
    if (best >= 0) P[i] = [P[best]![0] + rad[i]! + rad[best]! + GAP, P[best]![1]];
  });
  const N = warm ? 300 : 900, heat = warm ? 0.2 : 1;
  for (let it = 0; it < N; it++) {
    const t = (1 - it / N) * heat;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = P[j]![0] - P[i]![0], dz = P[j]![1] - P[i]![1], d = Math.hypot(dx, dz) || 0.01;
      // Strangers sit apart by up to 26, never more than half their own size, so small neighbourhoods stay tight at every depth.
      const want = (rad[i]! + rad[j]!) * 1.08 + GAP + (1 - J[i]![j]!) * Math.min(26, (rad[i]! + rad[j]!) * 0.5);
      const f = (d - want) * 0.02 * t, ux = dx / d, uz = dz / d;
      P[i]![0] += ux * f; P[i]![1] += uz * f; P[j]![0] -= ux * f; P[j]![1] -= uz * f;
    }
    // A seeded item is held to where the last build left it; only a lasting pull moves it far.
    if (warm) items.forEach((o, i) => { if (o.seed) { P[i]![0] += (o.seed[0]! - P[i]![0]) * 0.1; P[i]![1] += (o.seed[1]! - P[i]![1]) * 0.1; } });
  }
  for (let it = 0; it < 400; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = P[j]![0] - P[i]![0], dz = P[j]![1] - P[i]![1];
      const ox = items[i]!.hx + items[j]!.hx + GAP - Math.abs(dx), oz = items[i]!.hz + items[j]!.hz + GAP - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        moved = true;
        if (ox < oz) { const s = Math.sign(dx) || 1; P[i]![0] -= (s * ox) / 2; P[j]![0] += (s * ox) / 2; }
        else { const s = Math.sign(dz) || 1; P[i]![1] -= (s * oz) / 2; P[j]![1] += (s * oz) / 2; }
      }
    }
    if (!moved) break;
  }
  return P;
}

/** Where every component stands, and what the page needs to draw it there. */
export interface ComponentPlaces {
  parent: number[];
  kids: number[][];
  level: number[];
  under: (ci: number) => number[];
  totals: Record<(typeof FOOT_KEYS)[number], number>;
  /** A component's footprint side on one measure: its share of AREA, as a square. */
  side: (c: Placed, key: (typeof FOOT_KEYS)[number]) => number;
  /** Each subtree's half-extent, its platform's margin included. */
  ext: [number, number][];
  /** The components no other holds. */
  tops: number[];
  /** Each component's own block's centre. */
  P: [number, number][];
  /** The places, by folder, to keep and to seed the next layout from. */
  layout: ReliefLayout;
}

/**
 * Place every component: deepest first, each platform settles its own block
 * beside its children's subtrees by co-change over landings of CO_CHANGE_MAX
 * files or fewer, and each subtree then moves as one piece; the top-level
 * subtrees settle against each other the same way.
 */
export function placeComponents(C: readonly Placed[], landings: readonly Landed[], seed: ReliefLayout = {}): ComponentPlaces {
  const { parent, kids, level, under } = nesting(C);
  const value = (c: Placed, key: (typeof FOOT_KEYS)[number]) => c.v[key] ?? 0;
  const totals = Object.fromEntries(FOOT_KEYS.map((k) => [k, C.reduce((a, c) => a + value(c, k), 0)])) as Record<(typeof FOOT_KEYS)[number], number>;
  // A measure nothing has recorded draws nothing.
  const side = (c: Placed, key: (typeof FOOT_KEYS)[number]) => (totals[key] ? Math.sqrt((value(c, key) / totals[key]) * AREA) : 0);
  const maxSide = C.map((c) => Math.max(...FOOT_KEYS.map((k) => side(c, k))));
  const sets = C.map(() => new Set<number>());
  landings.forEach((l, i) => { if (l.n <= CO_CHANGE_MAX) for (const [ci] of l.c) sets[ci]!.add(i); });
  const subSet = C.map((_, ci) => new Set(under(ci).flatMap((k) => [...sets[k]!])));
  const own = C.map((): [number, number] => [0, 0]), sub = C.map((): [number, number] => [0, 0]);
  const ext = C.map((_, ci): [number, number] => [maxSide[ci]! / 2, maxSide[ci]! / 2]);
  for (const ci of C.map((_, i) => i).sort((a, b) => level[b]! - level[a]!)) {
    if (!kids[ci]!.length) continue;
    const items: Item[] = [{ hx: maxSide[ci]! / 2, hz: maxSide[ci]! / 2, set: sets[ci]!, seed: seed[C[ci]!.folder]?.own }, ...kids[ci]!.map((k) => ({ hx: ext[k]![0], hz: ext[k]![1], set: subSet[k]!, seed: seed[C[k]!.folder]?.sub }))];
    const Q = settle(items);
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    items.forEach((it, i) => { box[0] = Math.min(box[0]!, Q[i]![0] - it.hx); box[1] = Math.min(box[1]!, Q[i]![1] - it.hz); box[2] = Math.max(box[2]!, Q[i]![0] + it.hx); box[3] = Math.max(box[3]!, Q[i]![1] + it.hz); });
    const mx = (box[0]! + box[2]!) / 2, mz = (box[1]! + box[3]!) / 2;
    own[ci] = [Q[0]![0] - mx, Q[0]![1] - mz];
    kids[ci]!.forEach((k, i) => { sub[k] = [Q[i + 1]![0] - mx, Q[i + 1]![1] - mz]; });
    ext[ci] = [(box[2]! - box[0]!) / 2 + MARGIN, (box[3]! - box[1]!) / 2 + MARGIN];
  }
  const tops = C.map((_, i) => i).filter((i) => parent[i]! < 0);
  const at = C.map((): [number, number] => [0, 0]); // centre of each subtree
  if (tops.length > 1) {
    const Q = settle(tops.map((t) => ({ hx: ext[t]![0], hz: ext[t]![1], set: subSet[t]!, seed: seed[C[t]!.folder]?.sub })));
    tops.forEach((t, i) => { at[t] = Q[i]!; });
  }
  for (const ci of C.map((_, i) => i).sort((a, b) => level[a]! - level[b]!)) if (parent[ci]! >= 0) at[ci] = [at[parent[ci]!]![0] + sub[ci]![0], at[parent[ci]!]![1] + sub[ci]![1]];
  const P = C.map((_, ci): [number, number] => [at[ci]![0] + own[ci]![0], at[ci]![1] + own[ci]![1]]);
  // A top-level subtree keeps its centre as its sub, so a layout of several roots seeds its own next layout.
  const layout: ReliefLayout = Object.fromEntries(C.map((c, ci) => [c.folder, { own: own[ci]!.map(round), sub: (parent[ci]! < 0 ? at[ci]! : sub[ci]!).map(round) }]));
  return { parent, kids, level, under, totals, side, ext, tops, P, layout };
}

const round = (v: number) => +v.toFixed(3);

interface FileLanded {
  file: string;
  lines: number;
  /** [landing index, lines changed] for each landing that changed it. */
  l?: readonly (readonly [number, number])[];
}

/**
 * The order a component's files are laid out in, by path. Unseeded, files are
 * clustered by co-change share over landings of CO_CHANGE_MAX files or fewer
 * (average linkage, merged mutual nearest pair first by a nearest-neighbour
 * chain, over only the pairs that share a landing, so a folder of thousands of
 * files holds no square table), and the clusters are
 * read leaf by leaf; files that share no landing with any other are paired
 * smallest first, so the tree stays balanced. Seeded with the last order, the
 * order is kept: a file new to it goes in just after the file it lands with
 * most, or at the end when it lands with none, and a file gone from it drops
 * out, so one landing never reshuffles a block.
 */
export function fileOrder(files: readonly FileLanded[], landings: readonly { n: number }[], seed?: readonly string[]): string[] {
  const n = files.length;
  if (n === 0) return [];
  const landed = files.map((f) => new Set((f.l ?? []).filter(([li]) => (landings[li]?.n ?? Infinity) <= CO_CHANGE_MAX).map(([li]) => li)));
  if (seed !== undefined) {
    const at = new Map(files.map((f, i) => [f.file, i]));
    const order = seed.filter((p) => at.has(p)).map((p) => at.get(p)!), kept = new Set(order);
    for (const i of files.map((_, i) => i).filter((i) => !kept.has(i)).sort((a, b) => files[b]!.lines - files[a]!.lines || (files[a]!.file < files[b]!.file ? -1 : 1))) {
      let best = -1, share = 0;
      order.forEach((j, k) => { const s = jac(landed[i]!, landed[j]!); if (s > share) { share = s; best = k; } });
      order.splice(best < 0 ? order.length : best + 1, 0, i);
    }
    return order.map((i) => files[i]!.file);
  }
  // Similarities, sparse: only pairs that share a landing hold one, so a pair that shares none is never visited or kept.
  const S = files.map(() => new Map<number, number>());
  const byLanding = new Map<number, number[]>();
  landed.forEach((set, i) => { for (const li of set) (byLanding.get(li) ?? byLanding.set(li, []).get(li)!).push(i); });
  for (const group of byLanding.values()) for (let p = 0; p < group.length; p++) for (let q = p + 1; q < group.length; q++) {
    const a = group[p]!, b = group[q]!;
    S[a]!.set(b, (S[a]!.get(b) ?? 0) + 1);
  }
  S.forEach((m, a) => m.forEach((k, b) => { const s = k / (landed[a]!.size + landed[b]!.size - k); m.set(b, s); S[b]!.set(a, s); }));
  type Node = { v: number; leaf?: number; kids?: [Node, Node] };
  const node: Node[] = files.map((f, i) => ({ v: Math.max(1, f.lines), leaf: i }));
  const size = files.map(() => 1);
  const active = new Set(files.map((_, i) => i));
  const alone: number[] = [];
  // The most similar cluster to x, the one the chain came from on a tie (so the chain never cycles), else the lowest
  // index; -1 when it shares nothing with any. Only clusters x shares a landing with hold a similarity.
  const nearest = (x: number, from: number | undefined): number => {
    let best = -1, s = 0;
    for (const [y, sy] of S[x]!) if (sy > s || (sy === s && y < best)) { s = sy; best = y; }
    return from !== undefined && best >= 0 && S[x]!.get(from) === s ? from : best;
  };
  const chain: number[] = [];
  while (active.size > 1) {
    if (chain.length === 0) chain.push(active.values().next().value!);
    const x = chain[chain.length - 1]!, y = nearest(x, chain[chain.length - 2]);
    // A cluster that shares nothing with any other never will: an average of nothing shared is nothing.
    if (y < 0) { active.delete(x); alone.push(x); chain.pop(); continue; }
    if (chain.length > 1 && chain[chain.length - 2] === y) {
      chain.length -= 2;
      const [a, b] = x < y ? [x, y] : [y, x];
      // Average linkage: the merged cluster's share with any other is its parts' shares, weighted by their sizes.
      const merged = new Map<number, number>();
      for (const k of new Set([...S[a]!.keys(), ...S[b]!.keys()])) {
        if (k === a || k === b) continue;
        const s = ((S[a]!.get(k) ?? 0) * size[a]! + (S[b]!.get(k) ?? 0) * size[b]!) / (size[a]! + size[b]!);
        merged.set(k, s);
        S[k]!.delete(b);
        S[k]!.set(a, s);
      }
      S[a] = merged;
      S[b]!.clear();
      node[a] = { v: node[a]!.v + node[b]!.v, kids: [node[a]!, node[b]!] };
      size[a]! += size[b]!;
      active.delete(b);
      continue;
    }
    chain.push(y);
  }
  // What shares nothing is paired smallest first, the co-change clusters among it.
  const rest = [...active, ...alone].map((i) => node[i]!);
  while (rest.length > 1) {
    rest.sort((p, q) => p.v - q.v);
    const [p, q] = rest.splice(0, 2) as [Node, Node];
    rest.push({ v: p.v + q.v, kids: [p, q] });
  }
  const order: string[] = [];
  const walk = (t: Node): void => { if (t.kids) { walk(t.kids[0]); walk(t.kids[1]); } else order.push(files[t.leaf!]!.file); };
  walk(rest[0]!);
  return order;
}
