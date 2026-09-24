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

(here / "13-structure.src.html").write_text(S13)
(here / "14-structure.src.html").write_text(S14)
print("wrote 13-structure.src.html, 14-structure.src.html")
