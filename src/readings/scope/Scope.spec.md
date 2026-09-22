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
  kinds: none
- component interfaces reveal their invariants: A component interface is annotated from the invariants and never authored: the chokepoint that stands on it when a chokepoint symbol is among its symbols, that invariant's crossing, and the classes of data its crossings carry; its label reads them in that order, else names its most-referenced symbols, and never a verb.
  over: every interface of the flow fixture, load-bearing and plain, and every line of every label
  via: a component interface is annotated from the invariants: its chokepoint, its crossing, the data that passes; a plain one by its most-referenced symbols, never a verb
  because: the glossary says what an interface reveals comes from the invariants; an authored relationship label rots, and the topology prototype's every arrow said consumes, which told nobody anything. Deriving the annotation from the chokepoint symbols the interface actually carries keeps load-bearing and plain honestly apart
  crossing: record -> reading
  refuted: stopped finding the chokepoints that stand on an interface in flowOf -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- structure positions are stable: Structure's layout is a pure function of entrances and component interfaces with ties broken by name, and adding one component interface moves only the components it touches; no position is stored.
  over: every component of the flow fixture before and after each of five single component interfaces is added, one of them from an entrance's component and one into a component nothing called
  via: stability: adding one component interface moves only the components it touches
  because: the owner ruled stable positions essential (structure detail, stability): a reader who learned where things are must not lose them when one reference is added, and a diff can only show what moved if nothing else did. Each station's seat is its row in folder order and its column read from its own callers (distance from where work enters, capped at two), so no other component's facts can move it; true distance would move every component downstream of the new interface's callee, and the order keeps stability over route straightness (d-1f1ce391)
  crossing: record -> reading
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
  kinds: none
- structure text never collides: No text on the Structure map overlaps other text, is truncated, or leaves the canvas or the station it is declared to sit within, under any selection; lower-priority text is dropped instead.
  over: every text element of the rendered SVG, measured by embedded font metrics, over the flow fixture and a twelve-component crowded fixture, at rest and under every entrance, route, trust level, chokepoint, component and interface selection
  via: the map's text never overlaps, is never truncated, and never leaves its canvas or its station, under every selection
  because: the owner judged the earlier map unusable partly for floating labels that overlapped and truncated (resolveRegisterTok...). Cartography's rule is that every label has a priority and lower-priority text is dropped, never overlapped; the check measures rendered text boxes from font metrics of its own rather than trusting the layout that placed them
  crossing: record -> reading
  kinds: none
- structure segments are octilinear: Every line segment the Structure map draws is horizontal, vertical, or at 45 degrees, under any selection.
  over: every path and line the rendered SVG draws as a route, an interface, a stub or a rail, over the flow fixture and a twelve-component crowded fixture, at rest and under every selection
  via: every drawn segment is horizontal, vertical, or at 45 degrees, under every selection
  because: transit maps read because their segments hold three directions; the curves of the earlier map carried no route and crossed at every angle
  crossing: record -> reading
  kinds: none
- a core dependency draws no caller arrow: A core dependency is drawn as one rail labelled once; each caller carries a short stub and no line or arrow from any caller reaches it, and no route runs through it.
  over: every caller interface of every core dependency in the flow fixture, at rest and under every selection
  via: a core dependency is a rail labelled once: its callers carry a stub and no arrow or line reaches it
  because: the earlier map fanned seven arrows into Core on the first adopter; a process drawing does not pipe a utility to every unit (d-d8c45333 records the rule that makes a component one)
  crossing: record -> reading
  kinds: none
- each structural route is one colored path: Each structural route is drawn as one path of its own color that passes through the centre of each of its stops in order, every consecutive pair of stops a component interface from caller to callee.
  over: every structural route of the flow fixture and a twelve-component crowded fixture, and every vertex of its path
  via: each structural route is one colored path through its components in order
  because: a transit map draws journeys, not connections: a route that broke into pieces or skipped a stop would not show the path work takes from its entrance (d-b72bd2e0)
  crossing: record -> reading
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
