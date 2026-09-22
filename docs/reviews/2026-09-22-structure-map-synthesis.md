# Structure map: three blind readers, synthesized (2026-09-22)

Three reviewers read frozen copies of the Mnemion and Coherence Structure maps and nothing else: a newcomer engineer, a security reviewer, and the owner keeping oriented while agents change the code. Full reports are in structure-2026-09-22/. "All three" means each found it without seeing the others.

## What works (all three)
Selecting one route with the inspector beside it; named origins as colored tokens; one inspector for everything; no overlapping text.

## What fails, ranked

1. Health and breakage have no place on the map (all three). Mnemion has 0 invariants and 36 requirements, visible only in grey header text, while its interface identifiers look like working controls. Coherence's map carries no health signal at all. Mnemion's "2 broken chokepoints, 7 bypasses" is a floating caption that is not clickable and does not name its component; the map says bypass sites "cannot be shown".
2. Identifiers carry no state (security, owner). An unenforced, never-run, unrefuted requirement looks exactly like a verified, refuted invariant. Weak and strong controls are indistinguishable without opening each one.
3. Routes are not flows (all three). They are a walk along the heaviest references, labeled "the path work takes". Coherence: 5 of 8 routes share one Enforcement, Observation, Economy tail; "scope page" ends in Economy; the default route "query, glossary, hooks install" is implausible. Mnemion's "via" routes read as request paths but are not.
4. Mnemion has no declared entrances (all three), so "where does work enter" cannot be answered and no path from MCP or HTTP input to storage can be traced.
5. Most trust boundaries are not drawn (security). A crossing whose chokepoint is not on a component interface is listed as standing on none; on Mnemion about 2 of 20 appear. Selecting agent-mcp or storage lights nothing, though agent-mcp to storage is the product's central boundary. In Coherence the harness crossings sit on the root to Lifecycle line, not on the host-hook entrances' line, so untrusted host input never visibly crosses a boundary.
6. Components do not say what they do or what they hold (newcomer, owner). Hive owns all data and every write passes through it but looks like any folder; a component's inspector lists callers but not its own invariants and their verdicts, so "I changed Session" cannot be answered.
7. Inspectors are too long and mix audiences (owner, newcomer): past 2000 px for a chokepoint, with test commands and agent advice; one invariant can show verified, not run, and kept from an earlier run at once with no single verdict.
8. Jargon undefined where first met (owner): chokepoint, bypass, crossing, derived, core dependency.
9. Default selection contradicts the legend (newcomer): "opens on the busiest route" but Mnemion opens on "via Session" (3 sites) not "via Routing" (157).
10. Identifier placement (newcomer): X14 to X16 beside their line, X7 to X10 packed, X10 twice, C versus X under-explained, numbering gaps.
11. Narrow widths (owner): at 820 and 500 px the inspector opens by default over most of the map.

## Found in passing, not by the readers
Coherence's "1 broken" is false: the edit hook and the language server count agent worktree copies under .claude/worktrees as project code, so their references read as bypasses (conjecture c-16d2f394, now confirmed). It reached the map the readers judged.

## Proposed next pass, in order
1. Exclude .claude/worktrees (and any ignored path) from reference resolution and the edit hook. Correctness first.
2. Health on the map: a strip of clickable counts (enforced, requirement only, broken) and a state on every identifier and component (verified, requirement, broken), drawn, not in grey text; broken marks attached to the component and clickable to their bypass sites.
3. Trust boundaries drawn wherever a crossing exists: place a crossing on the interface its protected thing and chokepoint imply, or on the component when both sides are inside it, and make selecting a trust level always light something.
4. Routes from declared entrances only, with Mnemion declaring its entrances (MCP tools, HTTP routes, websocket); derived routes shown only when nothing is declared and labeled as reference weight, not flow; fix the default-route rule.
5. Component cards say their role (the spec intent, one line) and the inspector leads with the component's own invariants and verdicts.
6. Inspector: one verdict per invariant, agent-facing detail collapsed; jargon linked to the glossary where first shown.
