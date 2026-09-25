# Voice processing: every narration clip passes through here on its way into the mix, so a read, a retake,
# and a line recorded on another day all come out sounding like one session.
#
#   1. tone: a high-pass at 80 Hz takes out rumble and plosive thumps (no de-esser: nothing here changes the voice itself);
#      retakes recorded in the studio (audio/adr/) come in 3-5 dB more forward at 2-5 kHz than the reads, so they get a
#      gentle presence cut to sit with them (STUDIO_EQ)
#   2. evenness: no compressor — after a loud peak it dipped the next soft syllable, and the read is already even
#   3. breaths: OFF (see BREATHS) — softening by word timings clipped syllables
#   4. level: each clip is measured (EBU R128) and set to the same loudness, TARGET; a limiter keeps peaks under -1.5 dBFS
#
# process(clip, words) -> path of the processed clip, cached under audio/processed/ until the source changes.
import json, subprocess, hashlib
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / "processed"
SR = 48000
TARGET = -18.0          # LUFS, every clip: close to where the reads already sit, so the limiter rarely has work
GAP_DB, EDGE_DB = -14.0, -18.0
# Off: the transcriber's word timings are too loose to find the gaps between words, so softening them clipped real
# syllables. Breaths need an energy-based detector, not word timings, before this comes back.
BREATHS = False
RAMP = .02              # seconds, the fade into and out of each softened gap
STUDIO_EQ = "equalizer=f=3400:t=q:w=0.8:g=-3.5"   # retakes only: matches their presence to the reads
VERSION = "voice-7"     # bump when the chain changes, so every clip is redone

def _read(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def _write(x, path):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "pcm_s24le", str(path)], input=x.astype(np.float32).tobytes(), check=True)

def _breath_gain(n, words):
    """A gain curve: 1 over the words, softened in the gaps between them and at the clip's head and tail."""
    g = np.ones(n, dtype=np.float32)
    if not words: return g
    gap, edge, r = 10 ** (GAP_DB / 20), 10 ** (EDGE_DB / 20), int(RAMP * SR)
    def soften(a, b, level):
        a, b = max(0, int(a * SR)), min(n, int(b * SR))
        if b - a < 2 * r + 1: return
        g[a:b] = np.minimum(g[a:b], level)
        g[a:a + r] = np.minimum(g[a:a + r], np.linspace(1, level, r))
        g[b - r:b] = np.minimum(g[b - r:b], np.linspace(level, 1, r))
    soften(0, words[0][0] - .04, edge)                               # the breath before the line
    for (s0, e0), (s1, e1) in zip(words, words[1:]):
        if s1 - e0 > .14: soften(e0 + .04, s1 - .03, gap)            # breaths between words; short gaps are left alone
    soften(words[-1][1] + .12, n / SR, edge)                         # the tail, after the last word has decayed
    return g

def _loudness(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    line = [l for l in out.splitlines() if l.strip().startswith("I:")][-1]
    return float(line.split()[1])

def process(clip, words):
    """clip: a wav path. words: [(start, end), ...] in seconds within the clip."""
    clip = Path(clip)
    key = hashlib.sha1(f"{VERSION}|{clip}|{clip.stat().st_mtime}|{json.dumps(words)}".encode()).hexdigest()[:12]
    OUT.mkdir(exist_ok=True)
    out = OUT / f"{clip.parent.name}-{clip.stem}-{key}.wav"
    if out.exists(): return out
    stage = OUT / f"_stage-{key}.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(clip), "-ac", "1", "-ar", str(SR), "-af",
                    "highpass=f=80" + ("," + STUDIO_EQ if "adr" in clip.parts else ""),
                    "-c:a", "pcm_s24le", str(stage)], check=True)
    x = _read(stage)
    if BREATHS: x *= _breath_gain(len(x), words)
    shaped = OUT / f"_shaped-{key}.wav"
    _write(x, shaped)
    gain = TARGET - _loudness(shaped)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(shaped), "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:attack=5:release=120:level=disabled",
                    "-c:a", "pcm_s24le", str(out)], check=True)
    stage.unlink(); shaped.unlink()
    return out

def clip_words(transcript, cut):
    """Word timings from a whole-take transcript, shifted into one clip's own time."""
    lo, hi = cut
    ws = [w for s in json.load(open(transcript))["segments"] for w in s["words"]]
    return [(round(w["start"] - lo, 3), round(w["end"] - lo, 3)) for w in ws if w["start"] >= lo - .02 and w["end"] <= hi + .02 and w["end"] > w["start"]]
