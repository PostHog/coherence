# Downtown blockout — revision 6: stable guarantee terminals

The [local prototype](../../../public/_structure-blockout.html) tests circuit-style interfaces on component cards. Three actual consumed guarantees produce three named terminal tabs: Recorded verdict and Journal integrity on Durable evidence, and Spec ancestry on Source derivation. These are display aliases over canonical guarantees, not new architectural claims. [Revision 5](revision-5/RESULTS.md) retains the previous experiment.

## Behavior

External reliance arrows terminate at fixed ports on the named tabs. Unfurl leaves those paths exactly where they were and reveals a local dotted continuation from each terminal to its corresponding promise card. Local continuations have no dependency arrowheads; they retain the original relationship IDs and do not change the denominator of 15 declarations. Consumed promise cards repeat their terminal name, and clicking a tab opens the full authored guarantee and consumer evidence in the sidebar.

The three generic Relies on this promise boxes were removed after visual review showed they still forced unnecessary detours. Direct arrows, terminal names, the legend and the inspector carry that meaning. Architecture handoff labels retain their fixed positions. Cards and tabs retain their geometry through zoom. Promise cards and their local continuations now remain present when zoomed out; supporting text fades in reserved slots.

Local detail draws on over 650ms and honors reduced motion. The earlier external retarget animation and its dedicated check were removed from active scripts and archived with revision 5; the external target now has no expansion-dependent spelling.

## Visual assessment

Compare [collapsed terminals](terminals-collapsed.png) with [expanded terminals](terminals-expanded.png). The external dashed arrows arrive at the same named interfaces while finer local lines reveal the guarantees beneath them. Removing the generic boxes makes the two evidence reliance routes considerably shorter. [Distant view](terminals-tiles.png) retains all card and terminal anchors and suppresses supporting text.

The first screenshots caught two issues before handoff: long terminal captions exceeded the old promise-card height assumption, and cached full-card path prefixes could leave architectural lines detached from tiles. Caption measurement now includes letter spacing and actual text parts; route source geometry is recalculated when zoom changes card size. An initial undefined selection comparison was also corrected and guarded.

This tests the interface mechanism, not the whole circuit-routing proposal. Some architecture paths remain indirect; terminal names become small at distant zoom; several fans still extend outside the current viewport. Frame local promises remains explicit. These limitations do not justify moving established landmarks.

## Validation

`node scripts/structure-blockout/build.mjs` rebuilds the offline artifact.

`node scripts/structure-blockout/check-terminals.mjs` passes seven observations covering collapsed state, the start of local reveal, expanded state, distant zoom, restored detail, fold and reduced motion. [Terminal observations](terminal-results.json) retain actual external SVG paths, endpoint coordinates, terminal rectangles, continuation identities and relationship counts. The test exercises real terminal selection and verifies fixed external paths through disclosure, fixed terminal endpoints through zoom, and exact continuation-to-promise provenance.

`node scripts/structure-blockout/check.mjs` checks the existing 1440×1000 and 1280×900 journeys, including repeated and three-stack unfurls. [Browser observations](browser-results.json) and [spatial observations](stability-results.json) retain the evidence. Checks include actual SVG clearance and source/target attachment, shared external paths and object positions, promise caption/body/hint containment, sidebar selection, zoom restoration, unchanged owner rectangles and offline operation.

The three-stack scene has nine promise cards: three terminal continuations and six ordinary ownership links. Only the twelve architectural handoffs and three guarantee reliances are counted as declared connections. Production Scope and comparison functionality are unchanged.


## Disclosure state correction

Unfurl/Fold now changes only expansion. A card or terminal click opens its inspector
without changing the external relationship population. **Focus connections** in the
inspector explicitly selects that population; **Show all in this layer** clears
focus without closing the inspector. Sidebar responsibility and consumer lists
continue to describe the inspected subject regardless of the visible map layer.

`node scripts/structure-blockout/check-disclosure.mjs` passes ten round trips at
1440 and 1280 pixels wide: untouched opening, component inspection, component
focus, guarantee inspection and guarantee focus. It compares exact external SVG
path maps, stable card geometry, selection, focus, layer, inspector subject and
camera before, during and after disclosure. [Recorded observations](disclosure-results.json)
and the [opening after unfurl](disclosure-opening-open-1440.png) and
[opening after fold](disclosure-opening-folded-1440.png) document the correction.
The existing 22 scene and seven terminal observations also pass, with explicit
focus actions replacing their former implicit selection assumptions.

Visual review confirms the opening connections return unchanged after folding.
Promise fans can still be below the viewport; their placement and the proposed
fixed-shape zoom revision are outside this correction.


## Constant shapes through zoom

The reported 15:43:57 narrow-tag view was still produced by the old tile branch.
That branch is now removed. Zoom has no input to card geometry or routing. Titles,
terminal names, disclosure controls and relationship labels stay anchored; purpose,
metrics and supporting promise captions fade out below zoom 0.46 and return above
0.50. Fading respects reduced-motion preferences. Revealed promises remain cards
throughout zoom, with the same local continuations.

`node scripts/structure-blockout/check-zoom.mjs` checks collapsed and expanded
round trips at two widths, comparing exact model rectangles, actual SVG path maps,
DOM title offsets and dimensions, font sizes and the expanded population. See
[zoom observations](zoom-results.json), [near cards](zoom-collapsed-near-1440.png)
and [distant cards](zoom-collapsed-far-1440.png). The empty space in distant cards
is intentional: zoom reduces detail without repacking the diagram.


## Short-wire kink correction

The wire above Requests the project model had slightly offset ports and too little
space for its forced minimum Bezier handle length. Handles now fit the forward gap
between facing ports. A free component port within one grid step aligns with the label entrance,
so the [repaired wire](short-wire.png) is straight. Cards and labels remain in place.

`node scripts/structure-blockout/check-short-wire.mjs` samples the rendered source
segment for backward travel and checks both endpoint attachments. It failed on the
old artifact (-0.198 world-unit vertical progress between samples), then passed on
the rebuilt artifact. [Wire observations](short-wire-results.json) retain the path
and measurement. This check addresses the observed facing-port defect; it does not
claim that every obstacle detour elsewhere should be monotone.


## Second-project portability

[Mnemion](../mnemion-structure/RESULTS.md) now exercises the same renderer with
seven stacks and one dominant core. Build inputs and presentation names are
project data; slot counts derive from the population. The fixed eleven-stack
restriction is removed, while larger-graph exact search remains explicitly bounded.
Coherence retains the same three downtown components and coordinates. The shared
[agent projection command](AGENT-PROJECTION.md) writes a picture and compact reading
for spec-authoring iterations.
