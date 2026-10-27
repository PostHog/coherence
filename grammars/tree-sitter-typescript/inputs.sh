# Sourced by fetch.sh and build-phase.sh: the inputs this machine builds from, by the file names inputs.sha256 lists
# their digests under, where each comes from, and the upstream commit and its tree. Defines names and helpers and runs nothing.
upstream=https://github.com/tree-sitter/tree-sitter-typescript
upstream_commit=f975a621f4e7f532fe322e13c4f79495e0a7b2e7 # v0.23.2
# That commit's tree: the build phase hashes the files it extracts from the commit and builds from them only when they are this tree.
upstream_tree=4c27006c60e37ddd0c30a4afecab363dc9d84575
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) cli=macos-arm64 sdk=arm64-macos opt=arm64-macos ;;
  Darwin-x86_64) cli=macos-x64 sdk=x86_64-macos opt=x86_64-macos ;;
  Linux-x86_64) cli=linux-x64 sdk=x86_64-linux opt=x86_64-linux ;;
  Linux-aarch64 | Linux-arm64) cli=linux-arm64 sdk=arm64-linux opt=aarch64-linux ;;
  *) echo "inputs.sh: no pinned compiler for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
cli_file=tree-sitter-$cli.gz
sdk_file=wasi-sdk-34.0-$sdk.tar.gz
opt_file=binaryen-version_132-$opt.tar.gz
javascript_file=tree-sitter-javascript-0.23.1.tgz
typescript_file=typescript-5.9.3.tgz
runtime_file=web-tree-sitter-0.27.1.tgz
input_files="$cli_file $sdk_file $opt_file $javascript_file $typescript_file $runtime_file"
# The image the build phase runs in on Linux, with --network none, in CI and from build.sh: node 22.18 on Debian trixie
# (glibc 2.41, which the CLI's binary needs, with gcc and git), pinned by digest.
build_image=node:22.18.0-trixie@sha256:5329a2a013f6a49e8698609f9b20aa9aac670672ab6d88af73e3517cd79790e7

url_of() {
  case $1 in
    "$cli_file") echo "https://github.com/tree-sitter/tree-sitter/releases/download/v0.27.1/$1" ;;
    "$sdk_file") echo "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/$1" ;;
    "$opt_file") echo "https://github.com/WebAssembly/binaryen/releases/download/version_132/$1" ;;
    "$javascript_file") echo "https://registry.npmjs.org/tree-sitter-javascript/-/$1" ;;
    "$typescript_file") echo "https://registry.npmjs.org/typescript/-/$1" ;;
    "$runtime_file") echo "https://registry.npmjs.org/web-tree-sitter/-/$1" ;;
    *) echo "inputs.sh: no source for $1" >&2; exit 1 ;;
  esac
}
# The digest a list (inputs.sha256, parsers.sha256) records for a file name, or nothing.
digest_in() { awk -v name="$2" '$2 == name { print $1 }' "$1"; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
