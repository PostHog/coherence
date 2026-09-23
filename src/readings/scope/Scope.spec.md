# Scope

The reading: one surface projecting the model for a human, in six views: Lexicon, Components, Structure, Invariants, Runs, Journal; a fixed shell that loads its state from the warm server and follows the stores live, or carries one state as a snapshot file; and the agent query, the same state as plain text.

## entrances
- scope: a human opens the live reading from the root's warm server, or an agent writes a snapshot of this project or another root
  handler: scopeCommand in cli.ts
- scope http: a browser asks the warm server for the shell, the first load, history by cursor, and the event stream
  handler: scopeApp in live.ts

## invariants
- fixed shell: The shell's bytes (its HTML, script, styles and embedded font) depend on no project content, and the same state in gives the same render and the same snapshot bytes out; the state is a function of all its inputs: both lexicons, the spec tree, the run records, the journal, the work store, and the component interface reading when one is given.
  protects: loadState
  chokepoint: scopeState
  over: every byte of the shell, built over two projects and after appending to each store the state reads, and every render and snapshot of the same state
  via: the shell's bytes are independent of project content; the same state in renders the same page out
  because: the owner ruled (d-eef7da19) that the reading be "a fixed object that loaded content dynamically", since static, baked content is the opposite of what the reading is for. A shell that varied with the project would be a generated page again, and a render that differed for the same state would make the page look like it carried something of its own. Every reader (a snapshot, the live server, the agent query) loads the state through scopeState, so no second path reads the stores differently. Its totality oracle appends to each store in turn and asserts both halves: the state moved, and the shell did not
  crossing: project-source -> reading
  refuted: stamped the build time into the shell's title in buildShell -> the totality oracle went red; restored, green (2026-09-23)
  kinds: encoding
  checklist: semantic-preservation declared as embedded state unchanged
  checklist: canonical-encoding declared as fixed shell
  checklist: key-rotation-compatibility dismissed: nothing is encrypted
- no stored derivation: The state stores nothing it derives from records it already holds: the latest verdict per enforcement, what passed, and what failed are read from the run records at render.
  over: every bullet of every component in the state, against the run records in the same state
  via: the state stores no copy of what it derives: the latest verdicts live in the run records and nowhere else
  because: data is destiny, which this component's own reading cites: two stored copies of one fact are an invitation to disagreement, and the page must never show a verdict its records do not carry. The copies were about a fifth of the embedded state, so removing them is cheaper to ship as well as truer; determinism is unaffected because a derivation over a sorted record list is a function
  crossing: record -> reading
  refuted: embedded each bullet's latest, verified and defects beside the run records they came from -> "the state stores no copy of what it derives: the latest verdicts live in the run records and nowhere else" went red in check.test.ts, the stored keys present on every bullet; restored, green (2026-09-18)
  kinds: none
- reliance comes from complete endpoint sites: Structure's chokepoint selection and query relies-on list actual file, line, symbol, endpoint, classification, syntax form when known, and test mark for references to either the chokepoint or protected thing; absent sites stay incomplete and only a present empty list confirms zero.
  over: every chokepoint invariant with no run, a legacy run, complete empty sites, protected-only sites, chokepoint-only sites, and both endpoints together
  via: reliance reads both protected and chokepoint endpoint sites, owner first, without calling a bypass a legal door reference
  because: the lexicon defines reliance from references to either endpoint. Dropping protected references hides direct consumers, while calling a protected bypass a legal chokepoint reference erases the structural defect. The run's optional sites field preserves the evidence boundary: absence is legacy or unavailable, and presence means both endpoint queries completed
  crossing: record -> reading
  refuted: filtered the site list to chokepoint references alone -> the protected-only reliance assertion went red in check.test.ts; included both endpoints with their role and classification, green (2026-09-18)
  kinds: none
- bounded first load: The first load (the state the live server sends first, and a snapshot's state) carries a bounded window of the two stores that grow with every session, the run records and the journal, so its size does not grow with them, while every verdict it derives is the one every record derives, every record left out is counted, and paging back by cursor loads every record left out, once.
  over: every run record and journal record of a fixture grown by 2400 journal records and 360 runs, the latest verdict of every invariant in it, and every page of history from the first load's hint back to the first record
  via: the first load stays flat as the journal and the runs grow, every derived verdict is unchanged, and history loads every record left out by cursor, once
  because: defect df-d6deded9: the page over Coherence passed its 2 MB budget because it embedded every run and journal record, and both grow every session (the runs were 1.16 MB of 2.06 MB). Raising the budget would only move the day it fails. The window keeps the latest records, every open escalation, what those records point at, and every run holding some enforcement's latest entry, so no derivation changes. With the reading live (d-eef7da19) the window bounds the first load and no longer what a reader can see: older records load on demand by cursor, a search reaches every record, and a cited record loads by id
  crossing: record -> reading
  refuted: made windowState return the whole state, so the first load carried every run and journal record -> the totality oracle went red; restored, green (2026-09-23). Before the reading was live: made buildScopePage embed every run and journal record -> red naming 451606 then 1096410 bytes; restored, green (2026-09-22)
  kinds: none
- self-contained snapshot: A snapshot is the shell byte for byte with one inline state, and neither loads anything from outside: no external src, href, url() or @import, and the script fetches only its own origin's paths.
  over: every src, href, url(), @import and fetch in the snapshot and in the shell
  via: a snapshot is the shell with one inline state and loads nothing from outside: no external src, href, url() or @import
  because: a snapshot is what is shared, kept as a CI artifact, and written by other agents with scope --root and --out, then opened from a file on a machine with no network or server to assume; a page that fetched anything from outside would render differently, or not at all, by where it was opened. Being the shell plus a state, not a second page, it cannot drift from what the live reading shows
  crossing: project-source -> reading
  refuted: linked an external stylesheet from the shell's head in buildShell -> the totality oracle went red; restored, green (2026-09-23)
  kinds: output
  checklist: destination-confinement declared as self-contained snapshot
  checklist: redaction dismissed: nothing in the lexicon is sensitive; provenance is separated, not removed
  checklist: commit-ordered-effects dismissed: the page has no effect
  checklist: circuit-breaker-policy dismissed: the page has no dependency to sample
  checklist: declared-target-coverage dismissed: one file is written
- embedded state unchanged: The state a snapshot embeds is the loaded lexicon, unchanged.
  over: every field of the loaded lexicon
  via: the embedded state is the loaded lexicon, unchanged
  because: the browser renders from the embedded state; a build that reshaped the lexicon on the way in would show a human something other than the settled vocabulary
  crossing: project-source -> reading
  refuted: embedded an extra field beside the state in buildScopePage -> "the embedded state is the loaded lexicon, unchanged" went red in check.test.ts; restored, green (2026-09-17)
  kinds: encoding
  checklist: semantic-preservation declared as embedded state unchanged
  checklist: canonical-encoding declared as fixed shell
  checklist: key-rotation-compatibility dismissed: nothing is encrypted
- provenance one click away: Provenance and detail render only under their disclosures; no provenance key or value appears in the vocabulary.
  over: every concept and every key of its provenance
  via: provenance and detail are one click away; no provenance key or value appears in the vocabulary
  because: history mistaken for definition is how a metaphor becomes a rule; provenance and detail stay whole under their disclosures, and the check asserts for every concept that nothing of provenance leaks into the vocabulary
  crossing: project-source -> reading
  refuted: moved the provenance disclosure inside the vocabulary, so its keys and words read as vocabulary -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: read
  checklist: scoped-reads dismissed: every concept is shown to every reader
  checklist: redaction dismissed: nothing is removed; history is separated from definition and shown on request
- render from state: Every reader change is a state change followed by a render: the search derives its matches from state and hides the rest.
  over: every reader interaction the shell handles
  via: the search derives its matches from state and hides the rest
  because: the shell is a function of one state value; a render that read from the document instead would let the page drift from the state it claims to show
  refuted: made the search match every concept instead of deriving its matches from state -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
- views render from state: Every view is a pure render over the one state value: every component, invariant, run record, and journal record in the state is on its view, and a filter or query narrows what is shown without storing anything.
  over: every component, invariant, run record, journal record, and work order of the fixture project, on each model view
  via: every view renders from state: every component, invariant, run, and journal record in the fixture is on its view
  because: a view that dropped a record, or kept a filtered list of its own, would show a human something the records do not say; the latest verdict, the kept mark, reliance, and the open escalations are derived on every render so the page can never disagree with itself
  crossing: record -> reading
  refuted: made the journal timeline skip its first record in renderJournalResults -> "every view renders from state: every component, invariant, run, and journal record in the fixture is on its view" went red in check.test.ts; restored, green (2026-09-17)
  kinds: none
- defects show both options: A structural defect renders its bypass sites (file, line, symbol) and both honest options, route through the chokepoint or escalate a retirement; no bullet in another state shows a defect section.
  over: every bullet of the fixture project, one in each lifecycle state
  via: a structural defect renders its bypass sites and both honest options
  because: the reveal is the point of Coherence; a defect card that hid a bypass site, or offered one option, would steer an agent to route around the chokepoint instead of through it or to a human
  crossing: record -> reading
  refuted: withheld the retirement option from the defect section in renderDefect -> "a structural defect renders its bypass sites and both honest options" went red in check.test.ts; restored, green (2026-09-17)
  kinds: none
- deep links resolve: Every card id on every view resolves, by its prefix, to the view that renders it, a hash naming a view alone resolves to that view, and a link into the retired Reliance view or security spine lands on the map's selection that replaced it.
  over: every card id every view renders for the fixture project, and every link the Invariants view carries
  via: deep links resolve: every card id on every view resolves to that view
  because: a link into a card on another view must open that view first or it lands nowhere; one id space with a prefix per view is decided in one function, and the check walks every rendered id through it
  crossing: reading -> reading
  refuted: gave run cards a prefix no view claims in runId -> "deep links resolve: every card id on every view resolves to that view" went red in check.test.ts; restored, green (2026-09-17)
  kinds: none
- second root: With --root the page is built over another project: its spec tree, runs, journal, and lexicon become the domain layer beneath Coherence's own, and its run records show its structural defects.
  over: every structural defect the first adopter's model derives from its run records, and every bypass site each carries
  via: the first adopter's tree builds as a second root: its lexicon is the domain layer and its run records show its structural defects
  because: a reading that rendered only Coherence's own tree would never have shown the two broken chokepoints the first adopter's runs recorded
  crossing: record -> reading
  refuted: made the build ignore --root, so the first adopter's tree could not be a second root -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
- structure draws every component interface: Every component interface, every pair of components one of which references the other's symbols in non-test code, is on the Structure map from caller to callee: along a structural route, as a stub to a core dependency, at rest when a chokepoint, a crossing or a bypass stands on it, and otherwise drawn faint when a selection reaches it; none is removed because a path of other interfaces implies it.
  over: every component pair the flow fixture's reading resolves, including pairs a path through another component implies, and no pair in the callee-to-caller direction, at rest, with its caller selected, and with itself selected
  via: every component interface is on the map, caller to callee, and none is implied away
  because: the owner defined the component interface as computed, never declared, so Structure is a live view of the real project and not a rotting map (d-54e128e1); an interface a path implies is still a real surface a change can widen. The transit redraw (w-2b931e15, d-4a122d41) draws journeys rather than every connection at rest, so the rule moved from one arrow each to a place on the map each: a route, a stub, a load-bearing line, or a faint line one selection away
  crossing: record -> reading
  refuted: stopped drawing a plain interface on no route when a selection reaches it, in flowLayout -> the totality oracle went red; restored, green (2026-09-22). Before the transit redraw: drew only the load-bearing interfaces in flowOf -> red; restored, green (2026-09-22)
  kinds: none
- component interfaces reveal their invariants: A component interface is annotated from the invariants and never authored: the chokepoint that stands on it when a chokepoint symbol is among its symbols, that invariant's crossing, and the classes of data its crossings carry; its label reads them in that order, else names its most-referenced symbols, and never a verb.
  over: every interface of the flow fixture, load-bearing and plain, and every line of every label
  via: a component interface is annotated from the invariants: its chokepoint, its crossing, the data that passes; a plain one by its most-referenced symbols, never a verb
  because: the lexicon says what an interface reveals comes from the invariants; an authored relationship label rots, and the topology prototype's every arrow said consumes, which told nobody anything. Deriving the annotation from the chokepoint symbols the interface actually carries keeps load-bearing and plain honestly apart
  crossing: record -> reading
  refuted: stopped finding the chokepoints that stand on an interface in flowOf -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- structure positions are stable: Structure's layout is a pure function of entrances and component interfaces with ties broken by name, and adding one component interface never reorders the components it does not touch: only what the interface reaches (its callee and what the callee reaches, or everything its caller reaches when the interface stops the caller being a core dependency) may change column, and within a column components keep folder order, so no two components that keep their columns change places; no position is stored.
  over: every component of the flow fixture before and after each of seven single component interfaces is added, one from an entrance's component, one into a component nothing called, and two that bring a callee and everything it reaches nearer to the entrances, and every pair of components that keep their columns
  via: stability: adding one component interface never reorders the components it does not touch
  because: the owner ruled stable positions essential: "Stable positions are essential and that rule makes sense" (structure detail, stability); a reader who learned where things are must not lose them when one reference is added, and a diff can only show what moved if nothing else did. The first transit pass kept the rule that only an interface's two ends move by capping columns at two (d-1f1ce391), and the cap was a defect: routes doubled back to columns they had left (four of eight on Coherence, one of four on the first adopter). Columns are now true distance from where work enters, which necessarily brings the new interface's callee and everything it reaches nearer, so the rule is stable relative order (d-41cad841)
  crossing: record -> reading
  refuted: ordered each column by the row its route predecessors ask for (a barycenter order) instead of folder order, in flowOf -> the totality oracle went red naming src/scheduler and src/storage reordered by adding . -> src/indexer; restored, green (2026-09-22, refutation recorded by refute). The same break left the flow fixture alone green, its columns holding one or two components, so the totality oracle now also runs over the crowded fixture. Before the rule changed: made every component's column past the entrances depend on how many interfaces the whole map has -> red; restored, green (2026-09-22)
  kinds: none
- one selection answers each reviewer question: On the built page, each reviewer question is answered by one selection on the one map: where work enters, what a change touches and what it weakened (the comparison's place), where sensitive data goes (a trust level), what is load-bearing here (a component), and a chokepoint's reliance.
  over: the five reviewer questions the owner named, each against the page built over the Scope fixture with a component interface reading
  via: each reviewer question is answered by one selection on the built page
  because: the owner's success measure for Structure (structure detail, success, one_map): the security spine and reliance stopped being a section and a view of their own so that each question is one selection on one map, and a question that took two views to answer would put the map back in pieces
  crossing: record -> reading
  refuted: made the change selection name nothing on the map -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- structure flow and query structure share one derivation: Query structure prints the same structural routes, core dependencies, and interface identifiers the Structure map draws, from the one flowOf derivation.
  over: every structural route with its stops in order, every core dependency, and every interface identifier on every interface it stands on, over the flow fixture and a twelve-component crowded fixture
  via: query structure prints the routes, core dependencies and interface identifiers the view draws, from the same derivation
  because: an agent and a human reading different routes of one project would each be told a different story about the system; one derivation read twice cannot drift
  crossing: reading -> reading
  refuted: reversed the route order only in query structure -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- structure text never collides: No text on the Structure map overlaps other text, is truncated, or leaves the canvas or the station it is declared to sit within, under any selection; lower-priority text is dropped instead.
  over: every text element of the rendered SVG, measured by embedded font metrics, over the flow fixture and a twelve-component crowded fixture, at rest and under every entrance, route, trust level, chokepoint, component and interface selection
  via: the map's text never overlaps, is never truncated, and never leaves its canvas or its station, under every selection
  because: the owner judged the earlier map unusable partly for floating labels that overlapped and truncated (resolveRegisterTok...). Cartography's rule is that every label has a priority and lower-priority text is dropped, never overlapped; the check measures rendered text boxes from font metrics of its own rather than trusting the layout that placed them. Two weaker breaks (the folder set on its name's baseline; the placer skipping its placed-text check) left the check green, because the placer or the fixtures' first candidates kept text apart, so the crowded fixture now carries identifiers and defects on every route
  crossing: record -> reading
  refuted: placed interface identifier tags in flowLayout without checking the text already placed -> the totality oracle went red naming the overlapping boxes; restored, green (2026-09-22)
  kinds: none
- structure segments are octilinear: Every line segment the Structure map draws is horizontal, vertical, or at 45 degrees, under any selection.
  over: every path and line the rendered SVG draws as a route, an interface, a stub or a rail, over the flow fixture and a twelve-component crowded fixture, at rest and under every selection
  via: every drawn segment is horizontal, vertical, or at 45 degrees, under every selection
  because: transit maps read because their segments hold three directions; the curves of the earlier map carried no route and crossed at every angle
  crossing: record -> reading
  refuted: made the first chamfer of every lane turn in lanePath twice as steep as it is wide -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- a core dependency draws no caller arrow: A core dependency is drawn as one rail labelled once; each caller's stub runs to the rail and meets it, no route line or arrow from any caller reaches it, and no route runs through it.
  over: every caller interface of every core dependency in the flow fixture, at rest and under every selection
  via: a core dependency is a rail labelled once: its callers carry a stub and no arrow or line reaches it
  because: the earlier map fanned seven arrows into Core on the first adopter; a process drawing does not pipe a utility to every unit (d-d8c45333 records the rule that makes a component one)
  crossing: record -> reading
  refuted: piped every caller to its rail with a line from the station down to the rail, beside its stub, in flowLayout -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- each structural route is one colored path: Each structural route is drawn as one path of its own color that passes through the centre of each of its stops in order, every consecutive pair of stops a component interface from caller to callee.
  over: every structural route of the flow fixture and a twelve-component crowded fixture, and every vertex of its path
  via: each structural route is one colored path through its components in order
  because: a transit map draws journeys, not connections: a route that broke into pieces or skipped a stop would not show the path work takes from its entrance (d-b72bd2e0)
  crossing: record -> reading
  refuted: dropped every second interchange from each route's path in flowLayout, so the line skips that stop -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- structure preview is ephemeral evidence: writeStructurePreview validates a proposed crossing, selects Structure, renders it dashed and unverified, and writes only outside the project root without changing specs, runs, or the inputs that determine the page.
  over: every generated preview page and proposed crossing endpoint
  via: the Structure preview bridge validates crossings, selects Structure, and writes deterministic generated pages only
  because: a preview is a view of a proposed change, not evidence that it happened. Writing it under the project would alter lexicon population and make otherwise identical previews differ; accepting grade, verdict, or reliance from the caller would invent run evidence
  crossing: project-source -> reading
  refuted: allowed the generated preview page inside the project root -> the in-root refusal assertion went red in check.test.ts; restored outside-root confinement and generated both previews byte-identically (2026-09-18)
  kinds: none
- ambiguous property meanings stay plural: When one observed property spelling is owned by multiple concepts, Scope and query lexicon display every meaning alternative with its owner, layer, definition, properties, and confusables; neither selects one owner nor calls the scalar absence an unsettled definition.
  over: every projected VocabularyTerm carrying meaningAlternatives, including a spelling shared by two concepts while scalar concept, definition, and properties are intentionally unset
  via: Scope and query lexicon readings display every applicable property meaning instead of a false missing-definition line
  because: selecting one property owner would silently change the lexicon meaning, while saying no definition would discard definitions the authoritative coverage already carries. The ambiguity is evidence to display, not a choice for the reading to settle
  crossing: record -> reading
  refuted: ignored meaningAlternatives and formatted the unset scalar definition as missing -> the shared Scope/query reading test went red; restored every alternative, green (2026-09-18)
  kinds: none
- structure health is on the map: A strip above the Structure map counts every invariant by its one verdict, and its counts are the spec model's (invariants enforced and verified, requirements, structural defects), with requirements whose chokepoint check found bypasses and open escalations when there are any; each count is a selection whose inspector lists its set, and a project with nothing enforced says so on the map.
  over: every health count of the built fixture page against its spec model's counts, and every member of every count against its inspector
  via: the health strip counts are the spec model's, each a selection whose inspector lists its set
  because: all three blind readers found health had no place on the map (docs/reviews/2026-09-22-structure-map-synthesis.md, item 1): the first adopter's 0 invariants and 36 requirements sat in grey header text while its identifiers looked like working controls, and Coherence's map carried no health signal at all
  crossing: record -> reading
  refuted: counted requirements as the verified count in renderHealthStrip -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- identifiers carry their state: Every interface identifier is drawn in its invariant's one verdict by its fill, solid when enforced and verified, hollow and hatched when a requirement, red when broken, every component carries its worst verdict as a drawn bar inside its box, and a requirement's label leads with not enforced.
  over: every identifier and every component the rendered map draws for a fixture holding a verified invariant, a requirement, and a structural defect, and the label of every requirement
  via: every identifier and every component is drawn in its invariant's state by fill: solid verified, hollow and hatched requirement, red broken, and a requirement reads not enforced first
  because: the security and owner readers found an unenforced, never-run requirement indistinguishable from a verified, refuted invariant (synthesis item 2); a control that is not one must not look like one. The second round (docs/reviews/2026-09-23-structure-map-synthesis.md, item 3) found a dashed outline too faint a difference at tag size, and "requirement, checked 2026-09-17" read as a pass, so the state moved into the fill and the label says not enforced first
  crossing: record -> reading
  refuted: drew a requirement's identifier as the old dashed outline on a blank fill, not hollow and hatched -> the totality oracle went red; restored, green (2026-09-23). Before the fill: drew every identifier verified in flowLayout's identifierOf -> red; restored, green (2026-09-22)
  kinds: none
- broken marks are attached and list their sites: A component with a broken chokepoint carries a red broken mark touching its box, a button that selects its broken chokepoints and lists every bypass site, naming those inside the component as inside and saying so when all are.
  over: the broken mark and inspector of a fixture component bypassed from another component and from inside itself, and of one bypassed only from inside
  via: a component with a broken chokepoint carries a broken mark on its box that lists every bypass site, inside ones named as inside
  because: the first adopter's two broken chokepoints were a floating caption that named no component, could not be selected, and said its bypass sites could not be shown (synthesis item 1)
  crossing: record -> reading
  refuted: skipped placing every component's broken mark in flowLayout -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- every crossing is drawn: Every crossing-bearing invariant is drawn on the map: on the component interfaces its chokepoint stands on, on the line where work enters when its chokepoint is the entrances' handler, and otherwise on its component's boundary mark; no trust level has a crossing placed nowhere.
  over: every crossing of the flow fixture, the crowded fixture, a fixture with a crossing whose invariant has only a totality oracle, and one whose entrance handler is a chokepoint, against the rendered map at rest
  via: every crossing is drawn: on its interface, on the entrance line it guards, or on its component's boundary mark
  because: the security reader found about 2 of 20 of the first adopter's boundaries drawn, the rest listed as standing on no component interface, and Coherence's harness crossings on a line the host-hook entrances never take (synthesis item 5)
  crossing: record -> reading
  refuted: stopped adding a crossing on no interface to its component's boundary mark in flowOf -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- a trust level always lights: Selecting any trust level that a crossing carries lights at least one drawn identifier or boundary mark, and lights an identifier only when its own crossing carries that level.
  over: every trust level of every fixture that a crossing names, selected on the rendered map
  via: selecting any trust level lights at least one drawn thing, and only the identifiers whose crossing carries it
  because: selecting agent-mcp or storage on the first adopter lit nothing though they carry its central boundary, and selecting record on Coherence lit an identifier of another level beside it (security review, issues 1 and 6)
  crossing: record -> reading
  refuted: lit every identifier that carries any crossing when a trust level is selected, in flowSelection -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- routes split by trust: Entrances share a structural route only when they share its stops and the trust they carry in, the entering side of the crossings whose chokepoint is their handler; an entrance whose handler is a chokepoint wears that identifier on the line where work enters.
  over: two entrances of one component with the same stops, one handled by a chokepoint with a crossing and one not, and two entrances sharing a handler
  via: entrances whose trust differs get their own routes, and an entrance's own chokepoint crosses on the line where work enters
  because: the owner asked that routes split where the path or the trust differs, not only by the handler's component; Coherence's host-hook entrances carry harness data through runHook, which is itself the chokepoint of the harness crossings, and the map must show that crossing where the host's input enters (decision d-a5e5c691)
  crossing: record -> reading
  refuted: let entrances share a route by its stops and rail alone, ignoring their trust, in flowOf -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- routes follow the handler: With the handler's static reach read, a structural route follows only component interfaces that reach uses through a symbol only its stop's component calls, never a type and never a utility another component also calls, and stops where the reach goes no further; without a reach it is reference weight and says so.
  over: the run entrance of the flow fixture with a reach through a utility, with a reach through dedicated symbols, and with no reach
  via: with the handler's reach read, a route follows the handler and stops where its work ends: never through a utility another component calls, never a type
  because: the readers found routes were a walk along the heaviest references labelled as the path work takes: five of eight Coherence routes shared one tail and the scope page route ended in Economy (synthesis item 3)
  crossing: record -> reading
  refuted: let a route follow a utility another component also calls, in flowOf's follows -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- interfaces read only within the declared components: The component interface reading asks only about declarations in component code, the non-test files the config's bounds keep, each belonging to its nearest component alone; a reference site inside the bounds in code no component owns is counted into its callee, never drawn and never dropped, code past the bounds is never counted, and the map's evidence line and query structure say so.
  over: every declaration and every reference site of the bounded fixture: two components, code no component owns, and a folder the config's ignore list bounds away
  via: interfaces read only within the declared components
  because: on a PostHog adoption whose root component is the whole monorepo the reading asked every declaration of some 19,700 files and never finished; the map draws interfaces between the project's components, and the config's bounds are the adopter's own word for what the project is. A caller the reading found outside every component is counted, so the bound is never a silent drop
  crossing: instrument -> reading
  refuted: dropped every reference site in code no component owns, in readComponentInterfaces, instead of counting it into its callee -> the totality oracle went red; restored, green (2026-09-23, refutation recorded by refute)
  kinds: none
- the prefilter never hides a cross-component reference: A declaration is asked for its references only when component code of another component spells its name or an alias it is given, star-imports or wildcard re-exports its module, or it is a default export, and a handler's reach asks what the files it has entered spell; the reading so asked is the reading that asks every declaration, interface for interface, site for site, and reach for reach.
  over: every component interface, site count and entrance reach of a TypeScript project with a wildcard re-export, a renamed re-export, an alias and a default export, of a Python project with a star import, an alias and a getattr string, of the bounded fixture, and of Coherence's own tree, each read with and without the word index
  via: the prefilter never hides a cross-component reference
  because: a language server reports a reference only where the text names the thing, so a name no other component's text spells cannot have a site there; the escape hatches (a star import or wildcard re-export spells no name, an alias or default import spells another) are exactly where that argument needs help, and each is handled rather than assumed away
  crossing: instrument -> reading
  refuted: stopped asking about a declaration whose module another component wildcard re-exports or star-imports, in namedElsewhere -> the totality oracle went red on the TypeScript escape hatches; restored, green (2026-09-23, refutation recorded by refute)
  kinds: none
- the interface reading is bounded in time and says when it is partial: The component interface reading stops asking when its time budget or its language server's memory budget is spent, the config's interfaceBudget or ten minutes and three gigabytes by default, keeps what it read, and the map and query structure say it is partial, which budget stopped it, and whose declarations were not all read; a stalled server never holds it past its budget.
  over: a server that never answers one question, a server over its memory ceiling, a reading that finishes, and the budget from the config and from a flag, each through the reading, the Structure page and query structure
  via: the interface reading is bounded in time and says when it is partial
  because: the reading of a PostHog adoption ran 30 to 90 minutes with its language server at 3.5 GB and never finished, and nothing said so; a partial map presented as complete would be worse than none, since a missing interface reads as no dependency
  crossing: instrument -> reading
  refuted: awaited the language server's answer without racing it against the deadline, in readComponentInterfaces' within, so a stalled server held the reading -> the totality oracle went red; restored, green (2026-09-23, refutation recorded by refute)
  kinds: none
- origin tokens stay readable: An origin token shows at most four entrance names and a count of the rest, which the route's inspector lists in full.
  over: a route six entrances share
  via: an origin token shows at most four entrance names and a count of the rest; the route's inspector lists every one
  because: the first adopter's nineteen-name block was unreadable. How a token's text reads against its fill is the next bullet's
  crossing: record -> reading
  refuted: showed every entrance name on its origin token, uncapped -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- token text clears its real fill: Every origin token's text reaches 4.5:1 against the token's own fill as the map paints it, a tint of its route's color over the station fill, for every route color and the neutral one, light and dark; and a broken mark's white text reaches 4.5:1 against the broken fill.
  over: the token ink and every route's and the neutral route's token fill in the light and the dark rules of the rendered map's own style, the fill each drawn token references, and the broken fill in both themes
  via: token text clears 4.5:1 against the token's own tinted fill for every route color, light and dark, and white clears it on the broken fill
  because: the owner ruled (d-a5c6442d) for glass with Expanse's token shapes and styles, so a token is now a tint of its route's color with a hairline border, not a solid fill; the check it replaces measured white on the solid route color, a fill no longer painted, and would stay green while the real text failed. The gallery measured every text against its rendered background and found the broken mark at 3.91:1 (white on #e5484d), so the broken fill is darker (#c4262e in the dark) and measured here. Light-mode tokens are pale tints with the map's dark ink, not white on a saturated fill, which is what the owner found baffling (d-4366e47f)
  crossing: record -> reading
  refuted: tinted the light origin token 90% toward its route color in FLOW_TOKEN_TINT, so the dark token ink sat on a nearly solid route fill -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- the trust tag sits outside its token: Each entrance route's trust tag (its trust level, unknown, or no control) is set beneath its origin token, outside it, right-aligned to the token's right edge where the route leaves, in the map's monospace face, amber for no control and neutral for a trust level; it is placed like any text on the map, so it never overlaps text or a station, no token or tag touches another whichever station their routes begin at, and it never widens the map: a trust level too wide for the margin is dropped and the route's inspector still states the route's trust and controls.
  over: every entrance route of the flow, trust, no-control, crowded, shared and broken fixtures and of one whose stacked stations' blocks of tokens would meet, at rest and under every route, component and trust level selection, and a trust level wider than the margin
  via: the trust tag sits outside its token, right-aligned beneath it, and never overlaps
  because: the owner found the no-control pill inside the token "just looks jammed in there" and asked that "that tag should live as a subscript outside the token, on the bottom, aligned to the right edge" (d-a5c6442d). Placing it by the map's own text placement keeps the rule that text is dropped, never overlapped; the margin is only ever as narrow as the words no control and unknown allow, so the attention signal is never the tag that drops
  crossing: record -> reading
  refuted: stopped moving apart the blocks of tokens of stations one above the other in flowLayout, so a tag hung onto the next station's token -> the totality oracle went red; restored, green (2026-09-23). Before: set each trust tag 10 px left of its token's right edge in flowLayout, so it no longer hangs from the edge the route leaves by -> red; restored, green (2026-09-23)
  kinds: none
- the map opens on the whole system: With nothing chosen the map opens with nothing selected and every route drawn whole, unless a component is broken, when it opens on the component with the most broken chokepoints, then the first in folder order; the key and the query state that rule, and a deep link selects anything.
  over: the default of the flow, crowded, shared, derived and broken fixtures, their routes at rest and cleared, the key's words, and the query's
  via: the map opens on the whole system, every route drawn, unless something is broken, when the broken component opens selected; a deep link selects anything
  because: the owner and security readers found the page opened on a minor route (query, or the MCP tools) instead of the whole system or the riskiest place (docs/reviews/2026-09-23-structure-map-synthesis.md, item 10); the busiest-route rule it replaces is retired with it
  crossing: record -> reading
  refuted: opened a healthy map on its first route in flowDefaultSelection instead of nothing -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- one verdict per invariant: The Structure inspector shows each invariant's one dated verdict, gives a component's inspector its verdict summary before its callers, callees and invariants, and folds every per-enforcement record, test command, and advice, closed.
  over: a chokepoint whose enforcement a later run kept, and a component holding a structural defect, in the rendered inspector
  via: one verdict per invariant: the inspector shows one dated state, and every per-enforcement record and test command is folded
  because: one invariant showed verified, not run, and kept from an earlier run at once, the inspector ran past 2000 px with test commands, and a component's own invariants were not listed at all, so "I changed Session" could not be answered (synthesis items 6 and 7)
  crossing: record -> reading
  refuted: opened the per-enforcement record fold in the chokepoint inspector -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- red means broken: Red on the Structure map means broken and nothing else: no route or rail color reads as red, orange or amber, the selection is a neutral halo and weight that no route wears, and nothing enforced, a component's crossing count and a trust boundary are drawn in neutral or amber attention, never the broken color.
  over: every route, rail and neutral color in both themes, the selection's color, a component whose crossings inside it include a broken one, the nothing-enforced note, and the key's trust boundary
  via: red means broken: no route or rail color reads as red, orange or amber, the selection is a neutral halo no route wears, and nothing enforced, crossing counts and trust boundaries never use the broken color
  because: all three blind readers found red doing four jobs (the hook route, the first adopter's crossing chip on its busiest component, the nothing-enforced banner, and broken), so the loudest thing on the healthy Coherence map was a red block that meant nothing was wrong, and the orange selection tangled with the spec route in light mode (docs/reviews/2026-09-23-structure-map-synthesis.md, items 1 and 2)
  crossing: record -> reading
  refuted: gave the eighth route the old hook route's red (#df2c2b) in FLOW_ROUTE_COLORS -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- the masthead leads with health: The page's masthead leads with one verdict in large type (every invariant verified, nothing enforced yet, or how many are broken) that links to its set on the Structure map, and demotes the component, invariant, run, journal and lexicon counts beneath it.
  over: the masthead of a healthy fixture, one with nothing enforced, and one with a broken component, and the type sizes the page gives the verdict and the counts
  via: the masthead leads with health: one verdict in large type that links to its set, with the counts demoted beneath it
  because: the owner and security readers found the verdict too quiet: Coherence's 114 of 114 sat in small type under a masthead that led with the lexicon's size and a count of bullets (docs/reviews/2026-09-23-structure-map-synthesis.md, item 3)
  crossing: record -> reading
  refuted: skipped the broken branch of flowVerdict, so a broken project's masthead read as verified -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- trust shows where work enters: Each entrance route's origin token carries, in the tag beneath it, the trust its entrances carry in (derived as decision d-a5e5c691 derives it), unknown when none is derived, and no control when no identifier stands where its work enters, on an interface it takes, or on the stub to its rail; the trust-level key beside the health strip makes each level a selection defined in one line, and the route's inspector and the query say the same.
  over: every route of the flow, trust, crowded, shared and no-control fixtures, its controls, its trust tag, the key's levels, and the query's route lines
  via: trust shows where work enters: each entrance route's token carries the trust its entrances carry in, or unknown, or no control when nothing on the route controls it, and a trust-level key sits with the health strip
  because: the security reader could not tell which inputs were untrusted without reading inspector prose, and unprotected untrusted routes (document upload to IO, OAuth to Auth, the scope page to Scope) looked the same as protected ones (docs/reviews/2026-09-23-structure-map-synthesis.md, item 5). Unknown trust is treated as untrusted (d-6df8d09a), and one tag says both facts (d-7d36881b), beneath the token (d-a5c6442d)
  crossing: record -> reading
  refuted: marked no route as having no control in flowOf, so an uncontrolled route's token read unknown -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- a component selection shows direction: Selecting a component draws its callers and its callees apart (solid and dashed, as stations and as lines, with or without motion), and its inspector gives its verdict, then who depends on it, then what it uses, then its invariants, the first few shown and the rest folded.
  over: the callers, callees and lines of a selected component in the flow and broken fixtures, and the order of its inspector for a component with more invariants than it shows
  via: a selected component shows direction: its callers and callees are drawn apart, and its inspector gives its verdict, then who depends on it and what it uses, then its invariants, the first few shown and the rest folded
  because: the owner could not see which way a change to the first adopter's busiest component runs: callers and callees were one color, and the inspector listed eighteen invariants before who depends on it (docs/reviews/2026-09-23-structure-map-synthesis.md, item 4)
  crossing: record -> reading
  refuted: left a selected component's interfaces into it out of its into set in flowSelection, so its callers were not drawn as callers -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- the unenforced is visible: A component no enforcement covers (no chokepoint on a component interface it exposes or on an entrance line into it, and no verified totality oracle of its own) carries a hollow state bar and a not-covered mark, on its box or its rail, and the health strip counts them in a selection that lists them.
  over: every component of the flow, broken, trust, totality-covered and rail-uncovered fixtures, against the rule computed independently, and the strip's count and its list
  via: the unenforced is visible: a component no enforcement covers carries a hollow state bar and a not-covered mark, and the health strip counts and lists them
  because: the owner found not covered existed only as an unclickable count, and nothing on the map said that the first adopter's shared core component, called by seven of seven, had nothing standing on it (docs/reviews/2026-09-23-structure-map-synthesis.md, item 6; the rule is decision d-a02f255c)
  crossing: record -> reading
  refuted: counted every component as covered in flowOf -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- each identifier is drawn once: Every interface identifier is drawn in full once, where work enters first, and as a dot of its shape and state wherever it stands again; a crossing's identifier has pointed ends and a chokepoint's is rounded, the key spells both out, and a component's crossing count shows only while a trust level, the component or its boundary is selected, a neutral tick otherwise.
  over: every identifier and boundary mark of the flow, crowded, trust and broken fixtures, at rest and under every trust level and component selection
  via: each identifier is drawn once in full and as a dot wherever it stands again, a crossing's with pointed ends and a chokepoint's rounded, and a component's crossing count shows only while a trust level, the component or its boundary is selected
  because: all three readers found the map noisy: X21 drawn four times and X14 and X15 twice read as different controls, C and X differed by one letter, and a crossing count sat on every component (docs/reviews/2026-09-23-structure-map-synthesis.md, item 7)
  crossing: record -> reading
  refuted: drew every placement of an identifier in full in flowLayout, never as a dot -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- roles are never cut mid-phrase: A component's role on its box wraps to three lines at most, widening its column before it would cut mid-phrase, and otherwise ends at a clause; and a map wider than its window says so with a hint and a fade, the view strip wraps rather than clip its last tab, and the health strip's broken count selects the broken mark.
  over: every station of a fixture whose roles are long sentences, the rendered page's scroll affordance against the map's width, the view strip's narrow rule, and the broken count of a fixture with one broken component
  via: roles are never cut mid-phrase: a component's role wraps to three lines at most, or ends at a clause, and a narrow window says the map scrolls, keeps its last tab, and reaches the broken mark from the health strip
  because: the newcomer found every Coherence role cut mid-phrase, and all three found the narrow map cut off with no sign it scrolled, the Journal tab clipped, and the only broken mark scrolled out of reach (docs/reviews/2026-09-23-structure-map-synthesis.md, items 8 and 9)
  crossing: record -> reading
  refuted: stopped widening a column for a role that would otherwise be cut mid-phrase, in roleWidth -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- motion runs caller to callee while selected: Only the direction of work moves, and only on what is selected: every drawn line runs from caller to callee, a selected route's dashes run its own path from its entrance and a selected component's run its own interfaces one hop after it lights, every line flows at one slow speed with one cycle for as long as the selection holds, clearing the selection stops all motion, broken marks never move, and with reduced motion chevrons point the same way instead.
  over: every route, line and stub of the flow, crowded, broken and trust fixtures under every selection, every pulse and tick they render, and the map's and the page's styles
  via: motion runs caller to callee while selected: every drawn line runs from caller to callee, only a selected route or component moves, every line flows at one slow speed for as long as the selection holds, and reduced motion shows chevrons instead
  because: the owner approved motion under one rule, only the direction of work moves and only on what is selected; a pulse that ran backwards would tell the reader the wrong direction; the owner then ruled (2026-09-23) that motion be slower, more subtle and constant, because a fast pulse that ended left no time to reason about it; the flow runs only while the reader holds a selection, and clearing it stops it
  crossing: record -> reading
  refuted: reversed every pulse's points in flowPulses, so the pulse ran callee to caller -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- the lexicon leads with the signal: The Lexicon view's vocabulary section leads with the attention signal, the recurring terms that lack a definition ranked most recurring first and then the senses at risk, and keeps every population and page total inside its Population and limits disclosure; a context awaits review only when its sense is at risk and no review has settled it, and the agent query answers a term with its recurrence and each context's risk before what the page left out.
  over: the rendered vocabulary section and the query answer for a projected reading holding two recurring undefined terms, a sense at risk, and an ordinary unreviewed use of a defined word
  via: Scope leads its lexicon with the ranked signal and keeps totals in the population disclosure; query shows recurrence and each context's risk
  because: the page and the query still opened on the old reading's counts (candidate terms, uses, contexts awaiting review) after the hooks had stopped injecting them, and counted every unconfirmed context as awaiting review, so an ordinary use of a defined word read as work; a count nobody can act on trains a reader to skip the section, and the ranked names are what a reader can act on (decisions d-7b070fc6, d-a77be28f)
  crossing: record -> reading
  refuted: put the old Full observed population totals line back at the head of the vocabulary section in lexicon-view.ts, ahead of the ranked signal -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- citations linked in the Journal view: Each journal record on the page lists what it cites and what cites it as in-page links to those records' cards, with kind and subject; each work order lists what its records cite, what cites it, and the journal records bound to it; a cited record the page does not embed is an id with the command that shows it, never a dead link.
  over: every journal record and work order of the fixture, a record citing a work order, a work order's close citing a decision, a pinned escalation, and a state that leaves a cited record out
  via: the Journal view links citations both ways: each record lists what it cites and what cites it as in-page links, and a work order lists its citations and bound records
  because: a relationship a human cannot follow on the page is one they will not check; linking both directions on the card lets the reader walk from an escalation to the decision it is about and back, and an absent card is named rather than linked so no link on the page lands nowhere
  crossing: record -> reading
  refuted: left what cites a record off its card in renderRecord -> the totality oracle went red in check.test.ts; restored, green (2026-09-23)
  kinds: none
- the window keeps what is cited: The page's journal window also keeps, one hop and at most CITED_WINDOW records, the older records a kept record or a work order cites, latest citer first, and counts everything it leaves out.
  over: a journal of 400 records where the latest cites an old one and a work order cites another, and one where each of the latest 150 records cites a distinct older record
  via: the journal window keeps what kept records and work orders cite, one hop, up to a cap
  because: a citation's link should land on a card, as a retraction's pointer already does; following citations without a cap would let a densely cited journal pull the whole store back into the page past its 2 MB budget (defect df-d6deded9), so the window follows one hop, serves the latest citers first, and stops at the cap, and a citation past it renders as an id with the command that shows it
  crossing: record -> reading
  refuted: made windowJournal follow no citation, so an old cited record was left out of the page -> the totality oracle went red in check.test.ts; restored, green (2026-09-23)
  kinds: none
- live updates reach a connected page: A journal record or a run appended while a page holds the event stream open reaches it as the records that are new, and the page's merge holds each once and renders it, without a reload.
  over: a journal record and a run appended to the fixture while a client holds the live reading's event stream open, and the journal view rendered from the merged state
  via: a journal record appended while a page is connected reaches it as a live update, and a run the same way
  because: the owner's words (d-eef7da19): "it would be neat if it could update with new journal content as it goes"; a reading that has to be rebuilt to show the latest record is the baked page again, and a reader who trusted it would act on a journal that had moved on
  crossing: record -> reading
  refuted: sent each journal update with no records in LiveReading.refresh -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- reconnect resumes from its cursors: A page that reconnects, to the same server or to one restarted on the root, resumes from cursors derived from the state it holds and receives every record appended while it was away, including one a slower writer stamped before its latest, holding each exactly once.
  over: records appended after the page's cursor and one stamped before it, while the page is away from a running server and across a server restart on the same address and token, against every record the page held before
  via: a page that reconnects with its cursors gets every record appended while it was away, each once, across a server restart
  because: a live page that dropped a record while its server restarted, or showed one twice, would disagree with the journal it claims to follow. The journal's cursor orders by time then id, and two writers can append out of that order, so the catch-up reaches a minute before each cursor and the merge is keyed, which makes the overlap harmless; the cursors are derived from the state, never stored beside it, so they cannot disagree with what the page holds
  crossing: record -> reading
  refuted: dropped the catch-up's slack in withSlack, so a record a slower writer stamped before the page's latest was never sent -> the totality oracle went red once it also reconnected to a running server, where only the catch-up can bring the record (across a restart the new snapshot carried it, and the same break first stayed green); restored, green (2026-09-23)
  kinds: none
