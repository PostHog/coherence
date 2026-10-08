- add a spec problem: A new spec problem flags only what is wrong, never a configuration or spec an adopter wrote correctly, because a problem fails spec --check in CI and refuses a subagent's stop.
  when: edit src/**/*.ts adding problems.push
  step: name the valid inputs the problem must not flag, from what adopters write: the upgrade fixture's configs, a registry's leaves, files git ignores and a fresh checkout lacks (dist, build, .venv), paths present only nested in a package
    leaves: the list of valid inputs, in the test beside the case the problem must flag
  step: test each valid input as no problem, beside the input it exists to catch
    leaves: a test whose cases include the valid inputs
  step: run spec --check on Coherence and the upgrade test on its fixture adopter, and see no problem a valid adopter did not have before
    leaves: spec --check with no new problem; the upgrade test green
  step: a false alarm you accept is a decision, never a sentence in a report: decide naming the valid input it flags, with the narrower check in --over and the cost in --because
    leaves: the decision's id, or none accepted
  pitfall: an ignore entry naming nothing was flagged for build output git ignores, judged accurate in the report and recorded nowhere (df-384acb1e)
  learned: df-384acb1e
  reach: internal
  because: a spec problem is the strongest thing Coherence says to an adopter, and a check that flags a valid config is noticed only by the adopter it blocks; the inputs it must not flag are known in advance, from configs adopters have already written
