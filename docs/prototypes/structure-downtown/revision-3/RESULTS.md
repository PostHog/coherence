# Downtown blockout — revision 3: connection geometry

The [local prototype](../../../public/_structure-blockout.html) now uses direct cubic Béziers in clear space and rounded obstacle-aware corridors elsewhere. Card placement, centrality and unfurl behavior are unchanged. [Revision 2](revision-2/RESULTS.md) retains the previous report and screenshots.

Connections prefer faces directed toward the other endpoint. Multiple arrivals can occupy separate points on a face. Grid-snap microsegments are simplified; each card has a reserved straight approach, and markers have explicit dimensions and a tip-aligned reference. Labels receive greater clearance and opposite entry/exit faces so their connection remains continuous under the text. No new dependencies or architectural edges were introduced.

## Assessment

The [opening](opening-1440.png) and [expanded evidence at 1280px](expanded-1280.png) show smoother transitions and distinct, consistently sized incoming arrowheads. The first revision of the router was rejected during visual review despite passing geometry checks: rounding alone left small grid detours. Direct Bézier connections remove those where space allows. Dense crossings and some indirect label approaches remain; this is an improvement to connection geometry, not a claim of globally optimal routing or completed comprehension testing.

The three-stack Source derivation/Taxonomy/Durable evidence scene preserves nine independently selectable promises and routes seven actual relationships plus nine ownership links. Its [automatic camera view](derivation-multiple-1440.png) exposes an existing reveal-camera limit: minimum zoom can crop the owner when previously opened fans push its promises far away. The separately retained [panned context view](derivation-context-1440.png) examines the architectural connections at readable scale. Camera behavior was not changed in this routing iteration.

## Validation

`node scripts/structure-blockout/build.mjs` rebuilt the offline artifact. `node scripts/structure-blockout/check.mjs` passed the opening, selection, unfurl, guarantee, collapse, zoom, all-handoff and three-stack journeys at 1440×1000 and 1280×900. [Browser observations](browser-results.json) retain each scene.

Collision checks now sample the actual SVG curves every two world units, including entry annotations and unrelated labels, rather than only the orthogonal waypoint scaffold. Checks also inspect the final 24 units of every rendered route for a straight normal approach and verify explicit marker units, size and tip reference. Existing card/body selection, exact consumer-to-promise targeting, owner geometry, semantic zoom, fold restoration and offline checks continue to pass.

The full twelve-handoff fit crosses into tile zoom at 1280px; the test zooms back before inspecting a component with no promises. Selected local views can crop unrelated labels. These limits remain visible in the report. The prototype has not replaced production Scope and still represents current state only.
