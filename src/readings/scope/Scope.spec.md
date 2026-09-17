# Scope

The reading: one surface projecting the model for a human, in views; this slice ships the shell and the Glossary view.

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
