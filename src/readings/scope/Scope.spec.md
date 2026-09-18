# Scope

The reading: one surface projecting the model for a human, in seven views: Glossary, Components, Structure, Invariants, Reliance, Runs, Journal; and the agent query, the same state as plain text.

## invariants
- deterministic build: The same inputs in produce a byte-identical page out, and the inputs are all of them: both glossaries, the spec tree, the run records, the journal, and the work store.
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
- reliance comes from complete endpoint sites: The Reliance and Structure views and query relies-on list actual file, line, symbol, endpoint, classification, syntax form when known, and test mark for references to either the chokepoint or protected thing; absent sites stay incomplete and only a present empty list confirms zero.
  over: every chokepoint invariant with no run, a legacy run, complete empty sites, protected-only sites, chokepoint-only sites, and both endpoints together
  via: reliance reads both protected and chokepoint endpoint sites, owner first, without calling a bypass a legal door reference
  because: the glossary defines reliance from references to either endpoint. Dropping protected references hides direct consumers, while calling a protected bypass a legal chokepoint reference erases the structural defect. The run's optional sites field preserves the evidence boundary: absence is legacy or unavailable, and presence means both endpoint queries completed
  crossing: record -> reading
  refuted: filtered the site list to chokepoint references alone -> the protected-only reliance assertion went red in check.test.ts; included both endpoints with their role and classification, green (2026-09-18)
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
- deep links resolve: Every card id on every view resolves, by its prefix, to the view that renders it, and a hash naming a view alone resolves to that view.
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
- structure is the crossing projection: Structure draws entry-spec trust levels as nodes and every crossing-bearing invariant as one labelled edge in stable model order; bullets without crossings do not become edges and their count is said.
  over: every trust level and bullet in the fixture and the first adopter, including structural defects and bullets with no crossing
  via: Structure derives every edge in stable order, counts no-crossing invariants, and renders defects and previews deterministically
  because: the crossing is the declared security marker and carries no topology beyond its two trust levels. A stored or hand-arranged picture could disagree with the spec; deriving coordinates and labels from the current model keeps the picture a reading
  crossing: project-source -> reading
  refuted: discarded the count of invariants without crossings from the Structure derivation -> the no-crossing count assertion went red in check.test.ts; restored the derived count, green (2026-09-18)
  kinds: none
- structure and spine share one order: Query spine formats the same structureOf model the Structure SVG renders, preserving trust-level declaration order and component then invariant declaration order.
  over: every trust level and crossing-bearing invariant in the fixture and first adopter
  via: query spine uses the same ordered crossing model as Structure
  because: a separate query traversal could silently reorder or omit the security spine, giving an agent and a human different readings of one spec
  crossing: reading -> reading
  refuted: reversed the crossing order only in query spine -> the view/query edge-order assertion went red in query.test.ts; restored the shared structureOf order, green (2026-09-18)
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
