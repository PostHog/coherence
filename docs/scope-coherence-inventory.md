# Coherence Structure inventory

This inventory supports the declarations in the root `## architecture` section. It
records the current local checkpoint; it does not claim runtime execution, causality,
or a passing verification result from an import. Source addresses are supporting
observations, while the spec remains the canonical owner of architectural meaning.

## Project story and entrances

| Declaration | Source support | Evidence boundary |
| --- | --- | --- |
| Project purpose | `README.md`; `src/derivation/derive.ts:105`; `src/verification/verify.ts:285`; `src/evidence/decisions.ts`; `src/coordination/work.ts` | The sentence is authored project meaning, assembled from these implemented capabilities. |
| Explore or check a project | `src/cli.ts:178`, `src/cli.ts:420`; anchor `src/cli.ts` | The CLI dispatches several graph-backed readings and verification. The entrance does not claim every CLI command derives a graph. |
| Start an agent session | `src/lifecycle/hooks.ts:60`, `src/lifecycle/hooks.ts:173`, `src/lifecycle/hooks.ts:293`; anchor `src/lifecycle/hooks.ts#runHook` | Hook composition reads work and trusted journal state. Host installation and delivery have separate controls and evidence. |

Both anchors resolve to the declared owning components in the derived graph. The
configured `entryDir` remains a graph root and is not used as an invented runtime
entrance.

## Declared component relationships

| ID | Authored meaning | Source support |
| --- | --- | --- |
| `command-model` | Harness commands request the canonical project model. | `src/cli.ts:178`, `src/cli.ts:403`, `src/derivation/derive.ts:105` |
| `language-seam` | Derivation delegates source syntax to the configured adapter. | `src/derivation/derive.ts:57`, `src/derivation/derive.ts:109`, `src/adapters/tree-sitter.ts` |
| `model-verification` | Verification evaluates subjects and claims from the graph. | `src/verification/verify.ts:285`, `src/verification/verify.ts:294` |
| `model-diagnostics` | Diagnostic commands combine graph subjects with their own observations and baselines. | `src/cli.ts:1148`, `src/cli.ts:1161`, `src/cli.ts:1168`, `src/cli.ts:1273` |
| `model-taxonomy` | Taxonomy resolves and snapshots graph subjects. | `src/taxonomy/taxonomy-cli.ts:121`, `src/taxonomy/taxonomy.ts:125` |
| `recorded-verification` | Verification records scoped readings and receipts. | `src/verification/verify.ts:285`, `src/verification/verify.ts:816`, `src/evidence/status.ts` |
| `evidence-orientation` | Orientation reads trusted evidence and live work before selecting a heading. | `src/coordination/orient.ts:222`, `src/coordination/orient.ts:232`, `src/coordination/orient.ts:255` |
| `work-instructions` | Startup projects exact owned work into session context. | `src/lifecycle/hooks.ts:173`, `src/lifecycle/hooks.ts:305`, `src/lifecycle/hooks.ts:325` |
| `session-memory` | Lifecycle composition opens and reads attributable journal evidence. | `src/lifecycle/hooks.ts:23`, `src/lifecycle/hooks.ts:293`, `src/lifecycle/hooks.ts:325` |
| `readable-model` | Reading surfaces project the canonical graph and promise model. | `src/readings/scope/capture.ts:138`, `src/readings/scope/capture.ts:140`, `src/readings/scope-model.ts:127` |
| `readable-evidence` | Scope adapts retained evidence through source transactions. | `src/readings/scope/capture.ts:267`, `src/readings/scope/capture.ts:296`, `src/readings/scope/capture.ts:311` |
| `executable-contracts` | Tests supply configured oracles used by verification. | `src/verification/verify.ts:311`; `coherence.config.json` test configuration |

These are assessed responsibility relationships. The default Structure projection
selects only these spec-owned edges and explicit `## relies on` guarantee relations;
ordinary graph `imports` edges remain available to other views but do not become
architectural arrows.

## Canonical population and limits

At this checkpoint the spec tree contains 12 components, 82 invariant promises and
114 canonical guarantee readings. The root architecture section declares one purpose,
two entrances and twelve relationships; three additional connections come from
explicit `## relies on` declarations. The parser
retains a spec path and one-based line for every accepted declaration. Duplicate IDs,
unknown fields, control bytes, malformed JSON, unresolved components and anchors outside
their declared owner become explicit problems. Fenced pseudo-declarations remain prose
and do not enter the architecture population.

Structure treats every declared invariant as a promise, including an unanchored one.
Canonical guarantees with the same exact owner and invariant identity supply all of
the promise's oracles; one invariant remains one Structure promise. Divergent recorded
verdicts are shown as mixed instead of being collapsed. Source availability is
reported independently, so unavailable taxonomy or evidence cannot appear as an empty
successful assessment.

Taxonomy summaries include only assessment subjects whose recorded exact owner equals
the component catalog identity. They disclose selected roles and facets, subject count,
stale count, all assessment-state counts and taxonomy-source availability. Candidate
roles remain assessment detail; they are not promoted to component classifications.

The real-project capture currently reports the experiments source unavailable because
an unrelated historical experiment ledger has a non-contiguous ordinal. Structure
retains that source failure as an issue; this work does not repair or reinterpret the
ledger.
