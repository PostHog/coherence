# Mnemion browser coverage study

The Structure capture now includes the human browser workspace alongside the MCP and HTTP entrances. This is spec authoring in the detached study checkout, not a change to Mnemion's runtime or its original checkout.

## Changes

- `mnemion-js/web/Browser.spec.md` adds one Browser workspace component, the human entrance at `web/src/main.tsx`, a Browser → Routing handoff named “Browses and edits memory”, and a Core → Browser relationship named “Defines browser renderers' vocabulary”. Seven runtime modules share one browser responsibility; individual views, charts, blocks and the store are local details.
- `mnemion-js/Mnemion.spec.md` extends the existing draft purpose to include the human workspace and clarifies the HTTP entrance label as “An HTTP client accesses memory”. Its existing seven relationships and MCP entrance remain. New browser declarations live with their component.
- `mnemion-js/coherence.config.json` adds `web` to `sources` and `tsx` to `codeExt`. The seven browser source files now belong to Browser workspace in the canonical graph. This also expands the declared input of source-based instruments; it does not change the configured test or typecheck commands. Existing ignored `pages`, `__tests__`, generated and dependency directories remain ignored.
- Existing Session and Routing guarantee-reliance additions are preserved. No new named guarantees, security transitions, or relies-on assertions were added.

## Source support

| Story | Inspected source |
| --- | --- |
| A person opens the workspace | `web/index.html` loads `web/src/main.tsx`; main mounts App. `src/index.ts` serves the ASSETS SPA fallback for browser routes; `web/src/App.tsx` loads `/api/index` and redirects a redirected/401 index response to `/login`. |
| Browser and agents share memory through distinct access surfaces | `web/src/App.tsx` queries `/api/index` and `/api/query/:pattern`; `web/src/views.tsx` and `FacetValue.tsx` post `/api/mutate/:pattern`. `src/index.ts` binds those endpoints to `Auth.SESSION`; `shared/Routing/routes/pages.ts` calls Hive. |
| The workspace reflects live agent changes | `web/src/App.tsx` opens `/ws`, refreshes index declarations for `_schema`, `_views`, and `_pages`, and passes entry deltas to `web/src/store.ts`. `src/index.ts` declares the socket route with session auth. This describes observed implementation, not guaranteed recovery or synchronization. |
| Core gives both runtimes a common UI vocabulary | `web/src/views.tsx` imports `ViewTypeId`, `resolveFormat`, `resolveChart`, and `chartQuery`; `FacetValue.tsx` imports format declarations; `Chart.tsx` imports the chart specification. `shared/core/Core.spec.md` and the inspected palette code describe the corresponding worker validators. |

`CLAUDE.md`, the worker README, browser modules, Routing handlers, Core spec, and existing route/view/format/chart tests informed the boundary. The project documentation calls the React application the web app proper. A separate spec for each renderer would add ownership distinctions the code does not enforce.

## Validation

Canonical capture through the local Coherence `loadConfig`, `captureScope`, and `buildStructureModel` passed assertions for:

- 9 components including the project frame, hence 8 component stacks (previously 8 components / 7 stacks).
- 7 captured browser source files owned by `component:web`.
- 3 valid entrances: MCP, HTTP, and the human browser workspace (previously 2).
- 9 architectural relationships and 2 explicit guarantee-reliance relationships (previously 7 + 2).
- The Browser → Routing and Core → Browser relationships are present with their authored labels and rationale.
- 16 unchanged named invariants/guarantees and 11 unchanged security transitions; Browser owns zero named guarantees.
- No Structure issues, entrance address problems, or unavailable catalog sources.

From `mnemion-js`, `node /Users/daniloc/Documents/Dev/coherence-scope-local/src/cli.ts guarantees --check` exits successfully: both existing reliance links resolve to their Hive providers. Link integrity is not satisfaction. The captured oracle verdicts remain unknown; no existing test was rerun or relabeled as passing by this authoring pass.

An initial ad hoc assertion incorrectly read `entrance.component` rather than the catalog asset's `entrance.attributes.component`. Inspecting the capture showed the valid entrance; the corrected assertion passed. This was a check-shape error, not missing model coverage.

## Evidence limits and next authoring opportunities

The browser currently has no inspected behavioral oracle suitable for a named guarantee. `src/__tests__/routes.test.ts` tests shell delivery and backend fallback boundaries. View, format, page, and chart tests exercise shared validation and/or Hive behavior; they do not mount the React application or verify its interactions. The typed `Record<ViewTypeId, …>` and `Record<FormatId, …>` renderer tables express intended coverage, but the checked-in `tsconfig.json` excludes `web`, and the current `npm run typecheck` commands do not add a browser check. The spec therefore does not promote those types or backend tests into browser guarantees.

Potential future oracles include supported-renderer coverage under a browser typecheck, reconnect catch-up, optimistic-edit failure reconciliation, and whether each page block refreshes on live changes. Those require implementation/test work outside this spec-only assignment. For example, `PageView` metric blocks fetch on pattern/metric/aggregate changes; that is not evidence they refresh for every row delta.

The current single relationship from Browser to Routing includes HTTP requests and the live socket response in its rationale. It describes an access responsibility, not one-way network packet flow. Separate response-direction wiring would need a deliberate story requirement rather than an inferred import edge.

The browser is now legible as an architectural participant. This does not certify full project coverage: embedded MCP rendering and served publications remain explained by existing owners, and the documented iOS peer is future work rather than a fabricated component. The renderer's visual quality and routing acceptance belong to the parent integration pass.
