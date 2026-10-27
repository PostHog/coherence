#!/bin/sh
# The build phase: builds both parsers from the inputs fetch.sh fetched, compares them with the stock ones, and writes
# the bundled parsers to the folder given only once every check passes. It runs with no network, and refuses to run
# where it can reach the network, so nothing it does can download what inputs.sha256 does not pin: build.sh runs it
# under sandbox-exec or unshare -rn, CI in docker with --network none.
#   1. Every file in the inputs folder is one inputs.sha256 lists, at its digest, and the upstream clone is at its
#      pinned commit; the grammar is read from that commit's tree, never the clone's working files.
#   2. The stock grammar (upstream, unpatched) and the patched one (coherence.patch applied) are each generated and
#      built, in both dialects, with the pinned tree-sitter CLI, wasi-sdk clang and binaryen wasm-opt.
#   3. The grammar's own corpus and Coherence's (test/corpus/coherence*.txt) pass against the patched grammar in both
#      dialects, each with its whole expected tree.
#   4. compare.mjs parses tree-sitter-typescript's corpus, Coherence's, corpus/limits.txt, TypeScript 5.9.3's lib
#      .d.ts files and this repository's src and mods with the stock and the patched parsers, and fails on any
#      difference intended-differences.json does not allow.
#   5. Each patched parser is byte for byte the digest parsers.sha256 records.
# Needs node, git, tar, gzip and a C compiler (the corpus runs natively); the CLI's binaries need macOS, or Linux with
# glibc 2.39 or newer, arm64 or x86-64.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
. "$here/inputs.sh"
[ $# -eq 2 ] || { echo "usage: build-phase.sh <inputs folder> <output folder>" >&2; exit 2; }
inputs=$(cd "$1" && pwd)
out=$2

# No network: a connection to any of these, by name or by address, stops the build before it reads an input.
node -e '
  const net = require("node:net");
  const hosts = ["github.com", "registry.npmjs.org", "objects.githubusercontent.com", "1.1.1.1", "8.8.8.8", "140.82.112.3"];
  Promise.all(hosts.map((host) => new Promise((done) => {
    const socket = net.connect({ host, port: 443, timeout: 5000 });
    socket.on("connect", () => { socket.destroy(); done(host); });
    socket.on("timeout", () => { socket.destroy(); done(null); });
    socket.on("error", () => done(null));
  }))).then((reached) => {
    const open = reached.filter((host) => host !== null);
    if (open.length > 0) { console.error(`build-phase.sh: reached ${open.join(", ")}; run the build phase where the network is denied (build.sh does)`); process.exit(1); }
  });
'

# The inputs, each at its digest, and nothing else beside them.
for path in "$inputs"/* "$inputs"/.[!.]*; do
  [ -e "$path" ] || continue
  file=$(basename "$path")
  [ "$file" = tree-sitter-typescript ] && continue
  want=$(digest_in "$here/inputs.sha256" "$file")
  [ -n "$want" ] || { echo "build-phase.sh: $file is no input inputs.sha256 lists" >&2; exit 1; }
  got=$(sha256 "$path")
  [ "$got" = "$want" ] || { echo "build-phase.sh: $file is $got, not $want" >&2; exit 1; }
done
for file in $input_files; do [ -f "$inputs/$file" ] || { echo "build-phase.sh: no $file in $inputs" >&2; exit 1; }; done
clone() { git -c safe.directory='*' -C "$inputs/tree-sitter-typescript" "$@"; }
[ "$(clone rev-parse HEAD)" = "$upstream_commit" ] || { echo "build-phase.sh: the upstream clone is not at $upstream_commit" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "${work:?}"' EXIT
gunzip -c "$inputs/$cli_file" > "$work/tree-sitter" && chmod 755 "$work/tree-sitter"
mkdir "$work/wasi-sdk" "$work/binaryen" "$work/typescript" "$work/web-tree-sitter"
tar -xzf "$inputs/$sdk_file" -C "$work/wasi-sdk" --strip-components=1
tar -xzf "$inputs/$opt_file" -C "$work/binaryen" --strip-components=1
tar -xzf "$inputs/$typescript_file" -C "$work/typescript" --strip-components=1
tar -xzf "$inputs/$runtime_file" -C "$work/web-tree-sitter" --strip-components=1
# The CLI compiles with these and nothing else, and keeps its caches and configuration (the corpus's native parsers
# among them) in this build's own folder, so no other build's parser is ever tested in place of this one's.
export TREE_SITTER_WASI_SDK_PATH="$work/wasi-sdk" TREE_SITTER_BINARYEN_PATH="$work/binaryen"
export XDG_CACHE_HOME="$work/cache" XDG_CONFIG_HOME="$work/config" TREE_SITTER_LIBDIR="$work/cache/lib"
ts() { "$work/tree-sitter" "$@"; }

for tree in stock patched; do
  mkdir "$work/$tree" "$work/$tree-wasm"
  clone archive --format=tar "$upstream_commit" | tar -xf - -C "$work/$tree"
  # The grammar extends tree-sitter-javascript's; v0.23.2's lockfile pins 0.23.1.
  mkdir -p "$work/$tree/node_modules/tree-sitter-javascript"
  tar -xzf "$inputs/$javascript_file" -C "$work/$tree/node_modules/tree-sitter-javascript" --strip-components=1
done
(cd "$work/patched" && git apply "$here/coherence.patch")
for tree in stock patched; do
  for dialect in typescript tsx; do (cd "$work/$tree/$dialect" && ts generate); done
done

# Each dialect's corpus in its own folder, the other dialect's tagged case left out and the tags dropped: the CLI
# cannot load a dialect by name from inside a grammar's own tree.
cd "$work/patched"
for dialect in typescript tsx; do
  mkdir -p "$dialect/test/corpus"
  for file in test/corpus/*.txt; do
    [ "$(basename "$file")" = coherence-tsx.txt ] && [ "$dialect" != tsx ] && continue
    sed '/^:language(/d' "$file" > "$dialect/test/corpus/$(basename "$file")"
  done
  other="Type arguments in JSX"; [ "$dialect" = tsx ] && other="Type assertions"
  (cd "$dialect" && ts test -e "^$other\$")
done

for tree in stock patched; do
  for dialect in typescript tsx; do (cd "$work/$tree/$dialect" && ts build --wasm --output "$work/$tree-wasm/tree-sitter-$dialect.wasm"); done
done

node "$here/compare.mjs" --runtime "$work/web-tree-sitter" --stock "$work/stock-wasm" --patched "$work/patched-wasm" \
  --intended "$here/intended-differences.json" --cases "$work/patched/test/corpus" --cases "$here/corpus" \
  --files "$work/typescript/lib" --files "$repo/src" --files "$repo/mods"

for dialect in typescript tsx; do
  want=$(digest_in "$here/parsers.sha256" "tree-sitter-$dialect.wasm")
  got=$(sha256 "$work/patched-wasm/tree-sitter-$dialect.wasm")
  [ -n "$want" ] && [ "$got" = "$want" ] || { echo "build-phase.sh: tree-sitter-$dialect.wasm is $got, not ${want:-a digest parsers.sha256 records}" >&2; exit 1; }
done
mkdir -p "$out"
for dialect in typescript tsx; do cp "$work/patched-wasm/tree-sitter-$dialect.wasm" "$out/" && chmod 644 "$out/tree-sitter-$dialect.wasm"; done
echo "build-phase.sh: both parsers rebuilt byte for byte, and every difference from the stock parsers is intended"
