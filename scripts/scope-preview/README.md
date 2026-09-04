# Scope library comparison — Codex's take

Open [the generated preview](../../public/_scope-library.html) directly in a browser. No server or second request is needed. This is a comparison, not the replacement for `coherence scope`; the previous renderer and its interrupted ring edits are untouched.

The snapshot is `public/scope.json`: four components, four directed reliances, and 43 guarantees when this comparison was first built. It is not live verification. Status, canonical center, ring membership, identities, and evidence come from that snapshot. Previous hand-written x/y positions are ignored.

## Run

```sh
npm ci --prefix scripts/scope-preview
npm run snapshot --prefix scripts/scope-preview
npm run build --prefix scripts/scope-preview
npm test --prefix scripts/scope-preview
npm run build --prefix scripts/scope-preview -- --check
```

For live journal updates, run `npm run serve --prefix scripts/scope-preview` and open the printed loopback URL. The standalone HTML remains an offline snapshot. Live mode polls the canonical ledgers every 750 ms, sends replacement readings over SSE, and reconnects with current state. Pause holds incoming updates until resumed; session filters, search and selected records survive updates. Structure remains the frozen `scope.json`, not live verification.

The three tabs are Structure, Hooks and Journal. Hooks distinguishes installed control from observed session activation and shows canonical/customized event text without executing a hook. Journal exposes decisions, defects and experiments, with full-record search, pagination and outstanding-state filtering. Resolution is computed over the complete canonical journal before filtering by session. Taxonomic classifications and annotation writes are not implemented.

`snapshot` separately captures `public/scope-readings.json` from the canonical journal, defect, experiment and hook readers. `build --check` compares frozen inputs; it does not claim those inputs still match disk. Generated readings and HTML contain journal and customized hook content: review before publishing them.

For browser checks with installed Google Chrome:

```sh
SCOPE_BROWSER_CHANNEL=chrome npm run test:browser --prefix scripts/scope-preview
SCOPE_BROWSER_CHANNEL=chrome npm run test:live --prefix scripts/scope-preview
```

Alternatively, install Playwright's Chromium from this directory (`npx playwright install chromium`) and omit the channel variable. The browser check writes screenshots into an OS temporary directory and prints its location.

For the Safari-engine regression, install WebKit in this directory (`npx playwright install webkit`), then run:

```sh
SCOPE_BROWSER_ENGINE=webkit npm run test:browser --prefix scripts/scope-preview
SCOPE_BROWSER_ENGINE=webkit npm run test:live --prefix scripts/scope-preview
SCOPE_BROWSER_ENGINE=webkit SCOPE_WITHHOLD_NODE_MEASUREMENTS=1 npm run test:browser --prefix scripts/scope-preview
```

The second run withholds node ResizeObserver observations at startup, then releases them after checking the initial view. Before explicit dimensions and handles, this produced four hidden nodes and zero edges while the rings rendered. It now checks both missing and late measurements, including explicit computed visibility rather than just DOM population. A native Safari rings-only field report prompted this regression; normal Playwright WebKit did not reproduce that user's exact trigger, so this establishes resilience to the identified startup dependency, not a proven diagnosis of the native session.

## What we own, and what we don't

| Responsibility | Owner |
| --- | --- |
| Components, reliance records, evidence, gravitational center and ring membership | Existing canonical Scope model |
| Ring placement and node separation | Cytoscape's `concentric` layout |
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

The optional server is read-only, bound to 127.0.0.1, with an unguessable capability path, exact Host/Origin checks, fixed routes, connection limits and no command execution or arbitrary file access. Keep its URL private. Canonical journal identity handles compaction overlap; reconnect sends a fresh snapshot, not an assertion of exactly-once network delivery. Server and browser tests cover append, overlap, reconnect, pause/resume, retained inspection state, and rejected methods/origins/routes.

Session selection derives from durable ledger sessions, not activity-only sessions. Hook observations refresh alongside ledger or customization changes, not on every activity event. Damaged ledgers appear as unavailable. Hook text inspection captures templates, not dynamically emitted session context or exact-session work instructions. Defects remain agent-assessed records, with no invented repair state. The newer work and consequence ledgers do not yet have their own Scope views.

References: [Cytoscape concentric options](https://js.cytoscape.org/#layouts/concentric), [React Flow components](https://reactflow.dev/api-reference/react-flow), [React Flow layout boundary](https://reactflow.dev/learn/layouting/layouting).
