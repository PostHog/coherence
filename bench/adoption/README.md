# Adoption A/B

Measures what a change to Coherence does to real adoptions: headless agent
sessions adopt Coherence into throwaway clones of testbed projects, at a
pre-Coherence commit, with one Coherence ref per variant, and every arm is
measured afterwards by the same build.

It spends real money (about $5 to $10 per arm with Opus) and runs agents with
`--dangerously-skip-permissions`, so it only ever runs in clones made for it:
the agents are told to commit locally and never push, and nothing here
touches the testbeds themselves.

## Run

1. Write an arms file, one arm per line, tab separated:
   `<project>-<variant>-r<n>  <testbed repo>  <base commit>  <coherence ref>`.
   The testbed is a local clone; the base commit is before the project had
   Coherence; the ref is the build that variant adopts with.
2. Set up each arm: `while IFS=$'\t' read -r arm testbed base ref; do ./setup.sh <arms dir> $arm $testbed $base $ref; done < arms.tsv`.
3. Trust the clones so their project hooks run: `python3 trust.py add <arms dir>`.
4. Run: `./drive.sh <arms dir> [jobs]`. Arms run one at a time unless jobs
   says more. Each arm has its own TMPDIR and is told to keep scratch files
   in it; when arms ran four at a time without that, agents overwrote one
   another's /tmp scripts.
   `STOP_AFTER=<n> ./drive.sh ...` ends each first session after Full setup
   step n, so the second session starts with what later steps close still
   open (the case orient's reminders are for).
5. Untrust: `python3 trust.py remove <arms dir>` removes exactly the keys it
   added.
6. Measure every arm with one build, then summarize:
   `./measure-arm.sh <arm> <coherence checkout> <label>` for each arm,
   `python3 transcripts.py <arm> > <arm>/transcripts.json` for each arm,
   `python3 aggregate.py <arms dir> <label> [<coverage label>]`, and
   `python3 collisions.py <arms dir>` to confirm no arm used another's
   scratch files.

## What each arm leaves

`prompt1.txt` and `prompt2.txt` (what the sessions were told), `s1.jsonl` and
`s2.jsonl` (the sessions' stream), `measure-<label>/` (structure, spec and
lexicon checks, and `model.json`: entrances, gaps, waivers, `guard:` lines,
baselines), and `transcripts.json` (cost, turns, errors, what orient said
about gaps, `scaffold control` calls). `aggregate.py` writes `results.json`
beside the arms.
