- close a defect: A defect is closed only when a guard, an invariant seen to fire, covers its whole class (best after a fix that leaves the code no way to express it), or when a decision says why fixing the instance suffices or bounds a bug only time or a scheduler can show.
  when: command coherence defect | command cli.* defect | command classify | command resolved df-* | explicit
  step: classify it: record the defect with --class, --introduced and --caught, or classify one already recorded (classify <defect-id>); a class declared nowhere is declared once first, as the property class <name> of defect (lexicon propose define defect)
    leaves: the defect's or the classification's id
  step: name what let the bug be written (the state a value can hold that it never should, or a second way to do what one function should do alone), then sweep the codebase for every sibling of that shape and record the sweep: what was searched and each sibling found, or that it found none
    leaves: the representable shape, and the sweep
  step: fix it so the code cannot express it again, in preference to a check at the site: one door every caller must pass (a function or class its module keeps private, so the compiler, or a totality oracle where the language has no such check, refuses any other caller), a type that cannot hold the bad value, a walk with a stack of its own rather than recursion over what input controls, a fact derived where it is needed rather than kept twice; route every sibling the sweep found through it. When the dead-end reading names the defect's component (DEAD END in spec --check, Dead ends in orient), weigh a different design for that component before adding any such door to the one it has, and record the choice, redesign or keep, as a decision
    leaves: the door, type or derivation, and the siblings now routed through it; at a dead end, the decision choosing the design
  step: guard or decide: name an invariant that fails on any second way to write the bug, a chokepoint the compiler grades or a totality oracle that reads the code and refuses each other door (another call, a name held under an alias, a module asked for by string), adding the bullet when none exists; or record a decision saying why fixing the instance suffices, or that only time or a scheduler can show the bug (a cost, a race), bounding it structurally all the same (a size every read passes, a lock only one process can take)
    leaves: the guard's <component folder>/<invariant> or the decision's id
  step: refute the guard: witness a refutation of it, staging a second way to write the bug rather than replaying the instance
    leaves: the refutation's run record
  step: record the close: resolved <defect-id> --because "<what fixed it, and the sweep>" with --guard <component folder>/<invariant> or --decision <id>, then run spec --check
    leaves: the resolution's id; spec --check names no close with neither
  pitfall: the symbolic-link spelling was fixed where the upgrade test found it, and only a sweep of the same comparison found the second site, in practice delivery's cd routing (df-ccfd4309, 4b1890f)
  pitfall: a second door opened past the warm server's chokepoint reached main because nothing that ran before the merge checked chokepoints; a guard protects only where it runs (df-5961bdb2)
  pitfall: an ownership defect was fixed for one kernel practice when its class was every kernel practice of every release; the guard that held was the one that read them all (df-36efa8f2, 4b1890f)
  pitfall: the parse store's defences were checks written at each of its file system calls, and three blind reviews in a row found one more call without its check; one gateway, unexported and held by a parse of its module, was the fix that held (ca263d3, df-8b32c22b)
  pitfall: the gateway's totality oracle read only node:fs imported by name, so a require made with createRequire and the file system asked of process.getBuiltinModule each wrote past it with the test green (df-69c8ab4d)
  pitfall: a recursion over a parse tree was kept when its function was rewritten, so a file nested deep enough crashed every reading (df-6e6c2b80)
  pitfall: src/plugins, home of the parse store, collected 26 defects in 7 classes over 11 commits of blind review, each round closed by a check at the site its reviewer found and a test that the check existed, and the next round found faults in those checks (df-7c50adfe, df-aad5bf07, df-8b32c22b, df-2456bd98, df-69c8ab4d, df-ff68d46c, df-586f6367); the representation was the defect, a security-relevant cache inside the untrusted repository kept as mutable shared state, and nothing said so until the dead-end reading
  invariants: a defect carries its class and origin, a defect's close names a guard or a decision, src/spec/the defect floor names closes and repeats, src/spec/a subsystem at a dead end is named
  reach: kernel
  because: a defect found and fixed once is paid for once and found again; a fix that leaves the code no way to express it holds every site at once, and its guard fails the moment a second way appears, so the convergence reading can show whether the project is converging
- hand back delegated work: A delegated agent's choices, limits and accepted risks are journal records its report cites, so the coordinator and every later reader see them where the project keeps its decisions, not only in one report read once.
  when: explicit
  step: record each choice the brief did not fix as a decision, with the alternative in --over and the cost in --because
    leaves: the decisions' ids
  step: record each limit, accepted risk or case you judged acceptable as a decision when you chose it, a conjecture when you are unsure of it, and unable when you did not do it
    leaves: the records' ids
  step: write the report citing each record by its id instead of restating the judgment; a judgment in the report with no record is the report's defect
    leaves: the report, every judgment in it citing a record
  step: as the coordinator, read the delegate's records before its report: journal --session <the delegate's session>
  pitfall: a delegated agent judged a false spec problem accurate in its report and recorded nothing, so only a careful reading of the report caught it (df-384acb1e)
  learned: df-384acb1e
  reach: internal
  because: a report is a transcript, read once by one reader; a journal record carries its rejected alternative and reaches Scope, the pull request's records summary and every later session
- keep state where it is true: Each piece of state a program keeps has one home, chosen for who may write it and how long it must live, and everything else that depends on it is computed from it, not stored beside it.
  when: defect duplicated-fact | explicit
  step: name the state the change touches: each truth (what is observed, entered or decided) and each value derived from one (a count, a cache, an index, a copy, a version repeated across files, a number written in a document)
    leaves: the truths and the derivations, each derivation naming the truth it comes from
  step: store each truth once: where a second copy exists, compute it from the first (when built, read or shown) or remove it; a copy that must be kept (a cache, a snapshot) is filed by the truth it came from, by its digest or fingerprint, so it cannot disagree without being read as another
    leaves: each truth's one home, and each derivation's function or key
  step: choose where state lives by who may write it and how long it lives: never where a party you do not trust can write (a tool's cache inside the project it reads), never a file two processes change in place; prefer records written once, whole, and never changed, over a file edited in turn
    leaves: each store's location, who may write it, and whether anything in it changes once written
  step: make every output a function of the state: the same data gives the same answer whatever the time, the load, or what a process did before; where a reading must stop early (a time budget), it stops by what it counted and names what it did not read
    leaves: each output's inputs, and each place it can differ on the same data, removed or named
  step: hold it with an invariant that recomputes each kept derivation from its truth and fails on a difference, or fails where a second writer of a truth appears; and record the choice of each store's home as a decision
    leaves: the invariant's <component folder>/<name> and its refutation, and the decision's id
  pitfall: Coherence kept its parse cache inside each project it read, so a repository could write the cache's files, and four rounds of blind review found about thirty defects in its defences; moved to the user's own cache, filed by the text's digest and written once, the defences were no longer needed (d-d1229127)
  pitfall: one version was kept in eight files, the package's and seven plugin manifests, and a prerelease checked them against each other because nothing derived them (df-089ac5a9, w-d112a3e4)
  pitfall: a journal kept per worktree showed one copy of a session's records, and the pane that read it showed nearly none (w-4c76c5ea)
  pitfall: numbers typed into documents and decisions from a measurement went stale or wrong, and had to be corrected by later decisions (d-2dfb13fc, d-e8f43329)
  pitfall: a reading stopped by a time budget gave different answers on the same checkout under different machine load (w-77d2fe8f)
  invariants: src/spec/a practice fires on a defect's class
  reach: kernel
  because: data is the job a program does: state kept in two places disagrees, state kept where another party writes is theirs, and an output that is not a function of its state cannot be checked; store truth once, then compute what follows from it (after "Data is destiny", accord.exchange, CC BY-SA 4.0)
