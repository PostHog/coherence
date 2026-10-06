# Assembles the review cut: places every narration clip on the track, swaps in retakes (audio/adr.py), runs every clip
# through the voice chain (audio/voice.py), gives each scene its window, and mixes the soundtrack.
# .venv/bin/python review/assemble.py  →  review/timeline.json, review/mix.mp3, review/review.html
import json, subprocess, sys
from pathlib import Path

promo = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(promo / "audio"))
import voice
TRACK, END = promo / "Black Hole.m4a", 236.5
HARD_CUT = 212.8          # the climax; scene 14 finishes before it, scene 15 starts after
r1 = {str(o["i"]): o for o in json.load(open(promo / "audio/read1/segments.json"))}
r2 = {str(o["i"]): o for o in json.load(open(promo / "audio/read2/segments.json"))}

placed = []   # each: line, scene, text, clip path, clip start on the track, speech start/end on the track
def place(seg, folder, speech_at):
    lead = seg["start"] - seg["cut"][0]
    placed.append({"line": str(seg["i"]), "scene": seg["scene"], "text": seg["text"], "clip": f"{folder}/{seg['file']}",
                   "at": round(speech_at - lead, 3), "start": round(speech_at, 3), "end": round(speech_at + seg["end"] - seg["start"], 3),
                   "cutlen": seg["cut"][1] - seg["cut"][0], "cut": seg["cut"], "transcript": f"{folder}/transcript.json"})

# act one: read 2 was recorded against the track, so its times are track times (the first "staggers" take is the spare),
# except the opening, which is pulled forward: the first line almost at once, and "accident" on the throb at 0:44
FIRST_AT, AGENTS_AT = 0.7, 40.0           # the first line almost at once; "Agents are writing good code by accident" from 0:40
LINE7_ENDS = 38.6                          # the line before it ends just ahead of it
s1 = FIRST_AT - r2["1"]["start"]; s7 = LINE7_ENDS - r2["7"]["end"]
SHIFT = {"1": s1, "2": s1, "8": AGENTS_AT - r2["8"]["start"]}                   # 1 and 2 are one sentence
SHIFT.update({str(i): s1 + (s7 - s1) * (i - 2) / 5 for i in range(3, 8)})       # 3-7 tighten slightly, evenly
# scene 3 ends sooner: scene 4 follows "accident" after a short beat
BEAT = 2.8
s9 = (AGENTS_AT + r2["8"]["end"] - r2["8"]["start"] + BEAT) - r2["9"]["start"]
SHIFT.update({"9": s9, "10": s9, "11": s9})
# "OpenRouter…" stays where it was landed (the drop depends on it); the slack before it is split evenly before scenes 5 and 6
end11 = r2["11"]["end"] + s9
s12 = (end11 + r2["14"]["start"] - r2["12"]["start"] - r2["13"]["end"]) / 2
SHIFT.update({"12": s12, "13": s12})
for k, seg in r2.items():
    if k != "15a": place(seg, "audio/read2", seg["start"] + SHIFT.get(k, 0))

# the rest comes from read 1, keeping its own pauses, starting after read 2's last line with read 1's gap
lines = [str(i) for i in range(18, 39)]      # lines 39 and 40, the old ending, are cut; its new line is 41 (audio/unrecorded.json)
cursor = placed[-1]["end"] + (r1["18"]["start"] - r1["17"]["end"])
prev = None
for k in lines:
    seg = r1[k]
    if prev is not None:
        gap = seg["start"] - prev["end"]
        cursor += gap
    place(seg, "audio/read1", cursor)
    cursor += seg["end"] - seg["start"]
    prev = seg

# lines written after the reads (audio/unrecorded.json) hold a silent place until they have a take: a slot after the
# line before, as long as the words would take to say; the studio records against it and the take replaces it
for k, o in json.loads((promo / "audio/unrecorded.json").read_text()).items():
    start = round(placed[-1]["end"] + .7, 3)
    placed.append({"line": k, "scene": o["scene"], "text": o["text"], "clip": None, "at": start, "start": start,
                   "end": round(start + len(o["text"].split()) / 2.6, 3), "cut": None, "transcript": None})

# act two (scenes 8 to 14) must finish before the hard cut: shrink its pauses evenly until it does
def span(a, b): return [p for p in placed if a <= p["scene"] <= b]
act2 = span(8, 14)
over = act2[-1]["end"] - (HARD_CUT - .5)
if over > 0:
    gaps = [(i, act2[i]["start"] - act2[i - 1]["end"]) for i in range(1, len(act2))]
    room = sum(max(0, g - .45) for _, g in gaps)
    k = min(1, over / room)
    shift = 0
    for i in range(len(act2)):
        if i: shift += max(0, gaps[i - 1][1] - .45) * k
        for key in ("at", "start", "end"): act2[i][key] = round(act2[i][key] - shift, 3)

# act three (scene 15) starts just after the hard cut and must end before the track does
act3 = span(15, 15)
move = (HARD_CUT + .4) - act3[0]["start"]
for p in act3:
    for key in ("at", "start", "end"): p[key] = round(p[key] + move, 3)


# overrides: placements dragged in the review page and read back from its database (line → speech start, seconds)
ov = promo / "review/overrides.json"
if ov.exists():
    for line, start in json.loads(ov.read_text()).items():
        for p in placed:
            if p["line"] == line:
                d = start - p["start"]
                for key in ("at", "start", "end"): p[key] = round(p[key] + d, 3)
    placed.sort(key=lambda p: p["start"])

# retakes: a line with a take in audio/adr/takes.json uses it, starting where the old read started
adr = promo / "audio/adr/takes.json"
if adr.exists():
    for line, r in json.loads(adr.read_text()).items():
        use = r.get("use", len(r["takes"]))
        if not use: continue
        t = r["takes"][use - 1]
        for p in placed:
            if p["line"] == line:
                start = p["start"]
                p.update({"clip": f"audio/adr/{t['folder']}/{t['file']}", "cut": t["cut"], "transcript": f"audio/adr/{t['folder']}/transcript.json",
                          "start": start, "end": round(start + t["end"] - t["start"], 3), "at": round(start - (t["start"] - t["cut"][0]), 3), "adr": use})

# a line written after the reads, if nobody has dragged it, sits where its take was said against the picture,
# or with no take yet, just after the line before it, wherever that line ended up
dragged = json.loads(ov.read_text()) if ov.exists() else {}
takes = json.loads(adr.read_text()) if adr.exists() else {}
unrecorded = json.loads((promo / "audio/unrecorded.json").read_text())
for i, p in enumerate(placed):
    if p["line"] in unrecorded and p["line"] not in dragged and i:
        r = takes.get(p["line"]); t = r and r["takes"][r.get("use", len(r["takes"])) - 1] if r and r.get("use", 1) else None
        n = round((t["place"] if t and t.get("place") is not None else placed[i - 1]["end"] + .7) - p["start"], 3)
        for key in ("at", "start", "end"): p[key] = round(p[key] + n, 3)

# the voice chain: every clip, the same tone, evenness, softened breaths and loudness
for p in placed:
    if not p["clip"]: continue
    words = voice.clip_words(promo / p["transcript"], p["cut"])
    p["processed"] = str(voice.process(promo / p["clip"], words).relative_to(promo))

used = {Path(p["processed"]).name for p in placed if p["clip"]}
for old in (promo / "audio/processed").glob("*.wav"):
    if old.name not in used: old.unlink()

# scene windows: each scene opens just before its first line and runs until the next one opens
FILES = {1: "01-opening", 2: "02-road", 3: "03-specs", 4: "04-corners", 5: "05-machines", 6: "06-result", 7: "07-power", 8: "08-lexicon",
         9: "09-journal", 10: "10-switchboard", 11: "11-bypass", 12: "12-reduce", 13: "13-structure", 14: "14-structure", 15: "15-structure"}
LENGTH = {1: 15, 2: 24, 3: 21, 4: 18.5, 5: 20, 6: 17, 7: 14.5, 8: 25, 9: 18, 10: 12, 11: 17, 12: 13, 13: 12, 14: 15, 15: 22.6}
# every cut lands on a beat: each scene opens just before its first line, snapped to the nearest beat within 0.35 s
BEATS = json.loads((promo / "review/beats.json").read_text())
EDIT = json.loads((promo / "review/edit.json").read_text())
def snap(t):
    b = min(BEATS["beats"], key=lambda x: abs(x - t))
    return b if abs(b - t) <= .35 else t
def opening(n):
    # just before the scene's first line, on a beat if one is near, but never while the scene before is still speaking
    first = min(p["start"] for p in placed if p["scene"] == n)
    floor = max((p["end"] for p in placed if p["scene"] < n), default=0) + .05
    near = [b for b in BEATS["beats"] if floor <= b <= first and abs(b - (first - .6)) <= .35]
    return min(near, key=lambda b: abs(b - (first - .6))) if near else max(first - .6, min(floor, first))
starts = {n: (0 if n == 1 else opening(n)) for n in range(1, 16)}
# the film ends with scene 15, which ends with the narration; the music fades out with it
CUT_END = round(starts[15] + LENGTH[15], 3)
scenes = [{"n": n, "file": FILES[n], "length": LENGTH.get(n), "start": round(starts[n], 3), "end": round(starts[n + 1] if n < 15 else CUT_END, 3),
           **{k: v for k, v in EDIT["io"].get(str(n), {}).items() if k in ("in", "out", "dissolve")}, "hits": EDIT["hits"].get(str(n), [])} for n in range(1, 16)]

# the page mixes live: the bare music, and each clip as its own small file
(promo / "review/clips").mkdir(exist_ok=True)
for p in placed:
    if not p["clip"]: p["src"] = None; continue
    p["src"] = "clips/" + Path(p["processed"]).stem + ".mp3"
    out = promo / "review" / p["src"]
    if not out.exists():
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(promo / p["processed"]), "-c:a", "libmp3lame", "-b:a", "160k", str(out)], check=True)
# clips no longer in the cut are cleared out, so the published page carries only what plays
live = {Path(p["src"]).name for p in placed if p["src"]}
for old in (promo / "review/clips").glob("*.mp3"):
    if old.name not in live: old.unlink()
music = promo / "review/music.mp3"
if not music.exists():
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(TRACK), "-t", str(END), "-c:a", "libmp3lame", "-b:a", "192k", str(music)], check=True)
# the review's own settings (the music level), saved from the studio; the page starts where you left it
settings = json.loads((promo / "review/settings.json").read_text()) if (promo / "review/settings.json").exists() else {}
timeline = {"settings": settings, "track": CUT_END, "trackFull": END, "hardCut": HARD_CUT, "beats": BEATS["beats"], "phrases": BEATS["phrases"], "scenes": scenes, "lines": [{**{k: p[k] for k in ("line", "scene", "text", "clip", "at", "start", "end", "src")}, "adr": p.get("adr", 0), "unread": not p["clip"], "lead": round(p["start"] - p["at"], 3)} for p in placed]}
(promo / "review/timeline.json").write_text(json.dumps(timeline, indent=1))

# the mix: the track under the narration, each clip delayed to its place
inputs, chains = ["-i", str(TRACK)], []
voiced = [p for p in placed if p["clip"]]
for i, p in enumerate(voiced, start=1):
    inputs += ["-i", str(promo / p["processed"])]
    ms = int(max(0, p["at"]) * 1000)
    chains.append(f"[{i}:a]aformat=channel_layouts=stereo,adelay={ms}|{ms}[n{i}]")
mix = ";".join(chains) + f";[0:a]volume=0.55[m];[m]" + "".join(f"[n{i}]" for i in range(1, len(voiced) + 1)) + f"amix=inputs={len(voiced) + 1}:normalize=0:duration=first,alimiter=limit=0.95,afade=t=out:st={CUT_END - 1.5}:d=1.5[out]"
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", mix, "-map", "[out]", "-t", str(CUT_END), "-c:a", "libmp3lame", "-b:a", "192k", str(promo / "review/mix.mp3")], check=True)
for s in scenes: print(f"scene {s['n']:2d}  {s['start']:7.2f} → {s['end']:7.2f}  ({s['end'] - s['start']:5.1f} s; built {s['length']})")
print(f"act two ends {act2[-1]['end']:.2f}, act three ends {act3[-1]['end']:.2f}")

# the review page: the player with this timeline inside it
page = (promo / "review/player.html").read_text().replace("/*TIMELINE*/null", json.dumps(timeline))
(promo / "review/review.html").write_text(page)
