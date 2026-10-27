#!/bin/sh
# Builds plugins/typescript's two parsers, tree-sitter-typescript.wasm and tree-sitter-tsx.wasm, from
# tree-sitter-typescript v0.23.2 with coherence.patch applied. Upstream has merged no grammar change since
# v0.23.2 (2024-11), and each of these parse errors hides the declarations after it:
#   - an import type with type arguments, or as an array's element, an indexed type's object, keyof's operand
#     or a type argument: import('x').T<U>, import('x').T[], keyof import('x').T;
#   - a member named in or instanceof (in: T, in?: T, in = 2), or one whose name begins with in (in_progress,
#     in$, inü), on the line after another member;
#   - a bare & in JSX text or a JSX string: Billing & Usage, to="?a=1&b=2", title='Q&'.
# Two phases. fetch.sh downloads every input, each checked by the digest inputs.sha256 records, and clones the
# upstream grammar at its pinned commit. build-phase.sh then runs with the network denied (sandbox-exec on macOS,
# unshare -rn on Linux; CI uses docker --network none), so it can download nothing: it checks every input again,
# builds the stock and the patched parsers, runs the grammar's corpus and Coherence's, compares what the two read
# over a fixed corpus (compare.mjs, against intended-differences.json), and writes the bundled parsers only once
# each is byte for byte the digest parsers.sha256 records. A change to the patch updates those digests with it.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=$(cd "$here/../../plugins/typescript" && pwd)
inputs=$(mktemp -d)
trap 'rm -rf "${inputs:?}"' EXIT
"$here/fetch.sh" "$inputs"
case "$(uname -s)" in
  Darwin) sandbox-exec -p '(version 1) (allow default) (deny network*)' "$here/build-phase.sh" "$inputs" "$out" ;;
  Linux)
    unshare -rn true 2>/dev/null || { echo "build.sh: unshare -rn cannot deny this machine's network; run build-phase.sh as CI does, in docker with --network none (.github/workflows/ci.yml)" >&2; exit 1; }
    unshare -rn "$here/build-phase.sh" "$inputs" "$out" ;;
  *) echo "build.sh: no way to deny the network on $(uname -s)" >&2; exit 1 ;;
esac
