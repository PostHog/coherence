# Enforcement

Enforcement by detection: the chokepoint check with its grade ladder and automatic refutation, the totality oracle pass, the run as the primary record, and the warm server.

## invariants
- run appended never rewritten: A run is appended as one line and never rewritten; the latest verdict per enforcement is a view derived from every run, and a skipped enforcement keeps its prior dated verdict.
  protects: appendRun
  chokepoint: performRun
  over: every run file under .coherence/runs and every enforcement in the spec
  via: a run appends one record, never rewrites; spec --check reads the run; the status view derives the latest verdict and keeps a skipped one dated
  because: the run is the primary record of a verification pass; a stored latest verdict would be a second truth that could disagree with the runs it summarizes, so the view is derived when asked, and an enforcement the latest run skipped shows its prior verdict with its date rather than a fresh-looking one; the one function that performs a pass is the only one that appends
  crossing: instrument -> record
  refuted: replaced the append in appendRun with a whole-file write -> "a run appends one record, never rewrites; spec --check reads the run; the status view derives the latest verdict and keeps a skipped one dated" went red in enforcement.test.ts; restored, green (2026-09-17)
  kinds: storage, revision
  checklist: scoped-reads dismissed: every reader sees every run; there is no scope
  checklist: encrypted-storage dismissed: a run is plain text a human reads
  checklist: key-rotation-compatibility dismissed: no key exists
  checklist: input-validation declared as session names the run file
  checklist: revision-preservation declared as run appended never rewritten
  checklist: commit-ordered-effects dismissed: the run's only effect is the file
  checklist: durable-dispatch-intent dismissed: nothing is dispatched after the append
  checklist: declared-target-coverage dismissed: one folder, one file per session
  checklist: completion-evidence dismissed: the append is complete when the call returns
- session names the run file: A run is refused when its session cannot name a file.
  over: every session a run is written under
  via: appendRun refuses a session that cannot name a file
  because: the session names the file, so a session with a path separator or a leading dot would write outside the runs folder or hide the file; the token rule is the journal's
  crossing: harness -> record
  refuted: disabled the session token check in appendRun -> "appendRun refuses a session that cannot name a file" went red in enforcement.test.ts; restored, green (2026-09-17)
  kinds: identity
  checklist: capability-authorization dismissed: the session token names a file and grants nothing
  checklist: canonical-encoding declared as session names the run file
  checklist: identity-continuity dismissed: a session's id never changes
- sites classified: Every reference to the protected thing and chokepoint is persisted with its file, line, symbol, class, and target: protected references are inside, test, or bypass, while an external reference to the chokepoint is a chokepoint-reference, never overloaded as inside, bypass, or a semantic runtime call.
  over: every reference the language server reports for a protected thing and its chokepoint, every form an adapter reads at one, and every old or unavailable run record
  via: a plain import specifier in the chokepoint's own module is inside; the same import elsewhere, a re-export anywhere, a wildcard re-export, and a use outside the chokepoint's range are bypasses
  because: a chokepoint holds while every reference to the protected thing is inside it, so those classes must partition every protected site. The import at the top of the chokepoint's module is how the chokepoint reaches the thing, not a place the thing is used, so ruling d-7abd1ba8 makes that one location inside; an export-from specifier or a wildcard re-export widens the protected thing's reach with no call at all, so it is a bypass even there. A test may reference either target to check it and is reported rather than counted as a bypass. References to the public door answer a different question: who relies on it. The chokepoint-reference class and of: chokepoint target preserve that distinction without changing the grade or bypass count; test location and adapter-observed import or re-export form are separate fields, and a type use or unused import need not execute a call. Sites are written only after both reference queries complete; absence on an unavailable or legacy entry means incomplete evidence, not a confirmed empty set, and old append-only records remain readable
  crossing: instrument -> reading
  refuted: dropped the rule that a plain import specifier in the chokepoint's own module is inside, so classifySite read that site by range like any other -> the totality oracle went red, then green once restored (2026-09-18); stopped querying references to the chokepoint, so the real TypeScript fixture's runtime and import-only chokepoint references disappeared from the classified sites -> the focused enforcement test went red, then green once restored (2026-09-18)
  kinds: none
- both endpoint sites recorded honestly: A completed chokepoint run persists protected references and chokepoint references, and an import-only chokepoint reference is reliance evidence without being called a runtime call.
  over: every completed protected-thing and chokepoint reference query, every persisted site, and every import-only reference to a public chokepoint
  via: run sites persist protected references and chokepoint references without turning an unused import into a call
  because: the producer is the durable fact boundary for reliance. Omitting the chokepoint query hides legal reliance; calling every reference a caller invents execution the adapter did not observe. The explicit chokepoint-reference class, of target, test bit, and optional import or re-export form retain exactly the evidence available while protected-reference grades, bypasses, and counts remain unchanged
  crossing: instrument -> record
  refuted: stopped querying references to the chokepoint, removing runtime and import-only reliance sites from run records -> the named producer test failed through `refute` and was recorded under session 01a0b5b0-4fe2-7592-987a-5711fbcb3596; restored, then a bound run for w-1a54ec05 passed and witnessed it (2026-09-18)
  kinds: none
- grade ladder: A chokepoint grades broken with a bypass or a missing chokepoint, reference-choked when clean and visible, visibility-choked when clean and not visible, and not chokeable when the protected thing is prose.
  over: every combination of bypass count, chokepoint resolution, visibility, and name form
  via: grades: broken with a bypass, reference-choked when clean and exported, visibility-choked when not exported, broken when the chokepoint is missing, not chokeable for prose
  because: the grade is what a human reads to know how much the structure is doing; a broken chokepoint graded clean would hide a structural defect, and prose graded as a chokepoint is the defect the reference's checks carried for months
  crossing: instrument -> reading
  refuted: made every clean chokepoint grade reference-choked whatever its visibility -> "grades: broken with a bypass, reference-choked when clean and exported, visibility-choked when not exported, broken when the chokepoint is missing, not chokeable for prose" went red in enforcement.test.ts; restored, green (2026-09-17)
  kinds: none
- automatic refutation: A chokepoint verdict is never recorded without its refutation: the adapter stages every synthetic site the classification could swallow, the instrument must report each one, nothing touches disk, and an unseen site makes the check vacuous, never a pass.
  protects: checkChokepoint
  chokepoint: performRun
  over: every chokepoint-form enforcement the run checks
  via: the automatic refutation stages a re-export in an unsaved document; a thing the module does not export is refused by the compiler; nothing is written to disk
  because: a check that would report nothing if the chokepoint were broken is vacuous; staging a synthetic reference and confirming the instrument sees it proves the instrument would report a real bypass, doing it in an unsaved document leaves the tree untouched, and every chokepoint verdict reaches the record through the one function that always attempts it. Since ruling d-7abd1ba8 makes one import location inside, the staging must cover both sites that ruling could otherwise swallow: a use in the chokepoint's own module past its range, and a re-export
  crossing: instrument -> record
  refuted: made the refutation open an empty synthetic document, so the re-export it stages was never there for the instrument to report -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
- refutation proves this check would fire: Every synthetic site the adapter stages is classified by the same function every other site goes through, and the refutation fires only when the check calls each one a bypass; where the graded rung's enforcer is the language, the compiler's or interpreter's refusal of the synthetic outside reference is the refutation instead, recorded as refused by the language with its diagnostic.
  over: every chokepoint-form enforcement whose synthetic sites the instrument reported, and every rung whose enforcer is the language
  via: the automatic refutation is vacuous unless the check's own classification calls the synthetic site a bypass
  because: the adapter decided outsideness itself and got it wrong in two ways the reviewers reproduced: a synthetic sibling document beside a protected thing under a test folder is a test reference, so nothing could ever be a bypass and the bullet read as a verified invariant; and a synthetic line appended to a module that is its own chokepoint fell past a range computed before the line was added, so the check called an inside site outside. Running the check's own classifier on every staged site is the only way the refutation proves the thing it claims: that this check, not the instrument, would go red. Ruling rs-e93ecdd6 adds the neighbouring case: where the language itself refuses every reference the check would call a bypass, Coherence's check can never be made to fire, and demanding it would leave a stronger rung weaker than the one below it, so the refusal is the proof
  crossing: instrument -> reading
  refuted: let every staged synthetic site count whatever the check's own classification called it, so a site classified inside or a test reference still fired the refutation -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
- not configured never passes: The totality oracle pass reports a missing test command as not run, never as passing, and a command whose output does not match is a fail.
  over: every totality oracle the run checks
  via: the totality oracle pass: configured command with a filter and a match; not configured is reported, never passing
  because: a project with no test command has no detector, and a pass would say the opposite; a runner that exits 0 when no test matched the name needs its output matched, or a renamed test would pass forever
  crossing: instrument -> record
  refuted: made a missing test command report pass -> "the totality oracle pass: configured command with a filter and a match; not configured is reported, never passing" went red in enforcement.test.ts; restored, green (2026-09-17)
  kinds: none
- one invocation for every test: When the config names a testJson command, every test the bullets name runs in one invocation, the results map back by name, and the record says which mode ran.
  protects: runTotalityBatch
  chokepoint: performRun
  over: every totality oracle the run checks
  via: the batched totality oracle pass: every test the bullets name in one invocation, mapped back by name; the record says which mode ran
  because: a runner whose setup is costly must not start once per test named; one invocation with a combined name pattern and a per-test report keeps the pass affordable, results map back by the same name the pattern selected, and the record says which mode ran so a one-at-a-time fallback is never mistaken for the batch
  crossing: instrument -> record
  refuted: made every totality entry record the one-at-a-time mode whatever ran -> "the batched totality oracle pass: every test the bullets name in one invocation, mapped back by name; the record says which mode ran" went red in enforcement.test.ts; restored, green (2026-09-17)
  kinds: none
- a report entry maps by exact title: A reported test belongs to the via it names by exact title, its own or one above it, with a stated fallback only for a runner that truncates titles in its report.
  over: every entry of every report the batched pass reads and every via a bullet names
  via: a report entry maps to a via by exact title, with the one stated fallback for a runner that truncates
  because: the batched pass selects by pattern and maps results back by name, so the mapping is the whole basis of a totality oracle's verdict; a substring mapping let a bullet's verdict come from a different test whose title merely contained its name, which means a neighbour's failure can fail this bullet and a neighbour's pass can carry it
  crossing: instrument -> record
  refuted: mapped a report entry to a via by substring again -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
- the instrument outlives the test pass: A run keeps the instrument alive across the totality pass and asks it again afterwards; a run whose instrument did not survive records the reason on every entry it could not check and exits non-zero, never 0 with not run.
  over: every run that needs the instrument and runs the totality pass first
  via: the run keeps the instrument alive across the test pass, and a run whose instrument died exits non-zero with the reason
  because: the totality pass runs the project's whole suite before the first question, and the warm server's idle timer only resets on a request line, so a suite longer than the idle killed the instrument mid-run, recorded not run for every chokepoint, and exited 0: a run that proved nothing read exactly like a clean one, which is the one thing a verification pass must never do
  crossing: harness -> instrument
  refuted: removed the heartbeat that holds the warm server's idle timer open across the test pass -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
- warm server the only path: From a hook or a reading, the language server is reached only through the warm server: one door connects over the socket, spawns the server detached when none listens, and hands the adapter to the run or to the reading that asked.
  protects: connectAdapter
  chokepoint: withWarmAdapter
  over: every hook event that re-checks a chokepoint and every reading that needs the instrument itself
  via: two clients ask the same questions; the second finds the server warm
  because: a hook is short-lived and a cold project load is too slow for a check at the edit; every run and every reading (the economy's closure) connects through one door that finds the warm server or spawns it detached, so no hook and no reading can start its own cold instrument and wait on it
  crossing: harness -> instrument
  refuted: made the second client report a cold server whether or not one was warm -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
