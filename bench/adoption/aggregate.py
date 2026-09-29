"""usage: aggregate.py <arms dir> <gap label> [<coverage label>]

Arms are named <project>-<variant>-r<n>. Reads each measured arm's
measure-<label>/ folders and transcripts.json (from transcripts.py), writes
results.json beside the arms, and prints per-arm rows and per-group means.
"""
import collections, datetime as dt, glob, json, os, re, statistics as st, sys

root, gap = sys.argv[1], sys.argv[2]
cov = sys.argv[3] if len(sys.argv) > 3 else gap


def when(p):
    return dt.datetime.fromisoformat(open(p).read().strip().replace("Z", "+00:00")) if os.path.exists(p) else None


rows = []
for a in sorted(glob.glob(os.path.join(root, "*-r*"))):
    arm = os.path.basename(a)
    m = re.fullmatch(r"(.+)-([^-]+)-(r\d+)", arm)
    if not m or not os.path.exists(f"{a}/measure-{gap}/model.json"):
        continue
    r = {"arm": arm, "proj": m[1], "ver": m[2], "rep": m[3]}
    model = json.load(open(f"{a}/measure-{gap}/model.json"))
    s = open(f"{a}/measure-{gap}/structure.txt").read()
    h = re.search(r"^health: (\d+) invariants enforced and verified, (\d+) requirements, (\d+) structural defects", s, re.M)
    r["inv"], r["req"], r["defects"] = map(int, h.groups()) if h else (None,) * 3
    r["entrances"] = model["entrances"]
    r["untrusted"] = model["entrancesUntrustedOrUnknown"]
    r["gaps"] = len(model["gaps"]) if model["gaps"] is not None else None
    r["gap_names"] = [g[1] for g in (model["gaps"] or [])]
    r["gap_rate"] = r["gaps"] / r["entrances"] if r["entrances"] and r["gaps"] is not None else None
    r["waivers"] = len(model["waivers"])
    r["waiver_reasons"] = [f"{w['name']}: {w['reason']}" for w in model["waivers"]]
    r["guards"] = model["guardLines"]
    r["baselines"] = len(model["baselines"])
    r["spec_exit"] = int(open(f"{a}/measure-{gap}/spec.exit").read())
    r["lex_exit"] = int(open(f"{a}/measure-{gap}/lex.exit").read())
    cs_path = f"{a}/measure-{cov}/structure.txt"
    cs = open(cs_path).read() if os.path.exists(cs_path) else ""
    c = re.search(r"^entrance coverage: entrances: (\d+) declared, covering (\d+) of (\d+) detected entrances?.*?; (\d+) undeclared", cs, re.M)
    if c:
        declared, covered, detected, undeclared = map(int, c.groups())
        r.update(covered=covered, detected=detected, undeclared=undeclared, coverage=covered / detected if detected else None)
    tpath = f"{a}/transcripts.json"
    if os.path.exists(tpath):
        t = json.load(open(tpath))
        for sn in ("s1", "s2"):
            res = t[sn]["result"] or {}
            r[sn + "_cost"] = res.get("total_cost_usd")
            r[sn + "_turns"] = res.get("num_turns")
            r[sn + "_err"] = res.get("is_error")
            r[sn + "_scaffold_control"] = len(t[sn]["scaffold_control"])
        r["s2_start_gap_line"] = [x[1] for x in t["s2"]["hook_texts"] if x[0] == "SessionStart"]
        r["cost"] = (r.get("s1_cost") or 0) + (r.get("s2_cost") or 0)
    t1, t2, t3 = when(f"{a}/s1.start"), when(f"{a}/s2.start"), when(f"{a}/done")
    if t1 and t2:
        r["s1_min"] = round((t2 - t1).total_seconds() / 60, 1)
    if t2 and t3:
        r["s2_min"] = round((t3 - t2).total_seconds() / 60, 1)
    rows.append(r)

json.dump(rows, open(os.path.join(root, "results.json"), "w"), indent=1)
cols = ["arm", "entrances", "gaps", "gap_rate", "waivers", "guards", "inv", "req", "defects", "baselines", "covered", "detected", "undeclared", "cost", "s1_min", "s2_min"]
print("\t".join(cols))
for r in rows:
    print("\t".join(f"{r.get(c):.2f}" if isinstance(r.get(c), float) else str(r.get(c)) for c in cols))


def agg(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return "-"
    return f"{st.mean(xs):.2f} [{min(xs):g}-{max(xs):g}]" + (f" sd {st.stdev(xs):.2f}" if len(xs) > 1 else "")


print()
groups = collections.defaultdict(list)
for r in rows:
    groups[(r["proj"], r["ver"])].append(r)
for (proj, ver), R in sorted(groups.items()):
    print(proj, ver, f"n={len(R)}")
    for c in ["entrances", "gaps", "gap_rate", "waivers", "guards", "inv", "defects", "baselines", "coverage", "undeclared", "cost", "s1_min"]:
        print(f"   {c:12s}", agg([r.get(c) for r in R]))
