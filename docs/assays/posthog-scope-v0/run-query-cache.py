"""Fixed, isolated original-oracle bridge; no report replay and no ambient credentials.

JUnit is converted to the existing Vitest-shaped batch interchange, not claimed
to have been produced by Vitest. Only one exact, unchanged pytest test is accepted.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET

PROJECT = Path(__file__).resolve().parent
RUNTIME = json.loads((PROJECT / "assay-runtime.json").read_text())
UPSTREAM = Path(RUNTIME["upstream"])
PINS = json.loads((PROJECT / "source-pins.json").read_text())
NAME = "test_stale_upload_cannot_replace_a_newer_entry"
NODEID = "posthog/query_cache/test/test_storage.py::TestQueryCacheS3Routing::" + NAME
CLASS = "posthog.query_cache.test.test_storage.TestQueryCacheS3Routing"


def check_sources():
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=UPSTREAM, text=True).strip()
    if head != PINS["commit"]:
        raise RuntimeError("Upstream revision changed; prepare a new adoption")
    subprocess.run(["git", "diff", "--quiet", "HEAD"], cwd=UPSTREAM, check=True)
    for path, expected in PINS["files"].items():
        for root in [PROJECT, UPSTREAM]:
            if hashlib.sha256((root / path).read_bytes()).hexdigest() != expected:
                raise RuntimeError("Assay source differs: " + path)


def report_from_junit(xml):
    rows = ET.parse(xml).getroot().findall(".//testcase")
    if len(rows) != 1 or rows[0].get("name") != NAME or rows[0].get("classname") != CLASS:
        raise RuntimeError("Refusing missing, duplicate or different named oracle")
    row = rows[0]
    if row.find("error") is not None or row.find("skipped") is not None:
        raise RuntimeError("Setup error or skip is not an executed oracle outcome")
    outcome = "failed" if row.find("failure") is not None else "passed"
    return {"testResults": [{"assertionResults": [{"fullName": NAME, "status": outcome,
        "duration": float(row.get("time", "0")) * 1000}]}]}


if __name__ == "__main__":
    check_sources()
    directory = PROJECT / "runs" / uuid.uuid4().hex
    directory.mkdir(parents=True)
    env = {
        "PATH": str(Path(sys.executable).parent) + ":/Users/daniloc/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        "TEST": "1", "DEBUG": "1", "PGHOST": "127.0.0.1", "PGPORT": "55439",
        "PGUSER": "posthog", "PGPASSWORD": "synthetic-assay", "PGDATABASE": "posthog",
        "DATABASE_URL": "postgres://posthog:synthetic-assay@127.0.0.1:55439/posthog",
        "REDIS_URL": "redis://127.0.0.1:56389/0", "CLICKHOUSE_HOST": "coherence-assay-clickhouse.invalid",
        "CLICKHOUSE_LOGS_HOST": "coherence-assay-clickhouse.invalid", "CLICKHOUSE_SECURE": "false",
        "PYTHONPATH": str(PROJECT / "network") + os.pathsep + str(UPSTREAM),
        "KAFKA_HOSTS": "127.0.0.1:39092", "NO_PROXY": "*", "AWS_EC2_METADATA_DISABLED": "true",
        "PYTHONUNBUFFERED": "1",
    }
    with (directory / "pytest.log").open("w") as output:
        result = subprocess.run([sys.executable, "-m", "pytest", "-v", "--tb=short",
            "--junitxml=" + str(directory / "pytest.xml"), NODEID], cwd=UPSTREAM,
            env=env, stdout=output, stderr=subprocess.STDOUT, timeout=600)
    check_sources()
    report = report_from_junit(directory / "pytest.xml")
    outcome = report["testResults"][0]["assertionResults"][0]["status"]
    if result.returncode != (0 if outcome == "passed" else 1):
        raise RuntimeError("Process outcome disagrees with named-test evidence")
    (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    print("Original pytest log and XML: " + str(directory), file=sys.stderr)
    raise SystemExit(result.returncode)
