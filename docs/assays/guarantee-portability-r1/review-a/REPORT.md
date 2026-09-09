# Independent review A — frozen R1

Reviewer: `guarantee_review_a`, session `01a086ac-4848-7471-a5bd-bf8da28d3e0a`.

All 27 dossiers are retained across all four topics: 108 distinct rows, comprising 68 known-stress rows and 40 fresh rows. This review assesses responsibility and representability, not implementation satisfaction or core admission.

| Topic | Fit | Mismatch | Unknown | Not applicable |
| --- | ---: | ---: | ---: | ---: |
| Boundary | 3 | 6 | 6 | 12 |
| Determinism | 6 | 1 | 5 | 15 |
| Projection | 0 | 12 | 0 | 15 |
| Persistence | 2 | 4 | 1 | 20 |

The fitted rows are one known/two fresh boundary subjects, two known/four fresh determinism subjects, and two fresh persistence subjects. These are reviewer classifications; population adequacy against the independent curator's references has not been evaluated here.

## Concrete counterexamples

- Boundary: `check` owns semantic type admission that cannot be replaced with AST field-shape constraints. `writeWorkspaceUpload` must distinguish identical lexical paths with different symlink-resolved workspace containment. `SaveTo/writeNew` must re-evaluate exclusive creation at a filesystem race boundary. `parseInt` and `parseOpenWithConfig` intentionally return untagged defaults, so valid and malformed input can have the same successful value; B3 would change their contract.
- Determinism: `get_dataset_provider` promises appropriate provider selection but creates a new nested function for each protocol-provider call. Identity comparison rejects the intended behavior; callable behavioral equality or function normalization is not a declared R1 equality mode. This judgment depends on taking `structural-value` without an unstated callable-normalization rule. A disagreement on that meaning must remain a disagreement, not be resolved by assuming the extra rule.
- Projection: the optimizer must preserve program answers while deleting/replacing IR identities; instruction lowering computes machine-code meaning. The dataset protocol adapter has concrete count/context field mappings but no copied identity field: `[10,10,10]` contains three sample-count values, not three duplicates of an identity. `buildSidechatInheritance` must introduce interrupted closing events or build a bounded reference snapshot; limiting its scope to `copyEvents` would erase the open-turn duty. Tolerant config normalization and lexical/JSON/YAML decoding also need operations beyond R1 copy/rename and reported exclusions.
- Persistence: `GetServerSettings` deliberately returns `nil,nil` for an ordinary missing key in an already populated database. Neither refusal nor first adoption expresses that policy. The opaque DB save wrappers own a basic keyed-write duty while delegating recovery; R1 excludes them and requires additional recovery policies. `SaveTo/writeNew` reports write/close errors and protects exclusive creation, but permits failed partial files rather than promising atomic interruption recovery.

Every topic therefore has a source-grounded counterexample in this review. No post-hoc parameter, custom equality, semantic validator reference, or narrowed success-only branch was introduced to make those rows fit.

## Distinctions and limits

The PHP parser's process counter is an explicit prior-state input in its determinism fit. This does not claim two ordinary consecutive parses generate the same anonymous names. The `parseInt` helper's fit is separate from the enclosing live runtime class. The sidechat transformer can fit repeatability while failing projection expressibility.

Persistence fits are deliberately narrow: `LoadFrom` is a whole decoded read unit with malformed/missing refusal; the upload writer is whole-file publication under process interruption using temp-plus-rename. Neither establishes power-loss durability. No tests or lab source were executed, and no delegated implementation was proven correct. Incomplete effective dependencies, grammar evidence and aggregate-class scope remain explicit unknowns.

Activation is computed solely from source-assessed taxonomy, separately from fit. Parsers of external syntax are not automatically lowerer-role suggestions, even when they have broad encoded-value fidelity responsibilities. Positive boundary/persistence facets remain positive for source responsibilities excluded by the candidate. The full source evidence and unknown dimensions are retained in each row; no reference-taxonomy activation score is claimed.

Reading was limited to task/host instructions, repository `AGENTS.md`, mandatory coordination output, the protocol, frozen candidates and corpus excerpts. No curation answers/build script, reviewer B output, earlier adoption mappings, root transcript or final synthesis were read. Mandatory work output revealed curation counts/status and a reference digest, not judgments. Isolation is procedural on a shared filesystem with the same model; no accidental forbidden exposure occurred.

## Freeze and validation

`review.json` raw SHA-256:

`78b087d06f0ba91f6b7a67a9ec04d1fcca37039f6a929d9ec406158596eb2b1a`

Candidate raw SHA-256: `6a94125de2d4afaf78deb94767ff884b27f253301c2ab9922bc90e1a25dab31c`.

Corpus raw SHA-256: `0b6a45e2d3613ed8a38c210a099ec696fbcbf76a2a86ed8bd31a0d449f0dc4e4`.

Mechanical validation checked input digests, exactly one row for every case/topic pair, allowed parameter keys, complete parameters and clause findings for fits, counterexamples for mismatches, and suggestion recomputation from the recorded taxonomy. These checks validate artifact accounting, not the semantic judgments. Output is frozen before any other review is received; it will not be amended after handoff.
