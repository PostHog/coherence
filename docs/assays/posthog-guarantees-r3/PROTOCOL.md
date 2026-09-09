# PostHog original Python oracles — R3

2026-09-09. Continuation of R2, not a replacement for its recorded setup gaps.
Experiment: `e-cf03ccfa37b7`. Owner: main, session `01a06cfd-b3bc-7771-b2fb-a270ead577b7`.

## Frozen question

Can the unchanged original PostHog tenant-scope and cache-supersession tests run
in the pinned environment, fail behaviorally under the already-frozen R2
mutations, and pass again after restoration?

The commit remains `c54fec2163ad9455fd23a947f86a9034c1df9388` in
`/tmp/coherence-posthog-probes.jYxKId/posthog`. The user's primary checkout is
not the execution target. R2's protocol and exact mutation snippets remain
authoritative; this round does not select easier replacement assertions.

Named tests:

- `posthog/models/scoping/test_manager.py::TestTeamScopedManager::test_no_scope_raises_team_scope_error`
- `posthog/models/scoping/test_manager.py::TestTeamScopedManager::test_team_scope_filters_to_team`
- `posthog/query_cache/test/test_storage.py::TestQueryCacheS3Routing::test_stale_upload_cannot_replace_a_newer_entry`

Run all three before mutation and after each restoration. Apply the tenant
filter removal and cache expected-value-check removal separately. Also challenge
the cache's already-applied retry branch if the baseline permits it. A setup
error, collection failure, syntax error, or skipped test is not a killed mutant.

## Environment and isolation

Python is the project's exact `3.13.13`; `uv sync --frozen --dev` installed
564 dependencies using uv `0.12.11`. The lockfile is not rewritten. This is a
native macOS arm64 run, not a claim of CI-image equivalence. The existing SQLx
CLI is `0.7.3`.

`compose.yaml` owns five dedicated OrbStack containers under project
`coherence-posthog-r3-jyxkid`. Database initialization, migration, and Redis
flushes operate only on these instances. Published ports bind to loopback;
credentials are synthetic. Existing containers are not reset or stopped.

PostHog hard-codes ClickHouse HTTP/native ports 8123/9000. Existing containers
already occupy those host ports, and direct container IP/DNS connectivity failed
here. `network/sitecustomize.py` therefore maps only the synthetic hostname
`coherence-assay-clickhouse.invalid` and those two ports to the dedicated
loopback mappings 58129/59009. Unknown ports on that hostname refuse. This is an
explicit assay transport adaptation, not a replacement of an application
function, service response, or assertion. Both protocols reach real ClickHouse.

The original cache test supplies its own fake object storage and controlled
upload executor. This assay preserves those upstream choices: it does not
establish real S3 behavior or exhaust all concurrent schedules. Redis is real.

## Evidence discipline

`run_original.py` runs the fixed named population with a cleared environment,
retains combined output plus JUnit XML, and refuses to overwrite a phase.
Retain unsuccessful setup attempts separately. Mutations occur only after a
green baseline; restore one before applying the next. Final provenance should
include source/config hashes, image identities, named phase outcomes, and the
restored tracked diff.

Success admits these narrow observations into the requirement study. It does
not admit a universal guarantee family, establish project-wide coverage, or
authorize a green Scope card. Candidate applicability remains caller-assessed
and cross-project portability remains untested by this round.
