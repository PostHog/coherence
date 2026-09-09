# PostHog ingestion as a Scope design fixture — Codex's take

2026-09-09. Source commit `c54fec2163ad9455fd23a947f86a9034c1df9388`.

## Result

Update after canonical alias resolution: the same 41 pinned files now derive **17
component relations instead of two**, exactly matching the pre-implementation
prediction. All eight declared guarantee reliances resolve. Internal file imports
increase from 35 to 77; 137 omitted/unresolved alias occurrences remain external.
The center is now batch execution and result routing. No renderer changes were made.

Declaring `importAliases` first made all six recorded binding observations stale.
A fresh six-suite run passed 103 tests and restored their scoped support; all 13
local claims passed, while the five coverage failures remained. The configuration
option is shared canonical derivation, not a fixture-specific browser workaround.
A live-server regression also proves configuration edits repopulate relations.

Verification for this change: 35 focused canonical/live tests and 11 layout/semantic
tests pass; typecheck passes; the ingestion standalone is byte-current; ingestion
`guarantees --check` passes. Coherence's own link check is separately red for three
expired applicability assessments referencing changed workspace files. Those
assessments were not refreshed or represented as current by this change.

Recovered readings: [inventory](results-aliases-v1/inventory.json),
[verification status](results-aliases-v1/status.json),
[Scope](results-aliases-v1/scope.json), and
[WebKit overview](results-aliases-v1/overview-webkit.png).
The [browser diagnostic](results-aliases-v1/browser-diagnostic.json) finds seven
guarantee labels representing eight reliances, with five pointer-accessible and
two obscured. The recovered map is a better test subject, **not visual acceptance**:
long titles wrap, but guarantee descriptions remain behind G-count inspection,
some connections pass beneath unrelated cards, and fixed card sizes constrain fit.

### Original adoption baseline (preserved)

The richer adoption is built and its selected oracles execute. It is **not an
accepted map**. It exposes two separate failures: canonical import resolution drops
real relationships, and the current canvas obscures even its one surviving guarantee
label. No renderer changes were made in this adoption pass. Query cache is retained.

- Eight implementation components plus the project container; 41 pinned upstream files.
- Thirteen local boundary guarantees, all with positive named-test results in this run.
- Six explicit catalog bindings across five reusable definitions; all current with
  scoped input-bound support. No new portability or whole-component health claim.
- Eight source-inspected guarantee reliance declarations: one current, seven invalid
  because the required canonical dependency is missing.
- Six original Jest suites, 103 tests passed. Full Coherence verification still exits
  1 for five components without claims, including the project frame. Those are retained
  adoption gaps, not filled with trivial checks.

Complete machine readings: [inventory](results/inventory.json),
[adoption declarations](results/ADOPTION.json), [verification status](results/status.json),
[canonical Scope](results/scope.json), and original reports under `results/runs/`.
The [overview screenshot](results/overview-webkit.png) is a counterexample, not a design endorsement.

## Neighborhood and guarantees

| Responsibility | Adopted reading |
| --- | --- |
| Transport integration | Real driver composes returned effects and scheduler completion; source-only, not proven by FakeDriver tests |
| Admission and acknowledgment | Settlement bookkeeping, graceful drain, cancellation release, FIFO admission, stream ceiling |
| Batch execution and result routing | Batch ceiling; DLQ and redirect effects retained; inline effects settle before context clears |
| Shared ingestion recipe | Unknown tokens drop without stopping peers; DLQ and redirect results reach configured fake outputs |
| Parsing and team resolution | Source-backed processing stage; no separate guarantee adopted and no general tenant-isolation claim |
| Analytics processing | Source-backed composition of restrictions, per-identity processing and flushes; not executed end to end |
| Output destinations | Real destination interfaces; fake producers do not prove Kafka durability |
| Deferred effect scheduler | Wait-for-all observes and waits for its scheduled population |

The six catalog bindings are acknowledgment barrier, graceful drain, cancellation
release, fair admission, and bounded admission at two distinct boundaries. Local
guarantees remain local when no candidate definition was established as an appropriate
fit. We did not force every useful statement into the reusable catalog.

## What this reveals about Coherence

### 1. Root aliases remove the topology before the browser sees it

Upstream `nodejs/tsconfig.json` declares `~/*` → `./src/*`, with a more-specific
`~/tests/*` mapping. Before this fix, Coherence resolved JavaScript imports only when they
start with a dot. The unchanged slice produces:

- 35 resolved internal file imports, but only two cross-component relations.
- 103 distinct unresolved root-alias specifiers, across 179 import occurrences.
- An exact, source-configured diagnostic resolves 42 occurrences to files actually
  present in the slice. This would add 15 component pairs and recover all seven
  rejected guarantee reliances.
- The other 137 occurrences remain outside the copied slice or unresolved. Resolving
  an alias does not make an omitted dependency present.

That diagnostic is **not fed into Scope**. No imports were rewritten, no symlinks
created to simulate ownership, no runtime call edges invented, and no browser-only
topology substituted. Static module adjacency includes type references; it is not
an event-flow or runtime-call proof. The current displayed gravity center is therefore
a reading of an incomplete graph, not a validated center of this ingestion path.

The canvas's “0 imports outside this view” counts only known component relations.
It does not disclose unresolved source imports. That wording must not be used as
evidence that this slice is complete.

### 2. Cross-component subject paths are not expressible as binding flows

The binding resolver currently requires both optional flow endpoints to belong to
the declaring component. A driver→scheduler or result-router→destination subject
path crosses that restriction. We retain component-level `relies on` declarations
and report the limitation; we do not merge unrelated ownership seams to bypass it.
Alias resolution can recover the component links without loosening flow validation.
Cross-owner subject paths need a separate explicit design, not a blind removal of
that check.

### 3. The rendering failure is independently reproducible

WebKit displays all eight assemblies and retains thirteen guarantee records. Only one
of eight declared reliances has a drawable label; a normal click on that label fails
because the provider card intercepts the pointer. Keyboard focus/Enter reaches the
correct guarantee inspector. Several long titles also clip in the fixed rectangles.

`ingestion-browser-check.mjs` is a diagnostic of this failing state, **not a green
visual acceptance test**. It records the occlusion and tests keyboard inspection
separately. The next visual gate must require ordinary pointer access and readable
titles, not merely populated DOM nodes.

## Execution and provenance

Initial Node 22 execution passed 83 tests but could not load the common pipeline
suite: the existing node-rdkafka binary requires Node ABI 137, versus Node 22's 127.
Using the already-installed Node 24.8.0 runtime ran all six original suites: 103/103.
No dependencies or native modules were rebuilt, and no application source changed.

The adoption's fixed oracle bridge reran those suites through Coherence verification,
checking copied and runtime source pins before and after execution. Its fresh report,
log, Node version and exit status are retained under `results/runs/`. Dependencies
come from the existing installation, not a newly reproduced lockfile environment;
tests use their own fake drivers, producers and managers. No end-to-end production
delivery, live Kafka behavior or complete failure coverage is asserted. Jest printed
an open-handle warning but subsequently exited 0; no forced exit counted as success.

The earlier R2 acknowledgment wait-removal cycle remains historical evidence at
the same source commit: 16 passing → two named failures → 16 passing. Its accounting
and timeout observations are narrower than proof against every early acknowledgment.
This adoption did not perform a new behavioral mutation and does not relabel that
historical run as one.

## Reproduce and next step

```sh
node scripts/posthog-ingestion-scope-v0.mjs /path/to/pinned/posthog /path/to/node24
# From the isolated project directory printed above:
node /path/to/coherence/src/cli.ts verify
node /path/to/coherence/src/cli.ts scope
# From Coherence:
node scripts/scope-preview/snapshot.mjs --project /isolated/project
node scripts/scope-preview/build.mjs --project /isolated/project
node scripts/inspect-posthog-ingestion-scope.mjs /isolated/project /new/results/directory
  # Add --resolved to compare the recovered graph against the preserved baseline.
node scripts/scope-preview/ingestion-browser-check.mjs /isolated/project /new/results/directory --resolved
```

The generator now declares aliases; use `--resolved` for the inspection command.
Without that flag, the inspector retains its original failing-baseline expectations.
Canonical alias repair is complete at its declared direct-module grade. Next is the
measured layout/label work: ordinary pointer access to every guarantee label, paths
that do not disappear under unrelated cards, and content-sized nodes using the
existing library layout. Keep the populated ingestion map and do not add another
Structure mode. Query cache remains the small regression fixture.
