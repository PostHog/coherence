# Taxonomy on Coherence — Codex's field report

2026-09-04. Working checkout: `coherence-scope-integration`, branch
`scope-posthog-integration`. Caller-assessed responsibilities, not verification.

## Follow-up: repairs and taxonomy v2

The two implementation defects below are now repaired. The same status probe preserves
both reports in 20/20 overlapping trials with zero unreadable records or lost sections.
The calibration probe now refuses the invalid second row rather than reporting a
false denominator; all 31 existing repository samples still load. New regression
contracts exercise all five status writers as independent processes, failed publication,
abandoned-lock refusal, damaged calibration rows, and invalid direct statistics inputs.

Taxonomy v2 requires operational evidence for parser, validator, transformer and
optimizer roles. Required questions are derived from candidate requirements, including
candidates entered through authority or execution rather than representation. There are
five new questions, no new roles, and four new suggestions: core determinism, parser
population behavior, projection fidelity, and registry identity/reference integrity.
All suggestions remain unverified.

`unassessed`, `needs-evidence` and `no-fit` are distinct. Saved assessments appear beside
fresh CLI proposals; Scope shows focused questions and the assessed catalog version.
The exact v1 catalog remains available for historical rows. Catalog changes expire
currency without rewriting prior answers or manufacturing operational evidence.
Component-directory subjects and JSX graph coverage remain deferred.

All 22 field subjects were explicitly reassessed under v2, retaining the 24 historical
v1 rows unchanged. The current population is 15 single-role, four composite, one
ambiguous (`src/hooks.ts`), and two exhausted no-fit subjects (`src/types.ts` and
`test/taxonomy.test.ts`). Twelve selected roles activate 53 subject/obligation pairs
from 15 distinct suggestions. Only the test-oracle subject has no suggested obligation;
the boundary facet still supplies a question for the declaration-only subject.
These are current caller assessments, not complete interviews or verification receipts.

Validation: 959 core tests passed; the final focused taxonomy suite and typecheck passed,
and full verification reports 95/95 claims green. Chromium and WebKit taxonomy browser
checks, all 12 preview unit tests, and the isolated packaged-artifact smoke test passed.
The compiler gate caught and prompted correction of an added test fixture's union
inference before the final green verification run.

The observations and counts in the original field report below describe the pre-repair
v1 run. The diagnostic scripts report the current implementation and are intentionally
not frozen to those historical failures.

## Original outcome (before the follow-up)

The taxonomy is already useful as a way to ask better questions about Coherence.
It led to two reproducible implementation defects, not merely more labels:
overlapping status writes can destroy reports, and calibration accepts invalid
outcomes into its statistical denominator. Neither is repaired in this exercise.

It is not yet a sufficiently discriminating classification interview or a complete
obligation catalog. The most useful result is the combination of supported roles,
explicit unresolved fits, and concrete counterexamples—not the classification count.

The field set contains 22 current subjects across 21 files, expanded from two seed
assessments. There are 16 file subjects and six symbol subjects: 15 single-role,
four composite, two ambiguous, and one exhausted no-fit currently rendered as
`out-of-evidence`. Twelve distinct core roles activate 35 subject/obligation pairs,
using eleven distinct suggestions. Every suggestion remains **unverified**.

The live graph contains 74 source files, 81 test files, and four components.
This is a purposive cross-section, not a coverage percentage or a census of the
project. File and symbol assessments overlap; adding their counts is not coverage.

## Two defects discovered through the obligations

### Status authority: successful overlapping writes can destroy evidence

Subject: [src/status.ts](src/status.ts). Registry authority with state, persistence,
boundary, and concurrency facets. Recorded defect: `def-f0d187dd999a`.

`recordAtlas` and `recordMass` independently read the entire status object, change
their own section, then overwrite the same file. The ordinary sequential control
preserved both sections. In twenty temporary-fixture overlapping trials, both
writers returned successfully in every trial, but eighteen final files were
unreadable and two were readable with a report missing. None preserved both.

These frequencies describe one local scheduling run, not production incidence.
The important counterexample is successful calls without surviving reports.
The reproducer uses the real public writers and reader, not a mock filesystem.

Repair needs both serialized/predecessor-safe updates and atomic publication.
Atomic replacement alone prevents torn JSON but does not prevent lost updates.
This is more specific than “add a persistence guarantee,” and directly relevant
to any future evidence/receipt workflow.

### Calibration observations: invalid labels alter the denominator

Subject: [src/calibration.ts](src/calibration.ts). Telemetry/observability adapter
with observability and persistence facets. Recorded defect: `def-e1bb10e627e2`.

The fixture contains one valid `defect` sample, one otherwise shaped sample with
`outcome: "not-an-outcome"`, and one torn JSON line. `readCalibrationSamples`
returns the first two and silently drops the third. `calibrationStats` counts two
labeled samples and reports `defectRateWithoutMisses: 0.5`, although only one sample
has a valid outcome label.

The sample reader checks only a subset of the row shape; the statistics code treats
anything other than `unknown` as labeled. A repair should validate outcomes and the
fields used by the statistics, and expose surviving damage instead of quietly
improving the apparent population. This is a measured denominator defect, not a
general claim that all existing calibration results are wrong.

Run both probes without touching live project evidence:

```sh
node scripts/taxonomy-risk-probes.mjs
```

The script creates and removes only its own temporary fixtures. It reports current
behavior rather than asserting that these defects must survive future repairs.

## Where classification helped

| Subject | Recorded responsibility | What the distinction buys |
| --- | --- | --- |
| `src/derive.ts` | Transformer + extension host | Project-module execution is visible beside graph derivation. |
| `src/verify.ts` | Validator + runtime executor | Judging claims and supervising their executable evidence are separate obligations. |
| `src/run-named-test.ts` | Runtime executor + resource driver | Process success must not substitute for evidence that a named test ran. |
| `src/adapters/tree-sitter.ts#makeTreeSitterAdapter` | Factory/assembler | Construction and partial initialization are distinct from the returned adapter's parsing behavior. |
| `src/regulate.ts#selectRegulation` | Pure decision function | A selected action is not an executed action; pinned doctrine is an effective input. |
| `src/decisions.ts` | Registry authority | Durable journal authority is not merely operational telemetry. |
| `src/decisions.ts#readTrustedJournal` | Validator | A symbol can have a narrower responsibility than its containing ledger module. |
| `src/status.ts` | Registry authority | A mutable last-report record and an append-only ledger share a role but need different persistence contracts. |
| `src/read-trace.ts` | Telemetry adapter | Observed reads are bounded evidence, not a complete account of agent cognition. |
| `src/render-index.ts` | Transformer + UI controller | Pure artifact production still owns presentation behavior and an HTML trust boundary. |

The UI-controller fit is deliberately broad. A static renderer is not the same
thing as a live controller. Likewise, immutable catalog and doctrine tables can own
canonical vocabulary/policy without having mutable runtime state. Those qualifications
are retained in the records rather than erased by the labels.

## Gaps in the taxonomy and workflow

### 1. One signal proposes four materially different representation roles

With `signal:representation=yes`, both `src/walk.ts#parseSpec` and `src/types.ts`
produce parser, validator, lowerer, and optimizer candidates, followed by the same
six questions. Yet `parseSpec` parses Markdown, while `types.ts` declares interfaces
and performs none of those runtime operations.

The question includes “represent,” but its candidate roles describe active
operations. The remaining questions follow catalog order rather than distinguishing
the candidates. Answers of `no` are retained but do not exclude a candidate with
some other positive support. That conservative behavior preserves possible composites;
it does not settle which responsibility is actually present.

Next step: operational discriminators—recognize syntax, reject invalid input,
translate an established form, preserve semantics while improving a form, or declare
data/contracts without executing an operation. Keep selections caller-assessed.
Do not introduce a confidence score to conceal the missing questions.

### 2. Positive classification can produce no obligations

Eleven of sixteen core roles have no role-triggered suggestion. Many still acquire
useful obligations from facets; that is not inherently wrong. The concrete hole is
five positively classified subjects with zero suggestions:

- `src/walk.ts#parseSpec`
- `src/scope-model.ts`
- `src/context.ts#contextFor`
- `src/doctrine.ts`
- `src/taxonomy-catalog.ts`

All five have the deterministic facet. Its only catalog obligation is
`G-SIM-DETERMINISM`, disabled outside the simulation pack and worded in terms of
state, parameters, timestep and randomness. Core determinism therefore activates
nothing. Scope correctly says that no suggestions does not establish coverage.

Next step: a core determinism obligation and measured parser, projection and
declarative-authority obligations. The existing contracts supply concrete instances:
population parity, preservation of meaning, explicit approximation limits, and
catalog reference integrity. Do not automatically fill every empty role slot with
generic text merely to make the table look complete.

### 3. Known no-fit and unexamined subjects share a status

`test/taxonomy.test.ts` was read and all twelve core role signals assessed `no`.
Its primary responsibility is an executable oracle/independent parity witness, not
a production executor. It has zero unanswered questions and no candidate.

A fresh `inspect src/cli.ts` has twelve unanswered questions and no candidate.
Both say `out-of-evidence`. The retained records distinguish the evidence; the
headline does not. `src/types.ts` remains ambiguous because its positive representation
signal produces inappropriate active-role candidates. `src/hooks.ts` remains ambiguous
because participation in host lifecycle events is not ownership of the host's session
continuity, teardown or reconnect.

Next step: distinguish not-yet-assessed from examined/no-catalog-fit, and expose
unanswered evidence separately from the selected-role state. The fixtures are
evidence to consider test-oracle and declarative-contract responsibilities, not yet
a reason to add a large new ontology.

### 4. Scope's visible components are not taxonomy subjects

`inspect src`, `inspect c:src`, and `inspect scripts/scope-preview/app.jsx` all
refuse. The first two identify the component Scope draws; the third is the actual
UI implementation. Taxonomy currently admits only graph files and symbols, and the
current configured graph excludes the JSX preview package.

This is an honestly stated boundary, not evidence that those components have no
responsibility. Do not classify a nearby TypeScript file as a proxy or silently
broaden the canonical graph to get a pleasing demonstration.

Next step: decide how a component assessment names its member population and expires
when membership changes. Then deliberately extend source-language/file coverage for
the preview if desired. A directory label alone is not an adequate evidence snapshot.

### 5. Inspection does not resume the saved assessment

`taxonomy inspect src/cli.ts` shows a new, unrecorded `out-of-evidence` proposal,
even while `taxonomy list` holds a current CLI-orchestrator assessment. Looking up
its ID and using `show` retrieves that assessment. This is consistent with the current
fresh-proposal implementation, but a poor default for revisiting an adopted project.

Next step: show current recorded state beside the new proposal, and make starting
fresh explicit. Keep the predecessor check for writes; never silently merge revised
answers or renew old evidence.

### 6. Freshness is safe but coarse; evidence is not yet per-answer

The recorded CLI assessment watches 63 paths, 53 present and ten absent manifests,
because its direct import fan-out is large. Symbol assessments still hash their
whole source file and its direct imports, including type-only dependencies. Unrelated
edits can expire a sound semantic assessment. This is the declared grade, not a claim
that the implementation has region-sensitive leases.

Evidence addresses and rationale belong to the whole assessment, not each answer
or facet. Facets support positive selection, but not explicit `no` versus `unknown`
records. A catalog `projection` lists possible semantic evidence sources; this port
does not acquire those LSP observations. Rationale must not be mistaken for machine
proof that those observations occurred.

Before refining digests or evidence structure, measure actual reassessment churn.
The current conservative invalidation is preferable to silently fresh claims with
untracked premises.

## What changed, and how to inspect it

Twenty new subjects and two subsequent evidence-enriched revisions were written
through `taxonomy record`; the two original seed subjects remain. The status revision
adds the concurrency facet and the reproduced defect; calibration names its denominator
defect. No catalog, classifier, verification, receipt, status or calibration implementation
was changed. No classifications were automatically assigned from filenames.

Open [the refreshed Scope preview](public/_scope-library.html), select Taxonomy,
and filter to `ambiguous` or `out-of-evidence` to see the unresolved fits. Search
`src/status.ts` or `src/calibration.ts` for the defect-bearing assessments.

Read-only, repeatable measurements and exact preview population checks:

```sh
node scripts/taxonomy-field-check.mjs
node scripts/taxonomy-field-check.mjs --check-preview
node src/cli.ts taxonomy list --json
```

`taxonomy list --check` now intentionally exits 1 because three assessments remain
unresolved. That exit is not a failed verification run and must not be “fixed” by
selecting unsupported roles. The field diagnostic reports current gaps without pinning
them as expected permanent behavior. Preview checking compares full current taxonomy
items with the saved readings and then with the HTML's embedded taxonomy.

Focused taxonomy tests, Scope tests, browser checks and byte-current artifact checks
are the regression checks for this data/diagnostic pass. They do not establish that
the newly discovered status/calibration defects are absent—the probes show they exist.

My next order of work: repair the two measured evidence defects; improve responsibility
discriminators and no-fit handling; add the measured missing obligations; then settle
component-scope adoption and saved-assessment inspection. Verification and receipts
remain a separate increment.
