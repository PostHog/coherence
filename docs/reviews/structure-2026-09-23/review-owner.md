# Owner review: Structure view, Coherence and Mnemion-js

Seat: the project owner, with ten minutes per map. I read only the two HTML pages. I drove them through headless Chrome using the Chrome DevTools Protocol (clicking each `[data-structure-select]` target) at 1440, 820 and 500 px, in dark and light. Screenshots are in `shots-owner/`. File names below are relative to that folder.

---

## 1. Ten-second test

### Coherence (`coherence-1440.png`, `coherence-sel-none.png`)
What I take away:
1. **"114 invariants enforced and verified, 0 requirements, 0 defects."** It's correct, but it's printed in the smallest type on the page, as three equal-weight pills.
2. **A big red block on the left (SessionStart / SubagentStart / ...).** Red reads as "something is broken", and here it's wrong: it's only the colour of the hooks' route. On a fully green project, the loudest thing on screen is a false alarm.
3. **Something about "query → Scope → Lifecycle".** The page opens with a route already selected (`data-default="true"`, the `query` route), so the first thing the inspector explains is a one-entrance minor route instead of the whole system.

The right three would be: healthy (all verified); the load-bearing parts are the Adapters and Journal rails plus Enforcement, Lifecycle and Scope; nothing is in progress. I get #1 only if I read small text, and #2 and #3 get in the way.

### Mnemion-js (`mnemion-1440.png`, `mnemion-sel-none.png`)
What I take away:
1. **Red sentence: "Nothing is enforced yet ..."** This is the right headline, and it's the best element on either page.
2. **The Hive box with "× 2 broken" and a red "9 crossings" chip.** Right place to look.
3. **Four coloured entrance blocks on the left.** Neutral.

These are nearly the right three. What's missing: which part matters most (Core is a rail, "called by 7 of 7", printed in faint type at the bottom), and how far a Hive change would reach.

---

## 2. Owner questions answered from the map

| Question | Coherence | Mnemion-js |
|---|---|---|
| Healthy right now? | **Yes.** 114/114 verified, 0 requirements, 0 defects, every invariant "verified 2026-09-22". 0 selections needed. High confidence, but the map never says whether 09-22 is the current commit. | **No.** 0 enforced, 36 requirements, 2 requirements bypassed in Hive (7 bypass sites with file:line). 1 selection (`mnemion-sel-health-bypassed.png`, `mnemion-sel-broken-entities-hive.png`). High confidence. |
| Load-bearing parts? | Adapters rail (called by 6 of 9, 10 crossings) and Journal rail (8 of 9, 7 crossings). Scope (31 crossings), Lifecycle (18) and Enforcement (13) by crossing count. "14 load-bearing interfaces" appears only as a number in the empty-selection inspector; to find which 14 you have to click each component. Medium confidence, 3+ selections. | Core rail (7 of 7) and Hive (9 crossings, 18 invariants, and the only path for MCP tools). Medium confidence, 2 selections. The rail label "Core: core dependency, called by 7 of 7" is the faintest text on the canvas, but Core is the most depended-on thing on the map. |
| "I change X" | **Spec** (`coherence-sel-node-src-spec.png`): calls 3, called by 7, 2 routes (spec, scaffold), 4 load-bearing interfaces, X21 on 4 of them. 1 selection. **But** the map draws callers and callees as the same yellow line, so I can't see which direction the effect runs. "Called by 7" has no list in the visible part of the inspector; the panel is cut off at "Load-bearing here (4)". Medium confidence. | **Hive** (`mnemion-sel-node-entities-hive.png`): dashed yellow reaches root, Features, Session, Routing, IO, Auth and Core, which is everything. The inspector lists 18 invariants first; the neighbours come only after a long scroll. Low-to-medium confidence about what actually breaks. |
| Not covered by any enforcement? | I can only piece it together. The empty-selection inspector says "Others 15 drawn faint when a selection reaches them", meaning interfaces with no chokepoint or crossing, but it never names them, and the map draws them the same as any other faint line. Nothing shows code that no invariant reaches. Low confidence. | Everything, as the banner says. Beyond that, Core has "Load-bearing here (0)" (`mnemion-sel-node-shared-core.png`), so the most central part carries one requirement and no chokepoint. That can only be found by clicking Core. |

---

## 3. Visual hierarchy

- **Red does two jobs.** It's the colour of the hooks route in Coherence (`coherence-sel-route-src-lifecycle--sessionstart.png`) and also "broken / structural defect" in the legend. The red entrance block is the largest saturated shape on a healthy map. This is the worst problem on the page.
- **Yellow/orange does three jobs.** It's the selection highlight, the run/refute route (amber), the Journal rail (tan) and, in light mode, the spec route (red-orange). In `coherence-1440-light-node-src-spec.png` the orange selection lines can't be told apart from the orange spec route running beside them.
- **Red chips mean two things on Hive.** "9 crossings" is red only because the node is broken, but "crossings" is a count, not a failure. It looks like 9 failures.
- **Health chips vs. the banner.** In Mnemion, "0 structural defects" sits next to "2 requirements with a broken chokepoint". An owner reads that as a contradiction: broken, yet no defects? The vocabulary is exact, but the layout puts the zero first. Either merge the two or put the non-zero one first.
- **Selecting doesn't dim enough.** The empty-selection text says "the rest dims", but selecting a component or the "verified" health chip lights up nearly everything (`coherence-sel-health-verified.png`, `mnemion-sel-node-shared-routing.png`, `coherence-sel-node-src-journal.png`). Selecting Journal or Core doesn't highlight the rail itself either. Chokepoint selections dim correctly (`coherence-sel-chokepoint-...-warm-server...png`), and those are good.
- **Noise.** Every component has a "N crossings" chip and there are 17 X-tags. X21 appears four times around Spec. The identifier row between columns (X14 X15 X16 … X17, X7 X8 X9 X10) floats in empty space and doesn't sit visibly on a line. Column headers like "1 interface in" and "Where work enters" are tiny, and "1 interface in" reads like a count, not a column name.
- **Clipping.** At 820 px, the right column (Economy…Spec in Coherence, Features and "× 2 bro[ken]" in Mnemion) is cut off (`mnemion-820-light-fresh.png`, `coherence-820-dark-default.png`). At 500 px only the entrances and the first column are visible (`coherence-500-dark-fresh-full.png`). The canvas does scroll sideways (`coherence-500-dark-map-scrolled-right.png`), but nothing shows that it can, and the entrances scroll out of view. The inspector at 1440 has a fixed height, so long lists are cut off mid-section (`coherence-sel-node-src-spec.png`, `mnemion-sel-none.png`, where "Interface identifiers / X9 SSRF..." is cut).
- **Typography.** The masthead ("Coherence", serif "47 concepts, glossary version 2") is the biggest type on the page, but it's about the glossary, not the structure. The health line is 13 px. The hierarchy is upside down for the owner.
- **Possible state bug (low confidence, harness-dependent).** Going back to `#structure` in the same tab after selecting Spec kept Spec selected (`coherence-500-dark-default.png`), and the same happened with Hive in `mnemion-1440-light-default.png`. Fresh loads behave. Worth checking in a real browser.

## 4. Legend and terms I couldn't decode where I first met them

- **"C x — C: a chokepoint; X: one whose invariant carries a crossing."** The glyph is two bare letters, and the distinction (C vs. X) is the single most important signal about security, but it's hidden in the legend's weakest cell. On the map, "C12" and "X13" look the same apart from one letter.
- **"Outlined" (dashed box) = requirement vs. "solid" = verified.** The difference at tag size (`X9` dashed vs. `X9` solid) is almost invisible in dark mode.
- **The bar at a component's left.** "Its worst verdict": hatched means requirement, red means broken, pale means verified. It's 3 px wide, so the only per-component health signal is the thinnest mark on the node.
- **"Derived route", "reference weight", "stub", "rail".** None of these can be decoded without the glossary links. "Load-bearing interface on no route" and "Interface a selection reached" are drawn as nearly identical grey line samples.
- **"bullets"** in the header ("114 bullets (114 invariants, 0 requirements)"). It's an implementation noun, and it shouldn't be the first count an owner sees.
- **"1 interface in" / "2 interfaces in".** These are column headers meaning depth from the entrance, but they read like counts.
- The legend is always at full length below the map (9 entries, 3–4 lines each). A newcomer needs it; an owner on the fifth visit doesn't.

## 5. The inspector

- **Order is inverted for the owner.** A component opens with the prose description, then every invariant (8–18 rows, each with a verdict and date line), then Folder/Calls/Called by, then routes, then load-bearing interfaces, then the Calls/Called-by lists. The answer to "what does a change affect" is at the bottom, below the fold. Put *Calls / Called by / Load-bearing here / Routes* first and collapse the invariant list to one line: "8 verified" or "16 requirements, **2 broken**", with the broken ones expanded.
- **Repeated verdict lines.** "verified 2026-09-22" is repeated 8–15 times per panel. When every row is the same, say it once.
- **Chokepoint panel (`coherence-sel-chokepoint-…`, `mnemion-sel-chokepoint-…`) is the best panel.** It shows verdict, component, chokepoint symbol, what it protects, the crossing with both trust levels defined, and the interfaces it stands on. Keep it.
- **Broken-chokepoint panel (`mnemion-sel-broken-entities-hive.png`) is also strong.** It gives file:line bypass sites and "What an agent does next". Keep it.
- **Empty-selection panel** gives counts (On routes 11 / Stubs 14 / Load-bearing 14 / Others 15) that can't be clicked. Make each count a selection that highlights that set on the map. "Others 15" is the closest thing to "not covered", and it deserves a name and a highlight.
- **Audience drift.** Collapsed sections such as "Enforcement record, for agents chokepoint, totality oracle" are written for agents, which is fine hidden, but the title wraps and reads as a run-on.

---

## 6. Ranked changes

1. **Take red off every route.** Reserve red for broken, defect and bypass only. Recolour the Coherence hooks route (SessionStart…) to a non-alarm hue. *Problem:* `coherence-sel-none.png`, `coherence-sel-route-src-lifecycle--sessionstart.png`.
2. **Open on no selection, with a health-first inspector.** Drop the default route selection. The empty state should say "Healthy: 114/114 verified" or "Not enforced: 36 requirements, 2 bypassed in Hive". *Problem:* `coherence-1440.png`, `mnemion-1440.png`.
3. **Promote the health line to headline size and demote the masthead.** Move "47 concepts, glossary version 2" and "bullets" into a small metadata line. Give Coherence a one-line verdict sentence, the way Mnemion has its red banner (a green or neutral "Everything declared is enforced and verified as of <commit>"). *Problem:* `coherence-sel-none.png` vs. `mnemion-sel-none.png`.
4. **Pick one selection colour and keep it off the route palette.** Remove amber/tan/orange routes, or change the selection to a neutral white or blue outline plus the dimming. In light mode especially. *Problem:* `coherence-1440-light-node-src-spec.png`.
5. **Show direction when a component is selected.** Use one style for "calls" (outgoing) and another for "called by" (incoming, which is what a change affects), and actually dim everything not reached. Highlight the rail itself when a core dependency is selected. *Problem:* `coherence-sel-node-src-spec.png`, `mnemion-sel-node-shared-routing.png`, `mnemion-sel-node-shared-core.png`.
6. **Reorder the component inspector.** Put impact (Called by list, load-bearing interfaces, routes) first and collapse invariants to a summary with the broken ones expanded. Let the panel scroll with the page, or make it sticky with its own visible scroll hint, instead of cutting it off. *Problem:* `coherence-sel-node-src-spec.png` (cut at "Load-bearing here (4)"), `mnemion-sel-node-entities-hive.png`.
7. **Make "not covered" visible.** Name and draw the "Others 15" interfaces (no chokepoint, no crossing) as a selectable set with a distinct stroke, and flag components whose load-bearing count is 0 (Mnemion's Core). *Problem:* `coherence-sel-none.png` inspector, `mnemion-sel-node-shared-core.png`.
8. **Make C vs. X readable on the map.** Use different shapes (for example a circle for a chokepoint and a diamond for a crossing), not just the first letter, and use a stronger dashed-vs-solid contrast for requirement vs. verified. Replace the bare "C x" legend glyph. *Problem:* `mnemion-sel-none.png` (C12 vs. X13 vs. X9), legend in every shot.
9. **Stop colouring the crossings count chip red** on broken components. Keep the red on the "× 2 broken" tag only. *Problem:* `mnemion-sel-none.png`.
10. **Narrow widths.** At 820 and 500 px, scale the SVG to fit or add a visible "scroll →" affordance and keep the entrance column pinned. *Problem:* `mnemion-820-light-fresh.png`, `coherence-500-dark-fresh-full.png`, `coherence-500-dark-map-scrolled-right.png`.
11. **Rename the column headers** "1 interface in" / "2 interfaces in" to "1 step from entry" / "2 steps", and make them larger. Put the core-dependency rail labels at normal contrast. *Problem:* `mnemion-sel-none.png`.
12. **Collapse the legend by default after the first visit** (remember it per viewer), and merge the two near-identical grey line entries. *Problem:* legend in `coherence-sel-none.png`.
13. **Health chips:** put non-zero chips first, and in Mnemion either fold "2 broken chokepoint" into the structural-defect chip or explain the difference on the chip itself. *Problem:* `mnemion-sel-health-bypassed.png`.

## Keep

- Mnemion's red "Nothing is enforced yet" banner: plain, true, and first.
- The chokepoint inspector (protects / crossing with trust levels defined / stands on) and the broken-chokepoint panel with file:line bypass sites and "What an agent does next".
- Chokepoint selection, which dims correctly and traces exactly the interfaces it stands on.
- The left-to-right layout (entrances → depth columns → core rails at the bottom). It reads as flow.
- Entrance labels that group tokens ("+9 more") rather than drawing 21 separate lines.
- Deep-linkable selections (`#structure--node-…`, `#structure--chokepoint-…`) for pointing an agent or colleague at a thing.
- Light and dark both work; light mode's contrast on nodes is actually better.
