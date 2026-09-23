# Newcomer review: Structure view, Coherence and Mnemion-js

Seat: a newcomer engineer, reading only the two pages. The review is blind: I read no source, docs or earlier reviews.
Method: headless Chrome at 1440, 820 and 500 wide, in light and dark (via prefers-color-scheme; I found no data-theme toggle). I opened selections through the page's own `#structure--<kind>-<id>` hash ids, which I found in the rendered DOM. All screenshots are in `shots-newcomer/`.

Capture caveat: when a deep link selects something that makes the page scroll (a node, a route, a boundary), the top of the capture is blank (`co-route-sessionstart.png`, `co-node-enforcement.png`, `mn-node-hive.png`, `mn-route-browser.png`). Taking the same selection in a taller window paints correctly (`co-node-enforcement-full.png`), so I think this is a headless paint artifact and I do not score it.

---

## 1. Ten-second test

**Coherence** (`co-none-light.png`, `coherence-1440-none-dark.png`)
1. Everything is verified: 114 invariants enforced, 0 requirements, 0 defects.
2. Almost every entrance funnels into one box, "Coherence (root)". Nine colored lines converge into a braid there.
3. There is a two-column grid of components, with Lifecycle and Scope on the left and Economy, Enforcement, Observation, Scaffold and Spec on the right. Two thick rails, Adapters and Journal, run along the bottom.

These are roughly the right three. What I did not get in ten seconds was *where work ends*. The right column reads as a list, not as destinations. The "–" glyph on the root box also reads as a control (collapse?) that is never explained.

**Mnemion-js** (`mn-none-light.png`)
1. Nothing is enforced yet. The red sentence says so, and it is the loudest text on the page.
2. The Hive component is broken: a red "× 2 broken" tag and a red "9 crossings" pill.
3. Two routes matter: MCP tools go Session → Hive → Auth, and the browser, OAuth and upload routes all land in Routing.

These are the right three for this system. The weak spot is the Mnemion (root) box. It is labelled "Cloudflare Worker entry", but no entrance line reaches it, which contradicts the word "entry".

## 2. Answering from the map

| Question | Coherence | Mnemion |
|---|---|---|
| Where does work enter? | 0 selections, high confidence. The left column of 10 colored chips (20 entrances), with the "+2 more" hook chip. Oddly, the header "Where work enters" sits over the *component* column, not over the chips. | 0 selections, high. There are 4 chips (21 entrances), and "+9 more" hides most of the browser routes. |
| Main parts and what each does | 0 selections, medium. Every role line is truncated mid-phrase: "A prosthetic for proprioception: specs", "The context closure of a change, the read traces", "The command that makes the complete". I needed 1 node selection (`co-node-enforcement-full.png`) to get a full sentence. | Same truncation, but the text is shorter so it mostly survives ("Credential primitives, multi-member passkeys"). |
| Follow one request | 1 selection (`co-route-run.png`), high: run/refute → Coherence (root) → Enforcement → Observation, and the inspector lists both interfaces with site counts. The hook route (`co-route-sessionstart.png`) goes Lifecycle → Economy, which surprised me; the map gives no hint *why* a SessionStart ends in Economy. | 1 selection (default, `mnemion-1440.png`), high: MCP → Session → Hive → Auth. The browser route (`mn-route-browser.png`) stops at Routing, so the map cannot say where those 13 entrances go after dispatch. |
| Healthy or broken? | 0 selections, high: all green, and every tag is solid navy. | 0 selections for "broken", high. For "what is broken", 1 selection (`mn-broken-hive.png`) gives 2 chokepoints and 7 bypass sites, which is clear. I did stumble on "0 structural defects" (red outline) next to "2 requirements with a broken chokepoint" (red fill). Is it broken or not? The distinction between a defect and a broken requirement is real, but the pills do not teach it. |

## 3. Visual hierarchy and color

- **What draws the eye first.** On Coherence it is the saturated red hook chip (SessionStart…) and the braid entering the root. The red chip should not win, because nothing on this map is broken. On Mnemion it is the red banner and then the Hive tag, which is correct.
- **Colors doing two jobs:**
  - **Red.** It is the hooks route color (`co-route-sessionstart.png`: a thick red line and a red chip) and also "broken / structural defect / bypass" (legend, and `mn-broken-hive.png`). On a healthy map, a newcomer's first read of the big red block is "alarm".
  - **Orange.** It is the selection highlight (box border, dashed "reached" lines in `co-node-enforcement-full.png` and `mn-node-hive.png`), the `spec` route color, and the Mnemion OAuth route and chip. In `co-node-enforcement-full.png` the orange-red spec route, orange dashed reach lines and orange selection border all touch Enforcement at once, and I could not separate them.
  - **Navy.** Solid navy tags are "enforced and verified", but the same navy fills every "N crossings" pill, which is a count, not a verdict.
- **Pink versus red.** The Coherence economy chip (pink) sits next to the hooks chip (red) and they are hard to separate, especially in dark mode.
- **Dark mode** (`coherence-1440-none-dark.png`): unselected route lines are dark and saturated on navy, so they nearly disappear. The Journal rail (tan) is the brightest line on the map and outshouts the routes.
- **Label noise.** Coherence has floating identifier strips (X14 X15 X16, X17, X7 X8 X9 X10) sitting in empty channels, detached from any box. X21 appears **four times** and X14/X15 twice. A newcomer reads that as four different things. "N crossings" pills under every box repeat a number whose meaning is only in the legend.
- **Clipping and overlap.** The Coherence role text is truncated in every box. The Mnemion chips stack 4–5 names and then "+9 more". At 820 and 500 (`coherence-820-light.png`, `coherence-500-light.png`, `mnemion-500-light.png`) the map is cut off at the right edge. It is a horizontal scroll container (`overflow-x: auto`), but nothing tells you so. At 500 you see only the entrances and the first column, and the Journal tab is clipped in the nav.
- **Typography.** The masthead mixes a serif subline with a sans heading. The "47 concepts, glossary version 2." line is the first thing under the title, and it says nothing about the system.

## 4. Legend and terms

I could not decode these where I first met them:
- "114 **bullets**" in the masthead. The word appears nowhere else.
- The "–" glyph on the root boxes.
- The bar at a box's left edge, and hatched versus solid bars (Mnemion). The legend says "the bar at its left is its worst verdict", but that sits in the fourth legend cell, below the fold at 1440×1000.
- "N crossings" pills: are they counts of something inside the box, or on its edge? The legend puts the explanation under "Trust boundary".
- The tiny red dotted tick through an identifier (trust boundary), which is invisible at normal zoom.
- "C12" versus "X9". The legend's "C: a chokepoint; X: one whose invariant carries a crossing" is correct but abstract.
- Column headers "1 interface in" and "2 interfaces in": depth from what? From the entrance? It is never said.
- Some inspector links are dotted-underlined and some are plain (`mn-node-hive.png`), and I could not tell what the underline means.

What works: the legend lives right under the map, the terms in it are links, and "Terms" and "How the map is laid out" are collapsible.

## 5. Inspector

- **Nothing selected** (`co-none-light.png`): good content, wrong order for a newcomer. The "On routes / Stubs / Load-bearing / Others" stats come first. "Where work enters", with each entrance's path, is the most useful block for me and should lead.
- **Route** (`co-route-run.png`): the right length and order: path, interfaces with site counts, entrances with one-line descriptions. Keep it as is.
- **Component** (`co-node-enforcement-full.png`): too long, and in the wrong order. Seventeen invariants, each with an identical "verified 2026-09-22" line, come *before* the routes through it, what it calls and who calls it. The panel runs about 1,300px, twice the height of the map. For a newcomer the order should be: role, routes through it, calls / called by, load-bearing interfaces, then invariants. On a healthy component, collapse the invariants to "17 verified".
- **Chokepoint** (`co-chokepoint-warm.png`, `mn-chokepoint-ssrf.png`): strong. The plain-English statement first, then the verdict, the component and the crossing with both trust levels defined. The agent-facing detail sits under disclosures. Keep it.
- **Trust boundary** (`co-boundary-lifecycle.png`): a long flat list of invariant names grouped by crossing. That is fine for an auditor, but it is noise for a newcomer.
- **Broken** (`mn-broken-hive.png`): good, with file:line sites and "What an agent does next" collapsed.

## 6. Ranked changes

1. **Take red away from the hooks route** (`co-route-sessionstart.png`, `co-none-light.png`). Reserve red for broken or defect only. Give hooks a route color that is not already used.
2. **Stop orange from doing two jobs** (`co-node-enforcement-full.png`, `mn-node-hive.png`). Either make selection a neutral high-contrast outline (black in light mode, white in dark) or take orange out of the route palette (`spec`, Mnemion OAuth).
3. **Reorder the component inspector** (`co-node-enforcement-full.png`): role → routes through → calls / called by → load-bearing → invariants, collapsed when all of them are verified.
4. **Show each component's full role sentence** (`co-none-light.png`). Wrap to a third line or widen the boxes. Right now every Coherence box loses its meaning mid-phrase.
5. **Deduplicate the floating identifier tags** (`co-none-light.png`: X21 ×4, X14/X15 ×2). Draw each identifier once, on its interface, and anchor the X14–X17 strip to the edge it sits on.
6. **Make the narrow-width map scroll visibly** (`coherence-820-light.png`, `mnemion-500-light.png`). Add a fade or shadow on the clipped edge and a "scroll →" hint, or offer a stacked list layout below about 900px. Stop the nav tabs clipping at 500.
7. **Fix the Mnemion health pills** (`mn-none-light.png`). "0 structural defects" next to "2 … broken chokepoint" reads as a contradiction. Merge them into one pill ("2 broken: bypassed requirements"), or add a one-line gloss.
8. **Put a header over the entrance chips and relabel the columns** (`co-none-light.png`): "Entrances" over the chips, "Handler" over the first component column, and "1 hop from handler" in place of "1 interface in".
9. **Dark mode: brighten unselected route lines and dim the rails** (`coherence-1440-none-dark.png`).
10. **Replace "bullets" in the masthead**, and put the system's own one-line description ahead of "47 concepts, glossary version 2."
11. **Explain the "–" glyph and the left bar where they appear**, for example with a tooltip or a first-row legend entry, and move "Component" to the first legend cell.
12. **Nothing-selected inspector:** lead with "Where work enters" and move the counts below it.

**Keep:** selecting something dims the rest; each route's lines keep one color; the route inspector; the chokepoint inspector's plain-English statement followed by the trust-level definitions; the Mnemion red banner and the Hive "× 2 broken" tag, which get health across in one glance; the legend under the map with linked terms; the rails for core dependencies, which keep 14 stubs from becoming spaghetti; deep-linkable selections.
