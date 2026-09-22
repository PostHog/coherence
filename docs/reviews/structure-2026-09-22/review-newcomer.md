# Blind review: Structure maps, newcomer seat

Reader: an engineer in their first week who has never seen either codebase and has one afternoon.
Method: headless Chrome at 1440 wide, deep links taken from the rendered DOM, and every screenshot read. All screenshots are in `shots-newcomer/`. Prefixes: `m-` is Mnemion, `c-` is Coherence.
Dark mode is the default in this environment. I rendered light mode with `--blink-settings=preferredColorScheme=1` (`m-light.png`, `c-light.png`).

Caveat on task 1: both default screenshots include the legend paragraph under the map and a route inspector, and they sit in the same frame as the picture. My "picture only" reading therefore comes from the diagram area alone; I did not read the prose first. I cannot claim I never saw it.

---

## Map 1: Mnemion-js (a persistent shared-memory service for AI agents)

### 1. Reading from the picture alone, then checking it

**What I guessed from the picture** (`mnemion-default.png`, `m-none.png`):
- A root "Mnemion" fans out into four colored lines. The labels are "via Routing", "via Features", "via Hive" and "via Session", all dashed and marked "derived".
- The middle column is a stack: Features, Hive, Session, Routing. Auth and IO sit on the right.
- A thick grey bar along the bottom reads "Core · called by 7 of 7".
- A red "× 2 broken chokepoints, 7 bypasses" floats over Hive, and Hive has a red outline.
- Small boxed tags read X9, X13 and C12 (twice).

My guess: an HTTP-ish service. Requests enter at the root and go through Routing to IO, or through Session and Hive to feature code. Auth is a side service. Core is a shared utilities library. Hive is broken somehow. I guessed "Hive" was some kind of grouping or tenancy concept.

**What the legend and inspector corrected:**
- **Right:** Core is shared primitives (`m-node-core.png`). Auth and IO are leaf services. Hive is where the trouble is.
- **Wrong 1: the entry points.** No entrances are declared. The four "via" lines are not four ways in. They are computed by a greedy "heaviest interface" walk from the root. The picture gives no hint that these are synthetic. "derived" in italics does not say "made up by an algorithm".
- **Wrong 2: what Hive is.** Hive is "the single per-user Durable Object that owns all SQLite data and funnels every agent write through one kernel-enforced chokepoint" (`m-node-hive.png`). It is the heart of the system. The picture gives it the same small box as everything else, and I only learned this by clicking it.
- **Wrong 3: the direction of C12.** It goes Hive→Session and Routing→Session, not "Session feeds Hive". The small arrowheads were invisible to me at first glance.
- **Wrong 4: what "broken" means.** The two broken chokepoints ("kernel write boundary", 5 bypasses; "facet/kernel-column collision", 2 bypasses) are *inside* Hive. The inspector says "no interface can show them". So the map's most important risk has no drawn location except a floating caption.

### 2. Answering the questions from the map

| Question | Answer from the map | Clicks | Confidence |
|---|---|---|---|
| Where does work enter? | The map says no entrance is declared. The 4 derived routes all start at the root. The root's heaviest interface is to Routing (157 sites, `m-route-routing.png`), so the real front door is probably Routing, but that is my inference. | 4 (one per route) | Low |
| Which component to read first for core logic? | Hive, after reading its description. Nothing in the picture says so: it is not larger, not central, and not labeled as the core. | 1 (select Hive) | Medium, only after the click |
| What is load-bearing? | Hive→Session (C12, TOOLS), Hive→Auth (X13, resolveRegisterToken), IO→Hive (X9, isBlockedFederationHost). Plus the kernel write boundary inside Hive, which is not drawn. | 3 identifiers + Hive = 4 | Medium |
| Where does trusted data cross a boundary? | X13: served-untrusted → owner-trusted at Hive→Auth. X9: owner-trusted → federated at IO→Hive. Three trust levels list 0 interfaces: storage, public-egress, agent-mcp. | 2 | Medium. The red dashed bars show *where* a crossing is. Which side is trusted is only in the inspector. |
| What is broken or risky now? | 2 broken chokepoints with 7 bypasses, all in Hive. The header also says 0 invariants and 36 requirements, meaning nothing is enforced yet, but the Structure view never says so plainly. Every identifier I opened says "not chokeable", "not run", and refutation "missing". | 1 (Hive) + reading 3 identifiers | High that it is broken; low on what that means for me |

### 3. Storytelling

Selecting a route lights a path and lists hops with site counts. Here is the retelling I could give a colleague for **via Features** (`m-route-features.png`):

> "Root code calls into features (11 sites). Features leans heavily on the Hive, 80 references. The Hive calls Auth across X13, and that is where untrusted served input gets promoted to owner-trusted, so register tokens get revalidated there."

That is a usable story, but only because X13 sits on it.

The other three routes tell me call-graph weight, not behavior. **via Session** goes Session → Hive → Features → Routing → IO. It zigzags up and down one column, which reads as a request bouncing around, and the route has no arrows to disambiguate. I could not retell *what happens*: there are no verbs, only folder names.

### 4. Where I was confused or misled

- **"derived" routes.** I assumed they were real request paths. They are an algorithm's walk. The explanation is in fine grey inspector text.
- **The default opens on "via Session" (3 sites at the root).** The legend says "the map opens on the busiest entrance's route", but via Routing has 157 sites. Either "busiest" means something else, or the claim is wrong. Either way I distrusted the legend after that.
- **X vs C.** The legend says C is a chokepoint and X is one whose invariant carries a crossing. So is X a chokepoint too? I had to infer that X means "chokepoint + trust crossing". The numbers (9, 12, 13) have gaps and look like indices into an invisible list, which made me hunt for X1–X8.
- **X9's direction.** The inspector lists X9 as "in entities/Hive", but it is drawn on the IO→Hive line, and the protected fetch is outbound federation. So is outbound traffic drawn as an inbound arrow? I could not work out the direction.
- **The broken-chokepoint caption.** It hovers between Features and Hive and overlaps the Features→Hive line. It is not attached to anything clickable in the picture.
- **Hive's red outline.** It only means "broken", and that is decodable only by coincidence with the caption.
- **Selecting Hive** (`m-node-hive.png`) sprays dashed yellow lines everywhere, and one runs down off the map to the Core rail. It is visually louder than the routes, and I could not tell the dashed lines ("plain interface a selection reached") from the solid ones.
- **The "−" box on the root node.** I could not decode it. Collapse? Minimize?
- **". →"** in the inspector hop lists means the root folder. That is cryptic.
- **Inspector badge stack:** "not run 2026-09-17", "not chokeable", "kept from an earlier run", "verified 2026-09-17", "requirement", "missing". That is six status words with overlapping colors (yellow for both "requirement" and "kept"). I could not rank how bad each one is.
- **Fix-it advice for the spec author appears in the reader's view.** It says: "write the symbol (`writeClass`), the symbol in its file (`KERNEL_WRITE_POLICY in policy.ts`)…". It is the same boilerplate on every identifier. I briefly thought writeClass was part of the TOOLS chokepoint.
- **Column headers** "where work enters / one interface in / 2 interfaces in" are useful once decoded. But "where work enters" sits over the root, and there are "0 entrances".
- **Trust level names.** owner-trusted, served-untrusted and federated are clear with their inspector glosses. Nothing on the map itself explains them.
- **Light mode** (`m-light.png`). Dimmed labels ("via Routing") drop to near-white on white and are almost unreadable. The dimmed IO→Hive and X9 tags nearly vanish.

### 5. The single change that would help most

Say what each component *does* on the map itself: the one-line description under the name, and visual weight for the component that owns the data. For example: "Hive: per-user Durable Object; owns all SQLite; every write passes here". Hive's box should also carry the broken-chokepoint mark itself, instead of a floating caption. Without that, the picture is a folder graph, and every insight costs a click.

---

## Map 2: Coherence (a developer tool that keeps a codebase's requirements enforced)

### 1. Reading from the picture alone, then checking it

**What I guessed from the picture** (`coherence-default.png`, `c-none-tall.png`):
- On the left are many entrance pills in groups: journal verbs/work, spec, scaffold, run/refute/serve, economy/calibrate/mass, query/glossary/hooks install, six hook events (SessionStart … SubagentStop), and scope page.
- They feed a root, plus Lifecycle and Scope.
- Right column: Economy, Enforcement, Observation, Scaffold.
- Three rails along the bottom: Adapters, Journal, Spec.
- Many X tags (X1, X7–X11, X14–X17, X21).

My guess: a CLI plus agent-hook tool. Commands and hook events come in. Most paths go into Enforcement → Observation → Economy, which looks like "check → record → summarize cost". Journal, Spec and Adapters are shared libraries. Lifecycle handles the hook events. Scope renders a page.

**What the legend and inspector corrected:**
- **Mostly right:** Lifecycle is the hook handler (`c-route-lifecycle.png`, with a clear per-event description). Journal is an append-only store (`c-cp-journal.png`). Enforcement runs the checks (`c-node-enf.png`).
- **Wrong 1: Economy.** I read it as "cost accounting". The map never says what Economy is. The inspector says "economy, calibrate, mass" entrances go there, but that did not explain the word to me.
- **Wrong 2: "Observation".** I assumed logging. I still do not know what it is.
- **Wrong 3: "run → Enforcement → Observation → Economy" as a pipeline.** It is a greedy heaviest-edge walk, not an execution order. The "scope page" route also ends in Economy (`c-route-scope.png`), which makes no sense as a flow for rendering a page. So I cannot trust any route tail as behavior.

### 2. Answering the questions from the map

| Question | Answer from the map | Clicks | Confidence |
|---|---|---|---|
| Where does work enter? | The 20 named entrances on the left: CLI verbs, six agent-host hook events, the scope page. Selecting one gives its handler file (`c-ent-query.png`: `queryCommand` in `src/readings/query/cli.ts`). | 0 to see; 1 per handler | High. This is the map's best feature. |
| Which component to read first for core logic? | Enforcement. Five of eight routes pass through it, and its description ("chokepoint check… totality oracle pass… warm server") reads as the core. | 1 | Medium-high |
| What is load-bearing? | Many identifiers: X7–X10 on Lifecycle→Enforcement, X10 on Economy→Enforcement (warm server the only path), X11 journal append-only, X14–X16 on the root→Lifecycle hooks, X17 deterministic build, X21 spec, X1 name forms. | about 4 to sample; the full list is in the nothing-selected inspector | Medium. There are too many to hold in mind, and all look identical. |
| Where does trusted data cross? | Every identifier is an X, so every load-bearing interface is a crossing. Trust levels: project-source, harness, record, reading, instrument. | 2–3 | Low. "instrument", "reading" and "record" as trust levels are opaque without the glossary. |
| What is broken or risky now? | The nothing-selected inspector says "1 broken". I found no mark anywhere in the picture showing *which* one. Header: 97 invariants, 1 requirement. | Did not find it after about 12 selections | Low |

### 3. Storytelling

The hook route is the best story in either map (`c-route-lifecycle.png`). Retold:

> "The agent host fires six lifecycle events (session start, subagent start, prompt submit, post tool use, stop, subagent stop) into Lifecycle. On session start it injects vocabulary and standing. After each tool use it checks the edit and records a read trace. At Stop, 'regulate' reports what the session owes. Lifecycle hands off to Enforcement across four guarded interfaces (X7–X10) to actually run checks, then results go to Observation and Economy."

The first half comes from the entrance descriptions and is genuinely good. The second half ("then Observation, then Economy") is the same tail as four other routes, so it adds nothing. The **journal verbs** and **spec** routes (`c-route-journal.png`) are one hop into a rail, so there is no story at all: the line just stops at the root and the Journal rail glows.

### 4. Where I was confused or misled

- **Five of eight routes share the tail Enforcement → Observation → Economy.** Five colored lines run bundled up the right edge (`c-node-enf.png`), and I could not follow any single one.
- **Economy sits at the top of its column but is the *last* stop.** The routes loop around the right side and climb back up to reach it. The layout fights the reading order.
- **Identifier placement:**
  - X14/X15/X16 sit in a horizontal row *beside* the vertical root→Lifecycle line, not on it. I could not tell which interface they belong to until I selected X16 (`c-cp-install.png`).
  - X7–X10 are packed shoulder to shoulder on a short segment.
  - X10 appears twice, which is correct ("on 2 interfaces"), but that looks like a duplication bug at first.
- **All identifiers are X; none are C.** On Mnemion, C and X mixed. Here "X" carries no information, and I wondered whether C was even supported.
- **"1 broken" has no location in the picture.** Mnemion at least had a red caption.
- **The route inspector prints "X17" in place of a site count** for the first hop (". → src/readings/scope X17"). The same column mixes "60 sites" and an identifier.
- **The rails.** "Adapters · core dependency · called by 5 of 9" is clear, but X1, X11 and X21 sit on vertical stubs that overlap the rails, with red dashed bars. The stubs themselves are hair-thin, and I could not tell which component each stub comes from.
- **"Scope" is the project's own product name, a component (`src/readings/scope`), and the page title "Scope" in the header.** For a newcomer that is triple-booked.
- **Entrance labels group several verbs in one pill** ("run refute serve"). I first thought it was one three-word command.
- **Inspector detail:** it prints raw test-runner command lines (`node --disable-warning=ExperimentalWarning --test --test-concurrency=1 …`). That is noise at this altitude.
- **Light mode** (`c-light.png`): the dimmed rails and their labels (Adapters, Journal, Spec) are nearly invisible, and so are the dimmed entrance pills. Selected-node borders turn orange in light mode and yellow in dark. That is fine, but the colors are not documented.

### 5. The single change that would help most

Make routes say what happens, not which folder is heaviest. Label each hop with a verb from the entrance or interface description (for example "checks edit", "appends record"), and stop the walk where the entrance's behavior ends. Then "scope page" would not end in Economy, and five routes would not collapse into one tail. Failing that, show the "derived by heaviest-reference walk" caveat on the map itself.

---

## Ranked issues

| # | Issue | Where | Severity | Evidence |
|---|---|---|---|---|
| 1 | Routes are greedy heaviest-reference walks presented as "the path work takes". Tails are implausible (scope page → Economy) and repeated across routes, so the flow story is untrustworthy. | Both, most visible in Coherence | Blocks understanding | c-route-scope.png, c-route-run.png, c-node-enf.png, mnemion-default.png |
| 2 | Components carry no description on the map. The core (Mnemion Hive, the data owner) looks identical to leaf folders, and purpose is learned only by clicking each box. | Both | Blocks understanding | m-none.png vs m-node-hive.png; c-none-tall.png |
| 3 | The most important current risk is unlocated. Mnemion's 2 broken chokepoints are a floating caption ("no interface can show them"). Coherence's "1 broken" has no mark at all. | Both | Blocks understanding | m-none.png, m-node-hive.png, c-none-tall.png |
| 4 | Mnemion has zero declared entrances. The four "via … derived" pills look like entry points but are synthetic, so "where does work enter" cannot be answered. | Mnemion | Blocks understanding | m-none.png, m-route-routing.png |
| 5 | The legend claims the map opens on the busiest route, but Mnemion opens on via Session (3 sites at the root) while via Routing has 157. This erodes trust in the legend. | Mnemion | Slows | mnemion-default.png, m-route-routing.png |
| 6 | Identifier tags float off their line (X14–X16 beside the root→Lifecycle line), cluster densely (X7–X10), or appear twice (X10). Attachment is ambiguous. | Coherence | Slows | c-none-tall.png, c-cp-install.png, c-cp-warm.png |
| 7 | X/C scheme is under-explained. Is X also a chokepoint? Numbering has gaps. Coherence uses only X, so the letter carries nothing. | Both | Slows | m-none.png, c-none-tall.png |
| 8 | No direction on routes. Mnemion via Session zigzags up and down one column. Economy is placed at the top but visited last. Tiny arrowheads exist only on some grey interfaces. | Both | Slows | mnemion-default.png, c-default-tall.png |
| 9 | The inspector mixes author-facing remediation boilerplate ("write the symbol (`writeClass`)… KERNEL_WRITE_POLICY in policy.ts") and raw test-runner commands into the reader's view. | Both (worst on Mnemion) | Slows | m-cp-session.png, m-cp-hive.png, c-cp-warm.png |
| 10 | Status badges are too many and overlapping (requirement, invariant, not run, not chokeable, kept from an earlier run, verified, missing), with the same yellow for different meanings. | Both | Slows | m-cp-auth.png, c-cp-journal.png |
| 11 | Selecting a component sprays dashed "reached" interfaces that are louder than the routes, including one running off to the Core rail. | Both | Slows | m-node-hive.png, m-node-core.png |
| 12 | Mnemion's "0 invariants, 36 requirements" (nothing enforced) appears only in the small header, never in the Structure view's framing. | Mnemion | Slows | mnemion-default.png |
| 13 | Trust level names (instrument, reading, record, harness) are opaque without the glossary. Three Mnemion levels show "0 interfaces" with no explanation. | Both | Slows | c-none-tall.png, m-none-tall.png |
| 14 | Coherence journal verbs and spec routes are one hop into a rail: no line to follow, no story. | Coherence | Slows | c-route-journal.png |
| 15 | "Scope" names the product page, a component, and the page header at once. | Coherence | Cosmetic, but confusing | c-default-tall.png |
| 16 | Light mode: dimmed labels, rails and entrance pills fall to near-invisible contrast. | Both | Cosmetic, borderline slows | m-light.png, c-light.png |
| 17 | Undecoded glyphs and tokens: the "−" box on the root node, ". →" for the root folder, "X17" in the site-count slot. | Both | Cosmetic | mnemion-default.png, c-default-tall.png |
| 18 | Some inspector pages put the page top off-screen: the deep link to a component scrolls the header away. | Both | Cosmetic | m-node-hive.png, c-node-enf.png |
