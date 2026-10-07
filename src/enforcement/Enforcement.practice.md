- witness a refutation: A refutation counts only when the detector went red because of the staged break, and the code is back byte for byte afterwards.
  when: command refute | edit **/*.spec.md adding refuted:
  step: run the totality oracles being refuted in one batched run confirmed with run --each (run --invariant <name>... --each), and see each green batched and alone
    leaves: run record for the bullets, pass; per-test run record, pass
  step: stage the smallest break that changes the behavior the bullet claims, not the strings the detector reads; read the diff to confirm the edit touched only the lines you meant
  step: refute <component>/<name> --broke "<what you changed>"; the detector fails on its own assertion, not by a hang, a kill, a timeout, or what an earlier test left behind
    leaves: run record for the bullet, refutation red
  step: restore the source byte for byte
    leaves: the file matches HEAD
  step: run them again in one batched run confirmed with run --each, and see each green batched and alone
    leaves: run record for the bullets, pass; per-test run record, pass
  step: when the red did not come from the break, record a decision that this refutation does not count and refute again; the run store is append-only, so the correction is a later record
  pitfall: a sed matched two lines, so the test hung and went red only when it was killed (d-828ddc83)
  pitfall: a substring detector passed an unconditional early return that kept every expected string (df-c40bb904, x-429ed176)
  pitfall: the red came from the selected test depending on what earlier tests appended, not from the break (d-c4be0b1a, df-9e673484)
  pitfall: a self-asserted refuted: line read as witnessed, and an automatic refutation proved the instrument reports a site, not that the classifier calls it a bypass (df-b9b2711b, df-87881a8d)
  pitfall: a break that turns a test red when the via does not test the claim refutes nothing; record unable instead (u-2e6ee400)
  learned: d-4dafa61b, df-b9b2711b, d-828ddc83, d-c4be0b1a, d-082ff525
  reach: kernel
  because: a refutation is what turns a requirement into an invariant, and the step that slips is the one no command checks: that the red came from the break. 32 of 52 refutations were once unwitnessed, and vacuous ones were found three times after they had been recorded
