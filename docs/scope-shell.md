# The Scope shell

Scope is the reading: one surface that projects the model for a human, in
views. This first slice ships the shell and one view, Glossary.

## Structure

The shell is a function of one state value. `src/readings/scope/model.ts`
holds the model: a glossary (concepts, retired mechanisms, metaphors, and,
where a project declares them, trust levels, rulings, candidate overloads and
uncertain terms), a concept with its names, rejected alternatives and their
because, a layer (a glossary that is present, or an absence with its reason),
the Glossary view state (layers plus the reader's query), and the shell state
(project, the list of views, the active view, each view's state). Fields the
page has no special form for stay in the model as a record and render as such.

The builder (`build.ts`) loads Coherence's glossary and, when a second path is
given, a project domain glossary, into that model once. It embeds the state as
JSON in `public/_scope.html` beside the styles and one inline script. It does
not render. Same glossary in, byte-identical page out.

In the browser, `page.ts` parses the embedded state and renders it with
`renderShell`, a pure function from state to markup. Every change the reader
makes is a change to the state followed by a render: the search field copies
its text into the query, the view strip sets the active view. Filtered lists,
match counts, related-link targets and the two-layer composition are derived
on every render, never stored.

The Glossary view renders each concept as an entry: name, status, other names
and who defined it in the margin; definition, metaphor, owner's words, rejected
alternatives with their because, related concepts and the rest of the record in
the body. A domain glossary's trust levels render as instances of Coherence's
concept. Related names that are not concepts on the page are marked unresolved.
An absent domain glossary renders as a placeholder with its reason. No file
path or symbol address is added; the glossary names things.

## Adding a second view

1. Give the view a state type in `model.ts` and a field on `ShellState`.
2. Populate it in `loadState` in `build.ts`.
3. Write a pure render function for it, next to `glossary-view.ts`.
4. List its identity in `views` and add its case to `renderViewBody`.
5. Add what it must show to `check.test.ts`.

The view strip, keyboard movement and re-render handle any number of views.
