# TypeSafe experiments against Mnemion specs

Date: September 18, 2026. Coherence session: `01a0b5e4-e0bb-7160-8bc1-356df5308788`.
Work order: `w-6ed1e0ac`. Initial experiment: `x-4fa4df23`.
Adaptive experiment: `x-28e64a3d`.

## Outcome

**Useful for suggesting some discrepancies; not reliable enough to determine whether a requirement is satisfied.**

The initial local-behavior question detected three of five deliberately introduced behavioral contradictions. It missed two token-scope changes, including one assigned `supported` probability **0.91**, with a returned confidence statistic of **0.86**. An executed check demonstrated the contradiction. Confidence alone would not have prevented that false acceptance.

All three missing-implementation cases received `insufficient`. The model also identified a real mismatch between a claimed totality oracle and its actual source population. But it sometimes confused a failing implementation with inadequate assertions, and it rejected an illustrative detector repair that demonstrably detected the changed population.

Four adaptive requests did not resolve the reliability problem: one missed contradiction was recognized, the other was still missed, and the unchanged comparison was newly called contradictory. The focused detector question did recognize the repair.

This is a small, deliberately selected experiment, not an accuracy estimate for arbitrary repositories or a complete security review.

## Source and method

- Target: the existing local checkout of `daniloc/mnemion`, whose origin is `https://github.com/daniloc/mnemion`.
- Source commit: `02efce9da182ba7d543e47d8694f39ef9794ed46`. This is the local snapshot, not a claim about the newest upstream commit.
- Tested areas: instance-host selection, SQL identifier validation/quoting, and token-scope classification plus its declared totality oracle.
- Mnemion's token scope is its domain term for a resource permission, not Coherence's Scope reading.
- Model: pinned `jev-1.13.0`; the returned model identity matched on every request.
- The experiment expectation and success criteria were recorded before API calls. Expected answers and scenario labels were kept outside the submitted states.
- Fourteen distinct initial cases, plus two exact-request repeats: **16 initial requests**. Four separately recorded adaptive requests: **20 requests total**. No HTTP retries were required.
- Each initial request asked independent Choice questions about a bounded local behavior, the literal broader spec statement, and a specific detector claim. Each allowed insufficient evidence. No execution results were given to the model.
- Inputs contained only selected source/spec/test text. No target configuration, credentials, journal, or live data were sent. The supplied API credential appeared only in request authentication, not generated files.
- Source was copied with `git archive` into a temporary directory. Changes and experimental tests stayed in that copy. Existing dependencies were reused without a Cloudflare service or application deployment.

### Executed checks

The unchanged selected tests passed **13/13**: three original host tests, six original token-scope tests, and four original SQL grammar tests. The SQL suite was extracted unchanged in its assertions, with Cloudflare imports and the separate integration suite omitted. The two other test files were used whole. All ran with Vitest's Node environment rather than the repository's Cloudflare configuration.

Five additional focused checks passed on the unchanged source. These independently exercised configured-host precedence, the observed-host fallback, SQL rejection/quoting, and parent-scope classification against the resource kind actually present in `io.ts`. They were also executed against the changed copies. Their results were withheld from the model.

These are selected pure checks, not the full Mnemion suite and not evidence about a deployed system.

## Initial results

`Local expected` is the outcome fixed before the API calls. `Detector expected` evaluates the stated detector claim, not whether the current implementation passes it. Confidence is the API's distribution statistic, not measured probability of correctness.

| Case | Source variation | Local expected | Local answer | Confidence | Detector expected | Detector answer |
| --- | --- | --- | --- | --- | --- | --- |
| c01 | Host unchanged | supported | supported | 0.92 | direct | direct |
| c02 | Observed host takes precedence over configured host | contradicted | contradicted | 0.96 | direct | direct |
| c03 | Host equivalent implementation | supported | supported | 0.95 | direct | direct |
| c04 | Host implementation omitted | insufficient | insufficient | 0.99 | direct | direct |
| c05 | SQL unchanged | supported | supported | 0.94 | direct | direct |
| c06 | SQL validation removed | contradicted | contradicted | 0.98 | direct | missing |
| c07 | SQL quoting removed | contradicted | contradicted | 0.89 | direct | direct |
| c08 | SQL implementation omitted | insufficient | insufficient | 0.99 | direct | direct |
| c09 | SQL rejection assertions omitted | supported | supported | 0.93 | missing | missing |
| c10 | Token scopes unchanged | supported | supported | 0.89 | missing | missing |
| c11 | Entry leaf depth changed from four to three | contradicted | supported | 0.49 | missing | missing |
| c12 | Token-scope implementation omitted | insufficient | insufficient | 0.98 | missing | missing |
| c13 | Served scope kind changed; its two-part address retained | contradicted | supported | 0.86 | missing | missing |
| c14 | Resource-kind detector derives its population from `io.ts` | supported | supported | 0.87 | direct | missing |

Local judgments matched 12/14 distinct cases, but the important failure count is **two missed contradictions among five introduced behavioral changes**. Detector judgments also matched 12/14 distinct cases. These totals are not independent samples or a general performance estimate.

The two repeats preserved their local and detector classifications. The host's broader literal-spec classification changed from `contradicted` to `insufficient` on an identical request. Thus the broader assessment was not stable even in this small repeat check.

### Real finding: the resource-kind population is separately maintained

Relevant original files:

- `entities/Hive/Hive.spec.md:77–83`
- `entities/Hive/policy.ts:417–458`
- `src/__tests__/scope-grammar.test.ts:174–185`
- `shared/Routing/routes/io.ts:41`

The spec says the test reconciles the token partition against the resource kinds `io.ts` uses, so a new kind cannot leave it incomplete. The test instead iterates a hard-coded `SERVED_KINDS` list and checks another manually maintained table. It does not read `io.ts`.

Executed experiment, in the copy only:

1. Change the served required scope from `read:entry:<pattern>:<id>` to `read:collection:<pattern>:<id>`, retaining its two-part address.
2. Leave the classifier and its test tables unchanged.
3. All **13 selected existing tests remain green**.
4. The focused check demonstrates that `read:collection:axioms` grants both `read:collection:axioms:7` and `read:collection:axioms:8`, but `isBroadTokenScope` returns false: the new kind defaults to a three-part leaf depth.
5. An illustrative test-only repair derives kinds from the actual `io.ts` source. With original source it passes; with the changed kind it fails the existing population assertion by name.

This witnesses a gap in the detector's claimed connection to its population. It does **not** establish a currently deployed exploit or suggest that the illustrative regex is a production-complete detector. The model identified the original population gap, but incorrectly supported the changed implementation's behavior in c13.

### Real finding: the host requirement sentence omits its exception

`Hive.spec.md:98` says every capability URL uses the configured host, never the inbound host. Its `because` text, `shared/core/host.ts:26–32`, and `host-resolution.test.ts` explicitly permit the observed host when configuration is absent or a placeholder.

`resolveHost(undefined, "attacker.example")` returns `"attacker.example"`; the focused check executes this behavior. With meaningful configuration, the configured host wins, as intended and tested. This is an inconsistency in the requirement wording and its stated scope, not a finding that meaningful configured hosts are ignored.

The first literal-spec answer identified the contradiction, but only narrowly: probability 0.54 versus 0.44 for insufficient evidence. The exact repeat selected insufficient evidence instead, 0.52 versus 0.46.

### Distinguishing behavior from detector quality was not dependable

In c06, removing SQL validation makes the existing rejection tests fail, exactly as they should. The model nevertheless changed the detector answer to `missing`. In c14, a detector that actually reads `io.ts` was still classified as missing the population connection. Executed tests showed that it detected the changed resource kind.

The same initial request could also receive conflicting behavioral assessments: c11's bounded local question said supported, while the broader spec question said contradicted. Independent questions are not a jointly consistent assessment.

## Adaptive follow-up — separate from the initial evaluation

After observing the initial misses, four further requests used much smaller source states. Functions were transpiled with esbuild, removing comments and types; concrete parent/leaf inputs were supplied. The last request focused only on the repaired detector. Expected outputs were still withheld. These changes were adaptive and combined several interventions, so they do not isolate the causal effect of context length, comments, or question wording.

| Case | Expected behavior | Result |
| --- | --- | --- |
| c17 | Unchanged parent entry scope is broad; no counterexample | Local answer incorrectly changed to contradicted. A concrete return-value question selected true, while a separate Noul assigned 0.81 to the contradictory counterexample condition. |
| c18 | Three-part entry-depth change is contradictory | Local answer changed to contradicted; concrete return value correctly selected false. |
| c19 | New two-address-part kind is incorrectly treated as narrow | Local answer still selected supported; concrete return value incorrectly selected true. A separate counterexample Noul was 0.72, inconsistent with those answers. |
| c20 | Repaired population detector fails for absent collection examples | Correctly selected fails, probability 0.99; source-population-reading Noul was 0.96. |

The diagnostic did not reliably repair behavior judgments. It did show that a sufficiently focused detector question could recognize a demonstrated repair.

## Usage and operational observations

Across 20 requests:

- Input tokens reported by the API: **64,866**.
- Output tokens reported: **2,556**.
- Median measured HTTP round-trip: **0.354 seconds**.
- Range: **0.264–0.590 seconds**; sum **7.322 seconds**.
- Published price checked September 18, 2026: **$0.042 per million input tokens**, outputs free. Estimated token charge: **$0.002724372**, less than one cent. This is a calculation from published pricing, not a verified account charge.

The measured time excludes source preparation, local testing, analysis, and normal future application overhead. It is not a latency commitment.

Documentation consulted: TypeSafe's API reference, Choice documentation, model listing/pricing, and the skill supplied by the user. Current-source addresses are recorded in the evidence metadata; provider pricing or behavior can change.

## Recommendation for Coherence

Do not attach invariant state, a passing enforcement verdict, or permission to skip review to these model answers. Do not resolve disagreements by averaging scores. The high-confidence false acceptance in c13 is sufficient to reject confidence-only acceptance for this use.

A narrower possible role is to prioritize spec/source discrepancies for an agent to investigate. Keep source selection and the question visible, ask for concrete counterexamples, execute the proposed checks, and retain the resulting evidence separately from the original model judgment. Conflicting answers should remain unresolved.

A next experiment could give the model already-executed behavioral facts and ask only whether those facts contradict the requirement's language. That would avoid asking this model to execute TypeScript mentally. This experiment did not test that approach, so no improvement is claimed.

## Preservation, limitations, and reproduction

- Mnemion's tracked/untracked status and existing diff were compared before and after and were byte-identical. Its pre-existing config edit was neither used nor changed. No Mnemion source, spec, or Coherence enforcement was updated.
- New repository artifacts are this report, its evidence archive, and the attributed Coherence journal/work records.
- No API credential is included in the artifacts. The temporary credential can now be revoked.
- Labels, questions, and cases were prepared by the same reviewing agent; no independent human-labeled set was used. Some local statements were deliberately narrower than the full spec. The wider literal-spec question is reported separately and is not given a single aggregate correctness score.
- Cases were selected after reading the source. Both natural discrepancies were noticed locally before the API calls. The model did not autonomously discover them in the whole repository.
- Stale comments were retained in initial changed-source cases, as they could be after a real code edit. The adaptive cases changed context and questions together.
- Source excerpts were assembled explicitly, not through Coherence's economy prediction. No claims about automated evidence collection follow from these results.
- No complete Cloudflare integration tests or live service behavior were exercised. The population-repair code was an isolated illustration, not a shipped fix or a new project refutation record.

The accompanying `2026-09-18-typesafe-mnemion-evidence.zip` contains all 20 submitted request bodies and responses, expected outcomes kept separate from requests, selected source snapshots, commands/results for local checks, source hashes, usage/timing summaries, and a credential-free request replay helper. Exact-request repeats already showed that future answers need not be identical.
