# PostHog Rust capture glossary adoption review

Work order: `w-f9476e49`  
Review date: 2026-09-18  
Upstream: `PostHog/posthog`  
Pinned revision: `fe5e40a8f006389dcc0eac4fde4faad0333cab16` (`2026-09-18T18:42:19Z`)

## Verdict

The exercise produced a **36-concept, service-scoped candidate glossary** and a separate evidence/rulings ledger. The candidate is source-supported but **not human-approved**. Coherence review records were deliberately left `deferred`; readiness is therefore false.

The exercise found:

- **One confirmed Coherence glossary-tool defect:** `glossary coverage --json > report.json` inventories its own generated report, and a later run reads that report as source, amplifying the corpus.
- **No confirmed current PostHog capture-service bug** at the pinned revision.
- **Four important historical capture bugs verified as fixed** in the pinned code/history: unbounded lz64 expansion before enforcement (#102546), v1 AI event loss caused by cross-lane refusal (#102511 reverting #95466), oversized-body rejection failing to deliver 413 reliably (#85639), and global-limiter Redis work causing silent under-enforcement (#83250).
- **One current unverified availability risk:** request-body read timeout is still per chunk, so a slow-drip client can keep resetting the timer. This was explicitly left as follow-up in #85639; no live or load test was performed, so it is not classified here as a confirmed service bug.

## Scope and boundaries

Analyzed source population:

- `rust/capture/Cargo.toml`
- `rust/capture/src/**`
- `rust/capture/tests/**`
- `rust/capture/docs/**`
- `rust/common/types/**`
- `rust/common/compression/**`
- `rust/common/limiters/**`

The common crates were included because capture's event envelope, team/project fields, timestamp parser, decompression cap, overflow limiter, and global rate limiter cannot be interpreted correctly from `rust/capture` alone.

This is not a whole-PostHog glossary. Downstream Node/Python/SDK behavior was considered only where pinned capture comments or merged PR bodies establish the boundary. No production service, customer data, credentials, Kafka, Redis, S3, or database was accessed. The older checkout at `/Users/daniloc/Documents/Dev/posthog` was not mutated or treated as current behavior.

## Representative paths traced

### v1 request to response

1. Build request context and validate authorization/header shape.
2. Read the wire body under the compressed-body cap.
3. Decompress under a separate decompressed-output cap.
4. Deserialize the batch and validate batch/event fields.
5. Apply mode policy, gateway provenance, billing quota, event restrictions, AI per-event size, AI rolling byte budget, historical rerouting, overflow stamping, and the global token/distinct-ID limiter.
6. Serialize publishable events, publish through the configured v1 sink, correlate sink outcomes by event UUID, and merge them into per-event results.
7. Return HTTP 200 with UUID-keyed `ok`, `warning`, `drop`, or `retry`; add `Retry-After` if any event is retryable.

### legacy request to output

Legacy raw events become `CapturedEvent` plus `ProcessedEventMetadata`. Pipeline metadata resolves a storage-agnostic address and ordering guarantee. The output layer applies whole-batch failover policy above concrete sinks; sinks perform destination-to-topic resolution and publication.

### identity, limits, and time

- API token shape is validated at the edge, but capture does not load the owning team merely to prove token ownership.
- `Team.id`, `Team.project_id`, and `Team.api_token` are distinct. Common types fall back from absent historical `project_id` to `team.id`; the AI “per-project” byte budget is nevertheless keyed operationally by token.
- Distinct ID drives person association, global-limiter keys, and ordinary partition ordering; event UUID correlates event results; session ID drives replay ordering.
- Timestamp source names the branch that initially produced a timestamp, while effective/stored timestamp may be changed later by future clamping or bounds fallback.

## Important terminology rulings

### Accepted, captured, published, persisted

These must not collapse into one synonym set.

- **Captured event**: the normalized serialized `CapturedEvent`-shaped representation. It is a stage/type, not an acknowledgement claim.
- **Published event**: the configured sink reported success. This is the strongest persistence statement capture itself can make.
- **Accepted event**: the client should not resubmit. In v1 this normally means `ok` or `warning`, but import mode can acknowledge intentional discard with a per-event drop result.
- **Persisted event**: rejected as an alias for accepted event. “Persisted” is too broad unless the named persistence boundary is explicit; capture does not prove downstream consumption or final database insertion.

`ok` therefore does not mean “present in ClickHouse.” `retry` explicitly means the sink was not acknowledged and resubmission is safe. `warning` remains publishable but disables person processing. `drop` is terminal and is not overflow.

### Drop, overflow, retry, failover

- **Drop**: do not publish this event; client should not retry it.
- **Overflow**: route the event to a separate lane/topic, often to isolate or spread a hot key. It remains publishable.
- **Retry**: per-event sink timeout/retriable failure; not acknowledged, safe to resubmit.
- **Failover**: output policy substitutes a fallback backend for an unhealthy or retryably failed primary. It is not client retry and not overflow routing.

### Pipeline, lane, destination, sink

- **Pipeline** is the product-processing family (analytics, AI, replay, warnings, heatmaps, error tracking).
- **Lane** is a branch inside a pipeline, principally main or overflow.
- **Destination** is the per-event storage-agnostic routing outcome, including terminal `Drop` and explicit custom/DLQ routes.
- **Sink** is the concrete backend adapter that resolves destinations and publishes.

PR prose also uses “AI lane” and “analytics lane” for endpoint/deployment surfaces. The glossary preserves the routing-branch definition and flags this endpoint-lane overload as an owner question rather than silently choosing both.

### Global limit, overflow limiter, quota, AI byte budget

- **Global rate limit**: fleet-aware token-plus-distinct-ID evaluation whose capture effect is disabling person processing. It is separate from burst overflow routing and fails open on limiter infrastructure errors.
- **Overflow stamping**: marks a publishable event for overflow based on restriction or burst policy.
- **Quota**: billing/entitlement allowance; rejection is a terminal policy drop.
- **AI byte budget**: fleet-wide weighted limit shared across capture paths, keyed by token and charged in event payload bytes. It is not a request-body cap.

Historical #83013 cannot be read as current behavior from its title. At the pinned revision, already-disabled events are still evaluated by the global limiter, and #101921 splits their metrics by whether they were over budget.

### Original/effective timestamps

- **Original timestamp**: client field before parsing/correction.
- **Sent-at timestamp**: request send time used to estimate clock skew against server receive time.
- **Effective timestamp**: exported value after branch selection, optional skew/offset handling, future clamp, and bounds fallback.
- **Timestamp source**: the branch (`offset`, `sent_at_skew`, raw client timestamp, or now fallback) that initially computed the value; it is recorded before later clamps can mutate the value.

### Byte stages

The glossary separates:

1. wire/compressed body bytes,
2. decompressed payload bytes,
3. per-event bytes used for broker/message safety,
4. rolling AI event bytes charged to a token budget.

The paths do not measure per-event bytes identically: v1 cheaply measures the properties blob, while other paths can measure a fuller serialized event. The code states that deployment headroom absorbs the difference; whether operator-facing names should expose that approximation remains an owner question.

## PR/history adjudication

All listed PRs were fetched through the GitHub API, verified as merged, and read via body, changed-file patches, and available issue/review discussion. Current code at the pinned revision was then checked separately.

| PR | Merged | Use in ruling |
|---|---:|---|
| #102546 | 2026-09-17 | Fixed lz64 expansion enforcement; byte cap is UTF-8 output bytes, not merely UTF-16 units or post-allocation comparison. |
| #102031 | 2026-09-17 | Separated timestamp branch origin from final stored value; metrics-only behavior. |
| #102511 | 2026-09-17 | Fixed active event loss by reverting #95466's analytics-lane refusal. |
| #95466 | 2026-09-17 | Demonstrates a rejected prefix-based endpoint-membership rule; merged then fully reverted after SDK incompatibility. |
| #101921 | 2026-09-16 | Clarified already-disabled versus over-budget global-limiter outcomes without changing behavior. |
| #87034 | 2026-09-03 | Introduced the dedicated v1 AI endpoint/lane. |
| #89039 | 2026-09-01 | Retired an implementation `Event` wrapper, not the event domain concept. |
| #81243 | 2026-09-01 | Moved failover policy to outputs above sink preparation. |
| #89757 | 2026-08-31 | Global-limiter burst-detection evolution and operational/fail-open boundaries. |
| #83680 | 2026-08-20 | Established token-keyed, fleet-wide AI byte budget despite “per project” prose. |
| #85639 | 2026-08-20 | Fixed draining of oversized request bodies so clients receive 413; explicitly left main-read total-deadline follow-up. |
| #83250 | 2026-08-19 | Fixed bounded Redis work and silent under-enforcement; pinned common limiter also caps deferred structures. |
| #83013 | 2026-08-14 | Historical person-processing/GRL behavior that must not override later pinned implementation and #101921. |

## Coherence experiments

The adopter used the current absolute CLI against an isolated workspace. Exact hashes, commands, outputs, model configuration, proposal IDs, decision IDs, review evidence behavior, readiness output, Scope command, and reproducer are in:

- `docs/reference/posthog-capture-glossary/experiments.md`

Notable results:

- Rust extraction yielded 9,392 lexical terms and 156,919 uses from the final population. These counts were not interpreted as missing-concept counts or semantic coverage.
- The write workflow caught duplicate accepted/rejected naming mistakes in the candidate.
- Attempting `confirmed` review without a human correctly failed; six representative senses were recorded `deferred`.
- `glossary ready` correctly remained false.
- Scope built with a domain glossary, zero components, zero specs/bullets, and zero runs.
- The existing pinned BGE model was reused offline. Similarity highlighted the accepted/published/captured collision but did not decide it.

## Bugs and risks

### Confirmed Coherence defect: coverage output self-ingestion

**Actual:** shell redirection creates `report.json` before the CLI inventories the workspace. The first coverage result lists `report.json`; the second reads the generated JSON as source and creates many new terms/uses. In the capture corpus, accidental root-level output caused a much larger self-fed population and a draft command had to be interrupted.

**Expected:** generated machine-readable output should not silently become evidence for the analysis that produced it, or the CLI should provide an ignored output path and warn/guard against root-level redirection.

**Impact:** non-reproducible coverage, polluted candidates, potentially severe time/memory growth on repeated runs.

**Minimized reproducer:** `docs/reference/posthog-capture-glossary/repro-coverage-self-ingestion.sh`.

### Current capture service

No current service bug was established from the pinned source and synthetic/offline work.

The per-chunk body timeout is a concrete, source-visible risk but remains unverified as a defect: each arriving chunk resets the timeout, allowing total request duration to exceed the configured interval. This review did not perform a load/availability experiment and does not know whether an upstream proxy supplies the intended whole-request bound.

## Limitations

- No live ingestion, production telemetry, real Redis/Kafka/S3, or customer data.
- No full PostHog monorepo build/test setup; tests were read, not executed. The sparse pinned snapshot and merged CI/test descriptions supplied enough evidence for glossary adjudication.
- No Rust language-server or symbol-resolution claim. Coherence extraction is lexical.
- No whole-repository meaning coverage claim. The candidate intentionally omits thousands of ordinary/internal lexical candidates.
- No human terminology approval. Candidate provenance says `not-human-approved`, review contexts are deferred, and readiness is false.
- Scope HTML generation succeeded, but no browser rendering exercise was required or claimed.

## Artifacts

- Candidate glossary: `docs/reference/posthog-capture-glossary/glossary.json`
- Evidence/rulings ledger: `docs/reference/posthog-capture-glossary/evidence-ledger.json`
- Commands and observations: `docs/reference/posthog-capture-glossary/experiments.md`
- Minimized tool reproducer: `docs/reference/posthog-capture-glossary/repro-coverage-self-ingestion.sh`
