// Shared by every scene: utilities, the renderer with its bloom, fog sheets, and the territory's ground.
// Inlined at /*COMMON*/ by build.mjs; the scene defines C, T and ICONS before it.
// ---------- utilities ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (k) => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const rand = (() => { let s = 20260923; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
function icon(ctx, name, x, y, size, color, width = 1.5) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const d of ICONS[name] || []) ctx.stroke(new Path2D(d));
  ctx.restore();
}
function svgIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${(ICONS[name] || []).map((d) => `<path d="${d}"/>`).join("")}</svg>`;
}
function wrap(ctx, text, maxW) {
  const words = text.split(" "), lines = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}

// ---------- renderer ----------
const stage = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("gl"), antialias: true });
// a final render asks for more (?maxdpr=4 draws a 1920×1080 layout at 8K); on screen, 2× is plenty
renderer.setPixelRatio(Math.min(+new URLSearchParams(location.search).get("maxdpr") || 2, window.devicePixelRatio || 1));
const scene = new THREE.Scene();
scene.background = new THREE.Color(C.bg);
scene.fog = new THREE.FogExp2(C.fog, 0.042);
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 300);
const composer = new THREE.EffectComposer(renderer);
composer.addPass(new THREE.RenderPass(scene, camera));
const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(1280, 720), 0.85, 0.55, 0.18);
composer.addPass(bloom);
function size() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false); composer.setSize(r.width, r.height);
}
new ResizeObserver(size).observe(stage);

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// ---------- fog sheets ----------
function noiseTex() {
  return canvasTex(512, 256, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    const grid = (n) => { const a = []; for (let i = 0; i < (n + 1) * (n + 1); i++) a.push(rand()); return a; };
    const octaves = [[6, .5], [12, .3], [24, .2]].map(([n, amp]) => ({ n, amp, g: grid(n) }));
    const val = (o, x, y) => {
      const fx = x * o.n, fy = y * o.n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const at = (i, j) => o.g[(j % o.n) * (o.n + 1) + (i % o.n)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0; for (const o of octaves) v += val(o, x / w, y / h) * o.amp;
      const edge = Math.sin(Math.PI * x / w) * Math.sin(Math.PI * y / h);
      const a = clamp((v - .22) * 1.5) * edge;
      const i = (y * w + x) * 4; d[i] = 170; d[i + 1] = 190; d[i + 2] = 205; d[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
  });
}
const fogTex = noiseTex();
const sheets = [];
for (let i = 0; i < 12; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(64, 12), new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, opacity: .16, fog: false }));
  m.position.set((rand() - .5) * 14, -3 + rand() * 2.6, -6 - i * 6);
  m.userData = { base: m.position.clone(), speed: (rand() - .5) * .35, o: .06 + rand() * .07, near: i < 4 };
  m.renderOrder = 2; scene.add(m); sheets.push(m);
}

// ---------- the territory: a map's ground, fogged ----------
const territory = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({
  map: canvasTex(2048, 2048, (g, w) => {
    g.fillStyle = "#07090C"; g.fillRect(0, 0, w, w);
    g.strokeStyle = "#1B252D"; g.lineWidth = 3; g.lineJoin = "round";
    for (let r = 0; r < 70; r++) {
      let x = rand() * w, y = rand() * w; g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 5; s++) { if (s % 2) x += (rand() - .5) * 700; else y += (rand() - .5) * 700; g.lineTo(x, y); }
      g.stroke();
    }
    g.strokeStyle = "#24313A"; g.lineWidth = 2;
    for (let s = 0; s < 120; s++) { const x = rand() * w, y = rand() * w; g.strokeRect(x, y, 40 + rand() * 90, 22 + rand() * 30); }
  }),
}));
territory.rotation.x = -Math.PI / 2; territory.position.set(0, -6.02, -16); scene.add(territory);

// ---------- clarity: act two burns the fog off, scene by scene ----------
// A scene sets CLARITY = [start, end] before this code; each starts where the last one ended, so the clearing runs across cuts.
// At 0 the fog is act one's; at 1 the air is clear and the territory under the map is lit.
function clarityAt(t) { return typeof CLARITY === "undefined" ? 0 : CLARITY[0] + (CLARITY[1] - CLARITY[0]) * clamp(t / T); }
function applyClarity(c) {
  territory.material.color.setScalar(1 + 2.4 * c);
  return { fog: 1 - .85 * c, sheets: 1 - c };
}

// ---------- driven: a review player can set the scene's time from outside, with postMessage({ t }) ----------
// (t, playing and T are the scene's own; this runs later, once they exist)
window.addEventListener("message", (e) => { const d = e.data || {}; if (typeof d.t === "number") { t = Math.min(T, Math.max(0, d.t)); playing = false; } });
// a final render sets the time and draws at once, so the frame it captures is exactly this t (review/render.mjs)
window.renderAt = (x) => { t = Math.min(T, Math.max(0, x)); playing = false; render(t); };
