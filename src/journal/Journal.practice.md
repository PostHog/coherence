- close a defect: A defect is closed only when its whole class is guarded, or a decision says why fixing the instance suffices, and the guard has been seen to fire.
  when: command defect | command classify | command resolved
  step: classify it: record the defect with --class, --introduced and --caught, or classify one already recorded (classify <defect-id>); a class declared nowhere is declared once first, as the property class <name> of defect (lexicon propose define defect)
    leaves: the defect's or the classification's id
  step: sweep the codebase for siblings of the same shape (the same comparison, call or pattern wherever else it is written) and fix each one, then record the sweep: what was searched and every sibling it found, or that it found none
    leaves: the sweep: what was searched and each sibling found and fixed, or none
  step: guard or decide: name an invariant whose enforcement covers the whole class (a chokepoint, or a totality oracle over the class whose test fails on any member), adding the bullet when none exists; or record a decision saying why fixing the instance suffices
    leaves: the guard's <component folder>/<invariant> or the decision's id
  step: refute the guard: witness a refutation of it, staging a break of the class's shape rather than replaying the instance
    leaves: the refutation's run record
  step: record the close: resolved <defect-id> --because "<what fixed it, and the sweep>" with --guard <component folder>/<invariant> or --decision <id>, then run spec --check
    leaves: the resolution's id; spec --check names no close with neither
  pitfall: the symbolic-link spelling was fixed where the upgrade test found it, and only a sweep of the same comparison found the second site, in practice delivery's cd routing (df-ccfd4309, 4b1890f)
  pitfall: a second door opened past the warm server's chokepoint reached main because nothing that ran before the merge checked chokepoints; a guard protects only where it runs (df-5961bdb2)
  pitfall: an ownership defect was fixed for one kernel practice when its class was every kernel practice of every release; the guard that held was the one that read them all (df-36efa8f2, 4b1890f)
  invariants: a defect carries its class and origin, a defect's close names a guard or a decision, src/spec/the defect floor names closes and repeats
  reach: kernel
  because: a defect found and fixed once is paid for once and found again; classified, swept, guarded and refuted, it buys protection for its whole class, and the convergence reading can show whether the project is converging
