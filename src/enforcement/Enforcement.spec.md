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
- sites classified: Every reference to the protected thing is inside the chokepoint, an import, a test reference, or a bypass, and a test reference is never a bypass.
  over: every reference the language server reports for a protected thing
  via: classification: inside the chokepoint, an import, a test reference, a bypass
  because: a chokepoint holds while every reference is inside it, so the classes must partition every site: an import brings a name into scope and uses nothing, a test may reference the protected thing to check it and is reported rather than counted, and everything else is a bypass; a test counted as a bypass would alarm on every test, and a bypass counted as anything else would hide a structural defect
  crossing: instrument -> reading
  refuted: made a test reference classify as a bypass -> "classification: inside the chokepoint, an import, a test reference, a bypass" went red in enforcement.test.ts; restored, green (2026-09-17)
  kinds: none
- grade ladder: A chokepoint grades broken with a bypass or a missing chokepoint, reference-choked when clean and visible, visibility-choked when clean and not visible, and not chokeable when the protected thing is prose.
  over: every combination of bypass count, chokepoint resolution, visibility, and name form
  via: grades: broken with a bypass, reference-choked when clean and exported, visibility-choked when not exported, broken when the chokepoint is missing, not chokeable for prose
  because: the grade is what a human reads to know how much the structure is doing; a broken chokepoint graded clean would hide a structural defect, and prose graded as a chokepoint is the defect the reference's checks carried for months
  crossing: instrument -> reading
  refuted: made every clean chokepoint grade reference-choked whatever its visibility -> "grades: broken with a bypass, reference-choked when clean and exported, visibility-choked when not exported, broken when the chokepoint is missing, not chokeable for prose" went red in enforcement.test.ts; restored, green (2026-09-17)
  kinds: none
- automatic refutation: A chokepoint verdict is never recorded without its refutation: a synthetic reference is opened beside the protected thing and the instrument must report it, nothing touches disk, and an unseen site makes the check vacuous, never a pass.
  protects: checkChokepoint
  chokepoint: performRun
  over: every chokepoint-form enforcement the run checks
  via: the automatic refutation opens a synthetic reference and sees it; nothing is written to disk
  because: a check that would report nothing if the chokepoint were broken is vacuous; opening a synthetic reference and confirming the instrument sees it proves the instrument would report a real bypass, doing it in an unsaved document leaves the tree untouched, and every chokepoint verdict reaches the record through the one function that always attempts it
  crossing: instrument -> record
  refuted: <not witnessed by hand: the run witnesses this one automatically; no staged break was attempted on the synthetic document>
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
- warm server the only path: From a hook or a reading, the language server is reached only through the warm server: one door connects over the socket, spawns the server detached when none listens, and hands the adapter to the run or to the reading that asked.
  protects: connectAdapter
  chokepoint: withWarmAdapter
  over: every hook event that re-checks a chokepoint and every reading that needs the instrument itself
  via: two clients ask the same questions; the second finds the server warm
  because: a hook is short-lived and a cold project load is too slow for a check at the edit; every run and every reading (the economy's closure) connects through one door that finds the warm server or spawns it detached, so no hook and no reading can start its own cold instrument and wait on it
  crossing: harness -> instrument
  refuted: <not witnessed by hand: the run witnesses the chokepoint automatically; no staged break was attempted on the socket>
  kinds: none
