- declare entrances: The entrances whose declaration pays most are declared in the spec of the component that owns each handler, with the trust it carries in, and each untrusted one is closed or says why it needs no control; the rest stay undeclared, the normal state of a detected entrance, counted and never a gap.
  when: command scaffold entrances | command scaffold control
  step: declare the trust levels in the entry spec first, marking (outside) a level whose data or caller comes from outside the system's control
  step: where many entrances go through one helper their handlers call (every API route calling one request-and-auth function), declare them as one grouped entrance whose handler is that helper, with the trust they carry in; then run coherence scaffold entrances again, and the entrances that skip the helper rank first
  step: run coherence scaffold entrances: it ranks the undeclared entrances (those that skip a grouped entrance's helper, then outside trust, then a handler that writes, then a thing a chokepoint protects that its imports reach, then the components they reach) and proposes bullets for the first 15
  step: declare the first 10 to 20 it ranks, and every one after them that carries outside trust in and writes (--all lists them in the same order), each in the spec of the component that owns its handler, with its meaning and the trust you judged it carries; or record with decide why a detected one is not an entrance
  step: leave the rest undeclared; never declare an entrance whose trust no one judged, assigned by rule from its route family, since a declared untrusted entrance is a spec gap until it is closed
  step: name each handler as a symbol, a symbol in a file, or a module file for a script, so spec --check can resolve it
  step: close each untrusted entrance with no traced control: guard: where a verified chokepoint wraps its handler, an invariant whose crossing enters from its trust and whose entrances: line names it, or control: none with the reason; coherence scaffold control proposes which
  step: record the adoption baseline once, so orient names only gaps opened after it: coherence scaffold control --baseline
    leaves: the baseline record in the journal
  step: run coherence spec --check
    leaves: 0 problems
  pitfall: both outside adoptions left their route gaps open because nothing in the session's loop showed them (d-a1095ef2)
  pitfall: no control read as a demonstrated bypass; it means only that no control was traced (d-127ab8e4)
  pitfall: thirteen HTTP entrances reached no other component by static reference, so their routes showed nothing past routing (c-67ae21bd)
  pitfall: an adoption of umami declared all 280 detected entrances with trust assigned by route family and no one judging any, and the 263 gaps that followed buried its first reading (d-a37af46f)
  pitfall: 181 API routes that all call one request-and-auth helper were declared one by one, and no chokepoint fit the helper, which has other callers; one grouped entrance whose handler is the helper stands for them (d-34480e8d)
  learned: d-6022598c, d-ba18b0fd, d-a1095ef2, d-a37af46f, d-34480e8d
  invariants: src/spec/entrance trust names a declared level, src/spec/control none carries its reason, src/scaffold/undeclared entrances are ranked by what declaring them pays, src/scaffold/a family's skipped members rank first
  reach: kernel
  because: an entrance is where untrusted work arrives, and a session sees only what is declared; an unclosed one reads as safe until someone asks. Declaring is a judgment of who calls it and what it carries, so a declaration made by rule carries none, and the ranked few a session can judge are worth more than a whole surface declared by pattern
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
