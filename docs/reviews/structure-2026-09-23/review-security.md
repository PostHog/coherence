# Security review of the Structure maps (blind)

Seat: security reviewer. Material: `coherence.html` and `mnemion.html`, Structure view only. Screenshots are in `shots-security/`, taken with headless Chrome at 1440 wide in dark (the default here) and light mode, plus a narrow width. Headless Chrome will not lay out below 500 px (I measured innerWidth at 500 when I asked for 390), so the narrow shots are 500 wide. I reached selections through the `#structure--…` deep links, which I found in the rendered DOM (`*-dom.html`): 12 on Mnemion and 8 on Coherence.

---

## 1. Ten-second test

**Mnemion** (`mnemion-1440.png`)
1. "Nothing is enforced yet… no identifier on this map is a working control." The red banner says this directly.
2. Hive is the hot spot: "✕ 2 broken" and a red "9 crossings" chip.
3. MCP tools flow Session → Hive → Auth. That route is drawn blue by default.

Are these the right three? Mostly. #1 and #2 are exactly what a security reviewer should see first. #3 is the wrong third takeaway. The default route is the *authenticated* agent path. The anonymous inputs (the OAuth/passkey block, 13 public "served" reads, document upload) are dimmed, and they are the more interesting attack surface. A reviewer's third takeaway should be "here is where anonymous input lands."

**Coherence** (`coherence-1440.png`)
1. 114 invariants are enforced and verified, with 0 requirements and 0 defects. The map is clean.
2. A big red block of hook events (SessionStart, SubagentStart, …).
3. The query route through root → Scope → Lifecycle is highlighted.

Are these the right three? No. The red hook block *reads as broken* at a glance, because the legend uses red for "broken". It is actually just the colour of the entrance group, so a clean map signals alarm. The pre-selected "query" route is the least security-relevant entrance. The real security story is the harness stdin → Lifecycle crossing (`harness → project-source`, X14/X15), and you only find it by clicking.

---

## 2. Answers from the map

### Mnemion

**Where does untrusted input enter?** The map shows 21 entrances in 4 chips/groups (`mnemion-1440.png`).
- MCP read/write tools (blue).
- OAuth authorization, first passkey, passkey login, invite approval (orange). These are pre-auth.
- browser session revocation, shared entry read, output read, publication read, and 9 more (green). These are public "served" reads.
- document upload and marketplace (yellow-brown).

I was *told* which entrances are untrusted only by reading entrance descriptions in the route inspector and by inferring from the trust-level names (`served-untrusted`). The map never labels an entrance with its trust level. Confidence that I have the full untrusted set: medium. "+9 more" hides nine entrances and I never saw their names.

**One untrusted input traced (4 selections).** Document upload (`mn-route-shared-routing--document-upload.png`) goes Routing → IO. The inspector says "an upload token carries a document's bytes into the object store". The Routing → IO interface carries **no identifier**. The Routing boundary selection (`mn-boundary-shared-routing.png`) lists only two crossings inside Routing: served-read gating and served-content inertness. Both are "requirement, checked", meaning not enforced. So upload bytes reach storage with no chokepoint drawn on the path. I can't tell from the map whether that is a missing requirement or just a crossing kept inside a component. Confidence: medium-low. The map shows absence of a mark, and absence is ambiguous.

The privileged path: X13 on Hive → Auth (`mn-interface-entities-hive--shared-auth.png`) is "register-token revalidation", crossing `served-untrusted → owner-trusted`. That is the one privilege-raising crossing, and it is a requirement, not enforced. X13 is drawn on the MCP route, though, not on the OAuth/invite route that actually consumes register tokens (`mn-route-shared-routing--oauth-authorization.png` shows Routing → Auth with no identifier). A reviewer following the invite flow never meets X13.

**Trust boundaries drawn.** There are three interface identifiers: C12 (Session↔Hive, a plain chokepoint), X13 (Hive→Auth) and X9 (IO→Hive, SSRF block-host). There are also three "crossings inside a component" boxes: Hive 9, Routing 2, Features 3. Most of the security content is **inside Hive**: 9 crossings including kernel write boundary, sql-identifier quoting, born-hashed secrets and credential-mint gating (`mn-boundary-entities-hive.png`). On the map these nine crossings collapse into one small chip.

**Working control vs unenforced.** You can't tell them apart on the map, but the banner says so. Every identifier is dashed-outline ("requirement"). The inspector's "requirement, checked 2026-09-17" reads like a pass. "Checked" next to "not enforced" is the most misleading phrase on the page.

**What is broken, and where?** Two requirements with a broken chokepoint, both in Hive (`mn-broken-entities-hive.png`, `mn-health-bypassed.png`):
- *kernel write boundary*: 5 bypass sites (policy.ts:235/240/245/366, schema.ts:1270).
- *facet/kernel-column collision*: 2 sites (kernel-columns.ts:29/32).

It took 2 selections to find, and I'm highly confident in it. The file:line list is exactly what a reviewer wants.

### Coherence

**Where does untrusted input enter?** There are 20 entrances. The inspector for X15 (`co-chokepoint-src-lifecycle--the-hook-answers-one-project.png`) defines `harness` ("what a host sends the hook on stdin… never a writer of the record") and `project-source` ("agent-authored text… never trusted about itself"). So the hook events and every CLI verb that reads project files are untrusted-input entrances. The map itself marks none of this.

**Trace (3 selections).** Hook events → X14/X15 on the entrance line → Lifecycle → Economy (`co-route-src-lifecycle--sessionstart.png`). X15 is "the hook answers one project", a cwd outside root is refused, and it is verified. That is a clear, well-explained control. But the Lifecycle → Economy leg (the read traces being written) carries no identifier. The "scope page" entrance (`co-route-src-readings-scope--scope-page.png`) builds this very HTML "over this project or another root". That is foreign project text rendered into a page, and no crossing is drawn on its route. Whether output escaping is an invariant is invisible here. Confidence: medium.

**Boundaries.** There are about 17 identifiers on the canvas, and Lifecycle holds 18 crossings inside it. Those are grouped by trust pair: project-source→reading 8, harness→reading 4, record→reading 5, and so on (`co-boundary-src-lifecycle.png`). All are verified. The trust levels `reading` and `record` are never defined in that list.

**Broken.** None. Confidence is high, from the health chips.

---

## 3. Visual hierarchy and encoding

- **Red does at least four jobs.** It marks broken/bypass ("✕ 2 broken", which matches the legend). It is also an entrance-group colour (Coherence hooks, `coherence-1440.png`) and a structural-route colour (the hook route, `co-route-src-lifecycle--sessionstart.png`). It colours the "Nothing is enforced yet" banner, which is a warning, not a breakage. And it tints a whole component's crossing chip (Hive "9 crossings", `mnemion-1440.png`), where it's unclear whether that means "broken inside" or just "has crossings". Mnemion's OAuth chip is red-orange too. This is the biggest legibility problem.
- **State of an identifier is too subtle.** Solid vs dashed outline on a 30-px tag at about 60% contrast. In Mnemion every tag is dashed and in Coherence every tag is solid, so the two maps never show both states side by side. I can't tell whether a mixed map would scan. Size and contrast are too low for the most important bit on the map.
- **Trust-boundary ticks are nearly invisible.** The legend's "+" tick mark shows as faint red dots above and below X14/X15/X13/X9 (`mn-interface-entities-hive--shared-auth.png`). I only found them after reading the legend.
- **Noise.** "N crossings" chips on every component, "17 sites", "71 sites", "22 symbols" and "Core: core dependency, called by 7 of 7" all compete with state. Those counts don't help a reviewer. For a reviewer the count that matters is *unenforced security crossings*.
- **Duplicate identifiers.** X21 appears 4 times, and X14 and X15 appear twice each (`coherence-1440-full.png`). The X15 inspector explains why ("1 interface, and where work enters by 1 route"), but on the canvas it reads like four different controls.
- **Dimming.** Unselected components drop to about 25% contrast. In light mode (`mnemion-1440-light.png`) Routing, IO and Features are almost gone, and the untrusted entrances' lines vanish.
- **Narrow width** (`mnemion-500.png`, `coherence-500.png`). The map scrolls inside its frame and shows only the first column. **Hive and its "✕ 2 broken" mark are off-screen.** The only broken thing on the map is invisible unless you scroll sideways. The health chips do wrap and stay visible, which is good.
- **Health chips.** "0 structural defects" (red outline) sits beside "2 requirements with a broken chokepoint" (red fill). A reviewer asks "so is it broken or not?" and the answer (a requirement can't be a defect, since it was never enforced) sits in inspector prose.

## 4. Legend and terms I could not decode where first met

- "bullets" in the header ("36 bullets") is not explained anywhere on the view.
- "C12" vs "X13": the legend says "C: a chokepoint; X: one whose invariant carries a crossing". Understandable, but the legend sits below the fold at 1440×1000.
- "crossing" and "trust level" are underlined links, but the *list of trust levels* (served-untrusted, owner-trusted, agent-mcp, storage, public-egress, federated / harness, project-source, reading, record) is never shown as a key. You meet a level's meaning only inside one chokepoint's inspector (X9 and X15 do this well). Group lists like "record → reading" never define their levels.
- "Derived route", "reference weight" and "load-bearing interface" are architecture vocabulary with no security meaning. They're fine but crowd the legend.
- "checked" vs "verified" vs "enforced" vs "bypassed" are four verdict words, and "checked" wrongly suggests a pass.
- "Core dependency (rail)": the bottom rails with "10 crossings" / "7 crossings" (Coherence Adapters/Journal) are nearly invisible, yet they hold 17 crossings.

## 5. The inspector

- **Chokepoint inspector** (X9, X15). This is the best thing on the page and should be kept. The order is title → one-line invariant → Verdict → Component → Chokepoint symbol → Protects → Crossing A → B → each trust level defined → interfaces → routes through it. That is the right order for a reviewer.
- **Interface inspector** (`mn-interface-entities-hive--shared-auth.png`). The order is wrong for security. The crossing (`served-untrusted → owner-trusted`) sits below the chokepoint prose, and then 15 symbol rows with file/site counts push past the fold. Put the crossing and verdict first and collapse the symbols.
- **Component-boundary inspector** (`mn-boundary-entities-hive.png`). Grouping by trust pair is excellent. It needs the level meanings, or at least a hover, and a verdict sort so bypassed items come first (it happens to already put "kernel write boundary" first).
- **Route inspector.** It is the default, so it's the first thing a reviewer reads, but it never mentions trust or controls. It needs one line such as "crosses 1 trust boundary (X13, not enforced)" or "crosses none".
- **Broken inspector.** Good: file:line bypass sites. "What an agent does next" is collapsed, which is correct for this audience.

## 6. Ranked changes

1. **Take red away from everything that isn't broken.** That means entrance-group colours, route colours and the enforcement banner (`coherence-1440.png`, `co-route-src-lifecycle--sessionstart.png`, `mnemion-1440.png`). Reserve red for bypass/defect. Use amber for "nothing enforced". Keep the entrance palette to hues that are distinct from red and from the selection yellow/orange.
2. **Put a trust level on every entrance chip** (a small tag such as `served-untrusted`, `harness`, `agent-mcp`), and add a trust-level key beside the legend. Right now the most basic security question, "which inputs are untrusted?", needs inspector reading (`mnemion-1440.png`).
3. **Make enforcement state loud on identifiers.** Filled and bright for verified. Hatched amber (or similar) for requirement. Red for bypassed. They should be at least as prominent as the component title. Rename the verdict text "requirement, checked" to "requirement, not enforced (checked 2026-09-17)" (`mn-chokepoint-entities-hive--ssrf-block-host-coverage.png`).
4. **Show absence on untrusted routes.** When a route from an untrusted entrance reaches a component with no identifier on it, draw a "no crossing declared" mark on that edge. Examples are document upload → IO (`mn-route-shared-routing--document-upload.png`), the OAuth route → Auth (`mn-route-shared-routing--oauth-authorization.png`) and scope page → Scope (`co-route-src-readings-scope--scope-page.png`). This is the single most useful gap-finder for a reviewer.
5. **Default selection by risk, not by route.** Open on the broken/health summary when anything is broken (Mnemion), or on the entrance with the most untrusted crossings (Coherence hooks), rather than MCP tools or `query`.
6. **Break out "crossings inside a component".** Hive's 9 crossings hold most of Mnemion's security. Show them as a stacked badge with state counts ("9 crossings: 1 bypassed, 8 not enforced") instead of one "9 crossings" chip (`mn-boundary-entities-hive.png`).
7. **Narrow width.** Pin the broken mark or a "1 component broken → Hive" jump link above the map, because the map crops Hive off-screen (`mnemion-500.png`).
8. **Deduplicate identifiers visually.** Link repeated X21/X14/X15 with a shared hover highlight, or draw the entrance-line copy as a ghost (`coherence-1440-full.png`).
9. **Reorder the interface inspector.** Put the crossing and verdict at the top and collapse the symbols list (`mn-interface-entities-hive--shared-auth.png`).
10. **Raise contrast.** Lift the trust-boundary ticks and the dimmed components, especially in light mode (`mnemion-1440-light.png`).

**Keep:**
- The Mnemion "Nothing is enforced yet" banner, which is honest and immediate; recolour it but keep it.
- The health chips as clickable entries.
- The chokepoint inspector's trust-level definitions.
- The broken inspector's file:line bypass lists.
- Grouping component crossings by trust pair.
- Deep-linkable selections.
- "Observed runtime behavior is not shown", an important scoping statement for a reviewer.
