# Lifecycle

The gyroscope delivered through harness events: orient at start, regulate at stop, the lexicon injected and checked.

## entrances
- SessionStart: the agent host starts a session; orient injects the vocabulary, the project's standing, and the session's work order
  handler: runHook in hook.ts
  trust: harness
- SubagentStart: the agent host starts a subagent; it is oriented as a session is
  handler: runHook in hook.ts
  trust: harness
- UserPromptSubmit: a human sends a prompt; the peer feed injects what peers recorded since the last look
  handler: runHook in hook.ts
  trust: harness
- PostToolUse: a tool finished; the edit is checked, the read trace recorded, and the peer feed and vocabulary changes injected
  handler: runHook in hook.ts
  trust: harness
- Stop: the session is about to stop; regulate reports what it owes
  handler: runHook in hook.ts
  trust: harness
- SubagentStop: a subagent is about to stop; regulate refuses the stop while it owes what the tool can prove
  handler: runHook in hook.ts
  trust: harness

## invariants
- a subagent is told its own session: A subagent's start names its own session for every journal write and names its coordinator's session as one it never writes under; the main thread's start names no coordinator.
  over: a subagent start carrying the host's agent id beside its coordinator's session, and a main-thread start
  via: a subagent's start names its own session and its coordinator's, and says never to write under the coordinator's
  because: coordinators passed their own session id into subagent prompts, and subagents wrote under it: their decisions then read as the coordinator's own
  crossing: harness -> reading
  kinds: none
- a proposal prints as a reader needs it: lexicon propose prints the proposal's id first, what it changes, the entry as it would stand and the apply command; the whole lexicon after the change is printed only with --json.
  over: a define proposal printed plainly and with --json
  via: lexicon propose prints the proposal as a reader needs it, id first, and the whole lexicon only with --json
  because: every proposal printed the whole lexicon after the change, 87 KB, into the agent's context, and agents scraped the id out of it
  crossing: record -> reading
  kinds: none
- a dropped lexicon key stays on record: A define keeps every property and detail key it does not name; a key leaves only by an explicit --drop of properties.<key> or detail.<key>, and the decision that applies the drop carries the removed key and its text.
  over: a define that adds a property, a define that drops a property and a detail key, a drop of another field, and a drop on another action
  via: a define keeps every property and detail key unless one is dropped by name, and the applying decision carries the dropped text
  because: define could only merge, so a retired key could never leave and was rewritten in place as a note that it was former (d-e5a064e3); a drop that deleted the text with the key would lose the meaning a later reader of the journal needs to see what the lexicon once said
  crossing: harness -> project-source
  refuted: deleted the line in propose's define branch that records a dropped key's text, so the drop still removed the key but the decision no longer carried its text -> "a define keeps every property and detail key unless one is dropped by name, and the applying decision carries the dropped text" went red in lexicon-work.test.ts on its own assertion; restored byte for byte, green (2026-10-05)
  kinds: revision
  checklist: revision-preservation declared as a dropped lexicon key stays on record
- a property drop counts its findings before apply: The preview of a define that drops a property key prints, before anything is applied, how many current uses of that key in the corpus would become unknown-noun findings, from the lexicon check run over the lexicon as it stands and as the drop leaves it.
  over: a dropped property key the prose writes as a name on three lines, and one it never writes
  via: a property drop's preview counts the current uses that would become unknown-noun findings, before apply
  because: a property key counts as accepted vocabulary (d-3283157b), so dropping one can turn every use of it into a finding, as a bare rejection once turned 227 uses of a keyword into findings (rt-cdcf2a29); the count belongs in the preview, where the drop can still be withdrawn
  crossing: harness -> project-source
  refuted: made dropFindings run the after-check over the project lexicon as it stands, so the preview counted no new finding -> "a property drop's preview counts the current uses that would become unknown-noun findings, before apply" went red in lexicon-work.test.ts on its own assertion; restored byte for byte, green (2026-10-05)
  kinds: none
- lexicon provenance is append-only: A define adds a provenance key and never rewrites one the concept already records, and a drop of provenance.<key> is refused.
  over: a drop of a provenance key, a define rewriting an existing provenance key, and a define adding a new one
  via: provenance is append-only: a drop of a provenance key and a define that rewrites one are refused, a new key is added
  because: provenance is who defined a concept and in whose words; a merge that let a later define overwrite it would erase the owner's ruling under an agent's, with nothing in the lexicon to show it happened
  crossing: harness -> project-source
  refuted: made define's provenance guard test a key no field has, so a define rewrote an existing provenance key -> "provenance is append-only: a drop of a provenance key and a define that rewrites one are refused, a new key is added" went red in lexicon-work.test.ts on its own assertion; restored byte for byte, green (2026-10-05)
  kinds: revision
  checklist: revision-preservation declared as lexicon provenance is append-only
- a lifted rejection cites the decision that made it: A rejected name leaves a concept's rejected list only by lift, never by define; applying a lift needs a human acknowledgement and a cite of the applied decision that rejected the name when the journal holds one, and the lift's decision carries the lifted entry with its reason.
  over: a define carrying an empty rejected list, a lift applied without a human, with a human and no cite, and with both
  via: a rejection is lifted only with a human acknowledgement and a cite of the decision that rejected it
  because: a rejection is a ruling a human or an agent made with a reason; taking it back without citing it would let a later session undo the ruling without reading why it was made, and the name would drift back in
  crossing: harness -> project-source
  refuted: made rejectingDecisions find no decision for any rejection, so a lift applied with a human and no cite -> "a rejection is lifted only with a human acknowledgement and a cite of the decision that rejected it" went red in lexicon-work.test.ts on its own assertion; restored byte for byte, green (2026-10-05)
  kinds: revision
  checklist: revision-preservation declared as a lifted rejection cites the decision that made it
- no project lexicon before a project makes one: Before a project has its own lexicon, lexicon coverage names no project lexicon even when Coherence's lexicon is installed under the project root, and lexicon review prints every live use of a term too rare to be a candidate yet; only Coherence's own checkout reads Coherence's lexicon as its project lexicon.
  over: an adopter with Coherence's lexicon installed under its root and no lexicon.json, reviewing a term written in its code and prose below the candidate threshold
  via: before a project lexicon exists, coverage names no project lexicon even with Coherence installed inside the project, and review reads a term's live uses
  because: at adoption coverage named node_modules/@posthog/coherence/docs/lexicon.json as the project's, and review showed no live use of the project's domain terms, so the first step of settle a domain term could not be done and the agent read the schema directly (df-0d4e5065)
  crossing: project-source -> reading
  refuted: restored the old fallback in lexiconCoverage, naming Coherence's lexicon as the project's whenever it lies under the root -> the totality oracle went red in lexicon-work.test.ts on its own assertion; restored byte for byte, green (2026-10-05)
  kinds: none
- an outside entry file is named as outside: lexicon propose --entry with a file outside the project is refused with a message that names that entry file, never the lexicon.
  over: an entry file in another folder outside the project root
  via: an entry file outside the project is refused naming that entry file, not the lexicon
  because: the refusal said the lexicon path was outside the project, naming the wrong thing, and the adopting agent copied its entries into a folder inside the project to get past a wall it could not read (df-292f9083)
  crossing: harness -> reading
  refuted: dropped the entry-file label from the confinement call in lexicon propose, so the refusal again named the lexicon path -> "an entry file outside the project is refused naming that entry file, not the lexicon" went red in lexicon-work.test.ts on its own assertion; restored byte for byte, green (2026-10-05)
  kinds: none
- compact injection: The injection at session start carries the vocabulary only: nothing from detail, provenance, or metaphors.
  over: every concept of both lexicon layers
  via: renderCompact: header, one line per concept, rejected in brackets, nothing from detail, provenance or metaphors
  because: the injection rides in a context budget shared with the session's work; detail and provenance are for a human in Scope, and a metaphor in the injection would be read as a definition
  crossing: project-source -> reading
  refuted: made renderCompact print each concept's whole entry beside its line -> "renderCompact: header, one line per concept, rejected in brackets, nothing from detail, provenance or metaphors" went red in lexicon.test.ts; restored, green (2026-09-17)
  kinds: output
  checklist: destination-confinement dismissed: the injection goes to one destination, the host's additionalContext, and follows no redirect
  checklist: redaction declared as compact injection
  checklist: commit-ordered-effects dismissed: nothing is committed before the injection and it has no external effect
  checklist: circuit-breaker-policy dismissed: no dependency is sampled
  checklist: declared-target-coverage dismissed: one host reads the injection, not a registry of targets
- injection within budget: The start injection stays under the host budget: the project layer steps down in detail until the whole fits; when what must be shown whole (escalations are never shortened) leaves no room, Coherence's layer steps down to names and then to one line that points at the lexicon command.
  over: every start injection, with both lexicon layers at every level and any number of open escalations ahead of them
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
  over: every rejected name of both lexicon layers, across every prose and code file in the corpus
  via: rejected names are found as whole words in prose, with concept and because
  because: a rejected name is drift the lexicon already refused once; finding it as a whole word with its concept and the reason turns the second refusal into one edit instead of a discussion
  crossing: project-source -> reading
  refuted: removed the prose pass from rejectedInProse -> "rejected names are found as whole words in prose, with concept and because" went red in check.test.ts; restored, green (2026-09-17)
  kinds: none
- both layers reach identifiers: Wherever a lexicon layer's rejected names bind, they are matched in identifiers as well as in prose; only a name the project declares as its own concept or alias is silent there.
  over: every rejected name of both layers against every identifier token in the corpus, in a project with its own lexicon and in one without
  via: in code, both layers' rejected names match identifier tokens where both bind, unless the project declares the name as its own; language globals and module specifiers never match
  because: where a name binds is decided once, by whose text it is (Coherence's rejected names bind only in Coherence's own text), never by where the word sits: a project that has not declared a word its lexicon refuses is drifting whether the word is in a sentence or in a symbol, and a symbol is where naming drift actually lives
  crossing: project-source -> reading
  refuted: held rejected names against prose only, so the names in identifiers went unreported -> "in code, both layers' rejected names match identifier tokens where both bind, unless the project declares the name as its own; language globals and module specifiers never match" went red in check.test.ts, the identifier hits missing from the expected list; restored, green (2026-09-25)
  kinds: none
- the corpus is every text kind: The check reads every text file kind the project holds, the journal's and work's own records included, and leaves out what is written in another vocabulary on purpose, what no rename can repair, and what is not text.
  over: every file under the project root, by kind: prose, code, data, dotfiles, records, lockfiles, binaries, the retired inventories, the reference docs and the reviews
  via: the corpus reads every text kind the project holds, the journal's records included, and leaves out lockfiles, binaries, runs, and the reviews
  because: a check that reads two extensions reports zero over a project whose drift is in its configuration, its scripts and its records, and a zero that means "not looked at" is worse than no check; the exclusions are the files that must name what they refuse (the lexicons and the retired inventories), the files a rename cannot reach (a dependency lockfile), and the files that are not the project's own words (the reference docs and the adversarial reviews, which quote the names they report)
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
- Coherence's rejected names bind only in Coherence's own text: In Coherence's own repository its rejected names bind in every text; in an adopter they are never matched in the project's code or domain prose, and a hit in the text written to Coherence (records, spec grammar, coherence.config.json) is advisory, counted and never failing.
  over: every Coherence rejected name against an adopter's prose, code, spec grammar and sentences, records and config, and against the same text read as Coherence's own repository, detected by its package name
  via: Coherence's rejected names bind only in Coherence's own text: in an adopter its code and domain prose are the project's words, and the text written to Coherence is advisory
  because: Coherence's names describe the tool and a project's names describe its domain; two adoptions arrived with 289 and 918 failing hits of words the tool refused for its own concepts, used in the project's own sense, so a fresh adoption could not pass and the check taught agents to rename the domain. Coherence's concepts are named only where the project writes to Coherence, and even there a word can be the domain's, so there it is reported and never refused
  crossing: project-source -> reading
  refuted: matched Coherence's rejected names in every text of an adopter, as if it were Coherence's own repository -> the via went red in check.test.ts, the adopter's prose and identifier hits enforced; restored, green (2026-09-25)
  kinds: none
- a project's claim wins inside it: A Coherence rejected name the project declares in its own lexicon, as a concept, alias, or instance, is no finding anywhere in that project, advisory or enforced.
  over: every Coherence rejected name the project's lexicon declares, against the adopter's records, where Coherence's names are still read
  via: a project's claim wins inside it: a Coherence rejected name the project declares is no finding, advisory or enforced
  because: a project claims a word through the lexicon workflow it already has, and the claim must reach every text the check still reads Coherence's names in; the claim is the existing declaration, not a parallel list, so a word is claimed exactly when the project has defined it
  crossing: project-source -> reading
  refuted: kept every Coherence rejected name in force, ignoring the names the project's lexicon declares -> the via went red in check.test.ts, the claimed word reported in the record; restored, green (2026-09-25)
  kinds: none
- the baseline only shrinks: A project's lexicon check fails only on findings outside its baseline, the findings recorded when it adopted Coherence and counted on one line; a later baseline record is intersected with the earlier ones so it can drop findings and never add one, a fixed finding stops matching at once, and Coherence's own repository keeps none.
  over: every rejected-name finding and unknown noun of an adopter's whole-project check, across a first baseline, an edit, a fix, a second baseline, and a hand-written record with more in it, and the same record in Coherence's own repository
  via: the baseline only shrinks: a fresh adoption passes once baselined, a new finding fails, a fixed one drops out, a later record never adds, and Coherence's own repository keeps none
  because: an adoption inherits findings it did not write, and a check red on arrival is skipped from then on; but an excuse that can grow is a way to stop checking. The retired growth-failure mechanisms fell because growth was not the danger; here the danger is a new finding, so the known residual is excluded from the check's named set and can only get smaller
  crossing: project-source -> reading
  refuted: let the newest baseline record replace the earlier ones instead of being intersected with them -> the via went red in check.test.ts, a hand-written record widening the baseline; restored, green (2026-09-25)
  kinds: none
- the check's unknown nouns are coverage's names: An unknown noun is a proper noun coverage's nomination reads in prose, never the tail of an acronym, a word English always capitalizes, a well-known name in its well-known spelling, a backticked identifier, or a component folder's name, and it stands only by coverage's recurrence: three prose lines, or two across two components.
  over: every prose line of the corpus, with component folder names, acronym tails, well-known names, backticked words and single-line repeats
  via: unknown nouns: Title Case away from a sentence start, on three lines or two across two components, with three closed options; a component folder's name is its spec's
  because: the check and coverage disagreed about what a name is, so two adoptions got 89 and 103 unknown nouns, the most frequent being component folders (core, scripts) counted wherever the word appeared and the tail of the project's own name; one nomination for both keeps the failing check a subset of the reading that explains it
  crossing: project-source -> reading
  refuted: dropped the acronym-tail rule from the shared nomination, so the capitalized tail of a product name was nominated -> the via went red in check.test.ts; restored, green (2026-09-25)
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
  because: the nomination is a heuristic, precision over recall, and the lexicon allows a refusal only for what the tool can prove: a rejected name, a spec problem, a structural defect; holding a subagent on a guess would teach it to strip capitalized phrases rather than declare names
  crossing: harness -> reading
  refuted: refused the subagent stop on any lexicon finding, unknown nouns included -> "an unknown noun in a changed file is advisory: Stop reports it and SubagentStop never refuses on it" went red in hook.test.ts, exit 2 where 0 was asserted; restored, green (2026-09-17)
  kinds: none
- a recorded wall makes the debt advisory: A debt the session has recorded as unable, naming the file, the rejected name, or the invariant, is reported with that record's id and does not refuse the subagent stop; another session's unable clears nothing.
  over: every rejected name, spec problem, and structural defect a subagent stop would refuse on, against every unable record of the stopping session
  via: an unable record from the session turns the debt it names advisory: SubagentStop reports it and exits 0, and another session is still refused
  because: the subagent stop is refused until the debt is paid or recorded as unable; a wall the agent cannot pass must not hold it in its loop forever, and the record names the wall for the reader who decides, which is why it counts only for the session that wrote it
  crossing: record -> reading
  refuted: refused the subagent stop with the unable record on file, reading no wall -> "an unable record from the session turns the debt it names advisory: SubagentStop reports it and exits 0, and another session is still refused" went red in hook.test.ts, exit 2 where 0 was asserted; restored, green (2026-09-17)
  kinds: none
- a git failure is not a clean tree: When git cannot list the changed files, the stop says so and that the lexicon check ran over nothing; outside a repository the answer is no files, and a failure never refuses.
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
- install keeps regenerated state out of git: Installing the hook writes .coherence/.gitignore once, so the project's git sees only the durable folders (journal, runs, work) and the project's hook voice under .coherence, never the state Coherence regenerates, and the project's own .gitignore is never edited; a .coherence/.gitignore with any other text is the adopter's and is kept, and uninstall removes the file only when it is exactly what install wrote and no agent host keeps a hook of ours.
  over: every folder Coherence writes under .coherence (journal, runs, work, hooks, feed, lexicon, models, observations, practices, run, structure, traces), in a fresh git project, across both agent hosts installed and uninstalled in turn, a fresh tree, and an ignore file of the adopter's
  via: install keeps Coherence's regenerated state out of the project's git, and uninstall removes only the ignore file it wrote
  because: a fresh adoption saw feed cursors, read traces, readings and a language model's weights as untracked files and had to guess what to ignore (df-35f4975d); Coherence's own .gitignore kept them out, but an adopter never receives that. The file sits in Coherence's own folder, so install never edits a file the adopter wrote and uninstall can remove it whole; while another host still runs our hooks the state keeps being written, so the file stays (d-e2cff03c)
  crossing: project-source -> harness
  refuted: made removeIgnore stop asking whether another agent host keeps our hooks, so uninstalling Claude Code took the ignore file while Codex still ran ours -> "install keeps Coherence's regenerated state out of the project's git, and uninstall removes only the ignore file it wrote" went red in install.test.ts on "codex still holds our hooks"; restored, green (2026-10-05)
  kinds: deploy
  checklist: graceful-drain dismissed: nothing is shut down by an install or an uninstall
  checklist: readiness-evidence dismissed: install and uninstall report what they wrote or removed and claim nothing about a running process
  checklist: declared-target-coverage dismissed: one ignore file in one folder per project, not a registry of targets
- check fails on any drift: The hook check exits non-zero, naming the event and the kind, whenever an agent host's installed hooks differ from what install would write: an event missing, an entry of ours stale in any field or shape, or an extra entry of ours; another tool's hook is never drift.
  over: every event install wires, every field and the shape of the entry install writes, and every entry of ours under any event, for both agent hosts
  via: the check names every drift from what install would write: missing, stale, and extra
  because: the check is what CI and a person run to know the gyroscope is actually delivered; one that passed a stale launcher, a dropped Codex context limit, or a duplicate entry would report delivery that is not happening, which is the reference's failure of a mechanism described rather than automatic. It compares against the one entry install writes, so the two cannot disagree
  crossing: project-source -> harness
  refuted: made the check compare only the command, so a changed timeout, a dropped Codex context limit, a shared entry, or a matcher passed as clean -> "the check names every drift from what install would write: missing, stale, and extra" went red in install.test.ts; restored, green (2026-09-23)
  kinds: none
- a hook without Coherence tells the agent how to supply it: A hook installed for an adopter, run where Coherence cannot be found or node is not on the PATH, exits 0 with no shell error on every event; at the session start it shows the user one line, and when Coherence is missing it tells the agent every way to supply it and that changing the project's dependencies is the user's decision, so the agent makes the call; every other event is silent.
  over: every event install wires, for both agent hosts, with no checkout anywhere the command looks and with a checkout but no node; and uninstall still owns the command
  via: a hook without Coherence installed tells the user once and the agent how to supply it, and is otherwise silent
  because: a teammate who opens the project without Coherence, or a session in a fresh clone, would otherwise see a stack of shell errors on every event and a SubagentStop that fails for a reason that has nothing to do with the work; a line only the user sees leaves the agent unaware, and a hook that installed Coherence itself would change the project's dependencies and lockfile mid-session without anyone deciding to; the agent knows whether the user asked for Coherence and which package manager the project uses, so it is told and decides
  crossing: project-source -> harness
  kinds: deploy
  checklist: graceful-drain dismissed: nothing is shut down; the hook exits at once without having accepted any work
  checklist: readiness-evidence dismissed: the line and the context claim only that Coherence was not found, which is what the command just observed
  checklist: declared-target-coverage declared as a hook without Coherence tells the agent how to supply it
- a located Coherence answers as a direct command does: An adopter's hook finds Coherence outside the project ($COHERENCE_HOME, a sibling checkout, the sibling of a worktree's main checkout, then the project's own bin) and, once found, answers and refuses exactly as a direct command would; the committed command names no path on one machine and never touches the project's node_modules or lockfile.
  over: both agent hosts, the start injection and a refused subagent stop, and each place the command looks
  via: a located Coherence answers, and refuses, as a direct command does
  because: an npm link into a pnpm project installed a second dependency tree over the locked one and broke its production build, and a command naming one person's absolute path breaks for every teammate; locating a checkout outside the project keeps the project's packages its own, and answering as the direct command does keeps the refusal at SubagentStop, the one refusal the lifecycle has
  crossing: project-source -> harness
  refuted: ran the located Coherence under an EXIT trap that exits 0, so its exit status was swallowed -> "a located Coherence answers, and refuses, as a direct command does" went red in install.test.ts; restored, green (2026-09-25)
  kinds: deploy
  checklist: graceful-drain dismissed: the located command runs the same process a direct one would, with nothing of its own to drain
  checklist: readiness-evidence dismissed: the command runs what it found; it makes no claim about a running process
  checklist: declared-target-coverage declared as a located Coherence answers as a direct command does
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
- feed carries two kinds: The feed's peer lines inject a peer's decisions and a peer's escalations, and no other verb; a stopped subagent's return is the one block that lists every kind its subagent recorded.
  over: every record kind a peer can write, at every boundary event
  via: the peer feed injects a peer's decisions and escalations and no other kind
  because: the lexicon names decision subjects, and an escalation heads every read: a question standing before a human changes what a peer should do next, so a session that met one only at its own start would act past it for a whole cycle. Every other verb is the journal, one command away, and injecting all eleven at every tool use spends the session's budget on what nobody asked for
  crossing: record -> reading
  refuted: injected the subject of every record kind, so a peer's conjecture, defect, unable, retraction and resolution rode into the context too -> "the peer feed injects a peer's decisions and escalations and no other kind" went red in hook.test.ts, seven records where two were asserted; restored, green (2026-09-18)
  kinds: output
  checklist: destination-confinement dismissed: one destination, the host's additionalContext, and no redirect
  checklist: redaction declared as feed injects subjects only
  checklist: commit-ordered-effects declared as cursor advances after the print
  checklist: circuit-breaker-policy dismissed: the feed reads local files; no dependency is sampled
  checklist: declared-target-coverage dismissed: one host reads the injection, not a registry of targets
- another agent under the session is a peer: For the main thread, a record of its own session written under another agent's name is a peer's, so a subagent that wrote under its coordinator's session id still reaches the coordinator's feed; the main thread's own records never do, and a subagent's reader keeps the session rule.
  over: the coordinator's feed with records of its own session under its own name and under another agent's name
  via: the main thread's feed counts a record of its own session under another agent's name as a peer's
  because: subagents in one coordinated session wrote their decisions under the coordinator's session id, as the prompt that spawned them said to, and the feed filtered every one out as the coordinator's own; the coordinator saw them only because each subagent's report happened to list them
  crossing: record -> reading
  kinds: none
- a stopped subagent returns what it recorded: When a subagent's stop goes through, every record it made (under its own session, or under its coordinator's session and another agent's name since it began) is listed, whole list, uncapped, at the coordinator's next prompt or tool boundary, once: the block leaves only after it reached the host, and the peer lines that follow never repeat a record it showed.
  over: a subagent that recorded more decisions than the feed's cap, a conjecture, and a record under its coordinator's session, stopping, then the coordinator's boundaries before and after a print
  via: a subagent that stops returns every record it made to its coordinator's next boundary, once, uncapped
  because: a coordinator that spawns subagents answers for what they decided, and a subagent's report is prose that can leave a decision out; the return is the journal's own account of what the subagent recorded, put before the coordinator whether or not the report named it
  crossing: record -> reading
  kinds: output
  checklist: destination-confinement dismissed: one destination, the coordinator's additionalContext, and no redirect
  checklist: redaction dismissed: subjects only, as the feed, never a full record
  checklist: commit-ordered-effects declared as a stopped subagent returns what it recorded
  checklist: circuit-breaker-policy dismissed: the return reads local files; no dependency is sampled
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
- well-known names need no definition: A well-known name (the curated list, the config's wellKnown, the project's own name) and a name the lexicon already declares or lists under not: is never a candidate, while a common word written as a project's proper noun, or a capitalized-only well-known word used lowercase in a project sense, still is.
  over: every candidate the corpus nominates, against the shipped list, the config, the project's name, every concept, alias, instance, property and not: entry of both layers
  via: well-known names, the project's own name and the lexicon's not: names are never candidates, while a common word written as a project's proper noun still is
  because: Python, Pyright, Chrome and the project's own name carried the old list's top and no definition could make them less ambiguous; but the fear of ambiguity lives exactly where a common word takes a project sense (Mnemion's hive; Coherence's scope, core, run, session), so the skip must never reach those
  crossing: project-source -> reading
  refuted: dropped the well-known check from nomination, so Kubernetes, Postgres, the config's Zanzibar and the project's own name were offered as candidates -> "well-known names, the project's own name and the lexicon's not: names are never candidates, while a common word written as a project's proper noun still is" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
  kinds: none
- the retired lexicon file is refused with its migration: A project whose lexicon file or config key still carries the concept's retired name fails every command that loads it, with the one-line migration; the retired name is never read as a fallback, and Coherence's lexicon supplies the retired name as data.
  over: every retired single-word name Coherence's lexicon records for the lexicon concept, as a root file with no lexicon.json and as a coherence.config.json key
  via: a project carrying its lexicon under the retired name is refused with the one-line migration, and the old name is never read
  because: the owner ruled the rename once, everywhere (d-cb376a86); an adopter left on the old file name would otherwise read no domain lexicon at all and pass every check silently, and a fallback that kept reading the old name would leave two names for one file standing forever
  crossing: project-source -> reading
  refuted: dropped the retired-file refusal from projectLexiconPath, so a project on the old file name read no domain lexicon -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- rulings recorded under the retired verb still count: A sense review or an applied proposal recorded before the rename, under the retired verb, keeps its ruling and still counts as applied; the verb is matched by the ruling's shape, not by name.
  over: every structured review and apply decision in the journal, whichever verb it was written under
  via: rulings recorded under the retired verb still count: the journal is read as written
  because: the journal is append-only, so the records written before the rename cannot be edited to the new verb; a reader that matched only the new verb would silently reopen every settled sense and let an applied proposal be applied twice
  crossing: record -> reading
  refuted: matched sense reviews by the new verb's name only in lexicon-coverage.ts, so a review recorded under the retired verb lost its ruling -> the totality oracle went red; restored, green (2026-09-23)
  kinds: none
- sense review only where meaning is at risk: A known word's use asks a sense review only when its meaning is at risk: the name has more than one recorded sense, a name rejected for that concept sits on or beside the line, or a Coherence concept is declared in an adopter's code; an ordinary use of a defined word asks nothing.
  over: every context of every known term, across prose, code and records, in a project with its own lexicon and in Coherence itself
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
  refuted: put the old Lexicon coverage totals line back at the head of orient's vocabulary signal -> "no hook injection carries a total: orient names the ranked terms or says nothing" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
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
- lexicon setup reads only the paths it is given: lexicon coverage and lexicon draft given folders or files, each relative to the project root or absolute inside it, observe uses and nominate candidates only from the project's files under those paths, with the config's ignore list and the project-file rules still applied, and say which paths they read; a path outside the root or one that does not exist is refused, and with no paths the whole project is read as before.
  over: a coverage and a draft with no paths, with a relative folder, with an absolute folder inside the root, with a folder holding an ignored subfolder, and with a path outside the root, a parent path and a missing path
  via: coverage and draft read only under the paths they are given: candidates come from those files alone, the ignore list still holds, and a path outside the root or one that does not exist is refused
  because: onboarding's lexicon step read the whole tree, so an adopter who wanted the vocabulary of one subsystem (src/billing, docs) got every other folder's names as candidates beside it; a path the reading cannot honor is refused rather than read as nothing, so an empty draft never stands for a folder that was never read
  crossing: project-source -> reading
  refuted: made lexiconCoverage read every corpus file whatever paths it is given, dropping the underPaths filter on the files it reads -> "coverage and draft read only under the paths they are given: candidates come from those files alone, the ignore list still holds, and a path outside the root or one that does not exist is refused" went red in vocabulary-signal.test.ts on its own assertion; restored byte for byte, green (2026-10-07)
  kinds: read
  checklist: scoped-reads declared as lexicon setup reads only the paths it is given
  checklist: redaction dismissed: narrowing the paths prints nothing the whole-tree reading would not, and a use's secret value is redacted as it is there
- function words are never candidates: A preposition, conjunction, determiner, pronoun, auxiliary, particle or contraction fragment of English is never a vocabulary candidate, however prose writes it (backticked, as a heading word, or capitalized mid-sentence), and the stoplist holds every one of those closed classes.
  over: every word of every closed class in FUNCTION_WORDS and an independently written core of each, each written three ways on lines in every component
  via: function words are never candidates: every preposition, conjunction, determiner, pronoun and auxiliary is refused however prose writes it
  because: "via" surfaced as the third recurring undefined term on this repository, from every spec's via: line; a word that carries grammar has no sense a project could define, so offering it spends the reader's attention on a list it learns to skip
  crossing: project-source -> reading
  refuted: dropped the function-word refusal from nominate in lexicon-coverage.ts, so a function word written capitalized mid-sentence was nominated as a proper noun -> "function words are never candidates: every preposition, conjunction, determiner, pronoun and auxiliary is refused however prose writes it" went red in vocabulary-signal.test.ts; restored, green (2026-09-23)
  kinds: none
- orient names spec gaps: Orient names the spec gaps, entrances carrying outside or unknown trust in with no traced control, in one line under the spec block, from the recorded Structure reading while it still describes the tree; when it is stale or absent, a session start starts one reading in the background; when no reading was ever kept, orient says only that the gaps are not read yet and which command reads them, never a count; it counts the gaps the adoption baseline holds as still open, without naming them.
  over: no reading, a fresh reading, a stale one, and a baselined one, at SessionStart
  via: orient names the spec gaps in one bounded line from a recorded reading that still describes the tree, starts one background reading when it is stale or absent, says only that the gaps are not read yet when no reading was ever kept, and counts, without naming, the gaps the adoption baseline holds
  because: both outside adoptions left their route gaps open because nothing in the session's loop showed them (d-a1095ef2); with no reading nothing was traced, so a count would be a guess, but silence hid the gaps from every session that started before one was kept (df-84db9e4f); the owner ruled on 2026-09-28 that gaps baselined at adoption stay counted as open, because an A/B adoption baselined both its gaps on day one and orient then never mentioned them again
  crossing: project-source -> reading
  refuted: made orient silent again when every gap is held by the adoption baseline, in orientGapText -> the totality oracle went red; restored, green (2026-09-28)
  kinds: none
- orient names the last reading's gaps when it is stale: When the recorded Structure reading no longer describes the tree, orient names the gaps as that reading had them, derived with the current spec and runs, labeled as the reading before the latest changes with when it was taken, and never a gap the current spec visibly closes: an entrance that now declares guard: or control: none, carries trusted work in, or is no longer declared; the injection holds its budget.
  over: a reading made stale by a source edit, then a control: none, a guard:, a trusted trust: and a removed entrance in the current spec, and all of them closed, at SessionStart
  via: orient names the gaps as the last reading had them when it no longer describes the tree, labeled as the reading before the latest changes, with the current trust, and never one the current spec visibly closes by guard:, control: none or removing the entrance, within the start budget
  because: an adopting session ends by committing spec changes, so the next session always started on a stale reading and orient said nothing; the line never reached an agent in the A/B test (df-84db9e4f). The reading's component interfaces change slowly and the spec is read now, so the last reading with the current spec names what is still open, and a gap the spec answers is never named
  crossing: project-source -> reading
  kinds: none
- a session's stop refreshes the structure reading: At a session's Stop, when the recorded Structure reading no longer describes the tree, one reading of the tree the session leaves is started in the background and never waited on, even when nothing is left uncommitted; a SubagentStop starts none.
  over: a fresh reading at Stop, a committed spec change at SubagentStop, then at Stop
  via: the session's stop starts one background reading of the tree it leaves when the recorded one no longer describes it, and returns without waiting; a subagent stop starts none
  because: the tree a session leaves is the tree the next one starts on, so reading it at the stop gives the next session a fresh reading whenever it starts a reading's length later (df-84db9e4f); a subagent stops while its session still edits, and each of its stops would supersede the last one's reading
  crossing: project-source -> reading
  kinds: none
- a spec gap never refuses a stop: Regulate names the spec gaps a session touched, the handler files it changed and the untrusted entrances it declared with neither guard: nor control: none, and never refuses a stop for them.
  over: a session that changed nothing, one that changed a handler file of two gaps and declared an untrusted entrance, at Stop and at SubagentStop
  via: regulate names the gaps a session touched, a changed handler file and an untrusted entrance it declared, and never refuses a subagent stop for them
  because: a refusal is spent only on what the tool can prove is owed; no traced control is not a demonstrated bypass (d-127ab8e4), so a gap is named for the session that touched it and left to it and to the human
  crossing: project-source -> reading
  refuted: counted a touched spec gap as owed, so SubagentStop refused with exit 2 -> the totality oracle went red; restored, green (2026-09-25)
  kinds: none
- orient names undeclared entrances: Orient names the detected entrances no spec declares in one line beneath the spec gaps, detected now from the tree and the current spec, with no Structure reading and whether or not any entrance could be a gap: the count against what is detected, the folder holding the most with their rules, and the scaffold entrances command that proposes their bullets; never a list, and nothing when every detected entrance is declared.
  over: a project whose declared entrance carries an inside level and that never kept a reading, the same after one more entrance is declared, one with 400 undeclared server functions in one folder, and one with none undeclared
  via: orient names the undeclared entrances in one bounded line: the count against what is detected now, the folder holding the most, and the scaffold command that proposes their bullets, with no reading and no gap needed
  because: c-9941b95e: the replicated A/B adoption test (12 adoptions) showed the gap treatment closing gaps, while entrance coverage on praetorium.gg stayed at 11 to 14 percent in both arms, about 100 server functions and routes never declared, and no session transcript mentions an undeclared entrance; the only nudge was a passive count that named the first three by file order and rode on the recorded reading. No adoption baseline: the line is one bounded line whatever the count, and a baseline taken on day one would silence exactly the surface that stayed undeclared (as the owner ruled for baselined gaps on 2026-09-28)
  crossing: project-source -> reading
  refuted: made orient's entrance coverage line ride on the spec gaps again, silent when no entrance could be a gap, in gapBlock -> the totality oracle went red; restored, green (2026-09-28)
  kinds: none
- an undeclared entrance never refuses a stop: Regulate names the detected entrances no spec declares in the files the session changed, by file with three names at most and the scaffold entrances command for them, and never refuses a stop for them.
  over: a session that changed nothing, and one that added a server function to a file holding four undeclared, at Stop and at SubagentStop
  via: regulate names the undeclared entrances in the files a session changed, by file, and never refuses a subagent stop for them
  because: the session that writes an entrance holds what it means and who calls it, so its stop is when declaring it is cheapest, the in-loop nudge the gaps got (d-a1095ef2); detection is a scan and some of what it finds is no entrance, so an undeclared one is not proven owed and is left advisory
  crossing: project-source -> reading
  refuted: counted an undeclared entrance in a changed file as owed, so SubagentStop refused with exit 2 -> the totality oracle went red; restored, green (2026-09-28)
  kinds: none
- the project's hook voice composes over what each event says: A project's .coherence/hooks/<Event>.override.md replaces what that event would say and an empty one silences it, its <Event>.append.md follows the canonical text or the override, and an event with nothing of its own to say still speaks a declared file; no override reaches a refusal's reason, which an append only follows.
  over: every hook event, with nothing declared, an append, an override, both, an empty override, an override in place of the peer feed, and an override and an append on a refused subagent stop
  via: a project's hook voice composes over what each event says: an override replaces it, an empty one silences it, an append follows it, an event with nothing to say speaks a declared file, and a refusal keeps its reason
  because: text only one project can say (a house rule, a build hazard, how that project wants a session to start) belongs in the project's own files, not in the canonical text every adopter receives (d-d884e343, in the reference); the reference let a project shape each event this way and the rebuild dropped it without a record. A refusal is enforcement, so a project may speak after it but never replace or silence it, and a feed the override replaced never reached the host, so its cursor stays
  crossing: project-source -> reading
  refuted: made composeVoice ignore the override, so the canonical text was always the base -> the totality oracle went red in hook.test.ts; restored, green (2026-09-28)
  kinds: output
  checklist: destination-confinement dismissed: the text goes to one destination, the host's additionalContext, systemMessage or stderr, and follows no redirect
  checklist: redaction dismissed: the project's own text is shown as the project wrote it; nothing in it is designated sensitive
  checklist: commit-ordered-effects declared as cursor advances after the print
  checklist: circuit-breaker-policy dismissed: two local files are read; no dependency is sampled
  checklist: declared-target-coverage dismissed: one file of each kind per event, not a registry of targets
- a hook voice file stays inside the root: A hook voice file is read only where its real path lies inside the project root; a file, or a folder above it, that links outside is named as not read and never followed, an unreadable one is named, and in both cases the event's canonical text stands.
  over: a file linked outside the root, the hooks folder linked outside it, a link that stays inside it, and a folder where the file should be, at SessionStart
  via: a hook voice file whose real path leaves the project root is named as not read and never followed
  because: the hook reads these files inside every session from the tree it was installed for, and a link can point anywhere; a hook that followed one would inject a neighbouring tree's text, or a secret, as the project's own words. A torn file costs the project its text for that event, never the session, and the line saying so keeps the loss from being silent
  crossing: project-source -> reading
  refuted: dropped the within check in voiceFile, so a file whose real path left the project root was read -> the totality oracle went red in hook.test.ts; restored, green (2026-09-28)
  kinds: read
  checklist: scoped-reads declared as a hook voice file stays inside the root
  checklist: redaction dismissed: a file that is not read is named by its path under the root alone, never its target or contents
- a fired practice is delivered before the act: When the tool use about to run fires a practice's trigger, PreToolUse delivers the practice whole on its first firing at that version in the session and one line after, and never blocks the tool.
  over: a command that fires a practice, the same command again, another session, and a command that fires nothing
  via: PreToolUse delivers a fired practice whole once per version per session, then one line, and never blocks
  because: the steps that slip come first (count the stores before a merge, measure the budget before applying), so delivery after the act is too late; whole once and one line after keeps the injection affordable; a refusal would train a session to route around the practice
  crossing: project-source -> reading
  refuted: made practiceContext forget earlier firings, so every firing delivered the practice whole -> "PreToolUse delivers a fired practice whole once per version per session, then one line, and never blocks" went red in practice.test.ts on its own assertion; restored byte for byte, green (2026-10-05)
  kinds: output
  checklist: destination-confinement dismissed: the practice goes to one destination, the host's additionalContext
  checklist: redaction dismissed: a practice is the project's own method, shown whole by design
  checklist: commit-ordered-effects declared as cursor advances after the print
  checklist: circuit-breaker-policy dismissed: practice files are read locally; no dependency is sampled
  checklist: declared-target-coverage dismissed: one host reads the delivery, not a registry of targets
- a fired practice not enacted is owed: Regulate names each practice that fired in the session with no enactment since, with the command that records it, and never refuses a stop for it.
  over: a subagent stop after a firing, and a stop after the enactment
  via: regulate names a practice that fired with no enactment since, advisory, and never refuses a subagent stop for it
  because: advisory for the reason d-f780c7b9 gives for open requirements: refusing the stop would train a session to fabricate an enactment; naming it at the stop with the shape filled in makes the honest record the cheapest one
  refuted: made practiceStopText treat every firing as enacted, so regulate named nothing owed -> "regulate names a practice that fired with no enactment since, advisory, and never refuses a subagent stop for it" went red in practice.test.ts on its own assertion; restored byte for byte, green (2026-10-05)
  kinds: none
- a shell command's writes are read from its words: The files a shell command writes are read from its text before it runs: output redirects, heredoc targets, tee, sed -i and perl -i, the destinations of cp, mv, install and ln (under -t or --target-directory, each source's name inside that folder), the sources mv removes, and touch, truncate and rm, through a cd or pushd earlier in the line, a popd back, and a subshell whose cd stays inside it, with CRLF lines read as LF; quoting is kept per word, so a quoted path with brackets or parens is a path while an unquoted glob, variable or substitution is not; a quoted > or <<, a here-string, a heredoc's body, a variable, a substitution, a glob and a device name none.
  over: redirects of every form, heredocs with a redirect inside their body, a heredoc onto a quoted route path with brackets and parens, a here-string before a later write, a quoted <<, CRLF lines with a heredoc, tee, sed -i in GNU and BSD form, perl -pi, cp and mv, mv sources, cp -t, mv --target-directory= and install -m -t, touch and rm, a cd to a folder and to a variable and a cd after that, a cd inside a subshell, pushd and popd, a quoted >, a variable inside double quotes, a program writing from its own code, and a Codex shell argv
  via: a shell command's written files are read from its words: redirects, heredocs, tee, sed -i, perl -i, cp and mv destinations and mv sources, -t target folders, touch and rm, through cd, pushd and subshells, quoted brackets and CRLF, and never a quoted > or <<, a here-string, a heredoc body, a variable or a device
  because: agents write files through the shell as often as through edit tools, and the ai-chatbot adoption wrote its entry spec with cat > ... <<EOF; a reading that missed it would leave an edit-triggered practice silent and the chokepoint check at the edit unrun, while a guessed path would fire them on files nobody wrote
  refuted: dropped the folder restore at a subshell's ), so a cd inside ( ... ) leaked out of it -> "a shell command's written files are read from its words: redirects, heredocs, tee, sed -i, perl -i, cp and mv destinations and mv sources, -t target folders, touch and rm, through cd, pushd and subshells, quoted brackets and CRLF, and never a quoted > or <<, a here-string, a heredoc body, a variable or a device" went red in shell-writes.test.ts on its own assertion (sub/b.txt for b.txt); restored byte for byte, green batched and alone (2026-10-06)
  kinds: none
- a shell write is an edit: writtenFiles counts the files a shell command writes beside an edit tool's, resolved against the folder the command runs in and confined to the project root, so edit triggers and the chokepoint check at the edit see them.
  over: a heredoc onto a spec, a write from a subfolder, a write above the root, a command that writes nothing, and a reading tool
  via: writtenFiles counts a shell command's writes beside an edit tool's, resolved against the folder the command runs in and confined to the project
  because: one reader of written files serves both the practice triggers and revelation at the edit; resolving against the root instead of the command's folder would name the wrong file, and a path above the root is another project's
  crossing: harness -> reading
  refuted: resolved shell-written paths against the root instead of the folder the command runs in -> "writtenFiles counts a shell command's writes beside an edit tool's, resolved against the folder the command runs in and confined to the project" went red in shell-writes.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-06)
  kinds: none

- a turn's instrument is warmed before its stop: A session start and every prompt start warming the instrument in the background and never wait for it; no other event does in a project at the folder holding the hooks (a nested project's first tool use is the other, under entering a nested project warms its instrument).
  over: SessionStart, UserPromptSubmit, PreToolUse and PostToolUse
  via: a session start and every prompt warm the instrument without waiting for it, and no other event does
  because: the stop regulates with the economy prediction, which needs the warm server; it idles out after five minutes, and every turn begins with a prompt, so warming there makes the stop find it loaded without the hook ever waiting on it
  refuted: stopped warming the instrument at a prompt -> "a session start and every prompt warm the instrument without waiting for it, and no other event does" went red in hook-speed.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-06)
  kinds: none
- regulate reports the prediction: A stop names the files the prediction found beyond what the session wrote and which of them it never read, advisory; nothing when the prediction found none.
  over: a prediction with read and unread files beyond the session's own, one with none, and no snapshot
  via: regulate names the files the prediction found beyond what the session wrote, and which of them it never read
  because: owner: the stop must regulate behaviour, not be skipped for speed; the prediction is computed at every stop, and a session that changed a file without reading what relies on it should hear so before it ends
  refuted: counted every predicted file as unread, whatever the session read -> "regulate names the files the prediction found beyond what the session wrote, and which of them it never read" went red in hook-speed.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-06)
  kinds: none
- practice delivery reads the practices light: PreToolUse reads no practice for a tool use that runs no command and writes nothing, and otherwise reads only the practice files git lists, each beside its spec and outside every ignored folder, which are the same practices the spec model holds.
  over: a paired practice, one beside no spec, one in an ignored folder, against the spec model's practices
  via: practice delivery reads the same practices as the spec model, through git's listing of practice files alone
  because: PreToolUse runs before every command and edit (every tool under Codex), and loading the whole spec model there cost about 0.34 s on this repository and 0.7 s on a 40,000-file one (df-f1b7e11a); delivery needs triggers, steps and versions, and the spec check is what holds the pairing
  refuted: dropped the pairing check from practice delivery -> "practice delivery reads the same practices as the spec model, through git's listing of practice files alone" went red in hook-speed.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-06)
  kinds: none
- a tool call's hooks spawn git a fixed number of times: PreToolUse and PostToolUse spawn git as often over a project of many components and practices as over a project of one.
  over: a command that fires a practice in each of one component and of six, at PreToolUse and at PostToolUse
  via: a tool call's hooks spawn git a fixed number of times, whatever the number of components and practices
  because: these two hooks run around every tool call, thousands a day, so a spawn per component or per practice there is paid on every one of them (df-f1b7e11a); a count of spawns holds under any load, where a timing alarm would flake
  refuted: asked git whether each practice's spec is tracked, one spawn per practice file -> "a tool call's hooks spawn git a fixed number of times, whatever the number of components and practices" went red in hook-speed.test.ts on its own assertion (PreToolUse 2 spawns against 7); restored byte for byte, green batched and alone (2026-10-07)
  kinds: budget
  checklist: bounded-admission dismissed: nothing is admitted; the bound is a count of child processes per hook
  checklist: execution-budget declared as a tool call's hooks spawn git a fixed number of times
  checklist: memory-budget dismissed: the bound is on spawned processes, not on allocation
  checklist: circuit-breaker-policy dismissed: no dependency failures are observed
  checklist: fair-admission dismissed: there are no contenders for the budget
  checklist: rate-budget dismissed: nothing is counted against a time window
- an edit never stays silent about a check it could not make: When a chokepoint invariant an edit may touch could not be checked, the edit names it with the reason; only a value the spec writes as prose, which spec --check already reports, goes unnamed there.
  over: a touched invariant whose protected thing resolves to nothing, and one whose value is prose
  via: an edit says which chokepoint invariants it could not check, and stays silent only for a value the spec writes as prose
  because: a not-run verdict read as a clean edit: on a fresh server every check at the edit came back not run and nothing was said, so the alarm that should have fired on a bypass was quiet; a silent alarm is a vacuous check
  refuted: said nothing for a check the edit could not make -> "an edit says which chokepoint invariants it could not check, and stays silent only for a value the spec writes as prose" went red in hook-speed.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-06)
  kinds: none
- a tool hook over the latency budget says so: Every hook call's time is kept, counted from its process's start; a PreToolUse or PostToolUse over the latency budget (3 s unless the config declares one) names its own time in its own answer, regulate names the session's calls over it with what the tool hooks cost in all, and orient the last week's.
  over: a tool hook within the budget, one over it, a session and a week of recorded calls, and a config's own budget
  via: a tool hook over the latency budget says so in its own answer, and regulate and orient name the calls over it
  because: the tool hooks run around every tool call, so their time is paid over and over, and a call cycle that feels sluggish gets Coherence switched off, which loses every check at once; a count of git spawns guards the known shape, and the measured time catches what no count names
  refuted: counted a hook call's time from the call's own start, leaving out its process's start -> "a tool hook over the latency budget says so in its own answer, and regulate and orient name the calls over it" went red in stop-delivery.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: budget
  checklist: execution-budget declared as a tool call's hooks spawn git a fixed number of times
  checklist: bounded-admission dismissed: nothing is admitted; the bound is on one hook call's time
  checklist: fair-admission dismissed: there are no contenders for the budget
  checklist: rate-budget dismissed: nothing is counted against a time window
  checklist: memory-budget dismissed: the bound is on time, not on allocation
  checklist: circuit-breaker-policy dismissed: a hook over the budget still answers; the alarm is the response
- a stop reaches the agent: A main-thread stop says each line once per session; a line naming a practice owed blocks the stop once, so the agent reads the reason, and anything else is shown to the user and carried into the next prompt's context.
  over: a stop with a practice owed, the stop the block causes, a stop with only advisory lines, the prompt after it, and a stop with nothing new
  via: a stop says each line once, blocks once for a practice owed, and carries the rest into the next prompt
  because: the host shows a stop hook's systemMessage to the user and never to the model, so regulate at a main-thread stop reached the one reader who could not act on it in the moment; repeating every line at every stop made it 2.6 KB of what had been said before
  refuted: held back only a stop the block itself caused, so a practice owed never reached the agent -> "a stop says each line once, blocks once for a practice owed, and carries the rest into the next prompt" went red in stop-delivery.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- a practice fires where its command runs: A command trigger matches whole words of one simple command, never text inside a quoted argument or a heredoc's body; a command a cd took into another project is read against that project's practices, and its enactment is looked for in that project's journal; a command a cd took out of every project fires nothing, and no folder that is not a project is read for practices.
  over: a trigger word as a command, inside a quoted argument, inside a heredoc, after a cd into another checkout with its enactment recorded there, and after a cd into a folder that is no Coherence project
  via: a practice fires on a command's own words, in the project the command runs in, and its enactment counts there
  because: a practice fired on enact --trigger "command refute" and on the words of a heredoc, and a session whose commands ran in a second worktree was told at every stop that practices it had enacted there were owed, because the firing was kept by the session's root and the enactment by the worktree's journal
  refuted: read every command against the session's own root, wherever a cd took it -> "a practice fires on a command's own words, in the project the command runs in, and its enactment counts there" went red in stop-delivery.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  refuted: read a folder a cd landed in for practices whether or not it is a Coherence project -> "a practice fires on a command's own words, in the project the command runs in, and its enactment counts there" went red in stop-delivery.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- the coverage reading runs only when the text can have moved: A tool hook reads the vocabulary's coverage only after a tool use that wrote a project file, and a prompt only when git's changed and untracked files, with their sizes and times, differ from the session's last reading; the stop always reads in full.
  over: a read, a command that writes nothing, a write, two prompts over one tree, and a prompt after a file was added
  via: the vocabulary coverage reading runs at a tool hook only after a write, and at a prompt only when the tree moved
  because: the reading walks the whole corpus, 2.2 to 2.4 s on this repository, and it ran at every PostToolUse and every prompt, so each tool call cost about 3 s in hooks against a 3 s latency budget, the sluggishness that gets Coherence switched off; the hook latency alarm found it on its first day
  refuted: read the whole corpus at every PostToolUse again, write or none -> "the vocabulary coverage reading runs at a tool hook only after a write, and at a prompt only when the tree moved" went red in hook-speed.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: budget
  checklist: execution-budget declared as the coverage reading runs only when the text can have moved
  checklist: bounded-admission dismissed: nothing is admitted; the bound is on how often one reading runs
  checklist: fair-admission dismissed: there are no contenders for the budget
  checklist: rate-budget dismissed: nothing is counted against a time window
  checklist: memory-budget dismissed: the bound is on time, not on allocation
  checklist: circuit-breaker-policy dismissed: a skipped reading is caught by the stop's full one
- a hook at the repository top answers for the nested project: With the host's settings at a repository's top and the only coherence.config.json in a folder below it, every hook event belongs to the project folder nearest to what it is about, the files a tool writes or else the event's cwd, and an event whose cwd is above exactly one project belongs to that one once the session has entered it; orient, practices, the checks and every record are that project's, and nothing is written at the top.
  over: a session start, an edit and a command, each with the session at the repository top of a repository holding one nested project and another team's spec and practice
  via: a hook at the repository top answers for the one project nested below it, from the event's cwd or the file it writes
  because: a monorepo adopts Coherence one folder at a time, and the host runs at the repository root, where its settings live; the hook took the folder holding the settings as the project, so orient counted another team's specs, their practices fired, the language server started on the whole repository (19.8 s for one edit on a fixture, past 180 s for a session start on PostHog), and .coherence was written at the top (df-0b68c987, df-7dd85e50, df-7fba7918)
  refuted: hookProject answered an event whose cwd is above the one nested project with the installation's own folder instead of that project -> "a hook at the repository top answers for the one project nested below it, from the event's cwd or the file it writes" went red in monorepo.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- an event outside every project is ignored: A tool event whose files, or whose cwd, lie outside every project nested below the hook's installation, and any event whose cwd does, answers nothing and writes nothing, before any spec model, corpus walk or language server; with a project at the installation's own root, every event is that project's as before.
  over: an edit and a write to another team's file with the session at the top, and a command, a shell write, a prompt and a stop with the cwd in another team's folder
  via: an event outside every project is ignored: no answer, nothing written, wherever the session started
  because: the rest of the repository is not the project's, and the hooks run around every tool call of every session in it; an event that is not the project's must cost one listing of where the projects are and nothing more, or adopting one folder slows every other team's work
  refuted: hookProject answered a tool event whose files lie outside every nested project with the installation's own folder instead of ignoring it -> "an event outside every project is ignored: no answer, nothing written, wherever the session started" went red in monorepo.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: budget
  checklist: execution-budget declared as an event outside every project is ignored
  checklist: bounded-admission dismissed: nothing is admitted; the bound is on one hook call's work
  checklist: fair-admission dismissed: there are no contenders for the budget
  checklist: rate-budget dismissed: nothing is counted against a time window
  checklist: memory-budget dismissed: the bound is on what is read, not on allocation
  checklist: circuit-breaker-policy dismissed: an ignored event has no dependency to fail
- git paths are relative to the project root: Every file list Coherence asks git for in a project nested below the repository top, the stop's changed files, the economy's patch and query observed's changes, names the project's files relative to the project root and none of another folder's.
  over: a changed and an untracked file in the nested project, and a changed and an untracked file in another folder of the repository
  via: git paths in a nested project are relative to its root and never another folder's
  because: git diff --name-only names paths from the repository top while git ls-files names them from the cwd, so a nested project's stop read the whole repository's changes under the wrong prefix (df-f14bc626)
  refuted: changedFiles asked for the diff without --relative, so its paths were named from the repository top -> "git paths in a nested project are relative to its root and never another folder's" went red in monorepo.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- a command at the repository top acts on the nested project: A command run at a repository's top, where no project encloses the cwd, acts on the one project nested below it, so the enact, decide and defect lines the hooks print are recorded in that project's journal; with no project below, or more than one, it acts where it stands, as before.
  over: the repository top with one nested project, a folder holding none, and a folder above two
  via: a command run at the repository top acts on the one project nested below it, and on the top when two are
  because: the hooks print commands the agent runs from the session's cwd, which in a monorepo is the repository top, and the walk up from there found no project and wrote a second .coherence at the top (df-4539bb14)
  refuted: projectRoot acted where the command stood when no project enclosed it, never on the one project below -> "a command run at the repository top acts on the one project nested below it, and on the top when two are" went red in monorepo.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- install from a nested project reaches where the host reads: hooks install run in a project nested below its repository's top writes the host's settings at the top, where a host launched at the repository root reads them, and in the project, where a session started there reads them, with the adopter's other settings kept in both and .coherence/.gitignore in the project alone; hooks --check and uninstall cover both.
  over: an install, a check and an uninstall run in a nested project whose repository top already holds the adopter's own settings
  via: hooks install from a nested project writes the host settings at the repository top and in the project, and its ignore file in the project alone
  because: install wrote the settings in the nested folder, where Claude Code launched at the repository root never reads them (it reads only the session's primary working directory's .claude/settings.json), so the hooks never fired in the usual monorepo session (df-7e5a7645)
  refuted: settingsRoots named the project folder alone, so install wrote no settings at the repository top -> "hooks install from a nested project writes the host settings at the repository top and in the project, and its ignore file in the project alone" went red in monorepo.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- orient waits for the project: A session whose hooks sit at a repository's top above a nested project hears one line at its start naming the project and nothing at a prompt, a stop, or a tool use outside it; the first tool use inside the project carries the project's orient, once per session, and every event after it is the project's; with the project at the folder holding the settings, orient arrives at the start as before.
  over: a start, a prompt, an edit and a command in another team's folder, and a stop, then two edits and a command at the top once inside, with the session at the repository top
  via: a session at the repository top gets orient once, at its first tool use inside the project, and nothing for work elsewhere
  because: hooks at a repository's top reach every engineer's sessions, and orient costs about 2k tokens and a second or more at every start; a session that only works on another product must hear nothing and pay one listing per event, and one that enters the project must get its vocabulary and standing at that moment (on PostHog the first in-project tool hook carrying orient took 1.4 s against the 3 s latency budget, d-6cdf018d)
  refuted: an event above the nested project answered as the project's whether or not the session had entered it -> "a session at the repository top gets orient once, at its first tool use inside the project, and nothing for work elsewhere" went red in monorepo.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: budget
  checklist: execution-budget declared as orient waits for the project
  checklist: bounded-admission dismissed: nothing is admitted; the bound is on what one hook call reads and says
  checklist: fair-admission dismissed: there are no contenders for the budget
  checklist: rate-budget dismissed: nothing is counted against a time window
  checklist: memory-budget dismissed: the bound is on time and words, not on allocation
  checklist: circuit-breaker-policy dismissed: an unoriented event has no dependency to fail
- a personal install stays out of the committed settings: hooks install --local writes the host's personal settings at the repository top (Claude Code's .claude/settings.local.json, which it reads launched there or in any folder below), never the committed ones and never the project folder's, with .coherence/.gitignore in the project as before; hooks --check --local compares it, uninstall removes ours from it as from the shared settings, and a host with no personal settings file is refused.
  over: an install, a check and an uninstall with --local from a nested project, and an install with --local for a host that has none
  via: hooks install --local writes the host's personal settings at the repository top alone, and uninstall removes them
  because: in a monorepo the committed settings at the top reach every team's sessions, so one engineer adopting a folder must be able to wire the hooks for themselves without committing hook configuration for everyone
  refuted: settingsFile named the shared settings for --local, so the personal install wrote the committed file -> "hooks install --local writes the host's personal settings at the repository top alone, and uninstall removes them" went red in monorepo.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- a registry routes events by its list: With a registry at the repository top, an event belongs to the listed leaf holding the file it writes, or else its cwd, the longest listed prefix winning, with no walk up; a cwd above two leaves belongs to the one the session last entered, and before it entered any a start there is answered by one line naming them; a leaf with no config of its own is a project with its records in its folder, and an event in no leaf, a folder holding a config the registry does not list among them, answers nothing and writes nothing.
  over: a start at the top, an edit in each of two leaves, a stop at the top after both, an edit in a stray configured folder and one in a folder outside both, and commands run in a leaf with no config
  via: with a registry, events from the repository top route to the leaf with the longest listed prefix, and anything in no leaf is ignored
  because: a repository that opts in leaves explicitly must not let a config someone left in another folder, or the registry's own file at the top, make that folder a project; the list is the one place adoption is decided
  refuted: hookProject skipped the registry and routed by the nearest config as without one -> "with a registry, events from the repository top route to the leaf with the longest listed prefix, and anything in no leaf is ignored" went red in registry.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  refuted: an event above several leaves stayed with the several answer, never the leaf the session last entered -> "with a registry, events from the repository top route to the leaf with the longest listed prefix, and anything in no leaf is ignored" went red in registry.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- an event outside every leaf costs no git: With a registry, a tool event whose files or cwd lie in no listed leaf spawns no git and writes nothing: the registry's list decides from one small read.
  over: an edit and a command in a folder outside every leaf, at PreToolUse and PostToolUse
  via: an event outside every leaf of a registry spawns no git and writes nothing
  because: the hooks at the repository top run around every tool call of every team; without a registry the outside answer costs a listing of the repository's configs, and with one the list is already known
  refuted: hookProject listed the repository's configs with git before routing by the registry -> "an event outside every leaf of a registry spawns no git and writes nothing" went red in registry.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: budget
  checklist: execution-budget declared as an event outside every leaf costs no git
  checklist: bounded-admission dismissed: nothing is admitted; the bound is on one hook call's work
  checklist: fair-admission dismissed: there are no contenders for the budget
  checklist: rate-budget dismissed: nothing is counted against a time window
  checklist: memory-budget dismissed: the bound is on spawned processes, not on allocation
  checklist: circuit-breaker-policy dismissed: an ignored event has no dependency to fail
- adopt opts a folder in: adopt <folder> lists the folder in the registry at the repository top, creating it when there is none, keeping the file's indentation, key order and final newline, and prints the adopt practice as the next step; it refuses a path outside the repository or the top itself, a path that is no folder, one already listed, one inside a listed leaf or holding one, and a top whose config is a whole-repository project.
  over: a folder added to a registry, a registry created, and each refused path
  via: adopt lists a folder in the registry, keeping its layout, creates one when there is none, and refuses every bad case
  because: opting a leaf in is one edit to a shared file that people also edit by hand, so it must not reformat it, and every refusal names a state the routing could not answer for: nested leaves, a folder that is not there, or a whole-repository project silently turned into a registry
  refuted: adopt stopped refusing a folder inside a listed leaf -> "adopt lists a folder in the registry, keeping its layout, creates one when there is none, and refuses every bad case" went red in registry.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- install with a registry writes once at the top: hooks install in a repository with a registry writes the host's settings at the repository top alone, never a leaf's, and .coherence/.gitignore in each listed leaf, never at the top.
  over: an install run from a leaf with no config of its own
  via: hooks install with a registry writes the host settings once, at the repository top, and an ignore file in each leaf
  because: the registry's top is the one place a host launched at the repository root reads, every leaf is routed from there, and the top is no project, so a .coherence there would be a second store
  refuted: settingsRoots named the leaf beside the repository top under a registry -> "hooks install with a registry writes the host settings once, at the repository top, and an ignore file in each leaf" went red in registry.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- entering a nested project warms its instrument: The first tool use of a session inside a project nested below the folder holding the hooks starts warming that project's instrument in the background, beside the orient it delivers, and never waits for it; later tool uses there do not.
  over: the first and second tool use of a session at a registry's top inside one leaf
  via: the first tool use inside a nested project warms its instrument, once
  because: a session at a registry's top above several leaves has no start or prompt that belongs to a project, so nothing warmed the language server before the first edit's check; on PostHog that edit took 3.1 s cold against the 3 s latency budget, and 2.4 s once the entry had warmed it
  refuted: the first tool use inside a nested project delivered orient without warming its instrument -> "the first tool use inside a nested project warms its instrument, once" went red in registry.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- an upgrade turns no kernel practice against an adopter: An adopter that enacted a kernel practice as an earlier release taught it enacts it again under this release, and spec --check names no problem about it, for every kernel practice of every tagged release; the network upgrade test (npm run test:upgrade, the Upgrade workflow) installs the previous published release under the adopter's own records and checks the rest of the upgrade.
  over: every kernel practice this tree ships, as each release tag in git history wrote it, enacted with every step done in a fixture adopter and then enacted and checked under this tree
  via: an adopter that enacted every kernel practice as an earlier release taught it re-enacts each and checks clean under this one
  because: 1.5.0 amended a kernel practice in Coherence's own tree, and every adopter that had enacted the earlier version was refused at enact until it recorded an amend decision for a change it never made (df-36efa8f2); no test had put one release's records under the next, so the release went out with every test green
  crossing: record -> reading
  refuted: restored the 1.5.0 bug, the kernel skip in floorGaps removed -> "an adopter that enacted every kernel practice as an earlier release taught it re-enacts each and checks clean under this one" went red in upgrade.test.ts on its own assertion, enact refused for each of the six release and practice pairs that lost a step or pitfall (witness a refutation and adopt Coherence from v1.2.0, v1.3.0 and v1.4.0); restored byte for byte, green batched and alone (2026-10-07)
  kinds: revision
  checklist: revision-preservation declared as an upgrade turns no kernel practice against an adopter
- a project behind a symbolic link hears its hooks: A tool hook names the files an event writes relative to the project whichever spelling of the project and of the file the host, the event's cwd and the tool use, comparing real paths, so a project reached through a symbolic link gets its edit checks and practice deliveries.
  over: an edit of a project file with the project and the file each spelled through a symbolic link or its target, in every mix
  via: a project behind a symbolic link hears its hooks whichever spelling the host, the cwd and the edited file use
  because: the hook made the edited file relative to the root's own spelling, so on macOS, where every temporary folder sits behind /var -> /private/var, a file under /var read as outside the project rooted at /private/var and every tool hook went silent (df-ccfd4309); an adopter whose home or checkout sits behind a link would hear nothing
  crossing: harness -> reading
  refuted: made writtenFiles relative to the root's own spelling again, the file's path unresolved -> "a project behind a symbolic link hears its hooks whichever spelling the host, the cwd and the edited file use" went red in symlink.test.ts on its own assertion, and with the writtenFiles assertions set aside the hook still delivered no practice; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- orient names each guard failure: orient's spec block names every defect recorded in a class a guard already covered, with the guard and the close that set it, and says nothing when there is none.
  over: a project before any guard, after the guarded close, and after a later defect in the guarded class
  via: orient names each guard failure under the spec block
  because: a repeat in a guarded class means the protection was weaker than claimed, and the session that starts next is the one that should strengthen it; spec --check alone is read only when someone runs it
  crossing: record -> reading
  refuted: made orient name guard failures only when there are two or more -> "orient names each guard failure under the spec block" went red in defect-orient.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
- a hook time carries its version: every hook call's kept time carries the Coherence version that answered it, read once from the installed package; a time kept before versions were written still reads, with no version.
  over: a kept time written now and one written before versions existed
  via: a hook call's kept time carries the Coherence version that answered it
  because: hook latency is read per Coherence version to see whether a release made the hooks slower; times without the version could only be grouped by guess
  crossing: harness -> record
  refuted: dropped the installed version from recordHookTime, so a kept time carried none -> "a hook call's kept time carries the Coherence version that answered it" went red in defect-orient.test.ts on its own assertion; restored byte for byte, green batched and alone (2026-10-07)
  kinds: none
