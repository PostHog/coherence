# Owner review of two Structure maps (blind)

Seat: I own the project, agents write the code, and I have ten minutes per map. Every judgment below comes from screenshots in `shots-owner/`. Default views are at 1440, 820 and 500 px wide. I opened selections by deep link, which is the same as clicking once.

---

## Mnemion-js

### 1. Ten-second test (`mnemion-1440.png`)
What I took away:
1. There are about 8 boxes, and one orange line runs Root, Session, Hive, Features, Routing, IO.
2. A red "✕ 2 broken chokepoints, 7 bypasses" sits next to Hive. Something is wrong, roughly there.
3. "Core" is a grey bar along the bottom that everything calls.

Were these the right three? Partly. Item 2 is the most important fact on the page and it is visible, which is good. But it is small red text wedged between Features and Hive. It is not selectable, and it does not say which component it belongs to. I guessed Hive only because it sits nearest. The more important fact is that the system has **0 invariants and 36 requirements**. That lives in small grey serif text in the page header and never appears on the map. Put plainly, nothing is enforced. The map neither says that nor draws it. Instead the page shows C12 and X9/X13 tags that look like working controls. Item 3 (Core) is correct, but the map shows it as the least important thing, dim and at the foot. In fact it is called by 7 of 7 components and has no enforcement at all (`m-core.png`).

### 2. Questions
- **Healthy right now?** No. It took 2 selections plus some guessing, and my confidence is medium. The red label gives the headline. To learn *what* is broken I had to guess that Hive was the owner and select it. Its inspector then lists, at the very bottom and after about 15 rows of route and call lists, "Broken chokepoints: kernel write boundary, requirement, 5 bypasses inside entities/Hive; facet/kernel-column collision, requirement, 2 bypasses" (`m-hive.png`). Selecting C12 shows "not run 2026-09-17 / not chokeable" next to "verified 2026-09-17" and "kept from an earlier run", plus "Refutation: missing" (`m-cp-session.png`). I cannot turn that mix of badges into a single healthy/unhealthy verdict. The "0 invariants" fact is off-map entirely.
- **Load-bearing parts?** Medium confidence, 1 to 3 selections. Hive clearly carries the most: 3 routes, 3 load-bearing interfaces, and it is called by 7 components (`m-hive.png`). Core is called by 7 of 7. Session and Routing are joined by C12. The inspector heading "Load-bearing here" is useful. But the map never *draws* load-bearing weight: every box is the same size and style.
- **"I changed Session": what else is affected?** 1 selection, medium confidence (`m-session.png`). The inspector says Session is called by root, Hive and Routing, calls Hive and Core, and has 2 load-bearing interfaces (Hive→Session and Routing→Session, both chokepoint TOOLS). The map highlights Hive and Routing. So I get the direct neighbours and the invariant at risk (tools SSOT totality). I do not get transitive impact. For example, whether anything downstream of Routing cares is not shown. Also, "Called by ← ." is a bare dot, which I only realised later means the root.
- **Not covered by any enforcement?** Low confidence, about 4 selections, and only by elimination. Core ("Load-bearing here (0): No chokepoint or crossing stands on its component interfaces", `m-core.png`) is uncovered, and so are Features, IO and Routing's own interfaces as far as I can tell. No view answers "what is unenforced". Given 0 invariants, the honest answer is "everything", and the map implies otherwise.

### 3. Storytelling
Best route: **via Hive (derived)**, seen within `m-hive.png`. In briefing form: "Every agent request lands on Hive, the single per-user Durable Object that owns all the SQLite data and funnels every agent write through one kernel-enforced chokepoint. From Hive, work flows out to Features, then to Routing and IO for outbound calls. Auth tokens and federation fetches cross trust boundaries at X13 and X9." Most of that story came from the component *descriptions* in the inspector, not from the route.

Routes that tell no useful story: all four are "derived", named "via X", and have no real entrance. "via Session" and "via Hive" end in the same Features→Routing→IO tail. Nothing tells me how an agent's MCP call actually enters the system, which is the whole purpose of the service. "via Routing" is dimmed and says nothing.

### 4. Interpretability
Jargon, and whether it is explained where I meet it:
- chokepoint: not on the map. The legend under the map defines it only by its C code.
- bypass: not explained anywhere I saw.
- broken chokepoint: not explained, and not clickable.
- crossing / trust level: the legend mentions them. The trust-level names ("served-untrusted → owner-trusted", "owner-trusted → federated") appear raw in the inspector.
- totality oracle: used in the inspector without a definition.
- refutation: the inspector says "missing no witnessed firing". Barely explained.
- "not chokeable" / "reference-choked": the inspector gives a long prose gloss.
- requirement vs invariant: shown as a badge. The difference that matters (not enforced vs enforced) is never stated.
- interface identifier, core dependency, structural route, derived: explained in the legend block below the map.
- "sites" and "symbols": the units are never explained. I also cannot tell why routes count one and calls count the other.
- "." as a component name: not explained.

Noise: many faint crossing lines, dead-end stubs down to the Core rail, and dashed yellow "selection reached" lines that look like errors. The inspector for a chokepoint dumps internal authoring advice ("write the symbol (`writeClass`), the symbol in its file (`KERNEL_WRITE_POLICY` in policy.ts)"). That is a note to an agent, not information for an owner.

Hunting: I had to find which component owns the broken marker. The broken list sits at the bottom of a long inspector. The legend is a dense 12-line paragraph in small grey text *below* the map, and I read it only after being confused.

Narrow widths: at 820 and 500 the inspector opens as a bottom sheet over the map by default, covering most of it (`mnemion-500.png`). At 500 the map is cropped on the right, and the broken label is cut to "✕ 2 broken chokepoints,".

### 5. Single change
Put a health strip on the map itself. It would say "0 of 36 requirements enforced · 2 broken chokepoints (kernel write boundary, facet/kernel-column collision) in Hive", with each item clickable. Each component box would show its own count (enforced / requirement / broken), coloured red when broken. Unenforced components should look unenforced.

---

## Coherence

### 1. Ten-second test (`coherence-1440.png`)
What I took away:
1. There are many entrances, colour-coded on the left: CLI verbs, hook events, a scope page.
2. The system core is Scope → Enforcement → Observation → Economy, which the default green route runs through.
3. Journal, Spec and Adapters are shared foundations (the rails at the bottom).

Were these the right three? Mostly, for "what is it made of". But nothing tells me whether it is **healthy**. There is no red mark, and nothing on the map says "all green". I can only infer health from absence. Health data does exist ("97 invariants, 1 requirement" in the small header, and "verified" badges in inspectors), but the map does not carry it. The default route label "query, glossary, hooks install" is also an odd first story. I doubt `glossary` really flows through Enforcement → Observation → Economy. It looks like an artifact of "follow the heaviest interface", and the inspector admits that is the rule.

### 2. Questions
- **Healthy right now?** Probably, from the absence of any broken marker. 0 selections, low confidence. Selecting X10 shows "verified 2026-09-22" together with "kept from an earlier run (2026-09-22 17:59)" (`c-cp-warm.png`), so I cannot tell whether the result is fresh. The 1 open requirement is not locatable from the map.
- **Load-bearing parts?** 1 to 2 selections, fairly confident. Enforcement: 5 routes pass through it, it has 4 load-bearing interfaces, and it is called by 7 components (`c-enf.png`). Journal (8 of 9), Spec (7 of 9) and Adapters (5 of 9) are the core rails.
- **"I changed Enforcement": what else is affected?** 1 selection, medium confidence (`c-enf.png`). It is called by root, economy, journal, lifecycle, observation, scope and spec. 5 routes run through it. The 4 load-bearing interfaces name their chokepoints (store.ts, loadSpecModel, withWarmAdapter, performRun, withWarmAdapter). The map lights all of them. It does **not** list the invariants that live *inside* Enforcement (automatic refutation, run appended never rewritten, one invocation for every test, warm server), which I know exist only from the DOM ids. Those are exactly what an Enforcement change would break. The inspector also does not say whether they pass. The list stops at direct callers.
- **Not covered by any enforcement?** Not answerable from the map. The Scaffold inspector says "Load-bearing here (0)" (`c-scaffold.png`), but that only covers interfaces, not whether Scaffold's own behaviour is enforced. There is no uncovered-code view. Low confidence.

### 3. Storytelling
Best route: **SessionStart … SubagentStop** (`c-route-life.png`). In briefing form: "When an agent host fires a lifecycle event (session start, tool use, stop), Lifecycle takes it and crosses four trust boundaries (X7–X10) into Enforcement, which checks the edit against the project's invariants. Enforcement records what happened through Observation. Economy then works out what the session had to read, so at Stop the tool can say what the session still owes." The per-entrance one-liners in the inspector are what make this readable.

Route with no useful story: **journal verbs, work**, which is "Coherence (root) → Journal (rail)" and nothing else (`c-route-journal.png`). **run/refute/serve**, **economy/calibrate/mass** and **query/glossary/hooks install** all collapse onto the same Enforcement → Observation → Economy tail, so those three routes look nearly identical and blur together (`c-enf.png`).

### 4. Interpretability
Jargon, and whether it is explained where I meet it:
- X7…X21: the legend says "X one whose invariant carries a crossing". Opaque until selected.
- crossing, and the trust-level names harness / instrument / project-source / record / reading: explained only inside the selected X inspector (`c-cp-warm.png`).
- reference-choked, totality oracle, refutation: long prose in the inspector, and no plain verdict.
- "kept from an earlier run": not explained. Is it stale or fine?
- chokepoint: never defined on the page.
- "sites" and "symbols": not explained.
- orient / regulate / peer feed: these appear in the entrance descriptions without definitions.
- ".": an unexplained name for root.

Noise: a pale spaghetti of route lines around Economy and Observation, and stacked unlabeled stubs on the right edge. X-tag clusters (X14 X15 X16, X7 X8 X9 X10) are unreadable at rest. The core rails at the foot also take a lot of vertical space.

Hunting: a deep link scrolls the page so the header vanishes (`c-enf.png`). The inspector for a chokepoint runs past 2000 px with test command lines in it. The legend paragraph sits below the map.

Narrow widths: at 820 the default-open inspector covers the lower half of the map, including Scope, Observation and the rails (`coherence-820.png`). At 500 the map shows only entrances and root before the sheet covers it (`coherence-500.png`). At phone width, the map is unusable without first closing the inspector.

### 5. Single change
Same as Mnemion. Also, each component's inspector should lead with "Invariants here: N, all verified at <run> / K failing / M requirements". It should list the invariants that live *inside* the component, above routes and calls. That is the question I ask after "I changed X".

---

## Ranked issues

| # | Issue | Where | Severity | Evidence |
|---|---|---|---|---|
| 1 | Health is not on the map. Mnemion's "0 invariants, 36 requirements" (nothing enforced) appears only in grey header text, while the map shows C and X tags that suggest working controls. Coherence has no positive health signal at all. | Both, map and header | blocks understanding | mnemion-1440.png, coherence-1440.png |
| 2 | The "✕ 2 broken chokepoints, 7 bypasses" marker is not selectable and does not name its component. The actual list sits at the bottom of Hive's long inspector. | Mnemion map | blocks understanding | mnemion-1440.png, m-hive.png |
| 3 | No view of what is unenforced. "Load-bearing here (0)" covers interfaces only. Core (called by 7 of 7, zero enforcement) looks like a quiet background rail. | Both | blocks understanding | m-core.png, c-scaffold.png |
| 4 | The component inspector does not list the invariants that live inside the component or their pass/fail. Impact of a change stops at direct callers. | Both, component inspector | blocks understanding | c-enf.png, m-session.png |
| 5 | Derived routes tell misleading or duplicate stories. Mnemion has no real entrances (all "via X, derived"). Coherence's routes collapse onto the same Enforcement→Observation→Economy tail, and "journal verbs, work" ends immediately. The default route "query, glossary, hooks install" is an implausible path. | Both, routes | slows | coherence-1440.png, c-route-journal.png, mnemion-1440.png |
| 6 | Mixed freshness badges ("verified", "not run", "kept from an earlier run") on one invariant, with no single verdict. | Chokepoint inspector | slows | m-cp-session.png, c-cp-warm.png |
| 7 | Jargon (chokepoint, bypass, crossing, totality oracle, refutation, reference-choked, sites vs symbols, ".") is used before or without definition. The legend is a dense paragraph below the map. | Both | slows | all screenshots |
| 8 | The inspector for a chokepoint contains agent-facing authoring advice and raw test command lines, and runs longer than 2000 px. | Chokepoint inspector | slows | m-cp-session.png, c-cp-warm.png |
| 9 | At 820 and 500 px the inspector opens by default as a bottom sheet covering most of the map. At 500 the map is cropped and labels are truncated. | Both, narrow widths | slows | coherence-820.png, coherence-500.png, mnemion-500.png |
| 10 | Unexplained colour cues: Hive's red border and the dashed yellow "reached" lines read like errors. | Both | cosmetic | m-session.png, c-scaffold.png |
| 11 | A deep link scrolls the header off-screen, so project context is lost. | Coherence | cosmetic | c-enf.png |
| 12 | Crowded X-tag clusters (X7–X10, X14–X16) and many faint route lines around the right columns. | Coherence | cosmetic | coherence-1440.png |
