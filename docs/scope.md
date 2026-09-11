# Declarative Scope

Scope is a configurable reading surface over Coherence's asset catalog. The shipped
views and project views use the same configuration language and three renderers:
graphs, tables and cards. React and Radix own interaction, React Flow owns the canvas,
and Cytoscape owns layout. Projects do not need to edit or install the frontend.

```sh
coherence scope             # write <outputDir>/scope.json and _scope.html
coherence scope --check     # compare a fresh capture with both saved artifacts
coherence scope --serve     # print a live, read-only loopback URL
```

In this source checkout, run `npm run build` first and use `node src/cli.ts` in place
of `coherence`. Open `_scope.html` directly for an offline snapshot; it makes no
network requests. The same bundled viewer is used by the server and installed package.

## Customize a project

Place `coherence.scope.json` at the project root. Absence selects the shipped default.
Malformed configuration refuses with a field address; it never silently becomes defaults.
The browser's **Configure** editor previews configuration and downloads the file, plus
an inventory of available attribute paths and their observed value types. Previewing
does not write your repository. Local previews take precedence over incoming project
configuration until **Use project configuration** is selected.

This example keeps the defaults and adds two project views:

```json
{
  "version": 1,
  "extends": "default",
  "title": "Project scope",
  "initialView": "unanchored",
  "views": [
    {
      "id": "unanchored",
      "title": "Unanchored invariants",
      "renderer": "table",
      "kinds": ["invariant"],
      "where": [{ "field": "attributes.anchored", "op": "eq", "value": false }],
      "sort": [{ "field": "attributes.owner", "direction": "asc" }],
      "fields": [
        { "field": "attributes.owner", "label": "Component" },
        { "field": "attributes.refuted", "label": "Recorded negative control" }
      ],
      "pageSize": 50
    },
    {
      "id": "work-map",
      "title": "Work dependencies",
      "renderer": "graph",
      "kinds": ["work"],
      "fields": [
        { "field": "attributes.state", "label": "State" },
        { "field": "attributes.owner", "label": "Owner" },
        { "field": "attributes.opened.criteria", "label": "Success criteria" }
      ],
      "graph": {
        "relations": ["depends-on", "parent-work"],
        "layout": "breadthfirst",
        "width": 360,
        "height": 240,
        "gap": 48
      }
    }
  ]
}
```

`extends` defaults to `"default"`. A view with a default's ID replaces that entire
view in place; a new ID appends a view. There is no implicit deep merge. `removeViews`
is an array of default IDs to omit. Set `extends: false` to author the entire view
list and its order. `initialView` must name a remaining view. The downloaded browser
configuration uses `extends: false` so it reproduces the preview exactly.

The defaults are `structure`, `guarantees`, `specs`, `work`, `journal`, `taxonomy`,
`evidence`, `hooks`, and `assets`. They are inspectable in
[`DEFAULT_SCOPE`](../src/readings/scope/configuration.ts).

## View vocabulary

| Property | Meaning |
| --- | --- |
| `id`, `title`, `description` | Stable view slug, tab label, optional explanation |
| `renderer` | `graph`, `table`, or `cards` |
| `kinds` | Asset kinds below; `["*"]` selects every kind |
| `where` | All listed filters must match |
| `sort` | Ordered fields with `asc`/`desc`; asset ID breaks ties |
| `fields` | Displayed attribute paths, optional labels and formats |
| `groupBy` | Attribute path used to group a cards view |
| `pageSize` | 1–500 assets, default 50; omitted populations are displayed |
| `graph.relations` | Explicit relationship kinds to display; `["*"]` selects all |
| `graph.layout` | Cytoscape `concentric`, `grid`, `breadthfirst`, or `circle` |
| `graph.weight` | Numeric attribute used by concentric layout; default `attributes.mass.total` |
| `graph.width`, `height`, `gap` | Card geometry; rectangular clearance is enforced |
| `graph.edgeLabel` | Optional relation attribute path; defaults to relation kind |

Fields address `id`, `kind`, `label`, `source`, or nested `attributes.path`. Relation
labels may also address `target`. Optional field formats are `text`, `json`, and
`count` (array/string length or object key count). Absent values display `—`.
The schema inventory lists observed fields; an empty asset family has no observed
attributes. Attribute paths are data lookups, not JavaScript expressions.

Filters support `eq`, `ne`, `in`, `contains`, `exists`, `gt`, `gte`, `lt`, and `lte`.
Numeric comparisons require numbers; `in` takes an array; `contains` takes text;
`exists` defaults to true and treats null as absent. Search examines all attributes,
including fields not selected for display. Unknown configuration keys, asset kinds,
renderers, filter operators, formats and layouts refuse. Missing attribute values do
not become zero or a passing verdict. No executable callbacks, HTML templates, module
imports or arbitrary expressions are accepted.

## Asset inventory

Each asset has `{ id, kind, label, source, attributes }`. Original domain IDs remain
in attributes. Scope namespaces presentation IDs, and explicit relationships refer
to those addresses. Every record retains its canonical reader's evidence grade.

| Kinds | Source and attributes |
| --- | --- |
| `project`, `component`, `file`, `symbol`, `resource` | Canonical source graph, ownership, paths, source docs, imports, platform bindings; components also expose promise mass and per-guarantee readings |
| `spec` | Entire original spec text and every canonical parsed field, path and owner |
| `spec-section` | Every authored heading and section body, including custom/duplicate headings and malformed declarations, with line and heading level |
| `description`, `rationale` | Parsed intent/prose and `why`, separately selectable by owner |
| `claim` | Every parsed `works when` claim, owner, and optional declared claim kind |
| `invariant` | Each named invariant, matching boundary claims, anchored state and recorded-refutation presence |
| `refutation` | Each authored negative control and its canonical invariant-name association |
| `zone` | Spec-declared zones, order, nesting and whether the entry spec gives them topology authority |
| `chart`, `transition` | Authored atlas charts and transitions; these are distinct from trust zones |
| `guarantee`, `reliance` | Canonical promise guarantees and component dependencies; oracle, grade, recorded verdict, crossing and owner |
| `guarantee-link`, `obligation`, `binding` | Spec-owned link integrity, taxonomy applicability/mapping, binding parameters and recorded oracle observations |
| `guarantee-definition` | Candidate guarantee catalog, provenance and explicit portability limits |
| `taxonomy-role`, `taxonomy-facet`, `taxonomy-question`, `taxonomy-suggestion` | Full declarative taxonomy vocabulary |
| `assessment` | Assessment history, current classifications, original inputs/evidence, predecessor and staleness |
| `decision` | Every journal kind and canonical resolution state; repeated decisions retain all occurrences; session-opening envelopes remain distinct |
| `defect` | Canonical assessed failure records, evidence and affected paths |
| `experiment`, `experiment-event` | Resolved experiments and raw opening/closing records, actions, criteria, results and evidence |
| `work`, `work-event` | Current work and complete lifecycle records, authority, owner, dependencies, scopes, readiness and synthesis |
| `consequence`, `reference` | Explicit assessed consequence records and unresolved referenced addresses; a reference is not proof of existence |
| `verification`, `verification-start`, `claim-result` | Completed receipt evidence, full incomplete run starts and rolling per-claim verdicts |
| `session`, `hook`, `control`, `observation`, `activity`, `read` | Sessions, static hook composition, installed host controls, observed activation, tool activity and file read/write traces with original attribution |
| `instrument`, `baseline`, `calibration` | Persisted verification/atlas/drift/mass/economy readings; mass/sinks/conventions baselines; calibration samples |
| `word`, `doctrine`, `configuration`, `source` | Dictionary definitions, coordination doctrine, Coherence/Scope settings, and source availability independent of filters |

There are 50 declared kinds, including kinds with zero instances in a given project.
The live registry is [`ASSET_KINDS`](../src/readings/scope/catalog.ts); adapters live
in [`captureScope`](../src/readings/scope/capture.ts). New canonical asset families
must be added there, documented here, and exercised through the generic projection
tests. They do not require new React components.

### Spec content coverage

The specification's title and complete text live on `spec`; its intent and prose on
`description`; `## why` on `rationale`; `## works when` on `claim`; `## invariants` on
`invariant`; `## refutations` on `refutation`; and `## zones` on `zone`. `## addresses`,
`## relies on`, and `## guarantee bindings` retain raw declarations on the spec and
their canonical interpretations as guarantee-link/binding assets. All sections also
have raw `spec-section` assets. A heading inside a fenced code block does not create a
section. Custom sections are navigable text and acquire no execution semantics.

The guard uses a spec with all supported sections, claim-kind annotations, a custom
section, a nested heading, a fenced pseudo-heading and malformed declaration text.
It compares exact source text and canonical meanings, including unanchored invariants
and zone authority. Coverage is over the canonical spec population selected by the
source walker, not ignored files elsewhere in the repository.

## Relationships and evidence

The inspector shows complete attributes and inbound/outbound explicit relationships.
These include `contains`, graph edge kinds, `declares`, `defines`, `anchors`, `refutes`,
`reliance`, `evidence-import`, `relies`, `references`, `addresses`, `binds`, `assesses`,
journal terminal relations, `parent-work`, `depends-on`, canonical consequence verbs,
`bound-to`, `recorded-by`, `observes`, `observed-session`, `work-history`,
`experiment-history`, `binding-subject`, `binding-flow`, `translates`, and `zone-inside`.
Receipt/work binding does not manufacture an
assessor's `verifies` edge. Shared times or paths do not create causal connections.

A failed source loses its entire partial asset contribution and reports unavailable.
Other sources remain inspectable, and the unavailable banner cannot be hidden by a
view filter. Empty and unavailable are different readings. Missing reference targets
remain explicitly unresolved. Scope never grades whole-component health from a nearby
passing test or a set of empty guarantees.

## Live behavior and limits

The loopback server uses an unguessable path, checks Host/Origin, accepts only GET, and
serves complete replacement snapshots over SSE. It polls input metadata every 750 ms
while a viewer is connected. Reads serialize and a changing input population causes
retry rather than publishing a mixed capture. This is not a transactional filesystem
snapshot or a promise to show every intermediate edit. Invalid configuration retains
the previous snapshot with an unavailable message and recovers after repair.

Watching never executes tests or hooks or writes artifacts. Built-in language adapters
are supported live; project-supplied executable language adapters are refused. Source,
spec, configuration, ledger, control and diagnostic-baseline changes trigger captures.
Pause holds incoming data until resume. Graph camera positions survive tab switches
and evidence-only updates; explicit **Fit displayed assets** fits the current page.

Full raw values remain in the inspector even when cards or tables show excerpts.
Pagination limits layout and DOM size and reports withheld assets/connections. It does
not reduce the embedded catalog. Offline artifacts contain journal text, customized
hooks and other local evidence; view configuration is presentation, not redaction or
an access-control boundary. Retaining all evidence can produce large snapshots.

Commits currently appear as explicit reference addresses, not an exhaustive Git history
catalog. Instrument results are existing persisted readings; opening Scope does not
run every diagnostic. Baseline values and some evidence subrecords remain nested
attributes. This asset model does not turn transient tool activity into authenticated
agent action, caller-assessed taxonomy into proof, or local receipts into trusted execution.

## Checks

```sh
npm run build
node --test test/scope-configuration.test.ts test/scope-capture.test.ts test/render-scope.test.ts
node scripts/scope-browser-check.mjs
SCOPE_BROWSER_ENGINE=webkit node scripts/scope-browser-check.mjs
```

Browser checks exercise every default view, custom JSON without frontend changes,
inspector text, all four layouts, offline network silence, live config/source updates,
pause/resume, malformed-config recovery, HTTP boundaries and mobile overflow. They
require the corresponding Playwright browser installation, or an installed Chrome
selected with `SCOPE_BROWSER_CHANNEL=chrome`.
