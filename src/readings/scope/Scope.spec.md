# Scope

The reading: one surface projecting the model for a human, in six views: Glossary, Components, Structure, Invariants, Runs, Journal; and the agent query, the same state as plain text.

## entrances
- scope page: a human or agent builds the Scope page over this project or another root
  handler: main in build.ts

## invariants
- deterministic build: The same inputs in produce a byte-identical page out, and the inputs are all of them: both glossaries, the spec tree, the run records, the journal, the work store, and the component interface reading when the builder is given one.
  protects: loadState
  chokepoint: buildScopePage
  over: every byte of the page, against every input it reads: both glossaries, every spec file, every run record, every journal record, and every work record
  via: the build is deterministic: the same glossaries, specs, runs, journal and work in, byte-identical page out
  because: the page is derived and never stored as truth; a build that differed for the same input would make the derived page look like it carried something of its own. Naming only the glossaries was false in the direction that matters: appending one journal record changes the page, so a reader who trusted the sentence would have read a stale page as a fresh one. Its totality oracle appends to each store in turn and asserts both halves, that the page moved and that it is identical again
  crossing: project-source -> reading
  refuted: appended the clock to the page title in buildScopePage -> "the build is deterministic: the same glossaries, specs, runs, journal and work in, byte-identical page out" went red in check.test.ts; restored, green (2026-09-17). The narrower sentence naming the glossaries alone was falsified by appending one journal record to the fixture and seeing the page change (2026-09-18)
  kinds: encoding
  checklist: semantic-preservation declared as embedded state unchanged
  checklist: canonical-encoding declared as deterministic build
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
  because: the glossary defines reliance from references to either endpoint. Dropping protected references hides direct consumers, while calling a protected bypass a legal chokepoint reference erases the structural defect. The run's optional sites field preserves the evidence boundary: absence is legacy or unavailable, and presence means both endpoint queries completed
  crossing: record -> reading
  refuted: filtered the site list to chokepoint references alone -> the protected-only reliance assertion went red in check.test.ts; included both endpoints with their role and classification, green (2026-09-18)
  kinds: none
- bounded page: The page embeds a bounded window of the two stores that grow with every session, the run records and the journal, so its size does not grow with them, while every verdict it derives is the one every record derives and every record left out is counted.
  over: every run record and journal record of a fixture grown by 2400 journal records and 360 runs, and the latest verdict of every invariant in it
  via: the page stays bounded as the journal and the runs grow: a window of each is embedded, and every derived verdict is unchanged
  because: defect df-d6deded9: the page over Coherence passed its 2 MB budget because it embedded every run and journal record, and both grow every session (the runs were 1.16 MB of 2.06 MB). Raising the budget would only move the day it fails. The window keeps the latest records, every open escalation, what those records point at, and every run holding some enforcement's latest entry, so no derivation changes; the whole journal is one journal command away and the agent query reads every record
  crossing: record -> reading
  refuted: made buildScopePage embed every run and journal record unless a window was asked for -> the bounded-page totality oracle went red naming 451606 then 1096410 bytes; restored, green (2026-09-22)
  kinds: none
- self-contained page: The page loads nothing from outside: no external src, href, url() or @import.
  over: every src, href, url() and @import in the page
  via: the page is self-contained: no external src, href, url() or @import
  because: the reading is opened from a file on a machine with no network to assume; a page that fetched anything from outside would render differently, or not at all, by where it was opened
  crossing: project-source -> reading
  refuted: injected an external stylesheet link into the page in buildScopePage -> "the page is self-contained: no external src, href, url() or @import" went red in check.test.ts naming the link; restored, green (2026-09-17)
  kinds: output
  checklist: destination-confinement declared as self-contained page
  checklist: redaction dismissed: nothing in the glossary is sensitive; provenance is separated, not removed
  checklist: commit-ordered-effects dismissed: the page has no effect
  checklist: circuit-breaker-policy dismissed: the page has no dependency to sample
  checklist: declared-target-coverage dismissed: one file is written
- embedded state unchanged: The state embedded in the page is the loaded glossary, unchanged.
  over: every field of the loaded glossary
  via: the embedded state is the loaded glossary, unchanged
  because: the browser renders from the embedded state; a build that reshaped the glossary on the way in would show a human something other than the settled vocabulary
  crossing: project-source -> reading
  refuted: embedded an extra field beside the state in buildScopePage -> "the embedded state is the loaded glossary, unchanged" went red in check.test.ts; restored, green (2026-09-17)
  kinds: encoding
  checklist: semantic-preservation declared as embedded state unchanged
  checklist: canonical-encoding declared as deterministic build
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
- second root: With --root the page is built over another project: its spec tree, runs, journal, and glossary become the domain layer beneath Coherence's own, and its run records show its structural defects.
  over: every structural defect the first adopter's model derives from its run records, and every bypass site each carries
  via: the first adopter's tree builds as a second root: its glossary is the domain layer and its run records show its structural defects
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
  because: the glossary says what an interface reveals comes from the invariants; an authored relationship label rots, and the topology prototype's every arrow said consumes, which told nobody anything. Deriving the annotation from the chokepoint symbols the interface actually carries keeps load-bearing and plain honestly apart
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
  because: a preview is a view of a proposed change, not evidence that it happened. Writing it under the project would alter glossary population and make otherwise identical previews differ; accepting grade, verdict, or reliance from the caller would invent run evidence
  crossing: project-source -> reading
  refuted: allowed the generated preview page inside the project root -> the in-root refusal assertion went red in check.test.ts; restored outside-root confinement and generated both previews byte-identically (2026-09-18)
  kinds: none
- ambiguous property meanings stay plural: When one observed property spelling is owned by multiple concepts, Scope and query glossary display every meaning alternative with its owner, layer, definition, properties, and confusables; neither selects one owner nor calls the scalar absence an unsettled definition.
  over: every projected VocabularyTerm carrying meaningAlternatives, including a spelling shared by two concepts while scalar concept, definition, and properties are intentionally unset
  via: Scope and query glossary readings display every applicable property meaning instead of a false missing-definition line
  because: selecting one property owner would silently change the glossary meaning, while saying no definition would discard definitions the authoritative coverage already carries. The ambiguity is evidence to display, not a choice for the reading to settle
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
- origin tokens stay readable: An origin token shows at most four entrance names and a count of the rest, which the route's inspector lists in full, and its text is white on a route color darkened until white reaches 4.5:1, light and dark.
  over: a route six entrances share, and every route color and the neutral one in both themes
  via: an origin token shows at most four entrance names and a count of the rest; the route's inspector lists every one
  because: the first adopter's nineteen-name block was unreadable, and the owner asked for white text in every token, calling the dark text baffling and hard to read
  crossing: record -> reading
  refuted: showed every entrance name on its origin token, uncapped -> the totality oracle went red; restored, green (2026-09-22)
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
- the masthead leads with health: The page's masthead leads with one verdict in large type (every invariant verified, nothing enforced yet, or how many are broken) that links to its set on the Structure map, and demotes the component, invariant, run, journal and glossary counts beneath it.
  over: the masthead of a healthy fixture, one with nothing enforced, and one with a broken component, and the type sizes the page gives the verdict and the counts
  via: the masthead leads with health: one verdict in large type that links to its set, with the counts demoted beneath it
  because: the owner and security readers found the verdict too quiet: Coherence's 114 of 114 sat in small type under a masthead that led with the glossary's size and a count of bullets (docs/reviews/2026-09-23-structure-map-synthesis.md, item 3)
  crossing: record -> reading
  refuted: skipped the broken branch of flowVerdict, so a broken project's masthead read as verified -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- trust shows where work enters: Each entrance route's origin token carries the trust its entrances carry in (derived as decision d-a5e5c691 derives it), unknown when none is derived, and no control when no identifier stands where its work enters, on an interface it takes, or on the stub to its rail; the trust-level key beside the health strip makes each level a selection defined in one line, and the route's inspector and the query say the same.
  over: every route of the flow, trust, crowded, shared and no-control fixtures, its controls, its badge and where the badge sits, the key's levels, and the query's route lines
  via: trust shows where work enters: each entrance route's token carries the trust its entrances carry in, or unknown, or no control when nothing on the route controls it, and a trust-level key sits with the health strip
  because: the security reader could not tell which inputs were untrusted without reading inspector prose, and unprotected untrusted routes (document upload to IO, OAuth to Auth, the scope page to Scope) looked the same as protected ones (docs/reviews/2026-09-23-structure-map-synthesis.md, item 5). Unknown trust is treated as untrusted (d-6df8d09a), and one pill says both facts without widening the map (d-7d36881b)
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
