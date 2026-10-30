# Contributing to Coherence

## Working on Coherence itself

From this checkout, the commands run as `node src/cli.ts <command>`; in a project that installed the package, each is `coherence <command>` (`npx --no -- coherence`):

```sh
node src/cli.ts journal                   # merged project history across every session
node src/cli.ts journal --subjects        # subjects and a cursor; --since <cursorOrIso> reads what followed
node src/cli.ts lexicon                  # the compact form the hook injects; token estimate on stderr
node src/cli.ts lexicon --check [paths]  # rejected names and unknown nouns; exit 1 with findings
node src/cli.ts spec --check [root]       # components, invariants with state, problems; exit 1 on problems
node src/cli.ts spec --json [root]        # the spec model
node src/cli.ts scaffold component <folder> "<intent>"
node src/cli.ts scaffold invariant <folder> "<sentence>" --kinds a,b [--chokepoint|--totality-oracle] [--write]
node src/cli.ts scaffold control "<entrance>" [--whole]   # the closure for an entrance with no traced control; unrecorded, it reads only the components its route enters
node src/cli.ts scaffold import tach [<module>...] | --all [--write]   # a draft spec per module from tach.toml; --write creates only specs that do not exist
node src/cli.ts enact "<practice>" --step <n>=done[:<evidence>]|deviated:<why>|skipped:<why>...   # record a practice carried out
node src/cli.ts run [--session --agent]   # the chokepoint check and the totality oracle pass, one run appended; exit 1 on a structural defect
node src/cli.ts run --status              # the latest verdict per enforcement, a view over every run
node src/cli.ts run --each                # after the batched pass, each totality oracle's test in its own invocation, a second run; exit 1 if one fails alone
node src/cli.ts serve [--language <l>]    # the warm language server for this project and language (spawned on demand otherwise)
node src/cli.ts hook <event>              # answer one harness event (event JSON on stdin)
node src/cli.ts hooks install --host claude|codex [--command "<prefix>"]
node src/cli.ts hooks install --host claude --mod [--shared]   # the mod in place of the settings hooks: yours, or the team's in the committed settings
node src/cli.ts hooks uninstall --host claude|codex   # removes only Coherence's commands; other hooks and settings stay byte for byte
node src/cli.ts hooks --check --host claude|codex     # exit 1 naming each event missing, stale, or extra against what install would write
node src/cli.ts hooks status                          # the wiring per agent host, and what each event delivers for this project
node src/cli.ts ci install --host github --mode fail|comment [--write]   # the workflow that runs Coherence on every pull request; never over a file already there
node src/cli.ts ci report --session <id> [--base <commit>]   # the pull request report as Markdown, from that session's run; --base marks findings in files changed since that commit (on GitHub Actions, the pull request's base branch by default)
npm run spec:check                        # the spec check alone
npm test                                  # typecheck, tests, vocabulary check, spec check; any one failing fails the tree
```

A project names its own lexicon under `lexicon` in `coherence.config.json`
(default: `lexicon.json` at the root). A project still carrying the file under
the concept's retired name is refused with the one-line `git mv` that migrates
it; the old name is never read. SessionStart and SubagentStart inject
both layers with a short instruction, the journal read command, and a decision
write template. In Claude Code this checkout runs Coherence through its mod,
linked from `.claude/skills/coherence` to the tree's own `mods/coherence`:
every session here, in the main checkout and in each worktree, loads that
tree's mod and answers its events through one warm process running that
tree's `src/cli.ts`, and an interactive session reloads the mod when a file
of it is saved. A copy of the mod installed for this repository or for you
(`hooks install --mod`, `/plugin install`) would take its name first and run
instead; the mod says so when it starts, and `hooks --check --host claude`
names one installed for this repository. Codex keeps its settings hooks in `.codex/hooks.json`.
`node src/cli.ts hooks status` reports their installation and what each event
carries here (orient at the starts, the peer feed at prompt and tool boundaries,
a practice before a tool use that fires it, regulate at the stops), and `hooks --check` is the CI form. Stop reports the check
over changed files; SubagentStop refuses the stop (exit 2, reason on stderr) while findings remain.

### Running a project against your checkout

To try a change to Coherence in another project before it is published, keep
the project's hooks as they are and point them at your checkout:

```sh
export COHERENCE_HOME=~/Dev/coherence   # in the shell that starts claude or codex
```

The hooks the project commits run the checkout `$COHERENCE_HOME` names
instead of the installed package, and each session start says so (`the
checkout COHERENCE_HOME names`) and names the installed package when its
version differs. Unset it to go back. A project that commits no Coherence
hooks can instead keep a personal hook naming the checkout's cli:
`node ~/Dev/coherence/src/cli.ts hooks install --host claude --local
--command "node ~/Dev/coherence/src/cli.ts"` writes it to
`.claude/settings.local.json`, which is never committed (`hooks --check`
takes the same `--local --command`). Do not do both: a personal hook beside
the shared one answers every event twice. In Coherence's own repository and
its git worktrees, the hooks always run that tree's own source.

## Lexicon workflow

Coverage, preview/apply maintenance, sense review, drafting, incremental checks,
and optional local similarity are described in [Lexicon operations](https://github.com/PostHog/coherence/blob/main/docs/lexicon-operations.md).
Run `coherence lexicon help` for the command surface. Coverage counts
observations and unresolved questions; it is not a semantic-completeness score.

## Test setup

Use Node 22.18 or newer, Python 3.10 or newer, and a Rust toolchain with
rust-analyzer. From the checkout root:

```sh
npm ci
npm run test:setup
rustup component add rust-analyzer rust-src
npm test
```

`test:setup` creates `.venv` and installs the pinned pytest version and tach
(`~=0.34`, as PostHog pins it) from `requirements-test.txt`; it does not change
the system Python. A missing tach fails the tach tests with setup instructions.
`COHERENCE_TACH` names the tach binary to use, and nothing else is looked for. Run it again
when that file changes. The environment is ignored by git. Tests themselves
never install dependencies or need a network connection.

`npm test` includes the real pytest integration, not just its report reader.
A missing interpreter or pytest is a failure with setup instructions, not a
skip. `npm run test:python` runs the Python adapter tests alone. The Rust
adapter tests (`src/adapters/rust.test.ts`) drive a real rust-analyzer the same
way: a missing one fails them, with the rustup command to install it.

The tests find `.venv/bin/python` relative to this checkout, even when their
working directory differs. Set `COHERENCE_PYTHON` to use another interpreter
with pytest; an invalid override fails instead of falling back silently.
During `test:setup`, the same variable selects the Python that creates `.venv`.

## Releasing

The package is `@posthog/coherence` on npm. `npm run build` compiles `src`
into `dist` (Node will not strip types under node_modules) and carries the
files the compiled modules read: data, the stylesheet, the Scope browser
sources already stripped, and the one font file with its license. The build
runs as `prepare`, so `npm ci`, `npm pack` and an install from the git
repository all build. `node-llama-cpp` is an optional peer: a project that
wants the local embedding pass installs it beside Coherence.

To release, merge a change that bumps `version` in package.json, and the same
`version` in `mods/coherence/.claude-plugin/plugin.json` and in each bundled
plugin that ships at the package's version (`plugins/declared`, `python`,
`rust` and `typescript`; tests hold them equal), into main.
The Release workflow sees a version npm does not have, publishes it through
npm trusted publishing from `.github/workflows/release.yml` in the `Release`
environment, with provenance and no stored token, and tags it as a GitHub
release with generated notes. Any other change to package.json releases
nothing. The workflow can also be run by hand from the Actions tab.

A prerelease of a branch, before it merges, is a GitHub prerelease carrying
the tarball, never npm. Bump the versions as above to a prerelease
(`1.11.0-beta.4`), merge main into the branch, push it, and run the
Prerelease workflow:

```sh
gh workflow run prerelease.yml -f ref=<branch> -f notes="$(cat notes.md)"
```

`.github/workflows/prerelease.yml` checks the branch out clean at its tip,
with read access alone, and refuses (naming each reason) unless the version is
a prerelease that every bundled plugin and mod following the package names,
the commit is on a branch of PostHog/coherence and holds its main, and no tag
of the version exists; then it packs the tarball there, installs it in an
empty folder and runs `coherence plugin check typescript` and `plugin check
python` from it. A second job, the only one that can write, tags that
commit's sha and creates the prerelease on the tag, carrying the tarball.
Nothing is cut from a local checkout.

## Further reading

- `Coherence.spec.md` and the `*.spec.md` file in each folder under `src/`: Coherence's own trust levels and invariants, in its own grammar.
- `docs/lexicon.json`: the settled vocabulary; `docs/lexicon.md`: why the lexicon is first-class, with the evidence.
- `docs/spec.md`, `docs/enforcement.md`, `docs/journal.md`, `docs/economy.md`, `docs/observation.md`, `docs/scope-shell.md`: how each part works.
- `docs/checklist-seed.json`: the invariant shapes behind the decomposition checklist.
- `docs/retired.md`: mechanisms retired during the rebuild, with reasons.
- `docs/reference/data-is-destiny.md`: "Data is destiny" (Danilo Campos, CC BY-SA 4.0), the essay behind Scope.
