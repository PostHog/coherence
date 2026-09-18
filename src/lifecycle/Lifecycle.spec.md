# Lifecycle

The gyroscope delivered through harness events: orient at start, regulate at stop, the glossary injected and checked.

## invariants
- compact injection: The injection at session start carries the vocabulary only: nothing from detail, provenance, or metaphors.
  over: every concept of both glossary layers
  via: renderCompact: header, one line per concept, rejected in brackets, nothing from detail, provenance or metaphors
  because: the injection rides in a context budget shared with the session's work; detail and provenance are for a human in Scope, and a metaphor in the injection would be read as a definition
  crossing: project-source -> reading
  refuted: made renderCompact print each concept's whole entry beside its line -> "renderCompact: header, one line per concept, rejected in brackets, nothing from detail, provenance or metaphors" went red in glossary.test.ts; restored, green (2026-09-17)
  kinds: output
  checklist: destination-confinement dismissed: the injection goes to one destination, the host's additionalContext, and follows no redirect
  checklist: redaction declared as compact injection
  checklist: commit-ordered-effects dismissed: nothing is committed before the injection and it has no external effect
  checklist: circuit-breaker-policy dismissed: no dependency is sampled
  checklist: declared-target-coverage dismissed: one host reads the injection, not a registry of targets
- injection within budget: The start injection stays under the host budget: the project layer steps down in detail until the text fits, and Coherence's layer never shrinks.
  over: both glossary layers at every detail level
  via: renderCompactWithin steps the project layer down until the text fits; Coherence's layer never shrinks
  because: a host replaces an over-long injection with a file preview or spills it, so an injection that overran the budget would be read by nobody; the project layer is the one that can shrink because its full entries are one command away
  crossing: project-source -> reading
  refuted: made renderCompactWithin return the full form without checking the length -> "renderCompactWithin steps the project layer down until the text fits; Coherence's layer never shrinks" went red in glossary.test.ts; restored, green (2026-09-17)
  kinds: budget
  checklist: bounded-admission dismissed: no concurrent work is admitted; the bound is a character count on one document
  checklist: fair-admission dismissed: there are no contenders for the budget
  checklist: rate-budget dismissed: nothing is counted against a time window
  checklist: memory-budget dismissed: the bound is on the injected text, not on allocation
  checklist: execution-budget dismissed: no steps are counted
  checklist: circuit-breaker-policy dismissed: no dependency failures are observed
- rejected names refused: A rejected name is a finding as a whole word or phrase in prose and as an identifier token in code, each with its concept and because.
  over: every rejected name of both glossary layers, across every prose and code file in the corpus
  via: rejected names are found as whole words in prose, with concept and because
  because: a rejected name is drift the glossary already refused once; finding it as a whole word with its concept and the reason turns the second refusal into one edit instead of a discussion
  crossing: project-source -> reading
  refuted: removed the prose pass from rejectedInProse -> "rejected names are found as whole words in prose, with concept and because" went red in check.test.ts; restored, green (2026-09-17)
  kinds: none
- project sense wins: Inside a project, an accepted project name silences a Coherence rejection, and an accepted phrase guards the words inside it.
  over: every accepted project name and alias against every Coherence rejected name
  via: a project's own sense wins: an accepted project name silences a Coherence rejection, and an accepted phrase guards the words inside it
  because: Coherence's names describe the tool and a project's names describe its domain; a domain that legitimately uses a word the tool refuses must not be made to rename its own things
  crossing: project-source -> reading
  refuted: <not witnessed: no staged break was attempted for the guard logic; the test has not been red in this repository>
  kinds: none
- regulate refuses only what it can prove: A subagent stop is refused for glossary findings in changed files, spec problems, or structural defects, and never for an open requirement.
  protects: REFUSE_EXIT
  chokepoint: runHook
  over: every stop event a host sends
  via: orient lists open requirements and regulate reports them; only spec problems refuse a subagent stop
  because: a refusal holds a subagent in its loop, so it is spent only on what the tool can prove is owed: a rejected name in a changed file, a spec that will not parse, a chokepoint that no longer chokes; an open requirement can legitimately outlive a session, and refusing on it would train agents to fabricate enforcement lines
  crossing: harness -> reading
  refuted: widened the refusal to any spec text, so an open requirement refused the subagent stop -> its totality oracle went red at "an open requirement never refuses a subagent stop", exit 2 where 0 was asserted (2026-09-17)
  kinds: none
- escalation heads the start: An unacknowledged escalation heads the start injection, never shortened; an acknowledged one does not.
  over: every start event, SessionStart and SubagentStart, against every escalation in the journal
  via: an unacknowledged escalation heads the start output; an acknowledged one does not
  because: a session that starts without seeing the question a human has not answered will act past it; the block is never shortened to fit the budget because a human must see it whole
  crossing: record -> reading
  refuted: made escalationBlock read an empty journal -> "an unacknowledged escalation heads the start output; an acknowledged one does not" went red in hook.test.ts; restored, green (2026-09-17)
  kinds: read
  checklist: scoped-reads dismissed: every session sees every open escalation
  checklist: redaction dismissed: the block is never shortened
- revelation at the edit: After a file-writing tool, the chokepoint invariants the file may involve are re-checked and a bypass is shown in the same turn with the two honest options; the stop carries the defects.
  over: every chokepoint invariant whose latest run touched the written file or whose protected or chokepoint name appears in it
  via: PostToolUse on a file-writing tool re-checks the invariants that may involve the file and prints the bypass with the two options; Stop carries the defects
  because: the moment a second referencing site appears is the moment to reveal it; a defect shown at the next stop is already buried under the work that followed, so the re-check runs in the same turn and names the two honest options, route through the chokepoint or escalate a retirement
  crossing: harness -> reading
  refuted: made editContext return nothing whether or not the re-check failed -> "PostToolUse on a file-writing tool re-checks the invariants that may involve the file and prints the bypass with the two options; Stop carries the defects" went red in enforcement.test.ts; restored, green (2026-09-17)
  kinds: output
  checklist: destination-confinement dismissed: one destination, the host's additionalContext, and no redirect
  checklist: redaction dismissed: a bypass is shown whole with its file, line, and symbol
  checklist: commit-ordered-effects dismissed: the run is appended before the text is printed, and printing is not irreversible
  checklist: circuit-breaker-policy dismissed: an unavailable instrument is reported as such, never routed around
  checklist: declared-target-coverage dismissed: one file per event, not a registry of targets
- install keeps other hooks: Installing the hook merges one Coherence entry per event into the host's settings, keeps every other hook, and replaces its own entry on a second pass.
  protects: SETTINGS_FILE
  chokepoint: src/lifecycle/install.ts
  over: every host and every event Coherence installs
  via: mergeHooks adds one Coherence entry per event, keeps everything else, and replaces its own entry on a second pass
  because: the host's settings file belongs to the adopter and may already carry other hooks; an install that clobbered them would cost the adopter its own automation, and a second install that duplicated its entry would run every hook twice
  crossing: project-source -> harness
  refuted: <not witnessed: no staged break was attempted on the merge; the test has not been red in this repository>
  kinds: deploy
  checklist: graceful-drain dismissed: nothing is shut down by an install
  checklist: readiness-evidence dismissed: status reports what is written in the settings file and claims nothing about a running process
  checklist: declared-target-coverage declared as install keeps other hooks
- feed injects subjects only: At prompt and tool boundaries the peer feed injects the subjects of records other sessions wrote since this session's cursor, twelve at most with a count of the rest and the command that shows them whole; a full record is never injected.
  over: every record another session wrote after the cursor, at every UserPromptSubmit and PostToolUse
  via: the peer feed injects subjects of other sessions' records since the cursor, capped, never full records
  because: subjects carry the signal and the journal carries the text; a boundary that injected whole records would spend the session's context on other sessions' reasoning at every tool use, which is what the reference's boundary hooks did and why they were retired
  crossing: record -> reading
  refuted: made the feed inject each record's timeline lines instead of its subject -> "the peer feed injects subjects of other sessions' records since the cursor, capped, never full records" went red in hook.test.ts; restored, green (2026-09-17)
  kinds: output
  checklist: destination-confinement dismissed: one destination, the host's additionalContext, and no redirect
  checklist: redaction declared as feed injects subjects only
  checklist: commit-ordered-effects declared as cursor advances after the print
  checklist: circuit-breaker-policy dismissed: the feed reads local files; no dependency is sampled
  checklist: declared-target-coverage dismissed: one host reads the injection, not a registry of targets
- cursor advances after the print: The feed cursor moves past the records a feed covered only after that feed was handed to the host: rendering alone moves nothing, the hook hands the advance back to the command line, which commits it only once its stdout write succeeded, and an unprinted feed is shown again.
  over: every feed rendered for a session, at every boundary event, through the library and through the command line that prints it
  via: the feed cursor advances only after the feed is printed: rendering moves nothing, and the CLI commits only once its stdout write succeeded
  because: a cursor moved before the print would let a hook that failed between render and output swallow what peers recorded; the advance is the commit, and it follows the effect it records, so it belongs to the one place that knows the write succeeded
  crossing: harness -> record
  refuted: committed the cursor inside runHook, before the command line had written stdout -> "the feed cursor advances only after the feed is printed: rendering moves nothing, and the CLI commits only once its stdout write succeeded" went red in hook.test.ts: with the host's end of the pipe closed the cursor had moved and the host had nothing; restored, green (2026-09-17)
  kinds: state
  checklist: revalidated-permission dismissed: no permission is involved in moving a cursor
  checklist: separation-of-duties dismissed: one session moves its own cursor and nobody else's
  checklist: legal-state-succession declared as cursor advances after the print
  checklist: supersession-safety dismissed: the cursor is one value per session, replaced only by a later one
  checklist: worker-fencing dismissed: no two workers share a cursor; it is keyed by session
  checklist: commit-ordered-effects declared as cursor advances after the print
  checklist: resumption-coverage dismissed: a session that restarts keeps its cursor and resumes where it looked last; a session that never had one starts at the latest record by design
- the order rides with orient and regulate: The start prints the active order the session owns with its objective, success, boundary, and the rule that maintenance outside the boundary is not this session's to do, nudges an open one toward activation; the stop reminds that an active order is closed with work close; neither ever refuses.
  over: every start and stop event, against every work order the session owns
  via: orient prints the active order a session owns with the boundary rule, nudges an open one, and regulate reminds that work close ends it
  because: an order nobody reads back is the reference's failure again; the moments a session reads its heading and its debt are the moments the order must be in view, and the boundary rule is what keeps 14 of 33 reference records about a wall from recurring as nags about maintenance outside the assignment
  crossing: record -> reading
  refuted: made workBlock print nothing whatever the session owned -> "orient prints the active order a session owns with the boundary rule, nudges an open one, and regulate reminds that work close ends it" went red in hook.test.ts; restored, green (2026-09-17)
  kinds: read
  checklist: scoped-reads declared as the order rides with orient and regulate
  checklist: redaction dismissed: the order is shown whole; objective, success, and boundary are the point
