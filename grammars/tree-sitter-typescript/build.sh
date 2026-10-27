#!/bin/sh
# Builds plugins/typescript's two parsers, tree-sitter-typescript.wasm and tree-sitter-tsx.wasm, from
# tree-sitter-typescript v0.23.2 with coherence.patch applied. Upstream has merged no grammar change since
# v0.23.2 (2024-11), and each of these parse errors hides the declarations after it:
#   - an import type with type arguments, or as an array's element, an indexed type's object, keyof's operand
#     or a type argument: import('x').T<U>, import('x').T[], keyof import('x').T;
#   - a member named in or instanceof (in: T, in?: T, in = 2), or one whose name begins with in (in_progress,
#     in$, inü), on the line after another member;
#   - a bare & in JSX text or a JSX string: Billing & Usage, to="?a=1&b=2", title='Q&'.
# The patch adds test/corpus/coherence*.txt, each fix and each form it must leave as it was (an expression
# continued onto a line by in or instanceof, a character reference at its limits) with its whole expected
# tree, and no parser is built until the grammar's own corpus and these pass in both dialects.
#
# Every input is pinned by its digest: the upstream commit, tree-sitter-javascript's package, and the
# compiler the parsers are built with, tree-sitter-cli 0.27.1's binary, the wasi-sdk 34 clang and binaryen
# 132's wasm-opt it compiles and optimizes with, each fetched here and checked before it runs (the CLI would
# otherwise download its compiler unchecked). Needs git, node and npm, curl, tar, gzip, and a C compiler for
# the corpus, which runs natively; on macOS or Linux, arm64 or x86-64. Builds into a folder of its own and
# writes the bundled parsers only once each is byte for byte the digest below; a change to the patch updates
# the digests with it.
set -eu
expected_typescript=314d255fcf035dccff13108feb79a0193551240870b994777cf4eebad5d0b86b
expected_tsx=fe56e358812e52df988a2026089650b7ea7d61e9acf0e0f6a1f197c5ab698541
here=$(cd "$(dirname "$0")" && pwd)
out=$(cd "$here/../../plugins/typescript" && pwd)
work=$(mktemp -d)
trap 'rm -rf "${work:?}"' EXIT

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
# fetch <url> <sha256> <file>: download, and fail unless the file is the digest given.
fetch() {
  curl --fail --silent --show-error --location --output "$3" "$1"
  got=$(sha256 "$3")
  [ "$got" = "$2" ] || { echo "build.sh: $1 is $got, not $2" >&2; exit 1; }
}
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) cli=macos-arm64 cli_sha=46cb97d9a2c52c94e22d9a76c2f1116156b8b61f98360e2a9cce05fcb197cd4d
    sdk=arm64-macos sdk_sha=9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9
    opt=arm64-macos opt_sha=98aad827847af7ef990ed7098d885725c8e5b5aae75073403635617ae4e259aa ;;
  Darwin-x86_64) cli=macos-x64 cli_sha=b740262cb0f35be64e39b50ad68b020433924a7bcee5ae5c8e40e68d71215647
    sdk=x86_64-macos sdk_sha=87d27fa8adc68dee59bfbf2e22a6d34ef717c34d6bf1d8af2a56fc929d9ce0eb
    opt=x86_64-macos opt_sha=40c3de90bb3766bd0282a895e139a6f50253dba49b4f5bb89e66faca162d832e ;;
  Linux-x86_64) cli=linux-x64 cli_sha=d01042f94ba3d6827ddc9788e235f75d8366431be42bdf90ade534d960c98b7d
    sdk=x86_64-linux sdk_sha=b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4
    opt=x86_64-linux opt_sha=195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572 ;;
  Linux-aarch64 | Linux-arm64) cli=linux-arm64 cli_sha=404be5d54a4955571c4067c21d4699660eab3a534cefb0659341b207f7139ec5
    sdk=arm64-linux sdk_sha=f7e243dff54d60bcc576e94d6166b69f410f2500ae4a9ceef34315be10e77971
    opt=aarch64-linux opt_sha=c58562417836c5d0493d89bdefc434933bdc097db641b483df86bcfa557a107f ;;
  *) echo "build.sh: no pinned compiler for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
fetch "https://github.com/tree-sitter/tree-sitter/releases/download/v0.27.1/tree-sitter-$cli.gz" "$cli_sha" "$work/tree-sitter.gz"
gunzip "$work/tree-sitter.gz" && chmod 755 "$work/tree-sitter"
fetch "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-$sdk.tar.gz" "$sdk_sha" "$work/wasi-sdk.tar.gz"
mkdir "$work/wasi-sdk" && tar -xzf "$work/wasi-sdk.tar.gz" -C "$work/wasi-sdk" --strip-components=1
fetch "https://github.com/WebAssembly/binaryen/releases/download/version_132/binaryen-version_132-$opt.tar.gz" "$opt_sha" "$work/binaryen.tar.gz"
mkdir "$work/binaryen" && tar -xzf "$work/binaryen.tar.gz" -C "$work/binaryen" --strip-components=1
# The CLI compiles with these and nothing it downloads, and keeps its caches and configuration (the corpus's native
# parsers among them) in this build's own folder, so no other build's parser is ever tested in place of this one's.
export TREE_SITTER_WASI_SDK_PATH="$work/wasi-sdk" TREE_SITTER_BINARYEN_PATH="$work/binaryen"
export XDG_CACHE_HOME="$work/cache" XDG_CONFIG_HOME="$work/config" TREE_SITTER_LIBDIR="$work/cache/lib"
ts() { "$work/tree-sitter" "$@"; }

git clone --quiet https://github.com/tree-sitter/tree-sitter-typescript "$work/grammar"
cd "$work/grammar"
git checkout --quiet f975a621f4e7f532fe322e13c4f79495e0a7b2e7 # v0.23.2
git apply "$here/coherence.patch"
# The grammar extends tree-sitter-javascript's; v0.23.2's lockfile pins 0.23.1, unpacked here from its checked tarball.
fetch "https://registry.npmjs.org/tree-sitter-javascript/-/tree-sitter-javascript-0.23.1.tgz" 90e80b25a67517a4daf6ad751557bee21efbda7b7a5a554897933245d1734398 "$work/tree-sitter-javascript.tgz"
mkdir -p node_modules/tree-sitter-javascript && tar -xzf "$work/tree-sitter-javascript.tgz" -C node_modules/tree-sitter-javascript --strip-components=1
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
mkdir "$work/out"
for dialect in typescript tsx; do (cd "$dialect" && ts build --wasm --output "$work/out/tree-sitter-$dialect.wasm"); done
for dialect in typescript tsx; do
  got=$(sha256 "$work/out/tree-sitter-$dialect.wasm")
  eval "want=\$expected_$dialect"
  [ "$got" = "$want" ] || { echo "build.sh: tree-sitter-$dialect.wasm is $got, not $want" >&2; exit 1; }
done
for dialect in typescript tsx; do cp "$work/out/tree-sitter-$dialect.wasm" "$out/" && chmod 644 "$out/tree-sitter-$dialect.wasm"; done
echo "both parsers rebuilt byte for byte"
