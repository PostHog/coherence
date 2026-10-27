#!/bin/sh
# Builds plugins/typescript's two parsers, tree-sitter-typescript.wasm and tree-sitter-tsx.wasm, from
# tree-sitter-typescript v0.23.2 with coherence.patch applied. Upstream has merged no grammar change since
# v0.23.2 (2024-11), and each of these parse errors hides the declarations after it:
#   - an import type with type arguments, or as an array's element, an indexed type's object, keyof's operand
#     or a type argument: import('x').T<U>, import('x').T[], keyof import('x').T;
#   - a member named in or instanceof (in: T, in?: T, in = 2), or one whose name begins with in (in_progress),
#     on the line after another member;
#   - a bare & in JSX text or a JSX string: Billing & Usage, to="?a=1&b=2", title='Q&'.
# The patch adds test/corpus/coherence*.txt, each fix and each form it must leave as it was (an expression
# continued onto a line by in or instanceof, a character reference) with its whole expected tree, and no
# parser is built until the grammar's own corpus and these pass in both dialects.
# Needs git, node, a C compiler (the corpus runs natively) and Emscripten's emcc 6.0.13: another emcc builds
# other bytes. Writes both parsers over the bundled ones, and fails unless each is the bundled one byte for
# byte; a change to the patch updates the digests below with it.
set -eu
expected_typescript=314d255fcf035dccff13108feb79a0193551240870b994777cf4eebad5d0b86b
expected_tsx=9838eccbe30e93f202a95be62e450c8a67a60e692a73be25982e18fba981f176
emcc --version | head -1 | grep -q ' 6\.0\.13' || { echo "build.sh: needs emcc 6.0.13, found: $(emcc --version 2>/dev/null | head -1)" >&2; exit 1; }
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
ts() { npm exec --yes --package=tree-sitter-cli@0.27.1 -- tree-sitter "$@"; }
for dialect in typescript tsx; do (cd "$dialect" && ts generate); done
# Each dialect's corpus in its own folder, the other dialect's tagged case left out and the tags dropped: the CLI
# cannot load a dialect by name from inside a grammar's own tree.
for dialect in typescript tsx; do
  mkdir -p "$dialect/test/corpus"
  for file in test/corpus/*.txt; do
    [ "$(basename "$file")" = coherence-tsx.txt ] && [ "$dialect" != tsx ] && continue
    sed '/^:language(/d' "$file" > "$dialect/test/corpus/$(basename "$file")"
  done
  other="Type arguments in JSX"; [ "$dialect" = tsx ] && other="Type assertions"
  (cd "$dialect" && ts test -e "^$other\$")
done
for dialect in typescript tsx; do (cd "$dialect" && ts build --wasm --output "$out/tree-sitter-$dialect.wasm"); done
for dialect in typescript tsx; do
  chmod 644 "$out/tree-sitter-$dialect.wasm"
  got=$(shasum -a 256 "$out/tree-sitter-$dialect.wasm" | cut -d' ' -f1)
  eval "want=\$expected_$dialect"
  [ "$got" = "$want" ] || { echo "build.sh: tree-sitter-$dialect.wasm is $got, not $want" >&2; exit 1; }
done
echo "both parsers rebuilt byte for byte"
