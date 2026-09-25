# Writes 13-structure.src.html and 14-structure.src.html from _structure.js (the shared engine) and each scene's timeline.
# python3 structure-gen.py && node build.mjs
from pathlib import Path

here = Path(__file__).parent
head = (here / "_structure_head.html").read_text()
head = head.replace("family=Instrument+Sans", "family=IBM+Plex+Mono:wght@400;500;700&family=Instrument+Sans")
engine = (here / "_structure.js").read_text()

SCRIPTS = """<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/LuminosityHighPassShader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js"></script>"""

def page(n, title, h1, T, beats):
    return f"""{head.replace("Scene 12 · Reduce", f"Scene {n} · {title}")}
<div class="wrap">
  <header>
    <div class="eyebrow">Coherence promo · scene {n} · {title.lower()}</div>
    <h1>{h1}</h1>
  </header>

  <div class="stage" id="stage">
    <canvas id="gl"></canvas>
    <div class="hud" id="mast"></div>
    <div class="hud" id="strip"></div>
    <div class="hud panel" id="insp"></div>
    <div class="hud panel" id="change"></div>
    <div class="caption" id="caption"></div>
  </div>

  <div class="transport">
    <button id="play">Pause</button>
    <input type="range" id="scrub" min="0" max="{T}" step="0.01" value="0" aria-label="Scene time">
    <span class="tc" id="tc">0.00 / {T:.2f}</span>
    <button id="cc" aria-pressed="true">Captions on</button>
  </div>

  <section class="box">
    <h2>Beats (about {T} s; a stylized Scope Structure view on the ground)</h2>
    <ol class="beats">
{beats}
    </ol>
    <p class="note">Drawn from Scope's real Structure grammar: entrance tokens with trust tags, stations in columns by distance from an entrance, one colour per structural route (never red or orange), core dependencies as rails, C and X interface identifiers, red only for broken. The project is the fictional app from scenes 11 and 12.</p>
  </section>
</div>

{SCRIPTS}
<script>
const ICONS = /*ICONS*/{{}};
const SCENE = {n}, T = {T};
"""

def beat(t, q, span):
    return f'      <li><span class="t">{t}</span><div><q>{q}</q><span>{span}</span></div></li>'

ALL = "Object.fromEntries(Object.keys(STATIONS).map((k) => [k, 1]))"

S13 = page(13, "Structure", "The structure view assembles: entrances, components, and the routes between them", 12, "\n".join([
    beat("0.0", "But how do we check that the agent did what we want?", "The fog is thinner now. A pane of dark glass settles on the ground: a map lying over the territory."),
    beat("2.6", "The Coherence structure view shows you the entrypoints into your project,", "Entrance tokens slide in along the left margin, each with its trust tag beneath; one reads no control, in amber."),
    beat("4.4", "its major components,", "Stations appear column by column: where work enters, one step in, two steps in. Each is a glass card: name, role, folder."),
    beat("6.2", "and how those components interact with each other.", "Structural routes light one at a time, each its own colour, from its entrance through its stations in order; interface identifiers settle on the lines; the core dependencies run along the bottom as rails."),
    beat("9.4", "Always accurate and up to date.", "The masthead lands: All 24 invariants verified, and a live dot. Every verdict bar goes mint."),
])) + """const CLARITY = [.65, .75];
const C = { bg: 0x07090C, fog: 0x0A0F13, grey: "#5E6A73", orange: "#FF9A3C", red: "#FF4B4B", mint: "#54E8B0", ink: "#E6ECEF", muted: "#8B98A2" };
const LINES = [
  [0.3, 2.4, "But how do we check that the agent did what we want?"],
  [2.6, 9.2, "The Coherence structure view shows you the entrypoints into your project, its major components, and how those components interact with each other."],
  [9.4, 11.6, "Always accurate and up to date."],
];
""" + engine + """
const KEYS = [
  [0, [0, MAP_Y + 17, 4.2], [0, MAP_Y, -2.2]],
  [4.0, [0, MAP_Y + 14.2, 3.4], [0, MAP_Y, -2.25]],
  [T, [0, MAP_Y + 13.4, 3.2], [0, MAP_Y, -2.3]],
];
const SHOWN = ROUTES.filter((r) => !r.added);
// the ground's noise gives way to order as the map assembles, spreading out from under it
const LIFT_AT = null;
const ORDER = (t) => smooth(3.0, 9.8, t), ORDER_R = (t) => 60 * Math.pow(smooth(2.6, 10.4, t), 1.4);
function timeline(t) {
  const S = { panel: smooth(.3, 1.4, t), headers: smooth(2.6, 3.2, t), routeCount: SHOWN.length, entranceCount: SHOWN.reduce((n, r) => n + r.names.length, 0),
    rails: smooth(8.8, 9.7, t), route: {}, ghost: {}, entrance: {}, station: {}, broken: {}, tag: {}, tagBroken: {}, bypass: 0,
    verified: smooth(9.6, 9.9, t), dim: () => 1, dimStation: () => 1 };
  SHOWN.forEach((r, i) => { S.entrance[r.id] = smooth(2.9 + i * .22, 3.4 + i * .22, t); S.route[r.id] = ease(smooth(6.3 + i * .5, 7.4 + i * .5, t)); });
  const order = [["API", "Jobs"], ["Sessions", "Admin", "Billing"], ["Auth", "Storage", "Webhooks"]];
  order.forEach((col, c) => col.forEach((id, j) => (S.station[id] = smooth(4.4 + c * .5 + j * .1, 4.8 + c * .5 + j * .1, t))));
  TAGS.forEach((tg) => { const i = SHOWN.findIndex((r) => r.id === tg.route); S.tag[tg.id] = smooth(7.1 + i * .5, 7.4 + i * .5, t); });
  const H = { mast: smooth(9.4, 9.8, t), strip: smooth(9.7, 10.1, t), live: t > 10.1, broken: false, insp: 0, change: 0 };
  return { S, H, sea: { o: 0, scroll: 0 } };
}
</script>
"""

S14 = page(14, "Seen", "A violation shows on the map, then a change, then the project as it is", 15, "\n".join([
    beat("0.0", "When chokepoints are violated, you'll see it.", "The map from scene 13, live. A red dashed reference runs from Admin straight into Sessions; Sessions' verdict bar goes red and a ✕ 1 broken button pins to it; C1 on the line goes red. The rest dims, and the inspector names it: chokepoint sessions.get() protects the session store, bypass admin/dashboard.ts:42 in loadStats. The masthead reads 1 broken."),
    beat("3.5", "When a major change alters the relationships between components, you'll see that too.", "The fix lands and the red clears. A new entrance, POST /export, slides in and its route draws through Admin to Webhooks; the old Jobs → Webhooks route ghosts to dashes and withdraws. A strip names the change since the last commit. (Scope computes these differences today; this view of them is the planned design.)"),
    beat("8.5", "No more sifting through thousands of lines of code to understand what was built or changed. See your project as it is right now.", "The ground under the map fills with code, thousands of rows streaming; then it dissolves, the map comes back to full, verified and live; in the last stretch its pieces (stations, entrances, tags) rise off it to 45 degrees in a cascade, like the signs, the lines staying flat, as the camera pulls up through air that is almost clear."),
])) + """const CLARITY = [.75, .9];
const C = { bg: 0x07090C, fog: 0x0A0F13, grey: "#5E6A73", orange: "#FF9A3C", red: "#FF4B4B", mint: "#54E8B0", ink: "#E6ECEF", muted: "#8B98A2" };
const LINES = [
  [0.3, 3.2, "When chokepoints are violated, you’ll see it."],
  [3.5, 8.2, "When a major change alters the relationships between components, you’ll see that too."],
  [8.5, 14.6, "No more sifting through thousands of lines of code to understand what was built or changed. See your project as it is right now."],
];
""" + engine + """
const KEYS = [
  [0, [0, MAP_Y + 13.4, 3.2], [0, MAP_Y, -2.3]],
  [1.8, [.8, MAP_Y + 8.6, -.4], [.8, MAP_Y, -3.2]],
  [3.4, [.8, MAP_Y + 8.6, -.5], [.8, MAP_Y, -3.2]],
  [5.0, [0, MAP_Y + 13.4, 3.2], [0, MAP_Y, -2.3]],
  [8.4, [0, MAP_Y + 13.4, 3.2], [0, MAP_Y, -2.3]],
  [10.6, [0, MAP_Y + 15.5, 9.5], [0, MAP_Y, -2.6]],
  [12.0, [0, MAP_Y + 14.5, 9.8], [0, MAP_Y, -2.4]],
  [T, [-1.5, MAP_Y + 7.2, 11.5], [0, MAP_Y + .6, -2.0]],   // down low, so the risen pieces read as standing
];
const ORDER = () => 1, ORDER_R = () => 60;   // the ground is already ruled
const LIFT_AT = 12.0;   // the final stretch: the pieces rise off the map, in a cascade from the entrances out
function timeline(t) {
  const sel = smooth(1.2, 1.6, t) * (1 - smooth(5.6, 6.2, t)), heal = smooth(3.6, 4.2, t);
  const removed = smooth(7.0, 7.8, t), added = smooth(4.6, 5.0, t);
  const S = { panel: 1, headers: 1, rails: 1, verified: 1, route: {}, ghost: {}, entrance: {}, station: {}, broken: {}, tag: {}, tagBroken: {},
    routeCount: 5 + (added > .5 ? 1 : 0) - (removed > .5 ? 1 : 0), entranceCount: 6 + (added > .5 ? 1 : 0) - (removed > .5 ? 1 : 0),
    bypass: smooth(.5, 1.1, t) * (1 - heal),
    dim: (r) => 1 - .55 * sel * (["R1", "R2"].includes(r.id) ? 0 : 1),
    dimStation: (id) => 1 - .55 * sel * (["Sessions", "Admin"].includes(id) ? 0 : 1) };
  for (const r of ROUTES) {
    if (r.added) { S.entrance[r.id] = added; S.route[r.id] = ease(smooth(4.9, 6.1, t)); continue; }
    S.entrance[r.id] = r.id === "R5" ? 1 - removed : 1;
    S.route[r.id] = r.id === "R5" ? 1 - ease(removed) : 1;
    S.ghost[r.id] = r.id === "R5" ? smooth(5.6, 6.1, t) : 0;
  }
  for (const id of Object.keys(STATIONS)) S.station[id] = 1;
  S.broken.Sessions = smooth(1.0, 1.3, t) * (1 - heal);
  for (const tg of TAGS) S.tag[tg.id] = tg.route === "R5" ? 1 - removed : 1;
  S.tagBroken.C1 = S.broken.Sessions;
  // the sea of code: it rises under the map, the map fades back, then the code dissolves and the map returns
  const seaIn = smooth(8.6, 9.4, t), seaOut = smooth(10.8, 12.0, t);
  const back = seaIn * (1 - seaOut);
  mapGlow.material.opacity = mapText.material.opacity = 1 - .7 * back;
  const H = { mast: 1, strip: 1, live: true, broken: S.broken.Sessions > .5, insp: smooth(1.4, 1.8, t) * (1 - smooth(4.0, 4.4, t)), change: smooth(4.8, 5.2, t) * (1 - smooth(8.2, 8.6, t)) };
  return { S, H, sea: { o: .6 * back, scroll: t * .35 } };
}
</script>
"""


S15 = page(15, "Coherent", "The structure view pulls back into a field of views, the field goes coherent, and the mint becomes the title", 22.6, "\n".join([
    beat("0.0", "These are the kinds of tools we need to clear the fog.", "The structure view, verified, in clear air. The camera starts to pull straight up, and at 3:31 the view is the first to go coherent: its detail gives way to a flat mint abstraction of the same structure."),
    beat("4.0", "Spend less inference on code that doesn't work, less inference detecting bugs, less inference investigating the decisions that went into your changes.", "More structure views surround it, tile by tile, each more abstract the further out it sits: cards and lines, then bare blocks. Each view moves one way along grey, amber, red, starting at its own point and never stepping back; from about 5 s, green trickles outward from the centre, cell by cell."),
    beat("12.8", "You get a more stable, coherent project, steadily driving toward the floor of irreducible complexity.", "A wave of mint rolls outward from the centre until every view is uniform mint; the tiles close ranks into one surface."),
    beat("18.9", "The software of 2030 is waiting for us.", "Pull back far enough and it is solid mint (under the end of the line before). The wordmark, coherence, lowercase and black, its c slightly tilted. A scan line passes, a reticle locks onto the c and tilts it back into place, and everything fades to black just after the last word."),
])) + """const CLARITY = [.95, 1];
const C = { bg: 0x07090C, fog: 0x0A0F13, grey: "#5E6A73", orange: "#FF9A3C", red: "#FF4B4B", mint: "#54E8B0", ink: "#E6ECEF", muted: "#8B98A2" };
const LINES = [
  [0.6, 3.4, "These are the kinds of tools we need to clear the fog."],
  [3.9, 12.4, "Spend less inference on code that doesn’t work, less inference detecting bugs, less inference investigating the decisions that went into your changes."],
  [12.8, 18.5, "You get a more stable, coherent project, steadily driving toward the floor of irreducible complexity."],
  [18.9, 22.0, "The software of 2030 is waiting for us."],
];
""" + engine + r"""
const KEYS = [[0, [0, MAP_Y + 13.4, 3.2], [0, MAP_Y, -2.3]], [T, [0, MAP_Y + 13.4, 3.2], [0, MAP_Y, -2.3]]];
const ORDER = () => 1, ORDER_R = () => 60;
// continuity from scene 14: we open where it ended, low, the pieces standing; they lie back down as the camera climbs
const LIFT_AT = -5, LOWER_AT = .25, FROM14 = { p: [-1.5, MAP_Y + 7.2, 11.5], q: [0, MAP_Y + .6, -2.0] };
// the choreography was built long; PACE compresses it so the fade to black lands just after the last word
const PACE = .82;
camera.far = 6000; camera.updateProjectionMatrix();
function timeline(t) {
  const S = { panel: 1, headers: 1, rails: 1, verified: 1, route: {}, ghost: {}, entrance: {}, station: {}, broken: {}, tag: {}, tagBroken: {},
    routeCount: 5, entranceCount: 6, bypass: 0, dim: () => 1, dimStation: () => 1 };
  for (const r of ROUTES) { S.entrance[r.id] = r.id === "R5" ? 0 : 1; S.route[r.id] = r.id === "R5" ? 0 : 1; }
  for (const id of Object.keys(STATIONS)) S.station[id] = 1;
  for (const tg of TAGS) S.tag[tg.id] = tg.route === "R5" ? 0 : 1;
  const H = { mast: 1 - smooth(1.2, 2.6, t), strip: 1 - smooth(1.0, 2.4, t), live: true, broken: false, insp: 0, change: 0 };
  return { S, H, sea: { o: 0, scroll: 0 } };
}

// ---------- the field: structure views all around, more abstract the further out they sit ----------
const TW = 17, TH = 10, R = 66;                     // tile pitch (a map is 16 x 9) and the field's radius in tiles
// every tile is its own structure view: a seeded layout (columns, stations, entrances, routes, rails), drawn at three levels of detail
const LAYOUTS = 14;
function layout(seed) {
  let r = seed * 9301 + 49297; const R_ = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const cols = 2 + Math.floor(R_() * 4), colX = [...Array(cols)].map((_, c) => 110 + c * (360 / cols) + 20);
  const cw = 360 / cols * (.55 + R_() * .25), stations = [];
  colX.forEach((x, c) => { const n = 1 + Math.floor(R_() * 4); for (let k = 0; k < n; k++) stations.push({ c, x, y: 22 + (k + .5) * (190 / n) + (R_() - .5) * 12, w: cw, h: 14 + R_() * 14 }); });
  const entrances = [...Array(1 + Math.floor(R_() * 5))].map((_, k, all) => ({ y: 26 + (k + .5) * (190 / all.length) }));
  const routes = entrances.map((e) => {
    const pts = [[74, e.y]]; let y = e.y;
    for (let c = 0; c < cols; c++) { if (c && R_() < .25) break; const pick = stations.filter((st) => st.c === c); const st = pick[Math.floor(R_() * pick.length)]; if (!st) break;
      const x0 = st.x, ty = st.y, dy = ty - y, d = Math.min(Math.abs(dy), 18); const mx = x0 - 16 - d;
      pts.push([mx, y], [mx + d, y + Math.sign(dy) * d], [mx + d, ty], [x0, ty], [x0 + st.w, ty]); y = ty; }
    return { pts, bright: .45 + R_() * .5 };
  });
  return { stations, entrances, routes, rails: Math.floor(R_() * 3) };
}
function tileTex(L, level) {
  return canvasTex(480, 270, (g) => {
    g.fillStyle = "#0B0F16"; g.fillRect(0, 0, 480, 270);
    if (level < 2) for (const rt of L.routes) { g.strokeStyle = `rgba(220,228,234,${rt.bright * (level ? .5 : .8)})`; g.lineWidth = level ? 2 : 3; g.lineJoin = "round"; g.beginPath(); rt.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
    for (let k = 0; k < L.rails; k++) { g.fillStyle = `rgba(220,228,234,${level < 2 ? .45 : .3})`; g.fillRect(20, 238 + k * 10, 440, 4); }
    for (const e of L.entrances) { g.fillStyle = level < 2 ? "rgba(220,228,234,.85)" : "rgba(220,228,234,.6)"; g.beginPath(); g.moveTo(16, e.y - 9); g.lineTo(62, e.y - 9); g.lineTo(72, e.y); g.lineTo(62, e.y + 9); g.lineTo(16, e.y + 9); g.fill(); }
    for (const st of L.stations) {
      if (level === 0) {                           // cards: a verdict bar, a name, a role
        g.fillStyle = "#8A9BA8"; g.fillRect(st.x, st.y - st.h / 2, st.w, st.h); g.strokeStyle = "rgba(220,228,234,.8)"; g.lineWidth = 2; g.strokeRect(st.x, st.y - st.h / 2, st.w, st.h);
        g.fillStyle = "#F2F6F9"; g.fillRect(st.x + 3, st.y - st.h / 2 + 3, 3, st.h - 6); g.fillRect(st.x + 10, st.y - st.h / 2 + 4, st.w * .45, 3); g.fillStyle = "#C9D3DA"; g.fillRect(st.x + 10, st.y - st.h / 2 + 10, st.w * .7, 2);
      } else { g.fillStyle = level === 1 ? "#DCE4EA" : "rgba(220,228,234,.85)"; g.fillRect(st.x, st.y - st.h / 2, st.w, st.h); }
    }
  });
}
const layouts = [...Array(LAYOUTS)].map((_, k) => layout(k + 3));
const LEVEL = (d) => (d < 6 ? 0 : d < 18 ? 1 : 2);
const groups = new Map();                            // one instanced mesh per (layout, level)
const put = (tl) => { const key = tl.v + ":" + tl.level; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(tl); };
for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
  if (!i && !j) continue;
  const d = Math.hypot(i, j * TH / TW * 1.2);
  if (d > R) continue;
  const h = ((i * 73856093) ^ (j * 19349663)) >>> 0;
  // where this cell starts on the path (grey or amber; nothing starts red) and when it moves on
  const u1 = (h % 997) / 997, u2 = ((h >>> 10) % 991) / 991, startAmber = u1 < .35;
  const tAmber = 3.2 + u2 * 10, tRed = (startAmber ? 3.4 : tAmber) + 1.5 + ((h >>> 20) % 97) / 97 * 10;   // spread wide: when the wave comes, the field is still mixed
  // the trickle: from 5 s into the scene, cells near the centre go green one at a time, spreading outward ahead of the wave
  const u3 = ((h >>> 5) % 983) / 983, tGreen = u3 < .45 ? 5 / PACE + d * .42 + ((h >>> 15) % 89) / 89 * 3.5 : 1e6;
  put({ x: i * TW, z: -1 + j * TH, d, startAmber, tAmber, tRed, tGreen, v: h % LAYOUTS, level: LEVEL(d) });
}
const fields = [...groups.entries()].map(([key, list]) => {
  const [v, level] = key.split(":").map(Number);
  const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(16, 9), new THREE.MeshBasicMaterial({ map: tileTex(layouts[v], level), toneMapped: false }), list.length);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m);
  list.forEach((_, k) => m.setColorAt(k, new THREE.Color(0x7E93A3)));
  return { m, list };
});
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const STEEL = new THREE.Color(0x7E93A3), REDc = new THREE.Color(C.red), AMBERc = new THREE.Color(C.orange), MINTc = new THREE.Color(C.mint);
// how high the camera is: a steady pull at first, then faster and faster
const height = (t) => 13.4 + 70 * smooth(.8, 5, t) + 520 * Math.pow(smooth(3.5, 12, t), 1.8) + 1200 * Math.pow(smooth(10, 19, t), 2);
const reach = (t) => height(t) * .9 / TW + 1.5;     // how far out the field has grown, in tiles: always past the frame's edge
const wave = (t) => (t - 12.4) * 11;               // the mint wave's radius, in tiles

// the first view goes coherent first: at 3:31 it turns from its detailed self into a flat mint abstraction of the same structure
const FIRST_GREEN = 1.95 / PACE;                     // 1.95 s into the scene, in the choreography's own time
const firstFlat = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), new THREE.MeshBasicMaterial({ color: C.mint, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
  map: canvasTex(480, 270, (g) => {
    g.fillStyle = "#0B0F16"; g.fillRect(0, 0, 480, 270);
    const k = 480 / MW, box = (x, y, w, h) => { g.fillStyle = "#EEF3F6"; g.fillRect(x * k, y * k, w * k, h * k); };
    g.strokeStyle = "rgba(238,243,246,.55)"; g.lineWidth = 3;
    for (const r of ROUTES) { if (r.id === "R5") continue; g.beginPath(); r.pts.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k))); g.stroke(); }
    for (const st of Object.values(STATIONS)) box(st.x, st.y, CARD.w, CARD.h);
    for (const r of ROUTES) if (r.id !== "R5") box(60, r.ey - 30, 270, 60);
    g.fillStyle = "rgba(238,243,246,.5)"; g.fillRect(60 * k, 1120 * k, (MW - 140) * k, 6);
  }) }));
firstFlat.rotation.x = -Math.PI / 2; firstFlat.position.set(0, MAP_Y + .01, -1); firstFlat.renderOrder = 4; scene.add(firstFlat);

// the surface: as the tiles close ranks, the field melts into one sheet of mint on the ground
const surface = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: C.mint, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
surface.rotation.x = -Math.PI / 2; surface.position.set(0, MAP_Y + .05, -1); surface.renderOrder = 9; scene.add(surface);

// ---------- the title: a 2D layer over the stage ----------
const title = document.createElement("canvas"); title.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
$("stage").insertBefore(title, $("mast"));
function drawTitle(t) {
  const W = title.width = title.clientWidth * devicePixelRatio, Hh = title.height = title.clientHeight * devicePixelRatio, g = title.getContext("2d");
  const mint = smooth(17.9, 19.1, t), black = smooth(26.2, 27.4, t);
  g.clearRect(0, 0, W, Hh);
  if (mint > 0) { g.fillStyle = `rgba(84,232,176,${mint})`; g.fillRect(0, 0, W, Hh); }
  const word = smooth(19.45, 20.85, t);                     // 3:45 in the cut
  if (word > 0) {
    const size = W * .135, y = Hh * .5 + size * .32;
    g.font = `600 ${size}px "Instrument Sans"`; g.letterSpacing = `${-size * .03}px`;
    const rest = "oherence", cw = g.measureText("c").width, rw = g.measureText(rest).width, x0 = W / 2 - (cw + rw) / 2;
    g.globalAlpha = word; g.fillStyle = "#07090C";
    // the c: tilted, until the reticle sets it straight (a little overshoot, then still)
    const fix = smooth(23.15, 23.85, t), over = Math.sin(smooth(23.15, 24.15, t) * Math.PI) * .08 * (1 - smooth(23.85, 24.25, t));
    const tilt = (-10 * (1 - fix) + over * 10) * Math.PI / 180;
    g.save(); g.translate(x0 + cw / 2, y - size * .26); g.rotate(tilt); g.fillText("c", -cw / 2, size * .26); g.restore();
    g.fillText(rest, x0 + cw, y);
    // the scan line: one pass across the word
    const sp = smooth(22.25, 23.25, t);
    if (sp > 0 && sp < 1) { const sy = Hh * .5 - size * .6 + sp * size * 1.2; g.fillStyle = "rgba(7,9,12,.55)"; g.fillRect(x0 - size * .3, sy, cw + rw + size * .6, Math.max(2, W * .0016)); }
    // the reticle: brackets closing on the c, holding while it turns, then letting go
    const lock = smooth(22.55, 23.15, t), let_ = smooth(24.15, 24.65, t);
    if (lock > 0 && let_ < 1) {
      const cx = x0 + cw / 2, cy = y - size * .26, r = size * (.42 + .5 * (1 - ease(lock))), L = size * .14;
      g.globalAlpha = word * (1 - let_); g.strokeStyle = "#07090C"; g.lineWidth = Math.max(2, W * .003); g.lineCap = "square";
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.moveTo(cx + sx * r, cy + sy * (r - L)); g.lineTo(cx + sx * r, cy + sy * r); g.lineTo(cx + sx * (r - L), cy + sy * r); g.stroke(); }
    }
    g.globalAlpha = 1; g.letterSpacing = "0px";
  }
  if (black > 0) { g.fillStyle = `rgba(0,0,0,${black})`; g.fillRect(0, 0, W, Hh); }
}

function EXTRA(t) {
  t = t / PACE;
  scene.fog.density = 0;                            // the air is clear now
  // the pull back
  const h = height(t);
  const from = 1 - ease(smooth(0, 1.6, t * PACE));        // blending out of scene 14's last camera over the first 1.6 s
  camera.position.set(FROM14.p[0] * from, MAP_Y + h + (FROM14.p[1] - MAP_Y - h) * from, 3.2 * (1 - smooth(.8, 5, t)) * (1 - from) + FROM14.p[2] * from);
  camera.lookAt(FROM14.q[0] * from, MAP_Y + FROM14.q[1] * 0 + (FROM14.q[1] - MAP_Y) * from, (-1 - 1.3 * (1 - smooth(.8, 5, t))) * (1 - from) + FROM14.q[2] * from);
  // the field grows outward, flickers red and amber, then goes mint in a wave from the centre; late, the tiles close ranks
  const close = smooth(13.7, 18.2, t), rch = reach(t) * smooth(.5, 1.3, t * PACE), wv = wave(t);   // the field waits for the pull-back, so the cut from 14 is clean
  fields.forEach(({ m, list }) => {
    list.forEach((tl, k) => {
      const on = smooth(tl.d - 1.2, tl.d, rch) * smooth(.5, 1.1, t * PACE);
      if (on <= 0) { m.setMatrixAt(k, _m.makeScale(0, 0, 0)); return; }
      const sc = (.94 + .12 * close) * (.85 + .15 * ease(on));
      _p.set(tl.x, MAP_Y - .02, tl.z); _s.set(sc * (1 + close * .06), sc * (1 + close * .11), 1);
      m.setMatrixAt(k, _m.compose(_p, _q, _s));
      // one way only: grey, then amber, then red, then mint as the wave passes; each cell starts at its own point and moves at its own moments
      _c.copy(STEEL);
      _c.lerp(AMBERc, tl.startAmber ? 1 : smooth(tl.tAmber, tl.tAmber + .3, t));
      _c.lerp(REDc, smooth(tl.tRed, tl.tRed + .3, t));
      _c.lerp(MINTc, Math.max(smooth(tl.d - .8, tl.d + .4, wv), smooth(tl.tGreen, tl.tGreen + .35, t)));
      m.setColorAt(k, _c);
    });
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
  });
  // the centre map goes mint with them, then gives way to the surface
  const turn = smooth(FIRST_GREEN - .45, FIRST_GREEN + .45, t);
  mapGlow.material.opacity = mapText.material.opacity = 1 - turn;
  firstFlat.material.opacity = turn;
  orderGround.visible = h < 200;
  surface.material.opacity = Math.pow(smooth(15.2, 18.3, t), 1.6);
  bloom.strength = .85 * (1 - smooth(13.2, 15.7, t));   // the glow goes before the surface arrives, so the mint lands true
  drawTitle(t);
}
</script>
"""

(here / "15-structure.src.html").write_text(S15)
(here / "13-structure.src.html").write_text(S13)
(here / "14-structure.src.html").write_text(S14)
print("wrote 13-structure.src.html, 14-structure.src.html")
