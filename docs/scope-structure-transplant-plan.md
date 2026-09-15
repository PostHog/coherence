# Structure transplant and project extension contract

## Outcome

The normal `coherence scope` path must render the approved downtown/periphery
Structure design. A project can inherit the default while replacing presentation
policy, individual mechanisms, or the whole Structure view. The standalone study
must no longer be the only way to obtain the useful design.

## Frozen interfaces

- Authored specs and the canonical catalog/model retain component, guarantee and
  relationship identities, rationale, source availability and evidence grades.
  Presentation implementations do not establish new guarantees or verdicts.
- Scope configuration remains version 1 data. Add `extensions: ["./module.jsx"]`
  at its root. Each project module exports a default object with `apiVersion: 1`
  and optional named `rankers`, `layouts`, `routers`, `cards`, `views` maps.
- Structure options select implementations with
  `implementations: {rank, layout, route, card, view}`; omitted names mean `default`.
  Registry names are nonempty namespaced identifiers; project registrations cannot
  overwrite `default` or each other. Unknown names, incompatible API versions and
  invalid outputs fail visibly, never silently fall back.
- Mechanisms receive one context object: rank `{model, options, defaults}`;
  layout `{model, ranked, options, defaults}`; route
  `{cards, relationships, annotations, fixedLabels, options, defaults}`.
  `defaults.rank(context)`, `defaults.layout(context)` and `defaults.route(context)`
  invoke the shipped implementation directly, enabling inheritance without recursion.
- Card and view registrations are React components. Card props include `card`,
  `options`, interaction callbacks and `DefaultCard`; view props include `catalog`,
  `view`, `onSelect`, `DefaultView`. Document the exact shipped props. The built-in
  card shell owns world geometry and stable identity; card customization changes
  content within that shell. A whole-view replacement owns its own presentation.
- `window.__SCOPE_EXTENSIONS__` contains the bundled registration objects. The
  browser uses one React runtime, including project JSX and hooks. Project modules
  are bundled at HTML generation, with all code/assets needed for offline viewing;
  there are no runtime CDN imports. Projects without extensions use the ordinary
  prebuilt client and do not pay a dynamic bundling cost.
- Options cover ranking weights, downtown threshold and count, spacing, short
  terminal names, card content fields, promise preview count, initial relationship
  layer and content-only zoom thresholds. Validate known options and their ranges.
  Extension-specific options live in a separate JSON `extensionOptions` object.
  Removed grid-era options must either have a documented mapping or refuse clearly.

## Transfer fidelity

Transfer `scripts/structure-blockout` into production modules, rather than
recreating its design from prose. Preserve: project frame instead of root stack;
source-backed entrances with external arrows; density-based downtown; meaningful
handoffs and guarantee reliances; fixed terminal attachment; independent separate
promise cards; stable world rectangles and external paths through unfurl/fold;
content-only zoom; explicit local framing; selection sidebar and explicit connection
focus; source/relationship issues that remain visible.

Default registrations must exercise these same interfaces. Browser state is scoped
to the snapshot and configured view, survives tab switches, and does not leak into
another project. Unresolved endpoints and empty/single-component projects remain
inspectable rather than crashing the page. Preserve the exact small-project layout;
replace factorial enumeration for larger populations with a deterministic bounded
heuristic, exercised on actual synthetic populations (24 and 64 components).

## Work allocation

1. Sol renderer owns production Structure UI, CSS, ranking/placement/routing modules
   and browser registry/guards. It transplants the study and uses the frozen context
   interfaces. It does not edit configuration, capture or bundling host code.
2. Sol extensions owns option types, configuration validation, project module
   bundling/loading, package build support, focused host/configuration tests and
   package dependencies if required. It coordinates exact interfaces with renderer.
3. Sol acceptance owns an installed-consumer/normal-Scope browser acceptance script
   and a small project extension fixture. It checks the actual generated tab, not
   only the standalone artifact or implementation-shaped unit tests.
4. Main owns integration, documentation, lifecycle-contract review, real-project
   generation, screenshot review and final verification. Main resolves overlaps;
   agents do not commit, push, regenerate shared artifacts or run shared builds
   without coordination.

## Acceptance gates

- Normal generated Scope shows the approved Coherence and Mnemion stories. Inspect
  screenshots of opening, full handoffs, selected component and local promises.
- Actual DOM/SVG checks preserve world rectangles, external path population,
  selection and camera through disclosure; zoom does not replace card shapes;
  routes avoid unrelated cards and labels; a card-body click opens inspection.
- The default and an override use the same registry. A project fixture wraps the
  default card and changes rank/layout policy without editing Coherence. Assert
  the resulting visible card content and world positions, stable subject identities,
  a second configured view, and hook execution on the shared React runtime.
- Unknown registrations, duplicate names, wrong API versions, malformed output,
  missing module and module errors produce actionable errors. No silent default.
- Packed installation can generate both default and extended Scope without a
  source checkout; generated pages work offline. Existing table/cards/graph views
  and canonical semantic tests still pass. Retain the hub detour negative control.

## Scope and limits

This increment delivers current-state Structure and customization. Comparison
ghosts/stable cross-snapshot layout, agent MCP control, and automatic spec-authoring
remain future work. More components do not imply an assertion of universal layout
quality. Measured evidence gaps remain gaps, including Mnemion browser guarantees.
