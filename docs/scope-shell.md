# The Scope shell

Scope is the reading: one surface that projects the model for a human, in
views. Six views ship: Glossary, Components, Structure, Invariants, Runs, and
Journal.

## Structure

The shell is a function of one state value. `src/readings/scope/model.ts`
holds the model: a glossary (concepts, metaphors, and, per project, rejected
names, trust levels, rulings, candidate overloads, uncertain terms), a layer
(a glossary present, or an absence with its reason), the spec model as
`loadSpecModel` returns it (components with their entrances, invariants with
their lifecycle state, counts, and the adapter's grade ladder), the run
records, the journal records with the work orders (folded by the journal's
own loader from their records, so each carries its current state) when
`.coherence/work` exists, the component interfaces as the language adapter
read them, and per view the reader's query, filters, and selection.

`build.ts` loads those truths once and embeds the state as JSON in
`public/_scope.html` with the styles and one inline script. Same inputs in,
byte-identical page out. With `--root <project>` it builds over another
project: that root's specs, runs, journal, and glossary (named under
`glossary` in `coherence.config.json`, else `glossary.json`) become the
domain layer beneath Coherence's own.

The page embeds a bounded window of the two stores that grow every session:
the latest run records plus every run holding some enforcement's latest
entry, and the latest journal records plus every open escalation and what
those records point at. Every verdict derived from the window equals the one
derived from every record, and the count left out is shown; the whole journal
is one `journal` command away. The agent query builds without the window.

In the browser, `page.ts` renders the embedded state with `renderShell`, a
pure function from state to markup. Every reader change is a state change
followed by a render; nothing shown is stored. The latest verdict per
enforcement, the kept-from-an-earlier-run marks, reliance, open escalations,
the Structure map, and every count are derived on each render, never
embedded.

## The views

**Components** is the tree with intent, counts per lifecycle state, and a
mass line reserved for the economy's measurement (`mass: not measured` until
it exists). Selecting a component shows its invariants.

**Structure** is one map of what the system is made of and how work flows
through it, drawn the way transit maps and process drawings are: journeys,
not connections. `flowOf` in `structure-flow.ts` is the one pure
derivation, read by the SVG in `structure-flow-view.ts` and by
`query structure`; `structure-measure.ts` reads the rendered SVG back.

- Evidence. The map states what it stands on: static and computed, resolved
  references through the language adapter, declared entrances, and
  invariants. Observed runtime behavior is not shown (the observation seam,
  `observedEvidence` in `src/observation/record.ts`, is not drawn yet). When
  the page was built without the adapter (a test, a scaffold preview,
  `--no-interfaces`), only the references the latest runs recorded to
  chokepoints and protected things are known, and the map says plain
  component interfaces are unknown.
- Component interfaces. `component-interfaces.ts` resolves every exported
  top-level declaration of every non-test source file and asks the adapter
  for its references; each non-test site in another component adds that
  symbol to the component interface from the caller to the callee. Every
  component interface is on the map, caller to callee, and none is implied
  away: along a structural route, as a stub to a core dependency, at rest
  when a chokepoint, a crossing or a bypass stands on it (a thin grey line,
  dashed red when broken), and otherwise drawn faint, dashed, when a
  selection reaches it.
- Structural routes. Each entrance's route is the component that declares
  it, the component holding its handler, then from each stop the heaviest
  component interface (most reference sites, ties by folder) to a component
  not yet on it and not a core dependency. Entrances whose routes are the
  same stops share one line. A route is one path of its own color (the
  validated eight-color order, then neutral) from a lettered terminus in the
  left margin through the centre of each station in order; routes through
  one component meet at its station, and parallel routes run side by side
  at a fixed six-pixel offset, never merged. Every segment is horizontal,
  vertical, or at 45 degrees: a line leaves a station by a port, turns in a
  lane of the column's turning gap (lanes ordered so parallel runs do not
  cross), and runs along its callee's row, where no other station stands. A
  project that declares no entrance (the first adopter) has its routes
  derived from the root component's interfaces, one per callee, and the
  canvas says so.
- Core dependencies. A component called by more than half of the other
  visible components, by at least three, with at least three quarters of its
  component interfaces incoming (`CORE_RULE`), is a rail along the foot of
  the map, labelled once. Each caller carries a short stub in the rail's
  color under its station; no line or arrow reaches the rail and no route
  runs through it.
- Interface identifiers. Each chokepoint gets a short identifier from its
  place in the chokepoint list, `C3` for a chokepoint and `X7` for one whose
  invariant carries a crossing, drawn as a tag on each component interface it
  stands on; a crossing draws a dashed red trust boundary across the pipe
  through its tag. A bypass adds `✕n` to the tag. The meaning is in the
  inspector and the text form. What an interface reveals comes from the
  invariants, never authored: the chokepoint that stands on it, that
  invariant's crossing, and the classes of data that pass; the inspector's
  label reads them in that order, else its most-referenced symbols; never a
  verb.
- Text. Every piece of canvas text has a priority (station names, rail
  labels, the caption, route letters, identifiers, defect marks, proposals,
  column captions) and is placed at its first candidate that overlaps no
  placed text and no station, preferring places no line runs through; lower
  priority text is dropped, never overlapped, never truncated. The dropped
  keys are on the SVG's `data-dropped`. `measureSvg` computes text boxes from
  Helvetica metrics it embeds (the canvas is set in Helvetica) and counts
  overlaps, truncation, clipping, off-angle segments and crossings.
- Entrances. Each is declared in a spec's `## entrances` (see
  `docs/spec.md`) and resolved again through the adapter; its route starts at
  the declaring component, and a dispatcher's entrance is unreachable unless
  the component interface from the declaring component carries the handler.
- Stability. Positions are never stored, and each station's seat is placed
  by its own facts alone: its row is its place in folder order among the
  visible components, and its column its distance from where work enters,
  read from its own callers and capped at two (0 declares an entrance, or is
  the root when none is declared, or nothing calls it; 1 an entrance's
  component calls it; 2 otherwise). Adding one component interface moves at
  most the components it touches. True distance would move every component
  downstream of the new interface's callee, so the map keeps stability over
  route straightness and straightens routes by routing instead (journal
  d-1f1ce391). A core dependency's row stays empty; its rail is at the foot.
- Zoom. One level of the component tree at a time: the top level is open,
  and a component with children opens in place (its station stays for its
  own code). A closed component carries its children's interfaces at its
  edge. Source in no component's folder is its own labelled mass.
- One map. Selection is state (`state.structure.selected`, an id prefixed
  `structure--`) and lights one story while everything else dims: an
  entrance or a route lights that route; a trust level lights the
  identifiers whose crossings carry that class of data (the security spine)
  and the interfaces they stand on; a chokepoint lights every interface it
  stands on and lists its reliance, the classified reference sites of the
  latest run, owner first (a protected bypass is never a legal chokepoint
  reference, and an absent `sites` field is incomplete evidence, never
  zero); a component lights its direct component interfaces and keeps the
  routes through it, never everything it reaches; an interface lights
  itself. The change selection is the diff's place: `compareFlows(before,
  after)` already measures entrance added or removed, interface added,
  removed, or widened, a chokepoint gaining a bypass, a crossing added or
  removed, and a data path gaining a branch; comparing with the previous
  commit, or one the agent names, is the next slice. The page writes the
  selection to the hash, and `followHash` reads it back.

**Invariants** shows every bullet: state, enforcement form with its latest
verdict, the chokepoint grade with the rung's enforcer, crossing over the
declared trust levels, because, refutation (witnessed, automatic from the
run, or missing), checklist, and what it lacks. A structural defect shows
its bypass sites and the two honest options: route through the chokepoint,
or escalate a retirement. Filters by state and component.

**Runs** lists the records latest first with session, agent, commit, dirty
flag, and counts; the verdicts one click away; on the latest, what the status
view keeps from earlier runs.

**Journal** is the merged timeline with kind glyphs, escalations awaiting a
human pinned at the top, a decision's rejected alternatives in the open, and
work orders when present, each the fold of its records (content, owner,
current state, history), never a state-change record shown as an order.
Filters by kind, agent, and session.

## Deep links

Every card or map id carries its view as a prefix (`component-`,
`structure-`, `invariant-`, `run-`, `journal-`, `work-`, and the glossary's
`coherence-` and `domain-`). A hash resolves to its view by that prefix, or
names a view alone (`#runs`). Links into the retired Reliance view
(`#reliance-…`) and the retired security-spine section (`#structure-<component>-<invariant>`)
land on the map's chokepoint selection, or on the trust level a crossing
leaves when there is no chokepoint. `resolveHash` in `derive.ts` is the one
place this is decided.

## The agent query

`node src/cli.ts query <question> [args]` answers a fixed set of questions
from the same state through `buildScopePage`: `invariants <path...>`,
`relies-on <chokepoint>`, `spine`, `structure`, `status`, `component <folder>`, `order`; and
`economy <path...>`, the economy prediction (what must be loaded to change
these files safely), which goes to the economy's own closure through the
warm instrument rather than to the page state. Plain text, a few hundred
tokens at most, no query language.

`query structure` reads the component interfaces through the language
adapter and formats `flowOf`: the structural routes with their stops in
order, the core dependencies with the rule and their callers, the interface
identifiers with the interfaces they stand on, every interface with its
label and where it is drawn, the entrances with where each starts or why it
is unreachable, and each component's row and column.
`query spine` lists the trust levels and every crossing-bearing invariant
from `structureOf`.

## Ephemeral Structure previews

`writeStructurePreview(root, preview, outPath)` in `build.ts` is the scaffold
bridge. `StructurePreview` is exported from `derive.ts` and carries only a
component, invariant name, crossing endpoints, and optional
chokepoint/protected-thing pairs. The bridge validates the component,
duplicate name, and crossing trust levels, selects Structure initially, and
writes a deterministic page with the proposal drawn dashed on its component,
unverified. It refuses an output path inside the project root so the
generated artifact cannot change the glossary or spec population between
otherwise identical previews. It changes no spec or run store, and the caller
cannot supply a grade, verdict, bypass count, lifecycle state, or reliance
evidence.

## Adding a view

1. Give the view a state type in `model.ts` and a field on `ShellState`.
2. Populate it in `loadState` in `build.ts`.
3. Write a pure render pair (tools and results) beside `glossary-view.ts`,
   with card ids under a new prefix registered in `resolveHash`.
4. List it in `VIEWS` in `shell.ts` and add its cases to `renderViewTools`
   and `renderViewResults`; add the file to `BROWSER_SOURCES` in order.
5. Top-level names are one name space across the browser sources; the
   builder refuses a duplicate by name.
6. Add what it must show to `check.test.ts`.
