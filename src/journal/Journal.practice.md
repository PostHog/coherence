- close a defect: A defect is closed only when the code can no longer express its whole class, or a guard covers the class, or a decision says why fixing the instance suffices, and the guard has been seen to fire.
  when: command coherence defect | command cli.* defect | command classify | command resolved df-* | explicit
  step: classify it: record the defect with --class, --introduced and --caught, or classify one already recorded (classify <defect-id>); a class declared nowhere is declared once first, as the property class <name> of defect (lexicon propose define defect)
    leaves: the defect's or the classification's id
  step: name what let the bug be written (the state a value can hold that it never should, or a second way to do what one function should do alone), then sweep the codebase for every sibling of that shape and record the sweep: what was searched and each sibling found, or that it found none
    leaves: the representable shape, and the sweep
  step: fix it so the code cannot express it again, in preference to a check at the site: one door every caller must pass (a function or class its module keeps unexported, so the compiler refuses any other caller), a type that cannot hold the bad value, a walk with a stack of its own rather than recursion over what input controls, a fact derived where it is needed rather than kept twice; route every sibling the sweep found through it
    leaves: the door, type or derivation, and the siblings now routed through it
  step: guard or decide: name an invariant that fails on any second way to write the bug, a chokepoint the compiler grades or a totality oracle that reads the code and refuses each other door (another call, a name held under an alias, a module asked for by string), adding the bullet when none exists; or record a decision saying why fixing the instance suffices, or that only time or a scheduler can show the bug (a cost, a race), bounding it structurally all the same (a size every read passes, a lock only one process can take)
    leaves: the guard's <component folder>/<invariant> or the decision's id
  step: refute the guard: witness a refutation of it, staging a second way to write the bug rather than replaying the instance
    leaves: the refutation's run record
  step: record the close: resolved <defect-id> --because "<what fixed it, and the sweep>" with --guard <component folder>/<invariant> or --decision <id>, then run spec --check
    leaves: the resolution's id; spec --check names no close with neither
  pitfall: the symbolic-link spelling was fixed where the upgrade test found it, and only a sweep of the same comparison found the second site, in practice delivery's cd routing (df-ccfd4309, 4b1890f)
  pitfall: a second door opened past the warm server's chokepoint reached main because nothing that ran before the merge checked chokepoints; a guard protects only where it runs (df-5961bdb2)
  pitfall: an ownership defect was fixed for one kernel practice when its class was every kernel practice of every release; the guard that held was the one that read them all (df-36efa8f2, 4b1890f)
  pitfall: the parse store's defences were checks written at each of 35 file system calls, and three blind reviews in a row found one more call without its check; one gateway, unexported and held by a parse of its module, was the fix that held (ca263d3, df-8b32c22b)
  pitfall: the gateway's totality oracle read only node:fs imported by name, so a require made with createRequire and the file system asked of process.getBuiltinModule each wrote past it with the test green (df-69c8ab4d)
  pitfall: a recursion over a parse tree was kept when its function was rewritten, so a file nested deep enough crashed every reading (df-6e6c2b80)
  invariants: a defect carries its class and origin, a defect's close names a guard or a decision, src/spec/the defect floor names closes and repeats
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
