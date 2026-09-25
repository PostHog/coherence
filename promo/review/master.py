# The final mix, in three steps:
#   .venv/bin/python review/master.py prep    → review/master/: the music (full quality), every voice clip, the music's level curve
#   node review/render.mjs mix                → review/master/mix-raw.wav, rendered by the browser's audio engine through the
#                                               same graph the review page plays (its limiters' makeup gain included), offline
#   .venv/bin/python review/master.py finish  → review/master/mix.wav: the whole mix set to -14 LUFS, peaks under -1 dBFS
#
# The music level is the one set in the studio (review/settings.json, 0.05), and it follows the track: where the music
# is at its loudest, the climax, it eases down to CLIMAX_LEVEL, so the voice stays on top without anyone riding a fader.
import json, re, shutil, subprocess, sys
from pathlib import Path

promo = Path(__file__).resolve().parent.parent
review = promo / "review"
out = review / "master"
TRACK = promo / "Black Hole.m4a"
CLIMAX_LEVEL = .04
QUIET_LUFS, LOUD_LUFS = -11.0, -8.5        # the track's short-term loudness: at or below QUIET the level is the studio's; at LOUD, CLIMAX_LEVEL
SMOOTH = 1.5                               # seconds: the level moves no faster than this
RATE = 20                                  # level curve points per second
TARGET_LUFS, CEILING = -14.0, .84          # the delivered mix: web loudness, peaks under -1 dBFS

def smoothstep(a, b, x):
    k = min(1, max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k)

def prep():
    tl = json.loads((review / "timeline.json").read_text())
    level = tl.get("settings", {}).get("music", .05)
    if out.exists(): shutil.rmtree(out)
    out.mkdir()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(TRACK), "-t", str(tl["track"]), "-ar", "48000", "-c:a", "pcm_f32le", str(out / "music.wav")], check=True)
    # the track's short-term loudness, every 100 ms
    log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(TRACK), "-t", str(tl["track"]), "-af", "ebur128=metadata=1,ametadata=print:key=lavfi.r128.S", "-f", "null", "-"], capture_output=True, text=True).stderr
    pts = [float(x) for x in re.findall(r"pts_time:([0-9.]+)", log)]
    st = [float(x) for x in re.findall(r"lavfi\.r128\.S=(-?[0-9.]+)", log)]
    n = int(tl["track"] * RATE) + 1
    raw, j = [], 0
    for i in range(n):
        t = i / RATE
        while j + 1 < len(pts) and pts[j + 1] <= t: j += 1
        s = st[j] if st else -70
        raw.append(level - (level - CLIMAX_LEVEL) * smoothstep(QUIET_LUFS, LOUD_LUFS, s))
    w = int(SMOOTH * RATE)
    curve = [sum(raw[max(0, i - w):i + w + 1]) / len(raw[max(0, i - w):i + w + 1]) for i in range(n)]
    lines = []
    for l in tl["lines"]:
        if not l["src"]: continue
        stem = Path(l["src"]).stem
        src = promo / "audio/processed" / f"{stem}.wav"
        shutil.copy(src, out / f"{l['line']}.wav")
        lines.append({"line": l["line"], "file": f"{l['line']}.wav", "at": round(l["start"] - l["lead"], 4)})
    (out / "plan.json").write_text(json.dumps({"track": tl["track"], "rate": RATE, "curve": [round(c, 5) for c in curve], "lines": lines}))
    dips = [(i / RATE, c) for i, c in enumerate(curve)]
    low = [t for t, c in dips if c < level - .002]
    print(f"music level {level} (studio), easing to {CLIMAX_LEVEL} at the loudest; {len(lines)} voice clips")
    if low:
        spans, a = [], low[0]
        for p, q in zip(low, low[1:] + [None]):
            if q is None or q - p > .2: spans.append((a, p)); a = q
        for a, b in spans:
            m = min(c for t, c in dips if a <= t <= b)
            print(f"  dips {int(a)//60}:{a%60:04.1f}–{int(b)//60}:{b%60:04.1f}, lowest {m:.3f}")

def finish():
    raw = out / "mix-raw.wav"
    log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(raw), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    I = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", log)[-1])
    gain = TARGET_LUFS - I
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", f"volume={gain:.2f}dB,alimiter=limit={CEILING}:attack=5:release=80:level=disabled",
                    "-ar", "48000", "-c:a", "pcm_s24le", str(out / "mix.wav")], check=True)
    log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(out / "mix.wav"), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    I2 = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", log)[-1]); pk = float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", log)[-1])
    print(f"raw mix {I:.1f} LUFS → {I2:.1f} LUFS, true peak {pk:.1f} dBFS  →  {out / 'mix.wav'}")

if __name__ == "__main__":
    {"prep": prep, "finish": finish}[sys.argv[1]]()
