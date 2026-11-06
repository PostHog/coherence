/**
 * Where the relief places what it draws, as one module the page and the warm
 * server both run: components by co-change on their parents' platforms, and
 * each component's files in an order that keeps files that land together
 * side by side. The warm server lays it out from the layout it kept last
 * (`.coherence/relief-layout.json`, layout-store.ts) and keeps the result.
 * Held, what is kept stands where it stood and only what is new to it is
 * placed, so a rebuild, a reload or a restart moves nothing. Nudged by a new
 * landing, only what that landing touched moves, as far as the co-change of
 * the history up to it pulls, so the layout follows how the code now lands
 * without ever reshuffling, and up to NUDGES_MAX (layout-store.ts) landings nudge it the same
 * way whether they were watched one by one or arrived together, but for the
 * measures that size the blocks. The page holds
 * the places the server sends and draws the files in the order the server
 * sends them.
 *
 * Nothing here touches the DOM or node: the page's bundle carries it.
 */

/**
 * A component's place as the last layout left it: a platform's own block on
 * it, and its subtree's centre on the platform it stands on (`on`, the folder
 * of that platform's component, "" for the ground, where `sub` is the centre
 * itself). A place kept on another platform than the one the component now
 * stands on is no place for it, and it is placed as new.
 */
export interface ReliefPlace {
  own?: number[];
  sub?: number[];
  on?: string;
}

/** Every component's place, by folder: what the state carries to the page. */
export type ReliefLayout = Record<string, ReliefPlace>;

/** The footprint measures: a block is spaced for the largest it can take, so no measure makes blocks overlap. */
export const FOOT_KEYS = ["lines", "unreached", "invariants", "refutations", "crossings", "leaned", "defects"] as const;
/** The total footprint area every measure shares, so shares compare. */
export const AREA = 5200;
/** The margin a platform keeps round what stands on it. */
export const MARGIN = 5;
/** Landings touching more files than this are a bulk move and say nothing about what lands together. */
export const CO_CHANGE_MAX = 40;
const GAP = 3;
/** The pair steps one settling may take, so a platform of hundreds settles in a fraction of a second: a flat one settles in fewer rounds, never fewer than 60. */
const PAIR_STEPS = 2e7;
/** An overlap smaller than this is what rounding a place to three digits leaves: no overlap. */
const TOUCH = 0.01;

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
 * largest. With nothing kept, the items settle from a ring. A kept item starts
 * where the last layout left it and a newcomer beside its strongest co-change
 * neighbour. A kept item stays put unless `nudge` names a landing it holds;
 * then it settles a little, held to its place so only a lasting pull moves it
 * far. `moved` is false when every item stood where it was kept.
 */
function settle(items: readonly Item[], nudge: ReadonlySet<number> | undefined): { P: [number, number][]; moved: boolean } {
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
  // What may move: a newcomer, and a kept item only when a landing that nudges holds it.
  const touched = (it: Item) => nudge !== undefined && [...nudge].some((li) => it.set.has(li));
  const free = items.map((it) => (!warm || !it.seed || touched(it) ? 1 : 0));
  const loose = free.flatMap((f, i) => (f ? [i] : []));
  let moved = loose.length > 0;
  const N = Math.min(warm ? 300 : 900, Math.max(60, Math.floor(PAIR_STEPS / Math.max(1, loose.length * n)))), heat = warm ? 0.2 : 1;
  if (moved) for (let it = 0; it < N; it++) {
    const t = (1 - it / N) * heat;
    // Each pair with one end free, once: a kept item that stays put pulls and pushes, but is never moved.
    for (const i of loose) for (let j = 0; j < n; j++) {
      if (j === i || (free[j] && j < i)) continue;
      const dx = P[j]![0] - P[i]![0], dz = P[j]![1] - P[i]![1], d = Math.hypot(dx, dz) || 0.01;
      // Strangers sit apart by up to 26, never more than half their own size, so small neighbourhoods stay tight at every depth.
      const want = (rad[i]! + rad[j]!) * 1.08 + GAP + (1 - J[i]![j]!) * Math.min(26, (rad[i]! + rad[j]!) * 0.5);
      const f = (d - want) * 0.02 * t, ux = dx / d, uz = dz / d;
      P[i]![0] += ux * f; P[i]![1] += uz * f; P[j]![0] -= ux * f * free[j]!; P[j]![1] -= uz * f * free[j]!;
    }
    // A kept item that moves is held to where the last layout left it; only a lasting pull moves it far.
    if (warm) for (const i of loose) { const o = items[i]!; if (o.seed) { P[i]![0] += (o.seed[0]! - P[i]![0]) * 0.1; P[i]![1] += (o.seed[1]! - P[i]![1]) * 0.1; } }
  }
  // Overlaps, swept by left edge: a pair whose x spans are apart is never looked at, so a platform of hundreds is not every pair every round.
  const order = items.map((_, i) => i);
  for (let it = 0; it < 400; it++) {
    let overlapped = false;
    order.sort((a, b) => P[a]![0] - items[a]!.hx - (P[b]![0] - items[b]!.hx) || a - b);
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const [i, j] = [order[p]!, order[q]!];
      if (P[j]![0] - items[j]!.hx >= P[i]![0] + items[i]!.hx + GAP - TOUCH) break;
      const dx = P[j]![0] - P[i]![0], dz = P[j]![1] - P[i]![1];
      const ox = items[i]!.hx + items[j]!.hx + GAP - Math.abs(dx), oz = items[i]!.hz + items[j]!.hz + GAP - Math.abs(dz);
      if (ox > TOUCH && oz > TOUCH) {
        overlapped = moved = true;
        // The one that may move gives way; two kept ones that grew into each other share it.
        const wi = free[i]! + free[j]! === 0 ? 0.5 : free[i]! / (free[i]! + free[j]!), wj = 1 - wi;
        if (ox < oz) { const s = Math.sign(dx) || 1; P[i]![0] -= s * ox * wi; P[j]![0] += s * ox * wj; }
        else { const s = Math.sign(dz) || 1; P[i]![1] -= s * oz * wi; P[j]![1] += s * oz * wj; }
      }
    }
    if (!overlapped) break;
  }
  return { P, moved };
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
  /** The places, by folder, to keep and to lay the next layout out from. */
  layout: ReliefLayout;
}

/**
 * Place every component: deepest first, each platform settles its own block
 * beside its children's subtrees by co-change over landings of CO_CHANGE_MAX
 * files or fewer, and each subtree then moves as one piece; the top-level
 * subtrees settle against each other the same way. Held, a layout placed from
 * its own places is those places, to the digit. `nudge` names landings
 * (indices into `landings`, newest first) that move what they touched: the
 * co-change is then read over those landings and the ones before them, the
 * history as it stood when they landed.
 */
export function placeComponents(C: readonly Placed[], landings: readonly Landed[], seed: Readonly<Record<string, ReliefPlace>> = {}, nudge?: ReadonlySet<number>): ComponentPlaces {
  const { parent, kids, level, under } = nesting(C);
  const value = (c: Placed, key: (typeof FOOT_KEYS)[number]) => c.v[key] ?? 0;
  const totals = Object.fromEntries(FOOT_KEYS.map((k) => [k, C.reduce((a, c) => a + value(c, k), 0)])) as Record<(typeof FOOT_KEYS)[number], number>;
  // A measure nothing has recorded draws nothing.
  const side = (c: Placed, key: (typeof FOOT_KEYS)[number]) => (totals[key] ? Math.sqrt((value(c, key) / totals[key]) * AREA) : 0);
  const maxSide = C.map((c) => Math.max(...FOOT_KEYS.map((k) => side(c, k))));
  const sets = C.map(() => new Set<number>());
  const from = nudge === undefined || nudge.size === 0 ? 0 : Math.min(...nudge);
  landings.forEach((l, i) => { if (i >= from && l.n <= CO_CHANGE_MAX) for (const [ci] of l.c) sets[ci]!.add(i); });
  const subSet = C.map((_, ci) => new Set(under(ci).flatMap((k) => [...sets[k]!])));
  const own = C.map((): [number, number] => [0, 0]), sub = C.map((): [number, number] => [0, 0]);
  const ext = C.map((_, ci): [number, number] => [maxSide[ci]! / 2, maxSide[ci]! / 2]);
  const on = (ci: number) => (parent[ci]! < 0 ? "" : C[parent[ci]!]!.folder);
  // A platform centred again round what changed on it carries the shift up, so what stands on it stays where it stood.
  const drift = C.map((): [number, number] => [0, 0]);
  // A subtree's kept centre counts only on the platform it was kept on.
  const keptSub = (ci: number) => { const kept = seed[C[ci]!.folder]; return kept?.on === on(ci) && kept.sub !== undefined ? [kept.sub[0]! + drift[ci]![0], kept.sub[1]! + drift[ci]![1]] : undefined; };
  for (const ci of C.map((_, i) => i).sort((a, b) => level[b]! - level[a]!)) {
    if (!kids[ci]!.length) continue;
    const items: Item[] = [{ hx: maxSide[ci]! / 2, hz: maxSide[ci]! / 2, set: sets[ci]!, seed: seed[C[ci]!.folder]?.own }, ...kids[ci]!.map((k) => ({ hx: ext[k]![0], hz: ext[k]![1], set: subSet[k]!, seed: keptSub(k) }))];
    const { P: Q, moved } = settle(items, nudge);
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    items.forEach((it, i) => { box[0] = Math.min(box[0]!, Q[i]![0] - it.hx); box[1] = Math.min(box[1]!, Q[i]![1] - it.hz); box[2] = Math.max(box[2]!, Q[i]![0] + it.hx); box[3] = Math.max(box[3]!, Q[i]![1] + it.hz); });
    // Centred on its platform, the subtree's own centre moving by as much the other way (drift), so nothing on it moves; a platform
    // centred when it was kept is off by no more than rounding, and centring it again would only round it away.
    const cx = (box[0]! + box[2]!) / 2, cz = (box[1]! + box[3]!) / 2;
    const [mx, mz] = moved || Math.hypot(cx, cz) > TOUCH ? [cx, cz] : [0, 0];
    drift[ci] = [mx, mz];
    own[ci] = [Q[0]![0] - mx, Q[0]![1] - mz];
    kids[ci]!.forEach((k, i) => { sub[k] = [Q[i + 1]![0] - mx, Q[i + 1]![1] - mz]; });
    ext[ci] = [(box[2]! - box[0]!) / 2 + MARGIN, (box[3]! - box[1]!) / 2 + MARGIN];
  }
  const tops = C.map((_, i) => i).filter((i) => parent[i]! < 0);
  const at = C.map((): [number, number] => [0, 0]); // centre of each subtree
  if (tops.length > 1) {
    const { P: Q } = settle(tops.map((t) => ({ hx: ext[t]![0], hz: ext[t]![1], set: subSet[t]!, seed: keptSub(t) })), nudge);
    tops.forEach((t, i) => { at[t] = Q[i]!; });
  } else for (const t of tops) at[t] = (keptSub(t) as [number, number] | undefined) ?? [0, 0];
  for (const ci of C.map((_, i) => i).sort((a, b) => level[a]! - level[b]!)) if (parent[ci]! >= 0) at[ci] = [at[parent[ci]!]![0] + sub[ci]![0], at[parent[ci]!]![1] + sub[ci]![1]];
  const P = C.map((_, ci): [number, number] => [at[ci]![0] + own[ci]![0], at[ci]![1] + own[ci]![1]]);
  // A top-level subtree keeps its centre as its sub, so a layout of several roots lays out its own next layout; only a platform has an own block to keep.
  const layout: ReliefLayout = Object.fromEntries(C.map((c, ci) => [c.folder, { ...(kids[ci]!.length ? { own: own[ci]!.map(round) } : {}), sub: (parent[ci]! < 0 ? at[ci]! : sub[ci]!).map(round), on: on(ci) }]));
  return { parent, kids, level, under, totals, side, ext, tops, P, layout };
}

const round = (v: number) => +v.toFixed(3);

interface FileLanded {
  file: string;
  lines: number;
  /** [landing index, lines changed] for each landing that changed it. */
  l?: readonly (readonly [number, number])[];
}

/** How many files one new landing may move in a block's kept order: a landing nudges a block, never reshuffles it. */
export const MOVES_PER_LANDING = 3;
/** The least share of landings a file must have with another to be moved beside it. */
export const MOVE_SHARE = 0.25;

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
 * out. Each landing in `fresh` (indices into `landings`, the landings since
 * the order was last checked), oldest first, may then move up to
 * MOVES_PER_LANDING of the files it touched beside the file each landed with
 * most by then, when that file shares at least MOVE_SHARE of their landings
 * and twice what either neighbour does: the order follows how the code now
 * lands, a few files a landing, the same whether the landings were seen one
 * by one or together. A seed that holds fewer than half the files is what another
 * checkout learned, and the order is laid out afresh.
 */
export function fileOrder(files: readonly FileLanded[], landings: readonly { n: number }[], seed?: readonly string[], fresh: ReadonlySet<number> = new Set()): string[] {
  const n = files.length;
  if (n === 0) return [];
  const landed = files.map((f) => new Set((f.l ?? []).filter(([li]) => (landings[li]?.n ?? Infinity) <= CO_CHANGE_MAX).map(([li]) => li)));
  const at = new Map(files.map((f, i) => [f.file, i]));
  const kept = seed === undefined ? [] : [...new Set(seed)].filter((p) => at.has(p)).map((p) => at.get(p)!);
  if (seed !== undefined && kept.length * 2 >= n) return seeded(files, landed, kept, fresh).map((i) => files[i]!.file);
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
  // What shares nothing is paired smallest first (the earlier on a tie), the co-change clusters among it, through a heap: a folder of thousands that share nothing pairs in n log n.
  const heap = new Heap<Node>();
  for (const i of [...active, ...alone]) heap.push(node[i]!, node[i]!.v);
  while (heap.size > 1) {
    const p = heap.pop(), q = heap.pop();
    heap.push({ v: p.v + q.v, kids: [p, q] }, p.v + q.v);
  }
  // Read leaf by leaf without recursion: a tree of ties merged one file at a time is as deep as the folder is wide.
  const order: string[] = [];
  for (const stack = [heap.pop()]; stack.length; ) {
    const t = stack.pop()!;
    if (t.kids) stack.push(t.kids[1], t.kids[0]);
    else order.push(files[t.leaf!]!.file);
  }
  return order;
}

/**
 * The files sharing a landing with i, each with the share of landings they
 * have in common, through the landings (each holds CO_CHANGE_MAX files at
 * most), counting only landings `from` and older (indices are newest first).
 */
function sharesOf(i: number, landed: readonly ReadonlySet<number>[], byLanding: ReadonlyMap<number, readonly number[]>, among: (j: number) => boolean, from = 0): Map<number, number> {
  const count = (x: number) => { let k = 0; for (const li of landed[x]!) if (li >= from) k++; return k; };
  const common = new Map<number, number>();
  for (const li of landed[i]!) if (li >= from) for (const j of byLanding.get(li) ?? []) if (j !== i && among(j)) common.set(j, (common.get(j) ?? 0) + 1);
  const mine = count(i);
  for (const [j, k] of common) common.set(j, k / (mine + count(j) - k));
  return common;
}

/** A kept order with the new files put in and the fresh landings' few moves made, as indices into the files. */
function seeded(files: readonly FileLanded[], landed: readonly ReadonlySet<number>[], kept: readonly number[], fresh: ReadonlySet<number>): number[] {
  const byLanding = new Map<number, number[]>();
  landed.forEach((set, i) => { for (const li of set) (byLanding.get(li) ?? byLanding.set(li, []).get(li)!).push(i); });
  const placed = new Set(kept);
  // Each new file goes in after the placed file it lands with most (the lowest index on a tie), largest first; the newest put in after a file stands nearest it.
  const after = new Map<number, number[]>(), atEnd: number[] = [];
  const newcomers = files.map((_, i) => i).filter((i) => !placed.has(i)).sort((a, b) => files[b]!.lines - files[a]!.lines || (files[a]!.file < files[b]!.file ? -1 : 1));
  for (const i of newcomers) {
    let best = -1, share = 0;
    for (const [j, s] of sharesOf(i, landed, byLanding, (j) => placed.has(j))) if (s > share || (s === share && j < best)) { share = s; best = j; }
    if (best < 0) atEnd.push(i);
    else (after.get(best) ?? after.set(best, []).get(best)!).unshift(i);
    placed.add(i);
  }
  const order: number[] = [];
  const emit = (root: number) => {
    for (const stack = [root]; stack.length; ) {
      const i = stack.pop()!;
      order.push(i);
      const next = after.get(i);
      if (next) for (let k = next.length - 1; k >= 0; k--) stack.push(next[k]!);
    }
  };
  for (const i of [...kept, ...atEnd]) emit(i);
  // The fresh landings' moves, oldest first, each over the history as it stood when it landed: of the files it touched, in the order they stand, up to MOVES_PER_LANDING go beside the file each then landed with most.
  for (const li of [...fresh].sort((a, b) => b - a)) {
    let moves = MOVES_PER_LANDING;
    const touchedNow = new Set(byLanding.get(li) ?? []);
    for (const i of order.filter((x) => touchedNow.has(x))) {
      if (moves === 0) break;
      const shares = sharesOf(i, landed, byLanding, () => true, li);
      let best = -1, share = 0;
      for (const [j, s] of shares) if (s > share || (s === share && j < best)) { share = s; best = j; }
      if (best < 0 || share < MOVE_SHARE) continue;
      const k = order.indexOf(i);
      const beside = Math.max(shares.get(order[k - 1]!) ?? 0, shares.get(order[k + 1]!) ?? 0);
      if (share < beside * 2 || order[k - 1] === best || order[k + 1] === best) continue;
      order.splice(k, 1);
      order.splice(order.indexOf(best) + 1, 0, i);
      moves--;
    }
  }
  return order;
}

/** A binary min-heap by key, the earlier pushed first on a tie, so what it pops is the same for the same pushes. */
class Heap<T> {
  private readonly items: { item: T; key: number; seq: number }[] = [];
  private seq = 0;
  get size(): number {
    return this.items.length;
  }
  private less(a: number, b: number): boolean {
    const [x, y] = [this.items[a]!, this.items[b]!];
    return x.key < y.key || (x.key === y.key && x.seq < y.seq);
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
  }
  push(item: T, key: number): void {
    this.items.push({ item, key, seq: this.seq++ });
    for (let i = this.items.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (!this.less(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }
  pop(): T {
    const top = this.items[0]!, last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.items.length && this.less(l, m)) m = l;
        if (r < this.items.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top.item;
  }
}
