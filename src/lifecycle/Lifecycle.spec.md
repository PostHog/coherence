# Lifecycle

The gyroscope delivered through harness events: orient at start, regulate at stop, the glossary injected and checked.

## entrances
- SessionStart: the agent host starts a session; orient injects the vocabulary, the project's standing, and the session's work order
  handler: runHook in hook.ts
- SubagentStart: the agent host starts a subagent; it is oriented as a session is
  handler: runHook in hook.ts
- UserPromptSubmit: a human sends a prompt; the peer feed injects what peers recorded since the last look
  handler: runHook in hook.ts
- PostToolUse: a tool finished; the edit is checked, the read trace recorded, and the peer feed and vocabulary changes injected
  handler: runHook in hook.ts
- Stop: the session is about to stop; regulate reports what it owes
  handler: runHook in hook.ts
- SubagentStop: a subagent is about to stop; regulate refuses the stop while it owes what the tool can prove
  handler: runHook in hook.ts

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
- injection within budget: The start injection stays under the host budget: the project layer steps down in detail until the whole fits; when what must be shown whole (escalations are never shortened) leaves no room, Coherence's layer steps down to names and then to one line that points at the glossary command.
  over: every start injection, with both glossary layers at every level and any number of open escalations ahead of them
  via: the start injection stays under the budget with escalations present: the vocabulary steps down to names and then to a pointer, and no escalation is shortened
  because: a host replaces an over-long injection with a file preview or spills it, so an injection that overran the budget would be read by nobody, and the one record that exists for a human would be the thing that hid itself; the vocabulary can shrink because its full entries are one command away, the escalations cannot
  crossing: project-source -> reading
  refuted: returned the full vocabulary unchecked whenever no project layer could step down, so eight open escalations put the start injection at 11,614 characters against 9,500 -> "the start injection stays under the budget with escalations present: the vocabulary steps down to names and then to a pointer, and no escalation is shortened" went red in hook.test.ts; restored, green (2026-09-17)
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
- both layers reach identifiers: Both glossary layers' rejected names are matched in identifiers as well as in prose; only a name the project declares as its own concept or alias is silent there.
  over: every rejected name of both layers against every identifier token in the corpus, in a project with its own glossary and in one without
  via: in code, both layers' rejected names match identifier tokens, Coherence's too in an adopter, unless the project declares the name as its own; language globals and module specifiers never match
  because: the cross-glossary rule is about sense, not about where a word sits: a project that means something of its own by a word declares it and is left alone, and a project that has not declared it is drifting whether the word is in a sentence or in a symbol. Holding Coherence's names against prose only let an adopter's code carry them untouched, which is where naming drift actually lives
  crossing: project-source -> reading
  refuted: held Coherence's rejected names against an adopter's prose only, so the name in an adopter identifier went unreported -> "in code, both layers' rejected names match identifier tokens, Coherence's too in an adopter, unless the project declares the name as its own; language globals and module specifiers never match" went red in check.test.ts, the identifier hit missing from the expected list; restored, green (2026-09-18)
  kinds: none
- the corpus is every text kind: The check reads every text file kind the project holds, the journal's and work's own records included, and leaves out what is written in another vocabulary on purpose, what no rename can repair, and what is not text.
  over: every file under the project root, by kind: prose, code, data, dotfiles, records, lockfiles, binaries, the retired inventories, the reference docs and the reviews
  via: the corpus reads every text kind the project holds, the journal's records included, and leaves out lockfiles, binaries, runs, and the reviews
  because: a check that reads two extensions reports zero over a project whose drift is in its configuration, its scripts and its records, and a zero that means "not looked at" is worse than no check; the exclusions are the files that must name what they refuse (the glossaries and the retired inventories), the files a rename cannot reach (a dependency lockfile), and the files that are not the project's own words (the reference docs and the adversarial reviews, which quote the names they report)
  crossing: project-source -> reading
  refuted: read only .md and .ts, so eleven files of nine other kinds went unread and only the review the check should skip was read -> "the corpus reads every text kind the project holds, the journal's records included, and leaves out lockfiles, binaries, runs, and the reviews" went red in check.test.ts with every expected file missing; restored, green (2026-09-18)
  kinds: read
  checklist: scoped-reads declared as the corpus is every text kind
  checklist: redaction dismissed: every finding is shown with its file, line, and the text as written
- the corpus stays inside the root: Every path the check is given is confined to the project root; a path that reaches above it is refused rather than read.
  over: every path given to the check: relative, absolute, and reaching upward
  via: collectFiles confines every given path to the project root
  because: the paths reach the check from a spec, a hook's stdin, and a command line, none of which is trusted to stay inside the tree it names; a walk that followed one upward would read, and report, a neighbouring project's files
  crossing: project-source -> reading
  refuted: resolved each given path and walked it, so ".." and "/etc" were read -> "collectFiles confines every given path to the project root" went red in check.test.ts, the walk failing above the root instead of refusing; restored, green (2026-09-18)
  kinds: none
- an unreadable path never aborts the check: A path the process cannot read is reported as unreadable and skipped; the rest of the corpus is still checked, and the report says what it did not see.
  over: every folder and file the walk reaches, readable and not
  via: an unreadable folder is reported and skipped; the check never aborts on it
  because: one locked folder cost the whole check, so a project with a single unreadable path got no verdict at all; and a check that quietly skipped it would report a clean corpus it never read, which is the same lie a failed listing read as an empty one would be
  crossing: project-source -> reading
  refuted: let the walk's readdir throw -> "an unreadable folder is reported and skipped; the check never aborts on it" went red in check.test.ts with EACCES out of scandir aborting the run; restored, green (2026-09-18)
  kinds: none
- project sense wins: Inside a project, an accepted project name silences a Coherence rejection, and an accepted phrase guards the words inside it.
  over: every accepted project name and alias against every Coherence rejected name
  via: a project's own sense wins: an accepted project name silences a Coherence rejection, and an accepted phrase guards the words inside it
  because: Coherence's names describe the tool and a project's names describe its domain; a domain that legitimately uses a word the tool refuses must not be made to rename its own things
  crossing: project-source -> reading
  refuted: dropped the project's own accepted phrases from the guard, so a Coherence rejection spoke over the project's sense -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: none
- regulate refuses only what it can prove: A subagent stop is refused for a rejected name in a changed file, a spec problem, or a structural defect, and never for an open requirement.
  protects: REFUSE_EXIT
  chokepoint: runHook
  over: every stop event a host sends
  via: orient lists open requirements and regulate reports them; only spec problems refuse a subagent stop
  because: a refusal holds a subagent in its loop, so it is spent only on what the tool can prove is owed: a rejected name in a changed file, a spec that will not parse, a chokepoint that no longer chokes; an open requirement can legitimately outlive a session, and refusing on it would train agents to fabricate enforcement lines
  crossing: harness -> reading
  refuted: widened the refusal to any spec text, so an open requirement refused the subagent stop -> its totality oracle went red at "an open requirement never refuses a subagent stop", exit 2 where 0 was asserted (2026-09-17)
  kinds: none
- an unknown noun never refuses: An unknown noun in a changed file is reported at the stop with its three answers and never refuses a subagent stop.
  over: every stop event whose changed files carry an unknown noun and no rejected name
  via: an unknown noun in a changed file is advisory: Stop reports it and SubagentStop never refuses on it
  because: the nomination is a heuristic, precision over recall, and the glossary allows a refusal only for what the tool can prove: a rejected name, a spec problem, a structural defect; holding a subagent on a guess would teach it to strip capitalized phrases rather than declare names
  crossing: harness -> reading
  refuted: refused the subagent stop on any glossary finding, unknown nouns included -> "an unknown noun in a changed file is advisory: Stop reports it and SubagentStop never refuses on it" went red in hook.test.ts, exit 2 where 0 was asserted; restored, green (2026-09-17)
  kinds: none
- a recorded wall makes the debt advisory: A debt the session has recorded as unable, naming the file, the rejected name, or the invariant, is reported with that record's id and does not refuse the subagent stop; another session's unable clears nothing.
  over: every rejected name, spec problem, and structural defect a subagent stop would refuse on, against every unable record of the stopping session
  via: an unable record from the session turns the debt it names advisory: SubagentStop reports it and exits 0, and another session is still refused
  because: the subagent stop is refused until the debt is paid or recorded as unable; a wall the agent cannot pass must not hold it in its loop forever, and the record names the wall for the reader who decides, which is why it counts only for the session that wrote it
  crossing: record -> reading
  refuted: refused the subagent stop with the unable record on file, reading no wall -> "an unable record from the session turns the debt it names advisory: SubagentStop reports it and exits 0, and another session is still refused" went red in hook.test.ts, exit 2 where 0 was asserted; restored, green (2026-09-17)
  kinds: none
- a git failure is not a clean tree: When git cannot list the changed files, the stop says so and that the glossary check ran over nothing; outside a repository the answer is no files, and a failure never refuses.
  over: every stop event, in a repository git can read, one it cannot, and no repository at all
  via: changedFiles reports a git failure instead of answering a clean tree; outside git the answer is no files
  because: a listing that failed reads exactly like a tree with nothing changed unless the failure is carried; regulate would then report clean over files it never saw, which is the one lie the stop exists to prevent
  crossing: harness -> reading
  refuted: caught every git failure and answered no files -> "changedFiles reports a git failure instead of answering a clean tree; outside git the answer is no files" went red in hook.test.ts on the unreadable repository; restored, green (2026-09-17)
  kinds: none
- the hook answers one project: Every event is answered for the project root the hook was installed for; a cwd from the harness that is not inside that root is refused, and nothing is read or written.
  protects: OUTSIDE_ROOT_EXIT
  chokepoint: runHook
  over: every event, with a cwd inside the installed root, one outside it, and no installation to point at
  via: the hook refuses a cwd from stdin that is not inside the project root it was installed for
  because: the working directory arrives on stdin from the harness, which is the one input the tool does not author; a hook that answered any cwd would read a neighbouring project's journal and append its own records there, and the tree it was installed for is the one it can point at, by the settings file that carries it or by the name the harness gives
  crossing: harness -> project-source
  refuted: took the cwd from stdin as given, so a stranger's tree was answered for -> "the hook refuses a cwd from stdin that is not inside the project root it was installed for" went red in hook.test.ts, exit 0 where 78 was asserted; restored, green (2026-09-18)
  kinds: none
- the stop snapshot has an instrument: The read-trace snapshot at a stop reaches the language server through enforcement's one door, in production as in a test, and records the instrument it was handed.
  over: every stop event that snapshots a trace, with a door that answers and a door that cannot
  via: the Stop snapshot reaches the instrument through enforcement's one door, in production as in a test
  because: the snapshot exists to be calibrate's input, and a closure predicted with no adapter skips the hops, so every production sample was measuring a prediction the tool would never make at the command line; the door is enforcement's because a second way to the warm server is a second lifecycle to get wrong
  crossing: harness -> reading
  refuted: passed only the adapter a test hands in, so a production stop recorded server "none" and reason "no adapter" -> "the Stop snapshot reaches the instrument through enforcement's one door, in production as in a test" went red in hook.test.ts, "none" where "warm" was asserted; restored, green (2026-09-18)
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
- escalation names what it cites: An open escalation in the start injection names each record it cites, a decision or a work order or any record, by id, kind and subject beneath it.
  over: the start injection over a journal with an escalation that cites a decision and a work order
  via: an open escalation that cites a decision and a work order names each by id, kind and subject in the start output
  because: an escalation is the one record that exists for a human; a question that arrives without what it is about sends the human to the journal to reconstruct it, and a cited decision's subject is the shortest faithful statement of that context
  crossing: record -> reading
  refuted: stopped escalationBlock from naming the records an escalation cites -> the totality oracle went red in hook.test.ts; restored, green (2026-09-23)
  kinds: none
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
- install keeps other hooks: Installing the hook merges one Coherence entry per event into the host's settings, keeps every hook that is not ours, owns only a command that names this tool's binary or its own cli path, and replaces that command on a second pass.
  protects: mergeHooks
  chokepoint: install
  over: every host and every event Coherence installs, against every hook command another tool could have written there
  via: mergeHooks adds one Coherence entry per event, keeps everything else, and replaces its own entry on a second pass
  because: the host's settings file belongs to the adopter and may already carry other hooks; an install that clobbered them would cost the adopter its own automation, a second install that duplicated its entry would run every hook twice, and ownership decided by a loose match would delete a stranger's hook that merely ends the way ours does. What must be choked is the object that gets written: only the merge produces it, and only install reaches the merge. It was written as the settings path inside this module, which stopped being true the moment the hook needed to know which tree it was installed for and read the same two paths to find it; the path is a fact about a host, the merge is the thing that must have one door
  crossing: project-source -> harness
  refuted: claimed any command ending in "cli.ts hook <Event>" as Coherence's, so a stranger's cli.ts hook was deleted on install -> "mergeHooks adds one Coherence entry per event, keeps everything else, and replaces its own entry on a second pass" went red in install.test.ts naming the three foreign hooks that vanished; restored, green (2026-09-17)
  refuted: made mergeHooks drop every other host's entry instead of keeping it -> the totality oracle went red, then green once restored (2026-09-18)
  kinds: deploy
  checklist: graceful-drain dismissed: nothing is shut down by an install
  checklist: readiness-evidence dismissed: status reports what is written in the settings file and claims nothing about a running process
  checklist: declared-target-coverage declared as install keeps other hooks
- uninstall keeps other hooks: Uninstalling the hook removes every command of Coherence's from the agent host's settings and nothing else: another tool's hook stays in its entry with its matcher, an entry, event list, or hooks object goes only when this removal emptied it, the file keeps its layout, and a second uninstall changes nothing.
  over: both agent hosts, settings in every layout (two spaces with a final newline, a tab without one, no hooks object), and every hook command another tool could have written beside ours or in the same entry
  via: uninstall removes only Coherence's commands and returns the settings to what they were before install
  because: the settings file belongs to the adopter; an uninstall that took a neighbouring hook, reformatted the file, or left an empty husk would make removing Coherence cost the adopter its own automation or a diff to review, and an adopter who cannot leave cleanly will not try it. Ownership is the same command rule install uses, so what uninstall removes is exactly what install could have written
  crossing: project-source -> harness
  refuted: made stripHooks drop an entry of ours whole, so another tool's hook sharing that entry left with it -> "uninstall removes only Coherence's commands and returns the settings to what they were before install" went red in install.test.ts; restored, green (2026-09-23)
  kinds: deploy
  checklist: graceful-drain dismissed: nothing is shut down by an uninstall; a session already running keeps the hooks its agent host loaded
  checklist: readiness-evidence dismissed: uninstall reports what it removed from the settings file and claims nothing about a running process
  checklist: declared-target-coverage dismissed: one host's one settings file per call, not a registry of targets
- check fails on any drift: The hook check exits non-zero, naming the event and the kind, whenever an agent host's installed hooks differ from what install would write: an event missing, an entry of ours stale in any field or shape, or an extra entry of ours; another tool's hook is never drift.
  over: every event install wires, every field and the shape of the entry install writes, and every entry of ours under any event, for both agent hosts
  via: the check names every drift from what install would write: missing, stale, and extra
  because: the check is what CI and a person run to know the gyroscope is actually delivered; one that passed a stale launcher, a dropped Codex context limit, or a duplicate entry would report delivery that is not happening, which is the reference's failure of a mechanism described rather than automatic. It compares against the one entry install writes, so the two cannot disagree
  crossing: project-source -> harness
  refuted: made the check compare only the command, so a changed timeout, a dropped Codex context limit, a shared entry, or a matcher passed as clean -> "the check names every drift from what install would write: missing, stale, and extra" went red in install.test.ts; restored, green (2026-09-23)
  kinds: none
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
- feed carries two kinds: The feed injects a peer's decisions and a peer's escalations, and no other verb.
  over: every record kind a peer can write, at every boundary event
  via: the peer feed injects a peer's decisions and escalations and no other kind
  because: the glossary names decision subjects, and an escalation heads every read: a question standing before a human changes what a peer should do next, so a session that met one only at its own start would act past it for a whole cycle. Every other verb is the journal, one command away, and injecting all eleven at every tool use spends the session's budget on what nobody asked for
  crossing: record -> reading
  refuted: injected the subject of every record kind, so a peer's conjecture, defect, unable, retraction and resolution rode into the context too -> "the peer feed injects a peer's decisions and escalations and no other kind" went red in hook.test.ts, seven records where two were asserted; restored, green (2026-09-18)
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
- candidates come from names: A vocabulary candidate comes only from a name: from code, a declared or exported name, and only when prose writes it as words or it spans components; from prose, a name written as a name that recurs. A local identifier, the words and n-grams of a split identifier, a string, a regular-expression fragment, a path, an id, and a punctuation-bearing token are never candidates.
  over: every code and prose line of the corpus, with declared names, locals, split identifiers, fragments, paths, work-order and decision ids, hashes and UUIDs
  via: a code identifier is never a candidate unless it is declared and prose recurs it; ids, paths and fragments never are
  because: the old reading split every identifier into words and n-grams and offered 4,807 candidates, most of them the language's words (root, sync, map, deep equal) and fragments (a z, .venv/bin/python); a count that size is skipped, so the few real undefined concepts were never read. Code and prose are different populations: code names things for the machine, prose names them for the reader, and only a name both share is vocabulary
  crossing: project-source -> reading
  refuted: counted any identifier assigned on a code line as declared, so the local tallyMarks became a candidate from its split words -> "a code identifier is never a candidate unless it is declared and prose recurs it; ids, paths and fragments never are" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
  kinds: none
- well-known names need no definition: A well-known name (the curated list, the config's wellKnown, the project's own name) and a name the glossary already declares or lists under not: is never a candidate, while a common word written as a project's proper noun, or a capitalized-only well-known word used lowercase in a project sense, still is.
  over: every candidate the corpus nominates, against the shipped list, the config, the project's name, every concept, alias, instance, property and not: entry of both layers
  via: well-known names, the project's own name and the glossary's not: names are never candidates, while a common word written as a project's proper noun still is
  because: Python, Pyright, Chrome and the project's own name carried the old list's top and no definition could make them less ambiguous; but the fear of ambiguity lives exactly where a common word takes a project sense (Mnemion's hive; Coherence's scope, core, run, session), so the skip must never reach those
  crossing: project-source -> reading
  refuted: dropped the well-known check from nomination, so Kubernetes, Postgres, the config's Zanzibar and the project's own name were offered as candidates -> "well-known names, the project's own name and the glossary's not: names are never candidates, while a common word written as a project's proper noun still is" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
  kinds: none
- sense review only where meaning is at risk: A known word's use asks a sense review only when its meaning is at risk: the name has more than one recorded sense, a name rejected for that concept sits on or beside the line, or a Coherence concept is declared in an adopter's code; an ordinary use of a defined word asks nothing.
  over: every context of every known term, across prose, code and records, in a project with its own glossary and in Coherence itself
  via: sense review is asked only where meaning is at risk: more than one recorded sense, a rejected name beside the use, or a Coherence concept an adopter's code declares
  because: the old reading asked a review of every new or changed line that used a known word, 8,330 contexts on this repository, so every edit mentioning run or work order grew a pile nobody could settle; a review is worth asking only where two meanings can meet
  crossing: project-source -> reading
  refuted: asked a review of every context of every known word again, so an ordinary use of exposure awaited review -> "sense review is asked only where meaning is at risk: more than one recorded sense, a rejected name beside the use, or a Coherence concept an adopter's code declares" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
  kinds: none
- no totals are injected: No hook injection carries a total: orient names the ranked recurring terms that lack a definition and the senses at risk, a handful at most, or says nothing; regulate names only what this session introduced.
  over: every SessionStart, SubagentStart, PostToolUse and Stop injection, with nothing owed, something owed at the start, and something introduced during the session
  via: no hook injection carries a total: orient names the ranked terms or says nothing
  because: a number nobody can act on trains an agent to skip the line it sits in, and the vocabulary line had become the one every session skipped; a short named list is something to do, and silence when nothing is owed keeps the line worth reading
  crossing: project-source -> reading
  refuted: put the old Glossary coverage totals line back at the head of orient's vocabulary signal -> "no hook injection carries a total: orient names the ranked terms or says nothing" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
  kinds: output
  checklist: destination-confinement dismissed: one destination, the host's additionalContext or systemMessage, and no redirect
  checklist: redaction dismissed: only terms and component names are printed, never a use's text
  checklist: commit-ordered-effects declared as cursor advances after the print
  checklist: circuit-breaker-policy dismissed: the reading is local files; no dependency is sampled
  checklist: declared-target-coverage dismissed: one host reads the injection, not a registry of targets
- the edit line names what the edit introduced: The per-tool vocabulary line fires only when an edit makes a new term recur without a definition or puts a sense at risk, and names it; an ordinary edit that uses a known word says nothing, and a term once named is not named again.
  over: every PostToolUse after a session's baseline: an ordinary edit, an edit using a defined word, an edit that introduces a recurring undefined term, and the next edit after it was delivered
  via: the per-tool line is silent on an ordinary edit and names only the candidate an edit introduces
  because: the old line reported every new or changed context, so every edit that mentioned a known word added to it and the line was noise at every tool use; the moment to name a new term is the edit that made it recur, once
  crossing: project-source -> reading
  refuted: named every recurring undefined term at every edit instead of only the one the edit introduced, as the old per-tool line did -> "the per-tool line is silent on an ordinary edit and names only the candidate an edit introduces" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
  kinds: output
  checklist: destination-confinement dismissed: one destination, the host's additionalContext, and no redirect
  checklist: redaction dismissed: only terms and component names are printed, never a use's text
  checklist: commit-ordered-effects declared as cursor advances after the print
  checklist: circuit-breaker-policy dismissed: the reading is local files; no dependency is sampled
  checklist: declared-target-coverage dismissed: one host reads the injection, not a registry of targets
- coverage honors the config's bounds: The vocabulary corpus never enters a folder the config's ignore list names, by name or by path, through the same rule every other walk applies (underIgnored in project-files.ts); the journal's and work's records are read even when the config ignores .coherence.
  over: every file and folder the corpus walk meets, in a project whose config ignores a large folder by name, a nested folder by path, and .coherence
  via: coverage reads only inside the config's bounds: a folder the ignore list names is never entered, and the journal's records still are
  because: on a PostHog subsystem adoption whose config bounds the reading to one subsystem, coverage read 6,004 files of the whole monorepo in about 32 seconds and once crashed there on an over-long string, while the spec walker, mass and the interface readings all stayed inside the bounds; a vocabulary reading of code the adoption excluded offers the monorepo's names as the subsystem's. The records stay in because they are the project's own words about its work, whatever the code walks skip
  crossing: project-source -> reading
  refuted: made outsideBounds in check.ts answer false for every path, so the corpus walk entered every folder the config's ignore list names -> "coverage reads only inside the config's bounds: a folder the ignore list names is never entered, and the journal's records still are" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
  kinds: read
  checklist: scoped-reads dismissed: this invariant is the scope of the read itself; the corpus is the project's files inside the config's bounds, plus the records
  checklist: redaction dismissed: an ignored folder is reported by its path alone, and nothing under it is read
- function words are never candidates: A preposition, conjunction, determiner, pronoun, auxiliary, particle or contraction fragment of English is never a vocabulary candidate, however prose writes it (backticked, as a heading word, or capitalized mid-sentence), and the stoplist holds every one of those closed classes.
  over: every word of every closed class in FUNCTION_WORDS and an independently written core of each, each written three ways on lines in every component
  via: function words are never candidates: every preposition, conjunction, determiner, pronoun and auxiliary is refused however prose writes it
  because: "via" surfaced as the third recurring undefined term on this repository, from every spec's via: line; a word that carries grammar has no sense a project could define, so offering it spends the reader's attention on a list it learns to skip
  crossing: project-source -> reading
  refuted: dropped the function-word refusal from nominate in glossary-coverage.ts, so a function word written capitalized mid-sentence was nominated as a proper noun -> "function words are never candidates: every preposition, conjunction, determiner, pronoun and auxiliary is refused however prose writes it" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
  kinds: none
