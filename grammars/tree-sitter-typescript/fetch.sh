#!/bin/sh
# The fetch phase: downloads every input the build phase reads into the folder given, each checked against the digest
# inputs.sha256 records for it, and clones the upstream grammar at its pinned commit. The only phase that reaches the
# network; build-phase.sh checks all of it again, with the network denied, before it builds from any of it.
# Needs curl and git.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/inputs.sh"
[ $# -eq 1 ] || { echo "usage: fetch.sh <inputs folder>" >&2; exit 2; }
mkdir -p "$1"
dir=$(cd "$1" && pwd)
for file in $input_files; do
  want=$(digest_in "$here/inputs.sha256" "$file")
  [ -n "$want" ] || { echo "fetch.sh: inputs.sha256 records no digest for $file" >&2; exit 1; }
  curl --fail --silent --show-error --location --output "$dir/$file" "$(url_of "$file")"
  got=$(sha256 "$dir/$file")
  [ "$got" = "$want" ] || { rm -f "$dir/$file"; echo "fetch.sh: $file is $got, not $want" >&2; exit 1; }
done
git clone --quiet "$upstream" "$dir/tree-sitter-typescript"
git -C "$dir/tree-sitter-typescript" checkout --quiet "$upstream_commit"
