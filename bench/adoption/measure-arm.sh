#!/bin/zsh
# usage: measure-arm.sh <arm dir> <coherence checkout> <label>
# Reads the adopted clone with one Coherence build, so every arm is measured
# by the same code whatever build it adopted with.
arm=${1:A}; C=${2:A}; label=$3; here=${0:A:h}
proj=$arm/$(cat $arm/project); out=$arm/measure-$label; mkdir -p $out
cd $proj
git status --short > $out/git-status.txt; git log --oneline $(cat $arm/base)..HEAD > $out/git-log.txt
node $C/src/cli.ts query structure > $out/structure.txt 2> $out/structure.err; echo $? > $out/structure.exit
node $C/src/cli.ts spec --check > $out/spec.txt 2>&1; echo $? > $out/spec.exit
node $C/src/cli.ts lexicon --check > $out/lex.txt 2>&1; echo $? > $out/lex.exit
node $here/measure-model.ts $C $proj > $out/model.json 2> $out/model.err
echo "measured ${arm:t} with $label"
