# Scope

The reading: one surface projecting the model for a human, in eight views: Structure, Connections, Lexicon, Components, Invariants, Practices, Runs, Journal; a fixed shell that loads its state from the warm server and follows the stores live, or carries one state as a snapshot file; and the agent query, the same state as plain text.

## entrances
- scope: a human opens the live reading from the root's warm server, or an agent writes a snapshot of this project or another root
  handler: scopeCommand in cli.ts
  trust: project-source
- scope http: a browser asks the warm server for the shell, the first load, history by cursor, and the event stream
  handler: scopeApp in live.ts
  trust: local-caller

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
- reliance comes from complete endpoint sites: The reliance reading, the reliance listing on a chokepoint invariant's card in the Invariants view, and query relies-on list actual file, line, symbol, endpoint, classification, syntax form when known, and test mark for references to either the chokepoint or protected thing; absent sites stay incomplete and only a present empty list confirms zero.
  over: every chokepoint invariant with no run, a legacy run, complete empty sites, protected-only sites, chokepoint-only sites, and both endpoints together
  via: reliance reads both protected and chokepoint endpoint sites, owner first, without calling a bypass a legal door reference
  because: the lexicon defines reliance from references to either endpoint. Dropping protected references hides direct consumers, while calling a protected bypass a legal chokepoint reference erases the structural defect. The run's optional sites field preserves the evidence boundary: absence is legacy or unavailable, and presence means both endpoint queries completed
  crossing: record -> reading
  refuted: filtered the reliance listing on the chokepoint invariant's card to chokepoint references alone, in renderRelianceOf -> "reliance reads both protected and chokepoint endpoint sites, owner first, without calling a bypass a legal door reference" went red in check.test.ts on its own assertion ("the listing keeps the reading's order, owner first": the protected sites were gone); restored from HEAD, green batched and alone (2026-10-30). Earlier: filtered the site list to chokepoint references alone -> the protected-only reliance assertion went red in check.test.ts; included both endpoints with their role and classification, green (2026-09-18)
  kinds: none
- bounded first load: The first load (the state the live server sends first, and a snapshot's state) carries a bounded window of the two stores that grow with every session, the run records and the journal, and of the reference sites the runs record, and of the relief's files only how many each component holds (a snapshot embeds whole folders up to a fixed budget), so its size does not grow with them or with the code, while every verdict it derives is the one every record derives, every record, site and file left out is counted, paging back by cursor loads every record left out, once, the sites an entry left out load by its run and enforcement, and a component's files load by its folder.
  over: every run record and journal record of a fixture grown by 2400 journal records and 360 runs, a chokepoint check grown from 800 to 8000 reference sites, and a component grown from 21 to 2021 code files, the latest verdict of every invariant in it, every page of history from the first load's hint back to the first record, the sites of the latest check, and the grown component's files
  via: the first load stays flat as the journal, the runs and the code grow, every derived verdict is unchanged, and history loads every record left out by cursor, once
  because: defect df-d6deded9: the page over Coherence passed its 2 MB budget because it embedded every run and journal record, and both grow every session (the runs were 1.16 MB of 2.06 MB). Raising the budget would only move the day it fails. The window keeps the latest records, every open escalation, every open defect, the resolution of each defect it keeps and the retraction of each record it keeps, what those records point at, and every run holding some enforcement's latest entry, so no derivation changes. With the reading live (d-eef7da19) the window bounds the first load and no longer what a reader can see: older records load on demand by cursor, a search reaches every record, and a cited record loads by id. The reference sites joined the window (d-381c0380) when they were the part that still grew: 1478 sites of one CI run were 313 KB of the page, and every chokepoint added more. The relief's files joined it when the Structure view became the relief: every file of every component rode in the first load, 3.6 MB of PostHog's 4.5 MB, though the components view draws none of them
  crossing: record -> reading
  refuted: made the live first load carry every folder's files (withSnapshotFiles with no budget) -> "the first load stays flat as the journal, the runs and the code grow, every derived verdict is unchanged, and history loads every record left out by cursor, once" went red in live.test.ts on its own assertion (286312 bytes, then 407489); restored (cmp), green (2026-10-30). Earlier: made windowState give windowRuns an unbounded site window, so the first load carried every reference site of the latest entries -> "the first load stays flat as the journal and the runs grow, every derived verdict is unchanged, and history loads every record left out by cursor, once" went red in live.test.ts on its own assertion (294073 bytes, then 1172251); restored (cmp), green batched and alone (2026-10-12). Earlier: made windowState return the whole state, so the first load carried every run and journal record -> the totality oracle went red; restored, green (2026-09-23). Before the reading was live: made buildScopePage embed every run and journal record -> red naming 451606 then 1096410 bytes; restored, green (2026-09-22)
  kinds: none
- an older run carries only what it holds: In the first load, a run older than the latest window that is kept because it holds some enforcement's latest verdict carries only the entries it holds, and the verdicts of its other entries as counts, so the Runs view shows its whole run's totals and says how many later runs superseded, and the page's size does not grow with how many entries old full runs had.
  over: a full run of five entries of which later runs re-check four, three later runs, and a window of two
  via: an older run kept for the verdicts it holds carries only those, and its totals stay true on the Runs view
  because: the page over Coherence stood 2.5 KB under its 3 MB budget, and each merge that added specs or records crossed it: eight old full runs of 85 to 251 entries, each kept whole for a few latest verdicts, were 450 KB of it. Carrying only the held entries took the page from 3,143,164 to 2,697,075 bytes with every latest verdict unchanged
  refuted: kept every older holder run whole -> "an older run kept for the verdicts it holds carries only those, and its totals stay true on the Runs view" went red in check.test.ts; restored byte for byte (cmp), green (2026-10-08)
  kinds: none
- reference sites in one window: In the first load, the latest chokepoint entries together list at most SITE_WINDOW reference sites besides their bypass sites, which they always list, shared evenly between them, and every site left out is counted on its entry by component, endpoint, class and test mark, so the page's size grows with neither the code nor the number of chokepoints, every count derived from sites (the flow model's reference weights, the exempt references, the bypass sites, the reliance totals) is the one every site gives, and the reliance listing on the chokepoint invariant's card says how many sites it lists and where the rest are, and on a live page loads them.
  over: five and then sixty chokepoint entries of 400 sites each beside one of three, the fixture's chokepoint with 2000 sites across its components, a test file and an exempt folder, on a snapshot and on a live page
  via: the first load carries at most the site window's reference sites however many chokepoints and sites the runs record, counts every site it leaves out, and derives every site count unchanged
  because: the latest entries kept their sites whole, so the runs grew with the code times the chokepoints: one CI run of 23 chokepoints held 1478 sites, 313 KB, and a branch adding six chokepoints took the page to 3,153,977 bytes, over its 3 MB budget. A cap per entry still grows with every chokepoint, and a compact form of each site only slows the growth; one window over the whole page makes the sites' cost a constant (d-381c0380), and counting the rest by the keys every derivation over sites reads keeps those counts exact, with nothing dropped unsaid. The live page loads an entry's other sites from its server, and a snapshot names query relies-on, which reads every run whole
  refuted: made the reliance listing on the chokepoint invariant's card leave out the sites the window counted and did not list, in renderRelianceOf, so it no longer said where the rest are nor offered to load them -> "the first load carries at most the site window's reference sites however many chokepoints and sites the runs record, counts every site it leaves out, and derives every site count unchanged" went red in check.test.ts on its own assertion ("a snapshot says where the rest are"); restored from HEAD, green batched and alone (2026-10-30). Earlier: gave each latest chokepoint entry a window of its own (SITE_WINDOW times the entries), a cap per entry, in windowRuns -> "the first load carries at most the site window's reference sites however many chokepoints and sites the runs record, counts every site it leaves out, and derives every site count unchanged" went red in check.test.ts on its own assertion (5 chokepoints: 2003 sites carried); restored (cmp), green batched and alone (2026-10-12)
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
- deep links resolve: Every card id on every view resolves, by its prefix, to the view that renders it, a hash naming a view alone resolves to that view, a reliance id opens the Invariants view on the reliance listing of its invariant's card, the retired Reliance view opens Invariants, a link into the retired security spine or Structure map selections opens the Structure view, and a connections id opens the Connections view on the origin it names.
  over: every card id every view renders for the fixture project, every link the Invariants view carries, every reliance listing it renders, and the connections id of every component of the fixture project
  via: deep links resolve: every card id on every view resolves to that view
  because: a link into a card on another view must open that view first or it lands nowhere; one id space with a prefix per view is decided in one function, and the check walks every rendered id through it
  crossing: reading -> reading
  refuted: dropped the reliance- prefix from the ids resolveHash maps to the Invariants view, so a link to a reliance listing landed nowhere -> "deep links resolve: every card id on every view resolves to that view" went red in check.test.ts on its own assertion ("link #reliance-src-store-single-writer resolves"); restored from HEAD, green batched and alone (2026-10-30). Earlier: gave run cards a prefix no view claims in runId -> "deep links resolve: every card id on every view resolves to that view" went red in check.test.ts; restored, green (2026-09-17)
  kinds: none
- second root: With --root the page is built over another project: its spec tree, runs, journal, and lexicon become the domain layer beside Coherence's own, and its run records show its structural defects.
  over: every structural defect another project's model derives from its run records, and every bypass site each carries, for a project holding its own lexicon, specs and runs
  via: another project's tree builds as a second root: its lexicon is the domain layer and its run records show its structural defects
  because: a reading that rendered only Coherence's own tree would never have shown the two broken chokepoints the first adopter's runs recorded; the check reads a fixture project, so it runs on every machine rather than only where the first adopter's checkout sits
  crossing: record -> reading
  kinds: none
- component interfaces reveal their invariants: A component interface is annotated from the invariants and never authored: the chokepoint that stands on it when a chokepoint symbol is among its symbols, that invariant's crossing, and the classes of data its crossings carry; its label reads them in that order, else names its most-referenced symbols, and never a verb.
  over: every interface of the flow fixture, load-bearing and plain, and every line of every label
  via: a component interface is annotated from the invariants: its chokepoint, its crossing, the data that passes; a plain one by its most-referenced symbols, never a verb
  because: the lexicon says what an interface reveals comes from the invariants; an authored relationship label rots, and the topology prototype's every arrow said consumes, which told nobody anything. Deriving the annotation from the chokepoint symbols the interface actually carries keeps load-bearing and plain honestly apart
  crossing: record -> reading
  refuted: stopped finding the chokepoints that stand on an interface in flowOf -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- structure positions are stable: The placement flowOf gives each component, the row and column query structure prints, is a pure function of entrances and component interfaces with ties broken by name, and adding one component interface never reorders the components it does not touch: only what the interface reaches (its callee and what the callee reaches, or everything its caller reaches when the interface stops the caller being a core dependency) may change column, and within a column components keep folder order, so no two components that keep their columns change places; no position is stored.
  over: every component of the flow fixture before and after each of seven single component interfaces is added, one from an entrance's component, one into a component nothing called, and two that bring a callee and everything it reaches nearer to the entrances, and every pair of components that keep their columns
  via: stability: adding one component interface never reorders the components it does not touch
  because: the owner ruled stable positions essential: "Stable positions are essential and that rule makes sense" (structure detail, stability); a reader who learned where things are must not lose them when one reference is added, and a diff can only show what moved if nothing else did. The map that drew it is retired (the relief places components by co-change, seeded from its last layout), so the placement is the one query structure prints: an agent comparing two readings sees only what moved. The first transit pass kept the rule that only an interface's two ends move by capping columns at two (d-1f1ce391), and the cap was a defect: routes doubled back to columns they had left (four of eight on Coherence, one of four on the first adopter). Columns are now true distance from where work enters, which necessarily brings the new interface's callee and everything it reaches nearer, so the rule is stable relative order (d-41cad841)
  crossing: record -> reading
  refuted: ordered each column by the row its route predecessors ask for (a barycenter order) instead of folder order, in flowOf -> the totality oracle went red naming src/scheduler and src/storage reordered by adding . -> src/indexer; restored, green (2026-09-22, refutation recorded by refute). The same break left the flow fixture alone green, its columns holding one or two components, so the totality oracle now also runs over the crowded fixture. Before the rule changed: made every component's column past the entrances depend on how many interfaces the whole map has -> red; restored, green (2026-09-22)
  kinds: none
- structure flow and query structure share one derivation: Query structure prints every structural route, core dependency, and interface identifier of the one flowOf derivation, each as the derivation holds it.
  over: every structural route with its stops in order, every core dependency, and every interface identifier on every interface it stands on, over the flow fixture and a twelve-component crowded fixture
  via: query structure prints the structural routes, core dependencies and interface identifiers of the one flowOf derivation
  because: an agent and a human reading different routes of one project would each be told a different story about the system; one derivation read twice cannot drift
  crossing: reading -> reading
  refuted: reversed the route order only in query structure -> the totality oracle went red; restored, green (2026-09-22)
  kinds: none
- ambiguous property meanings stay plural: When one observed property spelling is owned by multiple concepts, Scope and query lexicon display every meaning alternative with its owner, layer, definition, properties, and confusables; neither selects one owner nor calls the scalar absence an unsettled definition.
  over: every projected VocabularyTerm carrying meaningAlternatives, including a spelling shared by two concepts while scalar concept, definition, and properties are intentionally unset
  via: Scope and query lexicon readings display every applicable property meaning instead of a false missing-definition line
  because: selecting one property owner would silently change the lexicon meaning, while saying no definition would discard definitions the authoritative coverage already carries. The ambiguity is evidence to display, not a choice for the reading to settle
  crossing: record -> reading
  refuted: ignored meaningAlternatives and formatted the unset scalar definition as missing -> the shared Scope/query reading test went red; restored every alternative, green (2026-09-18)
  kinds: none
- routes split by trust: Entrances share a structural route only when they share its stops and the trust they carry in (the level each declares, else the entering side of the crossings whose chokepoint is its handler, and declared never shares with derived); an entrance whose handler is a chokepoint wears that identifier on the line where work enters.
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
- interfaces read only within the declared components: The component interface reading asks only about declarations in component code, the non-test files the config's bounds keep, each belonging to its nearest component alone; a reference site inside the bounds in code no component owns is counted into its callee, never drawn and never dropped, code past the bounds is never counted, and the Structure view's notes and query structure say so.
  over: every declaration and every reference site of the bounded fixture: two components, code no component owns, and a folder the config's ignore list bounds away
  via: interfaces read only within the declared components
  because: on a PostHog adoption whose root component is the whole monorepo the reading asked every declaration of some 19,700 files and never finished; the map draws interfaces between the project's components, and the config's bounds are the adopter's own word for what the project is. A caller the reading found outside every component is counted, so the bound is never a silent drop
  crossing: instrument -> reading
  refuted: dropped every reference site in code no component owns, in readComponentInterfaces, instead of counting it into its callee -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- the prefilter never hides a cross-component reference: A declaration is asked for its references only when component code of another component spells its name or an alias it is given, star-imports or wildcard re-exports its module, or it is a default export, and a handler's reach asks what the files it has entered spell; the reading so asked is the reading that asks every declaration, interface for interface, site for site, and reach for reach.
  over: every component interface, site count and entrance reach of a TypeScript project with a wildcard re-export, a renamed re-export, an alias and a default export, of a Python project with a star import, an alias and a getattr string, and of the bounded fixture, each read with and without the word index
  via: the prefilter never hides a cross-component reference
  because: a language server reports a reference only where the text names the thing, so a name no other component's text spells cannot have a site there; the escape hatches (a star import or wildcard re-export spells no name, an alias or default import spells another) are exactly where that argument needs help, and each is handled rather than assumed away
  crossing: instrument -> reading
  refuted: stopped asking about a declaration whose module another component wildcard re-exports or star-imports, in namedElsewhere -> the totality oracle went red on the TypeScript escape hatches; restored, green (2026-09-23)
  kinds: none
- the interface reading is bounded in time and says when it is partial: The component interface reading stops asking when its time budget or its language server's memory budget is spent, the config's interfaceBudget or ten minutes and twelve gigabytes by default, the bounded server's heap raised above that budget, keeps what it read, and the Structure view's notes and query structure say it is partial, which budget stopped it, and whose declarations were not all read; a stalled server never holds it past its budget.
  over: a server that never answers one question, a server over its memory ceiling, a reading that finishes, and the budget from the config and from a flag, each through the reading, the Structure page and query structure
  via: the interface reading is bounded in time and says when it is partial
  because: the reading of a PostHog adoption ran 30 to 90 minutes with its language server at 3.5 GB and never finished, and nothing said so; a partial map presented as complete would be worse than none, since a missing interface reads as no dependency
  crossing: instrument -> reading
  refuted: awaited the language server's answer without racing it against the deadline, in readComponentInterfaces' within, so a stalled server held the reading -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- a file the server cannot answer is named, never the language: When a language's server fails a question about one file, the component interface reading leaves that file's declarations unread, names the file with the server's words, and reads every other file of the language; the Structure view's notes and query structure say the reading is partial and which files, and only a server that is not up leaves the language unread. The economy of a change to such a file is still said, its line naming what the server could not answer, and an observation's interface map names the file and reads the rest.
  over: a server that fails every question about one file of a component while it answers the component's other files, and one that answers every file, through the reading, the Structure page, query structure, the economy of a change to that file and an observation's interface map
  via: a file the language server cannot answer for is named and left unread while the rest of the language is read
  because: gopls has no package for a Go file outside the host's build (requester/now_windows.go in rakyll/hey on macOS), and one such failure threw away the whole Go reading, so a Go project with any platform file read no Go at all (df-53e501ca); a partial map that names the file is worth more than none, and recording it lets the hooks read it instead of reading the tree again each session
  crossing: instrument -> reading
  refuted: made the interface reading rethrow a server's failure on one file, so the language's whole reading ends unread as before -> "a file the language server cannot answer for is named and left unread while the rest of the language is read" went red in component-interfaces.test.ts; restored, green (2026-10-23)
  refuted: made the economy closure rethrow a server's failure on one file, so the economy of a change to it fails as before -> "a file the language server cannot answer for is named and left unread while the rest of the language is read" went red in component-interfaces.test.ts on the economy's rejection; restored, green (2026-10-23)
  refuted: made the observation's interface map rethrow a server's failure on one file, so run --observe loses every interface as before -> "a file the language server cannot answer for is named and left unread while the rest of the language is read" went red in component-interfaces.test.ts; restored, green (2026-10-23)
  kinds: none
- a refused question is kept like an answer: A references question the language server answered with its own error is kept beside the kept answers, its words as the reason and dropped by the same rule as an answer, so a reading of a tree where nothing it rests on changed never starts the server to ask it again and still names the file unanswered with those words, and a change to that file asks again; a failure the server never returned (an exit, a spawn failure, a timeout) is never kept and is asked again by the next reading.
  over: a server that refuses every question about one file, a server that crashed on it, and the same file after an edit, through readings with the kept answers on, each through a server that counts every start and question
  via: a question the server refused is kept like an answer until its file changes, and a crash is asked again
  because: tsserver 5.9.3 overflows its stack answering references on one file in glimmervoid (2026-10-31); since nothing was kept for it, every reading of an unchanged tree started a 545 MB server only to be refused again, while the kept line said nothing was asked anew; an exit or a timeout may be transient, so only the server's own answer is kept
  crossing: record -> reading
  refuted: dropped the kept failure from referencesOf, so a refused question is asked again -> "a question the server refused is kept like an answer until its file changes, and a crash is asked again" went red in component-interfaces.test.ts on its own assertion (the server started once, expected never); restored (cmp), green batched and alone (2026-10-31)
  refuted: kept every failure but a server that is not up, crashes included -> "a question the server refused is kept like an answer until its file changes, and a crash is asked again" went red in component-interfaces.test.ts on its own assertion ("a crash is asked again"); restored (cmp), green batched and alone (2026-10-31)
  kinds: none
- the masthead leads with health: The page's masthead leads with one verdict in large type (every invariant verified, nothing enforced yet, or how many are broken) that links to the Structure view, and demotes the component, invariant, run, journal and lexicon counts beneath it.
  over: the masthead of a healthy fixture, one with nothing enforced, and one with a broken component, and the type sizes the page gives the verdict and the counts
  via: the masthead leads with health: one verdict in large type that links to Structure, with the counts demoted beneath it
  because: the owner and security readers found the verdict too quiet: Coherence's 114 of 114 sat in small type under a masthead that led with the lexicon's size and a count of bullets (docs/reviews/2026-09-23-structure-map-synthesis.md, item 3)
  crossing: record -> reading
  refuted: skipped the broken branch of flowVerdict, so a broken project's masthead read as verified -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- declared trust wins: An entrance's declared trust level is its route's trust even where a crossing on its handler would derive another; only without one is it derived, and declared and derived never share a route.
  over: the trust fixture's entrances with and without a trust: line, on a handler with a crossing and one without
  via: an entrance's declared trust level is its route's trust, even where a crossing on its handler would derive another
  because: the ruling d-ba18b0fd: derived trust left Coherence's own commands reading no control; derivation (d-a5e5c691) is the fallback
  crossing: project-source -> reading
  refuted: ignored the entrance's trust: line in flowOf, so its route took the trust derived from the crossing on its handler -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- no traced control marks only the untrusted: No traced control marks an entrance route only when no control is traced on it and its trust is unknown, undeclared, or a level marked outside the system's control; a route carrying an inside level shows that level, unmarked.
  over: the reader's untraced route carrying unknown, outside, undeclared, inside, and an unmarked level named outside; in the model and its query line
  via: no traced control marks only an untrusted route with nothing traced on it: unknown trust or a level from outside the system's control, never a trusted one
  because: the ruling d-ba18b0fd: marking the owner's own commands beside the warm server's port made one exposure look like nine; unknown stays untrusted (d-6df8d09a)
  crossing: project-source -> reading
  refuted: marked every untraced entrance route no traced control in flowOf, whatever trust it carries in -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- a chokepoint switched off earns no credit: A chokepoint bullet's unless: line names one option; an entrance whose handler's own declaration calls the chokepoint only with that option passed as a literal true earns no credit from it and its entrance carries the chokepoint as switched off, which the query names on its route; a call with the check on, or with the option passed any other way, keeps the credit; unless: on a bullet with no chokepoint form, or naming anything but one property, is a problem.
  over: the routed fixture's check called plain, with skip: true, with skip passed as a variable, and not at all, with and without unless: skip; calls with brackets and strings in their arguments, a qualified call, one call on and one off; and unless: on a chokepoint, on a totality oracle, and naming an expression
  via: a chokepoint whose every call in a handler passes the option its unless: line names as true credits that handler nothing, and is named switched off; a call with the check on, or the option not a literal true, keeps the credit
  because: d-c65b7cd1: on umami seven routes call parseRequest(request, schema, { skipAuth: true }), and Structure credited the parseRequest chokepoint as their traced control, so the reading said no entrance lacked one while none of them runs authentication; with the PR build the reading traced a skipAuth route and a route with the check on identically
  crossing: project-source -> reading
  refuted: made the reading keep every chokepoint's credit whatever its calls pass, the switched-off filter in readLanguage never applied -> "a chokepoint whose every call in a handler passes the option its unless: line names as true credits that handler nothing, and is named switched off; a call with the check on, or the option not a literal true, keeps the credit" went red in component-interfaces.test.ts on its own assertion (the skip: true handler kept its wrapper credit); restored from a copy, byte for byte, green batched and alone (2026-10-28)
  kinds: none
- controls are traced four ways: A route's controls are the identifiers on its lines (any verdict, which the identifier wears) and, verified only, a chokepoint wrapping its entrances' handler (its own declaration references the chokepoint and its reach reaches the protected thing, or its guard: line names the chokepoint and a registration of the handler spells it), a chokepoint whose invariant a component on the route owns and whose protected thing the handler's reach reaches, and an invariant enforced by a totality oracle alone whose entrances: line names the entrance; every kind but the wrapper counts only when its invariant's crossing enters from a trust level the route carries in or enters one, so a chokepoint guarding another boundary, or declaring none, is never a control on the caller however far the reach runs; a control beyond the lines counts on a route only when every entrance on it passes it, one only some pass is listed apart and never counted, and the query names each with its kind and invariant.
  over: the untraced reader route with a wrapper, a declared guard, a chokepoint inside a component on it and off it, a chokepoint inside whose crossing enters from its trust, enters it, joins two other levels, or is absent, a wrapper whose crossing joins two other levels, an invariant enforced by a totality oracle alone entering from its trust, entering it and from another, one enforced by a chokepoint too, and each unverified, a route of two entrances only one of which is wrapped, and a route carrying outside in whose lines hold an identifier whose crossing enters from outside, enters it, joins two other levels, or is absent
  via: a route's controls are traced four ways, verified only: an identifier on its lines, a chokepoint its handler is registered through, a chokepoint inside a component on it whose protected thing its reach reaches, and a totality oracle on it, each but the wrapper only when its crossing enters from the route's trust or enters it
  because: the owner's ruling d-127ab8e4: stl.quest's verified totality oracles, praetorium.gg's shared RPC wrapper (179 routes read no control), and the tenant guard inside a HogQL component (posthog/hogql/printer) all controlled routes the map called uncontrolled, because only identifiers on inter-component lines counted; and the A/B resolution c-9941b95e found the reach reaches nearly every protected thing on praetorium.gg and stl.quest, so a chokepoint inside counted by reach alone closed routes it never checks: a command log (player -> storage) and a spectating filter (storage -> visitor) stood for apple notifications (platform), and an asset migration registry (operator -> workspace) for every browser and provider route on stl.quest, which read 0 gaps in name only
  crossing: project-source -> reading
  refuted: staged the old rule in flowOf, an identifier on the route's lines and a chokepoint inside counting whatever their crossing -> the totality oracle went red; restored, green (2026-09-28)
  kinds: none
- a test-backed control is the entrance's own: A verified invariant enforced by a totality oracle alone counts as a control on an entrance only when its entrances: line names that entrance, wherever the invariant is owned; owning the component that declares or handles the entrance, or standing further along its route, covers it no longer, and an entrance it covered that way names the invariant as a control it lost.
  over: the reader route with a verified totality oracle naming its entrance, owned by the reader, which handles it, and by the store further along; the same totality oracle naming no entrance, in the reader and in the store; and one naming another entrance
  via: a test-backed control counts on the entrances its invariant names and on no other: neither owning the component that declares or handles an entrance nor standing further along its route covers it
  because: the owner ruled on 2026-09-25 that real gaps are a great start: on praetorium.gg's own code an unrelated database test (stale command stays out of log) stood as the control for 120 entrances, read-only calls among them, and on stl.quest an asset totality oracle in a child folder counted for page routes that never reach it; narrowing that to the owning component still let praetorium.gg's apple signature check stand for every visitor route in src/routes, a crawler file among them, since a crossing says which trust an invariant checks and never where it enters
  crossing: project-source -> reading
  refuted: counted a totality oracle owned by any component the route passes, in flowOf -> the totality oracle went red; restored, green (2026-09-25)
  refuted: restored the owner rule in flowOf, a totality oracle counting on every entrance its component declares or handles whose trust its crossing checks -> the totality oracle went red; restored, green (2026-10-08)
  kinds: none
- an invariant covers the entrances it names: Of an adopter's visitor routes, a verified signature check naming its notification route controls that route alone; the sign-in, crawler and preview routes beside it, and a server function declared among the routes whose handler shares a folder with a test-backed invariant of its own, stay uncontrolled, and entrances an invariant names never share a route with ones it does not, so its control counts for those it names.
  over: praetorium.gg's shape: the apple notification, auth, robots and preview routes and a server function handled in src/server, all carrying visitor in, beside a signature check whose crossing is visitor -> account store and a server invariant naming no entrance
  via: an invariant covers the entrances it names: the adopter's apple signature check controls its notification route alone, and the auth, crawler and preview routes beside it and a server function sharing src/server stay uncontrolled
  because: on praetorium.gg (richardsolomou/praetorium.gg#832) the signature check's crossing matched every visitor entrance its folder declared, so robots, auth and well-known routes read controlled, and Scope credited it to server functions for sharing src/server; and a control only some of a route's entrances pass was never counted, so naming one entrance on a shared route would have controlled none
  crossing: project-source -> reading
  refuted: restored the owner rule in flowOf -> the totality oracle went red; restored, green (2026-10-08)
  refuted: dropped the named invariants from what entrances must share to share a route, in flowOf -> the totality oracle went red; restored, green (2026-10-08)
  kinds: none
- crossing alone covers no entrance and says so: An invariant enforced by a totality oracle alone that names no entrance covers none, its own included; each entrance carrying outside trust in that it covered by its crossing alone (owned where the entrance is declared or handled, and verified) names it as a lost control on its gap, and orient's gap line counts those gaps, names the invariant covering the most, and says to name them on its entrances: line.
  over: praetorium.gg's shape with the signature check written as the adopter had it, with no entrances: line: the notification, auth, robots and server function routes, which lost it, the preview route, which never had it, their gaps and orient's line
  via: an invariant that covered entrances by its crossing alone covers none, and each entrance that lost it says so: its gap and orient's line name the invariant and the entrances: line
  because: an adopter's invariants that relied on the broad credit lose it with this change, and an entrance that turns into a gap with no word of why reads as a regression, or is baselined away; the loss is the over-claim corrected, so it is said where the agent reads its gaps, with the one line that restores a control the test really gives
  crossing: project-source -> reading
  refuted: left the lost control out of each gap in gapsOf -> the totality oracle went red; restored, green (2026-10-08)
  kinds: none
- the reading traces what a handler passes: The interface reading records, per entrance, each chokepoint whose protected thing the handler's static reach reaches, as a wrapper when the handler's own declaration references the chokepoint; a guard: line is confirmed only when the handler's declaration or a statement referencing the handler spells the guard; and a module handler's reach starts from its file's top-level script: every declaration of the file and every reference a top-level statement makes (a variable inside a top-level block counting as its statement), an import excepted.
  over: a wrapped handler, one reaching the chokepoint through another, one registered through the guard in another file, one no registration guards, and a script whose call sits in a top-level try block, read by the TypeScript adapter
  via: the reading traces the chokepoints a handler passes: a wrapper around it, one further along its reach, a declared guard at its registration, and a module handler's top-level script
  because: praetorium.gg registers its handlers through mutationRpc, whose origin check the trace never saw because it started at the handler, and module-top-level scripts had no way to declare a command entrance (d-127ab8e4)
  crossing: project-source -> reading
  refuted: marked every chokepoint a handler passes as further along its reach in guardsOf, never a wrapper -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- a registry entry is its declaration's use: A reference the language server encloses in no symbol, inside a top-level statement that declares a name (a multi-line registry dict, a factory call's arguments), is that declaration's own use, so a handler's reach follows a registry to what it registers; an import or a statement that declares nothing stays unattributed.
  over: a Python handler that dispatches through a module-level registry dict whose entry is a guarded function, read by the Python adapter
  via: a reference inside a multi-line top-level initializer is that declaration's own use, so a handler's reach follows a registry to the guard inside
  because: HogQL chooses its SQL writer class from PRINTER_CLASSES, a module-level dict; Pyright names no symbol for the dict's lines, so every route stopped short of posthog/hogql/printer and the tenant guard inside it read as untraced (d-127ab8e4)
  crossing: project-source -> reading
  refuted: dropped the enclosing top-level declaration for a site the server names no symbol for, in readComponentInterfaces -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- entrance coverage is one derivation: Every entrance the reading detects is covered individually, covered through a grouped entrance, or undeclared, by one derivation (coverageOf) that query structure, Scope's masthead and orient all read: a declared entrance covers what its handler names (a symbol in its file, a symbol registered elsewhere by name, a file-grain entrance by its file) and, when its handler names nothing detected, what is registered through that handler or detected in its module; a detected entrance is covered individually when some entrance covering it covers nothing else. The query lists every undeclared one with its rule and why, the masthead counts them, and orient gives the same counts.
  over: every detected entrance of a fixture with entrances declared one each, grouped through a wrapper, grouped by module, registered elsewhere, file-grain and undeclared, a declared entrance that covers nothing, and the counts the query, the masthead and orient give over the check fixture
  via: entrance coverage
  because: c-3760638e: the spec-gap count rewards declaring fewer, coarser entrances, so in the A/B adoption test on one commit stl.quest declared 14 entrances in one arm and 94 in the other, and praetorium.gg 25 and 119, and their gap counts could not be compared. Coverage makes the grain visible: stl.quest's 14 cover 94 of 106 detected, 85 of them through four grouped entrances, and its 94 cover 94 one each; praetorium.gg's 25 cover 21 of 157 and its 119 cover 116. One derivation read three times keeps the agent and the human from being told different numbers
  crossing: project-source -> reading
  refuted: counted every covered detected entrance as covered individually, ignoring how many its entrance stands for, in coverageOf -> the totality oracle went red; restored, green (2026-09-28)
  kinds: none
- undeclared entrances are a neutral count: Scope's masthead gives how many of the detected entrances are undeclared beneath the verdict, in its quiet ink, never in the attention color nor as a gap; nothing when none is detected or every one is declared.
  over: the check fixture with two undeclared detected entrances, and the same with none detected
  via: undeclared entrances are a neutral count: the masthead gives how many of the detected are undeclared, in quiet ink, never in the attention color nor as a gap
  because: d-a37af46f: undeclared is the normal state of a detected entrance, and the strip showed the count in amber, the color of no traced control, so a first adoption read its whole undeclared surface as findings; kept in the masthead so it is never a quiet place to leave routes (d-a1095ef2). The health strip went with the old Structure map
  crossing: project-source -> reading
  refuted: dropped the undeclared count from the masthead's detail line -> "undeclared entrances are a neutral count: the masthead gives how many of the detected are undeclared, in quiet ink, never in the attention color nor as a gap" went red in entrance-coverage.test.ts on its own assertion; restored from HEAD, green batched and alone (2026-10-30)
  kinds: none
- the lexicon leads with the signal: The Lexicon view's vocabulary section leads with the attention signal, the recurring terms that lack a definition ranked most recurring first and then the senses at risk, and keeps every population and page total inside its Population and limits disclosure; a context awaits review only when its sense is at risk and no review has settled it, and the agent query answers a term with its recurrence and each context's risk before what the page left out.
  over: the rendered vocabulary section and the query answer for a projected reading holding two recurring undefined terms, a sense at risk, and an ordinary unreviewed use of a defined word
  via: Scope leads its lexicon with the ranked signal and keeps totals in the population disclosure; query shows recurrence and each context's risk
  because: the page and the query still opened on the old reading's counts (candidate terms, uses, contexts awaiting review) after the hooks had stopped injecting them, and counted every unconfirmed context as awaiting review, so an ordinary use of a defined word read as work; a count nobody can act on trains a reader to skip the section, and the ranked names are what a reader can act on (decisions d-7b070fc6, d-a77be28f)
  crossing: record -> reading
  refuted: put the old Full observed population totals line back at the head of the vocabulary section in lexicon-view.ts, ahead of the ranked signal -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- the project's vocabulary comes first: The Lexicon view shows the project's vocabulary first, its signal and then its lexicon or the note that it has none, and Coherence's own terms after it, in a section of their own under a heading that names them as Coherence's; Coherence's layer is titled as Coherence's whatever the project is called, and the masthead counts the project's lexicon when it has one.
  over: a project with its own lexicon and one without, under a project name other than Coherence
  via: the project's vocabulary comes first and Coherence's terms follow in a section of their own, titled as Coherence's whatever the project is called
  because: the owner ruled it: a reader opens the Lexicon for the project's words, and Coherence's concepts led the page ahead of them; and an adopter's page titled Coherence's layer with the project's own name (Praetorium lexicon beside Praetorium.gg lexicon), so the tool's terms read as the project's
  crossing: record -> reading
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
- coverage never stalls the warm server: The warm server's first load, and every snapshot a reload sends, go without waiting for the vocabulary coverage: they carry it as still being read, and the Lexicon view and the agent query say so, never a zero in its place; the reading, the kept reading the hooks keep too, is taken on one worker thread that every caller asking at once shares, and reaches the page as an update, or in the snapshot its stream opens with when it landed before the stream did.
  over: a live reading whose coverage readings are held until released: its first load, the Lexicon view and the query answer while held, a request answered meanwhile, a page whose stream opens after the reading landed, a spec change's reloaded snapshot and the reading that follows it; and two callers asking the worker at once
  via: coverage never stalls the warm server: the first load is sent before the coverage is read and says it is being read, the reading arrives as an update, a reload carries it as being read again, and the reading runs on one worker thread however many ask
  because: the page's build took a full coverage reading on every load, a scan of every prose and code file on the warm server's one event loop, which also answers the agent's hooks; a scan bound by the processor blocks the loop however it is awaited. On the PostHog checkout the first load took 81 s and a ping every 50 ms went unanswered for 51 s. The kept reading (vocabulary-state.ts) already held what the hooks read at a session's start and stop, but serving even that is git, a parse of what was kept and the page's projection, 2.6 s there, so it runs on a worker that hands back only the projection (d-df7132b1). A reading that lands between a page's first load and its stream moves the state's version, so the stream opens with a snapshot holding it, and a reload says the coverage is being read again rather than show one its change may have made untrue (d-8b40c483). After it, on the same checkout, the coverage stalled no ping, kept or cold
  refuted: made the first load (/api/state in LiveReading.handle) await the coverage reading before answering -> "coverage never stalls the warm server: the first load is sent before the coverage is read and says it is being read, the reading arrives as an update, a reload carries it as being read again, and the reading runs on one worker thread however many ask" went red in live.test.ts on its own assertion (the first load waited on the coverage reading); restored (cmp), green batched and alone (2026-10-30)
  kinds: none
- every file the model reads refreshes the live reading: A change to any file the spec model reads by its name (a spec, a practice file, the config, and any kind of file the model's walk begins to select) or to a lexicon the state loads reloads the live reading's state; the live reading asks the spec model's own test of what it reads, and locates the lexicons as the state's load does (wherever the config names one), so no list of names can leave one out.
  over: every spec and practice file the spec model read for a project with a root spec, a component and a practice beside its spec, the config, a practice file not yet written, a source file the model never reads by name, and a project whose config names its lexicon outside the default name
  via: every file the spec model reads by name refreshes the live reading: each spec and practice file it read for a project with components and a practice, and the config
  because: the live reading's watch named .spec.md, the config and the lexicons by hand (278a5a1), and practice files became a model input after it (d3a7e3a) without being added, so editing a practice left the Practices view stale until something else changed; its lexicons were lexicon.json and docs/lexicon.json by name, so one the config names elsewhere never refreshed it either; the model's walk and the watch now select through one function, so a kind the model begins to read is watched with it
  refuted: made storeOf name the model's files by hand again (.spec.md and the config), not through the spec model's readByModel, and separately made watchedLexicons take only a domain path given in the build options -> "every file the spec model reads by name refreshes the live reading: each spec and practice file it read for this repository, and the config" went red in live.test.ts on its own assertion each time; restored (cmp), green batched and alone (2026-10-11)
  refuted: once the test read a fixture project in place of Coherence's whole tree, made storeOf name the model's files by hand again (.spec.md and the config) -> "every file the spec model reads by name refreshes the live reading: each spec and practice file it read for a project with components and a practice, and the config" went red in live.test.ts on its own assertion (the fixture's practice file was no model file); restored byte for byte (cmp, same as HEAD), green batched and alone (2026-10-13)
  kinds: none
- reconnect resumes from its cursors: A page that reconnects, to the same server or to one restarted on the root, resumes from cursors derived from the state it holds and receives every record appended while it was away, including one a slower writer stamped before its latest, holding each exactly once.
  over: records appended after the page's cursor and one stamped before it, while the page is away from a running server and across a server restart on the same address and token, against every record the page held before
  via: a page that reconnects with its cursors gets every record appended while it was away, each once, across a server restart
  because: a live page that dropped a record while its server restarted, or showed one twice, would disagree with the journal it claims to follow. The journal's cursor orders by time then id, and two writers can append out of that order, so the catch-up reaches a minute before each cursor and the merge is keyed, which makes the overlap harmless; the cursors are derived from the state, never stored beside it, so they cannot disagree with what the page holds
  crossing: record -> reading
  refuted: dropped the catch-up's slack in withSlack, so a record a slower writer stamped before the page's latest was never sent -> the totality oracle went red once it also reconnected to a running server, where only the catch-up can bring the record (across a restart the new snapshot carried it, and the same break first stayed green); restored, green (2026-09-23)
  kinds: none
- a rebuild never holds the live routes: A change that reloads the model is read apart from the live reading's update chain, one rebuild at a time with at most one more asked for behind it, which every later change shares; while it reads, the first load, history, a record by id and every store's push answer at once from the state held, and each rebuild lands as one snapshot with a new version that keeps the journal, runs and work orders the chain read, so a record appended meanwhile reaches a page once, as an append, and none is lost across the landing.
  over: a model rebuild held after its own read of the stores, the state, journal, runs and record routes asked while it is held, a journal record and a run appended while it is held, two more spec edits while it is held, and the snapshots that land once it is released, folded into a page
  via: a rebuild never holds the live routes: while the model is read again every route answers from the state held, each rebuild lands as one snapshot, edits meanwhile fold into one more, and every record appended meanwhile reaches the page once
  because: on PostHog a spec edit held /api/journal 67.9 s and /api/state 69.5 s, since the model refresh ran on the update chain that serialises every live route and push (d-6167bada); a landing that took the rebuild's own read of the stores would drop what the chain sent while it read, or send it again, so the stores stay the chain's, and a page that loaded the older model is sent the new one by the version check when its stream opens
  crossing: record -> reading
  refuted: made /api/state await the model rebuild under way (await this.rebuilding) before answering, so the first load was held behind the rebuild again -> "a rebuild never holds the live routes: while the model is read again every route answers from the state held, each rebuild lands as one snapshot, edits meanwhile fold into one more, and every record appended meanwhile reaches the page once" went red in live.test.ts on its own assertion (the state route answered during the rebuild: 0, not 200); restored (cmp), green batched and alone (2026-10-30)
  kinds: none
- the masthead does not move between views: The page's head, the masthead and the view strip, is the same markup on every view but for which tab is selected, and no style sizes or places the page, the shell or anything in its head by which view is shown or what it renders; the selected tab only paints, and the page always keeps the scrollbar's gutter.
  over: the head of every view of the fixture project, and every rule of the page's style sheet that names the page, the shell or its head
  via: the masthead does not move between views: its markup is the same on every view but for the selected tab, and no style sizes or places the frame by view
  because: the owner saw the header jump when switching between Structure and the other tabs (the same request that ruled d-bf90cb79): the shell widened from 76rem to 100rem only while Structure was shown, so at 1440 wide the masthead moved 112 px left and the strip 112 px right. The masthead is where a reader's eye rests between views, so it must be one frame: every view shares the width the map needs, and the other views keep a readable measure inside it
  refuted: widened the shell only while Structure is shown, with .shell:has(.flow-stage) in styles.css -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- Structure is the first view: The view strip leads with Structure, then Connections, then Lexicon, then Components, Invariants, Runs and Journal, and a page whose address names no view opens on Structure; an address naming a view opens that view.
  over: the strip of the fixture project's page, the view its state opens on, and every view's own address
  via: Structure is the first view: the strip leads with Structure, then Connections, then Lexicon, and a page whose address names no view opens on it
  because: the owner ruled it (d-bf90cb79): the map is what a reader comes to Scope for, and the lexicon is the vocabulary beneath it. The first tab is the one a page opens on, so a reader who chooses nothing sees what the strip says comes first, and a deep link still opens the view it names
  refuted: opened a page whose address names no view on Lexicon in loadState, the strip still leading with Structure -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- control none is never marked: An entrance that declares control: none with its reason is never marked no traced control: its route says no control needed, the query gives the reason for the route and the entrance, and it never shares a route with an entrance that does not declare it.
  over: an untrusted untraced entrance with and without control: none, alone and beside a route-mate that declares nothing, in the model and query structure
  via: an entrance that declares control: none with its reason is never marked no traced control: its route says no control needed, the query gives the reason, and it never shares a line with an entrance that does not declare it
  because: a gap closed by saying no control is needed must stay visible and challengeable (d-a1095ef2); marked amber it would read as a gap still open, and hidden it would be a waiver nobody sees
  crossing: project-source -> reading
  refuted: dropped the control: none exemption from noTracedControl in flowOf, so a declared entrance was marked no traced control -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- declared guards split routes: Entrances that declare different guard: lines never share a structural route, so a guard declared on some of a route's entrances counts for the ones it names.
  over: two entrances on the same stops and trust, one declaring a confirmed guard: and one declaring none
  via: entrances that declare different guard: lines never share a line, so a guard declared on some of a route's entrances counts for those it names
  because: a control counts on a route only when every entrance on it passes it (d-127ab8e4); without the split, the guard the scaffold proposes for the entrances that pass a chokepoint (praetorium's mutationRpc on 40 of 101) could never close their gap
  crossing: project-source -> reading
  refuted: left the declared guard out of the route grouping key in flowOf, so a guarded entrance shared its route with an unguarded one -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- recorded reading stands only for its tree: The Structure reading a hook reads is kept only when complete and when the tree it read is still the tree, and it stands only while its fingerprint holds: a changed source file, handler, guard, chokepoint or config makes it stale and the gaps unknown, while a spec line the reading never reads leaves it standing.
  over: a partial and an unread reading, an edit made while a reading ran, a changed source file, entrance handler and config, and a control: none added to a spec
  via: a recorded Structure reading stands for the tree only while its fingerprint holds: a partial one is never kept, an edit made while it ran leaves nothing, a changed source file, handler or config makes it stale, and a spec line the reading never reads leaves it standing
  because: a hook cannot take a reading (a minute on Coherence, three on a large adopter), so it reads the last one; a reading that no longer describes the tree would name gaps that are gone or miss new ones, so it is never taken for a fresh one: orient names it only labeled as the last reading, less what the current spec closes (d-a1095ef2, df-84db9e4f)
  crossing: record -> reading
  refuted: made freshReading ignore the fingerprint, so a reading of an older tree stood for the current one -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- one structure refresh at a time: A background Structure reading starts detached and the caller returns at once; it never starts twice for one tree, a live one of an older tree is superseded, since its reading could never be kept, and a live process whose command line is not a structure query is never signalled.
  over: a first refresh, the same tree again, a newer tree, and a live mark naming a process that is no structure query
  via: one refresh at a time, started detached without waiting: never twice for one tree, a live refresh of an older tree is superseded, and a process that is not a structure query is never signalled
  because: a reading takes a minute to three and holds a language server, so two at once only compete; the tree a session leaves at its stop is the one the next starts on, and a reading of an older tree is refused when it finishes (df-84db9e4f); a pid can be reused, so only a structure query is ever stopped
  crossing: record -> reading
  refuted: matched query structure anywhere in the command line, not only at its end -> "one refresh at a time, started detached without waiting: never twice for one tree, a live refresh of an older tree is superseded, and a process that is not a structure query is never signalled" went red in gaps.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- a session start waits only for a nearly done refresh: A session start that finds the reading stale waits for a refresh of this very tree only when the last reading's duration says it finishes within the wait limit, fifteen seconds, and stops waiting when the reading is kept; it never waits on one that will not, nor on a refresh of another tree.
  over: a refresh of this tree that finishes in under a second, one the last reading's three minutes say will not, and a refresh of another tree
  via: a session start waits a bounded moment for a refresh of this tree the last reading's duration says is nearly done, and not at all for one that is not
  because: a session started seconds after the last one stopped would otherwise read the labeled last reading when the fresh one is moments away; the hook's timeout is 60 s and a reading on a large adopter takes three minutes, so a wait is spent only where it is likely to pay (df-84db9e4f)
  crossing: record -> reading
  kinds: none
- gap baseline only shrinks: The adoption baseline of spec gaps is a journal decision: the first holds every gap the reading shows, a later one only intersects it, so it never grows.
  over: a first baseline, a smaller one, and a later one naming a gap the baseline never held
  via: the gaps derive from the recorded reading with the current runs and spec, and the adoption baseline only shrinks
  because: gaps present at adoption should not nag every session start, but a baseline that could grow would let a new uncontrolled entrance be excused by recording it; like the lexicon baseline, it is shrunk by work and widened only by a retraction a human can read
  crossing: record -> reading
  refuted: made recordGapBaseline record every gap held now instead of intersecting with the prior baseline -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- orient's gap line is bounded: Orient's spec gap line is one line of bounded length: the count of gaps outside the adoption baseline, the busiest route by entrance count, and the three ways to close one; nothing when there are none, and a gap outside the baseline is always named.
  over: gaps on several routes with an over-long entrance name, none, all baselined, and one new beside a baseline
  via: orient's gap line is one bounded line naming the count, the busiest route by entrance count and the three ways to close one; gaps the baseline holds stay counted as open, never named; nothing when there are none
  because: the start injection shares a fixed budget with the vocabulary and the escalations (CONTEXT_BUDGET), so the line must not grow with the project; one line that names where to start and how to close a gap is what an agent can act on
  crossing: project-source -> reading
  refuted: stopped cutting entrance names in orient's gap line, so a long name grew the line without bound -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- a snapshot never defaults into a served folder: A snapshot written without --out lands in the project's .coherence folder, resolved against the root, and never in a served folder such as public/ nor beside the working folder.
  over: a snapshot without --out, run from another folder with --root, in a project that has a public/ folder
  via: a snapshot without --out lands in the project's .coherence folder, resolved against the root, and never in a served folder such as public/
  because: the page embeds the journal, escalations and defects included, and public/ is the folder Next.js, Vite and most web frameworks serve as static files; the old default would have put an adopter's security findings one commit away from being deployed (df-f2f6b207). The project's own .coherence folder is where install's ignore file already keeps transient state out of git
  crossing: record -> reading
  refuted: set the snapshot default back to public/_scope.html -> "a snapshot without --out lands in the project's .coherence folder, resolved against the root, and never in a served folder such as public/" went red in cli.test.ts on its own assertion; restored byte for byte, green alone and batched (2026-10-06)
  kinds: output
  checklist: destination-confinement declared as a snapshot never defaults into a served folder
  checklist: redaction dismissed: the page is the project's own reading for its own people; the fix is where it lands, not what it hides
  checklist: commit-ordered-effects dismissed: the page has no effect
  checklist: circuit-breaker-policy dismissed: the page has no dependency to sample
  checklist: declared-target-coverage dismissed: one file is written
- the practices view tells what exists first: The Practices view opens with the story of what the project practices (a summary, every trigger of every practice in the when-you list, the components with and without practices, the kernel, and what has no practice yet) before any practice's card, and the agent query tells the same story.
  over: a project with its own practice, a kernel practice, a component with none, and a defect in it
  via: the Practices view opens with what the project practices: every trigger of every practice in the when-you list, the components with and without practices, the kernel, and what has no practice yet, before any practice's card
  because: owner: the tab must tell the story of what practices exist at all in a project; a reader new to the project learns its methods by what sets them off before reading how well each holds, and a trigger left out of the list is a rule nobody sees until it fires
  refuted: left edit triggers out of the when-you list -> "the Practices view opens with what the project practices: every trigger of every practice in the when-you list, the components with and without practices, the kernel, and what has no practice yet, before any practice's card" went red in practices.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-06)
  kinds: none
- a strip shows each enactment's outcome for its step: Each step's adherence strip has one cell per enactment it shows, matched by the step's words: evidenced, claimed (done without the evidence the step names), done, deviated, skipped, or absent when the version enacted lacked the step; repeated deviation within the strip suggests an amendment, and a skip does not.
  over: enactments of an older version without a step, a step done with and without its evidence, deviations with one reason twice, and a skip
  via: each step's strip classifies every enactment it shows: evidenced, claimed, done, deviated, skipped, and absent when the version enacted lacked the step, and repeated deviation suggests an amendment
  because: the strip is where a method is seen bending: a claimed cell drawn as evidenced would hide the step that slips, and an older version's missing step drawn as skipped would blame sessions for a step that did not exist yet; two deviations on witness a refutation's steps 1 and 5 were the signal that amended it (d-abadce10)
  refuted: drew a step done without the evidence it names as evidenced -> "each step's strip classifies every enactment it shows: evidenced, claimed, done, deviated, skipped, and absent when the version enacted lacked the step, and repeated deviation suggests an amendment" went red in practices.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-06)
  kinds: none
- a citation's kind comes from the minter's tables: A practice's evidence names each cited record's kind by its id's prefix, read off the same tables the record ids are minted from (every journal kind, and each work kind as a work order, move, owner or completion), so a kind added there is named on the page, never counted as a nameless record.
  over: an id minted for every journal kind and every work kind, a commit, and a practice whose learned: line cites one of each
  via: a citation's kind is read off the minter's tables: an id of every journal and work kind names its kind, and a practice's evidence counts each
  because: the page kept its own map of prefixes (f7af977), which lacked dm, xc, ak, wm, wo and wc, so a practice learned from a dismissal or a work move counted it as a record; the tables now live in a module with no imports (journal/kinds.ts), which the page's bundle joins by following its imports and the record model re-exports, so the page and the minter read one table
  refuted: made KIND_OF_PREFIX the page's own literal map of ten prefixes again, not read off KINDS and WORK_KINDS -> "a citation's kind is read off the minter's tables: an id of every journal and work kind names its kind, and a practice's evidence counts each" went red in practices.test.ts on its own assertion; restored (cmp), green batched and alone (2026-10-11)
  kinds: none
- the window keeps what practices need: The journal window keeps each practice's latest enactments, as many as its strips read, every decision that cites an enactment and the enactments it cites, and every record a practice cites, whatever its age; an older enactment nothing cites is counted with the records left out, and the Practices view says how many of a practice's enactments it holds and where the rest are; an old record nothing needs stays out.
  over: twenty enactments of one practice, an amendment citing an old one, a defect a pitfall cites, an unrelated old decision, beside thirty recent records, on a snapshot, on a live page and with every record held
  via: the journal window keeps each practice's latest enactments, every amendment and what it cites, and every record the practices cite, whatever its age, and the Practices view says how many enactments it holds
  because: the strips, amendments and pitfall links are derived from those records, so a window that dropped them would draw a practice that seems never enacted and pitfalls that link nowhere. Keeping every enactment assumed they were few; they were 156 records, 433 KB of the 693 KB the journal cost the page, and every enactment adds one, while the strips read only the latest twelve of each practice (d-381c0380)
  refuted: kept every enactment in windowJournal again, not each practice's latest ENACTMENT_WINDOW -> "the journal window keeps each practice's latest enactments, every amendment and what it cites, and every record the practices cite, whatever its age, and the Practices view says how many enactments it holds" went red in practices.test.ts on its own assertion (an older enactment nothing cites stays out: 0 !== 7); restored (cmp), green batched and alone (2026-10-12). Earlier: stopped keeping enactments in the journal window -> the test under the bullet's earlier via went red; restored byte for byte, green batched and alone (2026-10-06)
  kinds: none
- a scoped reading proposes what the whole reading proposes: A reading scoped to some entrances resolves their handlers and those of every entrance declared beside them, follows their reach as the whole reading does, and reads the interfaces of a component only when a route of theirs enters it, never asking about any other; where every fact the route rule reads beyond those routes is settled for each tree the unread interfaces allow, its routes, traced controls and proposed closures for those entrances are the whole reading's, and where one is not, it names that fact.
  over: a route of two entrances crossing three components, one passing a verified chokepoint its route-mate does not, beside a component with an entrance of its own that no route of theirs enters and that code off their routes calls, read whole and scoped through a server that counts every question, and the same scoped reading with a component on the route left unread
  via: a scoped reading proposes for its entrances what the whole reading proposes, and never asks about a component their routes do not reach
  because: on a large adopter the whole reading takes minutes, the cost of asking about one entrance; a route's own facts (its reach, the interfaces it takes, the guards it passes, its route-mates) are exact once the components it enters are read whole, but whether a component is a core dependency and which column it stands in are counted over every interface, so a scoped answer that differed from the whole one would propose a closure the whole map contradicts
  crossing: instrument -> reading
  refuted: made scopeStarts return only the named entrances, dropping the entrances declared beside them that can share their route -> "a scoped reading proposes for its entrances what the whole reading proposes, and never asks about a component their routes do not reach" went red in component-interfaces.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- a scoped reading is never recorded: A reading scoped to some entrances' routes is never kept as the tree's Structure reading, while a whole reading of the same tree is.
  over: a scoped and a whole reading of the routed fixture, each offered to the record for the tree it read
  via: a scoped reading is never recorded as the tree's reading
  because: orient, Stop and the session's gaps read the recorded reading as every entrance's routes; a scoped one would leave every entrance off its routes looking resolved to nothing, and drop the gaps it never read
  crossing: reading -> record
  refuted: dropped the scoped test from recordReading, so a scoped reading was kept like a whole one -> "a scoped reading is never recorded as the tree's reading" went red in component-interfaces.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- a spec edit rereads no source: The language server's answers a component interface reading asked for are kept apart from the reading, keyed to source content alone, so a reading after an edit that changes only the specs (an entrance declared, a guard: line, a chokepoint) reuses every answer, asks the server only what no earlier reading asked (a handler never asked about), never starts it when nothing is new, and is the reading a server asked everything gives.
  over: the routed fixture read whole, then an entrance with a guard: declared on a declaration the reading asked about and a chokepoint added, through a server that counts every question and every start, then an entrance on a handler no reading asked about, each against the same tree read with nothing kept
  via: a spec edit asks the language server only what no reading asked before, and rereads no source
  because: declaring an entrance is most of what an adoption edits, and on PostHog each scaffold control --all after one paid the whole language-server pass again, because the recorded reading's fingerprint covers the specs' shape; the answers depend on source text only, while which declarations are asked, which component a site belongs to and every handler, reach, guard and chokepoint are worked out again from the specs over them, so keeping the answers by the specs would buy nothing and cost every adoption edit a full reread
  crossing: instrument -> reading
  refuted: hashed spec files (.md) with the source files whose change drops kept answers, in KeptAnswers, so a spec edit dropped every answer the spec spells -> "a spec edit asks the language server only what no reading asked before, and rereads no source" went red in component-interfaces.test.ts on its own assertion (nothing is asked); restored byte for byte, green batched and alone (2026-10-08)
  kinds: none
- a source edit rereads only what it touches: A reading after source files changed drops each kept answer a changed file could have changed (its definition, candidates or sites sit in one, a changed file now spells its name or an alias, star-imports or wildcard re-exports its module, or it is a default export) and asks again only those, and is the reading a server asked everything gives.
  over: the routed fixture read whole, then one file changed to call into a component it never called, the new reference spelled only in that file, read through a server that counts every question, against the same tree read with nothing kept
  via: a source edit asks again only what the changed file could have changed, and the reading is the one a fresh server gives
  because: a server reports a declaration or a reference only where the text names it (the word index rests on the same fact), so an answer no changed file names, sits in or star-imports cannot have changed; dropping by file rather than all at once keeps a one-line edit from costing the whole pass, and dropping by spelling as well as by site is what finds the reference a changed file adds to a declaration elsewhere
  crossing: instrument -> reading
  refuted: dropped the spelling test from holds, so a kept answer whose name a changed file now spells was reused -> "a source edit asks again only what the changed file could have changed, and the reading is the one a fresh server gives" went red in component-interfaces.test.ts on its own assertion (the new interface is read); restored byte for byte, green batched and alone (2026-10-08)
  kinds: none
- kept answers are never used silently: A reading says what it did with the kept answers: how many it reused, asked anew, and how many files changed and answers they dropped; and when what the server's answers rest on beyond source changed (the project's language configuration, manifests or lockfiles, the config's bounds or test folders, the adapter's code or Coherence's version), or the kept answers are absent or unreadable, it reuses none, asks every question, and says why.
  over: a first reading, a reading after the project's tsconfig.json changed, and one over an unreadable store of kept answers, each through a server that counts every question
  via: kept answers are never used silently: when what the server's answers rest on changes, every question is asked again and the reading says why
  because: no silent skips: an answer reused past a change it depends on would draw a map of a tree that is gone, so the reuse is shown wherever a reading is taken (scaffold control, query structure, a Scope snapshot), and a fallback to the whole pass is named with its cause rather than looking like a slow day
  crossing: record -> reading
  refuted: made the kept answers' load ignore a change to their basis, so answers kept before tsconfig.json changed were reused -> "kept answers are never used silently: when what the server's answers rest on changes, every question is asked again and the reading says why" went red in component-interfaces.test.ts on its own assertion (nothing kept is reused); restored byte for byte, green batched and alone (2026-10-08)
  kinds: none
- the kept answers rest on all the adapters' code: The adapter code the kept answers' basis hashes is every module the language adapters' entry imports, followed to the end, as this installation holds them (the sources in a checkout, the compiled modules in the published package, which ships no sources); no list names them, so a fix to any module an answer comes from leaves no kept answer standing.
  over: the adapters' entry in this checkout, each module any module it reaches imports, and the modules reached only through another (installed.ts, tach.ts, toml.ts, project-config.ts) and outside the adapters' folder (work-meter.ts)
  via: the kept answers rest on every module the language adapters reach: their entry and each module any of them imports, wherever it lives
  because: a hand list of six adapter files keyed the basis (6a82d99) and left out installed.ts, tach.ts, toml.ts and project-config.ts, so a fix to one left stale answers in use; and the published package ships no src/adapters, so in an install every listed file read as unreadable and the key held whatever the adapter code was, resting on the version alone; following the imports from the entry, through the installation's own files, removes the list and keys the compiled code in an install
  refuted: made adapterCode return the six adapter files the old hand list named, instead of following the entry's imports -> "the kept answers rest on every module the language adapters reach: their entry and each module any of them imports, wherever it lives" went red in component-interfaces.test.ts on its own assertion; restored (cmp), green batched and alone (2026-10-11)
  kinds: none
- which references governed is shown: Where a chokepoint governed only references from outside a folder, Scope's enforcement shows its from: value, who said it and how many references it exempted, each exempt site reads as exempt and never a bypass in Scope and the relies-on query, and a component's owners show on its card and in the component query.
  over: a run of a chokepoint governed by the config's chokepointFrom over a component with an owners: line, read by the components and invariants views and the relies-on and component queries
  via: Scope and the agent query show which references governed: the from: line with its exempt count on the enforcement, each exempt site as exempt, and the component's owners
  because: a grade earned under an exemption reads exactly like one earned under none unless the reading says which references governed; a reader who cannot see the component's own references were exempted would take them for absent
  crossing: record -> reading
  refuted: made renderGoverned skip the from: line a run applied -> "Scope and the agent query show which references governed: the from: line with its exempt count on the enforcement, each exempt site as exempt, and the component's owners" went red in from.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- every reading names the languages it did not read: In a project of several languages, every reading's result carries which languages it read and each one it did not with why, every renderer prints that line, and no reading takes the config's primary language except through primaryOnly, which hands the statement of what it left unread back with it.
  over: every source file under src/readings, src/economy, src/scaffold and src/observation, and the mass, scaffold entrances, observation and Structure query renderers given a language not read
  via: no reading takes the primary language alone without naming the languages it left unread, and every renderer prints them
  because: a checking tool that skips a language quietly prints a clean result it never read (df-f47a5c05); one check per reading would miss the next reading, so the source guard refuses any reading that takes the primary language another way, and the renderers share one line
  crossing: project-source -> reading
  refuted: made formatMass drop the languages line it prints for a result naming a language not read -> "no reading takes the primary language alone without naming the languages it left unread, and every renderer prints them" went red in languages-read.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- the Structure reading reads every language: In a multi-language project the Structure reading reads each component's code through the adapter of each language its files use, resolves each entrance through its handler's language, and merges declarations, component interfaces, reach and traced chokepoints side by side over the components the languages share, drawing no reference across languages.
  over: a component spanning backend/*.py and frontend/*.ts beside a shared component written in both, with an entrance and a chokepoint in each language
  via: the Structure reading of a two-language project reads each language's component code through its own adapter and merges them, drawing no reference across languages
  because: a PostHog product's frontend interfaces, entrances and reach stayed unread while its backend was read (df-56343a7c); no language server reports a reference from Python into TypeScript, so an edge across them would be invented, not read
  crossing: instrument -> reading
  refuted: made mergeLanguages keep the first language's component interfaces alone -> "the Structure reading of a two-language project reads each language's component code through its own adapter and merges them, drawing no reference across languages" went red in multi-language.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- a language's server starts only when read: A multi-language Structure reading starts a language's adapter only when that language has component code or an entrance handled in its files.
  over: a two-language config whose tree holds component code and entrances in one language alone
  via: a multi-language Structure reading starts no adapter for a language with no component code and no handler
  because: a language server holds hundreds of megabytes and takes seconds to load the project; one started for a language with nothing to read costs that for nothing
  crossing: instrument -> reading
  refuted: dropped the check that skips a language with no component code and no handler, so every declared language's adapter started -> "a multi-language Structure reading starts no adapter for a language with no component code and no handler" went red in multi-language.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- entrance detection reads every language: The detected entrances of a multi-language project are each language's rules over its own files and manifests, measured against the declared entrances together, and scaffold entrances proposes a bullet for each one undeclared.
  over: a Python route decorator and a TypeScript route method in one component, declared and undeclared
  via: entrance detection in a two-language project finds each language's entrances by its own rules
  because: the coverage the declared entrances are measured against was the primary language's alone, so a frontend's routes counted as neither declared nor undeclared and orient said nothing of them (df-f47a5c05)
  crossing: project-source -> reading
  refuted: made detectedEntrances run the primary language's rules alone in a multi-language project -> "entrance detection in a two-language project finds each language's entrances by its own rules" went red in multi-language.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- one language reads as before: A single-language project's readings read that one language, print no languages line, and leave a handler in another language's file unresolved, as before.
  over: the two-language fixture configured with python alone, read by the Structure reading, the Structure query, mass, entrance detection and scaffold control
  via: a single-language project reads as it always did: one language read, no languages line printed
  because: every adopter today declares one language; the multi-language readings must leave their output exactly as it was
  crossing: project-source -> reading
  refuted: made languagesReadLine print its line for a project of one language read whole -> "a single-language project reads as it always did: one language read, no languages line printed" went red in multi-language.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- the page's bundle is what its entry imports: Scope's browser script is bundled by esbuild from the page's entry through every module it imports, packages included (three.js for the Structure view); no list names them, so a module a source calls into is always bundled, and an import the bundler cannot resolve fails the build naming it.
  over: the page's own bundle, which must carry three.js, and an entry importing a missing module and a missing package, each refused
  via: the page's bundle carries every module its entry imports, packages included, and an import nothing resolves fails the bundle
  because: a hand list of browser sources left out languages-read.ts when structure-flow.ts began calling languagesReadLine (b37627e), so from 1.6.0 to 1.7.1 the live page threw a ReferenceError the tests never saw, since they run each module in Node where its imports resolve; the hand-made join that replaced the list refused packages, which the Structure view's relief needs, so a bundler follows the imports instead
  kinds: none
- a page that cannot draw says so: When the page's drawing throws, at the first load, on an update or in a snapshot, or anything in the page fails uncaught, the failure is shown at the top of the page with its message, replacing the waiting line; it is never kept as a connection reason nothing shows, and the page stops rather than retry a drawing that fails the same way.
  over: the bundled page, run as the browser runs it, against a first load its drawing cannot draw
  via: a page whose drawing throws shows the failure where the reader sees it, never a waiting line forever
  because: the page caught the ReferenceError from drawing the first load as if the connection had dropped, stored it as a reason, and never drew again, so the reader saw the waiting line forever and the cause only in a debugger
  refuted: let a drawing's error reach the connection loop again, as before -> "a page whose drawing throws shows the failure where the reader sees it, never a waiting line forever" went red in browser-bundle.test.ts; restored (cmp), green (2026-10-11)
  kinds: none
- a rule's plural is declared with the rule: Each entrance detection rule says its plural beside what it detects, in CANDIDATE_RULES; the plurals a count of undeclared entrances and a grouped entrance's line use are read off the rules, so a rule added there is counted in its own plural, never as its name with an s and never as detected entrances.
  over: every rule of every language, counted once, three times and as a grouped entrance, and a rule two languages share
  via: every detection rule says its own plural, and a count of entrances by rule reads it there
  because: RULE_PLURALS was a table of its own and lacked request proxy and page route when those rules were added, so orient said "3 request proxys" and a group of page routes stood for "detected entrances" (df-5c6288f3)
  refuted: made RULE_PLURALS a table of its own again, the sixteen plurals it held before, without request proxy and page route -> "every detection rule says its own plural, and a count of entrances by rule reads it there" went red in declared-once.test.ts on its own assertion; restored (cmp), green batched and alone (2026-10-12)
  kinds: none
- the page model imports the tool's types: Scope's page model and views write out no closed list a tool module declares (a bullet's state and lacks, a practice's state and reach, an experiment step's result and outcome, a record's kind, a verdict); each is imported as a type, which the bundle strips, so the page compiles against the tool's own list.
  over: every string-literal union and constant list in Scope's model and view sources, against every one the rest of src declares
  via: Scope's page model and views write no closed list the tool's own modules declare; each is imported as a type
  because: model.ts copied Lack, LifecycleState, PracticeState, the practice's reach and the close's results and outcome, believing the browser could not import the tool's modules; a type import is stripped before bundling, so the copies bought nothing and a state added to the tool would compile everywhere and be unknown to the page (c-a1a77f70)
  refuted: wrote a practice's state out by hand in model.ts again, candidate or established in place of PracticeState -> "Scope's page model and views write no closed list the tool's own modules declare; each is imported as a type" went red in declared-once.test.ts on its own assertion; restored (cmp), green batched and alone (2026-10-12)
  kinds: none
- connections columns are hops from the origin: In the Connections view (connections/model.ts) a component origin stands in column 0 with every component it calls one column right and every component calling it (and not called by it) one column left; a structural route's origin is its entrance token in column 0, the component declaring it and each entrance's handler component in column 1, every component their entrances' handler's static reach enters from those at one plus its hops along that reach, and every component holding a chokepoint the work passes drawn from the start at one plus its hops; an origin the flow model lacks draws nothing.
  over: a component origin and a route origin of a synthetic project, with and without a chokepoint traced on the route, and an origin no longer in the model
  via: connections: columns are hops from the origin, callees right and callers left of a component, along the handler's reach from a route
  because: the owner settled the view on depth measured from one origin (d-a314db4e): every whole-project layout failed on Coherence's 86 interfaces among 13 components, and following a route's stop order drew query as one seven-card line; the model holds which card stands in which column, the drawing only where a column is
  kinds: none
- a spawn adds what its +N counts: Every drawn card but a component origin carries the number of components one hop further out from it (its callees right of a component origin, its callers left, the next components along the reach from a route) that are neither drawn nor a hidden core dependency, and spawning it draws exactly those, in the next column out or, from a route, at their own hops when further.
  over: every card of a component origin and of a route origin, before and after spawning a caller, a callee and a card along the reach
  via: connections: +N counts what a spawn adds one hop further out, and a spawn adds exactly that
  because: the view opens on one hop and grows only where the reader asks (d-a314db4e); a +N that counted what a spawn would not draw, or drew more than it said, would make the reader distrust the one control the view has for going further
  kinds: none
- connections draw every interface between drawn cards: Every component interface of the flow model whose caller and callee are both drawn is a line, with its reference sites, and no other line is drawn; from a structural route, a line is the work's own exactly when its entrances' handler's static reach references the callee through it, with the sites and symbols that reach uses, and an interface the work does not use is still drawn, never its own.
  over: every interface of a synthetic project between the cards of a component origin, and the lines of a route origin after a spawn
  via: connections: every component interface between drawn cards is a line, and the route's own are those its reach uses
  because: the relief dropped the view of how components connect (d-a314db4e); a view that left out an interface between two drawn cards would hide a reliance in plain sight, and one that showed the work using an interface its reach never references would invent a flow
  kinds: none
- a chokepoint is one door: Each chokepoint standing on a drawn line is drawn once, at the door of the component it stands in front of (the callee of the interfaces it stands on), with its identifier, its verdict, what it protects, and every caller in the flow model whose interface it stands on, drawn or not; a crossing of its invariant marks the door, and a bypass the latest run recorded on any of those interfaces breaks it.
  over: every door of a synthetic project from a component origin, a door whose callers are not all drawn, and a door with a recorded bypass
  via: connections: a chokepoint is drawn once, at the door of the callee, listing every caller it stands in front of, with its crossing and its bypass
  because: identifier pills on every interface the chokepoint stands on piled X14 and X32 on top of each other in the bundle into Journal and Spec (d-d4f9fea6); one door says the same thing once, where the work arrives, and selecting it answers who reaches the protected thing through it
  kinds: none
- a core dependency is a chip: A core dependency is never a card unless it is the origin or the reader asks to draw it; each drawn card that uses it, by calling it from a component origin or by its route's reach from a route origin, carries it as a chip, and once it is drawn as a card its uses are lines and no longer chips.
  over: every card of a synthetic project whose utility every other component calls, from a component origin, from the utility itself, from a route, and with the utility asked for
  via: connections: a core dependency is a chip on the cards that use it, and a card only as the origin or when asked
  because: src/adapters drawn as a card took eleven incoming lines and buried every other interface (d-d4f9fea6); a chip keeps the fact that a card uses it without the lines
  kinds: none
- a selected card keeps only its own lines: Selecting a drawn card keeps only the lines with it at one end, and the doors those lines carry, removing the rest; and it gives one token for every structural route whose entrances' handler's reach gets to that card, with how many hops in, where its work enters and its trust, fewest hops first then by name, the origin route marked among them; a selection that is not drawn removes nothing.
  over: a selected callee, a selected caller where a route starts, a component selected from a route origin, and a selection that is not drawn
  via: connections: selecting a card keeps only the lines that touch it and gives a token for every route whose reach gets to it, fewest hops first
  because: the owner asked to see every entrance that reaches a selected component and to prune the second-order connections from it, removed and not faded (d-9cf51e23); Journal is reached by 13 of 15 routes, which no route's own stops say
  kinds: none
- every connections origin has a deep link: Every structural route and every component of the flow model has a connections id, the view's prefix and the flow model's own id for it, that no other origin shares, that names that origin back, and that the page's one hash scheme resolves to the Connections view with that id.
  over: every route and every component of a synthetic project with two entrances
  via: connections: every route and component has a deep link that names it back
  because: a link into the view must reach the origin it was copied from, or a reader shown a route by a link lands on another; the ids derive from the flow model's own, so no second naming of a route or a component can drift from it
  kinds: none
- a relief that cannot draw says so in its place: When the relief's scene cannot be built, Structure says so and why in the relief's own place, blaming WebGL only when the browser could not start it and otherwise saying the relief failed and giving its error; every other view and the rest of the page stay as they are, and the scene is not tried again until what it draws changes.
  over: a scene maker that throws as a browser without WebGL does, across a first render, a render with the same data, a snapshot of equal data, a snapshot that changes what is drawn, and one with nothing to draw, and one that throws an error of its own
  via: a relief that cannot be built gets a line in its place saying why, blaming WebGL only when the browser could not start it, the page standing, and no second try until what it draws changes
  because: a headless Chrome without a GPU threw "Error creating WebGL context" from the scene's renderer and the page replaced everything with its fault banner, the masthead and the other seven views included (2026-10-30); a browser with WebGL switched off is ordinary, and it should lose the one view that needs it, not Scope. Each try at a WebGL context costs one, and browsers cap them, so a failed one is not tried on every render. A project with no commit threw from the scene on its empty landings and the page blamed WebGL (review of PR #164), so only the renderer's own failure is put on the browser
  kinds: none
