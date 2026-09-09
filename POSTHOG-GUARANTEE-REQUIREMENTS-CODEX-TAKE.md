# PostHog guarantee requirements — Codex's take

2026-09-09. Requirements discovery from source, not a security audit, executable verification, or portability score.

## What this pass establishes

PostHog supplies concrete subjects for useful guarantees: scoped data access, service authorization, streaming ingestion, asynchronous cache publication, query transformation, flag evaluation, and deletion workflows.
The useful vocabulary describes what must survive a boundary or sequence of events, not a general adjective attached to a component.
Several requirements already have narrowly named regression tests. Coherence would need to connect those existing claims and oracles, not introduce a competing account of what the component promises.

Source: the existing local checkout of [PostHog/posthog](https://github.com/PostHog/posthog), pinned to [c54fec2163ad9455fd23a947f86a9034c1df9388](https://github.com/PostHog/posthog/commit/c54fec2163ad9455fd23a947f86a9034c1df9388), dated 2026-08-28.
The checkout had one unrelated dirty desktop harness file; it was not used or modified.
All source links below target that commit. The study used repository source and test bodies, not deployed infrastructure or customer data.
No PostHog code or tests were executed. Test presence and inspected assertions are evidence of an intended contract, not evidence that today's deployment satisfies it.

This is deliberately selected, single-project discovery. It is neither an exhaustive inventory nor an independently curated assay.
The numbered entries below are working requirements, **not admitted catalog IDs**. Compound entries identify separate clauses that must not automatically become a mandatory bundle.

## Concrete requirements

### 1. Data access retains the intended tenant scope

**Promise:** An ordinary scoped query sees only rows belonging to its effective tenant; missing scope refuses instead of expanding access.

`TeamScopedManager.get_queryset` filters by context or raises `TeamScopeError`.
Its tests create flags in two teams and require only the selected team's flag; another test requires refusal with no scope.
PostHog additionally distinguishes canonical parent-team scope from environment scope. A universal template cannot assume that every project uses `team_id`, or that all child environments must be isolated the same way.

**Falsifier:** A scoped query returns another effective tenant's row, or an unscoped ordinary query silently returns everything.

**Limit:** The framework explicitly documents bypasses through framework managers and raw SQL. This manager is defense in depth, not proof that all endpoints, joins, caches, and background jobs are tenant-safe. Explicit cross-team access is not inherently a violation; it requires separate authority.

Sources: [manager](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/scoping/manager.py), [test_manager.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/scoping/test_manager.py), [scope contract and bypasses](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/scoping/README.md).

### 2. A credential authorizes only its declared resource and operation

**Promise:** A recording-service JWT for one team and a read operation cannot authorize another team's recording or deletion. Audience, expiry, and accepted signing keys also constrain acceptance.

The Python minter supplies team and operation claims; the Node verifier checks them against the route. Tests explicitly reject cross-team tokens, read tokens used for deletion, wrong audiences, expired tokens, and retired keys.

**Falsifier:** A read-only token reaches the delete handler, a token works for another team, or a retired signing key remains accepted after removal.

**Limit:** The code supports a transitional shared-secret fallback and unauthenticated local development, with a separate production configuration guard. The stronger JWT-scoping claim cannot describe requests accepted through the legacy branch. Key rotation is another useful clause, not proof of end-to-end authorization.

Sources: [Python minter](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/session_recordings/recordings/recording_api_jwt.py), [Node middleware](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/session-replay/recording-api/auth.ts), [authorization and rotation tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/session-replay/recording-api/auth.test.ts).

### 3. Acknowledgment follows the promised completion barrier

**Promise:** An ingestion sub-batch is not acknowledged as successful until its driver's side-effect settlement promise resolves. Failure at that barrier does not become a successful acknowledgment.

`CompletedSubBatch` separates processing completion from `settled`; `settleAndAck` awaits the latter. The server can acknowledge independently settled batches out of order by sequence identity rather than blocking them behind a slow batch.

**Falsifier:** Hold the settlement promise unresolved and observe a successful acknowledgment; reject it and observe success anyway.

**Limit:** The server trusts the driver's definition of settlement. Inspecting this barrier does not prove Kafka durability, downstream indexing, query visibility, or exactly-once processing. Each later boundary needs its own contract.

Sources: [server and settlement barrier](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.ts), [stream, failure, settlement and drain tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.test.ts).

### 4. Retrying an already-applied operation preserves its successful effect

**Promise:** Retrying the cache's pointer swap after a lost reply reports the already-applied swap as successful. It must not take the cleanup branch and delete the object the live pointer references.

The Redis script checks for its own already-written pointer before comparing the old expected value. The regression test explicitly repeats the swap with stale expected bytes and requires success with the live pointer unchanged.

**Falsifier:** Apply the swap, lose the reply, retry, and observe the live blob deleted or the retry classified as a superseded operation.

**Important contrast:** Feature-flag event deduplication deliberately lets the *same event's* redelivery pass its earlier claim, while suppressing other claims for the tuple within a configured window. Dropping every retry at this early stage could lose an event whose downstream processing never completed. Neither mechanism proves global exactly-once behavior.

Sources: [idempotent swap script](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/size_tracker.py), [`test_stale_upload_cannot_replace_a_newer_entry`](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/test/test_storage.py#L243), [deduplication policy](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.ts), [redelivery and error tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.test.ts).

### 5. Late asynchronous work cannot overwrite a superseding value

**Promise:** An old cache result's S3 upload cannot replace a newer cache entry merely because it finishes later.

The cache passes its original stored bytes into a conditional pointer replacement. The test schedules two uploads, completes the newer first, then the older, and requires the newer result to remain readable. Cleanup must affect only the losing upload's object.

**Falsifier:** Reverse completion order and observe the older result restored or the winning object removed.

**Limit:** This is exact-value conditional replacement, not a demonstrated general version protocol or linearizability claim. In particular, an expected-value scheme needs further analysis if distinguishing equal-value intermediate writes matters.

Sources: [cache handoff](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/cache.py#L90), [upload and cleanup](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/storage.py#L198), [conditional replacement](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/size_tracker.py#L132), [race test](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/test/test_storage.py#L243).

### 6. Transport preserves ordering only for the declared identity and lane

**Promise:** Where routing declares per-person or per-session ordering, the sink preserves the partition key that realizes that decision. It does not independently infer a different ordering policy from an unrelated header.

Capture already has an `OrderingGuarantee` vocabulary. Routing chooses the policy; the sink realizes it. Some lanes deliberately choose no ordering.

**Falsifier:** A sink drops the key despite an ordering requirement, or keeps/drops it based on a header that contradicts the routing decision.

**Limit:** A correct Kafka key is one prerequisite, not proof of end-to-end order across producers, rebalances, processing, and storage. A reusable clause needs the ordering domain and relevant sequence definition; global event order would be the wrong promise.

Sources: [routing](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/capture/src/pipeline.rs), [`ordering_decides_partition_key`](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/capture/src/v1/sinks/kafka/sink_tests.rs#L751).

### 7. Admission is bounded, and admitted contenders receive the declared scheduling treatment

These are two separate clauses: **capacity safety** and **fair admission**.

The ingestion server caps concurrent streams and uses FIFO admission for batch slots. Tests require refusal beyond the cap, removal of canceled waiters, and admission of an earlier waiting stream before a busy stream's later request. Another test requires a slow settlement not to block an independently completed batch's acknowledgment.

**Falsifiers:** Exceed the configured stream cap without refusal; repeatedly let later arrivals overtake an earlier eligible waiter; or let one unresolved settlement prevent another settled batch's acknowledgment.

**Limit:** FIFO admission is not a wall-clock latency bound, equal tenant throughput, or general starvation freedom under arbitrary stalled dependencies. Fairness is conditioned on slots becoming available and the waiter remaining eligible. The stream cap does not establish that every buffer is bounded.

Sources: [server controls](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.ts), [FIFO, cancellation, independent settlement and cap tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.test.ts).

### 8. An optimization preserves the query's answer

**Promise:** Pushing a result limit into an inner query must not truncate the population needed by an aggregate, window function, or later filter.

The checkout's HEAD is a particularly concrete example: a fix restricting limit pushdown in the persons query. One regression test creates three people and requires a count of three even when the outer result limit is one.

**Falsifier:** An optimized count returns the page size or a truncated population instead of the count required by the query.

**Limit:** This is semantic preservation, not byte-identical output or one-to-one copying. A reusable family can name equivalence, but must expose where the reference semantics and observation relation come from. A callback hiding an entire local contract is not effortless portability. These tests cover specific query forms, not every optimizer transformation.

Sources: [pushdown conditions](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/hogql/database/schema/persons.py#L174), [regression tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/hogql/database/schema/test/test_persons.py#L246).

### 9. A rollout assignment survives the identity changes it promises to survive

**Promise:** With experience continuity enabled and applicable flag state held fixed, the anonymous-to-identified transition uses the preserved assignment identity rather than unintentionally rebucketing the user. Compatible evaluators should also agree on the supported common inputs.

The experience-continuity test exercises an anonymous hash-key override, then a request without the anonymous ID, and requires the preserved outcome. Separate matching tests use shared expected rollout results. The implementation also tests that a stale stored override does not continue applying after continuity is disabled.

**Falsifier:** Enabling the promised continuity still changes assignment solely because the user identifies, or implementations disagree on a shared conformance case.

**Limit:** This is not “the flag never changes.” Flag revisions, eligibility changes, deliberate continuity disablement, and unavailable identity state matter. The shared expected vectors are not a live comparison of all SDKs.

Sources: [matching and override handling](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/feature-flags/src/flags/flag_matching.rs), [continuity tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/feature-flags/tests/test_experience_continuity.rs), [matching conformance cases](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/feature-flags/tests/test_flag_matching_consistency.rs).

### 10. Completion status requires evidence of the requested outcome

**Promise:** Deferred event deletion is not marked completed merely because work was queued. Verification must observe no matching rows across the registered relevant read targets before promotion.

`verify_queued_request` counts remaining events and conditionally advances eligible statuses. Tests require the request to remain queued with three matching events and permit completion when none remain.
The counter explicitly uses a conservative superset when a target cannot express a HogQL predicate. That may delay completion; it must not manufacture early success.

**Falsifier:** A matching row survives in a declared target while verification promotes the request to completed.

**Limit:** This is an event-removal verification path, not proof of deletion from backups, every external destination, or all future replay sources. Completeness depends on the target registry and predicate. The observation is not automatically a permanent no-resurrection guarantee.

Sources: [counting and promotion](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/data_deletion_request.py#L758), [workflow tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/dags/tests/test_data_deletion_requests.py#L545).

## Additional supported directions, not a complete second catalog

Compatibility has concrete instances: the query cache explicitly tests reading pre-rollout formats, and recording JWTs test an overlapping signing-key rotation window followed by rejection of retired keys.
These need a declared version/key acceptance matrix, not a promise to accept old data forever.
Sources: [cache compatibility tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/test/test_cache.py), [JWT rotation tests](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/session-replay/recording-api/auth.test.ts).

Degradation policy is a qualification throughout, not one universal “fail closed” rule.
Tenant scope refuses when absent. Deduplication permits events on reported Redis errors, but its source explicitly says connectivity loss can queue commands rather than reject promptly; an error-path test is not an availability bound.
The query cache can retain inline data when its S3 upload fails or capacity is exhausted.
Outbound egress also documents a best-effort local-counter fallback and deliberate priority exceptions. Calling that a strict global quota guarantee would overstate it.
Sources: [deduplication limits](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.ts#L195), [cache upload](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/storage.py#L198), [egress contract](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/egress/README.md).

## What this suggests for Coherence

Start with relational properties such as scoped access, acknowledgment barriers, retry-safe effects, supersession safety, keyed ordering, capacity bounds, equivalence, and evidence-qualified completion.
This is a hypothesis about a better vocabulary, not a finding that these definitions transfer unchanged to other projects.

A useful adopted guarantee should answer:

- What subject or interaction owes this property?
- Under what identity, configuration, version, failure model, and time window?
- What observable result is forbidden or required?
- Which existing test or check addresses it, and what does that evidence actually cover?

The reusable part is the relation and its testing pattern. PostHog supplies the local identities, operations, lane policies, target populations, and observation semantics.
Some relations may support small declarative bindings. Semantic equivalence is a conspicuous case where a local reference oracle is still substantive work; this study does not solve that problem with a generic predicate field.

For Scope, the useful connection would read **“acknowledges only after side effects settle”** or **“late upload cannot replace newer result”**, with its conditions and evidence available for inspection.
It should not say merely “guaranteed,” and a passing sink test should not paint the entire ingestion path green.

If we pursue a small next investigation, I would start with the ingestion acknowledgment barrier, cache retry/supersession pair, and scoped tenant query.
They have particularly concrete subjects and counterfactuals. Test whether bindings can express these without restating whole implementations, then ask an independent reader whether the result adds understanding beyond the existing test title and source comment.
Failure to add information, or needing bespoke contract prose for every instance, would be a reason to retain them as local claims instead of promoting a product family.

## Limits and outstanding work

No runtime verification, fault injection, coverage measurement, or human usefulness trial was run.
This selection favors already-articulated and tested behavior; it does not measure how many unprotected obligations exist.
Billing accuracy, identity merge concurrency, export delivery, schema migration safety, frontend stale-response handling, secret redaction, regional placement, recovery objectives, and end-to-end deletion remain unassessed here.
Their omission is not evidence of absence or adequacy.
No Coherence taxonomy, guarantee catalog, bindings, Scope implementation, or PostHog source was changed by this study.
