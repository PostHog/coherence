# Structure map, second blind round, synthesized (2026-09-23)

Three blind readers (newcomer, security, owner) judged frozen copies of the Coherence and Mnemion Structure maps after the health, trust-boundary, route and typography pass. They saw only the two pages. Full reports are in structure-2026-09-23/. "All three" means each found it independently. Claims 2 and 4 below were checked against the reviewers' screenshots.

## What now works (keep)
Mnemion's banner and the "2 broken" mark on Hive; the clickable health counts; file:line bypass lists; the chokepoint inspector; dimming outside a selection; one color per route; left-to-right flow; rails for core dependencies; deep-linkable selections; glossary-linked legend.

## What fails, ranked
1. Red does several jobs (all three). It is the hook route's color, Hive's crossing chip, and the "nothing enforced" banner, as well as broken. On the healthy Coherence map the loudest thing is a red block that means nothing is wrong. Red should mean broken only.
2. Orange/yellow does several jobs (newcomer, owner). It is the selection highlight and also the spec route, the OAuth route and the Journal rail; selecting Spec in light mode tangles the two.
3. The healthy/unhealthy verdict is too quiet (owner, security). Coherence's 114/114 sits in small type below a masthead that leads with glossary size and "bullets". Solid vs dashed identifiers is too faint a difference; "requirement, checked 2026-09-17" reads like a pass.
4. Change impact is only partly answerable (owner, newcomer). Selecting a component draws callers and callees alike, with no direction; almost everything lights; the inspector lists every invariant first (18 on Hive), pushing who depends on it below the fold.
5. Untrusted input is not marked where it enters (security). Entrance tokens carry no trust level and there is no trust-level key; unprotected untrusted routes (document upload → IO, OAuth → Auth, scope page → Scope) look the same as protected ones. X13 is drawn on the MCP route, not the invite route that uses register tokens.
6. Unenforced areas are invisible (owner). "Not covered" exists only as an unclickable count; Mnemion's Core, called by 7 of 7, has no chokepoint and nothing on the map says so.
7. Noise: crossing-count chips on every component; identifiers repeated (X21 four times, X14/X15 twice) and floating in space; C and X tags differ by one letter; legend "C x" undecodable (all three).
8. Component roles are cut mid-phrase on Coherence (newcomer).
9. Narrow widths clip the map with no sign it scrolls; the Journal tab is cut at 500 px; the only broken mark scrolls away (all three).
10. The default selection is a minor route (owner, security): the page opens on `query` or the MCP tools instead of the whole system or the riskiest path.

## Proposed next pass
1. Red only for broken. Reassign the hook route color; the banner and crossing chips use a neutral or amber "attention" treatment. Selection highlight gets a color no route uses (or a non-color treatment: weight plus halo).
2. Masthead leads with health: one verdict line in large type (all verified / nothing enforced / n broken); glossary size and bullet counts demoted.
3. Identifier state in fill, not outline weight: verified solid, requirement hollow with a hatch, broken red. The inspector's requirement label says "not enforced" first.
4. Trust on the entrance: each token shows its trust level (a small badge or edge color), a trust-level key sits with the health strip, and an untrusted route with no control on it gets a visible "no control" mark.
5. Direction on selection: callers and callees drawn distinctly (in/out arrows or two tints); the component inspector leads with its verdict summary, then who depends on it, then invariants folded after the first few.
6. Unenforced made visible: components with no chokepoint or oracle on their interfaces carry a hollow state bar and a clickable "not covered" count in the strip.
7. Crossing counts shown only while a trust level or component is selected; each identifier drawn once, with repeats as small dots; C and X given distinct shapes and a spelled-out legend.
8. Full roles (wrap to three lines rather than cut); horizontal-scroll affordance and the broken mark kept on screen at narrow widths.
9. Default to no route selected, whole system in view, unless something is broken, in which case open on the broken component.
