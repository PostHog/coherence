# Structure downtown blockout — revision 3

This is a disposable layout experiment over Coherence's current canonical Structure
model. It does not replace the packaged Scope renderer. The implementation uses the
existing React and React Flow dependencies. No deployment, comparison implementation,
or general layout framework is part of this experiment.

## Spatial meaning

1. The project root is the reading frame, with a selectable responsibility. Its
   children are the architectural stacks. Containment does not become a dependency.
2. Downtown contains the three stacks with the largest trial prominence score.
   The score is `3 ln(1 + peers) + 2 ln(1 + promises) + ln(1 + security boundaries)
   + 2 ln(1 + explicit guarantee consumers)`.
3. A promise is a distinct invariant identity, regardless of how many oracle
   readings support it. Peers and consumers are distinct components. Security
   boundaries are distinct declared transitions marked `security: true`.
4. These four independent signals are not a safety assessment. A transition and
   its guarantee may inform separate terms; they are never added and called a
   count of distinct obligations. Missing declarations are unknown importance.
   No risk magnitude is inferred from security booleans or taxonomy prose.
5. Guarantee consumers count toward the provider's importance. General handoffs
   count symmetrically as architectural peers because their verbs have different
   causal meanings. Imports, containment, file counts and passing test counts do
   not contribute.

## Placement

6. This cheap blockout has three downtown slots in a horizontal central district
   and eight surrounding slots, with a measured 11-stack population. It refuses a
   different population rather than claiming a general layout algorithm.
7. Downtown order prefers declared architectural handoffs reading left to right.
   Exhaustive slot assignment minimizes Manhattan connection length, weighting
   explicit guarantee reliance twice a general handoff. After the first screenshot
   exposed a remote CLI approach, architectural edges leaving an entrance receive
   weight three plus a penalty of twice their backward horizontal distance.
   Entrances also receive a soft upper-row preference. Stable identity order
   resolves ties. These preferences do not change downtown membership.
8. No Coherence component name or ID selects a coordinate. The result must remain
   inspectable in `scene.json`; card position comes from these rules and the model.
   Downtown horizontal clearance is now 160 units rather than 90. Peripheral slot
   pitch is 480 units rather than 410; top and bottom bands are also farther from
   downtown. Card size is not scaled up to consume the additional space.
9. Downtown cards expose authored intent. Peripheral cards expose identity and
   declared entrance, if present; full responsibility is available by selecting any
   part of the card body. Downtown membership has a distinct surface treatment.
   Each declared entrance has a separate external annotation above its component:
   an ENTRY POINT heading, its authored label, and a heavy amber arrow pointing
   down into the card. Annotation rectangles participate in routing and camera
   bounds. These arrows are entrance declarations, not invented dependency edges.
   Card height reserves the measured title, intent and metric lines
   before route allocation; a long title cannot overflow a fixed-height card.

## Connections and interaction

10. Opening fits the union of cards, entry annotations, routes and labels. It uses
    the full canvas, with project purpose in the header; selection opens the sidebar.
    Following screenshot rejection of the busy twelve-edge opening, the opening
    route shows core-to-core architectural edges and shortest architectural paths
    from each declared entrance to a core. Paths use undirected adjacency only to
    find an approach; every displayed arrow retains its original authored direction.
    Coherence yields four edges. All twelve handoffs remain in an explicit layer
    with complete authored labels. Another layer shows the three guarantee reliances. The
    toolbar states the visible denominator. Selecting a component focuses its
    actual incident connections, including guarantee reliances; it invents none.
11. Labels receive nonoverlapping rectangles before orthogonal routing. Routes
    avoid cards, entry annotations and other labels. Labels reserve 64 units of
    clearance to leave room for endpoint approaches and curves. Labels have
    opposite entry/exit faces. Prefer card faces pointing toward the other endpoint;
    occupied face centers can move in 30-unit steps, remaining clear of corners.
    Card approaches reserve 36 units; label approaches reserve 20. Direct cubic
    Béziers connect the leads when sampled clear of obstacles; otherwise simplified
    orthogonal corridors receive adaptive cubic corners (maximum radius 32).
    Curve sampling retains 8 units of clearance, grid routing 12. Card ends retain
    at least 28 straight units before the border. Relationship markers use explicit
    16-unit dimensions independent of stroke width, with their reference at the tip;
    entrance markers use 24 units. Neither selection nor line weight resizes them. A failed route visibly rejects the layout; it
    never falls back to a straight line through components. Edge crossings may
    remain and must be assessed in the screenshot review.
12. A full card-body button selects the component and opens its sidebar. A separate
    unfold button changes expansion. Card selection must be tested at an ordinary
    paragraph/body point, not just the title or a special nested selector.
13. Unfolding keeps the owner's position AND dimensions. Up to three distinct
    promises become independent React Flow nodes in a fan below the owner,
    explicitly consumed promises first. Their horizontal gap is 100 units and
    their top is at least 180 units below the owner. Each card names its owner;
    light dotted ownership links connect it back without dependency arrowheads.
    Other promise cards remain selectable in the sidebar. Only colliding unopened
    components move to make room; additional fans reserve a separate band.
    A reliance now terminates on the independent promise node, preserving the
    original declaration's component target separately for provenance.
    A zero-promise component offers responsibility inspection without an empty
    promise expansion. Browser inspection caught overflow in the discarded empty
    expansion; the expansion domain now requires actual promises.
14. Collapse restores the calculated overview positions. Zoom never changes the
    explicit expansion set or centrality ranking. Below the tile threshold, promise
    detail is suppressed and remembered for return. Ordinary selection does not
    reset zoom. Unfurl deliberately frames the owner, added cards and explicit
    guarantee consumers using their full geometry at minimum zoom 0.64, even if
    the prior view was tiles. This avoids fitting transient node measurements
    and hiding the very cards the reader just requested. Overview/fit controls
    still permit returning to the larger project.
15. The sidebar states exact score inputs, authored responsibility, relationships,
    promise evidence and source problems separately. Unknown or stale evidence
    never silently becomes a low-risk or satisfied state.

## Predeclared rejection conditions

- Card content or a connection label is clipped or overlaps another card/label.
- A route crosses a non-endpoint component or a different connection's label.
- Selecting an ordinary card-body point does not show the corresponding sidebar.
- Expansion changes a guarantee into a guessed relationship or cannot identify
  the provider and consumer in the surrounding map.
- The opening offers no visible distinction between entrances, shared central
  responsibilities and peripheral components.
- The reviewer needs spoken corrections to explain an architectural handoff.

## Cheap test

Build with `node scripts/structure-blockout/build.mjs`; open
`public/_structure-blockout.html` directly. It is self-contained and offline.

Review at 1440×1000 and 1280×900. Save the opening, an ordinary card selection, an
separate evidence promise cards and the selected journal-integrity guarantee. Check
collision geometry and interaction in Chromium, then inspect those screenshots.
Record author judgments separately from mechanical results and independent reader
comprehension, which remains an empirical question for the user.

The browser journey checks unchanged owner geometry, separately selectable promise
nodes, exact reliance endpoint, ownership links, 100-unit promise clearance, external
arrow alignment, and both directions of the tile/detail transition. Prior revision
artifacts and assessment are retained in `revision-1/`.

The expected first path is a declared project entrance toward Source derivation,
then Verification and Durable evidence. A second path begins at Agent lifecycle
and follows its reliance on Durable evidence's journal-integrity promise. These
are declared paths to inspect, not a script the interface may need spoken aloud.

Comparisons are intentionally not implemented here. The subsequent design must
retain common component positions across both sides and attach ghosted removals
and broken connections to their prior locations; independently reranking each
snapshot would violate the mental-map requirement.
