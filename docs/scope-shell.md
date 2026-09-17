# The Scope shell

Scope is the reading: one surface that projects the model for a human, in
views. This first slice ships the shell and one view, Glossary.

## Structure

The shell is a function of one state value. `src/readings/scope/model.ts`
holds the model: a glossary (concepts, metaphors, and, per project, rejected
names, trust levels, rulings, candidate overloads, uncertain terms), a layer (a glossary present, or an absence with its
reason), the Glossary view state (layers plus the reader's query), and the
shell state (project, views, active view).

`build.ts` loads Coherence's glossary and, when a second path is given, a
project domain glossary, into that model once and embeds the state as JSON in
`public/_scope.html` with the styles and one inline script. Same glossary in,
byte-identical page out.

In the browser, `page.ts` renders the embedded state with `renderShell`, a
pure function from state to markup. Every reader change is a state change
followed by a render; nothing shown is stored.

## A concept, in three sections

**Vocabulary** is what a definition needs, shown in the open: name, status
and other names in the margin; definition, properties, not to be confused
with, rejected alternatives with their because, related concepts and open
questions in the body.

**Detail** is definitional sub-structure: an invariant's revelation, a
chokepoint grade's ladder, regulate's force. It is kept whole, one click
away, under a disclosure named Detail.

**Provenance** is history: who defined the concept, the owner's words, the
metaphor, the evidence. It is one click away under a disclosure named
Provenance; owner's words and metaphor render as quotations. No key of
provenance renders in the vocabulary, so history is never mistaken for
definition; the check asserts this for every concept.

Whatever else an entry carries renders under Also on record; for Coherence's
glossary that is empty. A domain glossary in the older shape has no detail or
provenance: its extra fields land on record, and its rejected names, trust
levels, rulings, candidate overloads and uncertain terms render in their own
sections. An absent domain glossary renders as a placeholder with its reason.

## Adding a second view

1. Give the view a state type in `model.ts` and a field on `ShellState`.
2. Populate it in `loadState` in `build.ts`.
3. Write a pure render function beside `glossary-view.ts`.
4. List its identity in `views` and add its case to `renderViewBody`.
5. Add what it must show to `check.test.ts`.
