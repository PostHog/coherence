# Downtown blockout — revision 2 assessment

The requested interaction changes are implemented in the [live local prototype](../../../public/_structure-blockout.html). This remains a design prototype; independent comprehension of the whole project is not established. The [prior assessment and screenshots](revision-1/RESULTS.md) are retained.

## What changed

- Unfurl creates up to three independent promise cards. The component card keeps its position, width and height. Each new card names its owner and has a light dotted ownership connection. Actual guarantee reliance ends on the exact promise node, with its original declaration identity preserved.
- Promise cards have 100 units of horizontal space between them and begin at least 180 units below the owner. Downtown card clearance increased from 90 to 160 units, peripheral slot pitch from 410 to 480, and label clearance from 28 to 40.
- Both authored entry points have an external ENTRY POINT label and a prominent amber arrow pointing into their owning component. These annotations are included in routing and initial camera bounds.
- The overview uses the full canvas with the authored project purpose in the header. Selecting a card opens the sidebar. Unfurl frames the owner, new cards and explicit guarantee consumers at a readable local scale; other parts of the project remain reachable by panning or returning to overview.

## Visual review

The [opening](opening-1440.png) makes both entrances visibly distinct. There is more space between components and their labels. The centrality calculation still selects Source derivation, Verification and Durable evidence; changed slot geometry can alter peripheral assignment without changing semantic rank.

The [separate-card reveal](expanded-1440.png) now reads as additional architectural objects rather than a growing text container. The [journal promise at 1280px](guarantee-1280.png) shows Agent lifecycle, Durable evidence, and the separately selected promise together. Its reliance arrow ends on that promise, and the sidebar retains the actual stale evidence reading.

Promise text in the focused reveal is approximately 16.3px at 1440×1000 and 14.3px at 1280×900. Some surrounding cards and unrelated route labels are outside this deliberately local viewport; Return to overview restores the larger project. The opening still uses relatively compact body text, so this revision is not a claim of completed whole-project readability or a general layout engine.

The initial unfurl camera fit was rejected because it crossed the tile threshold and hid its own new cards. The repair frames full canonical card rectangles directly, independent of transient React Flow measurements, with minimum reveal zoom 0.64. This defect and decision are journaled.

## Validation

The [browser observations](browser-results.json) cover opening, body selection, unfurl, exact guarantee selection and all handoffs at 1440×1000 and 1280×900. The journey checks:

- unchanged component geometry after unfurl;
- independent promise nodes, separate hit targets, ownership links and 100-unit promise spacing;
- actual consumer-to-promise edge endpoint;
- both external arrows pointing downward into the correct component;
- no card/card, card/label, label/label or route-through-unrelated-card collisions in the exercised scenes;
- sidebar selection without resetting zoom;
- promise cards disappearing at tile zoom and returning when zooming back;
- fold removing the new cards and restoring the component map;
- no browser errors or network requests.

An additional two-stack check opened Durable evidence and Verification together: six promise cards, no routing error, no card overlap and no entry-annotation overlap. Its [screenshot](two-unfurled-1440.png) is retained.

Rebuild with `node scripts/structure-blockout/build.mjs`; exercise with `node scripts/structure-blockout/check.mjs`. The [ruleset](RULES.md) documents the new behavior. Production Scope has not been replaced, and no comparison implementation is claimed.
