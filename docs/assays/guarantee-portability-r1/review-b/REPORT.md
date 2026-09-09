# Reviewer B — frozen R1 representation review

Reviewer: `guarantee_review_b`, host session `01a086ac-aab6-7513-8ce1-df54dae32d87`.

I found at least one semantic representation mismatch in each of the four frozen candidates. These are independent reviewer judgments for synthesis, not family admission decisions or implementation satisfaction verdicts. All 27 dossiers remain in the 108-row matrix, including the 17 known stress cases and ten fresh subjects.

| Topic | Fit | Mismatch | Unknown representation | Not applicable |
| --- | ---: | ---: | ---: | ---: |
| Boundary | 2 | 7 | 9 | 9 |
| Determinism | 6 | 1 | 7 | 13 |
| Projection | 0 | 8 | 3 | 16 |
| Persistence | 2 | 1 | 3 | 21 |

The unknown representation column includes both unknown applicability and applicable subjects with insufficient evidence to bind every clause. No unknown was silently counted as a semantic failure or a fit.

## Concrete counterexamples

- Boundary: elephc `check` decides semantic type relationships, which cannot be captured by field shape/range constraints. `lower_instruction` must recognize a live instruction reference. Kubebuilder `SaveTo` and DSH `writeWorkspaceUpload` decide live filesystem conditions, including exclusive creation or resolved containment; using their executable validators as schema references would conceal the missing policy. Dataset-provider selection includes runtime protocol conformance. The clearest outcome mismatch is tolerant parsing: BTrace `parseInt("7",7)` and `parseInt("bad",7)` both legitimately return 7, while DSH `parseOpenWithConfig` deliberately defaults malformed fields and drops malformed rows without an error report. R1 requires distinguishable rejection.
- Determinism: Megatron-Bridge `get_dataset_provider` constructs a fresh `protocol_adapter` callable for the same protocol configuration. The stable result is its interface behavior, including the train/validation/test argument mapping. None of R1's equality modes defines that callable equivalence; comparing function identity would reject legitimate results. This judgment does not attribute deterministic dataset contents to the selected provider.
- Projection: elephc tokenization, parsing, optimization and instruction lowering compute representation meaning, synthesize identities or change cardinality. The optimizer's handler-visible store preservation cannot be expressed as copied fields. Megatron-Bridge's positional count adapter has no carried identity field: identical train and validation counts cannot become the same identity. Streamplace's JSON decoder interprets escapes and preserves positional duplicates. DSH's tolerant settings parser intentionally omits malformed rows without reporting them. DSH `buildSidechatInheritance` legitimately adds interrupted closing events or replaces a pending-tool tail with aggregated bounded snapshot text. Each needs semantics beyond this revision's one-to-one copy/rename schema.
- Persistence: Streamplace `GetServerSettings` legitimately returns `nil,nil` for absent key B even when settings for key A already exist. This per-key absence is neither refusal nor first adoption. Reclassifying every unset key as adoption would invent lifecycle semantics absent from the source API.

Each mismatch row includes its own scope, clause expressibility findings and concrete observation pair. Partial parameter objects on mismatches/unknowns are explicitly not complete candidate instances.

## Separate activation result

Suggestions were derived solely from reviewer-assessed taxonomy. Boundary suggests 13 subjects, determinism seven, projection four and persistence six. Unknown suggestions remain explicit (five, seven, four and zero respectively). Projection's broader semantic responsibilities include parser/decoder subjects outside the exact lowerer-role trigger; the optimizer's precise role remains unknown. A suggested candidate may still mismatch, as the callable, tolerant-parser and absent-row examples demonstrate. These are reviewer-taxonomy results; curator-taxonomy comparison awaits the parent and was not inspected here.

## Evidence and limits

No application source, imports, tests, installs or network were executed. Observations are proposed discriminating checks, not test results. The source excerpts establish source-reading responsibility at their recorded grade. Delegated grammars, decoders, code emitters and database recovery policies remain unknown where necessary. In particular, ordinary database save wrappers do not establish the full recovery contract. Conversely, Kubebuilder's truncating configuration update can meaningfully be assessed against whole-snapshot publication even if interruption would reveal a violating implementation; possible failure is not itself a representation mismatch.

Exposure was limited to mandatory repository/session instructions and field readings, the parent task/handoff/status/formatting messages, and the three permitted frozen artifacts. Field readings exposed unrelated work objectives and journal subject names. No reference answers, curator build script, adoption mappings, root transcript, sibling review or synthesis were read. No additional source files were opened. This is procedural independence with shared filesystem and same-model correlation limits, not enforced isolation.

Population adequacy against the independently curated reference positives, reviewer agreement and usefulness were not assessed here. No core-admission or repository-health conclusion follows.

## Freeze

- `review.json` raw SHA-256: `78815dc6557e87777290cca009b602d9474652f576081eb3fca7232679a77240`
- `candidates.json` raw SHA-256: `6a94125de2d4afaf78deb94767ff884b27f253301c2ab9922bc90e1a25dab31c`
- `curation/corpus.json` raw SHA-256: `0b6a45e2d3613ed8a38c210a099ec696fbcbf76a2a86ed8bd31a0d449f0dc4e4`

Input hashes were checked before assessment and again at review freeze. Mechanical checks found exactly 108 unique case-topic rows, schema-permitted parameter keys, all required parameter keys for fits, three clause grades for every applicable row, and concrete counterexamples for every mismatch. The review bytes are frozen and will not be altered after handoff.
