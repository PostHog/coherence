"""Capture restored source, dedicated service identities, and named JUnit results."""
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path("/tmp/coherence-posthog-probes.jYxKId/posthog")


def command(*args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


source_paths = [
    "pyproject.toml", "uv.lock", "pytest.ini", "posthog/conftest.py",
    "posthog/test/base.py", "posthog/settings/data_stores.py",
    "posthog/models/scoping/manager.py", "posthog/models/scoping/test_manager.py",
    "posthog/query_cache/storage.py", "posthog/query_cache/size_tracker.py",
    "posthog/query_cache/test/test_storage.py",
    "docker/clickhouse/config.xml", "docker/clickhouse/config.d/default.xml",
    "docker/clickhouse/config.d/dev-memory.xml", "docker/clickhouse/users-dev.xml",
]
sources = []
for path in source_paths:
    at_head = subprocess.check_output(["git", "show", "HEAD:" + path], cwd=ROOT)
    sources.append({"path": path, "sha256": digest(ROOT / path),
                    "matchesHead": (ROOT / path).read_bytes() == at_head})

services = []
for service in ["db", "redis7", "zookeeper", "kafka", "clickhouse"]:
    name = "coherence-posthog-r3-jyxkid-" + service + "-1"
    container = json.loads(command("docker", "inspect", name))[0]
    services.append({"name": name, "containerId": container["Id"],
                     "image": container["Config"]["Image"], "imageId": container["Image"],
                     "state": container["State"]["Status"],
                     "ports": container["HostConfig"]["PortBindings"]})

phases = []
for path in sorted(HERE.glob("*.xml")):
    root = ET.parse(path).getroot()
    tests = []
    for test in root.iter("testcase"):
        outcome = next((tag for tag in ["failure", "error", "skipped"] if test.find(tag) is not None), "passed")
        entry = {"class": test.get("classname"), "name": test.get("name"), "outcome": outcome}
        if outcome != "passed":
            entry["message"] = test.find(outcome).get("message")
        tests.append(entry)
    phases.append({"phase": path.stem, "suites": [dict(s.attrib) for s in root.iter("testsuite")], "tests": tests})

artifacts = []
for path in sorted(HERE.rglob("*")):
    if path.is_file() and path.name != "provenance.json" and "__pycache__" not in path.parts:
        artifacts.append({"path": str(path.relative_to(HERE)), "sha256": digest(path)})

result = {
    "sourceCommit": command("git", "rev-parse", "HEAD"),
    "python": command("/tmp/coherence-posthog-probes.jYxKId/pinned-env/bin/python", "--version"),
    "uv": command("/tmp/coherence-posthog-probes.jYxKId/probe-env/bin/uv", "--version"),
    "sqlx": command("/Users/daniloc/.cargo/bin/sqlx", "--version"),
    "sourceFiles": sources, "trackedDiff": command("git", "diff", "HEAD", "--stat"),
    "checkoutStatus": command("git", "status", "--short"),
    "services": services, "phases": phases, "artifacts": artifacts,
}
(HERE / "provenance.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"sourcesAtHead": all(s["matchesHead"] for s in sources),
                  "phaseCount": len(phases), "trackedDiff": result["trackedDiff"]}))
