import os
import subprocess
import sys
from pathlib import Path

ROOT = Path("/tmp/coherence-posthog-probes.jYxKId/posthog")
PYTHON = "/tmp/coherence-posthog-probes.jYxKId/pinned-env/bin/python"
RESULTS = Path(__file__).resolve().parent

phase = sys.argv[1]
if phase not in {"baseline", "tenant-mutated", "tenant-restored", "cache-mutated", "cache-restored", "retry-mutated", "final"}:
    raise SystemExit("Unknown assay phase")
if (RESULTS / (phase + ".log")).exists() or (RESULTS / (phase + ".xml")).exists():
    raise SystemExit("Phase output already exists; preserve it before rerunning")

env = {
    "PATH": "/tmp/coherence-posthog-probes.jYxKId/pinned-env/bin:/Users/daniloc/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    "TEST": "1",
    "DEBUG": "1",
    "PGHOST": "127.0.0.1",
    "PGPORT": "55439",
    "PGUSER": "posthog",
    "PGPASSWORD": "synthetic-assay",
    "PGDATABASE": "posthog",
    "DATABASE_URL": "postgres://posthog:synthetic-assay@127.0.0.1:55439/posthog",
    "REDIS_URL": "redis://127.0.0.1:56389/0",
    "CLICKHOUSE_HOST": "coherence-assay-clickhouse.invalid",
    "CLICKHOUSE_LOGS_HOST": "coherence-assay-clickhouse.invalid",
    "PYTHONPATH": str(RESULTS / "network") + os.pathsep + str(ROOT),
    "CLICKHOUSE_SECURE": "false",
    "KAFKA_HOSTS": "127.0.0.1:39092",
    "NO_PROXY": "*",
    "AWS_EC2_METADATA_DISABLED": "true",
    "PYTHONUNBUFFERED": "1",
}

command = [
    PYTHON, "-m", "pytest", "-v", "--tb=short", "-o", "faulthandler_timeout=180",
    "--junitxml=" + str(RESULTS / (phase + ".xml")),
    "posthog/models/scoping/test_manager.py::TestTeamScopedManager::test_no_scope_raises_team_scope_error",
    "posthog/models/scoping/test_manager.py::TestTeamScopedManager::test_team_scope_filters_to_team",
    "posthog/query_cache/test/test_storage.py::TestQueryCacheS3Routing::test_stale_upload_cannot_replace_a_newer_entry",
]
with (RESULTS / (phase + ".log")).open("w") as output:
    process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in process.stdout:
        output.write(line)
        output.flush()
        print(line, end="", flush=True)
    result = process.wait()
raise SystemExit(result)
