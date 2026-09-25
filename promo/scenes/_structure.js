// Scenes 13 and 14 share this engine: a stylized Scope Structure view, drawn on the ground like a map over the territory.
// structure-gen.py writes it into 13-structure.src.html and 14-structure.src.html with SCENE set.

/*COMMON*/

// ---------- the map: two canvases on one plane, the shapes in the bloom pass and the words crisp after it ----------
const MW = 2400, MH = 1350, PW = 16, PH = 9, MAP_Y = -5.9;
const glowCanvas = document.createElement("canvas"), textCanvas = document.createElement("canvas");
glowCanvas.width = textCanvas.width = MW; glowCanvas.height = textCanvas.height = MH;
const glowTex = new THREE.CanvasTexture(glowCanvas), textTex = new THREE.CanvasTexture(textCanvas);
[glowTex, textTex].forEach((t) => (t.anisotropy = renderer.capabilities.getMaxAnisotropy()));
const mapGeo = new THREE.PlaneGeometry(PW, PH);
const mapGlow = new THREE.Mesh(mapGeo, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, toneMapped: false }));
mapGlow.rotation.x = -Math.PI / 2; mapGlow.position.set(0, MAP_Y, -1); scene.add(mapGlow);
const overlay = new THREE.Scene();
const mapText = new THREE.Mesh(mapGeo, new THREE.MeshBasicMaterial({ map: textTex, transparent: true, depthWrite: false, toneMapped: false }));
mapText.rotation.copy(mapGlow.rotation); mapText.position.copy(mapGlow.position); overlay.add(mapText);

// ---------- the project: the app from scenes 11 and 12, read as structure ----------
const CARD = { w: 330, h: 118 };
const STATIONS = {
  API: { x: 600, y: 360, name: "API (root)", role: "HTTP entry: routes and jobs", dir: "project root" },
  Jobs: { x: 600, y: 900, name: "Jobs", role: "Scheduled and queued work", dir: "src/jobs" },
  Sessions: { x: 1160, y: 230, name: "Sessions", role: "Read through sessions.get()", dir: "src/sessions" },
  Admin: { x: 1160, y: 520, name: "Admin", role: "Dashboards and staff tools", dir: "src/admin" },
  Billing: { x: 1160, y: 810, name: "Billing", role: "Ledger via billing.guard()", dir: "src/billing" },
  Auth: { x: 1720, y: 230, name: "Auth", role: "Credentials and trust levels", dir: "src/auth" },
  Storage: { x: 1720, y: 540, name: "Storage", role: "Objects and exports", dir: "src/storage" },
  Webhooks: { x: 1720, y: 850, name: "Webhooks", role: "Outbound and inbound hooks", dir: "src/webhooks" },
};
const COLS = [[600, "Where work enters"], [1160, "1 step from an entrance"], [1720, "2 steps from an entrance"]];
// structural routes: one colour each, never red or orange; entrance names, trust, and the stations in order
const ROUTES = [
  { id: "R1", col: "#3B8BFF", names: ["GET /account"], trust: "authenticated", ey: 230, via: ["API", "Sessions", "Auth"] },
  { id: "R2", col: "#19B3C2", names: ["GET /admin", "GET /stats"], trust: "authenticated", ey: 400, via: ["API", "Admin", "Storage"] },
  { id: "R3", col: "#58B45F", names: ["POST /refund"], trust: "authenticated", ey: 590, via: ["API", "Billing", "Storage"] },
  { id: "R4", col: "#8B7CFF", names: ["cron · nightly"], trust: "internal", ey: 850, via: ["Jobs", "Billing", "Webhooks"] },
  { id: "R5", col: "#D05BCB", names: ["webhook in"], trust: "no control", ey: 1000, via: ["Jobs", "Webhooks"] },
  { id: "R6", col: "#6C7BFF", names: ["POST /export"], trust: "authenticated", ey: 690, via: ["API", "Admin", "Webhooks"], added: true },
];
// interface identifiers: C rounded (a chokepoint), X pointed (a crossing), sitting on a route's approach to a station
const TAGS = [
  { id: "C1", kind: "C", route: "R1", at: "Sessions" },
  { id: "C2", kind: "C", route: "R3", at: "Billing" },
  { id: "X3", kind: "X", route: "R5", at: "Webhooks" },
  { id: "X4", kind: "X", route: "R2", at: "Admin" },
];
const RAILS = [{ y: 1120, name: "Core: core dependency, called by 6 of 8", from: ["API", "Sessions", "Admin", "Billing", "Storage", "Jobs"] }, { y: 1200, name: "DB: core dependency, called by 5 of 8", from: ["Sessions", "Billing", "Storage", "Auth", "Webhooks"] }];

// where each route runs through a station: routes through the same station share it side by side
const through = {};
for (const r of ROUTES) for (const s of r.via) (through[s] = through[s] || []).push(r.id);
const laneY = (s, rid) => { const list = through[s], k = list.indexOf(rid); return STATIONS[s].y + CARD.h / 2 + (k - (list.length - 1) / 2) * 14; };
function routePts(r) {
  const pts = [[330, r.ey]];
  let prev = null;
  for (const s of r.via) {
    const st = STATIONS[s], y = laneY(s, r.id), x0 = st.x, x1 = st.x + CARD.w;
    const [ax, ay] = prev || pts[0], bx = x0, by = y;
    const dy = Math.abs(by - ay), span = bx - ax, d = Math.min(dy, span * .7), mx = ax + (span - d) / 2;
    if (dy > .5) pts.push([mx, ay], [mx + d, ay + Math.sign(by - ay) * d]);
    pts.push([bx - 24, by], [bx, by], [x1, by]);
    prev = [x1, by];
  }
  return pts;
}
ROUTES.forEach((r) => (r.pts = routePts(r)));
const segLen = (p) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };
function drawPartial(g, pts, frac) {
  const total = segLen(pts) * frac; let left = total;
  g.beginPath(); g.moveTo(...pts[0]);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay), k = Math.min(1, left / L);
    g.lineTo(ax + (bx - ax) * k, ay + (by - ay) * k); left -= L;
  }
  g.stroke();
}
// where a tag sits: on its route, a little before the station it guards
function tagPos(tag) { const r = ROUTES.find((x) => x.id === tag.route), y = laneY(tag.at, r.id); return [STATIONS[tag.at].x - 70, y]; }

// ---------- drawing ----------
const MINT = C.mint, RED = C.red, AMBER = "#F0B24A", INKc = "#E6ECEF", MUTED = "#8B98A2";
// drawMap(S) draws the whole map; drawMap(S, piece) draws only that piece (a station, an entrance, a tag) into the piece's own canvases
function drawMap(S, piece) {
  const g = piece ? piece.g : glowCanvas.getContext("2d"), x = piece ? piece.x : textCanvas.getContext("2d");
  const want = (kind, id) => (piece ? piece.kind === kind && piece.id === id : !S.lifted);   // once the pieces have risen, the base keeps only the lines
  if (!piece) { g.clearRect(0, 0, MW, MH); x.clearRect(0, 0, MW, MH); }
  if (!piece) {
  // the glass the map sits on
  g.globalAlpha = S.panel; g.fillStyle = "rgba(10,14,22,.82)"; g.beginPath(); g.roundRect(8, 8, MW - 16, MH - 16, 30); g.fill();
  g.strokeStyle = "rgba(90,110,130,.45)"; g.lineWidth = 3; g.stroke(); g.globalAlpha = 1;
  // column headers
  x.globalAlpha = S.headers; x.fillStyle = MUTED; x.font = `500 26px "Instrument Sans"`;
  for (const [cx, label] of COLS) x.fillText(label, cx + 30, 110);
  x.fillText(`${S.routeCount} structural routes from ${S.entranceCount} entrances`, 60, 60);
  x.globalAlpha = 1;
  // rails: core dependencies along the bottom, and each caller's stub down to them
  for (const rl of RAILS) {
    const k = S.rails;
    if (k <= 0) continue;
    g.globalAlpha = k; g.strokeStyle = "#7E8A96"; g.lineWidth = 9; g.beginPath(); g.moveTo(60, rl.y); g.lineTo(60 + (MW - 140) * k, rl.y); g.stroke();
    g.lineWidth = 2.5; g.strokeStyle = "rgba(160,172,184,.7)";
    for (const s of rl.from) { const st = STATIONS[s], sx = st.x + 30 + RAILS.indexOf(rl) * 14; g.beginPath(); g.moveTo(sx, st.y + CARD.h); g.lineTo(sx, st.y + CARD.h + (rl.y - st.y - CARD.h) * k); g.stroke(); }
    g.globalAlpha = 1;
    x.globalAlpha = k; x.fillStyle = INKc; x.font = `500 24px "Instrument Sans"`; x.fillText(rl.name, 60, rl.y - 16); x.globalAlpha = 1;
  }
  // routes, under the stations
  for (const r of ROUTES) {
    const k = S.route[r.id] ?? 0; if (k <= 0) continue;
    const ghost = S.ghost[r.id] ?? 0, dim = S.dim(r);
    g.globalAlpha = (1 - ghost * .65) * dim; g.strokeStyle = r.col; g.lineWidth = 8; g.lineJoin = "round"; g.lineCap = "round";
    if (ghost > 0) g.setLineDash([22, 16]);
    drawPartial(g, r.pts, k); g.setLineDash([]); g.globalAlpha = 1;
  }
  // the bypass: a red reference from Admin straight into the session store
  if (S.bypass > 0) {
    const a = STATIONS.Admin, b = STATIONS.Sessions;
    g.strokeStyle = RED; g.lineWidth = 6; g.setLineDash([16, 12]);
    drawPartial(g, [[a.x + CARD.w - 60, a.y], [a.x + CARD.w - 60, b.y + CARD.h + 20], [b.x + CARD.w - 60, b.y + CARD.h]], S.bypass); g.setLineDash([]);
  }
  }
  // entrances: arrow tokens in the left margin, trust tags beneath
  for (const r of ROUTES) {
    const k = S.entrance[r.id] ?? 0; if (k <= 0 || !want("entrance", r.id)) continue;
    const ghost = S.ghost[r.id] ?? 0, dim = S.dim(r), n = r.names.length, h = 30 + n * 32, y0 = r.ey - h / 2, xOff = (1 - ease(k)) * -120;
    g.globalAlpha = k * (1 - ghost * .7) * dim; g.fillStyle = r.col + "55"; g.strokeStyle = r.col; g.lineWidth = 3;
    g.beginPath(); g.moveTo(60 + xOff, y0); g.lineTo(300 + xOff, y0); g.lineTo(330 + xOff, r.ey); g.lineTo(300 + xOff, y0 + h); g.lineTo(60 + xOff, y0 + h); g.closePath(); g.fill(); g.stroke(); g.globalAlpha = 1;
    x.globalAlpha = k * (1 - ghost * .7) * dim; x.textAlign = "right"; x.fillStyle = INKc; x.font = `500 26px "Instrument Sans"`;
    r.names.forEach((nm, i) => x.fillText(nm, 290 + xOff, y0 + 38 + i * 32));
    x.font = `500 21px "IBM Plex Mono", "JetBrains Mono"`; x.fillStyle = r.trust === "no control" ? AMBER : MUTED; x.fillText(r.trust, 300 + xOff, y0 + h + 26);
    x.textAlign = "left"; x.globalAlpha = 1;
  }
  // stations: dark glass cards, a verdict bar on the left edge, name, role, folder
  for (const [id, st] of Object.entries(STATIONS)) {
    const k = S.station[id] ?? 0; if (k <= 0 || !want("station", id)) continue;
    const s = .9 + .1 * ease(k), cx = st.x + CARD.w / 2, cy = st.y + CARD.h / 2, broken = S.broken[id] ?? 0, dim = S.dimStation(id);
    g.save(); g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy); g.globalAlpha = k * dim;
    g.fillStyle = "rgba(22,29,40,.96)"; g.beginPath(); g.roundRect(st.x, st.y, CARD.w, CARD.h, 10); g.fill();
    g.strokeStyle = broken > .5 ? RED : "rgba(150,170,190,.6)"; g.lineWidth = 3; g.stroke();
    g.fillStyle = broken > .5 ? RED : S.verified > 0 ? MINT : "#6E7C88"; g.fillRect(st.x + 8, st.y + 12, 8, CARD.h - 24);
    // the broken button, pinned to the card's top right
    if (broken > 0) { g.globalAlpha = k * broken; g.fillStyle = RED; g.beginPath(); g.roundRect(st.x + CARD.w - 150, st.y - 40, 150, 40, 6); g.fill(); }
    g.restore();
    x.save(); x.translate(cx, cy); x.scale(s, s); x.translate(-cx, -cy); x.globalAlpha = k * dim;
    x.fillStyle = INKc; let ns = 30; x.font = `600 ${ns}px "Instrument Sans"`;
    while (x.measureText(st.name).width > CARD.w - (broken > 0 ? 190 : 44) && ns > 20) { ns -= .5; x.font = `600 ${ns}px "Instrument Sans"`; }
    x.fillText(st.name, st.x + 30, st.y + 38);
    // the role line shrinks to fit its card, so no card's text runs off its edge
    x.fillStyle = "#B5C0C9"; let rs = 21; x.font = `400 ${rs}px "Instrument Sans"`;
    while (x.measureText(st.role).width > CARD.w - 44 && rs > 14) { rs -= .5; x.font = `400 ${rs}px "Instrument Sans"`; }
    x.fillText(st.role, st.x + 30, st.y + 70);
    x.fillStyle = MUTED; x.font = `400 20px "IBM Plex Mono", "JetBrains Mono"`; x.fillText(st.dir, st.x + 30, st.y + 100);
    if (broken > 0) { x.globalAlpha = k * broken; x.fillStyle = "#fff"; x.font = `700 24px "Instrument Sans"`; x.fillText("✕ 1 broken", st.x + CARD.w - 138, st.y - 12); }
    x.restore();
  }
  // interface identifiers on the lines: C rounded, X pointed; solid when verified, red when broken
  for (const tg of TAGS) {
    const k = S.tag[tg.id] ?? 0; if (k <= 0 || !want("tag", tg.id)) continue;
    const [tx, ty] = tagPos(tg), w = 70, h = 34, broken = S.tagBroken[tg.id] ?? 0, dim = S.dim(ROUTES.find((r) => r.id === tg.route));
    const fill = broken > .5 ? RED : S.verified > 0 ? "#DCE6EE" : "#8894A0";
    g.globalAlpha = k * dim; g.fillStyle = fill; g.strokeStyle = "#0A0D16"; g.lineWidth = 3; g.beginPath();
    if (tg.kind === "C") g.roundRect(tx - w / 2, ty - h / 2, w, h, h / 2);
    else { g.moveTo(tx - w / 2, ty); g.lineTo(tx - w / 2 + 12, ty - h / 2); g.lineTo(tx + w / 2 - 12, ty - h / 2); g.lineTo(tx + w / 2, ty); g.lineTo(tx + w / 2 - 12, ty + h / 2); g.lineTo(tx - w / 2 + 12, ty + h / 2); g.closePath(); }
    g.fill(); g.stroke(); g.globalAlpha = 1;
    x.globalAlpha = k * dim; x.fillStyle = "#0A0D16"; x.textAlign = "center"; x.font = `700 22px "IBM Plex Mono", "JetBrains Mono"`; x.fillText(tg.id, tx, ty + 8); x.textAlign = "left"; x.globalAlpha = 1;
  }
  if (!piece) { glowTex.needsUpdate = true; textTex.needsUpdate = true; }
}

// ---------- order: the noisy territory gives way to a ruled ground, spreading out from under the map ----------
territory.material.transparent = true;
const orderGround = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uR: { value: 0 } },
  vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
  fragmentShader: `uniform float uR; varying vec3 vW;
    void main() {
      vec2 p = vW.xz - vec2(0., -1.);                       // the map's centre
      vec2 f = abs(fract(p + .5) - .5), F = abs(fract(p / 4. + .5) - .5) * 4.;
      float minor = 1. - smoothstep(0., .025, min(f.x, f.y)), major = 1. - smoothstep(0., .04, min(F.x, F.y));
      float r = length(p * vec2(1., 1.5)), reveal = 1. - smoothstep(uR - 3., uR, r), edge = smoothstep(uR - 3., uR - .4, r) * reveal;
      float a = (minor * .26 + major * .5) * reveal * exp(-r * .022) + edge * .5 * (minor + major);
      gl_FragColor = vec4(vec3(.36, .5, .6) + edge * vec3(.2, .45, .35), a);
    }`,
}));
orderGround.rotation.x = -Math.PI / 2; orderGround.position.set(0, MAP_Y - .03, 0); orderGround.renderOrder = -1; scene.add(orderGround);

// ---------- the rising pieces: every station, entrance and tag as its own small panel ----------
const pieces = [];
function pieceBox(kind, id) {
  if (kind === "station") { const st = STATIONS[id]; return [st.x - 6, st.y - 6, CARD.w + 12, CARD.h + 12]; }
  if (kind === "entrance") { const r = ROUTES.find((q) => q.id === id), h = 30 + r.names.length * 32; return [50, r.ey - h / 2 - 8, 300, h + 50]; }
  const [tx, ty] = tagPos(TAGS.find((q) => q.id === id)); return [tx - 40, ty - 22, 80, 44];
}
function buildPieces() {
  const list = [...ROUTES.map((r, i) => ["entrance", r.id, i]), ...Object.keys(STATIONS).map((id) => ["station", id, 0]), ...TAGS.map((tg) => ["tag", tg.id, 0])];
  for (const [kind, id] of list) {
    const [bx, by, bw, bh] = pieceBox(kind, id), gc = document.createElement("canvas"), xc = document.createElement("canvas");
    gc.width = xc.width = bw; gc.height = xc.height = bh;
    const w = bw / MW * PW, h = bh / MH * PH, geo = new THREE.PlaneGeometry(w, h);
    const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    const text = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(xc), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    glow.renderOrder = 5; scene.add(glow); overlay.add(text);
    // the hinge: the piece's near edge, on the map
    const hinge = new THREE.Vector3(((bx + bw / 2) / MW - .5) * PW, MAP_Y + .01, -1 + ((by + bh) / MH - .5) * PH);
    pieces.push({ kind, id, gc, xc, glow, text, hinge, h, delay: ((bx + bw / 2) / MW) * .5 + ((by) / MH) * .15 });
  }
}
function placePieces(t, S) {
  for (const p of pieces) {
    const g = p.gc.getContext("2d"), x = p.xc.getContext("2d"), [bx, by] = pieceBox(p.kind, p.id);
    g.setTransform(1, 0, 0, 1, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, p.gc.width, p.gc.height); x.clearRect(0, 0, p.xc.width, p.xc.height);
    g.translate(-bx, -by); x.translate(-bx, -by);
    drawMap(S, { kind: p.kind, id: p.id, g, x });
    p.glow.material.map.needsUpdate = p.text.material.map.needsUpdate = true;
    // up in a cascade at LIFT_AT; and, where a scene sets LOWER_AT, back down again in the same order
    const down = typeof LOWER_AT === "number" ? ease(smooth(LOWER_AT + p.delay * .6, LOWER_AT + p.delay * .6 + .8, t)) : 0;
    const k = ease(smooth(LIFT_AT + p.delay, LIFT_AT + p.delay + .9, t)) * (1 - down), th = -Math.PI / 2 + Math.PI / 4 * k;
    for (const m of [p.glow, p.text]) { m.rotation.set(th, 0, 0); m.position.set(p.hinge.x, p.hinge.y + .02 * k + Math.cos(th) * p.h / 2, p.hinge.z + Math.sin(th) * p.h / 2); m.material.opacity = mapGlow.material.opacity; }
  }
}

// ---------- the sea of code the map replaces (scene 14): token cells, scrolling ----------
const codeTex = canvasTex(1024, 2048, (g, w, h) => {
  let y = 10; const R = () => rand();
  while (y < h - 20) { let x = 10 + (R() < .3 ? 40 : 0); while (x < w - 60) { const cw = 18 + R() * 80; if (x + cw > w - 10) break; g.fillStyle = `rgba(94,106,115,${.35 + R() * .4})`; g.fillRect(x, y, cw, 12); x += cw + 7; if (R() < .08) break; } y += 22; }
});
codeTex.wrapS = codeTex.wrapT = THREE.RepeatWrapping; codeTex.repeat.set(3, 2);
const codeSea = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshBasicMaterial({ map: codeTex, transparent: true, opacity: 0, depthWrite: false, fog: true }));
codeSea.rotation.x = -Math.PI / 2; codeSea.position.set(0, MAP_Y - .05, -6); scene.add(codeSea);

// ---------- the HUD: Scope's masthead verdict, its health strip, the inspector, the change strip ----------
const $ = (id) => document.getElementById(id);
function hudState(H) {
  $("mast").style.opacity = H.mast;
  $("mast").innerHTML = `<div class="k">${svgIcon("route")}scope · structure${H.live ? ` <span style="color:${MINT}">● live</span>` : ""}</div><div class="big"><span class="sq" style="background:${H.broken ? RED : MINT}"></span><span style="color:${H.broken ? RED : INKc}">${H.broken ? "1 broken" : "All 24 invariants verified"}</span></div>`;
  $("strip").style.opacity = H.strip;
  $("strip").innerHTML = `<span class="pill">■ ${H.broken ? 23 : 24} invariants enforced and verified</span><span class="pill">0 requirements, not yet enforced</span><span class="pill" style="${H.broken ? `border-color:${RED};color:${RED}` : ""}">${H.broken ? "■ 1" : "0"} structural defect${H.broken ? "" : "s"}</span>`;
  $("insp").style.opacity = H.insp;
  $("insp").innerHTML = `<div class="k">Sessions · selected</div><div class="v" style="color:${RED};font-weight:700">✕ 1 broken</div><div class="v">chokepoint <b>sessions.get()</b> protects the session store</div><div class="v" style="color:#B5C0C9">bypass <b>admin/dashboard.ts:42</b> in loadStats</div>`;
  $("change").style.opacity = H.change;
  $("change").innerHTML = `<div class="k">${svgIcon("git-commit")}since the last commit</div><div class="v"><span style="color:${MINT}">+ entrance</span> POST /export</div><div class="v"><span style="color:${MINT}">+ interface</span> Admin → Webhooks</div><div class="v"><span style="color:${MUTED}">− interface</span> Jobs → Webhooks</div>`;
}

// ---------- camera ----------
const V = (a) => new THREE.Vector3(...a);
function cameraAt(t) {
  let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
  const [t0, p0, q0] = KEYS[i], [t1, p1, q1] = KEYS[i + 1], k = ease(clamp((t - t0) / (t1 - t0)));
  camera.position.copy(V(p0).lerp(V(p1), k)); camera.lookAt(V(q0).lerp(V(q1), k));
}

// ---------- frame ----------
const hashT = location.hash.match(/^#t(\d+(?:\.\d+)?)$/);
let t = hashT ? Number(hashT[1]) : 0, playing = !hashT, last = performance.now(), captions = true;
const scrub = $("scrub"), tc = $("tc"), cap = $("caption");
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (playing) { t += dt; if (t > T) t = 0; scrub.value = t; }
  render(t);
  requestAnimationFrame(frame);
}
function render(t) {
  cameraAt(t);
  const cl = applyClarity(clarityAt(t));
  territory.material.color.multiplyScalar(.35);   // the map is the reading; the ground under it stays quiet
  scene.fog.density = .04 * cl.fog;
  sheets.forEach((s, i) => { s.position.x = s.userData.base.x + Math.sin(t * .15 + i) * 2 + t * s.userData.speed; s.material.opacity = s.userData.o * cl.sheets; });
  const { S, H, sea } = timeline(t);
  S.lifted = LIFT_AT !== null && t > LIFT_AT;
  // the pieces rise off the map like the signs: each hinged on its own near edge, up to 45 degrees, in a quick cascade
  const lifting = LIFT_AT !== null && t > LIFT_AT;
  if (lifting) { if (!pieces.length) buildPieces(); placePieces(t, S); }
  pieces.forEach((p) => (p.glow.visible = p.text.visible = lifting));
  territory.material.opacity = 1 - (ORDER ? ORDER(t) : 1); orderGround.material.uniforms.uR.value = ORDER_R(t);
  drawMap(S); hudState(H);
  codeSea.material.opacity = sea.o; codeTex.offset.y = sea.scroll;
  const line = LINES.find(([a, b]) => t >= a && t < b);
  cap.hidden = !captions; cap.textContent = line ? line[2] : "";
  tc.textContent = `${t.toFixed(2)} / ${T.toFixed(2)}`;
  if (typeof EXTRA === "function") EXTRA(t, S);   // a scene's own layer on top of the map (scene 15's field and title)
  composer.render();
  renderer.autoClear = false; renderer.clearDepth(); renderer.render(overlay, camera); renderer.autoClear = true;
}

$("play").onclick = (e) => { playing = !playing; e.target.textContent = playing ? "Pause" : "Play"; last = performance.now(); };
scrub.oninput = () => { t = Number(scrub.value); if (playing) { playing = false; $("play").textContent = "Play"; } };
$("cc").onclick = (e) => { captions = !captions; e.target.textContent = captions ? "Captions on" : "Captions off"; e.target.setAttribute("aria-pressed", String(captions)); };
document.addEventListener("keydown", (e) => { if (e.key === " " && e.target === document.body) { e.preventDefault(); $("play").click(); } });

Promise.all(["200 1em 'Inter'", "500 1em 'Inter'", "500 1em 'Instrument Sans'", "600 1em 'Instrument Sans'", "700 1em 'Instrument Sans'", "400 1em 'IBM Plex Mono'", "700 1em 'IBM Plex Mono'", "600 1em 'JetBrains Mono'"].map((f) => document.fonts.load(f).catch(() => {})))
  .finally(() => { size(); last = performance.now(); requestAnimationFrame(frame); });
