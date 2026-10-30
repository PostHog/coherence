// @ts-nocheck: ported whole from the relief prototype; typing lands with the view's spec bullets.
/**
 * The relief: Scope's Structure view. Each component is a block on its parent's
 * platform, its footprint its share of a measure, its height the churn of a
 * window, placed by co-change. Built once into its own root element and kept
 * alive across Scope's renders, so the scene, its camera and its animation
 * survive a state update; the page re-attaches the root wherever the view is.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ReliefData } from "./data.ts";
import type { Touch } from "../../relief/relief.ts";

export type { Touch };

/** What the relief needs from the page: an authenticated GET on the live server, absent in a snapshot. */
export interface ReliefIO {
  get?: (path: string) => Promise<unknown>;
  diff?: string;
}

/**
 * What the reader has made of a scene, by folder and path rather than index,
 * so a scene built from new data opens where the old one stood.
 */
export interface ReliefView {
  layout: Record<string, { own: number[]; sub: number[] }>;
  foot: string;
  height: string;
  win: string;
  split: boolean;
  big: boolean;
  scope: string;
  own: boolean;
  selected: string | null;
  file: [string, string] | null;
  camera: { view: string; position: number[]; target: number[] };
  /** The diff's two ends as the selects held them; null before the commits arrived, or in a snapshot. */
  diff: { a: string; b: string } | null;
}

export interface Relief {
  root: HTMLElement;
  resume(): void;
  /** Light the files an agent just read or wrote, and the components holding them. */
  touch(touches: readonly Touch[]): void;
  view(): ReliefView;
  /** Stop for good: the frame loop, timers and listeners end, the GL context and every buffer are released, the root leaves the page. */
  dispose(): void;
}


const MARKUP = `<div class="controls">
    <div class="group" data-r="gFoot"><span>Footprint</span></div>
    <div class="group" data-r="gHeight"><span>Height</span></div>
    <div class="group" data-r="gWin"><span>Window</span></div>
    <div class="group" data-r="gSplit"><span>Blocks</span></div>
    <div class="group" data-r="gDiff" hidden><span>Diff</span><select data-r="selA"></select><span>→</span><select data-r="selB"></select></div>
  </div>
  <div class="main">
    <div class="stage" data-r="stage">
      <div class="crumbs" data-r="crumbs"></div>
      <svg class="leaders" data-r="leaders"></svg>
      <div class="callouts" data-r="callouts"></div>
      <div class="scale" data-r="scale"></div>
      <ol class="activity" data-r="activity" aria-live="polite"></ol>
    </div>
    <aside data-r="side"></aside>
  </div>
  <div class="note" data-r="note"></div>
  <details><summary>Table view</summary><div data-r="table"></div></details>
  <div class="tip" data-r="tip"></div>`;

export function createRelief(D: ReliefData, io: ReliefIO = {}, carried?: ReliefView): Relief {
let disposed = false, raf = 0;
// Timers the scene sets, so disposing clears what is still pending.
const timers = new Set();
const later = (run, ms) => { const t = setTimeout(() => { timers.delete(t); run(); }, ms); timers.add(t); };
const root = document.createElement("div");
root.className = "relief";
root.innerHTML = MARKUP;
const $ = (name) => root.querySelector(`[data-r="${name}"]`);
const C = D.components;
const PROJECT = D.project ?? "Coherence";
const poss = (name) => (name.endsWith("s") ? name + "'" : name + "'s"); // Products' own files, Core's own files
const TRUNK = D.trunk ?? "main";
const fmt = (n) => n.toLocaleString("en-US");
const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(x < 0.1 ? 1 : 0) + "%" : "–");
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();

const FOOT = [
  { key: "lines", label: "Lines", unit: "lines", how: "the lines mass counts in the component's files (node src/cli.ts mass --json); mass leaves out test files" },
  { key: "unreached", label: "Unreached", unit: "unreached lines", how: "lines in files no enforcement reaches, per mass. Totality oracles name no files, so this is mostly where no chokepoint reaches" },
  { key: "invariants", label: "Invariants", unit: "bullets", how: "bullets in the component's spec" },
  { key: "refutations", label: "Refutations", unit: "refutations", how: "refuted: entries under the component's bullets" },
  { key: "crossings", label: "Crossings", unit: "crossing bullets", how: "bullets that carry a crossing" },
  { key: "leaned", label: "Leaned on", unit: "call sites in", how: "call sites in other components that use this component's symbols, values and types alike, from Scope's component interfaces: the load it carries" },
  { key: "defects", label: "Defects", unit: "open defects", how: "open defect records in the journal (a resolution closes one, a retraction withdraws it) naming a file in the component's folder; one naming no file counts nowhere" },
];
const HEIGHT = [
  { key: "landings", label: "Landings", unit: "landings", how: `first-parent commits on ${TRUNK} touching the component` },
  { key: "volume", label: "Lines changed", unit: "lines changed", how: "lines added plus deleted in those landings" },
];
const LATEST = D.landings[0].date;
const dayMs = 86400000;
const since = (days) => new Date(Date.parse(LATEST) - (days - 1) * dayMs).toISOString().slice(0, 10);
const WIN = D.windows ? D.windows.map((w) => ({ key: w.key, label: w.label, from: w.days ? since(w.days) : "0000" })) : [
  { key: "7", label: "7 days", from: since(7) },
  { key: "30", label: "30 days", from: since(30) },
  { key: "rebuild", label: "Since rebuild", from: "2026-09-17" },
  { key: "all", label: "All", from: "0000" },
];
const BIG = 200;
const state = { foot: "lines", height: "landings", win: D.defaultWindow ?? "30", split: false, big: false, scope: null, own: false, preview: null, selected: null, file: null };

// ---------- measures ----------
for (const c of C) for (const m of FOOT) c.v[m.key] ??= 0; // a model without a reading of this measure records none of it
const totals = {}; for (const m of FOOT) totals[m.key] = C.reduce((a, c) => a + c.v[m.key], 0);
function churn() {
  const from = WIN.find((w) => w.key === state.win).from;
  const comp = C.map(() => ({ landings: 0, volume: 0, list: [] }));
  const file = C.map((c) => c.files.map(() => ({ landings: 0, volume: 0 })));
  for (const l of D.landings) {
    if (l.date < from || (!state.big && l.n > BIG)) continue;
    for (const [ci, v] of l.c) { comp[ci].landings++; comp[ci].volume += v; comp[ci].list.push([l, v]); }
    for (const [ci, fi, v] of l.f) { file[ci][fi].landings++; file[ci][fi].volume += v; }
  }
  return { comp, file };
}

// ---------- nesting: a component stands on the platform of the nearest component whose folder holds it ----------
const holds = (outer, inner) => inner !== outer && (outer === "." || inner.startsWith(outer + "/"));
const parent = C.map((c) => { let best = -1, len = -1; C.forEach((o, oi) => { const l = o.folder === "." ? 0 : o.folder.length; if (!o.virtual && holds(o.folder, c.folder) && l > len) { best = oi; len = l; } }); return best; });
const kids = C.map((_, ci) => C.map((_, k) => k).filter((k) => parent[k] === ci));
const level = C.map((_, ci) => { let n = 0; for (let p = parent[ci]; p >= 0; p = parent[p]) n++; return n; });
const under = (ci) => [ci, ...kids[ci].flatMap(under)]; // a component and everything inside it
const PLH = 2.4, MARGIN = 5;
// A slice is a component with everything inside it, or (own) just the files no component inside it claims.
const inScope = (ci) => { if (state.own) return ci === state.scope; for (let p = ci; p >= 0; p = parent[p]) if (p === state.scope) return true; return false; };
const base = (ci) => (level[ci] + (kids[ci].length ? 1 : 0)) * PLH; // components always stand on their parent's platform

// ---------- layout: footprints and co-change positions ----------
const AREA = 5200; // total footprint area shared by every measure, so shares compare
const side = (c, key) => (totals[key] ? Math.sqrt((c.v[key] / totals[key]) * AREA) : 0); // a measure nothing has recorded draws nothing
const maxSide = C.map((c) => Math.max(...FOOT.map((m) => side(c, m.key))));
// Co-change between components over every landing that touches at most 40 files.
const sets = C.map(() => new Set());
D.landings.forEach((l, i) => { if (l.n <= 40) for (const [ci] of l.c) sets[ci].add(i); });
const subSet = C.map((_, ci) => new Set(under(ci).flatMap((k) => [...sets[k]])));
const jac = (a, b) => { let inter = 0; for (const x of a) if (b.has(x)) inter++; const uni = a.size + b.size - inter; return uni ? inter / uni : 0; };
const GAP = 3;
// Lay out items {hx, hz, set} by co-change, then push apart so no rectangle overlaps at its largest.
// The last build's layout seeds this one, so the map stays familiar: what was settled starts where it was and
// only drifts as far as its co-change has really changed; a newcomer starts beside its strongest co-change neighbour.
const SEED = D.seed ?? carried?.layout ?? {};
function settle(items) {
  const n = items.length, J = items.map((a) => items.map((b) => (a === b ? 1 : jac(a.set, b.set))));
  const rad = items.map((it) => Math.max(it.hx, it.hz));
  const warm = items.some((it) => it.seed);
  const P = items.map((it, i) => { if (it.seed) return [...it.seed]; const a = (i / n) * Math.PI * 2; return [Math.cos(a) * 40, Math.sin(a) * 40]; });
  if (warm) items.forEach((it, i) => {
    if (it.seed) return;
    let best = -1; items.forEach((o, j) => { if (o.seed && (best < 0 || J[i][j] > J[i][best])) best = j; });
    if (best >= 0) P[i] = [P[best][0] + rad[i] + rad[best] + GAP, P[best][1]];
  });
  const N = warm ? 300 : 900, heat = warm ? 0.2 : 1;
  for (let it = 0; it < N; it++) {
    const t = (1 - it / N) * heat;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = P[j][0] - P[i][0], dz = P[j][1] - P[i][1], d = Math.hypot(dx, dz) || 0.01;
      // Strangers sit apart by up to 26, never more than half their own size, so small neighbourhoods stay tight at every depth.
      const want = (rad[i] + rad[j]) * 1.08 + GAP + (1 - J[i][j]) * Math.min(26, (rad[i] + rad[j]) * 0.5);
      const f = (d - want) * 0.02 * t, ux = dx / d, uz = dz / d;
      P[i][0] += ux * f; P[i][1] += uz * f; P[j][0] -= ux * f; P[j][1] -= uz * f;
    }
    // A seeded item is held to where the last build left it; only a lasting pull moves it far.
    if (warm) items.forEach((o, i) => { if (o.seed) { P[i][0] += (o.seed[0] - P[i][0]) * 0.1; P[i][1] += (o.seed[1] - P[i][1]) * 0.1; } });
  }
  for (let it = 0; it < 400; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = P[j][0] - P[i][0], dz = P[j][1] - P[i][1];
      const ox = items[i].hx + items[j].hx + GAP - Math.abs(dx), oz = items[i].hz + items[j].hz + GAP - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        moved = true;
        if (ox < oz) { const s = Math.sign(dx) || 1; P[i][0] -= s * ox / 2; P[j][0] += s * ox / 2; }
        else { const s = Math.sign(dz) || 1; P[i][1] -= s * oz / 2; P[j][1] += s * oz / 2; }
      }
    }
    if (!moved) break;
  }
  return P;
}
// Deepest first, each platform settles its own block beside its children's subtrees, and each subtree then moves as one piece.
const own = C.map(() => [0, 0]), sub = C.map(() => [0, 0]);
const ext = C.map((_, ci) => [maxSide[ci] / 2, maxSide[ci] / 2]);
for (const ci of C.map((_, i) => i).sort((a, b) => level[b] - level[a])) {
  if (!kids[ci].length) continue;
  const items = [{ hx: maxSide[ci] / 2, hz: maxSide[ci] / 2, set: sets[ci], seed: SEED[C[ci].folder]?.own }, ...kids[ci].map((k) => ({ hx: ext[k][0], hz: ext[k][1], set: subSet[k], seed: SEED[C[k].folder]?.sub }))];
  const Q = settle(items);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  items.forEach((it, i) => { box[0] = Math.min(box[0], Q[i][0] - it.hx); box[1] = Math.min(box[1], Q[i][1] - it.hz); box[2] = Math.max(box[2], Q[i][0] + it.hx); box[3] = Math.max(box[3], Q[i][1] + it.hz); });
  const mx = (box[0] + box[2]) / 2, mz = (box[1] + box[3]) / 2;
  own[ci] = [Q[0][0] - mx, Q[0][1] - mz];
  kids[ci].forEach((k, i) => { sub[k] = [Q[i + 1][0] - mx, Q[i + 1][1] - mz]; });
  ext[ci] = [(box[2] - box[0]) / 2 + MARGIN, (box[3] - box[1]) / 2 + MARGIN];
}
const tops = C.map((_, i) => i).filter((i) => parent[i] < 0);
const at = C.map(() => [0, 0]); // centre of each subtree
if (tops.length > 1) { const Q = settle(tops.map((t) => ({ hx: ext[t][0], hz: ext[t][1], set: subSet[t] }))); tops.forEach((t, i) => { at[t] = Q[i]; }); }
for (const ci of C.map((_, i) => i).sort((a, b) => level[a] - level[b])) if (parent[ci] >= 0) at[ci] = [at[parent[ci]][0] + sub[ci][0], at[parent[ci]][1] + sub[ci][1]];
const P = C.map((_, ci) => [at[ci][0] + own[ci][0], at[ci][1] + own[ci][1]]);
const LAYOUT = Object.fromEntries(C.map((c, ci) => [c.folder, { own: own[ci].map((v) => +v.toFixed(3)), sub: sub[ci].map((v) => +v.toFixed(3)) }]));

// Squarified treemap of a component's files inside its lines footprint.
function treemap(items, x, y, w, h) {
  const out = new Array(items.length);
  const total = items.reduce((a, it) => a + it.v, 0) || 1;
  const order = items.map((it, i) => [it.v, i]).sort((a, b) => b[0] - a[0]);
  let rect = { x, y, w, h }, rest = order.slice(), scale = (w * h) / total;
  while (rest.length) {
    const short = Math.min(rect.w, rect.h); let row = [], best = Infinity;
    while (rest.length) {
      const cand = [...row, rest[0]], s = cand.reduce((a, r) => a + r[0] * scale, 0);
      const worst = Math.max(...cand.map((r) => Math.max((short * short * r[0] * scale) / (s * s), (s * s) / (short * short * r[0] * scale || 1e-9))));
      if (worst > best) break; best = worst; row = cand; rest.shift();
    }
    const s = row.reduce((a, r) => a + r[0] * scale, 0), thick = s / short; let off = 0;
    for (const [v, i] of row) {
      const len = (v * scale) / thick;
      out[i] = rect.w >= rect.h ? { x: rect.x, y: rect.y + off, w: thick, h: len } : { x: rect.x + off, y: rect.y, w: len, h: thick };
      off += len;
    }
    rect = rect.w >= rect.h ? { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h } : { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
  }
  return out;
}

// ---------- scene ----------
const stage = $("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
// Everything the model draws stands in one group, so stepping into a slice can stretch the ground under it.
const world = new THREE.Group(); scene.add(world);
const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.05; controls.minDistance = 60; controls.maxDistance = 700;
state.own = false;
state.scope = tops[0];
// A rebuild opens on the reader's view: the measures, the slice and the selection, as far as the new data still has them.
if (carried) {
  const index = new Map(C.map((c, ci) => [c.folder, ci]));
  if (FOOT.some((m) => m.key === carried.foot)) state.foot = carried.foot;
  if (HEIGHT.some((m) => m.key === carried.height)) state.height = carried.height;
  if (WIN.some((w) => w.key === carried.win)) state.win = carried.win;
  state.split = carried.split; state.big = carried.big;
  const scope = index.get(carried.scope);
  if (scope !== undefined) { state.scope = scope; state.own = carried.own && kids[scope].length > 0; }
  state.selected = index.get(carried.selected) ?? null;
  const fci = carried.file ? index.get(carried.file[0]) : undefined, ffi = fci === undefined ? -1 : C[fci].files.findIndex((f) => f.file === carried.file[1]);
  state.file = ffi >= 0 ? [fci, ffi] : null;
}
// The camera stands back far enough to take in the widest platform: Coherence's framing is the floor.
const reach = Math.max(1, ...tops.map((t) => Math.hypot(...ext[t]))), far = Math.max(1, (reach * 2.2) / 340);
const TILT = [175, 185, 225].map((v) => v * far), TOP = [0.01, 330 * far, 0.01];
controls.maxDistance = 700 * far;
controls.minDistance = 15;
// The camera aims at the scope: its platform's centre, from far enough back to take in the platform and its tallest tower.
let lastView = "tilt", camTween = null;
// The camera keeps one framing; a slice is centred under it and its ground stretched until it spans the frame
// the way the whole map does. Heights never stretch, so towers keep their proportions at every depth.
function aim(kind = lastView, animate = true) {
  lastView = kind;
  const own = state.own ? (() => { const s = side(C[state.scope], state.split ? "lines" : state.foot), [x, z] = P[state.scope]; return [x - s / 2, z - s / 2, x + s / 2, z + s / 2]; })() : null;
  const r = own ?? RECT[state.scope], cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2, R = RECT[tops[0]];
  // A lone block has no platform margin round it, so it gets room of its own, or it fills the frame edge to edge.
  const bare = state.own || !kids[state.scope].length ? 1.8 : 1;
  const S = Math.min(24, Math.max(1, (0.7 * Math.hypot(R[2] - R[0], R[3] - R[1])) / Math.max(1e-3, bare * Math.hypot(r[2] - r[0], r[3] - r[1]))));
  const y = base(state.scope), dir = kind === "top" ? new THREE.Vector3(0.0001, 1, 0.0001) : new THREE.Vector3(...TILT).normalize();
  const to = { S, off: new THREE.Vector3(-cx * S, 0, -cz * S), target: new THREE.Vector3(0, y, 0) };
  to.pos = to.target.clone().addScaledVector(dir, kind === "top" ? Math.hypot(...TOP) : Math.hypot(...TILT));
  if (!animate) { world.scale.set(S, 1, S); world.position.copy(to.off); camera.position.copy(to.pos); controls.target.copy(to.target); controls.update(); return; }
  camTween = { t0: performance.now(), from: { S: world.scale.x, off: world.position.clone(), pos: camera.position.clone(), target: controls.target.clone() }, to };
}
const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.6); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-80, 200, 120); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshBasicMaterial({ color: 0xffffff }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; scene.add(ground);

const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
const unitEdges = new THREE.EdgesGeometry(unit);
const MAXH = 70, MINH = 0.6, METER = 26; // METER: the tallest diff meter, standing on its block
function block(kind, ci, fi) {
  const mesh = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }));
  const edges = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ transparent: true }));
  mesh.add(edges);
  mesh.userData = { kind, ci, fi, cur: { x: 0, z: 0, w: 0.01, d: 0.01, h: 0.01 }, to: null, edges };
  mesh.scale.set(0.01, 0.01, 0.01);
  // The diff stacks on top: green for lines added, red above it for lines deleted.
  const cap = () => { const m = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 })); m.add(new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ transparent: true }))); m.userData = mesh.userData; m.visible = false; world.add(m); return m; };
  mesh.userData.caps = { add: cap(), del: cap() }; mesh.userData.capCur = { a: 0, d: 0 }; mesh.userData.capTo = { a: 0, d: 0 };
  world.add(mesh); return mesh;
}
const compBlocks = C.map((c, ci) => block("comp", ci));
// Files are instances of one box, so a repository of tens of thousands of files still draws in three calls.
// Their edges come from the shader: a line wherever a face nears the edge of its box, a pixel wide.
function edged(mat) {
  mat.userData.u = { uEdge: { value: new THREE.Color(0, 0, 0) }, uEdgeA: { value: 0.3 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.u);
    sh.vertexShader = "varying vec3 vBoxP; varying vec3 vBoxH;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vBoxP = (position - vec3(0.0, 0.5, 0.0)) * sc; vBoxH = 0.5 * sc;`);
    sh.fragmentShader = "varying vec3 vBoxP; varying vec3 vBoxH; uniform vec3 uEdge; uniform float uEdgeA;\n" + sh.fragmentShader.replace("#include <dithering_fragment>", `#include <dithering_fragment>
      vec3 q = vBoxH - abs(vBoxP);
      float lo = min(q.x, min(q.y, q.z)), hi = max(q.x, max(q.y, q.z)), mid = q.x + q.y + q.z - lo - hi;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdge, uEdgeA * (1.0 - smoothstep(0.0, fwidth(mid) * 1.5, mid)));`);
  };
  return mat;
}
const FILES = []; C.forEach((c, ci) => c.files.forEach((f, fi) => FILES.push([ci, fi])));
const fileAt = C.map(() => []); FILES.forEach(([ci, fi], i) => { fileAt[ci][fi] = i; });
const NF = FILES.length;
function instances(roughness) {
  const m = new THREE.InstancedMesh(unit, edged(new THREE.MeshStandardMaterial({ roughness, metalness: 0 })), NF);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceMatrix.array.fill(0);
  m.setColorAt(0, new THREE.Color(1, 1, 1)); m.frustumCulled = false; world.add(m); return m;
}
const fileMesh = instances(0.85), addMesh = instances(0.7), delMesh = instances(0.7);
// ---------- agent activity: what a session reads glows cool, what it writes glows warm, and both fade ----------
// Glows add light: drawn additively, a black glow adds nothing, so a dark instance is simply off.
const GLOW = { read: { color: new THREE.Color("#7fdcff"), life: 15000 }, write: { color: new THREE.Color("#ffb347"), life: 20000 } };
const fileGlow = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), NF);
fileGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fileGlow.instanceMatrix.array.fill(0);
fileGlow.setColorAt(0, new THREE.Color(0, 0, 0)); fileGlow.frustumCulled = false; fileGlow.renderOrder = 4; world.add(fileGlow);
const glows = new Map(); // "ci" or "ci:fi" → { ci, fi, kind, t0 }
// A faded file is drawn in a second, see-through set of the same boxes, as translucent as a faded component.
function ghosts(m) { const g = instances(0.85); g.material.transparent = true; g.material.opacity = 0.22; g.material.depthWrite = false; g.renderOrder = 1; return g; }
const ghostFile = ghosts(), ghostAdd = ghosts(), ghostDel = ghosts();
const SETS = [[fileMesh, ghostFile], [addMesh, ghostAdd], [delMesh, ghostDel]];
// Per file: cur, to and now as [x, y, z, w, d, h], caps as [added, deleted], and the colour ramp position.
const FS = { faded: new Uint8Array(NF), cur: new Float32Array(NF * 6), to: new Float32Array(NF * 6), now: new Float32Array(NF * 6), capCur: new Float32Array(NF * 2), capTo: new Float32Array(NF * 2), capNow: new Float32Array(NF * 2), t: new Float32Array(NF), hide: false, settled: false };
const selBox = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: 0xff8a4c })); selBox.visible = false; world.add(selBox);
const fileRects = C.map((c) => null); // treemaps of each component's files in its lines footprint, relative to its centre
function rectsOf(ci) {
  if (!fileRects[ci]) { const s = side(C[ci], "lines"); fileRects[ci] = treemap(C[ci].files.map((f) => ({ v: f.lines })), -s / 2, -s / 2, s, s); }
  return fileRects[ci];
}
const outlines = C.map(() => {
  const g = new THREE.BufferGeometry().setFromPoints([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5], [-.5, -.5]].map(([x, z]) => new THREE.Vector3(x, 0.02, z)));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ transparent: true })); world.add(l); return l;
});
// A folder with no spec is unclaimed land: a dashed survey line runs round its footprint.
const survey = C.map((c) => {
  if (!c.virtual) return null;
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 5 }, () => new THREE.Vector3())), new THREE.LineDashedMaterial({ transparent: true, dashSize: 0.9, gapSize: 0.6 }));
  world.add(l); return l;
});
// Labels are callouts: a point in the scene it names, and a label at the edge of the viewport with a hairline back to it.
const calloutBox = $("callouts");
function callout(d, ci, kind) {
  const o = new THREE.Object3D(); o.element = d; o.ci = ci; o.kind = kind; world.add(o); calloutBox.append(d);
  d.onclick = () => { state.selected = ci; state.file = null; state.preview = null; paint(); drawSide(); };
  d.onmouseenter = () => { state.preview = ci; paint(); };
  d.onmouseleave = () => { if (state.preview === ci) { state.preview = null; paint(); } };
  d.ondblclick = () => rescope(ci, kind === "comp" && kids[ci].length > 0);
  return o;
}
const tags = C.map((c, ci) => { const d = el("div", c.virtual ? "label virt" : "label"); d.append(c.name, el("small")); return callout(d, ci, "comp"); });
const plinths = C.map((c, ci) => {
  if (!kids[ci].length) return null;
  const m = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }));
  const edges = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ transparent: true })); m.add(edges);
  m.userData = { kind: "plinth", ci, cur: { x: 0, y: 0, z: 0, w: 0.01, d: 0.01, h: 0.01 }, to: null, edges, caps: null };
  world.add(m); return m;
});
const platTags = C.map((c, ci) => {
  if (!kids[ci].length) return null;
  const d = el("div", "label plat"); d.append(c.name, el("small")); return callout(d, ci, "plat");
});

let CH = churn(), DIFF = null;
function ramp(t) { const i = Math.min(6, Math.max(0, Math.floor(t * 7))); return css("--r" + (i + 1)); }

const RECT = C.map(() => null); // each component's platform, or its block when it has none, at the current footprint
function layout() {
  CH = churn();
  const hk = state.height, fk = state.split ? "lines" : state.foot;
  // Heights rescale to what is in scope, so a slice uses the whole range.
  const IN = C.map((_, ci) => inScope(ci)), inComp = CH.comp.filter((_, ci) => IN[ci]), inFile = CH.file.filter((_, ci) => IN[ci]).flat();
  const compMax = Math.max(1, ...inComp.map((c) => c[hk]));
  const fileMax = Math.max(1, ...inFile.map((f) => f[hk]));
  const max = state.split ? fileMax : compMax;
  // The diff stands on each block as two thin meters, green lines added and red lines deleted, on one scale for the whole
  // view and never added to the block's height; the numbers ride in the block's callout.
  const dmax = !DIFF ? 1 : Math.max(1, ...(state.split ? C.flatMap((c, ci) => (IN[ci] ? DIFF.file[ci].map((x) => Math.max(x[0], x[1])) : [])) : C.map((c, ci) => (IN[ci] ? Math.max(DIFF.comp[ci][0], DIFF.comp[ci][1]) : 0))));
  const meter = (v) => (v ? Math.max(0.5, (v / dmax) * METER) : 0);
  dScale = dmax;
  C.forEach((c, ci) => {
    const s = side(c, fk), [x, z] = P[ci], v = CH.comp[ci][hk];
    const h = v ? MINH + (v / compMax) * MAXH : MINH * 0.5;
    const y = base(ci);
    // A block with no footprint on this measure stands nowhere: no needle, no name.
    const none = !state.split && !(s > 0);
    compBlocks[ci].userData.to = state.split || !IN[ci] || none ? { x, y, z, w: s, d: s, h: 0.01, hide: true } : { x, y, z, w: s, d: s, h };
    tags[ci].visible = IN[ci] && !none;
    compBlocks[ci].userData.t = v / compMax;
    const cd = DIFF && !state.split ? DIFF.comp[ci] : null;
    const showD = cd && IN[ci] && !none && (cd[0] || cd[1]);
    compBlocks[ci].userData.capTo = { a: showD ? meter(cd[0]) : 0, d: showD ? meter(cd[1]) : 0 };
    outlines[ci].position.set(x, y, z); outlines[ci].scale.set(s, 1, s);
    if (survey[ci]) {
      const m = s / 2 + 0.6, pos = survey[ci].geometry.attributes.position;
      [[-m, -m], [m, -m], [m, m], [-m, m], [-m, -m]].forEach(([dx, dz], i) => pos.setXYZ(i, x + dx, y + 0.04, z + dz));
      pos.needsUpdate = true; survey[ci].geometry.computeBoundingSphere(); survey[ci].computeLineDistances();
      survey[ci].visible = IN[ci] && s > 0;
    }
    const rects = rectsOf(ci), sl = side(c, "lines");
    let top = h;
    if (state.split) top = 0;
    c.files.forEach((f, fi) => {
      const r = rects[fi], fv = CH.file[ci][fi][hk], fh = fv ? MINH + (fv / fileMax) * MAXH : MINH * 0.5;
      const k = s / sl, pad = Math.min(0.25, (r.w * k) / 6, (r.h * k) / 6), i = fileAt[ci][fi], o = i * 6;
      FS.to.set([x + (r.x + r.w / 2) * k, y, z + (r.y + r.h / 2) * k, Math.max(0.02, r.w * k - pad * 2), Math.max(0.02, r.h * k - pad * 2), state.split ? fh : 0.01], o);
      if (!IN[ci]) { FS.to[o + 3] = 0; FS.to[o + 4] = 0; FS.to[o + 5] = 0; }
      FS.t[i] = fv / fileMax;
      const fd = DIFF && state.split ? DIFF.file[ci][fi] : null;
      const ma = fd && IN[ci] ? meter(fd[0]) : 0, md = fd && IN[ci] ? meter(fd[1]) : 0;
      FS.capTo[i * 2] = ma; FS.capTo[i * 2 + 1] = md;
      if (state.split) top = Math.max(top, fh + Math.max(ma, md));
    });
    if (!state.split && showD) top += Math.max(meter(cd[0]), meter(cd[1]));
    tags[ci].position.set(x, y + top, z);
    tags[ci].element.firstChild.textContent = kids[ci].length ? `${poss(c.name)} own files` : c.name;
    const sub = tags[ci].element.querySelector("small");
    sub.textContent = `${fmt(c.v[fk])} ${FOOT.find((m) => m.key === fk).unit} · ${fmt(CH.comp[ci][hk])} ${HEIGHT.find((m) => m.key === hk).unit}`;
    // With a diff, the callout carries its numbers in full colour, legible however far off the block is.
    let dl = tags[ci].element.querySelector(".dl");
    const cdl = DIFF && IN[ci] ? DIFF.comp[ci] : null;
    if (cdl && (cdl[0] || cdl[1])) { if (!dl) { dl = el("span", "dl"); tags[ci].element.append(dl); } dl.replaceChildren(signed(cdl[0], cdl[1])); } else if (dl) dl.remove();
  });
  // A platform spans its own block and everything standing on it, plus a margin; its size is not a measure.
  const rect = RECT;
  for (const ci of C.map((_, i) => i).sort((a, b) => level[b] - level[a])) {
    const s = side(C[ci], fk), [x, z] = P[ci];
    let r = [x - s / 2, z - s / 2, x + s / 2, z + s / 2];
    for (const k of kids[ci]) r = [Math.min(r[0], rect[k][0]), Math.min(r[1], rect[k][1]), Math.max(r[2], rect[k][2]), Math.max(r[3], rect[k][3])];
    if (kids[ci].length) r = [r[0] - MARGIN, r[1] - MARGIN, r[2] + MARGIN, r[3] + MARGIN];
    rect[ci] = r;
    const show = IN[ci] && !state.own;
    if (!plinths[ci]) continue;
    const y = level[ci] * PLH;
    plinths[ci].userData.to = { x: (r[0] + r[2]) / 2, y, z: (r[1] + r[3]) / 2, w: r[2] - r[0], d: r[3] - r[1], h: show ? PLH : 0.01, hide: !show };
    const all = under(ci);
    platTags[ci].position.set((r[0] + r[2]) / 2, y + (show ? PLH : 0), r[3]); // the platform's front edge
    platTags[ci].element.firstChild.textContent = `${C[ci].name}, the whole`;
    const nv = all.filter((k) => C[k].virtual).length;
    platTags[ci].element.querySelector("small").textContent = `${all.length - nv} components${nv ? ` · ${nv} folders with no spec` : ""} · ${fmt(all.reduce((a, k) => a + C[k].v[fk], 0))} ${FOOT.find((m) => m.key === fk).unit}`;
    platTags[ci].visible = show;
  }
  FS.hide = !state.split; FS.settled = false;
  paint();
  drawScale(max);
  t0 = performance.now();
}

// Glass is see-through and writes no depth. The shader bakes opacity in when it compiles, so a change recompiles it.
function glass(mat, on) {
  if (mat.transparent !== on) { mat.transparent = on; mat.depthWrite = !on; mat.needsUpdate = true; }
  mat.opacity = on ? 0.22 : 1;
}
function paint() {
  // A label under the pointer previews its click; the selection itself only changes on a click.
  const focus = state.preview ?? state.selected;
  const dark = matchDark();
  const edge = new THREE.Color(dark ? "#ffffff" : "#0b0b0b");
  const sel = new THREE.Color(css("--sel"));
  scene.background = new THREE.Color(css("--surface"));
  ground.material.color.set(css("--ground"));
  const R = [1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Color(css("--r" + i))), bg = new THREE.Color(css("--surface"));
  const add = new THREE.Color(css("--add")), del = new THREE.Color(css("--del")), tmp = new THREE.Color();
  // A file outside the selection fades toward the surface, as a dimmed block fades to 22% opacity.
  for (let i = 0; i < NF; i++) {
    const on = focus == null || focus === FILES[i][0];
    for (const [m, c] of [[fileMesh, R[Math.min(6, Math.max(0, Math.floor(FS.t[i] * 7)))]], [addMesh, add], [delMesh, del]]) { m.setColorAt(i, c); SETS.find((x) => x[0] === m)[1].setColorAt(i, c); }
    if (FS.faded[i] !== (on ? 0 : 1)) { FS.faded[i] = on ? 0 : 1; FS.settled = false; } // re-route this file's box on the next frame
  }
  for (const m of SETS.flat()) { m.instanceColor.needsUpdate = true; m.material.userData.u.uEdge.value.copy(edge); m.material.userData.u.uEdgeA.value = dark ? 0.35 : 0.3; }
  selBox.material.color.copy(sel);
  for (const b of compBlocks) {
    const u = b.userData, on = focus == null || focus === u.ci;
    b.material.color.set(ramp(u.t || 0));
    // Every block but the focus turns to glass, so the routes on the ground show through it.
    glass(b.material, !on);
    const picked = focus === u.ci && !state.file;
    u.edges.material.color.copy(picked ? sel : edge);
    u.edges.material.opacity = picked ? 1 : on ? (dark ? 0.35 : 0.3) : 0.08;
    for (const [m, tok] of [[u.caps.add, "--add"], [u.caps.del, "--del"]]) {
      m.material.color.set(css(tok)); glass(m.material, !on);
      m.children[0].material.color.copy(picked ? sel : edge); m.children[0].material.opacity = picked ? 1 : on ? 0.3 : 0.08;
    }
  }
  for (const p of plinths) if (p) {
    p.material.color.set(css("--plinth"));
    p.userData.edges.material.color.copy(focus === p.userData.ci ? sel : edge);
    p.userData.edges.material.opacity = focus === p.userData.ci ? 1 : dark ? 0.3 : 0.25;
  }
  for (const l of survey) if (l) { const ci = survey.indexOf(l); l.material.color.copy(focus === ci ? sel : edge); l.material.opacity = focus == null || focus === ci ? (dark ? 0.55 : 0.5) : 0.15; }
  outlines.forEach((o, ci) => {
    o.material.color.copy(focus === ci ? sel : edge);
    o.material.opacity = state.split && inScope(ci) ? (focus === ci ? 1 : 0.6) : 0;
  });
  tags.forEach((t, ci) => t.element.classList.toggle("dim", focus != null && focus !== ci));
}
function matchDark() { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
const darkScheme = matchMedia("(prefers-color-scheme: dark)");
darkScheme.addEventListener("change", paint);

let lastMax = 1, dScale = 1;
function drawScale(max) {
  lastMax = max;
  const s = $("scale"), hm = HEIGHT.find((m) => m.key === state.height);
  s.innerHTML = "";
  s.append(el("div", null, `Height and color: ${hm.unit} per ${state.split ? "file" : "component"}`));
  const r = el("div", "ramp"); for (let i = 1; i <= 7; i++) { const x = el("i"); x.style.background = css("--r" + i); r.append(x); }
  const e = el("div", "ends"); e.append(el("span", null, "0"), el("span", null, fmt(max)));
  s.append(r, e, el("div", null, `Tallest block = ${fmt(max)}. A flat slab changed not at all.`));
  if (DIFF) {
    const g = el("div"); const a = el("span", "sw"); a.style.background = css("--add"); const d = el("span", "sw"); d.style.background = css("--del");
    g.append(a, "lines added  ", d, "lines deleted");
    s.append(el("div", null, `Meters: the diff ${DIFF.a.sha} → ${DIFF.b.sha}`), g, el("div", null, `tallest meter = ${fmt(dScale)} lines; numbers in the callouts`));
  }
}

// ---------- reliance ----------
// From Scope's model: component A uses symbols of component B at so many sites. Listed in the side column; the load
// a component carries is the Leaned on footprint.
const RELY = D.relies ?? [];

// ---------- animation ----------
let t0 = performance.now();
const ease = (t) => 1 - Math.pow(1 - t, 3);
function step() {
  const k = ease(Math.min(1, (performance.now() - t0) / 700));
  stepFiles(k);
  for (const b of [...compBlocks, ...plinths.filter(Boolean)]) {
    const u = b.userData; if (!u.to) continue;
    const c = u.cur, to = u.to;
    const lerp = (a, b) => a + (b - a) * k;
    const x = lerp(c.x, to.x), z = lerp(c.z, to.z), w = lerp(c.w, to.w), d = lerp(c.d, to.d), h = lerp(c.h, to.h);
    const y = lerp(c.y ?? 0, to.y ?? 0);
    b.position.set(x, y, z); b.scale.set(w, h, d);
    b.visible = !(to.hide && k >= 1);
    if (to.hide && k < 1) b.visible = c.h > 0.02;
    if (k >= 1 && !u.caps) u.cur = { ...to };
    if (!u.caps) continue;
    const ca = lerp(u.capCur.a, u.capTo.a), cd = lerp(u.capCur.d, u.capTo.d);
    // Two thin meters at the centre of the top face, the same width on every block so only their height is read.
    const mw = Math.min(1.4, w * 0.3), mz = z;
    u.caps.add.position.set(x - mw * 0.55, y + h, mz); u.caps.add.scale.set(mw, Math.max(0.01, ca), mw); u.caps.add.visible = ca > 0.02;
    u.caps.del.position.set(x + mw * 0.55, y + h, mz); u.caps.del.scale.set(mw, Math.max(0.01, cd), mw); u.caps.del.visible = cd > 0.02;
    if (k >= 1) { u.cur = { ...to }; u.capCur = { ...u.capTo }; }
  }
}
function stepFiles(k) {
  if (!FS.settled) {
    const [[M, gM], [A, gA], [Dl, gD]] = SETS.map(([m, g]) => [m.instanceMatrix.array, g.instanceMatrix.array]);
    const put = (arr, i, x, y, z, w, h, d) => { const o = i * 16; arr[o] = w; arr[o + 5] = h; arr[o + 10] = d; arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1; };
    for (let i = 0; i < NF; i++) {
      const o = i * 6, c = FS.cur, t = FS.to, n = FS.now;
      for (let j = 0; j < 6; j++) n[o + j] = c[o + j] + (t[o + j] - c[o + j]) * k;
      const [x, y, z, w, d, h] = [n[o], n[o + 1], n[o + 2], n[o + 3], n[o + 4], n[o + 5]];
      const ca = FS.capCur[i * 2] + (FS.capTo[i * 2] - FS.capCur[i * 2]) * k, cd = FS.capCur[i * 2 + 1] + (FS.capTo[i * 2 + 1] - FS.capCur[i * 2 + 1]) * k;
      FS.capNow[i * 2] = ca; FS.capNow[i * 2 + 1] = cd;
      // Each box is drawn solid or see-through, never both: the other set holds a zero-size box in its place.
      const f = FS.faded[i], on = (arr, ghost) => (f ? ghost : arr), off = (arr, ghost) => (f ? arr : ghost);
      put(on(M, gM), i, x, y, z, w, h, d); put(off(M, gM), i, x, y, z, 0, 0, 0);
      const mw = Math.min(0.7, w * 0.4); // the same meters as for components, sized to a file
      put(on(A, gA), i, x - mw * 0.55, y + h, z, ca > 0.02 ? mw : 0, ca, ca > 0.02 ? mw : 0); put(off(A, gA), i, x, y, z, 0, 0, 0);
      put(on(Dl, gD), i, x + mw * 0.55, y + h, z, cd > 0.02 ? mw : 0, cd, cd > 0.02 ? mw : 0); put(off(Dl, gD), i, x, y, z, 0, 0, 0);
    }
    for (const m of SETS.flat()) { m.instanceMatrix.needsUpdate = true; m.visible = !(FS.hide && k >= 1); }
    if (k >= 1) { FS.cur.set(FS.to); FS.capCur.set(FS.capTo); FS.settled = true; for (const m of SETS.flat()) { m.boundingSphere = null; m.boundingBox = null; } }
  }
  // The selected file wears an outline the colour of a selection, over its block and its caps.
  const f = state.split && state.file ? fileAt[state.file[0]][state.file[1]] : -1;
  selBox.visible = f >= 0;
  if (f >= 0) { const n = FS.now, o = f * 6; selBox.position.set(n[o], n[o + 1], n[o + 2]); selBox.scale.set(n[o + 3] + 0.05, n[o + 5] + Math.max(FS.capNow[f * 2], FS.capNow[f * 2 + 1]) + 0.05, n[o + 4] + 0.05); }
}
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
const resizing = new ResizeObserver(resize);
resizing.observe(stage);
function frame() {
  if (disposed) return;
  // Freeze the start of each tween at the current values before targets change.
  if (camTween) {
    const k = ease(Math.min(1, (performance.now() - camTween.t0) / 700));
    camera.position.lerpVectors(camTween.from.pos, camTween.to.pos, k); controls.target.lerpVectors(camTween.from.target, camTween.to.target, k);
    const S = camTween.from.S + (camTween.to.S - camTween.from.S) * k; world.scale.set(S, 1, S); world.position.lerpVectors(camTween.from.off, camTween.to.off, k);
    if (k >= 1) camTween = null;
  }
  // Drawing stops while the view is not on the page and starts again when it is mounted.
  if (!root.isConnected) { running = false; return; }
  step(); stepGlows(); controls.update(); renderer.render(scene, camera); placeCallouts();
  raf = requestAnimationFrame(frame);
}
// Callouts stack in two columns at the edges of the viewport, each on the side its point is, in their points'
// top-to-bottom order so no two hairlines cross. Where a column is full, the biggest footprints keep their names;
// platforms outrank what stands on them, and the selection always shows.
// Platforms, the selection and what the pointer is on always carry a name; beyond them, only the biggest few per side.
let hovered = null;
const NAMED = 8;
const leaders = $("leaders"), SVGNS = "http://www.w3.org/2000/svg", LGAP = 4, EDGE = 10;
let LH = 30;
const _v = new THREE.Vector3();
function placeCallouts() {
  LH = DIFF ? 44 : 30; // a callout carrying the diff's numbers is a line taller
  const W = stage.clientWidth, H = stage.clientHeight, fk = state.split ? "lines" : state.foot;
  const crumbs = $("crumbs").getBoundingClientRect(), scale = $("scale").getBoundingClientRect(), sb = stage.getBoundingClientRect();
  const lane = { l: [crumbs.bottom - sb.top + 8, scale.top - sb.top - 8], r: [EDGE, H - EDGE] };
  const cand = [];
  for (const o of [...tags, ...platTags.filter(Boolean)]) {
    o.element.style.display = "none";
    if (!o.visible) continue;
    o.getWorldPosition(_v).project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) continue;
    const ax = (_v.x + 1) / 2 * W, ay = (1 - _v.y) / 2 * H;
    const rank = (o.ci === state.selected ? 1e12 : 0) + (o.kind === "plat" ? 1e9 / (1 + level[o.ci]) : 0) + (C[o.ci].v[fk] || 0) / (totals[fk] || 1) * 1e6;
    // A label keeps its side until its point is well past the middle, so a block near the centre line can't judder between columns.
    if (!o.side || Math.abs(ax - W / 2) > W * 0.08) o.side = ax < W / 2 ? "l" : "r";
    cand.push({ o, ax, ay, side: o.side, rank });
  }
  const paths = [];
  for (const side of ["l", "r"]) {
    const [top, bottom] = lane[side], room = Math.max(0, Math.floor((bottom - top + LGAP) / (LH + LGAP)));
    const mine = cand.filter((c) => c.side === side).sort((a, b) => b.rank - a.rank);
    // What an agent is touching right now always carries its name, so the reader sees where the work is.
    const must = (c) => c.o.kind === "plat" || c.o.ci === state.selected || (c.o.kind === "comp" && (c.o.ci === hovered || litNow.has(c.o.ci)));
    const rest = mine.filter((c) => !must(c)).slice(0, NAMED);
    const kept = mine.filter((c) => must(c) || rest.includes(c)).slice(0, room).sort((a, b) => a.ay - b.ay);
    // Each label sits as near its point's height as the column allows: pushed down past its neighbour, then up off the floor.
    kept.forEach((c, i) => { c.y = Math.max(Math.min(Math.max(top, c.ay - LH / 2), bottom - LH), i ? kept[i - 1].y + LH + LGAP : top); });
    for (let i = kept.length - 1; i >= 0; i--) kept[i].y = Math.min(kept[i].y, i < kept.length - 1 ? kept[i + 1].y - LH - LGAP : bottom - LH);
    for (const c of kept) {
      const e = c.o.element; e.style.display = "block"; e.classList.toggle("r", side === "r");
      e.style.top = c.y + "px"; e.style.left = side === "l" ? EDGE + "px" : ""; e.style.right = side === "r" ? EDGE + "px" : "";
      const w = e.offsetWidth, lx = side === "l" ? EDGE + w + 2 : W - EDGE - w - 2;
      paths.push([lx, c.y + LH / 2, c.ax, c.ay, c.o.ci === (state.preview ?? state.selected), side]);
    }
  }
  const key = paths.map((q) => q.map((v) => (typeof v === "number" ? v.toFixed(1) : v)).join(",")).join(";");
  if (key === leaders.dataset.key) return;
  leaders.dataset.key = key; leaders.replaceChildren();
  // Each hairline leaves its label flat and turns at 45° for the last stretch, so most of the ink runs in parallel.
  for (const [x1, y1, x2, y2, on, side] of paths) {
    const dy = Math.abs(y2 - y1), kx = side === "l" ? Math.max(x1 + 12, x2 - dy) : Math.min(x1 - 12, x2 + dy);
    const l = document.createElementNS(SVGNS, "polyline"); l.setAttribute("points", `${x1},${y1} ${kx},${y1} ${x2},${y2}`);
    if (on) { l.style.stroke = "var(--sel)"; l.style.opacity = 1; }
    const d = document.createElementNS(SVGNS, "circle"); d.setAttribute("cx", x2); d.setAttribute("cy", y2); d.setAttribute("r", 1.6);
    leaders.append(l, d);
  }
}
function retarget() {
  for (const p of plinths) if (p) p.userData.cur = { x: p.position.x, y: p.position.y, z: p.position.z, w: p.scale.x, d: p.scale.z, h: p.scale.y };
  FS.cur.set(FS.now); FS.capCur.set(FS.capNow);
  for (const b of compBlocks) {
    const u = b.userData;
    u.cur = { x: b.position.x, y: b.position.y, z: b.position.z, w: b.scale.x, d: b.scale.z, h: b.scale.y };
    u.capCur = { a: u.caps.add.visible ? u.caps.add.scale.y : 0, d: u.caps.del.visible ? u.caps.del.scale.y : 0 };
  }
  layout();
}

// The component a path belongs to: the one holding it as a counted file, else the deepest folder holding it.
const fileIndex = new Map(); C.forEach((c, ci) => c.files.forEach((f, fi) => fileIndex.set(f.file, [ci, fi])));
function componentOfPath(path) {
  let best = -1, len = -1;
  C.forEach((c, ci) => { const l = c.folder === "." ? 0 : c.folder.length; if ((c.folder === "." || path === c.folder || path.startsWith(c.folder + "/")) && l > len) { best = ci; len = l; } });
  return best;
}
const compGlow = C.map(() => null);
function haloOf(ci) {
  if (compGlow[ci]) return compGlow[ci];
  const m = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0x000000 }));
  m.add(new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0x000000 })));
  m.renderOrder = 4; world.add(m); compGlow[ci] = m; return m;
}
function touch(touches) {
  const now = performance.now();
  for (const t of touches) {
    const kind = t.kind === "write" ? "write" : "read";
    for (const path of t.files) {
      const hit = fileIndex.get(path), ci = hit ? hit[0] : componentOfPath(path);
      if (ci < 0) continue;
      // A write outranks a read still glowing on the same block.
      const put = (key, g) => { const was = glows.get(key); if (!was || kind === "write" || was.kind === "read") glows.set(key, g); else was.t0 = now; };
      put(String(ci), { ci, fi: -1, kind, t0: now });
      if (hit) put(`${ci}:${hit[1]}`, { ci, fi: hit[1], kind, t0: now });
      logActivity(kind, path, C[ci], t.session);
    }
  }
}
const activity = $("activity");
function logActivity(kind, path, c, session) {
  const li = el("li", kind);
  li.append(el("b", null, kind === "write" ? "wrote" : "read"), " ", el("code", null, path), el("span", null, ` · ${c.virtual ? c.name : c.name}${session ? " · " + session.slice(0, 8) : ""}`));
  activity.prepend(li);
  while (activity.children.length > 6) activity.lastChild.remove();
  later(() => li.classList.add("gone"), 12000);
  later(() => li.remove(), 13000);
}
// Each frame: every glow fades by its age; a glow past its life is dropped.
const _gc = new THREE.Color();
function stepGlows() {
  const now = performance.now(), a = fileGlow.instanceMatrix.array, lit = new Set(), pop = new Map(); // ci → [colour, strength] for its label
  let filesDirty = false;
  for (const ci of C.keys()) compBlocks[ci].material.emissive?.setRGB(0, 0, 0);
  for (const [key, g] of glows) {
    const spec = GLOW[g.kind], age = (now - g.t0) / spec.life;
    if (age >= 1) { glows.delete(key); if (g.fi >= 0) { const i = fileAt[g.ci][g.fi], o = i * 16; a[o] = a[o + 5] = a[o + 10] = 0; fileGlow.setColorAt(i, _gc.setRGB(0, 0, 0)); filesDirty = true; } continue; }
    // A quick flare, then a long ease out.
    const k = Math.min(1, age * 12) * Math.pow(1 - age, 1.6);
    if (!pop.has(g.ci) || pop.get(g.ci)[1] < k) pop.set(g.ci, [spec.color, k]);
    if (g.fi < 0) {
      lit.add(g.ci);
      const b = compBlocks[g.ci], h = haloOf(g.ci), on = b.visible && !state.split;
      h.visible = on;
      if (!on) continue;
      const pad = 0.5 + 1.5 * (1 - age);
      h.position.copy(b.position).y -= 0.05; h.scale.set(b.scale.x + pad, b.scale.y + pad, b.scale.z + pad);
      h.material.color.copy(spec.color).multiplyScalar(0.18 * k); h.children[0].material.color.copy(spec.color).multiplyScalar(k);
      b.material.emissive?.copy(spec.color).multiplyScalar(0.55 * k);
    } else if (state.split) {
      const i = fileAt[g.ci][g.fi], n = FS.now, o6 = i * 6, o = i * 16, pad = 0.12 + 0.5 * (1 - age);
      a[o] = n[o6 + 3] + pad; a[o + 5] = n[o6 + 5] + pad; a[o + 10] = n[o6 + 4] + pad; a[o + 12] = n[o6]; a[o + 13] = n[o6 + 1] - 0.05; a[o + 14] = n[o6 + 2]; a[o + 15] = 1;
      fileGlow.setColorAt(i, _gc.copy(spec.color).multiplyScalar(0.9 * k));
      filesDirty = true;
    }
  }
  for (const [ci, h] of compGlow.entries()) if (h && !lit.has(ci)) h.visible = false;
  if (filesDirty || glows.size) { fileGlow.instanceMatrix.needsUpdate = true; fileGlow.instanceColor.needsUpdate = true; }
  fileGlow.visible = state.split;
  // A touched component's label takes a dark shade of the glow's colour, fading with it.
  for (const t of tags) {
    const p = pop.get(t.ci), e = t.element;
    if (!p) { if (e.dataset.lit) { e.style.background = ""; e.style.color = ""; delete e.dataset.lit; } continue; }
    const [c, k] = p;
    e.dataset.lit = "1";
    // A dark shade of the glow's colour behind the label's own text, easing back to the plain label as the glow fades.
    const d = (v) => Math.round(v * 255 * 0.32);
    e.style.background = `color-mix(in srgb, rgb(${d(c.r)}, ${d(c.g)}, ${d(c.b)}) ${Math.round(100 * Math.min(1, k * 1.4))}%, color-mix(in srgb, var(--surface) 82%, transparent))`;
  }
  litNow = lit;
}
let litNow = new Set();

// ---------- hover and click ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $("tip");
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const live = [...(state.split ? SETS.flat() : compBlocks.flatMap((b) => [b, b.userData.caps.add, b.userData.caps.del])), ...plinths.filter(Boolean)].filter((b) => b.visible);
  const hit = ray.intersectObjects(live, false)[0];
  if (!hit) return null;
  if (hit.instanceId != null) { const [ci, fi] = FILES[hit.instanceId]; return { kind: "file", ci, fi }; }
  return hit.object.userData;
}
let down = null;
renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointermove", (e) => {
  const u = pick(e);
  renderer.domElement.style.cursor = u ? "pointer" : "grab";
  hovered = u ? u.ci : null;
  if (!u) { tip.style.display = "none"; return; }
  tip.innerHTML = ""; const c = C[u.ci], hm = HEIGHT.find((m) => m.key === state.height), w = WIN.find((x) => x.key === state.win);
  if (u.kind === "plinth") {
    const fk = state.split ? "lines" : state.foot, fm = FOOT.find((m) => m.key === fk), all = under(u.ci);
    tip.append(el("b", null, `${c.name}, the whole`), el("div", "k", `the platform under the ${all.length - 1} components inside ${c.folder === "." ? "the repository" : c.folder}, and ${poss(c.name)} own files`));
    const r1 = el("div", "row"); r1.append(el("span", null, fm.label), el("span", null, fmt(all.reduce((a, k) => a + C[k].v[fk], 0))));
    const r2 = el("div", "row"); r2.append(el("span", null, `Lines changed, ${w.label.toLowerCase()}`), el("span", null, fmt(all.reduce((a, k) => a + CH.comp[k].volume, 0))));
    tip.append(r1, r2);
    if (DIFF) { const r3 = el("div", "row"); r3.append(el("span", null, `Diff ${DIFF.a.sha} → ${DIFF.b.sha}`), signed(all.reduce((a, k) => a + DIFF.comp[k][0], 0), all.reduce((a, k) => a + DIFF.comp[k][1], 0))); tip.append(r3); }
    tip.append(el("div", "k", "its size is what stands on it plus a margin, not a measure"));
  } else if (u.kind === "comp") {
    const fm = FOOT.find((m) => m.key === state.foot);
    tip.append(el("b", null, c.name), el("div", "k", c.virtual ? `${c.folder} · a folder with no spec, inside ${C[parent[u.ci]].name}` : c.folder === "." ? "root · the files no other component claims" : c.folder + (parent[u.ci] >= 0 ? ` · inside ${C[parent[u.ci]].name}` : "")));
    const r1 = el("div", "row"); r1.append(el("span", null, `Footprint: ${fm.label.toLowerCase()}`), el("span", null, `${fmt(c.v[fm.key])} · ${pct(c.v[fm.key] / totals[fm.key])}`));
    const r2 = el("div", "row"); r2.append(el("span", null, `Height: ${hm.label.toLowerCase()}, ${w.label.toLowerCase()}`), el("span", null, fmt(CH.comp[u.ci][hm.key])));
    tip.append(r1, r2);
    if (DIFF) { const r3 = el("div", "row"); r3.append(el("span", null, `Diff ${DIFF.a.sha} → ${DIFF.b.sha}`), signed(...DIFF.comp[u.ci])); tip.append(r3); }
    tip.append(el("div", "k", "click for the files and landings"));
  } else {
    const f = c.files[u.fi], fc = CH.file[u.ci][u.fi];
    tip.append(el("b", null, f.file), el("div", "k", c.name));
    const r1 = el("div", "row"); r1.append(el("span", null, "Footprint: lines"), el("span", null, fmt(f.lines)));
    const r2 = el("div", "row"); r2.append(el("span", null, `Landings, ${w.label.toLowerCase()}`), el("span", null, fmt(fc.landings)));
    const r3 = el("div", "row"); r3.append(el("span", null, "Lines changed"), el("span", null, fmt(fc.volume)));
    tip.append(r1, r2, r3);
    if (DIFF) { const r4 = el("div", "row"); r4.append(el("span", null, `Diff ${DIFF.a.sha} → ${DIFF.b.sha}`), signed(...DIFF.file[u.ci][u.fi])); tip.append(r4); }
    tip.append(el("div", "k", f.reached ? `reached by ${f.reached} enforcement site${f.reached > 1 ? "s" : ""}` : "unreached by mass"));
  }
  tip.style.display = "block";
  const x = Math.min(innerWidth - tip.offsetWidth - 12, e.clientX + 14), y = Math.min(innerHeight - tip.offsetHeight - 12, e.clientY + 14);
  tip.style.left = x + "px"; tip.style.top = y + "px";
});
renderer.domElement.addEventListener("pointerleave", () => { tip.style.display = "none"; hovered = null; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const u = pick(e);
  if (!u) { state.selected = null; state.file = null; }
  else { state.selected = u.ci; state.file = u.kind === "file" ? [u.ci, u.fi] : null; }
  paint(); drawSide();
});

// Double-click steps into a platform or block, so only that slice stands; double-click empty ground, or Esc, steps out.
function rescope(ci, own = false) {
  if (ci == null || (ci === state.scope && own === state.own)) return;
  state.scope = ci; state.own = own && kids[ci].length > 0; state.selected = null; state.file = null; tip.style.display = "none";
  retarget(); aim(); drawSide(); drawTable(); drawNote(); drawCrumbs();
}
// One step out: from a component's own files to the whole component, from a component to the platform it stands on.
const stepOut = () => (state.own ? rescope(state.scope, false) : parent[state.scope] >= 0 && rescope(parent[state.scope]));
renderer.domElement.addEventListener("dblclick", (e) => {
  const u = pick(e);
  if (!u) { stepOut(); return; }
  // A platform steps into the whole component; a block of a component's own files steps into those files alone.
  rescope(u.ci, u.kind !== "plinth" && kids[u.ci].length > 0);
});
const onKey = (e) => { if (e.key === "Escape" && root.isConnected && !(e.target instanceof HTMLInputElement)) stepOut(); };
document.addEventListener("keydown", onKey);
function drawCrumbs() {
  const b = $("crumbs"); b.innerHTML = "";
  const chain = []; for (let p = state.scope; p >= 0; p = parent[p]) chain.unshift(p);
  chain.forEach((ci, i) => {
    if (i) b.append(" › ");
    if (ci === state.scope && !state.own) b.append(el("b", null, C[ci].name));
    else { const a = el("a", null, C[ci].name); a.onclick = () => rescope(ci); b.append(a); }
  });
  if (state.own) b.append(" › ", el("b", null, "own files"));
  b.append(el("small", null, parent[state.scope] >= 0 || state.own ? "Double-click to step in · double-click the ground or Esc to step out" : "Double-click a platform or block to step into it"));
}

// ---------- controls ----------
function buttons(id, list, key, after) {
  const g = $(id);
  for (const m of list) {
    const b = el("button", null, m.label); b.dataset.k = m.key;
    b.onclick = () => { state[key] = m.key; sync(); after(); };
    if (key === "foot" && !totals[m.key]) { b.disabled = true; b.title = `No ${m.unit} recorded anywhere`; }
    g.append(b);
  }
}
buttons("gFoot", FOOT, "foot", () => { if (state.split) state.split = false; sync(); retarget(); drawSide(); drawTable(); drawNote(); });
buttons("gHeight", HEIGHT, "height", () => { retarget(); drawSide(); drawTable(); });
buttons("gWin", WIN, "win", () => { retarget(); drawSide(); drawTable(); drawNote(); });
buttons("gSplit", [{ key: false, label: "Components" }, { key: true, label: "Files" }], "split", () => { retarget(); drawSide(); drawNote(); });
function sync() {
  for (const [id, key] of [["gFoot", "foot"], ["gHeight", "height"], ["gWin", "win"], ["gSplit", "split"]])
    for (const b of $(id).querySelectorAll("button")) {
      const on = key === "foot" && state.split ? b.dataset.k === "lines" : String(state[key]) === b.dataset.k;
      b.setAttribute("aria-pressed", on);
    }
}

// ---------- side column ----------
function drawSide() {
  const s = $("side"); s.innerHTML = "";
  const hm = HEIGHT.find((m) => m.key === state.height), w = WIN.find((x) => x.key === state.win);
  const fk = state.split ? "lines" : state.foot, fm = FOOT.find((m) => m.key === fk);
  if (state.selected == null) {
    s.append(el("h2", null, state.own ? `${poss(C[state.scope].name)} own files` : parent[state.scope] >= 0 ? `Inside ${C[state.scope].name}` : "All components"), el("p", "intent", `Ranked by height: ${hm.label.toLowerCase()}, ${w.label.toLowerCase()}. Click a block or a name.`));
    const g = el("div", "rank"); g.append(el("span", "h", "Component"), el("span", "h", fm.label), el("span", "h", hm.label));
    C.map((c, ci) => [c, ci]).filter(([, ci]) => inScope(ci)).sort((a, b) => CH.comp[b[1]][hm.key] - CH.comp[a[1]][hm.key]).forEach(([c, ci]) => {
      const n = el("span", "nm", kids[ci].length ? `${poss(c.name)} own files` : c.name); n.onclick = () => { state.selected = ci; paint(); drawSide(); };
      g.append(n, el("span", null, fmt(c.v[fk])), el("span", null, fmt(CH.comp[ci][hm.key])));
    });
    s.append(g); return;
  }
  const ci = state.selected, c = C[ci];
  if (parent[ci] >= 0) { const up = el("div", "m"); const a = el("span", "nm", C[parent[ci]].name); a.style.cursor = "pointer"; a.style.textDecoration = "underline"; a.onclick = () => { state.selected = parent[ci]; state.file = null; paint(); drawSide(); }; up.append("inside ", a); s.append(up); }
  s.append(el("h2", null, c.name), el("p", "intent", c.virtual ? `A folder with no spec of its own. Mass counts it in ${poss(C[parent[ci]].name)} own files; here it stands as its own district, so the unclaimed land shows its shape.` : c.intent), el("div", "m", c.virtual ? c.folder : c.spec));
  if (kids[ci].length) {
    const nv = kids[ci].filter((k) => C[k].virtual).length;
    s.append(el("h3", null, `Inside ${c.name}: ${kids[ci].length - nv} components${nv ? `, ${nv} folders with no spec` : ""}`));
    const kl = el("ul", "items");
    for (const k of kids[ci]) { const li = el("li", "click"); li.append(el("span", null, C[k].name), el("span", "m", ` ${C[k].folder} · ${fmt(C[k].v[fk])} ${fm.unit}`)); li.onclick = () => { state.selected = k; state.file = null; paint(); drawSide(); }; kl.append(li); }
    s.append(kl, el("h3", null, `${poss(c.name)} own files`));
  }
  const nums = el("div", "nums");
  for (const m of FOOT) { const d = el("div", m.key === fk ? "cur" : null); d.append(el("div", "n", fmt(c.v[m.key])), el("div", "k", `${m.label} · ${pct(c.v[m.key] / totals[m.key])}`)); nums.append(d); }
  for (const m of HEIGHT) { const d = el("div", m.key === hm.key ? "cur" : null); d.append(el("div", "n", fmt(CH.comp[ci][m.key])), el("div", "k", `${m.label} · ${w.label.toLowerCase()}`)); nums.append(d); }
  if (DIFF) { const d = el("div"); const n = el("div", "n"); n.append(signed(...DIFF.comp[ci])); d.append(n, el("div", "k", `diff ${DIFF.a.sha} → ${DIFF.b.sha}`)); nums.append(d); }
  s.append(nums);
  if (RELY.length) for (const [title, mine, other] of [["Leans on", 0, 1], ["Leaned on by", 1, 0]]) {
    const list = RELY.filter((e) => e[mine] === ci).sort((a, b) => b[2] - a[2]);
    if (!list.length) continue;
    s.append(el("h3", null, `${title}: ${list.length}`));
    const u = el("ul", "items");
    for (const e of list) {
      const li = el("li", "click"); li.append(el("span", null, C[e[other]].name), el("span", "m", ` ${fmt(e[2])} sites · ${e[4].map((x) => x[0]).slice(0, 4).join(", ")}`));
      li.onclick = () => { state.selected = e[other]; state.file = null; paint(); drawSide(); };
      li.onmouseenter = () => { state.preview = e[other]; paint(); }; li.onmouseleave = () => { state.preview = null; paint(); };
      u.append(li);
    }
    s.append(u);
  }
  if (state.file && state.file[0] === ci) {
    const f = c.files[state.file[1]], fc = CH.file[ci][state.file[1]];
    s.append(el("h3", null, "Selected file"));
    const u = el("ul", "items"); const li = el("li"); li.append(el("code", null, f.file), el("div", "m", `${fmt(f.lines)} lines · ${fc.landings} landings · ${fmt(fc.volume)} lines changed · ${f.reached ? "reached by " + f.reached : "unreached"}`)); u.append(li); s.append(u);
  }
  s.append(el("h3", null, `Files by ${hm.label.toLowerCase()}, ${w.label.toLowerCase()}`));
  const fl = el("ul", "items");
  c.files.map((f, fi) => [f, fi]).sort((a, b) => CH.file[ci][b[1]][hm.key] - CH.file[ci][a[1]][hm.key] || b[0].lines - a[0].lines).slice(0, 25).forEach(([f, fi]) => {
    const li = el("li", "click"); li.append(el("code", null, f.file), el("div", "m", `${fmt(f.lines)} lines · ${CH.file[ci][fi].landings} landings · ${fmt(CH.file[ci][fi].volume)} changed`));
    if (DIFF && (DIFF.file[ci][fi][0] || DIFF.file[ci][fi][1])) { const m = el("div", "m"); m.append("diff ", signed(...DIFF.file[ci][fi])); li.append(m); }
    li.onclick = () => { state.split = true; state.file = [ci, fi]; sync(); retarget(); drawSide(); drawNote(); };
    fl.append(li);
  });
  if (c.files.length > 25) fl.append(el("li", "m", `and ${c.files.length - 25} more`));
  s.append(fl);
  const list = CH.comp[ci].list;
  s.append(el("h3", null, `${list.length} landings, ${w.label.toLowerCase()}`));
  const ll = el("ul", "items");
  for (const [l, v] of list.slice(0, 60)) { const li = el("li"); li.append(el("div", null, l.subject), el("div", "m", `${l.date} · ${l.sha.slice(0, 7)} · ${fmt(v)} lines here · ${l.n} files in all`)); ll.append(li); }
  if (list.length > 60) ll.append(el("li", "m", `and ${list.length - 60} more`));
  s.append(ll);
}

function drawTable() {
  const t = el("table"), hr = el("tr");
  const hm = HEIGHT.find((m) => m.key === state.height), w = WIN.find((x) => x.key === state.win);
  for (const [lab, k] of [["Component"], ...FOOT.map((m) => [m.label, m.key]), ...HEIGHT.map((m) => [`${m.label} (${w.label.toLowerCase()})`, "h:" + m.key])]) { const th = el("th", k === state.foot || k === "h:" + hm.key ? "cur" : null, lab); hr.append(th); }
  t.append(hr);
  C.forEach((c, ci) => {
    if (!inScope(ci)) return;
    const r = el("tr"); r.append(el("td", null, c.name));
    for (const m of FOOT) r.append(el("td", m.key === state.foot ? "cur" : null, fmt(c.v[m.key])));
    for (const m of HEIGHT) r.append(el("td", m.key === hm.key ? "cur" : null, fmt(CH.comp[ci][m.key])));
    t.append(r);
  });
  const box = $("table"); box.innerHTML = ""; box.append(t);
}

function drawNote() {
  const n = $("note"), fm = FOOT.find((m) => m.key === (state.split ? "lines" : state.foot)), w = WIN.find((x) => x.key === state.win);
  const inWin = D.landings.filter((l) => l.date >= w.from).length, bigIn = D.landings.filter((l) => l.date >= w.from && l.n > BIG);
  n.innerHTML = "";
  const ul = el("ul");
  const items = [
    ...D.notes,
    ...(DIFF ? [`Diff: ${DIFF.a.sha} (${DIFF.a.date}, ${DIFF.a.subject}) → ${DIFF.b.sha} (${DIFF.b.subject}), from git diff --numstat, standing on each block as two thin meters, green for lines added and red for lines deleted, on one scale for the whole view (the tallest meter is the biggest change in view) and the same width on every block, so only their height is read. The numbers ride in each component's callout. Height stays the window's churn and the diff adds nothing to it. Components count every path in their folder; files count only the files mass counts. ${DIFF.gone} deleted path${DIFF.gone === 1 ? "" : "s"} with no block here ${DIFF.gone === 1 ? "is" : "are"} left out.`] : []),
    `One block is one component${state.split ? ", split into one block per file it owns; file footprints are lines" : ""}. Snapshot: ${D.snapshot}.`,
    `Footprint: ${fm.label.toLowerCase()}, ${fm.how}. Every measure shares the same total area, so a footprint is that component's share; area, not side, is the quantity.`,
    `Height and color: ${HEIGHT.map((m) => m.label.toLowerCase() + " = " + m.how).join("; ")}. ${inWin - (state.big ? 0 : bigIn.length)} landings count in this window (${w.from === "0000" ? "from " + (D.landings.at(-1)?.date ?? LATEST) : "from " + w.from} to ${LATEST}). In component view, a landing counts toward every component it touches, tests and specs included; in file view, only the files mass counts.`,
    state.big ? `Landings over ${BIG} files are included (${bigIn.length} in this window). ${D.project ? "Bulk moves like these tower over everything else." : "The rebuild merge of 2026-09-23 alone changed 322,695 lines across 582 files, and it towers over everything else."}` : `Left out of heights: the ${bigIn.length} landing${bigIn.length === 1 ? "" : "s"} in this window that touch${bigIn.length === 1 ? "es" : ""} more than ${BIG} files${bigIn.length ? " (" + bigIn.slice(0, 3).map((l) => l.subject.slice(0, 48)).join("; ") + (bigIn.length > 3 ? "; …" : "") + ")" : ""}. Bulk moves like these touch every component at once and say nothing about any one of them; ordinary merged pull requests stay in.`,
    `Position: components that land together sit closer. Distance comes from the co-change share (landings touching both ÷ landings touching either) over all ${D.landings.length} landings with 40 or fewer files, settled by a force layout and then spaced so no footprint overlaps at its largest. Read it as neighbourhoods, not measured distances; it doesn't change with the window or measure.`,
    ...(D.unrun ? [`No run has graded these specs yet, so no enforcement reaches any file: Unreached equals Lines, and Refutations and Defects are zero everywhere. Invariants and Crossings count the bullets the specs declare.`] : []),
    ...(C.some((c) => c.virtual) ? [`Folders with no spec: inside a component that holds other components, the code none of them claims is split by the folder that holds it (three code files or more), and each folder stands as a district with an italic name and a dashed survey line. A folder holding most of that code is opened into its subfolders. A district has no invariants, so on the Invariants footprint the unclaimed land disappears. Mass counts a district in its component's own files; files loose in the component's folder stay in its own block.`] : []),
    `Nesting: a component whose folder sits inside another component's folder stands on that component's platform. Platforms here: ${C.filter((_, ci) => kids[ci].length).map((c) => c.name).join(", ")}. The block marked as a component's own files holds what none of the components inside it claims. A platform spans what stands on it plus a ${MARGIN}-unit margin, so its size is not a measure.`,
    `Left out: ${D.leaveOut.join(", ")}. The root component holds every path outside the other ${C.length - 1} component folders${D.project ? "" : " (docs/, plugins/, bench/, mods/, top-level files), so its height includes pre-rebuild history in the All window"}.`,
  ];
  for (const s of items) ul.append(el("li", null, s));
  n.append(ul);
}

// ---------- diff overlay, when served beside git ----------
const signed = (a, d) => { const x = el("span"); x.append(el("span", "add", "+" + fmt(a)), " ", el("span", "del", "−" + fmt(d))); return x; };
function ownerOf(p) { let best = 0, len = -1; C.forEach((c, i) => { if (c.folder !== "." && (p === c.folder || p.startsWith(c.folder + "/")) && c.folder.length > len) { best = i; len = c.folder.length; } }); return best; }
async function loadDiff(a, b) {
  if (!a || !b || a === "none") { DIFF = null; retarget(); drawSide(); drawNote(); return; }
  let d;
  try { d = await io.get(`/api/relief/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`); } catch { if (disposed) return; DIFF = null; retarget(); drawSide(); drawNote(); return; }
  // An answer that arrives after the scene was disposed lands nowhere.
  if (disposed) return;
  if (d.error) { DIFF = null; return; }
  // Per component and per file: [added, deleted]. The diff lists only the paths that changed; any other stays [0, 0].
  const comp = C.map(() => [0, 0]), file = C.map((c) => c.files.map(() => [0, 0]));
  const at = new Map(); C.forEach((c, ci) => c.files.forEach((f, fi) => at.set(f.file, [ci, fi])));
  let gone = 0;
  for (const f of d.files) {
    if (!f.add && !f.del) continue;
    const ci = ownerOf(f.path), hit = at.get(f.path);
    comp[ci][0] += f.add; comp[ci][1] += f.del;
    if (hit) { file[hit[0]][hit[1]][0] += f.add; file[hit[0]][hit[1]][1] += f.del; } else if (f.gone) gone++;
  }
  DIFF = { a: d.a, b: d.b, comp, file, gone };
  for (const [id, end] of [["selA", d.a], ["selB", d.b]]) for (const o of $(id).options) if (o.dataset.linked && o.value === end.rev) o.textContent = `${end.date} ${end.sha} ${end.subject.slice(0, 52)}`;
  retarget(); drawSide(); drawNote();
}
async function startDiff() {
  if (!io.get) return;
  let cm; try { cm = await io.get("/api/relief/commits"); } catch { return; }
  if (disposed || !cm || !cm.list) return;
  const g = $("gDiff"); g.hidden = false;
  const selA = $("selA"), selB = $("selB");
  const opt = (c) => { const o = el("option", null, c.rev === "WORKTREE" ? `working tree (${c.on})` : `${c.tag ? c.tag + " · " : ""}${c.date} ${c.sha} ${c.subject.slice(0, 52)}`); o.value = c.rev; return o; };
  const none = el("option", null, "no diff"); none.value = "none"; selA.append(none);
  for (const c of cm.list) selA.append(opt(c));
  for (const c of [cm.worktree, ...cm.list]) selB.append(opt(c));
  // The ends a rebuild carried over, or those a link names.
  const q = new URLSearchParams(io.diff ?? ""), want = carried?.diff ?? { a: q.get("a"), b: q.get("b") };
  // A link may name any commit, not only the recent ones listed; it gets an entry of its own, named once the diff loads.
  for (const [sel, rev] of [[selA, want.a], [selB, want.b]]) if (rev && ![...sel.options].some((o) => o.value === rev)) { const o = el("option", null, rev); o.value = rev; o.dataset.linked = "1"; sel.prepend(o); }
  selA.value = want.a || cm.base; selB.value = want.b || "WORKTREE";
  selA.onchange = selB.onchange = () => loadDiff(selA.value, selB.value);
  const rel = cm.list.filter((c) => c.tag && /^v\d+\.\d+\.\d+$/.test(c.tag)).slice(0, 2);
  // With no trunk the base is HEAD itself, so the first button shows what is uncommitted.
  for (const [label, a] of [[cm.trunk === null ? "Uncommitted" : "This branch", cm.base], ...rel.map((c) => [`Since ${c.tag}`, c.rev]), ["None", "none"]]) {
    const b = el("button", null, label); b.onclick = () => { selA.value = a; selB.value = "WORKTREE"; loadDiff(a, "WORKTREE"); }; g.append(b);
  }
  await loadDiff(selA.value, selB.value);
}
let running = true;
sync(); layout(); aim(carried?.camera.view ?? "tilt", false);
if (carried) { camera.position.fromArray(carried.camera.position); controls.target.fromArray(carried.camera.target); controls.update(); }
drawCrumbs(); drawSide(); drawTable(); drawNote(); resize(); frame(); startDiff();
return {
  root,
  /** Start drawing again after the view was off the page. */
  // Colours come from the relief's own element, which only resolves its tokens once it is on the page.
  resume() { if (disposed || !root.isConnected) return; paint(); drawScale(lastMax); if (!running) { running = true; resize(); frame(); } },
  touch,
  view() {
    const file = state.file ? [C[state.file[0]].folder, C[state.file[0]].files[state.file[1]].file] : null;
    return {
      layout: LAYOUT, foot: state.foot, height: state.height, win: state.win, split: state.split, big: state.big,
      scope: C[state.scope].folder, own: state.own, selected: state.selected == null ? null : C[state.selected].folder, file,
      camera: { view: lastView, position: camera.position.toArray(), target: controls.target.toArray() },
      diff: $("gDiff").hidden ? null : { a: $("selA").value, b: $("selB").value },
    };
  },
  dispose() {
    if (disposed) return;
    disposed = true; running = false;
    cancelAnimationFrame(raf);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    resizing.disconnect();
    darkScheme.removeEventListener("change", paint);
    document.removeEventListener("keydown", onKey);
    controls.dispose();
    // Shared geometries and materials are met more than once; disposing one twice is harmless.
    scene.traverse((o) => { o.geometry?.dispose(); for (const m of [o.material].flat()) m?.dispose(); if (o.isInstancedMesh) o.dispose(); });
    renderer.dispose();
    renderer.forceContextLoss();
    root.remove();
  },
};
}
