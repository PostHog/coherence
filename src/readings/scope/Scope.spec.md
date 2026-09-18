# Scope

The reading: one surface projecting the model for a human, in six views: Glossary, Components, Invariants, Reliance, Runs, Journal; and the agent query, the same state as plain text.

## invariants
- deterministic build: The same glossary in produces a byte-identical page out.
  protects: loadState
  chokepoint: buildScopePage
  over: every byte of the page for a given pair of glossaries
  via: the build is deterministic: the same glossary in, byte-identical page out
  because: the page is derived from the glossary and never stored as truth; a build that differed for the same input would make the derived page look like it carried something of its own, and the state is loaded once by the one function that renders the document
  crossing: project-source -> reading
  refuted: appended the clock to the page title in buildScopePage -> "the build is deterministic: the same glossary in, byte-identical page out" went red in check.test.ts; restored, green (2026-09-17)
  kinds: encoding
  checklist: semantic-preservation declared as embedded state unchanged
  checklist: canonical-encoding declared as deterministic build
  checklist: key-rotation-compatibility dismissed: nothing is encrypted
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
  refuted: <not witnessed: no staged break was attempted on the concept renderer; the test has not been red in this repository>
  kinds: read
  checklist: scoped-reads dismissed: every concept is shown to every reader
  checklist: redaction dismissed: nothing is removed; history is separated from definition and shown on request
- render from state: Every reader change is a state change followed by a render: the search derives its matches from state and hides the rest.
  over: every reader interaction the shell handles
  via: the search derives its matches from state and hides the rest
  because: the shell is a function of one state value; a render that read from the document instead would let the page drift from the state it claims to show
  refuted: <not witnessed: no staged break was attempted on the search; the test has not been red in this repository>
  kinds: none
- views render from state: Every view is a pure render over the one state value: every component, invariant, run record, and journal record in the state is on its view, and a filter or query narrows what is shown without storing anything.
  over: every component, invariant, run record, journal record, and work order of the fixture project, on each of the five model views
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
  refuted: <not witnessed: the test reads the first adopter's tree from this machine and is skipped where it is absent>
  kinds: none
