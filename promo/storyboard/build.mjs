// Builds the storyboard page from promo/script.md and the track.
// node promo/storyboard/build.mjs  →  promo/storyboard/storyboard.html
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const promo = join(here, "..");
const scriptText = readFileSync(join(promo, "script.md"), "utf8");
const trackPath = join(promo, "Black Hole.m4a");

// Measured from the track (spectrogram, loudness, low-band energy): see "Black Hole structure.png".
const DURATION = 236.49;
const ACTS = [
  { id: "I", name: "Introduction", from: 0, to: 96.3 },
  { id: "II", name: "Rising action · climax", from: 96.3, to: 212.8 },
  { id: "III", name: "Resolution", from: 212.8, to: DURATION },
];
const MARKERS = [
  { t: 4.0, label: "music in", major: false },
  { t: 19.2, label: "bass enters", major: true },
  { t: 42.2, label: "bass shift", major: true },
  { t: 49.9, label: "", major: false },
  { t: 65.2, label: "", major: false },
  { t: 72.7, label: "", major: false },
  { t: 80.7, label: "", major: false },
  { t: 96.3, label: "the drop", major: true },
  { t: 130.2, label: "full return", major: true },
  { t: 160.0, label: "bright plateau", major: false },
  { t: 187.8, label: "texture shift", major: true },
  { t: 205.0, label: "peak", major: false },
  { t: 212.8, label: "hard cut", major: true },
  { t: 225.0, label: "fade", major: false },
];
// Where an unmarked scene is estimated from: the script's own landing notes.
const ANCHORS = { 1: 4.0, 8: 96.3, 15: 212.8, end: 230.0 };

function parseScenes(text) {
  const scenes = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const head = line.match(/^\*\*\*(\d+)\s*(?:\((.*)\))?/);
    if (head) {
      cur = { n: Number(head[1]), note: head[2] ?? "", fields: {}, paras: [] };
      scenes.push(cur);
      continue;
    }
    if (!cur) continue;
    const field = line.match(/^(at|sync|picture|supers|source|transition):\s*(.*)$/);
    if (field && cur.paras.length === 0) { cur.fields[field[1]] = field[2].trim(); continue; }
    if (line.trim()) cur.paras.push(line.trim());
  }
  for (const s of scenes) s.words = s.paras.join(" ").split(/\s+/).filter(Boolean).length;
  return scenes;
}

function peaks(path, buckets) {
  const pcm = execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
    { maxBuffer: 1 << 28 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1);
  const per = Math.floor(samples.length / buckets);
  const out = [];
  for (let b = 0; b < buckets; b++) {
    let sum = 0;
    for (let i = b * per; i < (b + 1) * per; i++) sum += samples[i] * samples[i];
    out.push(Math.round(Math.sqrt(sum / per) / 32768 * 1000) / 1000);
  }
  return out;
}

const data = {
  duration: DURATION, acts: ACTS, markers: MARKERS, anchors: ANCHORS,
  scenes: parseScenes(scriptText), raw: scriptText, peaks: peaks(trackPath, 1400),
};
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const template = readFileSync(join(here, "page.html"), "utf8");
writeFileSync(join(here, "storyboard.html"), template.replace("/*DATA*/null", json));
console.log(`storyboard.html: ${data.scenes.length} scenes, ${data.peaks.length} peaks`);
