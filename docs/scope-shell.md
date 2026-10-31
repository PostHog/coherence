# The Scope shell

Scope is the reading: one surface that projects the model for a human, in
views. Eight views ship, in the order the strip shows them: Structure,
Connections, Lexicon, Components, Invariants, Practices, Runs, and Journal.
A page whose address names no view opens on Structure.

## Structure

The shell is a function of one state value. `src/readings/scope/model.ts`
holds the model: a lexicon (concepts, metaphors, and, per project, rejected
names, trust levels, rulings, candidate overloads, uncertain terms), a layer
(a lexicon present, or an absence with its reason), the spec model as
`loadSpecModel` returns it (components with their entrances, invariants with
their lifecycle state, counts, and the adapter's grade ladder), the run
records, the journal records with the work orders (folded by the journal's
own loader from their records, so each carries its current state) when
`.coherence/work` exists, the component interfaces as the language adapter
read them, the relief reading (`src/readings/relief/relief.ts`), and per view
the reader's query, filters, and selection.

`build.ts` loads those truths once and embeds the state as JSON in
`.coherence/scope/_scope.html` with the styles and one inline script: the
esbuild bundle of `page.ts` and every module it imports, packages included
(three.js draws the relief), made by `bundleBrowserScript` in a checkout
and shipped prebuilt as `page.bundle.js` in the published package. No list
names the browser sources, so none can be left out. Same inputs in,
byte-identical page out. With `--root <project>` it builds over another
project: that root's specs, runs, journal, and lexicon (named under
`lexicon` in `coherence.config.json`, else `lexicon.json`) become the
domain layer beneath Coherence's own.

The page embeds a bounded window of the two stores that grow every session:
the latest run records plus every run holding some enforcement's latest
entry, and the latest journal records plus every open escalation, every
open defect, the resolution and the retraction of each record kept, and what
those records point at. Every verdict derived from the window equals the one
derived from every record, and the count left out is shown; the whole journal
is one `journal` command away. The reference sites the latest chokepoint
entries carry share one window of 500 (`SITE_WINDOW`), bypass sites always
listed; each entry counts the rest by component, endpoint, class and test
mark, so every count the views and `query structure` derive from sites is exact, and
the reliance listing on a chokepoint invariant's card in **Invariants** says
how many there are and how many it lists. Its "Load the other N" button
fetches the rest of that entry's sites from `/api/sites` on a live page; a
snapshot names `query relies-on` instead. So neither the code
nor the number of chokepoints grows the page. The relief's files are left
out the same way: the first load counts each component's files, and the
page loads them by folder when it needs them. The agent query builds without
the window.

In the browser, `page.ts` renders the embedded state with `renderShell`, a
pure function from state to markup. Every reader change is a state change
followed by a render; nothing shown is stored. The latest verdict per
enforcement, the kept-from-an-earlier-run marks, reliance, open escalations,
the flow model, the relief's data, and every count are derived on each
render, never embedded. Structure and Connections are the two exceptions to
markup: each is a live view built once into its own element and kept across
renders, which a render only puts back into the host it leaves (below).

## The views

**Components** is the tree with intent, counts per lifecycle state, and a
mass line reserved for the economy's measurement (`mass: not measured` until
it exists). Selecting a component shows its invariants.

**Structure** is the relief (`relief/`): a three.js scene of what the
system is made of and where it changes. Each component is a block standing
on the platform of the component whose folder holds it; a folder with no
spec inside a component that holds others stands as a district of its own.

- Footprint. A block's footprint is its share of one measure the reader
  picks: lines or unreached lines (from mass), invariants, refutations or
  crossings (from its spec), `Leaned on` (the call sites other components make
  into its symbols, from the component interfaces), or open defects (from
  the journal). Every measure shares one total area, so area, not side, is
  the quantity, and a measure nothing records is offered disabled.
- Height and color. A block's height and color are its churn over a window
  (7 days, 30 days, or every landing loaded): landings, the first-parent
  commits on HEAD that touched it, or the lines they changed. Landings over
  200 files are left out of heights unless the reader includes them, since a
  bulk move touches everything and says nothing about any one component.
- Position. Components that land together stand closer: the co-change share
  over every landing of 40 files or fewer, settled by a force layout and
  spaced so no footprint overlaps. A scene built again seeds its layout from
  the last one, so what was settled stays where it was.
- Reading it. Double-clicking a platform steps into it as a slice, and the
  crumbs or `Escape` step back out. Selecting a block lists its files, its
  landings in the window, and the components it relies on and that rely on
  it with their most used symbols. Blocks can split into one block per file.
  The notes under the scene say what each measure is read from, what is left
  out, and, first, when the component interface reading behind `Leaned on` was
  bounded or stopped short (`reliefNotes`, in the words `query structure`
  uses); a table view carries the same numbers as text.
- The reading. `src/readings/relief/relief.ts` reads per component its
  lines, unreached lines and files from mass, the districts, and the latest
  landings on HEAD's first-parent line with the lines each changed per
  component and per file. The warm server reads it in a worker thread beside
  the state (`readReliefApart`), so its server loop stays free. A project
  with no commit yet, or outside version control, reads no landing: the
  relief still stands on its footprints, every block flat, the notes say why,
  and the window and diff controls say there are no commits yet.
- The data. `relief/data.ts` joins that reading with what the state already
  holds (invariants, crossings and refutations from the spec model, `Leaned on`
  and reliance from the component interfaces, open defects from the
  journal), so none of them goes stale while the reading stands. The first
  load counts each component's files and lists none; the live page fetches a
  component's files from `/api/relief/files` by folder, once per reading
  (`filesCache`), and a snapshot embeds whole folders up to
  `SNAPSHOT_FILES_BYTES` and says how many it left out.
- The scene on the page. `relief/mount.ts` builds the scene the first time
  Structure shows and keeps it across renders: `renderStructureResults` in
  `structure-view.ts` renders only the host it is put into, or why there is
  nothing to draw. It is built again only when the data it draws changed
  (`reliefStep`); the old scene is disposed (its frame loop, timers,
  listeners and GL context) and the new one opens on the reader's camera,
  slice, measures, selection and diff. A scene whose construction throws
  releases what it had built before the error leaves it. A browser that
  cannot start WebGL gets a line in the relief's place saying so
  (`WebGLUnavailable`), and any other failure a line saying the relief failed,
  with its error; neither is tried again until the data changes, and every
  other view stands.
- Diff. On a live page the controls offer a diff between two commits, or a
  commit and the working tree (`/api/relief/commits`, `/api/relief/diff`,
  both names checked before git sees them), standing on each block as two
  thin meters, lines added and lines deleted, on one scale for the view.
  Only the latest ask's answer is drawn; an earlier one that arrives later
  is dropped.
- Activity. The event stream carries `touch` events, the files an agent
  session just read or wrote, from its trace lines; the scene lights those
  files and their components for a moment and lists the last few. No state
  changes, so nothing renders.
- Replay. On a live page a bar above the scene (`relief/replay.ts`) plays
  back one session's replay record ([economy.md](economy.md#the-replay-record)):
  every tool call in the order it was made, each lighting what it read and
  wrote through the same touch the activity uses, at 1× to 32× (each pause
  the real gap, held between 0.12 s and 2.4 s), with a scrubber over the
  calls and the call at the head said in one line: when, which agent, the
  tool, and what it did. `/api/relief/sessions` lists the sessions from the
  folders' listings and `/api/relief/replay` serves one by its id; a session
  older than the record plays its read trace's reads and writes. While a
  replay plays, live touches light nothing; paused or ended, they light
  again. A snapshot carries no replay record, so it shows no bar.

**Connections** (`connections/`) is the view of component interfaces rooted
at one origin, a structural route or a component. `connections/model.ts` is
a pure function of the flow model, `flowOf` in `structure-flow.ts`, the
derivation `query structure` formats too:

- Columns are hops from the origin: from a component, what it calls one
  column right and what calls it one column left; from a route, its entrance
  token in column 0 and the components along its entrances' handler's static
  reach at their hops.
- Every component interface between two drawn cards is a line, thicker with
  more reference sites; from a route, the lines its work uses are its own.
- A chokepoint is drawn once, at the door of the component it protects,
  listing every caller it stands in front of, with its interface identifier
  (`C3`, or `X7` when its invariant carries a crossing), its crossing and its
  bypass sites.
- A core dependency is a chip on the cards that use it, and a card only as
  the origin or when the reader asks for it.
- `+N` on a card counts what lies one hop further out; spawning it draws
  exactly those.
- Selecting a card keeps only the lines that touch it, and lists every route
  whose reach gets to it with how many hops in, fewest first.

`connections/drawing.ts` places and draws it as SVG, with a rail of origins
(where work enters, then every component), a trail of the origins followed,
pan, zoom, dragging a card to pin it, and an inspector for what is selected.
`connections/mount.ts` keeps it across renders as the relief is kept, drawing
again from a new flow model on the reader's origin, spawns and pins. With
nothing asked it opens on the busiest route (`connectionsDefaultOrigin`); a
deep link names an origin.

The flow model both read:

- Evidence. It stands on static and computed facts: resolved references
  through the language adapter, declared entrances, and invariants. Observed
  runtime behavior is not shown (the observation seam, `observedEvidence` in
  `src/observation/record.ts`, is not drawn yet). When the page was built
  without the adapter (a test, a scaffold preview, `--no-interfaces`), only
  the references the latest runs recorded to chokepoints and protected
  things are known.
- Component interfaces. `component-interfaces.ts` resolves every exported
  top-level declaration of every non-test source file and asks the adapter
  for its references; each non-test site in another component adds that
  symbol to the component interface from the caller to the callee.
- Structural routes. With the handler's static reach read (the adapter
  records, per entrance, the component interfaces its handler's value
  references reach), a route is the component that declares the entrance,
  the component holding its handler, then from each stop the heaviest
  interface that reach uses through a symbol only that stop's component
  calls, never into a core dependency, never back (`ROUTE_RULE`). Without a
  reach the heaviest interface is followed and the route says it is
  reference weight, not flow. Entrances share a route only when they share
  its stops and their trust; a project that declares no entrance has its
  routes derived from the root component's interfaces.
- Core dependencies. A component called by more than half of the other
  visible components, by at least three, with at least three quarters of its
  component interfaces incoming (`CORE_RULE`).
- Entrances. Each is declared in a spec's `## entrances` (see
  `docs/spec.md`) and resolved again through the adapter; its route starts at
  the declaring component, and a dispatcher's entrance is unreachable unless
  the component interface from the declaring component carries the handler.

The masthead's verdict reads the same model: one verdict in large type
linking to Structure, with what it leaves out (requirements, uncovered
components, undeclared entrances as a neutral count) beneath it. An
invariant's enforcements, crossing, refutation and bypass sites are on its
card in **Invariants**, with its reliance listing, which `query relies-on`
also prints.

**Invariants** shows every bullet: state, enforcement form with its latest
verdict, the chokepoint grade with the rung's enforcer, crossing over the
declared trust levels, because, refutation (witnessed, automatic from the
run, or missing), checklist, and what it lacks. A structural defect shows
its bypass sites and the two honest options: route through the chokepoint,
or escalate a retirement, whose human acknowledges it with the reliance
listing in view. A chokepoint invariant's card folds its reliance listing
beneath it: every recorded reference site to the chokepoint or the protected
thing, owner component first, each with its file, line, symbol, endpoint,
classification, syntax form when known and test mark; unknown evidence is
said as unknown, and only a complete empty list says zero. The listing opens
when a `#reliance-…` link lands on it or the reader opens it, and the state
keeps it open across a live update's render. Filters by state and component.

**Practices** tells the story of what the project practices before how each
practice holds. It opens with a summary in words, then the project's working
rules by what sets them off ("When you run `refute` → witness a
refutation", "When you edit `**/*.spec.md` adding `refuted:` → …", and the
practices taken up on purpose), then where the practices live (each
component with its own, the kernel practices Coherence ships, and the
components with none), then what has no practice yet: components with
defects or walls on record and no practice of their own, and defects no
pitfall cites. What needs attention follows: a step gone from an enacted
practice with no decision, a step claimed done without the evidence it
names, a step deviated from repeatedly, a candidate never enacted. Each
practice's card shows its steps with an adherence strip over its latest
twelve enactments (evidenced, done, claimed, deviated, skipped, or absent
when the version enacted lacked the step), the reasons sessions gave for
deviating, its pitfalls linked to the records that witnessed them, what it
was learned from, its versions and amendments, and its enactments. The
derivations are `practices.ts`; the journal window keeps each practice's
latest twelve enactments (what the strips read), every decision citing an
enactment and what it cites, and every record a practice cites, so none of
it depends on the record's age; the enactment list says how many of a
practice's enactments the page holds, and the live page loads the rest with
earlier journal records. `query practice` prints the same story.

**Runs** lists the records latest first with session, agent, commit, dirty
flag, and counts; the verdicts one click away; on the latest, what the status
view keeps from earlier runs.

**Journal** is the merged timeline with kind glyphs, escalations awaiting a
human pinned at the top, a decision's rejected alternatives in the open, and
work orders when present, each the fold of its records (content, owner,
current state, history), never a state-change record shown as an order.
Filters by kind, agent, and session.

## Deep links

Every card id carries its view as a prefix (`component-`, `invariant-`,
`run-`, `journal-`, `work-`, the lexicon's `coherence-` and `domain-`, and
`connections--` for a Connections origin, a structural route or a
component, which the view opens on). A hash resolves to its view by that
prefix, or names a view alone (`#runs`). A reliance id (`#reliance-…`)
opens Invariants on that invariant's reliance listing, open, and the retired
Reliance view's own `#reliance` opens Invariants. The relief has no cards: a
link into the retired security-spine section or any of the retired map's
`structure-` selections (the masthead's verdict among them) opens the
Structure view. `resolveHash` in
`derive.ts` is the one place this is decided.

## The agent query

`node src/cli.ts query <question> [args]` answers a fixed set of questions
from the same state through `buildScopePage`: `invariants <path...>`,
`relies-on <chokepoint>`, `spine`, `structure`, `status`, `component <folder>`, `order`; and
`economy <path...>`, the economy prediction (what must be loaded to change
these files safely), which goes to the economy's own closure through the
warm instrument rather than to the page state. Plain text, a few hundred
tokens at most, no query language.

`query structure` reads the component interfaces through the language
adapter and formats `flowOf`: the structural routes, each by its entrance
names (or `via <component> (derived)`), with their stops in order, the
default selection (`DEFAULT_RULE`), the core dependencies with the rule and
their callers, the interface identifiers with the interfaces they stand on,
every interface with its label, the entrances with where each starts or why
it is unreachable, and each component's row and column.
`query spine` lists the trust levels and every crossing-bearing invariant
from `structureOf`.

## Ephemeral Structure previews

`writeStructurePreview(root, preview, outPath)` in `build.ts` is the scaffold
bridge. `StructurePreview` (in `model.ts`) carries only a component,
invariant name, crossing endpoints, and optional chokepoint/protected-thing
pairs. The bridge validates the component, duplicate name, and crossing
trust levels, selects Structure initially, and writes a deterministic,
self-contained page that carries the proposal, unverified, in its state
(`structure.preview`). No view draws it yet: the relief has no place for a
proposed crossing, and Connections drawing it as a dashed, unverified door
is the next round. The bridge refuses an output path inside the project
root so the generated artifact cannot change the lexicon or spec population
between otherwise identical previews. It changes no spec or run store, and
the caller cannot supply a grade, verdict, bypass count, lifecycle state, or
reliance evidence.

## Adding a view

1. Give the view a state type in `model.ts` and a field on `ShellState`.
2. Populate it in `loadState` in `build.ts`.
3. Write a pure render pair (tools and results) beside `lexicon-view.ts`,
   with card ids under a new prefix registered in `resolveHash`.
4. List it in `VIEWS` in `shell.ts` and add its cases to `renderViewTools`
   and `renderViewResults`. There is no list of browser sources to add it
   to: the bundle is every module `page.ts` imports at run time, followed to
   the end, so importing the new view where it is used is what puts it in.
5. A browser source imports modules by relative path and packages by name
   (three.js is one) as any ES module does; esbuild resolves each, and an
   import it cannot resolve, a `node:` module among them, fails the build
   naming it, since the page could not load it.
6. Add what it must show to `check.test.ts`.
