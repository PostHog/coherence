#!/bin/zsh
# usage: setup.sh <arms dir> <arm> <testbed repo> <base commit> <coherence ref>
# A throwaway clone of the testbed at its pre-Coherence commit, its
# dependencies installed, and a Coherence worktree at the ref beside it.
set -e
root=$1; arm=$2; testbed=$3; base=$4; ref=$5
here=${0:A:h}; coherence=${here:h:h}
dir=$root/$arm; proj=$dir/${testbed:t}
mkdir -p $dir/tmp
git clone -q $testbed $proj
git -C $proj checkout -q -b adopt-coherence $base
if [ -f $proj/pnpm-lock.yaml ]; then (cd $proj && pnpm install --frozen-lockfile) > $dir/install-project.log 2>&1
elif [ -f $proj/package-lock.json ]; then (cd $proj && npm ci) > $dir/install-project.log 2>&1; fi
git -C $coherence worktree add -q --detach $dir/coherence $ref
(cd $dir/coherence && npm ci) > $dir/install-coherence.log 2>&1
print -r -- ${testbed:t} > $dir/project
print -r -- $base > $dir/base
echo "ok $arm $(git -C $proj rev-parse --short HEAD) coherence $(git -C $dir/coherence rev-parse --short HEAD)"
