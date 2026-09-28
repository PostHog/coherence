#!/bin/zsh
# usage: drive.sh <arms dir> [jobs]
# Runs every set-up arm not yet done, one at a time unless jobs says more.
root=${1:A}; jobs=${2:-1}; here=${0:A:h}
for a in $root/*(/); do [ -f $a/project ] && [ ! -f $a/done ] && print -r -- $a; done | xargs -P $jobs -L 1 $here/run-arm.sh
