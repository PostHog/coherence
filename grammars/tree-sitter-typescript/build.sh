#!/bin/sh
# Builds plugins/typescript's two parsers, tree-sitter-typescript.wasm and tree-sitter-tsx.wasm, from
# tree-sitter-typescript v0.23.2 with coherence.patch applied. Upstream has merged no grammar change since
# v0.23.2 (2024-11), and each of these parse errors hides the declarations after it:
#   - an import type with type arguments, or as an array's element, an indexed type's object, keyof's operand
#     or a type argument: import('x').T<U>, import('x').T[], keyof import('x').T;
#   - a member named in or instanceof (in: T, in?: T, in = 2, in?(): void), or a member or a statement whose name
#     begins with in and a character that continues a name but is no letter (in_progress, in$, in2(): T, in_x()),
#     on the line after another;
#   - a bare & in JSX text or a JSX string: Billing & Usage, to="?a=1&b=2", title='Q&'.
# Two phases. fetch.sh downloads every input, each checked by the digest inputs.sha256 records, and clones the
# upstream grammar at its pinned commit. build-phase.sh then runs with the network denied, so it can download
# nothing: it checks every input again, builds the stock and the patched parsers from the pinned upstream tree,
# refuses a patch that changes anything but the grammar and its scanner, runs upstream's corpus and Coherence's
# (corpus/, outside the patch), compares what the two read over a fixed corpus (compare.mjs, against
# intended-differences.json), and writes the bundled parsers only once each is byte for byte the digest
# parsers.sha256 records. A change to the patch updates those digests with it.
# The denial is the sandbox's: sandbox-exec on macOS, which denies this process tree's own sockets (a daemon it asks
# over a mach port may still reach the network for it); on Linux, docker with --network none, as CI runs it, where
# docker is; else unshare -rn, which takes the network namespace away but leaves every unix socket on the filesystem
# reachable (a docker daemon's, a proxy's), so build.sh says so when it falls back to it.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=$(cd "$here/../../plugins/typescript" && pwd)
inputs=$(mktemp -d)
trap 'rm -rf "${inputs:?}"' EXIT
"$here/fetch.sh" "$inputs"
case "$(uname -s)" in
  Darwin) sandbox-exec -p '(version 1) (allow default) (deny network*)' "$here/build-phase.sh" "$inputs" "$out" ;;
  Linux)
    . "$here/inputs.sh"
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      docker run --rm --network none --user "$(id -u):$(id -g)" \
        --volume "$here/../..:/repo:ro" --volume "$inputs:/inputs:ro" --volume "$out:/out" \
        "$build_image" /repo/grammars/tree-sitter-typescript/build-phase.sh /inputs /out
    else
      unshare -rn true 2>/dev/null || { echo "build.sh: neither docker nor unshare -rn can deny this machine's network; run build-phase.sh as CI does, in docker with --network none (.github/workflows/ci.yml)" >&2; exit 1; }
      echo "build.sh: no docker here, so the build phase runs under unshare -rn, which denies the network but leaves the unix sockets on this machine's filesystem reachable" >&2
      unshare -rn "$here/build-phase.sh" "$inputs" "$out"
    fi ;;
  *) echo "build.sh: no way to deny the network on $(uname -s)" >&2; exit 1 ;;
esac
