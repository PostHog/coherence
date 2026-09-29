"""usage: trust.py add|remove <arms dir>

A headless session runs a folder's project hooks only once the folder is
trusted in ~/.claude.json. add trusts each arm's clone and records exactly
the keys it added in <arms dir>/trust-keys.txt, after backing the file up to
<arms dir>/claude.json.backup; remove deletes those keys and no others.
"""
import glob, json, os, shutil, sys

action, root = sys.argv[1], os.path.abspath(sys.argv[2])
config = os.path.expanduser("~/.claude.json")
keys_file = os.path.join(root, "trust-keys.txt")
data = json.load(open(config))
projects = data.setdefault("projects", {})
if action == "add":
    shutil.copy(config, os.path.join(root, "claude.json.backup"))
    added = []
    for arm in sorted(glob.glob(os.path.join(root, "*-r*"))):
        if not os.path.exists(os.path.join(arm, "project")):
            continue
        path = os.path.join(arm, open(os.path.join(arm, "project")).read().strip())
        if path not in projects:
            projects[path] = {"hasTrustDialogAccepted": True}
            added.append(path)
    open(keys_file, "a").write("".join(p + "\n" for p in added))
    print(f"trusted {len(added)} clones")
elif action == "remove":
    keys = [k for k in open(keys_file).read().split("\n") if k] if os.path.exists(keys_file) else []
    removed = [k for k in keys if projects.pop(k, None) is not None]
    os.remove(keys_file) if os.path.exists(keys_file) else None
    print(f"removed {len(removed)} of {len(keys)} recorded keys")
else:
    sys.exit(__doc__)
tmp = config + ".tmp"
json.dump(data, open(tmp, "w"), indent=2)
os.replace(tmp, config)
