# Downtown Structure blockout — assessment

**Disposition: useful design experiment; not accepted as the default Structure.**
The interaction and collision checks pass. Author visual review rejects the
full-map camera policy for comfortable reading, particularly after expansion.
Independent reader comprehension has not been observed.

## What was built

A self-contained [interactive blockout](../../../public/_structure-blockout.html)
using the existing React/React Flow dependencies and the canonical Structure model.
The production renderer is unchanged. The [rules](RULES.md), [captured model and
placements](scene.json), [browser observations](browser-results.json), and
[weight perturbations](weight-sensitivity.json) are retained alongside it.

Input population: 12 components, including the project frame; 82 distinct
invariants; 61 transitions, 47 security-marked; 12 authored architectural handoffs;
three explicit guarantee reliances. The initial journal decision quoted the older
80-invariant checkpoint. Comparing catalog and model identities found no duplicate:
the prior Structure implementation added two invariants. This correction is also
recorded in the decision journal.

## Centrality result

| Component | Promises | Security transitions | Peers | Guarantee consumers | Score |
| --- | ---: | ---: | ---: | ---: | ---: |
| Durable evidence | 12 | 5 | 4 | 2 | 13.95 |
| Source derivation | 7 | 3 | 6 | 1 | 12.77 |
| Verification | 14 | 10 | 3 | 0 | 11.97 |
| Coordination | 16 | 10 | 2 | 0 | 11.36 |

The first three occupy downtown. Their left-to-right order is derivation,
verification, evidence, following their declared handoffs. The CLI remains an
entrance despite its low score. There are no component-specific coordinate
overrides. Slot assignment is a constrained prototype, not an inferred urban form.

All sixteen combinations of ±25% changes to the four weights retained Durable
evidence and Verification. Source derivation remained downtown in fifteen;
Coordination replaced it in one. This is sensitivity evidence, not calibration
or proof of architectural importance. The forced three-center capacity is still
a design assumption.

## Author visual assessment

The [opening at 1440px](opening-1440.png) now gives a visible, declared route from
the CLI to the shared model, then to verification and retained verdicts. The agent
entrance separately reaches durable evidence. The central cards explain their
responsibilities using the actual spec intent. Other components remain selectable.

Showing all twelve handoffs initially was too busy, despite collision-free
geometry. The revised opening uses four derived connections; the complete layer
remains explicitly available. [All-handoffs view](all-handoffs-1440.png).

The strongest scene is the [journal guarantee close view](guarantee-close-1440.png).
Agent lifecycle visibly relies on the specific journal-integrity promise inside
Durable evidence. The sidebar explains why the consumer needs it and preserves
the actual stale evidence reading. This is a successful author-observed reveal;
it is not a claim that a new reader has understood the whole project.

The [fit-expanded view](expanded-1440.png) exposes the remaining failure. Keeping
every stack on screen reduces promise and relationship text to roughly 10px at
1440×1000, and below 9px at 1280×900. Even the smaller opening has roughly 10px
relationship labels. Clean rectangles and successful clicks do not redeem that
reading cost. The [1280px opening](opening-1280.png) is retained as evidence.

The layout also retains a visibly regular peripheral slot scaffold. It demonstrates
semantic ranking and neighborhood affinity, but does not yet produce strong
district identities or a general packing strategy. Expansion can push peripheral
cards outside the current viewport; manually fitting all of them causes the
small-text failure above.

## Mechanical validation

`node scripts/structure-blockout/check.mjs` passes in Chromium at 1440×1000 and
1280×900. At both sizes it exercises opening, ordinary paragraph/body selection,
evidence expansion, exact journal-guarantee selection and the complete handoff layer.
It checks card/card, label/card, label/label and non-endpoint route intersections,
card-body/footer overlap, opening label containment, sidebar identity, preserved
camera on ordinary selection, and expansion surviving tile zoom. A component with
zero promises remains inspectable without creating an empty expansion. The HTML
makes no network requests and the browser reports no page errors.

Build: `node scripts/structure-blockout/build.mjs`.
Browser check: `node scripts/structure-blockout/check.mjs`.
No broad package tests are claimed: this isolated experiment does not modify the
packaged renderer. No comparison, MCP control or generic project layout is claimed.

## What the next experiment should change

Keep the semantic score and test paths fixed. Change the camera and space policy:
give the active neighborhood a readable scale, retain the rest as genuinely compact
context, and avoid requiring full-map fitting to inspect an expanded stack. Continue
testing the actual opening and promise reveal, rather than substituting another
title-size threshold. Improve route locality before treating the all-handoff layer
as a normal reading view.

The current evidence supports further exploration of downtown/periphery. It does
not establish the first gate that Structure independently tells Coherence's story.
