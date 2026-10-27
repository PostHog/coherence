#!/bin/sh
# The build phase: builds both parsers from the inputs fetch.sh fetched, compares them with the stock ones, and writes
# the bundled parsers to the folder given only once every check passes. It is meant to run with the network denied:
# build.sh runs it under sandbox-exec on macOS and in docker with --network none on Linux, CI in docker with
# --network none. That denial is the sandbox's or the container's, never this script's: the connection attempt below is
# a tripwire, which catches a build phase started with the network on by mistake, and which a process that wants the
# network can fool (a stubbed net module, a daemon reached over a socket).
#   1. Every file in the inputs folder is one inputs.sha256 lists, at its digest. The upstream grammar is the tree of its
#      pinned commit, read with replace objects ignored, and the files extracted from it are hashed again here and must
#      be the tree inputs.sh pins, so no ref, replace object or graft in the clone has a say in what is built.
#   2. coherence.patch is applied to a copy of that tree, and refused unless all it changes is common/define-grammar.js
#      and common/scanner.h, each a regular file still. The patched grammar is the clean tree with those two files alone
#      taken from it, so a patch has no way to reach the corpus, upstream's or Coherence's, or anything else the checks read.
#   3. The stock grammar (upstream, unpatched) and the patched one are each generated and built, in both dialects, with
#      the pinned tree-sitter CLI, wasi-sdk clang and binaryen wasm-opt.
#   4. Upstream's corpus, read from the clean tree, and Coherence's (corpus/coherence*.txt, in this folder, which the
#      patch cannot write) pass against the patched grammar in both dialects, each case with its whole expected tree.
#   5. compare.mjs parses upstream's corpus, Coherence's, corpus/limits.txt, TypeScript 5.9.3's lib .d.ts files and this
#      repository's src and mods with the stock and the patched parsers, fails on any difference intended-differences.json
#      does not allow, holds every intended difference to each case it names, one region in each, and holds the patched
#      parsers to every expected tree the corpus declares.
#   6. Each patched parser is byte for byte the digest parsers.sha256 records.
# Needs node, git, tar, gzip and a C compiler (the corpus runs natively); the CLI's binaries need macOS, or Linux with
# glibc 2.39 or newer, arm64 or x86-64.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
. "$here/inputs.sh"
[ $# -eq 2 ] || { echo "usage: build-phase.sh <inputs folder> <output folder>" >&2; exit 2; }
inputs=$(cd "$1" && pwd)
out=$2

# A tripwire, not the denial: a connection to any of these, by name or by address, stops a build phase started with the
# network on by mistake before it reads an input. It cannot prove the network is denied (a stubbed net module answers
# it as a denied one would); the sandbox or the container that runs this phase is what denies it.
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

work=$(mktemp -d)
# The clean tree is made read-only below, so it is made writable again to be removed.
trap 'chmod -R u+w "${work:?}" 2>/dev/null; rm -rf "${work:?}"' EXIT
# git with no configuration but its own, and no repository but the one given: no global attributes, filters or hooks.
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CEILING_DIRECTORIES="$work"
clone() { git --no-replace-objects -c safe.directory='*' -C "$inputs/tree-sitter-typescript" "$@"; }
# Folders' files hashed as git trees, every file of each, in a repository of this build's own.
hashes="$work/hashes.git"
git init --quiet --bare "$hashes"
tree_of() (cd "$1" && export GIT_DIR="$hashes" GIT_WORK_TREE=. GIT_INDEX_FILE="$hashes/index.$2" && git -c core.autocrlf=false add --all --force && git write-tree)

# 1. The upstream tree: its pinned commit's, every file of it hashed again here. The clone's refs, replace objects and
# working files say nothing: only a tree whose hash is the one inputs.sh pins is built from or read as upstream's corpus.
mkdir "$work/upstream"
clone archive --format=tar "$upstream_commit" | tar -xf - -C "$work/upstream"
got=$(tree_of "$work/upstream" upstream)
[ "$got" = "$upstream_tree" ] || { echo "build-phase.sh: upstream's commit $upstream_commit extracts as the tree $got, not $upstream_tree" >&2; exit 1; }
chmod -R a-w "$work/upstream"

# 2. The patch, applied to a copy of the clean tree, may change the two files it is for and nothing else.
cp -R "$work/upstream" "$work/applied" && chmod -R u+w "$work/applied"
(cd "$work/applied" && git apply "$here/coherence.patch")
allowed=$(printf ':100644 100644 M\t%s\n' common/define-grammar.js common/scanner.h)
applied=$(tree_of "$work/applied" applied)
# One line per path changed, with its modes and status, as git diff-tree --raw prints it, renames unpaired.
changed=$(git --git-dir="$hashes" diff-tree -r --raw --no-renames --abbrev=40 "$upstream_tree" "$applied")
outside=$(printf '%s\n' "$changed" | sed 's/ [0-9a-f]\{40\} [0-9a-f]\{40\} / /' | grep -vxF "$allowed" || true)
[ -z "$outside" ] || { printf 'build-phase.sh: coherence.patch may change common/define-grammar.js and common/scanner.h alone, as regular files; it changes:\n%s\n' "$outside" >&2; exit 1; }

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

# 3. Each grammar a copy of the clean tree; the patched one takes the two files the patch is for from the applied copy,
# and nothing else from it.
for tree in stock patched; do
  mkdir "$work/$tree-wasm"
  cp -R "$work/upstream" "$work/$tree" && chmod -R u+w "$work/$tree"
  rm -rf "$work/$tree/test"
  # The grammar extends tree-sitter-javascript's; v0.23.2's lockfile pins 0.23.1.
  mkdir -p "$work/$tree/node_modules/tree-sitter-javascript"
  tar -xzf "$inputs/$javascript_file" -C "$work/$tree/node_modules/tree-sitter-javascript" --strip-components=1
done
for file in common/define-grammar.js common/scanner.h; do cp "$work/applied/$file" "$work/patched/$file"; done
rm -rf "$work/applied"
for tree in stock patched; do
  for dialect in typescript tsx; do (cd "$work/$tree/$dialect" && ts generate); done
done

# 4. Each dialect's corpus in its own folder of the patched grammar, from the clean tree's test/corpus and this folder's
# coherence*.txt: the other dialect's tagged case left out and the tags dropped, since the CLI cannot load a dialect by
# name from inside a grammar's own tree; coherence-tsx.txt is read by the TSX grammar alone.
cd "$work/patched"
for dialect in typescript tsx; do
  mkdir -p "$dialect/test/corpus"
  for file in "$work/upstream/test/corpus/"*.txt "$here/corpus/"coherence*.txt; do
    [ "$(basename "$file")" = coherence-tsx.txt ] && [ "$dialect" != tsx ] && continue
    sed '/^:language(/d' "$file" > "$dialect/test/corpus/$(basename "$file")"
  done
  other="Type arguments in JSX"; [ "$dialect" = tsx ] && other="Type assertions"
  (cd "$dialect" && ts test -e "^$other\$")
done

for tree in stock patched; do
  for dialect in typescript tsx; do (cd "$work/$tree/$dialect" && ts build --wasm --output "$work/$tree-wasm/tree-sitter-$dialect.wasm"); done
done

# 5. The comparison, over the clean tree's corpus and this folder's.
node "$here/compare.mjs" --runtime "$work/web-tree-sitter" --stock "$work/stock-wasm" --patched "$work/patched-wasm" \
  --intended "$here/intended-differences.json" --cases "$work/upstream/test/corpus" --cases "$here/corpus" \
  --files "$work/typescript/lib" --files "$repo/src" --files "$repo/mods"

# 6. The digests.
for dialect in typescript tsx; do
  want=$(digest_in "$here/parsers.sha256" "tree-sitter-$dialect.wasm")
  got=$(sha256 "$work/patched-wasm/tree-sitter-$dialect.wasm")
  [ -n "$want" ] && [ "$got" = "$want" ] || { echo "build-phase.sh: tree-sitter-$dialect.wasm is $got, not ${want:-a digest parsers.sha256 records}" >&2; exit 1; }
done
mkdir -p "$out"
for dialect in typescript tsx; do cp "$work/patched-wasm/tree-sitter-$dialect.wasm" "$out/" && chmod 644 "$out/tree-sitter-$dialect.wasm"; done
echo "build-phase.sh: both parsers rebuilt byte for byte, and every difference from the stock parsers is intended"
