# Guarantee vocabulary v0 — Codex's take

Generated from the shipped candidate catalog. Do not edit this projection by hand.

36 candidates · coherence-guarantees/v0 · single-project portability unproven.

Candidate vocabulary, not activated obligations or satisfaction. PostHog examples are author-selected, scoped and unevenly tested. No whole-project coverage, portable activation or immutable receipt is established. Historical taxonomy suggestions and spec claims retain their existing identities; this catalog does not replace or automatically bind them.

See [STUDY-CODEX-TAKE.md](STUDY-CODEX-TAKE.md) for breadth, curation choices and remaining work.

| ID | Guarantee | Example grade |
| --- | --- | --- |
| guarantee:scoped-reads | Scoped reads | mutation-tested |
| guarantee:capability-authorization | Capability authorization | test-inspected |
| guarantee:current-authority | Current authority | test-inspected |
| guarantee:destination-confinement | Destination confinement | source-inspected |
| guarantee:message-authenticity | Message authenticity | test-inspected |
| guarantee:encrypted-storage | Encrypted storage | test-inspected |
| guarantee:key-rotation-compatibility | Key rotation compatibility | test-inspected |
| guarantee:redaction | Policy-scoped redaction | test-inspected |
| guarantee:input-validation | Input contract enforcement | test-inspected |
| guarantee:semantic-preservation | Semantic preservation | test-inspected |
| guarantee:canonical-encoding | Canonical encoding | test-inspected |
| guarantee:identity-continuity | Identity continuity | test-inspected |
| guarantee:revision-preservation | Revision preservation | test-inspected |
| guarantee:separation-of-duties | Separation of duties | source-inspected |
| guarantee:legal-state-transitions | Legal state transitions | test-inspected |
| guarantee:supersession-safety | Supersession safety | mutation-tested |
| guarantee:retry-recognition | Already-applied retry recognition | mutation-tested |
| guarantee:duplicate-suppression | Identity-scoped duplicate suppression | test-inspected |
| guarantee:keyed-ordering | Keyed ordering | test-inspected |
| guarantee:worker-fencing | Stale worker fencing | test-inspected |
| guarantee:acknowledgment-barrier | Acknowledgment barrier | mutation-tested |
| guarantee:commit-ordered-effects | Commit-ordered side effects | test-inspected |
| guarantee:durable-dispatch-intent | Durable dispatch intent | test-inspected |
| guarantee:resumption-coverage | Resumption without omissions | test-inspected |
| guarantee:retry-classification | Retry classification | test-inspected |
| guarantee:graceful-drain | Graceful drain | test-inspected |
| guarantee:cancellation-release | Cancellation releases capacity | test-inspected |
| guarantee:bounded-admission | Bounded admission | test-inspected |
| guarantee:fair-admission | Fair admission | test-inspected |
| guarantee:rate-budget | Identity-scoped rate budget | test-inspected |
| guarantee:memory-budget | Accounted memory budget | test-inspected |
| guarantee:execution-budget | Execution step budget | test-inspected |
| guarantee:circuit-breaker-policy | Circuit-breaker policy | test-inspected |
| guarantee:readiness-evidence | Readiness requires current evidence | test-inspected |
| guarantee:declared-target-coverage | Declared target coverage | test-inspected |
| guarantee:completion-evidence | Completion requires outcome evidence | test-inspected |

## 1. Scoped reads

`guarantee:scoped-reads` · Authority and privacy

Ordinary reads through the named boundary return only records in the declared effective scope, and missing required context refuses.

Applies when: A read entry point promises to restrict a shared population using explicit scope context.

Binding parameters: read boundary; population; effective-scope relation; context source; authorized bypasses.

Excludes: Raw queries, alternate managers, and explicit cross-scope operations outside the bound entry point; context correctness needs its own evidence.

Falsifier: Create records in two scopes; read under one context and observe the other's record, or omit context and obtain an unrestricted read.

Demote or revise when: The scope relation cannot distinguish permitted from forbidden records without embedding a new local access policy in the definition.

Distinct from `guarantee:capability-authorization`: Confining a result population does not establish the caller's right to perform the operation.

Example: [posthog/models/scoping/manager.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/scoping/manager.py#L70).

Oracle inspected: [posthog/models/scoping/test_manager.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/scoping/test_manager.py#L22) — `test_team_scope_filters_to_team`.

Evidence grade: **mutation-tested**. Filter removal exposed two rows instead of one. Missing-context test passed but its refusal branch was not mutated. Framework bypasses remain.

Retained run: [docs/assays/posthog-guarantees-r3/baseline.xml](../../../docs/assays/posthog-guarantees-r3/baseline.xml).
Retained run: [docs/assays/posthog-guarantees-r3/tenant-mutated.xml](../../../docs/assays/posthog-guarantees-r3/tenant-mutated.xml).
Retained run: [docs/assays/posthog-guarantees-r3/tenant-restored.xml](../../../docs/assays/posthog-guarantees-r3/tenant-restored.xml).

## 2. Capability authorization

`guarantee:capability-authorization` · Authority and privacy

A credential authorizes only its declared resource, operation, audience and validity interval at the named acceptance boundary.

Applies when: A service accepts credentials carrying bounded authority.

Binding parameters: acceptance boundary; resource identity; operation set; audience; validity and key policy.

Excludes: Legacy shared-secret and intentionally unauthenticated branches; authenticity alone does not confer authority.

Falsifier: Present a valid read token to a delete operation or another resource and observe acceptance.

Demote or revise when: A binding needs mutually incompatible meanings of resource or action that cannot be stated as explicit sets and matching rules.

Distinct from `guarantee:message-authenticity`: An authentic message can still request an unauthorized action.

Example: [nodejs/src/session-replay/recording-api/auth.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/session-replay/recording-api/auth.ts#L4).

Oracle inspected: [nodejs/src/session-replay/recording-api/auth.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/session-replay/recording-api/auth.test.ts#L7) — `describe`.

Evidence grade: **test-inspected**. Source-inspected JWT rejection cases; fallback and development paths prevent a blanket route guarantee.


## 3. Current authority

`guarantee:current-authority` · Authority and privacy

Deferred or resumed work revalidates the actor's current authority at the declared execution boundary rather than relying solely on queue-time authority.

Applies when: An authority-changing interval separates acceptance from execution or resumption.

Binding parameters: actor; deferred work; revalidation point; authority source; trusted-system exceptions.

Excludes: Revocation of already-running work and remote invalidation of copied credentials; those require separate enforcement.

Falsifier: Queue work, revoke membership, then dispatch it successfully without a declared trusted-system exception.

Demote or revise when: Queued and resumed examples require different authority times but the binding cannot name which observation controls execution.

Distinct from `guarantee:capability-authorization`: This tests authority changing over time, not only the shape of one accepted credential.

Example: [products/tasks/backend/management/commands/run_task_workflow_dispatcher.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/management/commands/run_task_workflow_dispatcher.py#L54).

Oracle inspected: [products/tasks/backend/tests/test_workflow_dispatch.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/tests/test_workflow_dispatch.py#L409) — `membership`.

Evidence grade: **test-inspected**. Permission service is mocked in inspected tests. Resume credential-clearing is a second discovery context, not an executed general binding.


## 4. Destination confinement

`guarantee:destination-confinement` · Authority and privacy

Outbound payload delivery remains inside the declared destination policy through redirects and other followed hops.

Applies when: A sender accepts a destination or follows a response that can change it.

Binding parameters: sending boundary; allowed destinations; redirect policy; payload and credential scope.

Excludes: A URL allowlist alone does not prove DNS-rebinding resistance or confinement of uninspected transports.

Falsifier: An allowed initial destination redirects to a forbidden destination and the sender forwards the payload.

Demote or revise when: The proposed policy cannot describe actual followed destinations, or merges transport confinement with unrelated actor permissions.

Distinct from `guarantee:scoped-reads`: This confines where data is sent, not which records a read returns.

Example: [products/batch_exports/backend/temporal/destinations/http_batch_export.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/temporal/destinations/http_batch_export.py#L164).

Oracle: not located in the bounded search.

Evidence grade: **source-inspected**. Two endpoint URLs and disabled redirects were inspected. No matching end-to-end redirect-confinement oracle was located in the bounded search.


## 5. Message authenticity

`guarantee:message-authenticity` · Authority and privacy

A message is accepted only if its protected fields verify under the declared signing and trust policy.

Applies when: A receiver relies on a signed external message before applying effects.

Binding parameters: signed fields and canonicalization; trust anchors; accepted algorithms; verification boundary.

Excludes: Replay freshness, authorization and truthful content from an authorized signer are not established by signature verification.

Falsifier: Change a protected payload field without resigning and observe acceptance.

Demote or revise when: The binding cannot enumerate protected fields or distinguish signature validity from authorization and replay policy.

Distinct from `guarantee:capability-authorization`: Authenticity establishes protected-message origin and integrity, not permission to act.

Example: [products/workflows/backend/services/sns_verification.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/workflows/backend/services/sns_verification.py#L131).

Oracle inspected: [products/workflows/backend/test/test_sns_verification.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/workflows/backend/test/test_sns_verification.py#L86) — `test_rejects`.

Evidence grade: **test-inspected**. Tampered payload/topic and invalid signatures are tested with a patched certificate fetch; no live trust-chain or replay assay was run.


## 6. Encrypted storage

`guarantee:encrypted-storage` · Authority and privacy

The named persistence boundary encodes protected values as ciphertext under the configured key policy rather than persisting plaintext.

Applies when: A field or object is explicitly designated confidential at rest.

Binding parameters: protected fields; write boundary; encryption policy; key ownership; allowed plaintext exceptions.

Excludes: Logs, process memory, backups, access control and cryptographic algorithm strength outside the declared boundary.

Falsifier: Write a synthetic secret through the field and find that plaintext in its raw persisted representation.

Demote or revise when: The example only encrypts a helper return value and cannot identify a persistence crossing to bind.

Distinct from `guarantee:redaction`: Encryption preserves recoverability with authority; redaction removes designated content from an output.

Example: [posthog/helpers/encrypted_fields.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/helpers/encrypted_fields.py#L105).

Oracle inspected: [posthog/helpers/tests/test_encrypted_fields.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/helpers/tests/test_encrypted_fields.py#L63) — `test_simple_encryption_and_decryption`.

Evidence grade: **test-inspected**. Persistence hook inspected, but the cited test exercises encryption/decryption helpers, not a raw database read. A persistence-crossing oracle remains needed; this is not a census of sensitive fields.


## 7. Key rotation compatibility

`guarantee:key-rotation-compatibility` · Authority and privacy

During the declared rotation stages, supported readers can decrypt retained data while new writes use the stage's designated key.

Applies when: Encrypted data must survive key changes and coexisting reader versions.

Binding parameters: rotation stages; reader key sets; write key per stage; retained data population; retirement point.

Excludes: Readability after deliberate removal of the only decrypting key, key compromise recovery and remote credential revocation.

Falsifier: Prepend a new write key while retaining the old read key and lose readability of old ciphertext, or write with the wrong stage key.

Demote or revise when: The stage model cannot distinguish a supported mixed deployment from deliberate key retirement without bespoke lifecycle clauses.

Distinct from `guarantee:encrypted-storage`: Ciphertext can remain encrypted while a rotation makes it unreadable.

Example: [posthog/helpers/encrypted_fields.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/helpers/encrypted_fields.py#L12).

Oracle inspected: [posthog/helpers/tests/test_encrypted_fields.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/helpers/tests/test_encrypted_fields.py#L99) — `test_prepending_new_key_keeps_old_data_readable_and_writes_with_new`.

Evidence grade: **test-inspected**. Multiple-key and two-stage tests inspected; removing an old key intentionally makes its old data unreadable.


## 8. Policy-scoped redaction

`guarantee:redaction` · Authority and privacy

Output removes or replaces content designated sensitive by the declared recognition and allowlist policy across the bound representation paths.

Applies when: A representation is exported with an explicit scrubbing policy.

Binding parameters: input representations; sensitive-content recognizer; allowlist; replacement rule; output boundary.

Excludes: Universal PII detection, irreversible anonymization, image/OCR coverage or representations absent from the binding.

Falsifier: Place a policy-designated secret in a bound nested representation and observe it unchanged in exported output.

Demote or revise when: A binding says all personal data without an enumerable representation population and a concrete recognizer boundary.

Distinct from `guarantee:encrypted-storage`: A scrubbed output must not expose the designated content even to a reader with storage access.

Example: [rust/replay-anonymizer/src/text.rs](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/replay-anonymizer/src/text.rs#L92).

Oracle inspected: [rust/replay-anonymizer/tests/typed.rs](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/replay-anonymizer/tests/typed.rs#L50) — `full_snapshot_parses_to_a_scrubbed_typed_tree`.

Evidence grade: **test-inspected**. Typed-tree test checks scrubbed text under an explicit allowlist and requires typed-parse feature; no claim of complete replay anonymization.


## 9. Input contract enforcement

`guarantee:input-validation` · Representation and meaning

When the declared validation policy is enabled, invalid inputs do not enter the accepted processing path.

Applies when: A boundary has an explicit schema and reject or quarantine behavior.

Binding parameters: input schema; enabled modes; validation boundary; coercion policy; rejection outcome.

Excludes: Unenforced schemas, unknown types explicitly allowed by policy, optional properties not checked, and semantic authorization.

Falsifier: Omit a required field with enforcement enabled and observe the event accepted without its declared rejection outcome.

Demote or revise when: The schema/coercion parameters cannot separate invalid data from explicitly permitted unknown or optional values.

Distinct from `guarantee:message-authenticity`: A correctly signed payload may still be structurally invalid.

Example: [nodejs/src/ingestion/common/steps/event-preprocessing/validate-event-schema.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/steps/event-preprocessing/validate-event-schema.ts#L73).

Oracle inspected: [nodejs/src/ingestion/common/steps/event-preprocessing/validate-event-schema.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/steps/event-preprocessing/validate-event-schema.test.ts#L41) — `should reject when required property is missing`.

Evidence grade: **test-inspected**. Required-property and pipeline drop tests inspected; disabled enforcement and unknown-type permissiveness are intentional exceptions.


## 10. Semantic preservation

`guarantee:semantic-preservation` · Representation and meaning

A transformation preserves the declared observable meaning of the reference computation on its supported input domain.

Applies when: An optimization or translation claims equivalence to a reference behavior.

Binding parameters: transformation; reference semantics; input domain; observation relation; permitted differences.

Excludes: Byte identity, performance improvement and equivalence of transformations or query forms outside the bound domain.

Falsifier: Push a page limit beneath an aggregate and obtain the page size instead of the full population count.

Demote or revise when: The observation relation becomes an opaque local program that restates the entire contract rather than a reviewable equivalence relation.

Distinct from `guarantee:canonical-encoding`: Consistent output can be consistently wrong; semantic preservation compares meaning against a reference.

Example: [posthog/hogql/database/schema/persons.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/hogql/database/schema/persons.py#L192).

Oracle inspected: [posthog/hogql/database/schema/test/test_persons.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/hogql/database/schema/test/test_persons.py#L141) — `count`.

Evidence grade: **test-inspected**. Inspected persons limit-pushdown regression cases; no exhaustive optimizer equivalence was measured.


## 11. Canonical encoding

`guarantee:canonical-encoding` · Representation and meaning

Inputs equivalent under the declared normalization relation produce the same encoded identity regardless of irrelevant representation ordering.

Applies when: A key, digest input or serialized identity must ignore representation-only differences.

Binding parameters: input tuple; normalization relation; encoding version; output identity.

Excludes: Cryptographic collision resistance, semantic correctness of the chosen identity and arbitrary input permutations that change meaning.

Falsifier: Reorder the same map's entries and obtain a different deduplication key.

Demote or revise when: Examples disagree on which differences are irrelevant and the declared normalization cannot express that without changing the promise.

Distinct from `guarantee:duplicate-suppression`: Stable keys do not show that repeated operations are actually suppressed.

Example: [nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.ts#L80).

Oracle inspected: [nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.test.ts#L172) — `is independent of $groups property ordering`.

Evidence grade: **test-inspected**. Tuple encoding and sorted group entries inspected; equality does not establish global collision freedom.


## 12. Identity continuity

`guarantee:identity-continuity` · Representation and meaning

A declared identity transition preserves the bound assignment or association while the policy and relevant state remain fixed.

Applies when: A system promises continuity across anonymous/identified or other identity changes.

Binding parameters: identity transition; preserved assignment; continuity policy; fixed state; reset exceptions.

Excludes: Flag revisions, eligibility changes, deliberately disabled continuity and unavailable identity state.

Falsifier: Hold flag policy fixed, identify an anonymous user under enabled continuity, and observe rebucketing solely from the identity change.

Demote or revise when: The supposedly preserved relationship cannot be separated from mutable policy that intentionally changes the assignment.

Distinct from `guarantee:canonical-encoding`: Continuity preserves a relationship across deliberately different identities, not equivalent input encodings.

Example: [rust/feature-flags/src/flags/flag_matching.rs](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/feature-flags/src/flags/flag_matching.rs#L15).

Oracle inspected: [rust/feature-flags/tests/test_experience_continuity.rs](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/feature-flags/tests/test_experience_continuity.rs#L209) — `anonymous`.

Evidence grade: **test-inspected**. Source-inspected anonymous hash-key override and disablement cases; not a guarantee that flag results never change.


## 13. Revision preservation

`guarantee:revision-preservation` · Representation and meaning

Publishing a new revision preserves the previous revision's bound content and identity instead of rewriting its history.

Applies when: A publication path maintains version-addressed history.

Binding parameters: publication boundary; revision identity; content field set; history retention policy.

Excludes: Database-administrator edits, deliberate retention deletion, tamper-proof storage and workers executing historical snapshots.

Falsifier: Publish changed content as revision two and observe revision one's content change or disappear without a retention event.

Demote or revise when: The binding cannot distinguish historical snapshots from a mutable current-state table, or preservation is already wholly expressed by another retained contract.

Distinct from `guarantee:supersession-safety`: The old revision remains addressable even when a newer revision legitimately becomes current.

Example: [products/workflows/backend/api/hog_flow.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/workflows/backend/api/hog_flow.py#L3523).

Oracle inspected: [products/workflows/backend/api/test/test_hog_flow_revisions.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/workflows/backend/api/test/test_hog_flow_revisions.py#L121) — `test_publish_appends_revision_and_bumps_version`.

Evidence grade: **test-inspected**. API creates snapshots of outgoing and incoming content. Model remains writable; this is publication-path preservation, not unrepresentable mutation.


## 14. Separation of duties

`guarantee:separation-of-duties` · Change control

An actor cannot satisfy mutually exclusive roles in the same protected operation when the declared approval policy forbids it.

Applies when: A policy requires independent request and approval authority.

Binding parameters: operation; actor identity; incompatible roles; policy snapshot; explicit bypasses.

Excludes: Policies allowing self-approval, proof that two accounts belong to different people, and enforcement outside the gated API.

Falsifier: With self-approval disabled, let the requester approve its own change through the protected endpoint.

Demote or revise when: The rule reduces entirely to ordinary single-role permission checking and no cross-role incompatibility remains.

Distinct from `guarantee:capability-authorization`: An otherwise authorized approver can be ineligible because it also requested this operation.

Example: [products/approvals/backend/permissions.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/approvals/backend/permissions.py#L23).

Oracle: not located in the bounded search.

Evidence grade: **source-inspected**. Explicit requester-versus-approver refusal inspected. Bounded API-test search did not establish a focused self-approval negative oracle.


## 15. Legal state transitions

`guarantee:legal-state-transitions` · Change control

A transition commits only from a currently allowed predecessor state, rechecked within the serialization boundary.

Applies when: Concurrent actors may make competing terminal decisions about one stateful subject.

Binding parameters: subject; allowed transition relation; serialization boundary; conflict outcome.

Excludes: External effects outside the transaction and proof of physical concurrency when an oracle only simulates the locked state.

Falsifier: Read a pending request, let another actor reject it, then approve it using the stale pre-lock state.

Demote or revise when: The family cannot identify a transition relation distinct from versioned value replacement or ownership fencing.

Distinct from `guarantee:worker-fencing`: This guards legal predecessor states, not a worker's right to commit after losing ownership.

Example: [products/approvals/backend/services.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/approvals/backend/services.py#L200).

Oracle inspected: [products/approvals/backend/tests/test_services.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/approvals/backend/tests/test_services.py#L44) — `test_raises_when_state_changed_under_lock`.

Evidence grade: **test-inspected**. Test mocks the locked row's changed state; this does not exercise two real database transactions racing.


## 16. Supersession safety

`guarantee:supersession-safety` · Concurrency and identity

Late work publishes only while its declared precondition still holds; it cannot displace a superseding accepted value or clean up that winner's resources.

Applies when: Asynchronous operations compete to publish state at one subject.

Binding parameters: publication subject; operation identity; supersession relation; acceptance precondition; cleanup ownership.

Excludes: General linearizability and equal-value intermediate-write detection unless explicitly represented by the precondition.

Falsifier: Finish a newer upload first, then an older upload, and observe an obsolete publication or surviving losing resource contrary to the cleanup policy.

Demote or revise when: A second context requires changing the supersession relation's meaning or hides the entire publication policy in an opaque predicate.

Distinct from `guarantee:retry-recognition`: Competing operations must not win late; the same already-applied operation must still recognize its own success.

Example: [posthog/query_cache/size_tracker.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/size_tracker.py#L140).

Oracle inspected: [posthog/query_cache/test/test_storage.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/test/test_storage.py#L243) — `test_stale_upload_cannot_replace_a_newer_entry`.

Evidence grade: **mutation-tested**. Removing the mismatch refusal fails on two remaining fake-storage objects. The later newer-response assertion is not reached in that mutant. Real Redis, controlled uploads, fake S3.

Retained run: [docs/assays/posthog-guarantees-r3/baseline.xml](../../../docs/assays/posthog-guarantees-r3/baseline.xml).
Retained run: [docs/assays/posthog-guarantees-r3/cache-mutated.xml](../../../docs/assays/posthog-guarantees-r3/cache-mutated.xml).
Retained run: [docs/assays/posthog-guarantees-r3/cache-restored.xml](../../../docs/assays/posthog-guarantees-r3/cache-restored.xml).

## 17. Already-applied retry recognition

`guarantee:retry-recognition` · Concurrency and identity

Repeating an operation whose own effect already landed recognizes that success rather than classifying the retry as a conflicting operation.

Applies when: Replies can be lost and the caller retries a distinguishable operation.

Binding parameters: operation identity; already-applied witness; retry horizon; success result; cleanup consequence.

Excludes: Exactly-once execution, detection of every network failure, and retry identities reused by unrelated operations.

Falsifier: Install an operation's pointer, repeat its swap with the old expected bytes, and receive a conflict result that would trigger losing-upload cleanup.

Demote or revise when: The implementation cannot identify its own prior effect independently of a coincidentally equal foreign effect.

Distinct from `guarantee:duplicate-suppression`: Recognizing success may permit redelivery; suppressing every retry can instead lose unfinished downstream work.

Example: [posthog/query_cache/size_tracker.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/size_tracker.py#L140).

Oracle inspected: [posthog/query_cache/test/test_storage.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/query_cache/test/test_storage.py#L243) — `test_stale_upload_cannot_replace_a_newer_entry`.

Evidence grade: **mutation-tested**. Deleting already-applied recognition fails on False versus True at the retry assertion. No actual lost network reply was injected.

Retained run: [docs/assays/posthog-guarantees-r3/cache-restored.xml](../../../docs/assays/posthog-guarantees-r3/cache-restored.xml).
Retained run: [docs/assays/posthog-guarantees-r3/retry-mutated.xml](../../../docs/assays/posthog-guarantees-r3/retry-mutated.xml).
Retained run: [docs/assays/posthog-guarantees-r3/final.xml](../../../docs/assays/posthog-guarantees-r3/final.xml).

## 18. Identity-scoped duplicate suppression

`guarantee:duplicate-suppression` · Concurrency and identity

Within the declared horizon, competing claims for one deduplication identity receive the declared suppression outcome while permitted redelivery remains distinct.

Applies when: A boundary explicitly deduplicates logical events or requests.

Binding parameters: deduplication tuple; claim identity; retention horizon; suppressed effect; store-failure policy.

Excludes: Global exactly-once processing, repeats after expiry and suppression during an explicitly fail-open store outage.

Falsifier: Claim the same identity with two foreign operation IDs within the live window and accept both despite healthy deduplication storage.

Demote or revise when: The effect and identity cannot be named precisely enough to separate duplicates from permitted retries.

Distinct from `guarantee:retry-recognition`: Different claims for one logical event are not the same operation retrying its own effect.

Example: [nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.ts#L136).

Oracle inspected: [nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/common/feature-flag-called-dedup/feature-flag-called-dedup-service.test.ts#L222) — `maps fresh claims to true and foreign claims to false`.

Evidence grade: **test-inspected**. Mocked Redis pipeline cases include own redelivery and fail-open errors. Not a downstream exactly-once result.


## 19. Keyed ordering

`guarantee:keyed-ordering` · Concurrency and identity

The named transport boundary retains the routing key required by the declared ordering domain and lane.

Applies when: Routing promises ordered handling for a specific identity, not global traffic.

Binding parameters: ordering identity; sequence definition; lane policy; transport boundary; routing key.

Excludes: Total global order and downstream order across producer failures, rebalances or storage unless separately bound.

Falsifier: Choose an ordered lane but emit its records without the required key, or derive the key policy from a contradictory header.

Demote or revise when: The proposed binding conflates key preservation with observed end-to-end processing order.

Distinct from `guarantee:fair-admission`: Preserving a stream's order says nothing about service order among competing streams.

Example: [rust/capture/src/pipeline.rs](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/capture/src/pipeline.rs#L7).

Oracle inspected: [rust/capture/src/v1/sinks/kafka/sink_tests.rs](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/rust/capture/src/v1/sinks/kafka/sink_tests.rs#L768) — `ordering_decides_partition_key`.

Evidence grade: **test-inspected**. Routing and sink-key tests inspected; actual multi-producer ordering was not executed.


## 20. Stale worker fencing

`guarantee:worker-fencing` · Concurrency and identity

After ownership changes, work carrying the former ownership generation cannot commit through the fenced boundary.

Applies when: Workers may complete after a lease, assignment or ownership handoff.

Binding parameters: owned partition or resource; ownership generation; handoff point; fenced commit; retained-ownership policy.

Excludes: Side effects outside the offset/store fence and proof that every worker operation checks the generation.

Falsifier: Revoke a partition, finish its old batch after the drain budget, and observe its late offsets committed by the former owner.

Demote or revise when: The binding cannot distinguish loss of authority from ordinary competing values or cannot locate the actual commit fence.

Distinct from `guarantee:supersession-safety`: Fencing invalidates an owner's right to commit even if no newer value has been published.

Example: [nodejs/src/common/kafka/consumer/consumer-v2.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/common/kafka/consumer/consumer-v2.ts#L353).

Oracle inspected: [nodejs/src/common/kafka/consumer/consumer-v2.rebalance.integration.serial.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/common/kafka/consumer/consumer-v2.rebalance.integration.serial.test.ts#L467) — `a batch outliving the drain budget is fenced`.

Evidence grade: **test-inspected**. Partition epoch comparison and rebalance oracle inspected; broker-backed suite not run in this catalog pass.


## 21. Acknowledgment barrier

`guarantee:acknowledgment-barrier` · Delivery and recovery

Successful acknowledgment follows the named completion barrier rather than mere receipt or submission.

Applies when: A producer relies on an acknowledgment to retire responsibility for submitted work.

Binding parameters: work identity; completion barrier; success acknowledgment; barrier failure outcome.

Excludes: Durability, query visibility and downstream exactly-once behavior not promised by that barrier.

Falsifier: Hold settlement unresolved and observe successful acknowledgment or retirement of its in-flight responsibility.

Demote or revise when: The binding uses completed without specifying which event retires which responsibility.

Distinct from `guarantee:commit-ordered-effects`: This delays reporting success; commit ordering delays issuing an external effect.

Example: [nodejs/src/ingestion/api/grpc-server.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.ts#L512).

Oracle inspected: [nodejs/src/ingestion/api/grpc-server.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.test.ts#L470) — `records an accepted sub-batch in the shared in-flight metrics until it settles`.

Evidence grade: **mutation-tested**. Removing await caused named in-flight and independent-settlement failures. These are observed related assertions, not a direct proof of Kafka durability or every early-ack schedule.

Retained run: [docs/assays/posthog-guarantees-r2/ack-restored.json](../../../docs/assays/posthog-guarantees-r2/ack-restored.json).
Retained run: [docs/assays/posthog-guarantees-r2/ack-mutated.json](../../../docs/assays/posthog-guarantees-r2/ack-mutated.json).
Retained run: [docs/assays/posthog-guarantees-r2/ack-final.json](../../../docs/assays/posthog-guarantees-r2/ack-final.json).

## 22. Commit-ordered side effects

`guarantee:commit-ordered-effects` · Delivery and recovery

An irreversible external effect is not issued before the transaction establishing its intent successfully commits.

Applies when: A transaction creates state whose existence authorizes external work.

Binding parameters: transaction; intent; external effect; dispatch boundary.

Excludes: Eventual delivery after commit and effects issued on other code paths.

Falsifier: Roll back creation after registering dispatch and observe the external workflow start anyway.

Demote or revise when: A candidate cannot separate the commit precondition from an unsupported promise that all committed work eventually runs.

Distinct from `guarantee:durable-dispatch-intent`: Waiting until commit avoids premature effects but can still lose the post-commit callback.

Example: [products/tasks/backend/models.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/models.py#L59).

Oracle inspected: [products/tasks/backend/tests/test_workflow_dispatch.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/tests/test_workflow_dispatch.py#L21) — `dispatch`.

Evidence grade: **test-inspected**. Atomic creation and post-commit scheduling inspected. Dispatch tests are broader evidence candidates, not a claimed executed rollback oracle.


## 23. Durable dispatch intent

`guarantee:durable-dispatch-intent` · Delivery and recovery

Committed work retains a discoverable dispatch intent until the declared dispatch acknowledgment retires it, including loss of the immediate callback.

Applies when: A database commit and external dispatch cannot be one atomic operation.

Binding parameters: intent record; commit boundary; discovery mechanism; retirement evidence; retention policy.

Excludes: Unconditional eventual delivery, an operating dispatcher, permanent downstream availability and exactly-once execution.

Falsifier: Commit a run, lose its immediate callback, and find no recoverable dispatch intent for the scanner.

Demote or revise when: The only implementation evidence is a callback with no retained discoverable intent, or a liveness claim cannot name its operating assumptions.

Distinct from `guarantee:commit-ordered-effects`: A safely ordered callback is still lossy if no durable intent survives its loss.

Example: [products/tasks/backend/logic/services/workflow_dispatch.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/logic/services/workflow_dispatch.py#L98).

Oracle inspected: [products/tasks/backend/tests/test_workflow_dispatch.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/tasks/backend/tests/test_workflow_dispatch.py#L295) — `pending_dispatch`.

Evidence grade: **test-inspected**. Stored dispatch options and markers inspected. This measures recoverability of intent, not delivery under arbitrary outages.


## 24. Resumption without omissions

`guarantee:resumption-coverage` · Delivery and recovery

After interruption, planned remaining work covers the required range not already completed under the declared boundary and overlap rules.

Applies when: A batch operation resumes from completed ranges or checkpoints.

Binding parameters: required population or interval; checkpoint semantics; range boundary rules; allowed overlap; source-change policy.

Excludes: Exactly-once downstream effects and records arriving outside the bound source snapshot or interval policy.

Falsifier: Supply overlapping completed ranges and observe a required uncovered interval omitted from the resumed plan.

Demote or revise when: The population is moving but no source-change or snapshot policy can state what must be covered.

Distinct from `guarantee:duplicate-suppression`: Coverage prevents omissions; overlap may be intentional and does not itself promise duplicate-free effects.

Example: [products/batch_exports/backend/temporal/batch_exports.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/temporal/batch_exports.py#L199).

Oracle inspected: [products/batch_exports/backend/tests/temporal/test_batch_exports.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/tests/temporal/test_batch_exports.py#L497) — `test_generate_query_ranges`.

Evidence grade: **test-inspected**. Range-planning tests inspected, not an end-to-end interrupted export against every destination.


## 25. Retry classification

`guarantee:retry-classification` · Delivery and recovery

Failures are classified as retryable or terminal according to the declared error policy, without silently exchanging those outcomes.

Applies when: A worker chooses whether to retry after an external failure.

Binding parameters: error domain; retry policy; terminal outcome; unknown-error policy.

Excludes: Backoff, attempt bounds, successful recovery and universal meanings for particular HTTP status codes.

Falsifier: Return an error declared terminal and observe another retry, or return a declared transient error and observe premature termination.

Demote or revise when: The catalog bakes one destination's status-code mapping into the supposedly reusable definition.

Distinct from `guarantee:retry-recognition`: Eligibility to retry is independent of recognizing an effect that already landed.

Example: [products/batch_exports/backend/temporal/destinations/http_batch_export.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/temporal/destinations/http_batch_export.py#L40).

Oracle inspected: [products/batch_exports/backend/tests/temporal/destinations/test_http_batch_export_workflow.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/products/batch_exports/backend/tests/temporal/destinations/test_http_batch_export_workflow.py#L295) — `429`.

Evidence grade: **test-inspected**. 400 versus 429/500 cases inspected; exact mapping is destination policy, not a universal guarantee.


## 26. Graceful drain

`guarantee:graceful-drain` · Delivery and recovery

Shutdown stops the declared admission path and gives already-accepted work its promised settlement/drain opportunity before closing, with an explicit deadline outcome.

Applies when: A service closes while work is in flight.

Binding parameters: admission stop point; accepted-work population; completion criterion; drain budget; timeout outcome.

Excludes: Unbounded waiting, guaranteed completion of stalled dependencies and work outside the captured drain population.

Falsifier: Initiate stop with a settling accepted batch and observe its stream closed before its acknowledgment within the allowed drain budget.

Demote or revise when: The definition cannot state which work was accepted before shutdown or treats forced timeout as successful completion.

Distinct from `guarantee:acknowledgment-barrier`: A per-work acknowledgment rule does not ensure shutdown keeps its transport alive long enough to deliver it.

Example: [nodejs/src/ingestion/api/grpc-server.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.ts#L432).

Oracle inspected: [nodejs/src/ingestion/api/grpc-server.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.test.ts#L268) — `stop() drains in-flight sub-batch acks before ending streams`.

Evidence grade: **test-inspected**. Original test body inspected; R2 ran the enclosing suite, but no drain-specific mutation is claimed here.


## 27. Cancellation releases capacity

`guarantee:cancellation-release` · Resources and resilience

Canceled waiting work loses its queue claim and any subsequently granted capacity is returned rather than consumed by dead work.

Applies when: Cancelable work waits for a scarce slot.

Binding parameters: waiter identity; cancel signal; queue; capacity ownership; grant/cancel race rule.

Excludes: Stopping already-running server computation and removing already-issued irreversible effects.

Falsifier: Cancel a queued waiter, release one slot, and observe the dead waiter consume it while a live waiter remains blocked.

Demote or revise when: The supposed cancellation property only hides presentation and has no queue or resource claim to release.

Distinct from `guarantee:fair-admission`: A FIFO queue can be fair among live entries yet leak every canceled entry's capacity.

Example: [nodejs/src/ingestion/api/grpc-server.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.ts#L142).

Oracle inspected: [nodejs/src/ingestion/api/grpc-server.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.test.ts#L419) — `drops a cancelled stream from the admission queue`.

Evidence grade: **test-inspected**. Controlled queue cancellation test inspected; no assertion that remote computation is terminated.


## 28. Bounded admission

`guarantee:bounded-admission` · Resources and resilience

The named admission boundary does not admit more simultaneously active work than its configured capacity.

Applies when: A scheduler or service imposes a concurrency ceiling.

Binding parameters: admission boundary; counted active unit; capacity; overflow behavior; release event.

Excludes: Bounds on every buffer, memory allocation, per-tenant fairness and time-window rate limits.

Falsifier: Keep the configured number of streams active and successfully admit an additional stream instead of applying overflow policy.

Demote or revise when: No observable counted active unit exists, or the candidate conflates instantaneous concurrency with cumulative rate.

Distinct from `guarantee:rate-budget`: Concurrency counts active work; a rate budget counts consumption over time even after work finishes.

Example: [nodejs/src/ingestion/api/grpc-server.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.ts#L107).

Oracle inspected: [nodejs/src/ingestion/api/grpc-server.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.test.ts#L549) — `refuses a stream past the total concurrency ceiling`.

Evidence grade: **test-inspected**. Total stream ceiling test inspected; not a bound on every queue or allocation in ingestion.


## 29. Fair admission

`guarantee:fair-admission` · Resources and resilience

When capacity becomes available, eligible contenders receive service according to the declared scheduling order rather than accidental races.

Applies when: Multiple eligible contenders share a scheduling resource with an explicit fairness policy.

Binding parameters: contender identity; eligibility; scheduling order; resource; progress assumptions.

Excludes: Wall-clock latency bounds, equal throughput and progress while no slots become available.

Falsifier: Queue A before B under FIFO policy, free a slot, and grant it to B while A remains eligible.

Demote or revise when: Fairness cannot be expressed as a concrete service-order relation with explicit progress assumptions.

Distinct from `guarantee:bounded-admission`: A capacity-safe scheduler can indefinitely favor the same contender.

Example: [nodejs/src/ingestion/api/grpc-server.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.ts#L142).

Oracle inspected: [nodejs/src/ingestion/api/grpc-server.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/nodejs/src/ingestion/api/grpc-server.test.ts#L379) — `grants feed slots in arrival order across streams`.

Evidence grade: **test-inspected**. FIFO test inspected; this does not establish starvation freedom under arbitrary stalled dependencies.


## 30. Identity-scoped rate budget

`guarantee:rate-budget` · Resources and resilience

Admission accounts for weighted consumption against every declared time window of the correct budget owner.

Applies when: Requests share an external or internal quota over time.

Binding parameters: budget owner; request weight; window limits; clock; storage failure policy; priority reserves.

Excludes: Fleet-wide enforcement during per-process fallback and upstream limits omitted from the configured policy.

Falsifier: Exhaust a short window while a longer one has room and still admit work, or charge one owner's requests against another's budget.

Demote or revise when: A binding cannot identify the real external budget owner, or claims fleet-wide enforcement while its failure policy only enforces per-process limits.

Distinct from `guarantee:bounded-admission`: Completed requests still consume the time-window allowance.

Example: [posthog/egress/limiter/outbound.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/egress/limiter/outbound.py#L3).

Oracle inspected: [posthog/egress/test/test_outbound_rate_limiter.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/egress/test/test_outbound_rate_limiter.py#L49) — `test_budget_denies_once_exhausted`.

Evidence grade: **test-inspected**. Weighted and multiwindow tests inspected, including independent keys. Redis failure deliberately falls back to memory, narrowing enforcement scope.


## 31. Accounted memory budget

`guarantee:memory-budget` · Resources and resilience

The bound evaluator refuses further accounted allocation once its declared memory budget would be exceeded.

Applies when: Untrusted or variable-sized work runs under explicit allocation accounting.

Binding parameters: evaluator; accounted allocation domain; measurement unit; limit; overflow outcome.

Excludes: Operating-system RSS, unaccounted host-library allocations and a claim that all memory is bounded.

Falsifier: Execute an allocation-growing program and observe accounted allocation exceed the budget without the declared refusal.

Demote or revise when: The budget is presented as total process memory while only VM stack values are counted, or no accounted domain can be stated.

Distinct from `guarantee:execution-budget`: A short computation can allocate too much; a small-memory computation can perform too much work.

Example: [common/hogvm/typescript/src/execute.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/common/hogvm/typescript/src/execute.ts#L250).

Oracle inspected: [common/hogvm/typescript/src/__tests__/execute.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/common/hogvm/typescript/src/__tests__/execute.test.ts#L250) — `memory limits 1`.

Evidence grade: **test-inspected**. VM allocation-accounting failure assertions inspected; not a hard bound on JavaScript process RSS.


## 32. Execution step budget

`guarantee:execution-budget` · Resources and resilience

Execution refuses further counted steps once the declared operation budget is exhausted.

Applies when: An interpreter or workflow permits bounded repeated execution or external calls.

Binding parameters: execution identity; counted step; budget; resume accounting; exhaustion outcome.

Excludes: A wall-clock deadline, memory limits and operations the declared counter does not count.

Falsifier: Run a program requesting more than the allowed asynchronous steps and observe another counted call after exhaustion.

Demote or revise when: The counted unit cannot be identified, or the binding calls a step cap a time bound without evidence.

Distinct from `guarantee:memory-budget`: Work can exceed its step budget without growing its memory footprint.

Example: [common/hogvm/typescript/src/execute.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/common/hogvm/typescript/src/execute.ts#L833).

Oracle inspected: [common/hogvm/typescript/src/__tests__/execute.test.ts](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/common/hogvm/typescript/src/__tests__/execute.test.ts#L220) — `async limits`.

Evidence grade: **test-inspected**. Original tests request 200 async steps and require refusal at configured caps of 100 and 55; tests inspected, not executed this round.


## 33. Circuit-breaker policy

`guarantee:circuit-breaker-policy` · Resources and resilience

Observed dependency failures produce the declared open/closed and bypass decision under the configured sample window and threshold policy.

Applies when: A caller uses failure history to divert or suppress calls to a struggling dependency.

Binding parameters: dependency; sample window; minimum sample; failure threshold; bypass policy; disabled and store-failure behavior.

Excludes: Zero traffic to an open circuit when bypass is probabilistic, caller compliance and downstream recovery.

Falsifier: Reach the configured failure threshold with sufficient samples and observe a closed decision, or include expired samples against policy.

Demote or revise when: The definition conflates a breaker decision with transport enforcement or hides probabilistic bypass behind a zero-traffic claim.

Distinct from `guarantee:rate-budget`: Failure observations determine this decision; healthy request volume alone does not.

Example: [services/llm-gateway/src/llm_gateway/circuit_breaker.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/services/llm-gateway/src/llm_gateway/circuit_breaker.py#L117).

Oracle inspected: [services/llm-gateway/tests/test_circuit_breaker.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/services/llm-gateway/tests/test_circuit_breaker.py#L77) — `test_opens_when_failure_rate_crosses_threshold`.

Evidence grade: **test-inspected**. Windowed statistics and threshold assertions inspected. Caller must honor opt-in; bypass is probabilistic and missing Redis is inert.


## 34. Readiness requires current evidence

`guarantee:readiness-evidence` · Evidence and population

A readiness claim requires current positive observations of every declared serving prerequisite, not merely a live process.

Applies when: A deployment or router admits traffic based on a readiness surface.

Binding parameters: readiness boundary; prerequisite registry; observation freshness; failure outcome.

Excludes: Undeclared dependencies, all possible request success and liveness, which may intentionally remain true during dependency failure.

Falsifier: Revoke a required database grant and observe the next readiness probe report ready.

Demote or revise when: The prerequisite population is implicit or the definition cannot distinguish readiness from process liveness.

Distinct from `guarantee:completion-evidence`: Readiness is a renewable precondition for serving future work, not completion of one past operation.

Example: [services/llm-gateway/src/llm_gateway/api/health.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/services/llm-gateway/src/llm_gateway/api/health.py#L18).

Oracle inspected: [services/llm-gateway/tests/test_health.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/services/llm-gateway/tests/test_health.py#L58) — `test_readiness_fails_when_privileges_missing`.

Evidence grade: **test-inspected**. Tests mock the DB and require 503 for missing grants; another assertion checks the full REQUIRED_TABLES population.


## 35. Declared target coverage

`guarantee:declared-target-coverage` · Evidence and population

A fan-out operation accounts for every target in its declared live registry and refuses unsupported reachability instead of silently omitting a target.

Applies when: Work must reach a registry-defined set of stores, clusters or handlers.

Binding parameters: target registry; alias identity; dispatch capability; required target set; unreachable outcome.

Excludes: Proof that the registry contains every physical copy, backup, external destination or future replay source.

Falsifier: Add a declared target outside the dispatcher's reachable clusters and observe it silently skipped while the sweep proceeds as complete.

Demote or revise when: The definition treats complete traversal of a list as evidence that the list itself includes every required real-world target.

Distinct from `guarantee:completion-evidence`: Reaching every declared target does not establish that the requested effect occurred there.

Example: [posthog/models/deletion_targets.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/deletion_targets.py#L135).

Oracle inspected: [posthog/models/test/test_deletion_targets.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/test/test_deletion_targets.py#L9) — `cluster`.

Evidence grade: **test-inspected**. Cluster placement, aliases and dispatch refusal inspected. Registry completeness relative to all real copies remains unproved.


## 36. Completion requires outcome evidence

`guarantee:completion-evidence` · Evidence and population

A work item enters completed only after the declared observer confirms the requested outcome across its bound target population.

Applies when: Submitting or queuing work can precede its actual effect.

Binding parameters: work item; required outcome; observer; target population; predicate; observation time.

Excludes: Permanent no-resurrection, deletion of undeclared copies and exact predicate support where the observer uses a conservative superset.

Falsifier: Leave a matching event in a required target and observe the deletion request promoted from queued to completed.

Demote or revise when: The completion observer only reports that work was submitted, or its observation population cannot be bound separately from the whole project.

Distinct from `guarantee:declared-target-coverage`: Enumerating all destinations is necessary but does not confirm the requested result at any one destination.

Example: [posthog/models/data_deletion_request.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/models/data_deletion_request.py#L950).

Oracle inspected: [posthog/dags/tests/test_data_deletion_requests.py](https://github.com/PostHog/posthog/blob/c54fec2163ad9455fd23a947f86a9034c1df9388/posthog/dags/tests/test_data_deletion_requests.py#L568) — `test_verify_queued_request_keeps_status_when_events_remain`.

Evidence grade: **test-inspected**. Deferred event-deletion verification counts remaining events before promotion. This does not establish backups or no-resurrection.


