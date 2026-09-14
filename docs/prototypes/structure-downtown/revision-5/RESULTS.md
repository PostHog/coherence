# Downtown blockout — revision 5: animated reliance refinement

The [local prototype](../../../public/_structure-blockout.html) now gives shared objects constant positions across collapse and unfurl. The reported **Addresses classification subjects** label is covered explicitly. [Revision 3](revision-3/RESULTS.md) retains the previous arrow study.

## What changed

One canonical base map owns the eleven component rectangles, two entrance annotations and fifteen declared relationship labels. Label allocation no longer depends on the currently visible subset. Unchanged architectural relationships reuse their exact Bézier paths. Visibility changes do not perform another layout.

Unfurl allocates three promise cards in vacant space without displacing existing cards, labels or base paths. Allocated promise positions remain reserved for the captured canvas, including while folded; adding, folding or reopening another stack leaves shared promise cards in place. First allocation can depend on reveal order. Reloading the captured canvas creates a fresh allocation history.

Unfurl and fold leave the camera unchanged. The explicit **Frame local promises** control takes the reader to the revealed cards; Return to overview remains an explicit reset. A guarantee that reveals its exact provider promise keeps its existing label position while its terminal route changes to the promise.

## Visual assessment and tradeoff

Compare [Source derivation collapsed](derivation-collapsed-1440.png) with [the stationary unfurl](derivation-unfurled-stationary-1440.png). Component cards, the classification label and existing architectural curves occupy the same positions on screen. New ownership and exact-promise connections appear without shuffling the map.

Fixed landmarks cost space. Promise fans can extend below the initial viewport, and selecting **Frame local promises** can leave the owner outside that deliberately local view. The [1280px detail view](derivation-context-1280.png) records this tradeoff. This revision prioritizes the requested spatial continuity; it does not claim optimal space utilization or simultaneous whole-project readability.

## Validation

The rebuilt artifact passes `node scripts/structure-blockout/check.mjs` at 1440×1000 and 1280×900. The browser journey compares exact shared rectangles, exact unchanged architecture paths and viewport transforms across evidence unfurl/fold, Source derivation unfurl, additional evidence/taxonomy unfurls, neighboring fold and repeated reveal. The reported classification label is required to exist before its regression sequence.

[Stability observations](stability-results.json) retain before/after object coordinates for every transition. [Browser observations](browser-results.json) retain the screenshots and geometry readings. Existing actual-SVG curve collision and arrow approach checks, independent promise selection, exact guarantee endpoints, semantic zoom restoration, sidebar behavior and offline checks continue to pass. Three open stacks show nine distinct promise cards and nine ownership connections without card or label collisions.

This remains the local design prototype; production Scope and comparison behavior are unchanged.


## Reliance transition

A reliance now visibly withdraws its downstream arrow from the container and extends it to the revealed promise over 700ms. The label and consumer-to-label path remain stationary. Folding reverses the refinement; interrupted toggles start from the current displayed tail. Reduced-motion preference uses the exact final route immediately, including when changed during motion.

Free point interpolation was rejected after its midpoint screenshot crossed unrelated cards. The accepted transition traces only prefixes of the already routed old and new tails. [Withdrawing](retarget-withdrawing.png), [extending](retarget-extending.png) and [settled](retarget-expanded.png) frames retain that visual review. React Flow can temporarily remount custom edge renderers during disclosure, so the canvas owns the single animation state for each visible relationship.

`node scripts/structure-blockout/check-retarget.mjs` passes 15 frame-controlled observations covering forward motion, collapse, interrupted reversal, initial reduced motion and a mid-animation preference change. The [observations](retarget-results.json) retain actual SVG geometry, arrowhead positions, shared prefixes, label rectangles and camera transforms. Sampled intermediate paths avoid cards and other labels. The ordinary browser journey waits for animations to settle before checking final endpoint normals and exact promise targeting.

## Further routing discussion — not implemented

The user's two zoom screenshots expose label-driven detours surviving after the labels disappear and nearby independent routes resembling shared junctions. Proposed next work: jointly optimize labels and corridors, penalize reversals and excess bends, allocate lanes across the network, and simplify local geometry at distant zoom while preserving shared object anchors and the recognizable course around obstacles. Any bundling must have declared semantic membership. This proposal changes routing quality; the transition animation alone does not solve that network-level problem.
