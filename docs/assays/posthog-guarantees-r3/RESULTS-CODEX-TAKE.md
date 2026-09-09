# PostHog guarantee probes R3 — Codex's take

2026-09-09 · pinned PostHog `c54fec2163ad9455fd23a947f86a9034c1df9388`

## Result

The original Python-oracle gate passed. The unchanged three-test population
passed, each of three isolated behavioral mutations caused its intended named
test to fail, and every restoration passed. These are now original PostHog
test results, not R2's narrower fallback probes.

| Phase | Passed | Failed | Observed distinction |
| --- | ---: | ---: | --- |
| [Baseline](baseline.log) | 3 | 0 | Original code and assertions |
| [Tenant filter removed](tenant-mutated.log) | 2 | 1 | Query returns two teams' rows instead of one |
| [Tenant restored](tenant-restored.log) | 3 | 0 | Same named population |
| [Expected-value refusal removed](cache-mutated.log) | 2 | 1 | Two stored objects survive instead of one |
| [Cache restored](cache-restored.log) | 3 | 0 | Same named population |
| [Already-applied recognition removed](retry-mutated.log) | 2 | 1 | Repeated pointer publication returns false instead of true |
| [Final restoration](final.log) | 3 | 0 | All tracked PostHog source restored |

Each log has a same-named JUnit XML file. No phase above has a setup error or
skip. These repeated runs are controls, not 21 independent examples of portability.

## What the failures actually establish

**Scoped reads.** `TestTeamScopedManager.test_team_scope_filters_to_team`
fails at `test_manager.py:30`: `assert 2 == 1` after `_apply_team_filter`
returns `self` instead of `self.filter(team_id=team_id)`. The unchanged
missing-context test remains green. Thus this run negatively controls the
filter, not the missing-context branch. It does not prove every PostHog query
uses this manager, that context identifies the correct principal, or that raw
SQL and framework escape hatches are confined.

**Conditional publication.**
`TestQueryCacheS3Routing.test_stale_upload_cannot_replace_a_newer_entry`
fails at `test_storage.py:261` after removing the Lua expected-value mismatch
refusal: two fake-storage objects remain where one is required. This is a
behavioral failure in the original publication/cleanup composition with real
Redis. The first failure is the cleanup assertion; the later assertion that
the newer response remains readable is **not reached in this mutant run**.
Do not report that later assertion as an observed failure.

**Retry recognition.** The same original cache test fails independently at
`test_storage.py:273` when the Lua already-applied branch is removed:
`replace_value(..., expected=b"stale-inline-bytes")` returns false rather than
true for the pointer already installed. It reaches that assertion only after
the normal supersession assertions pass. This measures the retry return
contract; it does not inject an actual network-lost reply or demonstrate
end-to-end retry cleanup against real S3.

The exact three mutations are in [R2's mutation record](../posthog-guarantees-r2/MUTATIONS.md).
Its statements about fallback-only execution remain true for R2; this document
records the subsequent original-oracle executions separately.

## Environment, cost, and retained limitations

The [protocol](PROTOCOL.md), [dedicated Compose stack](compose.yaml),
[runner](run_original.py), and [provenance](provenance.json) retain the setup.
Python is exactly 3.13.13, with 564 dependencies installed from the frozen
lockfile. Postgres, Redis, ClickHouse, Kafka-compatible Redpanda, and ZooKeeper
were dedicated OrbStack services. The original fixtures ran their normal
database migrations, persons SQLx migrations, and ClickHouse setup.

One initial attempt was interrupted during database setup after 252 seconds,
before any test ran. Its [log](baseline-setup-1.log) and XML remain as setup
evidence, not a negative control. Direct OrbStack container addressing was
unreachable here; the retry used the declared, hostname-specific
[socket address mapping](network/sitecustomize.py) to dedicated loopback ports.
No upstream source or assertions were changed to configure those ports.

The successful first baseline took 284.67 seconds with remaining migrations;
subsequent three-test runs took 3.15–3.77 seconds using the original reuse-db
setting. That is a useful operational distinction: provisioning is expensive,
but the warm falsification loop is cheap.

This is native macOS execution, not an exact CI-container reproduction. The
cache test retains upstream fake object storage and its scheduled-upload
executor. It tests selected interleavings, not exhaustive concurrency or cloud
storage behavior. The Python dependency lock is pinned; service image identities
are captured separately. None of this grades the whole PostHog test suite.

All tracked files in the isolated PostHog checkout were restored to HEAD. The
only untracked checkout entries are the two pre-existing dependency symlinks.
The user's primary checkout still shows its existing desktop-harness edit
(four inserted lines, one removed); this assay did not edit it. No existing
containers were stopped or reset. The five assay containers are stopped after
capture, retaining their databases, venv, and checkout for reuse.

## What this changes for Coherence

Together with [R2's original Node acknowledgment test](../posthog-guarantees-r2/RESULTS-CODEX-TAKE.md),
we now have executable, negatively controlled examples at three concrete seams:
scoped reads, settlement-gated acknowledgment, and conditional publication
(including retry recognition). That is a better basis for a guarantee product
than inventing names and then looking for implementations that resemble them.

The next bounded step is to model these **bindings**, not declare universal
families mature. Each needs its subject, relevant context or competing
operation, promised relationship, exclusions, original oracle, and observed
counterexample. The cache example especially argues for two independently
addressable clauses under one binding, rather than two synonyms for safety.

For Scope, a defensible statement is “this scoped-manager filter has a passing
original oracle that detected removal of its filter,” not “tenant isolation:
green.” The applicability assertion and execution evidence must stay separate.
No percentage of a component is established by this assay.

The nine additional obligations discovered in R2 remain source-inspected only.
Cross-project portability, family demotion gates, unbound obligations, and the
usefulness of the rendered view remain open. No taxonomy, guarantee catalog,
receipt mechanism, or Scope product code was changed in this round.
