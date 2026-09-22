# PostHog Python API authentication: glossary and spec onboarding

**Work order:** `w-151ccf57`  
**Date:** 2026-09-18  
**Upstream:** `PostHog/posthog` `fe5e40a8f006389dcc0eac4fde4faad0333cab16` (`2026-09-18T18:42:19Z`)  
**Final result:** 11 source-supported glossary proposals, 2 bounded witnessed invariants, 2 unenforced requirements, one confirmed-and-repaired onboarding detector defect, no demonstrated current PostHog service bug.

## Scope and population

This second PostHog case examined Python API authentication and authorization around personal API keys, action scopes, project/team and organization restrictions, and adjacent project-secret/service credentials. It did not duplicate the completed Rust capture case or expand into the full login/WebAuthn/OAuth stack.

The exact 18-file copied active corpus is listed with byte counts and Git blobs in `docs/reference/posthog-api-auth-glossary/README.md`. It contains the auth/permission/routing/personal-key dependency path, supporting user-permission and tenant models, three API/auth example test modules, and pinned `posthog/test/test_scopes.py` for the actual runtime methods. `posthog/rate_limit.py` was separately consulted for final #93790 semantics but was not put under the active auth component.

The corpus is not claimed to contain every production monorepo reference or endpoint.

## Glossary outcome

Eleven declarations were created through the actual isolated `glossary propose/apply` flow. No `--human` acknowledgement was used. The final machine-readable candidate is `docs/reference/posthog-api-auth-glossary/glossary.json`, which preserves the applied definitions and explicitly marks each as source-supported, proposed and not human-approved. The earlier proposal summary remains separately available as workflow evidence.

Primary rulings:

- PostHog **action scope** (`object:read|write`) is distinct from Coherence **Scope**.
- Authentication resolves a credential/principal; authorization additionally combines action scope, tenant restrictions, membership/access control, organization policy and route/object consistency.
- Personal, public-project, project-secret, legacy team-secret and service credentials remain separate concepts.
- `*` means full ordinary action-scope access, not authority beyond tenant restrictions or the owner’s effective permissions.
- Project and Team/environment are related by current compatibility/routing structures but are not globally synonymous.
- The examined personal-key model has rolling/revocation observations but no personal-key expiry field; OAuth/JWT expiry and other credential caches must not be projected onto PATs.

`glossary ready` remained false because contexts were not fully reviewed. JSON coverage output stayed outside the audited root due known independent defect `df-79ac2d4e` / follow-up `w-fc810d71`. Generated drafts inside the isolated workspace enlarged the maintenance inventory, so its 5,098-term count is not presented as a clean service baseline.

## Critical negative control: initial detector was inadequate

The original `test_selected_authenticator_scope_mapping_is_total` only checked whether expected class/member strings appeared in the source of `get_authenticator_scopes`.

In the isolated copied `permissions.py`, an unconditional early `return None` was inserted immediately after the function docstring. Every expected mapping branch and substring remained present but unreachable.

The **same named test stayed green**:

```text
1 passed, 3 deselected in 0.01s
```

The same Coherence run also exited zero at `2026-09-18T19:49:19.265Z`. This proved that the initial detector could not support the behavioral totality sentence. It is recorded as onboarding detector/spec defect `df-c40bb904`, bound to `w-151ccf57`.

This is not a current PostHog service bug and not a shared Coherence implementation bug. The earlier branch-removal red/restore/green run remains preserved, but it is no longer treated as sufficient evidence on its own.

## Detector repair and honest boundary

The behavioral sentence was not weakened merely to retain an invariant label. The same named detector was replaced with a finite-matrix execution test that:

- extracts the actual pinned `get_authenticator_scopes` function body;
- compiles and executes that copied body;
- supplies minimal fake interfaces for referenced authenticator classes;
- checks exact outputs for personal API key, OAuth access token, ID-JAG token, project secret API key, and an unknown authenticator.

This proves the copied dispatcher’s behavior for that five-case matrix. It does not prove DRF authentication, ORM loading, real class construction, all callers or future credential types.

A clean baseline passed. Re-inserting an unconditional early `return None` while preserving all mapping strings made the repaired same-named detector fail under `refute`. Restoring the exact pinned file and running again passed, producing an honest witnessed refutation.

## Actual pinned runtime invariant

The configured Python/JUnit runner includes a wrapper that imports copied pinned `posthog/test/test_scopes.py` and executes two real PostHog unittest methods under minimal isolated Django settings:

- `TestDowngradeScopesToReadOnly.test_wildcard_expands_to_all_public_read_scopes`
- `TestScopeSets.test_all_scopes_matches_scope_descriptions_keys`

A deliberate isolated fault made wildcard downgrade return `feature_flag:write`. The configured runtime test failed under `refute`. Exact source was restored and the later run passed. This makes **public scope catalog runtime** a witnessed invariant for the pinned pure scope module—not a claim about full request authorization.

## AST diagnostics no longer presented as behavioral enforcement

Two earlier checks remain useful diagnostics but were removed from the spec’s `via/over` enforcement fields:

- `test_team_and_organization_restrictions_both_precede_scope_grant` checks source strings and lexical ordering only. It does not execute routing, permission exceptions, membership or ORM behavior.
- `test_personal_key_self_access_is_retrieve_only_and_same_key` checks copied class text only. It does not execute DRF permission composition or endpoint behavior.

Their behavioral claims remain requirements and explicitly lack enforcement.

## Trust-crossing correction

The first candidate examples had mechanically inherited scaffold crossings that the traced operations did not perform. `get_authenticator_scopes` reads an already-resolved authenticator, so `caller-input -> authenticated-principal` was removed. The public scope catalog/downgrade is pure policy computation, so `authenticated-principal -> tenant-resource` was also removed.

The entry example now declares only trust levels used by justified requirement boundaries. Two crossings remain:

- tenant restriction uses `authenticated-principal -> tenant-resource` because the requirement is the authorization comparison between credential authority and the routed tenant resource;
- personal-key self retrieval uses `authenticated-principal -> credential-record` because the requirement gates access to an addressed credential metadata record.

This authoring correction is recorded as decision `d-068acb09`. No crossing was retained merely to fill a scaffold slot.

## Final spec result

| Candidate | Final evidence | State |
|---|---|---|
| credential scope extraction totality | copied function body executed over five-case finite matrix; early-return red → restore → green | **invariant** |
| public scope catalog runtime | two actual pinned PostHog test methods; wildcard-write fault red → restore → green | **invariant** |
| tenant restriction before wildcard | AST/source-order diagnostic only, not bound | **requirement**, lacks enforcement |
| personal key self retrieval | AST/source-presence diagnostic only, not bound | **requirement**, lacks enforcement |

Final `spec --check`:

```text
2 components, 4 bullets: 2 invariants, 2 requirements
lacking: enforcement 2, refutation 2
0 problems
latest run 2026-09-18T20:06:29.034Z
```

The entry and child specs are archived separately at `spec-examples/service/Service.spec.md.example` and `spec-examples/service/posthog/Auth_scope.spec.md.example`; they are not active Coherence specs in this repository.

## Component ownership correction

The original child component was placed in empty `service/posthog/auth_scope/`, while `auth.py`, `permissions.py`, `scopes.py`, API modules and tests were siblings under `service/posthog/`. That placement could mislead component ownership and economy readings. The spec was moved to `service/posthog/Auth_scope.spec.md`, making the final component id `service/posthog`.

Pre-relocation refutations remain preserved as historical records and were not migrated. A new component id initially read as four requirements. Fresh evidence then established:

- baseline green at `2026-09-18T20:06:28.074Z`;
- dispatcher early-return fault red;
- actual scope-runtime wildcard-write fault red;
- exact restore green at `2026-09-18T20:06:29.034Z`.

Final state returned to two witnessed invariants and two unenforced requirements under the correct component owner. Decision `d-486b948d` records this authoring correction.

The finite dispatcher matrix intentionally covers four authenticators and excludes the fifth `ExportRendererAuthentication` branch because worker/export propagation is outside this slice. Its name is defined in the isolated execution namespace solely so the extracted function can execute; no ExportRenderer behavior claim is made.

## Exact runner/source evidence

Final hashes:

- runner config: `1a672b911a14573f44d5b60edb417030f45a235cd428b9bf6bf6e04e0e25c49c`
- repaired detector/wrapper: `60f7f87b52dbedafc6bb23793dce782d1ebdac8446d3c251fc4bc9a3263ff65c`
- entry spec: `115d6b9d679ef8988b659fa580f3cf8db0aef5f7f51528d1f6ad79859dd2cdfd`
- auth spec: `b3fae35c379ced6157a1adc4d0e1b6cfa4cffabedbbd23349fdb8d72c46890bd`
- pinned actual scope tests: blob `0e28a8b0a9dc4deb44a9512c1942e9814cefa11f`

The copied Coherence snapshot was based on HEAD `d16e0affd3dbabe4362c9a4fc3691e6850a11806`, package `0.0.0`, tracked-diff SHA-256 `e76714721ac45042b3fab23720219985ed4aef35732f3dade7de2e0f0af0d1dc`. Per-file blobs and exact command forms are in `tool-evidence.md`.

## Runtime versus environment failures

Successful runtime evidence:

- four-test direct isolated suite passed after detector repair;
- finite-matrix dispatcher execution passed at baseline and after restoration;
- two actual pinned PostHog scope unittest methods passed;
- both deliberate faults went red under the real `refute` path and later green under `run`.

Environment walls, not service failures:

- system Python lacked pytest;
- full sparse PostHog pytest collection failed first on absent `posthog.test.base`, then absent `posthog.settings`, then absent `time_machine` after those paths were added;
- no database-backed API test, Redis cache, worker request or dynamic access-control lookup ran.

No runner failure was reported as a failed service invariant.

## Historical adjudication

Confirmed historical fixes, not current bugs:

- #93790 / merge `89759e51…`, final PR commit `c0f60265…`: current throttling is authenticator-first. The validated key hash selects the bucket; candidate scraping is fallback only.
- #83205 / `989e88e0…`: fixed selected cross-project/organization scoped-token paths.
- #84070 / `d79eb6e9…`: fixed scoped JWT team enforcement on nested routes.
- #86637 / `4abe0282…`: preserved source credential restrictions across worker requests.

#101845 is context only: it fixed recursive OAuth authentication caused by reading lazy `successful_authenticator` state before authentication had resolved, reinforcing the distinction between a candidate credential and the authenticated credential.

## Durable and independent replay evidence

`docs/reference/posthog-api-auth-glossary/raw-evidence/` now contains the complete isolated run JSONL records, raw initial falsely-green pytest/Coherence output, exact initial detector code, portable fault patches, pre-relocation records, and fresh relocated-component baseline/refutation/restoration outputs. `REPLAY.md` documents the absolute interpreter paths in the archived config/test wrapper and how to relocate them safely.

The coordinator independently replayed the repaired detector from pinned `git show` source in `/var/folders/v5/3k38g_ls55g6zhq2lxdqt7k80000gn/T/coordinator-posthog-auth-verify-xayt9xup`: baseline 4 passed, the unconditional early return made the named dispatcher detector fail with actual `None` versus the expected scope list, and exact-byte restoration returned to 4 passed. No shared/adopter source was mutated. This is recorded as a coordinator attestation, not invented raw output.

## Findings

- **Current PostHog service bugs demonstrated:** none.
- **Confirmed onboarding spec/detector defect:** `df-c40bb904`; repaired in isolation, original negative evidence preserved.
- **Additional shared Coherence bugs demonstrated by this case:** none.
- **Known independent shared Coherence bug:** `df-79ac2d4e`.
- **Unmet behavioral requirements:** tenant restriction before wildcard and personal-key self retrieval still lack adequate behavioral detectors.

## Artifacts

- `docs/reference/posthog-api-auth-glossary/README.md`
- `docs/reference/posthog-api-auth-glossary/glossary.md`
- `docs/reference/posthog-api-auth-glossary/glossary.json`
- `docs/reference/posthog-api-auth-glossary/glossary-proposals.json`
- `docs/reference/posthog-api-auth-glossary/evidence-ledger.md`
- `docs/reference/posthog-api-auth-glossary/tool-evidence.md`
- `docs/reference/posthog-api-auth-glossary/spec-examples/service/Service.spec.md.example`
- `docs/reference/posthog-api-auth-glossary/spec-examples/service/posthog/Auth_scope.spec.md.example`
- `docs/reference/posthog-api-auth-glossary/onboarding-tests.py.example`
- `docs/reference/posthog-api-auth-glossary/coherence.config.json.example`
- `docs/reference/posthog-api-auth-glossary/REPLAY.md`
- `docs/reference/posthog-api-auth-glossary/raw-evidence/`

Append-only work records:

- initial experiment `x-28147ca2`, close `xc-ad48424f`
- detector defect `df-c40bb904`
- follow-up experiment `x-429ed176`, close `xc-fd79a099`
- crossing-authoring correction `d-068acb09`
- coordinator independent-replay adjudication `d-76ffdc95`
- component-ownership correction `d-486b948d`
- `.coherence/journal/01a0b5ee-b693-78f1-85bf-77500e493604.jsonl`

## Limitations

- No full-service assurance follows from isolated function execution or minimal-settings scope tests.
- The 18-file active corpus does not prove every production reference uses the shared helpers.
- Dynamic tenant membership, custom permission chains, cache behavior after roll/delete, databases and worker propagation remain unexecuted.
- No production request, real credential, external telemetry/comment/issue, commit or push was made.
- No human glossary approval was invented.
