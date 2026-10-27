#!/bin/sh
# Builds plugins/typescript's two parsers, tree-sitter-typescript.wasm and tree-sitter-tsx.wasm, from
# tree-sitter-typescript v0.23.2 with coherence.patch applied. Upstream has merged no grammar change since
# v0.23.2 (2024-11), and each of these parse errors hides the declarations after it:
#   - an import type with type arguments, or as an array's element, an indexed type's object or keyof's
#     operand: import('x').T<U>, import('x').T[], keyof import('x').T;
#   - a member named in, or one whose name begins with in or instanceof (in_progress), on the line after
#     another member;
#   - a bare & in JSX text or a JSX string: Billing & Usage, to="?a=1&b=2".
# Needs git, node and Emscripten's emcc (built with 6.0.13); writes both parsers over the bundled ones.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=$(cd "$here/../../plugins/typescript" && pwd)
work=$(mktemp -d)
trap 'rm -rf "${work:?}"' EXIT
git clone --quiet https://github.com/tree-sitter/tree-sitter-typescript "$work/grammar"
cd "$work/grammar"
git checkout --quiet f975a621f4e7f532fe322e13c4f79495e0a7b2e7 # v0.23.2
git apply "$here/coherence.patch"
# The grammar extends tree-sitter-javascript's; v0.23.2's lockfile pins 0.23.1. Its install scripts never run.
npm install --no-save --ignore-scripts --no-audit --no-fund --silent tree-sitter-javascript@0.23.1
for dialect in typescript tsx; do
  (cd "$dialect" &&
    npm exec --yes --package=tree-sitter-cli@0.27.1 -- tree-sitter generate &&
    npm exec --yes --package=tree-sitter-cli@0.27.1 -- tree-sitter build --wasm --output "$out/tree-sitter-$dialect.wasm")
done
shasum -a 256 "$out/tree-sitter-typescript.wasm" "$out/tree-sitter-tsx.wasm"
