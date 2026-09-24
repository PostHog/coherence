// Renders each built scene's still moments into frames/ for the storyboard.
// node promo/storyboard/capture.mjs [sceneNumber...]   (needs Google Chrome and ffmpeg)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const scenesDir = join(here, "..", "scenes"), out = join(here, "frames"), tmp = join(tmpdir(), "promo-capture");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const registry = JSON.parse(readFileSync(join(here, "scenes.json"), "utf8"));
const only = process.argv.slice(2);
mkdirSync(out, { recursive: true }); mkdirSync(tmp, { recursive: true });
for (const [n, sc] of Object.entries(registry)) {
  if (only.length && !only.includes(n)) continue;
  // the stage alone: no header, no captions, at a fixed spot so it crops cleanly
  const page = join(tmp, `${sc.file}.html`);
  writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>.wrap>header,.caption{display:none!important}</style></head><body>${readFileSync(join(scenesDir, `${sc.file}.html`), "utf8")}</body></html>`);
  sc.stills.forEach((t, i) => {
    const shot = join(tmp, `${sc.file}-${i}.png`);
    execFileSync(CHROME, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,800", "--virtual-time-budget=6000", `--screenshot=${shot}`, `file://${page}#t${t}`], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", shot, "-vf", "crop=1240:697:20:24,scale=640:-1", "-q:v", "4", join(out, `${n.padStart(2, "0")}-${i}.jpg`)]);
  });
  console.log(`scene ${n}: ${sc.stills.length} stills`);
}
rmSync(tmp, { recursive: true, force: true });
