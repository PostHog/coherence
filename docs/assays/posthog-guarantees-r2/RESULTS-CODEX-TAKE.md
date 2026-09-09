# PostHog guarantee discovery and executable probes R2 — Codex's take

2026-09-09. Follow-up to [the first requirements study](../../../POSTHOG-GUARANTEE-REQUIREMENTS-CODEX-TAKE.md).
Source commit: `c54fec2163ad9455fd23a947f86a9034c1df9388`.

## Outcome

One original-oracle trial completed: ingestion acknowledgment. Its unchanged 16-test suite passes; removing the settlement wait produces two named failures; restoration returns all 16 to green. A second cycle reproduces the same result and is preserved as JSON.

The original Python tenant and cache suites **did not run**. A narrower harness executes the real scoping modules with a synthetic Django model on in-memory SQLite, and the exact cache Lua script with a Lua-capable Redis emulator. Those probes pass, detect the intended mutations, and pass after restoration. They are useful primitive evidence, not substitutes for the blocked original suites.

Nine additional obligation records are described below. They are source-based discoveries, not nine admitted reusable families.
No product catalog, guarantee links, Scope UI, or PostHog production code was changed. No guarantee is declared globally satisfied or portable.

## Executable results

| Subject | Original repository oracle | Controlled violation | Observed result | Restoration |
| --- | --- | --- | --- | --- |
| Ingestion acknowledgment | Original `grpc-server.test.ts`, unchanged; 16 pass | Replace `await completed.settled` with `void completed.settled` | 14 pass, 2 fail by name | 16 pass |
| Tenant query scope | Blocked before test collection/execution | Remove filtering in `_apply_team_filter` | Narrower harness: 1 pass, 2 fail; both tenant rows become visible | All 3 tenant probes pass |
| Cache supersession | Blocked before test collection/execution | Remove expected-value refusal in swap Lua | Narrower harness: stale replacement incorrectly reports success; 1 of 2 cache probes fails | Both cache probes pass |
| Cache retry, additional clause | Same blocked original cache oracle | Remove already-applied success branch in swap Lua | Narrower harness: retry reports failure after a successful swap; the other cache probe passes | Both cache probes pass |

Do not aggregate these rows into a portability percentage or a claim that all three original-oracle trials succeeded. The original-oracle criterion remains unresolved for Python.

### What the acknowledgment failure proves

The original test `records an accepted sub-batch in the shared in-flight metrics until it settles` fails at its assertion that accepted events remain in flight while settlement is unresolved: expected 8, received 5 in these runs.
The original test `a slow batch settlement does not block another sub-batch ack` also fails, timing out on its expected acknowledgment count.
These are behavioral failures after successful discovery and execution, not TypeScript errors or failed setup.

The first test is an indirect observer of the acknowledgment barrier through bookkeeping. The second observes acknowledgment behavior but produces a timeout rather than a direct diagnostic about an early acknowledgment. This mutation establishes sensitivity to removal of the wait; it does not establish sensitivity to every possible early-ack implementation, settlement rejection, downstream durability failure, or driver lie.
An eventual adopted claim should cite this limitation rather than turn the full ingestion connection green. A direct early-ack/rejected-settlement case is worthwhile to assess next; no upstream test was added here.

Artifacts: [baseline/restoration before the recorded repeat](ack-restored.json), [recorded mutation](ack-mutated.json), [final restoration](ack-final.json).
The first exploratory cycle also returned 16/16 → 14/16 → 16/16; its console output is in the session, while the repeated cycle is the durable machine-readable record.
Jest emitted an open-handle warning but eventually exited with code 0 for restored runs and code 1 for mutated runs; no forced exit or timeout was counted as success.
This used Node 22.21.1 and the already-installed Node dependency tree, not a fresh lockfile-controlled installation. The tests and application source were unchanged except for the explicit temporary mutant; runtime/dependency parity with CI is not asserted.

### Python setup and fallback limits

The existing `env/bin/python` symlink in the main PostHog checkout is broken. The available Python is 3.14.7; this checkout pins 3.13.13. The first original test attempt fails because pytest is absent.
An isolated minimal venv was created and pytest, Django 5.2.17, and fakeredis 2.38.0 with Lua support were installed. Retrying the original files stops during PostHog/Celery import at missing `structlog`, before the requested tests run. This is not a diagnosis that installing `structlog` alone would complete setup: the complete application environment and isolated service databases were not provisioned.
The exact cache test class was resolved to `TestQueryCacheS3Routing` before execution; the protocol's abbreviated class label was provisional, not an executed nonexistent oracle.

Rather than claim that this made testing impossible, the fallback executes a narrower slice:

- Scoping: loads the actual scoping context and manager modules, bypassing PostHog package bootstrap; uses a synthetic two-tenant Django model on SQLite. Canonical scope is supplied explicitly. No actual FeatureFlag model, canonical-parent resolution, Postgres behavior, API permission checks, or deployed background context is covered.
- Cache: parses the Python module to obtain its one literal `REPLACE_IF_UNCHANGED_SCRIPT`, then executes those exact Lua bytes against fakeredis. It does not reimplement the swap algorithm. It omits the Python tracker wrapper, real Redis network retries, S3 publication/cleanup, concurrency under load, and TTL boundary behavior.
- The fallback tests are temporary assay instruments, not proposed duplicate additions to PostHog's test suite. Python/runtime and dependency versions differ from PostHog's pinned full environment.

Artifacts: [fallback harness](probe_primitives.py), [recorded fallback outputs](primitive-results.json), [exact mutations](MUTATIONS.md).
The primitive result file starts with the tenant mutation run; the initial five-test passing baseline was observed in the session before that mutation. It additionally records a full five-test restored baseline before cache mutations, intermediate cache restoration, and final five-test restoration. No missing phase is silently fabricated.

## Expanded operation-path inventory

All evidence in this section is inspected source or test bodies, **not executed tests**. These records deliberately mix supported obligations with explicit unanswered questions; locating a nearby test does not close the whole path.

### A. Export → crash → checkpoint → resume: do not omit boundary records

`generate_query_ranges` reconstructs unfinished timestamp intervals. Its contract deliberately permits overlap because multiple events can share the same insertion timestamp: skipping that timestamp could lose unexported events.
**Falsifier:** interrupt after exporting only some records with one timestamp; resume and omit the remaining records at that timestamp.
**Evidence located:** six expected-range cases in `test_generate_query_ranges`; HTTP resume reads heartbeat progress and restarts from the beginning on damaged details.
**Open obligation:** when is a checkpoint durable relative to destination acceptance? The range tests do not prove destination-level exactly-once delivery. Repeated selection is explicitly allowed; destination idempotency would be a separate clause.
Sources: [range algorithm](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/temporal/batch_exports.py#L197), [range cases](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/tests/temporal/test_batch_exports.py#L497), [HTTP heartbeat resume](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/temporal/destinations/http_batch_export.py#L116).

### B. Export → destination error → retry decision: distinguish recoverable from terminal failure

The HTTP destination classifies 429, 408, and server errors as retryable, while ordinary client errors and unexpected redirects are non-retryable.
**Falsifiers:** terminate on a retryable server failure, or endlessly retry a permanent client error under a policy that says it is terminal.
**Evidence located:** activity-level assertions for a returned 400 error versus raised retryable errors for 429 and 500.
**Qualification:** HTTP status mapping is this destination's policy; do not make that exact mapping universal. Retry eligibility, maximum attempts, backoff, and eventual success are different properties.
Sources: [classification](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/temporal/destinations/http_batch_export.py#L60), [activity tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/tests/temporal/destinations/test_http_batch_export_workflow.py#L274).

### C. Export → HTTP redirect: preserve destination confinement

The HTTP migration exporter only accepts two configured-in-code PostHog batch endpoint URLs and disables redirects on the actual POST.
**Falsifier:** an initially accepted destination redirects a request outside the allowed destination set and the worker follows it with the payload.
**Evidence located:** checks at the sending boundary, plus redirect error classification. This bounded search did not locate a matching redirect-confinement test in the inspected workflow test file. That is an evidence gap in this inventory, not proof that no such test exists anywhere.
**Qualification:** the two allowed URLs are local policy. The reusable question is whether the full request chain stays within its declared destination authority, not whether every application shares this allowlist.
Source: [sending boundary](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/temporal/destinations/http_batch_export.py#L146).

### D. Task creation → commit → dispatch: preserve durable intent without premature side effects

Task creation stores dispatch options alongside the run and defers workflow start until commit. A recoverable intent/outbox path addresses the crash window after commit but before dispatch.
**Falsifiers:** dispatch a workflow for a rolled-back run; or commit the run, lose the callback, and leave no recoverable intent for the dispatcher.
**Evidence located:** stored `pending_dispatch`, an atomic creation block, dispatch helpers, and tests for durable-intent reuse, retry recognition, and persisted dispatch markers.
**Qualification:** commit ordering and eventual delivery are separate clauses. An outbox is not enough to prove liveness without an operating dispatcher, eligible permissions, retry policy, and retention bounds. Flags choose dispatch modes; mode conditions belong on the claim.
Sources: [task creation](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/models.py#L1205), [dispatch service](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/logic/services/workflow_dispatch.py), [tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/tests/test_workflow_dispatch.py).

### E. Queue → permission change → worker: revalidate current authority

The task workflow dispatcher checks that the requested user is active and currently has effective team membership. Trusted system dispatch has an explicit bypass.
**Falsifier:** remove the user's access after queuing but before dispatch; ordinary user dispatch still proceeds under its old authority.
**Evidence located:** `_user_can_dispatch` and a test that requires current membership. The inspected test mocks the permission service; it does not prove every alternate start path uses this check or that revocation cancels work already running.
**Qualification:** retained tenant context is not authorization. Current access, actor attribution, trusted-system exceptions, and ongoing revocation need separate accounting.
Sources: [dispatcher access check](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/management/commands/run_task_workflow_dispatcher.py#L54), [permission tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/tests/test_workflow_dispatch.py#L404).

### F. Suspend → revoke/change actor → resume: do not revive stale authority

Sandbox resume replaces credential domains even when current resolution returns no token. Follow-up handling also rebinds per-actor credentials or clears them, refusing when clearing cannot be confirmed.
**Falsifier:** resume with a missing integration and retain the old credential; or allow an actor transition to proceed after credential clearing fails.
**Evidence located:** resume tests inspect clearing the old credential files/remote; follow-up tests exercise same-actor revocation and unconfirmed logout. Those tests use mocked sandbox operations, not a real snapshot and remote credential acceptance.
**Qualification:** deleting an integration record is not itself remote token revocation. The stronger end-to-end revocation promise remains unverified here.
Sources: [resume replacement](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/temporal/process_task/activities/provision_sandbox.py#L1265), [resume tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/temporal/process_task/activities/tests/test_inject_fresh_tokens_on_resume.py#L71), [actor refresh](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/temporal/process_task/activities/send_followup_to_sandbox.py#L860), [revocation tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/temporal/process_task/tests/test_send_followup_to_sandbox.py#L431).

### G. Identity events → batch optimization: preserve policy eligibility and sequence boundaries

Merge folding groups eligible consecutive identify events. It excludes disabled person processing, self-merges, illegal IDs, and operations with different merge semantics; intervening events split runs.
**Falsifier:** folding includes a person-processing-disabled event or an operation that the sequential path treats differently, producing an otherwise-forbidden merge.
**Evidence located:** planner tests exercise these exclusions and preserve the first event identity for repeated pairs.
**Open obligation:** planning checks are not full folded-versus-sequential equivalence, concurrency correctness, or proof that an abandoned plan retries every necessary merge. Those need a separate execution-level comparison.
Sources: [fold planner](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/persons/person-merge-fold.ts), [planner tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/persons/person-merge-fold.test.ts).

### H. UI query → cancel/supersede → late response: prevent stale publication

The data-node loader aborts prior queries and checks a Kea breakpoint after awaiting the result. A cancellation test simulates a delayed response and requires a canceled state with no response.
**Falsifier:** a canceled or superseded request publishes its late result over the user's current query state.
**Evidence located:** loader publication guard and cancellation test. The inspected test is not a complete two-successful-requests reverse-completion test, nor proof that server work has ceased.
**Qualification:** canceling presentation, aborting the HTTP request, and stopping server computation are three different outcomes. This is a promising second context for supersession safety, but no generic binding was frozen or graded against it.
Sources: [loader](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/frontend/src/queries/nodes/DataNode/dataNodeLogic.ts#L1016), [cancellation test](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/frontend/src/queries/nodes/DataNode/dataNodeLogic.queryCancellation.test.ts).

### I. Delete → locate targets → fan out: refuse incomplete reachability

Deletion target placement distinguishes clusters and refuses when a sweep cannot dispatch to a target that lives elsewhere. Tests require all needed clusters and avoid treating aliases of one cluster as separate work.
**Falsifier:** silently skip an unreachable declared target and then report complete deletion.
**Evidence located:** dispatchability and cluster enumeration tests. They cover selected placements, not proof that the registry includes every physical copy, backup, or future replay source.
**Qualification:** reaching every declared target and declaring every required target are different guarantees. No-resurrection after deletion remains an open obligation.
Sources: [target mechanism](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/deletion_targets.py), [placement and refusal tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/test/test_deletion_targets.py#L80).

## What is viable enough to pursue

This round supports continuing with narrowly scoped **acknowledgment barriers**, **tenant-scoped access**, **conditional publication**, and **retry recognition**. It demonstrates one original oracle's sensitivity and three lower-grade primitive counterfactuals. It does not demonstrate a portable definition or successful adoption.

The expanded paths suggest further candidates: resumption without omissions, error classification under declared policy, destination confinement, commit-ordered recoverable dispatch, current-authority checks, revocation across state restoration, and complete-target refusal.
Most useful overlaps are relationships, not component types: late cache work and late UI responses; received work and completed deletion; a queued actor and a resumed actor.
Do not turn those similarities into one bundled mandatory definition before testing the differences.

## Next gate, and why no Scope prototype yet

1. Reproduce the two original Python suites under the pinned Python/lockfile with separately provisioned test databases. No production credentials or existing development database resets. Repeat the exact frozen mutants and restorations there.
2. Freeze a small binding for the supported property, including conditions and exact evidence scope. Challenge it with another implementation context; retain unknown or non-fitting cases rather than expanding an opaque predicate field until everything fits.
3. Only then preview the bindings in Scope and compare reader performance against the existing source comment/test title. No reader-benefit result exists yet.

No further source-mutating trial or UI implementation was automatically added to compensate for blocked evidence. The unmet original-Python criterion stays visible.

## Reproduction and isolation

The detached checkout remains at `/tmp/coherence-posthog-probes.jYxKId/posthog`, restored to the pinned tracked source. Its only untracked entries are dependency symlinks to the existing main checkout's dependency trees. The main checkout's pre-existing desktop harness change remains untouched; no shared services or databases were started, reset, or stopped.
The minimal venv remains at `/tmp/coherence-posthog-probes.jYxKId/probe-env`. These temporary paths are not durable distribution artifacts; reconstruct them from the source commit and dependency record when needed.

Node run, from the isolated `nodejs/` directory (a sanitized environment was used, with no inherited credentials):

```sh
node_modules/.bin/jest --config jest.config.js --runInBand --no-cache --json --outputFile=<result.json> --runTestsByPath src/ingestion/api/grpc-server.test.ts
```

Fallback run, from Coherence:

```sh
POSTHOG_PROBE_ROOT=<isolated-posthog> <probe-env>/bin/python docs/assays/posthog-guarantees-r2/probe_primitives.py
```

Apply only one mutation from [MUTATIONS.md](MUTATIONS.md), run the corresponding oracle, restore it, and rerun. The native and fallback oracles must never be combined into one satisfaction verdict.
The frozen procedure is [PROTOCOL.md](PROTOCOL.md); source, harness and result fingerprints are in [provenance.json](provenance.json).

PostHog's test-writing guidance influenced the decision to reuse the existing Node suite and keep the new Python instruments isolated, behavioral, cheap, and explicitly below the full integration grade. None is proposed as redundant permanent upstream coverage.
