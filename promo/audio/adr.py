# ADR: record retakes of any narration line, drop them in, and they replace the old read in place.
#
#   .venv/bin/python audio/adr.py ~/Documents/retake.wav              any lines, found by what you said
#   .venv/bin/python audio/adr.py ~/Documents/retake.wav --lines 15   only these lines (comma-separated)
#   .venv/bin/python audio/adr.py --list                              what's been retaken, and which take is in use
#   .venv/bin/python audio/adr.py --use 15 2                          put line 15's second take back in (0 = the original read)
#   .venv/bin/python review/studio.py                                  or record against the picture, in the review page
#
# A take file can hold one line or many, and any number of tries at each: the tool transcribes it, finds each script
# line by its words, and keeps the LAST try of each line as the take (the way a session usually ends on the keeper).
# Every take is kept; --use switches between them. The line keeps its place on the timeline: the retake starts
# where the old read started, so a longer or shorter retake moves only its own end. Then rebuild the cut:
#   .venv/bin/python review/assemble.py
import argparse, datetime, difflib, json, re, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROMO = HERE.parent
ADR = HERE / "adr"
REGISTRY = ADR / "takes.json"

def script_lines():
    """Every narration line, numbered as the clips are: the same order and splits as read 1's segments."""
    # act one's current wording lives in read 2's segments, the rest in read 1's (both follow script.md)
    lines = {}
    for folder in ("read1", "read2"):
        for o in json.load(open(HERE / folder / "segments.json")):
            k = str(o["i"])
            if k.isdigit() and (folder == "read2" or k not in lines): lines[k] = {"scene": o["scene"], "text": o["text"]}
    # lines written after the reads: in the script, waiting for their first take
    for k, o in json.load(open(HERE / "unrecorded.json")).items(): lines.setdefault(k, o)
    return lines

norm = lambda w: re.sub(r"[^a-z0-9]", "", w.lower().replace("choke point", "chokepoint").replace("open router", "openrouter"))
NUM = {"20": "twenty", "2030": "2030"}

def words_of(text):
    return [NUM.get(norm(w), norm(w)) for w in text.replace("-", " ").split() if norm(w)]

def load(path, default):
    return json.load(open(path)) if Path(path).exists() else default

def transcribe(wav):
    import mlx_whisper
    return mlx_whisper.transcribe(str(wav), path_or_hf_repo="mlx-community/whisper-large-v3-turbo", word_timestamps=True, language="en")

def find_last(line_words, heard):
    """The last place in the take where this line was said: (first word index, last word index, match ratio), or None."""
    n, best = len(line_words), None
    firsts = {line_words[0], line_words[1] if n > 1 else line_words[0]}
    for i, h in enumerate(heard):
        if h["w"] not in firsts: continue
        window = [x["w"] for x in heard[i:i + n + 3]]
        sm = difflib.SequenceMatcher(None, line_words, window, autojunk=False)
        ratio = sum(b.size for b in sm.get_matching_blocks()) / n
        if ratio < .7: continue
        blocks = [b for b in sm.get_matching_blocks() if b.size]
        j_end = i + blocks[-1].b + blocks[-1].size - 1
        # the last try wins; within one try, the window that starts earliest (so the first word isn't lost)
        if best is None or j_end > best[1] or (j_end == best[1] and i < best[0]): best = (i, j_end, ratio)
    return best

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("take", nargs="?")
    ap.add_argument("--lines")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--use", nargs=2, metavar=("LINE", "TAKE"))
    ap.add_argument("--at", type=float, help="recorded against the picture: the cut time where the take's audio begins; each line is placed where you said it")
    ap.add_argument("--json", action="store_true", help="print a machine-readable summary last (the review studio reads it)")
    a = ap.parse_args()
    reg = load(REGISTRY, {})
    lines = script_lines()

    if a.list:
        if not reg: print("no retakes yet"); return
        for k in sorted(reg, key=int):
            r = reg[k]; use = r.get("use", len(r["takes"]))
            print(f"line {k:>2} (scene {lines[k]['scene']}): {len(r['takes'])} take(s), using {'the original read' if use == 0 else 'take ' + str(use)}")
            for n, t in enumerate(r["takes"], 1): print(f"    {n}. {t['source']}  “{t['heard']}”")
        return
    if a.use:
        k, n = a.use[0], int(a.use[1])
        if k not in reg or not 0 <= n <= len(reg[k]["takes"]): sys.exit(f"line {k} has no take {n}")
        reg[k]["use"] = n; json.dump(reg, open(REGISTRY, "w"), indent=1)
        print(f"line {k} now uses {'the original read' if n == 0 else 'take ' + str(n)}; rebuild with review/assemble.py"); return
    if not a.take: ap.print_help(); return

    src = Path(a.take).expanduser()
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    folder = ADR / f"{stamp}-{re.sub(r'[^A-Za-z0-9]+', '-', src.stem).strip('-')}"
    folder.mkdir(parents=True)
    wav = folder / "source.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c:a", "pcm_s24le", str(wav)], check=True)
    print(f"transcribing {src.name}…")
    t = transcribe(wav)
    json.dump(t, open(folder / "transcript.json", "w"))
    heard = [{"w": NUM.get(norm(w["word"]), norm(w["word"])), "raw": w["word"], "start": w["start"], "end": w["end"]} for s in t["segments"] for w in s["words"] if norm(w["word"])]
    wanted = a.lines.split(",") if a.lines else list(lines)
    found = []
    for k in wanted:
        hit = find_last(words_of(lines[k]["text"]), heard)
        if hit: found.append((k, hit))
    if not found:
        print("no script line found in this take. What was heard:\n  " + " ".join(h["raw"] for h in heard)); shutil.rmtree(folder)
        if a.json: print(json.dumps({"takes": [], "heard": " ".join(h["raw"] for h in heard)}))
        return
    # a reworded line can open or close with words the script lacks ("We start…" for "Starts…"): words said in the
    # same breath, up to three, belong to the take, unless another line claimed them
    taken = {n for _, (i, j, _) in found for n in range(i, j + 1)}
    grown = []
    for k, (i, j, r) in found:
        for _ in range(3):
            if i > 0 and i - 1 not in taken and heard[i]["start"] - heard[i - 1]["end"] < .3: i -= 1
        for _ in range(3):
            if j + 1 < len(heard) and j + 1 not in taken and heard[j + 1]["start"] - heard[j]["end"] < .3: j += 1
        grown.append((k, (i, j, r)))
    found = grown
    # cut each take with a breath before and a short tail after, never into a neighbouring take
    spans = sorted((heard[i]["start"], heard[j]["end"], k, i, j) for k, (i, j, _) in found)
    summary = []
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)]))
    for n, (s0, s1, k, i, j) in enumerate(spans):
        lo, hi = max(0, s0 - .18), min(dur, s1 + .35)
        if i > 0: lo = max(lo, (heard[i - 1]["end"] + s0) / 2)
        if j + 1 < len(heard): hi = min(hi, (s1 + heard[j + 1]["start"]) / 2)
        name = f"{int(k):02d}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{lo:.3f}", "-to", f"{hi:.3f}", "-i", str(wav), "-c:a", "pcm_s24le", str(folder / name)], check=True)
        said = "".join(h["raw"] for h in heard[i:j + 1]).strip()
        take = {"source": src.name, "folder": folder.name, "file": name, "start": round(s0, 3), "end": round(s1, 3), "cut": [round(lo, 3), round(hi, 3)], "heard": said, "recorded": stamp}
        if a.at is not None: take["place"] = round(a.at + s0, 3)          # where on the cut you said it
        r = reg.setdefault(k, {"takes": []}); r["takes"].append(take); r.pop("use", None)
        differs = words_of(said) != words_of(lines[k]["text"])
        print(f"line {k:>2} (scene {lines[k]['scene']}): take {len(r['takes'])}, {s1 - s0:.1f} s  “{said}”" + ("   ← differs from the script" if differs else ""))
        summary.append({"line": k, "take": len(r["takes"]), "heard": said, "differs": differs, "place": take.get("place")})
    json.dump(reg, open(REGISTRY, "w"), indent=1)
    print("rebuild the cut with: .venv/bin/python review/assemble.py")
    if a.json: print(json.dumps({"takes": summary}))

if __name__ == "__main__":
    main()
