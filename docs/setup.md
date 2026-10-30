# Setting up Coherence

Coherence needs Node 22.18 or newer on macOS (Apple Silicon) or Linux. The package
is [`@posthog/coherence`](https://www.npmjs.com/package/@posthog/coherence)
on npm, published from this repository with provenance; the dev dependency
is the one way to set Coherence up, and every session start names the
Coherence that runs, its version and where it is. A clone kept beside the
project is no longer a way to run it: the hooks never do.

## Full setup

```text
Set up Coherence in this project, and report what each step found.

1. Install. Run `npm install -D @posthog/coherence@latest` (or `pnpm add -D
   @posthog/coherence@latest`); the steps below use what the latest release
   has. If pnpm's minimumReleaseAge refuses it or resolves an older one, add
   `@posthog/coherence` to `minimumReleaseAgeExclude` in pnpm-workspace.yaml
   (bun: `minimumReleaseAgeExcludes`; Yarn: `npmPreapprovedPackages`). Install
   the package itself, never a checkout. The command is
   `npx --no -- coherence` (call it `coherence` below); `--no` keeps npx from
   fetching an unrelated package if the install is missing, and `--` keeps it
   from taking Coherence's flags, such as `--version`, as its own. Confirm
   with `coherence --version`. Teammates get it from the lockfile.

2. Hooks. Run `coherence hooks install --host claude` (or `--host codex`).
   In Claude Code the tool hooks take effect at once, in the session that
   installed them; from the next session on, every session also starts with
   Coherence's vocabulary, the project's standing, and the exact journal
   commands.
   The hook settings are what reach every other session, so they are
   committed: if .gitignore keeps `.claude/settings.json` (or
   `.codex/hooks.json`) out of git, add an exception for that one file, such
   as `!.claude/settings.json`, unless I tell you I strongly prefer to keep
   it uncommitted (then install with `--local` and say that teammates' agents
   will run without Coherence).

3. Adopt. Run `coherence query practice "adopt Coherence"` and work through
   it: config, vocabulary, specs and entrances, the invariants that matter
   most, refutations, baselines, and the methods the project already has.
   Each step names the practice or command that carries it; a practice is
   delivered whole when its command is about to run. The references it
   points at ship with the package: docs/config.md (every config key) and
   docs/spec.md (the spec and practice grammar). When done, record it:
   `coherence enact "adopt Coherence" --step <n>=done|deviated:<why>|skipped:<why> ...`.

4. CI. Ask me whether pull requests should fail on Coherence's findings or
   get one report comment, then run `coherence ci install --host github
   --mode fail` (or `--mode comment`) with `--write`.

Record every non-obvious choice with `coherence decide "<chose>" --over
"<rejected>" --because "<why>" --session <id> --agent <name>`.
```

Adoption is a practice rather than prose so that its steps arrive where
their commands run, its pitfalls cite what went wrong in earlier adoptions,
and the enactment is a durable record of how the project was adopted
(`coherence query practice` lists every practice).

The installed hooks run the project's installed package; where it is not
installed, the session start says so in one line and tells the agent how to
install it. Each session start names the Coherence that runs and its
version. Hooks an earlier release wrote also looked at a `../coherence`
clone beside the project, before the installed package, and keep running
that clone until they are reinstalled: if one sits beside your project, run
`npx --no -- coherence hooks install --host claude` (or `--host codex`)
after upgrading, since the clone cannot tell you so. Once the installed
package runs, the session start and `coherence hooks --check` name hooks of
that earlier form with the same command. To run a project against a
Coherence checkout you are developing, see
[Working on Coherence itself](https://github.com/PostHog/coherence/blob/main/CONTRIBUTING.md#working-on-coherence-itself).
To add the project's own words to an event, write
`.coherence/hooks/<Event>.append.md` (it follows what the hook says) or
`.coherence/hooks/<Event>.override.md` (it replaces it; an empty one silences
the event). `{{session}}`, `{{agent}}` and `{{cli}}` are filled in; a refused
subagent stop keeps its reason whatever the override says.

## Adopting part of a monorepo

Coherence can own one folder of a large repository, or several, and leave the
rest alone: an edit, command or prompt outside every adopted folder gets no
orient, practice or check, leaves no record, and costs a constant.

**Try it on one folder, alone.** Put `coherence.config.json`, the specs and
`.coherence/` in the folder (say `products/billing`), and nothing at the
repository root. Run `coherence hooks install --host claude --local` from that
folder: it writes your personal `.claude/settings.local.json` at the root, so
nobody else's sessions change. (Without `--local` it writes the shared
`.claude/settings.json` at the root, where a host started there reads it.
`--local` is Claude Code only; Codex has no personal settings file.) A session
at the root hears one line at its start and gets the folder's orient with its
first edit or command inside it.

**Commit to it, folder by folder.** Run `coherence adopt <folder>` for each
folder a team takes on. It lists the folder under `projects` in a
`coherence.config.json` at the repository root: a registry, not a project. Every
listed folder inherits the registry's keys (languages, test setups, `ignore`,
`references`, `latencyBudget`) unless its own config overrides one, and keeps
its own specs, journal and runs. Hooks are installed once, at the root. A
nested config the registry does not list is named by `spec --check` as
adopted but not opted in. `adopt` will not turn a whole-repository config into
a registry; that move is yours to make by hand.

**Callers outside the folder.** A product boundary's bypasses usually live
elsewhere in the repository. By default a chokepoint's reference search covers
the adopted folder only, and its verdict says so. `references` widens it:
`"repository"`, or a list of folders such as `["posthog/api", "ee"]`.

**Boundaries the repository already declares.** Where a `tach.toml` declares
the modules, `coherence scaffold import tach <module>` drafts each one's spec:
its dependencies, its exposed facade as a chokepoint governing references from
outside the component (`from: outside the component`), and its owners from
`product.yaml`.

Paste this into your agent to adopt one folder:

```text
Adopt Coherence for <folder> only. Install @posthog/coherence@latest as a dev dependency (with pnpm, if minimumReleaseAge holds it back, add it to minimumReleaseAgeExclude) and run `npx --no -- coherence hooks install --host claude --local` from <folder>.
Run `npx --no -- coherence adopt <folder>` from the repository root if this repository keeps a registry of adopted folders.
Then run `npx --no -- coherence query practice "adopt Coherence"` from <folder>, work through it, record it with `enact`, and tell me what each step found.
Ask me whether pull requests should fail on Coherence's findings or get a report comment, then run `npx --no -- coherence ci install --host github --mode fail` (or `--mode comment`) with `--write`.
```

Every key is in [config.md](config.md).

## Platform

Coherence runs on Node 22.18 or newer, on macOS (Apple Silicon) or Linux, and
reads TypeScript, Python and Rust projects, and projects that span more than
one (a Python backend beside a TypeScript frontend: list both languages and a
test setup per runner, as [docs/config.md](config.md#more-than-one-language) shows).
Rust chokepoints are graded through rust-analyzer, found on the machine rather
than installed by npm ([enforcement.md](enforcement.md#rust)); the
economy and Scope readings read Rust's text by its crates' folder layout, and detect its
binaries, examples, build scripts, routes and foreign exports (C, wasm-bindgen and
UniFFI, an exported impl's methods among them) as entrances; a declared mirror
reads a Rust list from the array a const or static is set to.
Go is an opt-in bundled plugin, `"plugins": { "go": "bundled" }`, graded
through gopls ([plugins.md](plugins.md#go)); a language Coherence
lacks is a plugin you can write, held by `coherence plugin check` to what every
language plugin owes.
It works inside Claude Code and Codex. Where the project already runs a
checker that refuses a boundary crossing, Coherence grades by it: Pyright's
private-usage rule, an import-linter rule, or a `tach.toml` interface
(where tach's own check refuses a planted outside import, and the chokepoint is
graded checker-choked by tach). Coherence's own reference search still covers
what such a checker cannot see.
Coherence verifies itself: every screenshot in these docs is its own Scope reading.

The language adapters ask tsserver, Pyright and rust-analyzer for references. Where a Python
project runs a checker that refuses a bypass, the chokepoint is graded on that
checker: Pyright's reportPrivateUsage, an import-linter rule, or
[tach](https://github.com/gauge-sh/tach). When the nearest `tach.toml` declares
an interface that exposes the chokepoint and not the protected thing, tach is
the enforcer: a module's own code may use its internals, an import tach refuses
is the bypass, and tach's refusal of an import staged in a throwaway copy is
the refutation. tach runs whole at `run` (about two seconds on PostHog) and, at
an edit, only over the edited Python files inside a tach module. See
[spec.md](spec.md#the-bullet).
