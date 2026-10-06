// The final render, driven through a headless Chrome of its own. The review studio (review/studio.py) must be running.
//   node review/render.mjs mix       the mix, offline, through the review page's own audio graph → review/master/mix-raw.wav
//   node review/render.mjs stills | frames | finish   the picture, frame by frame (see below)
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

async function mix(review = false, noVoice = false) {
  const b = await browser();
  try {
    await b.call("Page.navigate", { url: `${STUDIO}/master.html` }); await new Promise((r) => setTimeout(r, 1000));
    const t0 = Date.now();
    const info = await b.ev(`mixdown({ review: ${review}, noVoice: ${noVoice} })`);
    console.log(`rendered ${info.seconds.toFixed(2)} s of mix in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const raw = path.join(PROMO, "review/master/mix-raw.f32"), fd = fs.openSync(raw, "w"), STEP = 480000;
    for (let s = 0; s < info.frames; s += STEP) fs.writeSync(fd, Buffer.from(await b.ev(`slice(${s}, ${STEP})`), "base64"));
    fs.closeSync(fd);
    await new Promise((res, rej) => spawn("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", raw, "-c:a", "pcm_f32le",
      path.join(PROMO, `review/master/mix-raw${review ? "-review" : ""}${noVoice ? "-music" : ""}.wav`)], { stdio: "inherit" }).on("exit", (c) => (c ? rej(new Error("ffmpeg " + c)) : res())));
    fs.unlinkSync(raw);
    if (b.errors.length) console.log("page errors:", b.errors);
    console.log(`→ review/master/mix-raw${review ? "-review" : ""}${noVoice ? "-music" : ""}.wav`);
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

// node review/render.mjs frames <dpr> [fps]   the whole cut, in 10 s chunks under render/<width>p/, each piped straight from
// the captures into the Mac's hardware H.264 encoder; a chunk already on disk is skipped, so a stopped render resumes
const FPS_DEFAULT = 30, CHUNK = 300;
const run = (bin, args, input) => new Promise((res, rej) => {
  const p = spawn(bin, args, { stdio: [input ? "pipe" : "ignore", "ignore", "inherit"] });
  p.on("exit", (c) => (c ? rej(new Error(`${bin} exited ${c}`)) : res())); if (input) input(p.stdin);
});
async function frames(dpr, fps = FPS_DEFAULT) {
  const tl = JSON.parse(fs.readFileSync(path.join(PROMO, "review/timeline.json"), "utf8"));
  const total = Math.round(tl.track * fps), dir = path.join(PROMO, `render/${1080 * dpr}p`); fs.mkdirSync(dir, { recursive: true });
  const chunks = Math.ceil(total / CHUNK), started = Date.now(); let done = 0;
  let b = null;
  try {
    for (let c = 0; c < chunks; c++) {
      const out = path.join(dir, `chunk-${String(c).padStart(4, "0")}.mp4`);
      if (fs.existsSync(out)) continue;
      if (!b) b = await page(dpr);
      const from = c * CHUNK, to = Math.min(total, from + CHUNK), part = out + ".part.mp4";
      const enc = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-c:v", "h264_videotoolbox", "-profile:v", "high",
        "-b:v", "25M", "-maxrate", "32M", "-bufsize", "50M", "-g", String(fps * 2),
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", "-an", part], { stdio: ["pipe", "ignore", "inherit"] });
      const encoded = new Promise((res, rej) => enc.on("exit", (code) => (code ? rej(new Error("encoder exited " + code)) : res())));
      for (let i = from; i < to; i++) {
        await b.ev(`renderAt(${(i / fps).toFixed(5)})`);
        const png = await shot(b);
        if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once("drain", r));
      }
      enc.stdin.end(); await encoded; fs.renameSync(part, out);
      done += to - from;
      const rate = done / ((Date.now() - started) / 1000), left = (total - to) / rate;
      console.log(`chunk ${c + 1}/${chunks}  frames ${to}/${total}  ${rate.toFixed(1)} fps  ~${Math.ceil(left / 60)} min left  free mem ${(os.freemem() / 2 ** 30).toFixed(1)} GB${b.errors.length ? "  page errors: " + b.errors.splice(0).join(" | ") : ""}`);
    }
  } finally { if (b) await b.close(); }
  console.log(`all ${chunks} chunks in ${dir}`);
}

// node review/render.mjs finish <dpr> [name]   the chunks joined, with the master mix → render/<name or coherence-<width>p>.mp4
async function finish(dpr, name) {
  const dir = path.join(PROMO, `render/${1080 * dpr}p`), list = path.join(dir, "chunks.txt");
  const parts = fs.readdirSync(dir).filter((f) => /^chunk-\d+\.mp4$/.test(f)).sort();
  fs.writeFileSync(list, parts.map((f) => `file '${path.join(dir, f)}'`).join("\n") + "\n");
  const out = path.join(PROMO, `render/${name || `coherence-${1080 * dpr}p`}.mp4`);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-i", path.join(PROMO, "review/master/mix.wav"),
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", out]);
  console.log(`→ ${path.relative(PROMO, out)}  ${(fs.statSync(out).size / 1e6).toFixed(0)} MB`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "mix") await mix(rest.includes("review"), rest.includes("music"));
else if (cmd === "stills") await stills(+rest[0], rest.slice(1).map(Number));
else if (cmd === "frames") await frames(+rest[0], +rest[1] || FPS_DEFAULT);
else if (cmd === "finish") await finish(+rest[0], rest[1]);
else { console.log("node review/render.mjs mix | frames …"); process.exit(1); }
process.exit(0);
