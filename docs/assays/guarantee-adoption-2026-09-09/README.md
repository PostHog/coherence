# Guarantee adoption extraction — Codex's findings

2026-09-09. Historical extraction and retrospective single-author review, not a portability assay.

## Outcome

The 112 exploratory reliance declarations are archived and removed. All nine affected specs
now byte-match implementation baseline `197996912f0eef645f47d938bc6d7a9575dd191f`.
The original three relies, three taxonomy addresses and all 83 boundary claims remain.
No guarantee family was promoted; no new product feature was implemented.

The next increment is **not ready**: independent curation/review and a frozen
guarantee-specific positive/negative matrix are missing. Existing lab dossiers are a
known stress set, not a substitute for those conditions.

## Measured adoption distribution

The historical population is 12 canonical components, 83 boundary claims and 56 directed
component pairs. There were 115 relies (112 additions plus three baseline declarations),
with at least one link on 30 pairs. Three existing addresses were untouched.

| Component | Claims | Consumer links | Provider links |
| --- | ---: | ---: | ---: |
| . | 0 | 0 | 0 |
| src | 1 | 71 | 0 |
| src/adapters | 3 | 0 | 5 |
| src/coordination | 16 | 7 | 16 |
| src/derivation | 4 | 4 | 10 |
| src/diagnostics | 11 | 5 | 15 |
| src/evidence | 11 | 1 | 19 |
| src/lifecycle | 11 | 5 | 12 |
| src/readings | 6 | 5 | 10 |
| src/taxonomy | 8 | 3 | 13 |
| src/verification | 12 | 14 | 15 |
| test | 0 | 0 | 0 |

The CLI component authored 71/115 links (61.7%). Its task was to attach consumed contracts
to dispatched commands. This is a concentration of the authoring task, not evidence that
61.7% of a project's guarantee value lives in the CLI.

Incoming-link histogram over **all 83 claims**: three with zero; 57 with one; 17 with two;
three with three; three with five. The most-linked claims were graph containment/ancestry,
language-adapter refusal, and concurrent report preservation, each with five consumers.
These are repeated consumers of existing contracts, not newly measured guarantees.

The three zero-link claims were CLI singleton identity/authority flags, source-text
searchability, and built-in language-pack data purity. Their lack of links does not mean
they lack enforcement or value. Root and tests had no boundary claims in this population;
adapters had provider links but no consumer declaration. These zeros remain in the inventory.

Every one of the 56 pairs retains its prior audit disposition: 30 linked, seven type-only,
ten test/evidence, nine contract/representation gaps. The missing lifecycle → coordination
dynamic-import relation remains a separate instrument finding, outside the 56 denominator.
Disposition prose is attributed prior analysis, not newly established runtime completeness.

## Retrospective vocabulary mapping

Each of the 112 additions has a source-addressed row in [mappings.json](mappings.json),
preserving its claim, consumer/provider, candidate families and an explicit residual rule.
Each cited oracle was considered at its named scope; repeated invariant prose was not
treated as proof that different oracles establish the same property.

Under this review's conservative definition of unchanged fit:

- 0 unchanged fits.
- 94 partial fits: a candidate names a relevant concern, but essential local semantics remain.
- 18 without a matching current candidate.
- 80 distinct cited claims produce 80 explicitly named residual clause groups. Repeated
  consumers reuse these IDs; this is not 112 independent custom contracts or a demonstrated
  minimum count of atomic clauses.

This is **not 0/112 portability accuracy**. The current candidates are one-line suggestions
without scope-parameter schemas. Requiring them to express scoped properties unchanged may
be a defect in the measurement rather than the concepts. Conjecture `d-97381c3b` preserves
that question for the independent candidate assay. No new applicability record was authored.

| Candidate family | Partial link associations | Distinct cited claims |
| --- | ---: | ---: |
| G-BOUNDARY | 22 | 16 |
| G-STATE | 10 | 10 |
| G-LIFECYCLE | 5 | 3 |
| G-CONCURRENCY | 9 | 5 |
| G-PERSISTENCE | 17 | 10 |
| G-EXTENSION | 8 | 4 |
| G-PRESENTATION | 1 | 1 |
| G-OBSERVABILITY | 9 | 7 |
| G-PURE-DECISION | 1 | 1 |
| G-CLI | 0 | 0 |
| G-SESSION | 1 | 1 |
| G-FACTORY | 0 | 0 |
| G-API | 0 | 0 |
| G-DETERMINISM | 1 | 1 |
| G-PARSER | 8 | 8 |
| G-PROJECTION | 25 | 17 |
| G-REGISTRY | 8 | 6 |

Associations overlap; totals must not be read as a partition. Zero CLI associations despite
71 CLI-origin links is expected: these declarations describe the **providers' consumed
properties**, not the consumer's taxonomic role. The table is neither demand nor a basis
for deleting G-CLI, G-FACTORY or G-API.

Important residuals:

- “Concurrent operations preserve ordering” does not specify content-identity exactly-once
  streaming through compaction, or preservation of independent report sections.
- “Durable authority … recovery” does not specify that a skipped verification preserves
  the prior failure and its original timestamp.
- Projection fidelity is repeatedly relevant, but required populations, unsupported-input
  handling and evidence-authority limits must be named, not smuggled into “required meaning.”
- Positive evidence of oracle execution, vanished-oracle verdicts, criterion-total closure,
  and the distinction between work completion and verification are not stated by the
  current vocabulary. Some may eventually generalize; this one project cannot establish it.

The 36 simulation entries remain frozen with the 17 core entries. No simulation-facet
applicability was established for these consumers. This review therefore does not validate
the inherited core/domain partition. All 53 remain deferred for promotion in the readiness
inventory; prospective domain-neutral revisions still require the external rejection assay.

Authoring effort and rewrite counts are unavailable. Shared session elapsed time includes
other tasks and anomalous verification durations; it is not a usable effort denominator.
The archive preserves exact successful declarations and known rejected relation forms,
not an invented history of authoring attempts.

## Lossless archive and reproduction

- [snapshot.json](snapshot.json): baseline, all spec content digests, exact declarations and
  source locations, canonical claim/component/relation populations, and the full v2 catalog.
- [exploratory.patch](exploratory.patch): exact addition-only delta across nine specs.
- [inventory.json](inventory.json): zero-inclusive distributions and every edge disposition.
- [original-report.md](original-report.md): original audit bytes, before its withdrawal note.
- [inventory.mjs](inventory.mjs): read-only-to-the-project consistency checker. It replays the
  patch against baseline spec bytes in a fresh temporary directory, compares every captured
  source digest/declaration, removes only that scratch directory, then reconciles every count
  and mapping location. It is not a semantic-review oracle.

From the repository root:

```sh
node docs/assays/guarantee-adoption-2026-09-09/inventory.mjs check
git apply --check docs/assays/guarantee-adoption-2026-09-09/exploratory.patch
node src/cli.ts guarantees --check
```

The second command checks recoverability; it does not restore the discarded annotations.
Do not replay the patch into a changed worktree without reviewing conflicts. The capture
mode documents how the original population was taken before removal; checks use the frozen
snapshot, not today's smaller live population.

Content addressing detects inconsistent archive bytes, not an adversarial rewrite of bytes
and hashes together. Git history remains the external witness; this extraction is not committed.

## Lab readiness and the stop condition

[readiness.json](readiness.json) inventories all 17 known cases across 12 projects and 14
reference roles. All 17 source files are available; all 17 dossier content digests reproduce.
Current source hashes and clean tracked checkout commits are recorded. The dossier manifest
does not pin a historical source commit, so equivalence to the original assay's source
revision remains unestablished. Fourteen dossiers contain LSP request errors, retained as
instrument limitations rather than application defects.

Reproduce the availability inventory without executing project code, classifiers or LSP servers:

```sh
node docs/assays/guarantee-adoption-2026-09-09/readiness.mjs /path/to/coherence-lab
```

The role-reference labels are not guarantee applicability labels. No candidate was drafted
against these cases and called independently validated. Before proceeding:

1. Assign an independent curator and separate reviewers. Independence must mean separated
   tasks and unseen candidate outcomes, not the author rereading their own proposal.
2. Freeze fresh cases from responsibilities/failure modes before candidate clause drafting;
   retain the 17 known stress cases and pin source evidence for the new round.
3. Establish each family's six-positive/three-negative minimum and project/domain spread;
   do not count unreviewed cases as positive or classify from role labels alone.
4. Freeze candidate scope/clauses, reference judgments, usefulness questions and reader
   assignments, then run and report the three scores separately.

No family may move to implementation while these prerequisites remain missing. A separately
tasked agent is a possible reviewer, not guaranteed independent evidence; record model,
context exposure and shared-model limitations. Curator/reviewer delegation needs explicit
authorization. Until then, extraction is complete and the portability experiment is unrun.

## Verification of this extraction

Archive replay and count reconciliation pass. All nine specs match the baseline exactly.
The remaining six declarations pass link integrity with zero issues and 83 claims.
Twelve targeted guarantee/Scope tests pass; deterministic docs and Scope checks pass.
Saved browser artifacts are regenerated to remove the withdrawn annotation content.

The prior full verification report is still failing; this bounded extraction did not rerun
or overwrite it. No clean full-verification claim is made.
