# PostHog query cache: a guarantee-to-Scope slice — Codex's take

## What this establishes

Open the [standalone Scope snapshot](../../../public/_scope-posthog-query-cache.html).
The current [canonical snapshot](results/paths-v1/scope.json),
[local verification record](results/paths-v1/status.json),
[adopted spec](results/paths-v1/query-cache.spec.txt), [source pins](results/paths-v1/source-pins.json)
and original test run under `results/paths-v1/runs/` retain the path reading.
The earlier card-only observation remains unchanged under `results/`.

Two catalog definitions now have an explicit adoption path through a project's spec,
the existing verifier and run record, the guarantees CLI, and live Scope:

- **Supersession safety:** an older asynchronous upload cannot replace the newer cache entry or retain its losing blob.
- **Already-applied retry recognition:** repeating an installed pointer swap returns success despite stale expected inline bytes.

Both bind to `posthog/query_cache/size_tracker.py`, `replace_value()`, and the original
`test_stale_upload_cannot_replace_a_newer_entry`. They are two promises with independent
R3 mutation controls, **not two independent oracles**. This slice freshly ran that
unchanged original test against real Redis and fake object storage. It passed; the two
local boundary claims consequently passed. No historical assay report was imported as
new support. No new behavioral mutation was applied to PostHog in this slice.

Full verification of the surrounding slice still exits **1**, with four unclaimed
components and no failed boundary claims. Those are deliberately retained adoption gaps,
not filled with file-existence claims. This is not a passing whole-PostHog assessment.

## Binding contract

The existing spec parser accepts `## guarantee bindings`, with one JSON object per bullet:

```text
claim             existing local g-… boundary reference
definition        explicit guarantee:… candidate ID
definitionDigest  digest of the exact candidate definition
subject           canonical file or file#symbol owned by the declaring component
assessor          caller attribution, not an authority certificate
because           applicability and mapping rationale
parameters        exactly the definition's named keys, with concrete local values
excludes          what the local promise does not cover
falsifier         a concrete contrary observation
evidence          repository-relative files and their SHA-256 content digests
flow (optional)   {from:{subject,title},to:{subject,title}} owned file#symbol endpoints
```

The boundary remains the single local promise and oracle anchor. This does not change
historical taxonomy definitions, activate candidate obligations from roles, or replace
existing `addresses`/`relies on` links. The separately recorded file taxonomy describes
the size tracker as a resource driver; that assessment supplies no guarantee verdict.

`guarantees --check` validates bindings as well as legacy links. Malformed declarations,
unknown definitions, incomplete parameters, wrong ownership, changed pins and linked
evidence paths refuse current applicability. Catalog example grades remain reference
metadata, never evidence for this adoption.

Flow addresses must resolve to symbols owned by the declaring component, and both
source files must be pinned. Role titles and direction are caller-assessed, not a
derived call graph. The local boundary supplies the relationship's promise; there is
no second promise string to keep in sync. Changing endpoints or titles changes the
binding identity and cannot inherit the previous observation.

`verify` captures binding inputs before and after its run and attaches matching input
digests to the existing claim record only when the named executable oracle check was
reached. Structural failures alone do not receive that attribution. Changed spec,
configuration, definition or explicit evidence cannot reuse support. A fast skip retains
previous evidence without renewing it; `--from-report` cannot establish an execution
interval and does not mint binding evidence. A failed oracle check remains failed,
including unavailable/vanished named evidence, with its verifier detail visible.

This is **not an immutable receipt system**. Records retain the existing local mutable
status-file trust boundary. Applicability, mapping and dependency completeness remain
caller-assessed. Pre/post digests do not prove a transactional filesystem snapshot or
detect changes restored between observations. External services and runtime dependencies
outside the explicit input set are not content-addressed by the generic mechanism.

## The production bridge and its limits

[The preparation script](../../../scripts/posthog-scope-v0.mjs) copies tracked Python
files from the query-cache subtree plus the real Redis connection-factory and object-
storage modules into a new temporary project. Source bytes must match pinned PostHog
`c54fec2163ad9455fd23a947f86a9034c1df9388`. It never changes either source checkout.
Omitted imports stay outside the graph; this is a selected source slice, not a runnable
copy of the entire application. The oracle bridge is excluded from application geometry.

[The fixed runner](run-query-cache.py) executes the original test in the previously
prepared full PostHog runtime. It verifies the pinned checkout is tracked-clean and
that original and copied subjects match before and after execution. Each invocation
retains a new `runs/<id>/pytest.log`, JUnit XML and converted report. The converter
requires exactly the expected class/method; missing, duplicate, skipped or setup-error
results refuse. It uses the existing Vitest-shaped batch interchange but is explicitly
a **pytest JUnit bridge**, not a Vitest run. No application behavior is mocked by the
bridge; fake S3 and controlled uploads are the original test's own fixtures.

The runtime uses the dedicated R3 OrbStack services and synthetic credentials, not the
ambient shell's credentials. Python and transport paths are local assay configuration,
not a general deployment adapter. Retained R3 controls bound the claims: the supersession
mutant failed first on remaining blob count, not the later response assertion; the retry
mutant tested the return contract, not an injected lost network reply or real S3 cleanup.

## What Scope exposes

The default reading is now **Region graph** when explicit paths exist. A Query cache
parent region contains two real symbols: the upload coordinator and pointer publisher.
Two directed edges carry the local promises; cleanup and upload completion are roles
of one symbol, never duplicated implementation nodes. Redis and object storage remain
outside the region with their authored descriptions. Imports are optional dashed context.
Selecting a promise opens the existing evidence inspector without refitting the camera.
Collapsing a region retains its internal promise summaries, not whole-component health.

This first graph reading focuses one assembly at a time, with an assembly selector,
two paths per page and at most three external providers; withheld populations are
named. The canonical center is the initial focus. React Flow owns compound nodes,
edge routing, labels and interaction; Cytoscape grids arrange subjects and providers
within the two reading regions. Geometry depends on addresses and expansion, not
evidence text or verdicts. This is not automatic call-graph discovery or a claim that
the entire project fits on one canvas. **Guarantee paths** retains the earlier focused
card reading, and **Assemblies** retains the existing ownership/import overview.

The query-cache card shows both shared titles and their actual local promises. Selecting
it exposes the binding scope, parameters, assessor, exclusions, falsifier, named oracle,
run time and input identity. Neither counts nor color imply whole-component coverage.
Unadopted neighbors show their descriptions and explicit lack of guarantees.

Live edits repopulate the canonical binding reading without running tests or moving the
camera. The browser acceptance check changed a copied source file, observed both bindings
become stale, restored it, and observed support for the original bytes again.

“Challenge this promise” prepares an existing CLI conjecture carrying the exact binding,
subject and falsifier. The draft says **not recorded / not delivered**. Running it from
the project root records an open question; live Journal repopulates. The browser test
uses a conspicuously labelled synthetic acceptance probe, not a claimed PostHog defect.
There is no direct browser write, agent-delivery acknowledgment, or automatic repair loop.
Independent usefulness and cross-project portability are still untested.

## Reproduce locally

Use the existing R3 isolated runtime (adjust its documented local paths when relocating):

```sh
docker compose -f docs/assays/posthog-guarantees-r3/compose.yaml start
node scripts/posthog-scope-v0.mjs /path/to/pinned/posthog /path/to/pinned-env/bin/python
```

The second command prints a new project directory. From that directory, invoke this
checkout's `src/cli.ts verify`, then `src/cli.ts scope` with Node. Full verify's four
coverage gaps are expected; inspect the named claims and `guarantees --json` separately.
From Coherence's root:

```sh
node scripts/scope-preview/snapshot.mjs --project /printed/project
node scripts/scope-preview/build.mjs --project /printed/project
node scripts/scope-preview/serve.mjs --project /printed/project
node scripts/scope-preview/bindings-browser-check.mjs /printed/project YOUR_SESSION
```

The last command deliberately records one synthetic conjecture in that isolated project.
The optional taxonomy assessment can be recorded through the normal `taxonomy record`
CLI after reading the subject; preparation does not infer or auto-adopt it.
Opening `public/_scope-library.html` inside the printed project is an offline snapshot.
The loopback server's printed capability URL is the live view. Keep the URL private.

## Checks and discovered gaps

- Core tests cover exact fields, population, source pins, malformed declarations,
  unknown definitions, duplicate bindings, symlinks, fresh execution, fast skips,
  historical-report refusal, edits during execution and structural failures.
- A deliberate negative control removed the pre/post input comparison: the named test
  failed on an incorrectly populated evidence binding. Restoring it passed.
- Preview tests cover shell quoting, explicit draft state, and live refresh of ignored
  evidence inputs. WebKit checks both default paths, their local promise text and real
  endpoints, provider descriptions, the assembly cards, inspector, source staleness,
  preserved viewport, and CLI-to-live-Journal handoff. Its first path-context assertion
  failed because the render omitted the canonical `intent` field; rendering intent
  alongside prose restored the provider explanation and passed the same assertion.
- Removing endpoint-file pin validation made the named core guard fail; restoring it
  passed. Shape damage, foreign ownership, missing symbols and changed mappings are
  also controlled. These checks do not prove the author's semantic direction.
- Region-graph WebKit checks cover deduplicated symbols, edge inspection, collapsing,
  optional imports and live staleness without camera changes. The initial screenshot
  exposed hidden edge labels: the parent region and SVG hit targets covered the label
  portal, and the real click timed out. Explicit label stacking restored visibility
  and clickability. A second screenshot exposed the top label overlapping the assembly
  intent; reserved header clearance fixed it, now checked by browser bounding boxes.
- The first production graph had **zero dependency relations**: Python dotted local
  modules were always treated as external. A closed Python import-address strategy
  now resolves unique root-relative or explicit relative modules against the canonical
  file population. The same slice has five relations. Ambiguous/missing modules stay
  external; this does not model runtime `sys.path`, package reexports or dynamic imports.
- Python methods are canonically named with `()`. The first spec used `replace_value`
  and failed before execution; it was corrected to `replace_value()` rather than changing
  source or weakening symbol resolution.

Global hook instructions intentionally remain unchanged: the existing verify, guarantee
check and journal actions carry this slice. Binding details remain in command help and
this study, rather than increasing bounded startup text. No hook protocol bump is needed.

Repository checks: the full Node test suite, typecheck, build, packed-consumer smoke, 25 preview tests and the
PostHog WebKit acceptance probe pass. A full-suite ownership guard initially caught
missing named rationale for the two new invariants; the rationale was added under each
owning spec and that guard passes. Coherence's own `guarantees --check` currently reports
three stale historical taxonomy links (buildGraph, readTrustedJournal, recordVerify),
including changed manifest/type/source inputs. They were not automatically re-pinned.
The isolated PostHog `guarantees --check` passes for both explicit bindings. No claim
of whole-repository coherence or release readiness is made.
