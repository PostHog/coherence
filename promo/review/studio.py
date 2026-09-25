# The review studio: the review page, served on this Mac so the browser can use the microphone, with recording built in.
#
#   .venv/bin/python review/studio.py        then open http://localhost:8830
#
# In the page, set the playhead a little before a line and press Record: the cut plays from there (music, pictures,
# subtitles) and your microphone records until you press Stop. Wear headphones, so the mic hears only you.
# The take goes to audio/adr.py, which finds the lines you said and places each one where you said it against the
# picture; the cut is rebuilt (voice chain, mix) and the page reloads with the new take in place.
# Drags on the timeline are saved to review/overrides.json here, instead of the published page's database.
import json, subprocess, sys, tempfile, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PROMO = Path(__file__).resolve().parent.parent
PY = str(PROMO / ".venv/bin/python")
PORT = 8830
lock = threading.Lock()

def rebuild():
    subprocess.run([PY, str(PROMO / "review/assemble.py")], cwd=PROMO, check=True, capture_output=True)

class Studio(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = urlparse(path).path
        if p in ("/", "/index.html"): return str(PROMO / "review/review.html")
        if p.startswith("/scenes/"): return str(PROMO / "scenes" / p[len("/scenes/"):])
        return str(PROMO / "review" / p.lstrip("/"))

    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            with lock:
                if u.path == "/placements":
                    lines = json.loads(data)["lines"]
                    (PROMO / "review/overrides.json").write_text(json.dumps(lines, indent=1))
                    return self.reply(200, {"saved": len(lines)})
                if u.path == "/take":
                    at = float(q["at"][0])
                    with tempfile.NamedTemporaryFile(suffix=".webm", prefix="take-", delete=False) as f: f.write(data)
                    args = [PY, str(PROMO / "audio/adr.py"), f.name, "--at", f"{at:.3f}", "--json"]
                    if q.get("lines"): args += ["--lines", q["lines"][0]]
                    out = subprocess.run(args, cwd=PROMO, capture_output=True, text=True, check=True).stdout
                    result = json.loads(out.strip().splitlines()[-1])
                    # a take recorded against the picture sits where it was said
                    ov_path = PROMO / "review/overrides.json"
                    ov = json.loads(ov_path.read_text()) if ov_path.exists() else {}
                    for t in result["takes"]:
                        if t.get("place") is not None: ov[t["line"]] = t["place"]
                    ov_path.write_text(json.dumps(ov, indent=1))
                    if result["takes"]: rebuild()
                    return self.reply(200, result)
                if u.path == "/use":
                    subprocess.run([PY, str(PROMO / "audio/adr.py"), "--use", q["line"][0], q["take"][0]], cwd=PROMO, check=True, capture_output=True)
                    rebuild()
                    return self.reply(200, {"ok": True})
            self.reply(404, {"error": "no such endpoint"})
        except subprocess.CalledProcessError as e:
            self.reply(500, {"error": (e.stderr or e.stdout or str(e))[-2000:]})
        except Exception as e:
            self.reply(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        if "POST" in (fmt % args): sys.stderr.write("studio: " + (fmt % args) + "\n")

if __name__ == "__main__":
    rebuild()
    print(f"review studio: http://localhost:{PORT}   (Ctrl-C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Studio).serve_forever()
