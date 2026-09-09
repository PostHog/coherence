# Guarantee portability R1 — Codex's take

2026-09-09. Source-based rejection assay, not executable verification or a product release.

## Outcome

**Admit none of the four frozen R1 definitions.** Both independent reviews are complete:
108 rows each, with matching input hashes and no reported forbidden exposure. The corpus
meets its numeric selection minimum, but no family clears the frozen representation gate.
Usefulness is therefore **unrun**, not failed or passed. No product implementation follows.

The important finding is not that reusable guarantees are impossible. It is that my R1
definitions smuggled particular policies into broad family names: boundary meant a limited
validation language and reportable rejection; projection meant one-to-one structural copying;
persistence meant atomic publication plus a particular absence/recovery policy. Naming those
policies generically did not make them universal.

| Family | Positive fits reported by both | Joint mismatches on positives | Joint unknowns on positives | Disagreements on positives | Negative controls jointly excluded | Disposition |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Boundary | 1/6 | 2 | 3 | 0 | 3/3 | Reject this schema; separate validation domain from rejection behavior. |
| Determinism | 5/6 | 0 | 1 | 0 | 3/3 | Defer; disputed reference and equality scope remain unresolved. |
| Projection | 0/6 | 6 | 0 | 0 | 3/3 | Reject this family-wide definition; copy/rename is a narrower property. |
| Persistence | 1/6 | 1 | 0 | 4 | 4/4 | Reject this bundled policy; preserve disagreements rather than count them as failures. |

These are source-based representability judgments, not tested implementation outcomes or
general accuracy estimates. The fit column is the mechanical intersection of reviewer
labels. Matching labels alone do not certify semantic adequacy. The six non-persistence
joint fits have compatible scopes on inspection: one structural input check and five
value-repeatability operations; fixed PHP mode, fixed code revision, error channels and
at-return value equality are assumptions retained in the review records. The persistence
fit agrees on a complete decoded read result, **not** proof of durable write publication;
both reviewers interpret S2 in its `read-recover` mode. That conditional interpretation is
itself wording to clarify in a later revision, not a whole-family pass here.

All 27 subjects and all 108 reference pairs survive the join, including 71 reference-unknown
pairs. Both reviewers also found responsibilities outside the designated positive sets.
Those exploratory observations remain in their records; they do not silently replace a
frozen positive or enlarge the scored denominator.

## What actually broke

### Boundary: a vocabulary cannot silently supply the acceptance predicate

Both reviewers rejected `elephc.check`: semantic type relationships cannot be expressed by
field-shape/range constraints without injecting the executable checker as the missing
predicate. Both rejected `writeWorkspaceUpload`: identical path strings can mean different
containment after filesystem/symlink resolution. Static schema validation cannot express
that relation by itself. Three other positives remain unknown because the dossiers do not
supply the full admitted grammar/schema; unknown is not a proved nonportable contract.

Outside the scored positive set, both reviewers found that tolerant parsing can legitimately
return an untagged default or drop malformed rows. R1's distinguishable-rejection clause would
change that behavior, not describe it. The usable cross-project question may be how rejection
and effects relate **once an acceptance policy is named**, but this round did not test a
revised form. An acceptance-policy reference also must not become a route for importing an
entire new contract while claiming no customization was needed.

### Determinism: the instrument needs correction before the subject is condemned

Five frozen positives fit value repeatability across four projects: tokenization, integer
parsing, JSON decoding, settings normalization and sidechat inheritance. These preserve
error/default behavior and effective inputs; none claims purity or entire-component health.

The sixth, `optimize_module`, was curated as determinism-positive. Both blinded reviewers
instead found an optimized-versus-unoptimized **semantic-preservation** promise and insufficient
evidence of equal-input repeatability. The frozen row stays unknown. It cannot be dropped to
announce 5/5, and it is not evidence that a deterministic-output contract fails to transfer.
Conjecture `d-59d27b71` records the possible curation/category error versus insufficient source
evidence. The curator's broader semantic-observation reading may also be defensible: two
different emitted programs can be equivalent in behavior without being identical artifacts.
That would expose an observation/equality mismatch in R1 rather than a bad curator label.
Resolve those meanings in a new independently frozen round, not by replacing the inconvenient case.

Both reviewers also identified callable-return equivalence at `get_dataset_provider` as an
unresolved boundary of R1's equality modes. That case was reference-unknown for determinism;
it is an additional counterexample candidate, not the sixth scored failure. A disclosed
interpretation of `structural-value` underlies their judgment. Do not invent callable
normalization after the fact to turn it green.

### Projection: a one-to-one copy contract was the wrong generalization

All six positives mismatched independently. Lexing and parsing change representation and
cardinality; optimization and lowering preserve program meaning while changing identities;
the dataset adapter maps positional counts to named fields without carrying identity fields;
sidechat inheritance creates interrupted closing events and bounded text snapshots.

Forcing a universal identity-preservation rule onto these subjects would condemn legitimate
behavior. Conversely “preserve required meaning” without specifying the relation would hide
the missing local contract. The assay supports demoting R1 to a proposed **structural copy
projection** scope, not promoting it as G-PROJECTION for all lowerers. Even that narrower
scope requires fresh relevant cases; this round supplies no successful positive for it.

### Persistence: ordinary absence is not lost authority

Both reviewers rejected `GetServerSettings`: `nil,nil` for an absent optional key is a
legitimate result in an already populated database. R1 offers only refusal or first adoption.
Calling each missing key a new adoption would manufacture lifecycle semantics.

The four disagreements matter:

- `SaveTo/writeNew`: A says atomic interruption recovery would add a promise; B says the
  candidate can represent a meaningful atomicity requirement that the truncating writer
  might violate. This is a disagreement over **new recommended obligation versus existing
  local contract**, not a result that can be settled by averaging the labels.
- Two DB write wrappers: A finds a scope mismatch from bundled recovery duties; B leaves
  delegated recovery semantics unknown. Do not turn unknown library behavior into a defect.
- `writeWorkspaceUpload`: A accepts the process-interruption publication scope; B finds
  missing/damaged target-authority policies unspecified. Atomic target visibility and general
  recovery are distinct obligations, despite being bundled into one R1 family.

These disagreements block admission even if the shared missing-key mismatch were repaired.
They are preserved verbatim in the independent reviews.

## Separate activation and usefulness readings

Every reported suggestion agrees mechanically with that reviewer's supplied roles/facets.
Both select candidates on all six designated boundary and persistence positives; both
exclude all designated negatives across all four topics. This does **not** make the selected
contracts representable. Both leave optimizer determinism unknown. Projection misses the
parser/lexer responsibilities and leaves the optimizer role uncertain under the exact
lowerer-role trigger. The candidate definition and its trigger have different scopes.

Because all curator roles/facets are unknown, these are comparisons of attributed agent
assessments with curator responsibility labels, not a reference-taxonomy test or a measured
run of Coherence's full classification workflow.

No candidate meets the preceding gate, so the preregistered conditional usefulness trial
was not run. Its 24 frozen question sets remain in `reference.json`. There is no demonstrated
reader benefit, no time-saving claim, and no reason to add implementation on the strength
of this round. Decision `d-aad93801` records the stop.

## Next decision, not an automatic next implementation

The smallest justified follow-up is a new value-repeatability assay: independently resolve
the optimizer reference dispute, retain the callable/equality question, and add fresh cases
before testing usefulness. Do not spend another round rebuilding all four broad families.

For the product design, distinguish reusable **property definitions** from recommended
**policy choices**. Candidate rejection behavior, structural-copy fidelity, optional-record
absence, atomic publication and recovery need their own applicability and scope. This is a
finding to evaluate, not authorization for a new untested catalog or a claim that splitting
the concepts will pass. The full core/simulation partition remains unvalidated.

## Frozen population and ordering

The curator selected 27 subjects from 12 projects: all 17 known stress subjects plus ten
new subjects. Each subject has an explicit reference judgment for each of four topics,
making 108 reference rows. Unknown is a retained judgment, not an omitted row.

| Topic | Positive subjects | Positive projects | Fresh positives | Negatives | Reference unknowns |
| --- | ---: | ---: | ---: | ---: | ---: |
| Boundary | 6 | 4 | 3 | 3 | 18 |
| Determinism | 6 | 4 | 4 | 3 | 18 |
| Projection | 6 | 3 | 1 | 3 | 18 |
| Persistence | 6 | 3 | 6 | 4 | 17 |

All positive sets span at least three curator-labeled application domains; negative sets
span at least three projects. This meets the preregistered minimum, not a statistical
sampling standard. Every negative and unknown remains visible beside the positive score.

1. Corpus/reference freeze: `2026-09-09T14:53:46.376Z`, curator session
   `01a086a2-4e8c-7712-96d6-f3e2a7523b73`.
2. Candidate drafting began afterward; author had received only counts and hashes, not
   case identities or answers. Decision `d-4c408687` records that ordering.
3. Candidate/protocol hashes were fixed in `d-7b9594b8` before reviewer dispatch. Only then
   did the author inspect curator cases and references for synthesis.
4. Reviewers have separate host-issued sessions and separate permitted output directories.
   They receive corpus and candidates, not references, sibling outputs or adoption scores.

| Input | SHA-256 over exact file bytes |
| --- | --- |
| corpus.json | `0b6a45e2d3613ed8a38c210a099ec696fbcbf76a2a86ed8bd31a0d449f0dc4e4` |
| reference.json | `6cdd54641451ea9a19e368a7c570175abd393031a179cabd3ec1f71f901eae85` |
| candidates.json | `6a94125de2d4afaf78deb94767ff884b27f253301c2ab9922bc90e1a25dab31c` |
| protocol.md | `e990030e9d4d6b1dbe8c66d6d37bf7755679ecbfb211f8bc1317c68bbe9b763a` |
| review-a/review.json | `78b087d06f0ba91f6b7a67a9ec04d1fcca37039f6a929d9ec406158596eb2b1a` |
| review-b/review.json | `78815dc6557e87777290cca009b602d9474652f576081eb3fca7232679a77240` |

These hashes detect inconsistent bytes, not an adversarial rewrite of the entire history.
Nothing in this assay is an immutable verification receipt.

## Interpretation limits

- All reviewers use the inherited model family. Separation is by fresh context and task
  instruction, not model diversity or enforced filesystem isolation.
- Fresh subjects are new at the selected-symbol scope, not new repositories. Several
  share source files and libraries; the 24 positive case/topic pairs are not 24 independent
  projects or independent trials. The projection set is especially concentrated in one compiler.
- Thirty primary/supplemental excerpts were rechecked against their pinned whole-file
  digests and exact line contents. No lab application code or application test ran. Source
  comments are authored testimony, not observed runtime outcomes.
- All curator reference roles/facets are explicitly unknown. The reviewer-supplied taxonomy
  and its rule activation can be inspected, but there is no reference-taxonomy accuracy
  score and no executed production-classifier benchmark in this round.
- A concrete semantic mismatch rejects this revision; inadequate source evidence and
  reviewer disagreement block admission without proving the same thing. Missing tests
  alone cannot turn representability into a mismatch, and an actual implementation bug
  can be faithfully represented by a useful contract.
- Candidates deliberately expose bounded parameter schemas. A failure of those schemas
  is not a proof that reusable guarantee vocabulary is impossible. Definitions must not
  be widened after seeing these cases and reported as the same successful experiment.

## Reproduction and artifacts

[Procedure](protocol.md), [candidate definitions](candidates.json),
[reviewer corpus](curation/corpus.json), [reference judgments](curation/reference.json),
and [curation freeze](curation/freeze.json) preserve the input record.
[Review A](review-a/REPORT.md) and [Review B](review-b/REPORT.md) link their full raw matrices.

`node docs/assays/guarantee-portability-r1/score.mjs --self-test` exercises the accounting
controls for missing/duplicate rows, unknowns, insufficient populations and activation
overreach. Running the same script without flags verifies input hashes and exact matrix
populations and prints the mechanical join. Both checks pass. It does not adjudicate semantic
scope agreement or declare usefulness/admission. The final interpretations here are attributed
to the author and do not overwrite either independent review.

This round changes assay artifacts and coordination records only. The 83 production claims,
three original relies and three taxonomy addresses remain intact. The prior failing full
verification report is not rerun or promoted by this source-reading experiment.
