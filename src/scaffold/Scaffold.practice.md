- declare entrances: Every place work enters the project from outside is declared in the spec of the component that owns its handler, with the trust it carries in, and each untrusted one is closed or says why it needs no control.
  when: command scaffold entrances | command scaffold control
  step: declare the trust levels in the entry spec first, marking (outside) a level whose data or caller comes from outside the system's control
  step: run coherence scaffold entrances, and declare each bullet it prints in the spec of the component that owns the handler, with its meaning and trust; or record with decide why a detected one is not an entrance
  step: name each handler as a symbol, a symbol in a file, or a module file for a script, so spec --check can resolve it
  step: close each untrusted entrance with no traced control: guard: where a verified chokepoint wraps its handler, an invariant whose crossing enters from its trust, or control: none with the reason; coherence scaffold control proposes which
  step: record the adoption baseline once, so orient names only gaps opened after it: coherence scaffold control --baseline
    leaves: the baseline record in the journal
  step: run coherence spec --check
    leaves: 0 problems
  pitfall: both outside adoptions left their route gaps open because nothing in the session's loop showed them (d-a1095ef2)
  pitfall: no control read as a demonstrated bypass; it means only that no control was traced (d-127ab8e4)
  pitfall: thirteen HTTP entrances reached no other component by static reference, so their routes showed nothing past routing (c-67ae21bd)
  learned: d-6022598c, d-ba18b0fd, d-a1095ef2
  invariants: src/spec/entrance trust names a declared level, src/spec/control none carries its reason
  reach: kernel
  because: an entrance is where untrusted work arrives, and a session sees only what is declared; an undeclared one is a route nobody checks, and an unclosed one reads as safe until someone asks
- declare a requirement: A requirement is written as behavior that must hold, with an enforcement the instrument can resolve, an honest checklist, and its because, so that the refutation that follows has something real to break.
  when: command scaffold invariant
  step: write the sentence as behavior that must hold whatever the implementation, not as the mechanism that holds it today
  step: when the code already breaks it, keep the sentence as it must hold: record a defect for each site that breaks it and escalate whether to fix them; the bullet stays a requirement until the fix, never an invariant by weakening the sentence to match the code
  step: name the enforcement as something the instrument resolves: a bare identifier, an identifier in a file, or a module path; prose there grades not chokeable
  step: choose the chokepoint form when one site guards the protected thing, and the totality oracle form when a detector checks the whole set; a detector is never itself the chokepoint
  step: name the kinds honestly and answer every checklist shape printed, declared as an invariant or dismissed with a reason; leave kinds out of a bullet you did not examine, so the lack stays visible
  step: write the because: what the invariant protects against, and what broke without it
  step: run, then witness its refutation (the practice witness a refutation); when no test can run here (it needs a database, keys, or a running server), record unable naming the wall instead, and the bullet stays a requirement
    leaves: spec --check lists the bullet as an invariant, or the unable record
  pitfall: fourteen prose protects: values graded not chokeable, with the fix named (d-4d96c8d7)
  pitfall: claims whose chokepoint was their own detector named a symbol with nothing protected behind it (d-3459e43b)
  pitfall: refuted: lines written by hand read as witnessed, so 32 of 52 invariants rested on nothing that went red (df-b9b2711b)
  pitfall: at a fresh adoption both requirements were already false and the only tests needed a database, keys and a running server, and the practice said nothing of either (df-8ac95c4d)
  learned: d-8ed21083, d-362ee727, d-b30cb995
  invariants: src/spec/requirement until complete, src/spec/refutation is a recorded event
  reach: kernel
  because: a requirement is the cheapest thing to write and the easiest to write vacuously; each of these steps is one a session skipped and the check later had to say so
