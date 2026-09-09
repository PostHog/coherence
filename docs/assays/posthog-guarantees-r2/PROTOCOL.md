# PostHog executable probes R2

Frozen before execution, 2026-09-09. Source commit c54fec2163ad9455fd23a947f86a9034c1df9388.
Owner: main, session 01a06cfd-b3bc-7771-b2fb-a270ead577b7.

Purpose: challenge three existing guarantee oracles and expand requirement discovery. No catalog admission or production edits.

## Frozen subjects and mutations

1. Tenant isolation: posthog/models/scoping/test_manager.py, specifically test_team_scope_filters_to_team and test_no_scope_raises_team_scope_error. First mutation: remove the effective team filter by returning the unfiltered queryset in _apply_team_filter. Expected named failure: the second team's row becomes visible. A separate optional mutation returns an unfiltered queryset instead of raising on absent context.
2. Acknowledgment barrier: nodejs/src/ingestion/api/grpc-server.test.ts. Remove await completed.settled in settleAndAck, retaining valid syntax. Expected failure: existing settlement/in-flight assertions detect premature successful completion. Record whether they actually test absence of an early acknowledgment, versus a related bookkeeping property.
3. Supersession safety: posthog/query_cache/test/test_storage.py::TestQueryCacheS3 (resolve exact owning class before execution), test_stale_upload_cannot_replace_a_newer_entry. Remove the expected-value mismatch refusal from REPLACE_IF_UNCHANGED_SCRIPT. Expected named failure: older upload overwrites newer entry. Separately, if feasible, remove the already-applied success branch to challenge retry-safe publication.

## Verdict rules

- Run unchanged original focused baseline first; no mutation may be called killed unless the intended oracle ran and failed behaviorally after a passing baseline.
- Syntax/import/discovery/setup failures are infrastructure failures, not successful negative controls.
- Restore each mutation and rerun the same oracle; retain outputs and exact mutation patch.
- Original repository test results remain separate from narrower source-executing probes or modified test harnesses. A fallback cannot retroactively satisfy the original-oracle gate.
- Test a bounded subset, not the whole PostHog suite. No production endpoints, real credentials, shared database resets, commits or pushes.
- Isolated checkout /tmp/coherence-posthog-probes.jYxKId/posthog; parent checkout read only. Reuse installed dependencies read-only where feasible. Any databases used must be newly isolated for this assay.
- Discovery remains author-selected and source-based. Hold additional subjects ungraded until a candidate binding is frozen; this round does not establish external portability or human usefulness.

## Expansion paths

Inspect exports/resumption, authorization across background execution, identity/merge effects, deletion target coverage, and frontend stale responses. Record required property, source seam, falsifier, evidence located, and what remains unassessed. Missing evidence in this bounded search is not proof of a missing test.
