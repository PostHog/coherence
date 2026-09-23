# Security-reviewer read of two Structure maps (blind)

Reader: a security reviewer who has never seen either codebase and has one hour to find trust boundaries, sensitive data flows, load-bearing enforcement, and what is broken.
Method: headless Chrome at 1440 wide. I screenshotted every selectable id in both pages: routes, components, interfaces, chokepoints, trust levels, entrances, "change" and "none". I found the ids through `--dump-dom`. Trust-level and entrance ids only appear in the DOM after the page settles (`--virtual-time-budget`), and a first dump without that setting missed them. All screenshots are in `shots-security/`. Deep-linking to a component or chunk id scrolls the page, so some shots have an empty band at the top. The inspector text is still readable in them.

---

## Map A: Mnemion (persistent shared memory for agents)

### 1. Trust boundaries from the picture alone, then checked

**Picture-only guess** (`mnemion-default.png`, `mnemion-none.png`):
- There are three boxed codes: X9 and X13 on the Hive–Auth horizontal, and C12 twice on the Hive/Session/Routing vertical. X9 and X13 carry a faint dotted pink tick. C12 does not.
- The red text "× 2 broken chokepoints, 7 bypasses" floats between Features and Hive.
- I guessed that Routing is HTTP ingress (untrusted) and Session is the agent/MCP session. I guessed that Hive is the store, Auth is the token check (X13), and IO is outbound network (X9, maybe SSRF). I read C12 as the check where agent input enters the store. I read the red label as a problem on the Features→Hive interface.

**Checked against the inspector:**
- Right: X9 is SSRF block-host coverage, owner-trusted → federated. X13 is register-token revalidation, served-untrusted → owner-trusted.
- Wrong: C12 is "tools SSOT totality", a consistency check between the MCP tool list and /api/tools. It is not a trust boundary, and "C" means no crossing.
- Wrong: the red label belongs to the Hive component, not to the Features→Hive line.
- Wrong, and the most serious miss: the boundaries that matter most do not appear on the map at all. These are agent-mcp → storage (kernel write boundary, sql-identifier quoting, immutable fields), storage → public-egress (born-hashed secrets, egress-sensitivity totality) and served-untrusted → storage (kernel read+write capability). Each one is listed as "stands on no component interface" (`mnemion-level-agent-mcp.png`, `mnemion-level-storage.png`, `mnemion-level-public-egress.png`). The picture shows 2 of roughly 20 crossings.

### 2. Questions answered from the map

| Question | Selections | Confidence |
|---|---|---|
| Trust levels and which side components sit on | 1 (none) + 6 (one per level) = 7 | Low |
| Chokepoints and what they protect | 3 (X9, X13, C12) | Medium for these three; low for the rest |
| Weak or unenforced controls | 3 plus header reading | Medium |
| What is broken | 2 (Hive component, then scroll) | Medium |

- **Trust levels:** there are six: owner-trusted, storage, served-untrusted, public-egress, agent-mcp and federated. The map does not place components on sides of a boundary. A level only lights the interfaces whose crossing names it. owner-trusted lights Hive, Auth and IO. federated lights Hive and IO. served-untrusted lights Hive and Auth. **agent-mcp, storage and public-egress light nothing**, even though agent-mcp has 7 crossings and storage has 9, all of them inside Hive or Features. The "nothing selected" panel says "storage 0 interfaces" and "agent-mcp 0 interfaces" (`mnemion-none-tail.png`), which reads as "no exposure" when it means "not drawable". From the lists I inferred that Hive holds nearly every boundary: agent input to storage, served reads, credential mint and egress. Routing holds served-read gating and content inertness.
- **Chokepoints:**
  - X9 (isBlockedFederationHost) protects outbound federation fetch.
  - X13 (resolveRegisterToken) protects invite and consume.
  - C12 (TOOLS) protects tool-registry consistency.
  - The "Chokepoints (16)" list in the none panel shows there are 13 more, none of them drawn.
- **Weak or unenforced:**
  - The header says "0 invariants, 36 requirements", so every security control is unenforced by definition.
  - All three drawn tags are graded "not chokeable". Each chokepoint says "not run 2026-09-17" and "kept from an earlier run". Only the totality-oracle half shows a green "verified" chip. The SSRF oracle reports 75 tests.
  - The refutation for each is "missing".
  - On the map, all of this looks exactly like Coherence's healthy, reference-choked, refuted invariants: the same white-on-dark box and the same pink tick. You learn it is weak only by reading the inspector.
- **Broken now:** the Hive inspector (`mnemion-node-entities-hive.png`, `mnemion-hive-insp-bottom.png`) lists "kernel write boundary", a requirement with 5 bypasses, all inside entities/Hive, "no interface can show them". It also lists "facet/kernel-column collision" with 2 bypasses inside Hive.
  - The kernel write boundary is the agent-mcp → storage control, so it is the most important invariant in the product, and it is broken.
  - What I would do: block releases touching Hive until the 5 bypass sites are listed and routed through the kernel write chokepoint, and give that chokepoint a symbol so it can be reference-choked. Next, write a refutation for it, then promote the 36 requirements that carry crossings to invariants.
  - The map does not give me the bypass sites. I would have to leave the Structure tab to find them.
- **The change that would worry me most:** entities/Hive. It is a single Durable Object that "owns all SQLite data and funnels every agent write through one kernel-enforced chokepoint". That chokepoint is broken 5 times inside Hive. 7 of 7 other components call Hive, and about 17 crossings live inside it.

### 3. Following sensitive data

I tried to trace agent-supplied content from MCP input to storage and then out through public egress. I lost the thread at the first step:
- No entrances are declared ("0 entrances"). The four routes are "derived" from reference weight, not from data flow ("via Session (derived)" and so on).
- Selecting agent-mcp lights nothing.
- The crossing list says the kernel write boundary is "in entities/Hive". So the path would be "something → Hive → storage", but the map cannot draw the ingress (MCP tool surface), the store, or the egress (served responses).
- Second attempt, served-untrusted: I get Hive → Auth over X13, which is only token revalidation. Served-read gating and content inertness are "in shared/Routing" with no interface.
- The only traceable security path on the map is Hive → IO over X9, the federation fetch. It is also the least central one.

### 4. Interpretability problems

- **The derived routes are misleading for security.** Their names ("via Features", "via Hive") describe reference weight, and a route like root → Session → Hive → Features → Routing → IO does not follow request flow. A security reader will take them as request paths.
- **The X9 tag is placed ambiguously.** It sits on the Hive–Auth horizontal, next to X13, but it belongs to IO → Hive, which joins that horizontal from a vertical. In `mnemion-route-via-entities-features.png` the orange route runs straight through the faded X9 box, as if the route crosses SSRF.
- **Call direction is not trust direction.** X9 is on "shared/IO → entities/Hive" (IO calls Hive's check), with the arrow pointing into Hive, but the crossing is owner-trusted → federated, which is outbound. The edge arrow and the crossing arrow point opposite ways, and neither is explained.
- **The trust-boundary mark is weak.** The "dashed red bar through it is the trust boundary" is a few pixels of dotted pink. At default zoom I could barely see it, and it does not show which side is which level.
- **C versus X is lost at a glance.** C12 and X13 look identical, and so do grades: a "not chokeable" requirement looks the same as a reference-choked invariant.
- **Numbering across the two maps collides.** The numbering is sparse (C12, X9, X13, with nothing from 1–8 shown) and not stable. Both maps have an "X9" that means different things.
- **Hive's broken state is not alarming enough.** Hive has only a thin red outline in the default view, and the red text floats above Hive onto the Features→Hive line. An agent-writes-to-storage control is broken, yet the map's loudest color is the gold route.
- **"not run 2026-09-17" and "kept from an earlier run (2026-09-17 21:17)" in yellow** are confusing when shown next to a green "verified 2026-09-17". Which result is current?
- **Boilerplate example text reads like advice.** The "not chokeable" explanation for the SSRF and TOOLS chokepoints both say "write the symbol (`writeClass`), the symbol in its file (`KERNEL_WRITE_POLICY in policy.ts`)". A reviewer could take that as "the SSRF check should live in policy.ts".
- **Counts undercount real exposure.** The "Where data goes, by trust level" counts (storage 0, agent-mcp 0, public-egress 0) count interfaces, not crossings.
- **The "What changed" panel is inert** ("No second state is in this page, so nothing is lit"), yet it is offered as a selectable story.
- **The page promises trust-level selection in the map, but levels can only be selected from the inspector list.** The map has no trust-level legend or swatch.

### 5. Single most useful change

Draw crossings where they actually live. When a crossing "stands on no component interface", draw it on the component itself as a banded boundary inside the box with the two level names, so the map shows every boundary. Show the chokepoint grade and run state on the tag: for example, red or hollow for not chokeable, not run or broken, and solid for reference-choked and refuted. Without this, the Mnemion map shows 2 of about 20 boundaries and hides the one that is broken.

---

## Map B: Coherence (developer tool that keeps requirements enforced)

### 1. Trust boundaries from the picture alone, then checked

**Picture-only guess** (`coherence-default.png`, `coherence-none-tall.png`):
- The six host-hook entrances (SessionStart…SubagentStop) enter Lifecycle, so I placed a host/agent boundary there.
- X14–X16 on root → Lifecycle, and X17 (with pink ticks) on root → Scope, looked like boundaries from CLI input.
- X7–X10 on Lifecycle → Enforcement looked like the boundary to a spawned test runner.
- X1, X11 and X21 on the Adapters, Journal and Spec rails looked like boundaries into the language server, persistent storage and spec parsing.
- I saw nothing broken.

**Checked against the inspector:**
- Mostly right: X7–X9 are instrument → record, X10 is harness → instrument, X11 is project-source → record, X1 is project-source → instrument, and X21 and X17 are project-source → reading.
- Wrong about the hook boundary: the harness crossings X14–X16 are drawn on root → Lifecycle. The hook entrance line from the harness has no tag and no bar (`coherence-route-src-lifecycle--sessionstart.png`).
- Wrong about "nothing broken": the none panel says "14 load-bearing … 1 broken". The broken item is "attributed writes" on the Journal, and it has no mark anywhere on the map.

### 2. Questions answered from the map

| Question | Selections | Confidence |
|---|---|---|
| Trust levels and sides | 1 + 5 = 6 | Medium-low |
| Chokepoints and what they protect | 1 (none panel lists all 11 with crossings) + per-tag | Medium-high |
| Weak or unenforced | about 11 chokepoint selections | Medium |
| What is broken | about 8 (read every component until Journal showed it) | High once found |

- **Trust levels:** there are five: harness (the host's stdin), project-source (agent-authored text), instrument (language server, warm server, test runner), record (.coherence files) and reading (Scope output). Components do not sit on sides. project-source lights 12 interfaces, almost the whole map, so it is useless as a filter. harness lights root → Lifecycle, Economy → Enforcement and Lifecycle → Enforcement, but **not the hook entrances where harness data enters**. As in Mnemion, most crossings (for example "session names the run file": harness → record) "stand on no component interface".
- **Chokepoints:**
  - runHook: REFUSE_EXIT / OUTSIDE_ROOT_EXIT (X14, X15).
  - install / mergeHooks (X16).
  - withWarmAdapter / connectAdapter (X10).
  - performRun (X7–X9).
  - src/journal/store.ts / journalDir (X11).
  - loadSpecModel (X21).
  - parseName (X1).
  - buildScopePage (X17).
  - The inspected ones are "reference-choked" invariants that were verified and have witnessed plus automatic refutations (`montage-coherence-1.png`). This map is healthy where it draws.
- **Weak or unenforced:** the one open requirement, "attributed writes". I found no weak grades on drawn tags. The map gives no visual signal of grade either way, so I had to open each tag to confirm strength.
- **Broken now:** "attributed writes", a requirement on Journal with "2 bypasses, 0 inside src/journal". The bypasses are on ". → src/journal", shown as "broken: 2 bypasses" in the Journal load-bearing list (`coherence-node-src-journal.png`, `montage-coherence-3.png`).
  - What I would do: route the root's two direct journal writes through the attributed-write path, then give the requirement a refutation. Journal records are the "record" trust level, and unattributed records are "worthless" by that level's own definition.
  - It also labels a *requirement* (not yet enforced) as a broken chokepoint. Is it broken, or just unfinished?
- **The change that would worry me most:** src/journal. It is the core dependency called by 8 of 9 components, carries the only broken item, and defines the "record" level, which later sessions trust. Second would be src/lifecycle, the only component taking harness stdin.

### 3. Following sensitive data

I traced harness stdin (session id and agent type) to a durable record:
- It enters at the SessionStart… entrance block and reaches Lifecycle. The line has no crossing mark.
- It goes to Enforcement over X7–X10, where X10 is harness → instrument.
- It goes on to Observation and then Economy.
- I lost the thread at the record step. "session names the run file" (harness → record) stands on no interface. The Journal writes run down stubs to the rail, and the route does not show them. The broken root → journal bypass is not on any route.
- I could see where harness data goes next, but not where it becomes a durable, trusted record.

### 4. Interpretability problems

- **The broken item is invisible on the map.** Mnemion at least prints a red label; here there is no red outline, no label and no mark on the Journal rail. Only the none-panel count ("1 broken") and the Journal inspector show it. This is the worst failure in this map.
- **Trust-level highlighting works per interface, not per tag.** Selecting "record" lights all of X7, X8, X9 and X10, but X10 is harness → instrument. Selecting "harness" lights X7–X9 too (`coherence-level-record.png`, `coherence-level-harness.png`).
- **Harness crossings sit on root → Lifecycle, not on the entrance line from the host.** The one place untrusted host input arrives has no boundary drawn. The sessionstart route does not pass X14–X16 at all.
- **X10 appears twice** (on Economy → Enforcement and on Lifecycle → Enforcement). That is correct ("on 2 interfaces"), but it looks like a duplicate or a typo.
- **Code gaps** (X1, X7–X11, X14–X17, X21) suggest missing items. There are no C codes, so I cannot tell whether a pure chokepoint exists without a crossing.
- **Rail tags stack in one column** (X1, X11, X21 at the same x on three rails) and read as one vertical boundary crossing all three rails.
- **Entrances, routes and colors crowd the page.** Twenty entrances grouped into 8 colored blocks is fine for flow but carries no trust signal. Nothing marks the hook block as "harness" or the CLI blocks as "project-source".
- **Health is invisible.** A strong reference-choked, refuted invariant looks the same as Mnemion's not-chokeable, not-run requirement, so the good news is invisible too.

### 5. Single most useful change

Put state on the map. Mark any component or rail with a broken chokepoint in red, with a count badge. Draw the trust level at each entrance, for example "harness" on the hook block and "project-source" on the CLI blocks. Then a reviewer can see where untrusted input enters and where it is broken without opening ten inspectors.

---

## Ranked issues (both maps)

| # | Issue | Where | Severity | Evidence |
|---|---|---|---|---|
| 1 | Most crossings "stand on no component interface" and are not drawn. The map shows 2 of about 20 boundaries in Mnemion, and agent-mcp, storage and public-egress light nothing. | Mnemion (and Coherence) | Blocks understanding | mnemion-level-agent-mcp.png, mnemion-level-storage.png, mnemion-level-public-egress.png, coherence-level-harness.png |
| 2 | The broken invariant has no mark on the map. Coherence's "attributed writes" (Journal) is findable only through the count plus the component inspector. | Coherence | Blocks understanding | coherence-default.png, coherence-node-src-journal.png |
| 3 | Mnemion's broken kernel write boundary (agent-mcp → storage, 5 bypasses) shows only as a small floating label placed over the Features→Hive line, and the bypass sites cannot be shown. | Mnemion | Blocks understanding | mnemion-none.png, mnemion-hive-insp-bottom.png |
| 4 | Tags carry no grade or state. "Not chokeable, not run, refutation missing" requirements look identical to verified, reference-choked, refuted invariants. | Both | Blocks understanding | mnemion-chokepoint-entities-hive--ssrf-block-host-coverage.png vs montage-coherence-1.png |
| 5 | Mnemion has no declared entrances. Routes are derived from reference weight and named "via X", which reads as request flow but is not. | Mnemion | Blocks understanding | mnemion-default.png, mnemion-route-via-entities-features.png |
| 6 | Trust-level selection highlights whole interfaces with every tag on them, so tags of other levels light up (for example, X10 under "record"). | Coherence | Slows | coherence-level-record.png |
| 7 | The harness boundary is drawn on root → Lifecycle instead of on the host hook entrance line, so the route carrying harness data never crosses it. | Coherence | Slows | coherence-route-src-lifecycle--sessionstart.png |
| 8 | The "by trust level" counts show "0 interfaces" for levels with 7–9 crossings, which reads as no exposure. | Mnemion | Slows | mnemion-none-tail.png |
| 9 | Call direction and crossing direction conflict (X9 edge IO → Hive, crossing owner-trusted → federated), and nothing explains it. | Mnemion | Slows | mnemion-interface-shared-io--entities-hive.png |
| 10 | The X9 tag sits on the Hive–Auth horizontal, and a route drawn through it looks like it crosses SSRF. | Mnemion | Slows | mnemion-route-via-entities-features.png |
| 11 | The boilerplate "not chokeable" text cites `writeClass` / `KERNEL_WRITE_POLICY in policy.ts` for unrelated chokepoints (SSRF, TOOLS), which reads as advice. | Mnemion | Slows | mnemion-chokepoint-entities-session--tools-ssot-totality.png |
| 12 | The trust-boundary "dashed red bar" is a few pixels of dotted pink with no level names on either side. | Both | Slows | mnemion-default.png, coherence-default.png |
| 13 | Run state chips conflict ("not run 2026-09-17", "kept from an earlier run", "verified 2026-09-17" on one control). | Mnemion | Slows | mnemion-chokepoint-entities-hive--ssrf-block-host-coverage.png |
| 14 | "attributed writes" is called both a requirement and a broken chokepoint, so it is unclear whether it is broken or unfinished. | Coherence | Slows | montage-coherence-3.png |
| 15 | Identifier numbers are sparse, collide across maps (two different X9s) and give no C/X legend on the map itself. | Both | Cosmetic | mnemion-none.png, coherence-none-tall.png |
| 16 | Rail tags X1, X11 and X21 stack in one column and read as a single vertical boundary. | Coherence | Cosmetic | coherence-default.png |
| 17 | The "What changed" story is selectable but empty ("nothing is lit"). | Both | Cosmetic | mnemion-change-insp1.png |
| 18 | The intro invites selecting "a trust level", but trust levels can only be selected from the inspector list, not on the map. The map has no legend. | Both | Cosmetic | mnemion-default.png |
| 19 | Deep links scroll the page and hide the top of the map and inspector. | Both | Cosmetic | coherence-node-src-lifecycle.png |
