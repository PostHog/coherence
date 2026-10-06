#!/bin/zsh
# usage: run-arm.sh <arm dir>
# Two headless sessions in the arm's clone: the Full setup prompt from the
# arm's own Coherence README, then a bare continuation. Each arm has its own
# TMPDIR and is told to keep scratch files there: arms run side by side once
# overwrote one another's scripts in /tmp.
# STOP_AFTER=<n> ends session 1 after setup step n, so session 2 starts with
# what the later steps would have closed still open.
arm=${1:A}; proj=$arm/$(cat $arm/project)
cd $proj || exit 1
setup=$(python3 - $arm/coherence/README.md <<'PY'
import sys, re
s = open(sys.argv[1]).read()
sec = s[s.index("## Full setup"):]
print(re.search(r"```text\n(.*?)```", sec, re.S).group(1).strip())
PY
)
rules="Coherence is already beside this project at ../coherence with npm ci done: do not install it again; the command is node ../coherence/src/cli.ts. Work only in this checkout: commit locally, never push, and do not modify ../coherence. Keep scratch files under $arm/tmp, never directly under /tmp."
stop=""
[ -n "$STOP_AFTER" ] && stop="

Do steps 1 to $STOP_AFTER only, commit what you did, and stop: a later session continues from step $((STOP_AFTER + 1))."
p1="$rules

$setup$stop"
p2="Continue the Coherence setup in this project where the previous session left off, and finish whatever it still owes. $rules"
print -r -- "$p1" > $arm/prompt1.txt; print -r -- "$p2" > $arm/prompt2.txt
# The parent session's variables would tie the child to it.
clean=(-u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_PROJECT_DIR -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_BRIDGE_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_SESSION_ATTENDED -u CLAUDE_PID -u CLAUDE_EFFORT)
model=${MODEL:-claude-opus-5-5}
for s in 1 2; do
  date -u +%FT%TZ > $arm/s$s.start
  prompt=$arm/prompt$s.txt
  env $clean TMPDIR=$arm/tmp claude -p "$(cat $prompt)" --model $model --dangerously-skip-permissions --output-format stream-json --verbose < /dev/null > $arm/s$s.jsonl 2> $arm/s$s.err
done
date -u +%FT%TZ > $arm/done
