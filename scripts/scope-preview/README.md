# Scope library comparison — Codex's take

Open [the generated preview](../../public/_scope-library.html) directly in a browser. No server or second request is needed. This is a comparison, not the replacement for `coherence scope`; the previous renderer and its interrupted ring edits are untouched.

The snapshot is `public/scope.json`. Coherence now contributes 12 canonical components:
the project container, 10 implementation assemblies and the test evidence surface.
It is not live verification. Status, canonical center, ring membership, identities, and
evidence come from that snapshot. Previous hand-written x/y positions are ignored.

## Run

Cards switch between Description and Guarantees with taxonomy fixed below both.
The full spec text is retained at the same readable scale; guarantee lists scroll
independently. WebKit caught the first attempt crowding 529px of combined content into
a 357px description area; the browser guard still checks complete current descriptions
fit, and additionally checks every canonical guarantee name in the alternate reading.
Connections use explicit
spec-owned `relies on` declarations, not inferred zone matches. The inspector shows
each direction's claim, rationale, link health and recorded oracle evidence; missing
links are named. Taxonomy obligations separately show applicability, mapping and
unverified satisfaction. `coherence guarantees --check --json` reads the same canonical
join as Scope. The live feed recomputes it on spec, source, taxonomy or status changes
without executing tests; evidence-only updates preserve geometry and camera state.

```sh
npm ci --prefix scripts/scope-preview
npm run snapshot --prefix scripts/scope-preview
npm run build --prefix scripts/scope-preview
npm test --prefix scripts/scope-preview
npm run build --prefix scripts/scope-preview -- --check
```

For live updates while an agent works, run:

```sh
npm run serve --prefix scripts/scope-preview
```

Open the printed loopback URL and keep the process running. All four tabs update without
reloading: Structure follows source/spec/configuration changes and published status;
Journal and Taxonomy follow their canonical ledgers; Hooks also follows activity and
installed-control changes. No manual `scope`, snapshot or HTML rebuild is needed for
project-data changes. Opening the standalone HTML directly remains an offline snapshot.

The server polls every 750 ms. A broad metadata probe reuses Coherence's file walker to
detect additions and removals as well as edits; changed inputs trigger the existing
`buildGraph → buildPromiseModel → buildScopeModel` pipeline. This measured about 0.7–0.8 s
on Coherence's 155 files, so allow roughly one to two seconds here, longer on large trees.
Idle polls do not reparse source. Refreshes serialize, edit bursts coalesce, and changed
inputs detected during derivation cause a retry instead of publication. This is not a
transactional filesystem snapshot or a guarantee to observe every intermediate save.

SSE carries changed replacement snapshots. Reconnect gets the current state; Pause holds
the latest incoming snapshot until resumed. Tab, filters, selected records/components,
layout parameters and viewport survive updates. A removed selection falls back to the
new center. Scope opens with the center and up to three peer assemblies in a bounded
group. Paging retains the center and names how many assemblies and import relations
are outside the current view. **Whole-project overview** exposes all implementation
assemblies; **Fit displayed assemblies** fits the current group. Component-index selection
never zooms. The project is a containing frame, and the configured test component has
its own evidence entry instead of masquerading as a disconnected runtime peer.
Neither incoming data nor tab changes reset the user's camera. The fitted bounds cover
the actual cards, not empty symmetric orbital margins. The rings retain their canonical
gravity center even when that point is not the screen's geometric midpoint.
Unreadable configuration/status or a refused derivation leaves the last model visibly
unavailable and retries automatically; journal updates continue independently.

Watching never runs verification or writes artifacts/evidence. Guarantee marks are the
canonical **recorded** verdicts, not fresh checks of each edit. Uncommitted changes are
called out; the canonical verifier's freshness rules remain unchanged. Custom project
language adapters are refused in live mode, rather than executing project code on a
browser connection. Restart the server after changing harness implementation code;
frontend implementation changes additionally need `build`, a server restart (HTML is
loaded at startup), and opening the newly printed URL.

The four tabs are Structure, Hooks, Journal and Taxonomy. Hooks distinguishes installed control from observed session activation and shows canonical/customized event text without executing a hook. Journal exposes decisions, defects and experiments, with full-record search, pagination and outstanding-state filtering. Resolution is computed over the complete canonical journal before filtering by session. Taxonomy consumes the CLI's immutable caller-assessed classifications, with roles, facets, candidate responsibilities, evidence, ambiguity and staleness. Suggested obligations remain unverified. Only the CLI records assessments; browser annotations, verification and receipts are not implemented.

Structure cards lead with the existing spec's full intent and architectural prose,
not a second authored or generated briefing. Long descriptions scroll within the card
instead of being clamped away. The inspector presents eight invariants at a time, with
search and an explicit remaining count. Literal-name rationale mentions and named
refutations sit beside canonical enforcement and recorded verdicts; unmatched text remains
available in the full original why, claims and refutations. These links are navigation,
not semantic verification. Unanchored declarations remain visible, never passing.

Containment comes from the graph's nearest declared spec ancestor. Configured test
imports remain canonical relations, separately typed and excluded from implementation
gravity; they do not prove a named oracle ran. Boundary meanings come directly from
the existing project atlas, with canonical owner resolution and matching guarantee IDs.
Unassigned declarations remain at project scope, and no atlas prose creates a verdict.

Readability refutations: the original whole-orbit fit painted 420px cards at about 172px
wide. A subsequent single-card zoom made the text readable but hid the diagram; the user
rejected it. The replacement guard requires ALL of these in the SAME initial desktop
view: every card in the displayed group visible, complete purpose and architecture without scrolling, at least
15px / 14px effective prose type, and at least 35% card-area occupancy. Selection must
preserve that camera. A first 560×580 sizing attempt failed the full-prose guard (Harness
core needed 349px in a 323px description area); 560×614 retains that content without
clipping. Typography is larger inside the cards, with supporting monospace taxonomy.
Mobile retains the full diagram and inspector, but does not claim desktop type sizes.
An earlier startup guard also caught `fitView` waiting on unavailable node measurements;
the current fit uses the already-known rectangles with `fitBounds`. The 12-component adoption
also checks that paging conserves all implementation subjects and exposes a full overview;
the dense, explicitly selected overview does not claim desktop reading sizes.

Performance refutation: the original overflow-visible orbit SVG caused repeated WebKit
zoom p95 gaps of 234–350ms. Removing only the orbits reduced that to 31–33ms; merely
enlarging the SVG viewport did not repair it. Orbits now draw in screen coordinates into
a viewport-sized canvas, subscribed to React Flow's camera without React frame updates.
An actual wheel-input probe then exposed residual 85ms compositing stalls: promoting
card nodes to layers reduced p95 to 18ms while keeping all cards and connections.
`npm run test:performance --prefix scripts/scope-preview` repeats this full-population
WebKit probe three times, verifies ring alignment and bounded pixel storage, and guards
p95 below 40ms. These are local automated WebKit measurements, not a hardware-independent
frame-rate promise or a native Safari input trace.

Full live snapshots still support reconnect. Unchanged sections reuse their references;
geometry depends on topology and view parameters, not journal entries or verdict text.
Hidden tabs preserve mounted state but defer prop-driven rendering until selected.
Cards, node data and callbacks are memoized; evidence changes still update their readings.

Supporting **Taxonomy within** shows the two most frequent selected
roles and two facet tags, with explicit counts for the withheld remainder. Counts are
file/symbol assessment subjects, not coverage percentages or inferred component roles.
Only exact recorded owners contribute: a parent does not inherit a nested component's
roles. Stale, ambiguous and no-fit evidence remain explicit, and candidates are never
promoted to selected roles. Missing capture, damaged taxonomy and an unassessed component
have distinct messages. Select a component for the full role/facet/subject breakdown in
the inspector; this project-wide summary stays across all sessions, like Structure itself.
The existing live feed updates both cards and inspector when taxonomy changes.

Cards use larger rectangular dimensions and 24px default clearance. Cytoscape first
places concentric rings. One uniform radial scale then meets actual rectangular
clearance: each pair separates on either axis, and the most restrictive pair sets the
common scale. This retains library angles, relative ring radii and canonical membership,
without placement search or custom routing. Unit guards sweep exposed parameters and
dense rings, proving both clearance and tightness (one pair meets the requested gap).
Historical negative control: enlarging cards to 360×300 with the old max-dimension
footprint caused diagonal overlap at gap 48, rotation -35, sweep 200. Circumscribed
circles fixed overlap but reserved excessive space; exact rectangular clearance now
keeps the no-overlap guard without that whitespace penalty.

`snapshot` separately captures `public/scope-readings.json` from the canonical journal, defect, experiment and hook readers. `build --check` compares frozen inputs; it does not claim those inputs still match disk. Generated readings and HTML contain journal and customized hook content: review before publishing them.

For browser checks with installed Google Chrome:

```sh
SCOPE_BROWSER_CHANNEL=chrome npm run test:browser --prefix scripts/scope-preview
SCOPE_BROWSER_CHANNEL=chrome npm run test:live --prefix scripts/scope-preview
SCOPE_BROWSER_CHANNEL=chrome npm run test:taxonomy --prefix scripts/scope-preview
```

Alternatively, install Playwright's Chromium from this directory (`npx playwright install chromium`) and omit the channel variable. The browser check writes screenshots into an OS temporary directory and prints its location.

For the Safari-engine regression, install WebKit in this directory (`npx playwright install webkit`), then run:

```sh
SCOPE_BROWSER_ENGINE=webkit npm run test:browser --prefix scripts/scope-preview
SCOPE_BROWSER_ENGINE=webkit npm run test:live --prefix scripts/scope-preview
SCOPE_BROWSER_ENGINE=webkit npm run test:taxonomy --prefix scripts/scope-preview
SCOPE_BROWSER_ENGINE=webkit SCOPE_WITHHOLD_NODE_MEASUREMENTS=1 npm run test:browser --prefix scripts/scope-preview
```

The second run withholds node ResizeObserver observations at startup, then releases them after checking the initial view. Before explicit dimensions and handles, this produced four hidden nodes and zero edges while the rings rendered. It now checks both missing and late measurements, including explicit computed visibility rather than just DOM population. A native Safari rings-only field report prompted this regression; normal Playwright WebKit did not reproduce that user's exact trigger, so this establishes resilience to the identified startup dependency, not a proven diagnosis of the native session.

## What we own, and what we don't

| Responsibility | Owner |
| --- | --- |
| Components, reliance records, evidence, gravitational center and ring membership | Existing canonical Scope model |
| Angular placement and relative ring radii | Cytoscape's `concentric` layout |
| Uniform radial density and occupied bounds | Exact rectangular-clearance projection in `layout.mjs` |
| Pan, zoom, selection targets, connection paths, arrow markers and labels | React Flow |
| Accessible tab selection and keyboard navigation | Radix Tabs |
| Journal identity, resolution, defect/experiment records and hook composition | Existing canonical readers |
| Title bar, evidence inspector, which standard handles to use | Thin React/CSS presentation |
| Spacing, rotation and arc spread | Library parameters in `layout.mjs`, exposed as sliders |

The default layout is also computed in Node and embedded in the HTML, so it can be tested independently of the browser. Moving sliders recomputes a local view using the same engine; it never edits the snapshot. Reload restores defaults. Dependencies are exact-pinned with a lockfile, in an isolated private package. No CLI runtime dependency or root package manifest changed.

This replaces collision searches and custom curve routing with library calls. Changing the visual approach no longer requires rewriting those mechanisms. The tradeoff is an approximately 2.3 MiB self-contained HTML file on the PostHog snapshot (growing with journal history) and a frontend build step when regenerating it—not when viewing it.

Fixed card dimensions and standard handle coordinates are supplied through React Flow's documented node properties. Library Handle elements derive from those same coordinates for subsequent browser measurements; initial card/edge visibility does not depend on measuring them first.

## Evidence and limits

Automated checks cover canonical node/reliance parity, unchanged evidence, deterministic geometry under reordered input, equal radii within rings, zero-centered gravity, non-overlap, an empty graph, a singleton, cycles, and a 26-component fixture including an island. Forty-five combinations at the exposed parameter extremes are checked on the actual snapshot. Browser checks cover actual card bounds/title contrast, every center guarantee, both directions of reciprocal reliance, parameter controls, connection styles, zoom, pan, keyboard selection via the component list, mobile page overflow, and no second request.

The build can be byte-compared with `--check`. That proves repeatability with these pinned dependencies, not readability or identical pixels across browser versions. The adapter's initial id/method mixup was observed as a build failure; the real-snapshot test now exercises that crossing, including disconnected membership.

Built-in Bézier/step edges are not obstacle-avoiding routers. A denser graph or particular slider values can still produce crossing or obscured edges. Selection emphasis and the textual reliance inspector preserve inspectability, but this prototype does **not** establish production-quality routing at arbitrary scale. The dense fixture tests node layout, not edge readability. Small screens need zoom or the full-text inspector; the mobile check establishes containment, not that every label is readable at fit-all scale.

The old `coherence scope` output is not regenerated by this preview command. Rebuilding consumes whatever canonical snapshot is in `public/scope.json`. This package is outside the published CLI's `dist` surface and is not yet wired into `docs --check` or the harness spec tree. No agent delivery, editable annotations, catalog mechanism, or new verification authority is added here.

The optional server is read-only, bound to 127.0.0.1, with an unguessable capability path, exact Host/Origin checks, fixed routes, connection limits and no client-selected commands or arbitrary file routes. Canonical derivation reads configured project files and invokes fixed read-only Git queries; it does not run tests, hooks, measures or project adapters. Keep its URL private. Canonical journal identity handles compaction overlap; reconnect sends a fresh snapshot, not an assertion of exactly-once network delivery. Server and browser tests cover source/component/reliance additions and removals, status publication, canonical model parity, configuration/status damage and recovery, refused empty derivation and project adapters, stable connection identities, append, overlap, reconnect, pause/resume, retained viewport/inspection state, and rejected methods/origins/routes.

Session selection derives from durable ledger sessions, including taxonomy writers, not activity-only sessions. Hook observations refresh after activity, ledger, customization or installed-control metadata changes. Taxonomy's captured evidence files are watched for source/configuration/dependency changes so the local feed can show staleness without a new ledger entry. File metadata triggers re-reading; this is polling, not a guarantee to observe edits that restore identical metadata between polls. Damaged ledgers appear as unavailable. Hook text inspection captures templates, not dynamically emitted session context or exact-session work instructions. Defects remain agent-assessed records, with no invented repair state. The newer work and consequence ledgers do not yet have their own Scope views.

References: [Cytoscape concentric options](https://js.cytoscape.org/#layouts/concentric), [React Flow components](https://reactflow.dev/api-reference/react-flow), [React Flow layout boundary](https://reactflow.dev/learn/layouting/layouting).
