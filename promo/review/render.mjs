// The final render, driven through a headless Chrome of its own. The review studio (review/studio.py) must be running.
//   node review/render.mjs mix       the mix, offline, through the review page's own audio graph → review/master/mix-raw.wav
//   node review/render.mjs frames …  the picture, frame by frame (see frames() below)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROMO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const STUDIO = "http://localhost:8830";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9341;

async function browser(extra = []) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "promo-render-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--autoplay-policy=no-user-gesture-required",
    "--hide-scrollbars", "--mute-audio", ...extra, "about:blank"], { stdio: "ignore" });
  for (let k = 0; k < 50; k++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl); let id = 0; const pend = new Map(); const errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description?.slice(0, 300)); };
  await new Promise((r) => (ws.onopen = r));
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "evaluate failed");
    return r.result?.result?.value;
  };
  await call("Runtime.enable"); await call("Page.enable");
  const close = async () => {
    try { ws.close(); } catch {}
    const gone = new Promise((r) => proc.once("exit", r)); proc.kill(); await gone;
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}   // Chrome's own leftovers can linger a moment
  };
  return { call, ev, errors, close };
}

async function mix() {
  const b = await browser();
  try {
    await b.call("Page.navigate", { url: `${STUDIO}/master.html` }); await new Promise((r) => setTimeout(r, 1000));
    const t0 = Date.now();
    const info = await b.ev("mixdown()");
    console.log(`rendered ${info.seconds.toFixed(2)} s of mix in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const raw = path.join(PROMO, "review/master/mix-raw.f32"), fd = fs.openSync(raw, "w"), STEP = 480000;
    for (let s = 0; s < info.frames; s += STEP) fs.writeSync(fd, Buffer.from(await b.ev(`slice(${s}, ${STEP})`), "base64"));
    fs.closeSync(fd);
    await new Promise((res, rej) => spawn("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", raw, "-c:a", "pcm_f32le",
      path.join(PROMO, "review/master/mix-raw.wav")], { stdio: "inherit" }).on("exit", (c) => (c ? rej(new Error("ffmpeg " + c)) : res())));
    fs.unlinkSync(raw);
    if (b.errors.length) console.log("page errors:", b.errors);
    console.log("→ review/master/mix-raw.wav");
  } finally { await b.close(); }
}

// the picture: the review page in render mode, a 1920×1080 layout at 4× density (7680×4320), one exact frame at a time
async function page(dpr) {
  const b = await browser(["--enable-gpu-rasterization", "--ignore-gpu-blocklist"]);
  await b.call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: dpr, mobile: false });
  await b.call("Page.navigate", { url: `${STUDIO}/?render&maxdpr=${dpr}` });
  for (let k = 0; k < 100 && !(await b.ev("typeof renderAt === 'function' && !!window.TL").catch(() => false)); k++) await new Promise((r) => setTimeout(r, 100));
  return b;
}
const shot = async (b) => Buffer.from((await b.call("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })).result.data, "base64");

// node review/render.mjs stills <dpr> <t> <t> …   single frames to render/stills/, timed: the test before a full render
async function stills(dpr, times) {
  const b = await page(dpr), dir = path.join(PROMO, "render/stills"); fs.mkdirSync(dir, { recursive: true });
  try {
    for (const t of times) {
      const a = Date.now(), what = await b.ev(`renderAt(${t})`), c = Date.now(), png = await shot(b), d = Date.now();
      const f = path.join(dir, `${dpr}x-${t}.png`); fs.writeFileSync(f, png);
      console.log(`t=${t} scenes ${what}: draw ${c - a} ms, capture ${d - c} ms, ${(png.length / 1e6).toFixed(1)} MB → ${path.relative(PROMO, f)}`);
    }
    if (b.errors.length) console.log("page errors:", b.errors);
  } finally { await b.close(); }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "mix") await mix();
else if (cmd === "stills") await stills(+rest[0], rest.slice(1).map(Number));
else { console.log("node review/render.mjs mix | frames …"); process.exit(1); }
process.exit(0);
