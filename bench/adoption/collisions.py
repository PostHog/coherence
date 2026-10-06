"""usage: collisions.py <arms dir> [-v]

Finds any arm that used a /tmp path another arm wrote last, from the hosts'
session transcripts under ~/.claude/projects. run-arm.sh gives each arm its
own TMPDIR and tells the agent to keep scratch files there; this checks that
no arm used another's anyway.
"""
import glob, json, os, re, sys

root = os.path.abspath(sys.argv[1])
arms = {os.path.basename(a) for a in glob.glob(os.path.join(root, "*-r*"))}
projects = os.path.expanduser("~/.claude/projects")
events = []  # (timestamp, arm, W|U, path, command)
for d in glob.glob(projects + "/*"):
    arm = next((a for a in arms if f"-{a}-" in d or d.endswith(f"-{a}")), None)
    if arm is None:
        continue
    for f in glob.glob(d + "/*.jsonl"):
        for line in open(f):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") != "assistant":
                continue
            ts = e.get("timestamp")
            for c in e.get("message", {}).get("content", []):
                if not isinstance(c, dict) or c.get("type") != "tool_use":
                    continue
                inp = c.get("input", {})
                if c["name"] in ("Write", "Edit") and inp.get("file_path", "").startswith("/tmp/"):
                    events.append((ts, arm, "W", inp["file_path"], ""))
                    continue
                cmd = inp.get("command", "") if c["name"] == "Bash" else ""
                if not cmd:
                    continue
                written = {m.group(1) for m in re.finditer(r"(?:>|tee(?: -a)?)\s*(/tmp/[\w.-]+)", cmd)}
                for p in written:
                    events.append((ts, arm, "W", p, cmd[:300]))
                for p in set(re.findall(r"(?<![\w/])(/tmp/[\w.-]+)", cmd)) - written:
                    events.append((ts, arm, "U", p, cmd[:200]))
events.sort()
last, found = {}, {}
for ts, arm, kind, path, cmd in events:
    if kind == "W":
        last[path] = (arm, ts)
    elif path in last and last[path][0] != arm:
        found.setdefault((arm, path, last[path][0]), []).append(ts)
for (arm, path, writer), tss in sorted(found.items()):
    print(f"{arm} used {path} last written by {writer}: {len(tss)} uses, {tss[0]}..{tss[-1]}")
if not found:
    print("no arm used a /tmp path another arm wrote")
