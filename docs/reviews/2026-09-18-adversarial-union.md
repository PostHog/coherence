# Adversarial review, 2026-09-18: the union of two blind readings

Two reviewers on the same brief, each in its own worktree, neither able to see the other. Reviewer A wrote 36 findings (35 reproduced), reviewer B 37 (35 reproduced). Both left the tree as they found it. Their full reports are review-8a53ce8b.md (A) and review-7b3e1a94.md (B) in the session scratchpad; this file is the union, ranked, with the overlap marked. A finding both reproduced independently is marked BOTH.

## Critical

1. BOTH. The check can answer from pre-edit text. The TypeScript adapter's forget() does not re-send the text of an already-open document, so under load the references query answers from stale content: A measured 160 wrong verdicts in 320 checks; B saw a pass recorded while a bypass was on disk. This is the true mechanism behind journal defect df-033337e0, whose recorded diagnosis (cross-file server contention) is wrong; the defect is in production code and is live in revelation at the edit. (A-F1, B-F3; src/adapters/typescript.ts:300)
2. B. isImportSite treats every site below a semicolon-less bare import as an import, so a real bypass beneath `import "./polyfill"` is never counted and the chokepoint grades clean. One semicolon flips the same tree to broken. (B-F1; src/adapters/typescript.ts:161)
3. BOTH in substance. The automatic refutation proves the instrument reports the synthetic site, not that the classifier would call it a bypass; A also found refuteInside mis-classifying a synthetic site inside the chokepoint module as outside. With the protected thing under a test folder a bullet with a real bypass reports as a verified invariant whose detector cannot go red. (B-F2, B-G2, A-F7; src/adapters/typescript.ts:486,523)

## High

4. BOTH. For the totality-oracle form a refutation is any parseable prose line; nothing links it to a red result. 32 of the 52 bullets reported as invariants rest on that line alone; the headline overstates the tree. A chokepoint written entirely in prose with a self-asserted refuted line reads as a full invariant with 0 problems from spec --check, the only gate npm test runs. This is the defect class docs/glossary.md says the rebuild exists to catch. (A-F4, A-G3, A-G7, A-S6; B-G1, B-S10; src/spec/state.ts:46-51)
5. A. performRun runs the whole test suite before its first adapter question and the warm server's idle timer resets only on request lines; a suite longer than the idle timeout kills the instrument mid-run, every chokepoint records not run, and run exits 0. (A-F2; src/enforcement/run.ts:100)
6. BOTH. Warm server lifecycle: serve() unlinks an existing socket without probing for a live listener and stop() unlinks unconditionally, so two servers coexist and an orphan's shutdown removes the live socket; connectAdapter has no spawn lock; the socket is unauthenticated, mode 0755, with a predictable fallback name in the temp directory; no client timeout. (A-F6, A-F12; B-F4, B-F12; src/enforcement/server.ts)
7. BOTH. The work store is read raw by Scope and the agent query, so every record (create, move, owner, close) becomes an order; query order can answer a closed order as active and can never return a real one. (A-F3; B-F6, B-G6; src/readings/query/query.ts:223, src/readings/scope/build.ts:195)
8. A. Quadratic backtracking in the refuted: regex: 156 KB of value takes 16 s, and loadSpecModel runs on every hook event. (A-F5; src/spec/grammar.ts:392)
9. BOTH. feed.commit() advances the cursor before the hook's stdout is written; a failed write loses the peer records the cursor skipped. (A-F17, B-F5; src/lifecycle/hook.ts:334)
10. A. regulate refuses a subagent stop on an UNKNOWN NOUN, a heuristic nomination the glossary does not list among what may be refused. (A-S1; src/lifecycle/hook.ts:351)
11. B. hooks install's ownership regex claims any command ending in "cli.ts hook <Event>" and silently deletes an unrelated project's hook. (B-F9, B-S1; src/lifecycle/install.ts:44)
12. A. The agent query's fixed set omits the economy prediction the glossary names. (A-G2)
13. A. Work-order state "waiting" is a noun the glossary neither declares nor maps, invented to pass the check. (A-G1)
14. BOTH. Injection-within-budget is false when escalations are present (15,410 of 9,500 characters); renderCompactWithin returns unchecked text when there is no project layer. (A-S5; B-F7, B-S3)

## Medium

15. BOTH. The chokepoint check tests "every non-test reference the server reports, minus import sites by heuristic, is inside the chokepoint", not the glossary's "every reference passes through"; any path named *.test.* or under a test folder is exempt, so renaming a file silences a bypass. (A-G6, A-F15; B-G11)
16. BOTH. belongsTo maps runner report entries to a via value by substring, so a bullet's verdict can come from a different test whose title contains its name. (A-F14, B-F15; src/enforcement/totality.ts:175)
17. BOTH. The module form of a spec name accepts "..", so agent-authored spec text makes the tool read a file above the project root; scaffold component and collectFiles likewise do not confine paths; the hook takes its root from harness stdin with no containment. (A-F9, A-F10, A-F13, A-F16; B-F8, B-F13)
18. BOTH. Scope stores derived state (about 105 KB, a fifth of its state) beside the run records it derives from, and re-declares six derivations that exist in journal and enforcement, against the data-is-destiny rule its own spec cites. (A-G5; B-G12)
19. BOTH. Reliance is computed from a run entry's whole file list, which includes the defining file, the chokepoint file, imports and tests. (A-G8, B-G10)
20. BOTH. Three enforcement bullets with unfilled refuted placeholders report as invariants because a chokepoint's automatic refutation satisfies the whole bullet; refutation is required per enforcement in the glossary but satisfied per bullet in the code. (A-S4, A-G3; B-S7)
21. B. A failing run labels a bullet a structural defect whether or not it was ever an invariant; the glossary defines a structural defect as an invariant whose satisfaction has been removed, so a requirement cannot become one. (B-G3, B-S9; src/spec/state.ts:61)
22. B. The vocabulary check reads only .md and .ts, never journal records, and applies none of Coherence's rejected names to an adopter's code: 131 unreported identifier hits in Mnemion, and "taxonomy" and "consequences" in this repo's tracked .gitignore, while the check reports 0. (B-G7, B-S5; src/lifecycle/check.ts:517)
23. B. Anti-rot: the injected vocabulary names AGENTS.md; provenance names authority-evidence.md; a source field names concept files. (B-G5; docs/glossary.json)
24. B. The subagent gate holds "until the debt is paid or recorded as unable" per the glossary; no unable record clears anything. (B-G4)
25. A. The Stop snapshot passes an adapter only in tests, so every production read-trace snapshot records a hop-less closure. (A-F11)
26. A. PLACEHOLDER matches any <lowercase...> text, so a value mentioning a generic type such as Map<string, Latest> is treated as absent. (A-F8)
27. A. Unreached mass counts only chokepoint reach; the glossary says no invariant's chokepoint or oracle references it. (A-G4)
28. B. Scope's byte-determinism claim is falsified by appending one journal record; the spec's sentence names a pair of glossaries as the only input. (B-S4)
29. B. A refuted line's date matches three digit groups, so 2026-13-45 parses. (B-F11)
30. B. The peer feed injects the subject of every record kind; the glossary says decision subjects. (B-G9)
31. B. "Whole workspace indexed" borrows the Python classification test as its oracle; nothing tests waiting for enumeration. (B-S6)
32. A. "Warm server the only path" protects connectAdapter, not adapterFor; run --no-server and Scope's ladderFor construct adapters outside it. (A-S2, A-F18)
33. A. "Append-only store" protects journalDir, a path helper; nothing structural prevents a rewrite. (A-S3)
34. A. "Name forms" says prose is refused before any instrument is asked, but the refusal lives only in run. (A-S6)

## Low

35. B. run --status exits 0 while printing structural defects. (B-F10)
36. B. changedFiles swallows every git failure, including a maxBuffer overflow, and reports a clean tree. (B-F14, plausible)
37. A. The corpus walk has no error handling; EACCES aborts the whole check. (A-F16)
38. A. Nothing requires or checks the reason a not-chokeable claim must give. (A-G9)
39. A. docs/economy.md says economy drives the adapter in process; economyFor does otherwise. (A-G10)
40. BOTH. The entry spec's first invariant is an unenforced requirement whose refutation was never red, correctly labelled. (A-S7, B-S8)
41. B. One via string is the totality oracle of two different bullets, against enforcement cardinality. (B-G8)
42. A. "One invocation for every test" holds but results map back by substring. (A-S8)

## What both tried and could not break

Append-only under concurrent multi-megabyte writers; hook stdin fuzzing; hostile spec text; session-token containment; namespace-import bypasses; injection carries vocabulary only; page escaping; Scope determinism for identical inputs; the status view's derivation; warm-server kill and idle recovery; the prose, missing and ambiguous chokepoint refusals.

## Reading

The two criticals and the first high are one story: the chokepoint check, which is the spine's whole claim, can be wrong in three independent ways (stale text, an import heuristic, a refutation that proves the wrong thing), and the refutation discipline that should have caught the third was itself satisfied by prose for the oracle form. Every other finding is real but none of them lie about the spine. The fix order follows that: items 1 to 4 first, then 5 to 7, then the containment set in 17, then the rest by severity.
