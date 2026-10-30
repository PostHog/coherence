# Coherence

Coherence slots into your agent's hooks to give it the structural information, decision history, and project context to make every edit smarter. You sweep up fewer messes on every review. It also gives you clearer insight into your project and the agents who are building it, so you can move with confidence.

Agent-assisted software development is great—for AI labs and their income statements. Coherence exists to make it great for everyone else.

The status quo of development using LLMs is comical: we use inference to generate code, then we use more inference to ask if that code is good. Meanwhile, our projects become more and more opaque.

Breaking this cycle requires tools for correctness that are cheap, fast, and don't rely on pure inference.

## Quick start

Paste this into your agent:

```text
Install @posthog/coherence@latest as a dev dependency (with pnpm, if minimumReleaseAge holds it back, add it to minimumReleaseAgeExclude) and run `npx --no -- coherence hooks install --host claude` (or `--host codex`).
If .gitignore keeps the hook settings it wrote (.claude/settings.json or .codex/hooks.json) out of git, add an exception for that one file unless I tell you I strongly prefer not to: the hooks are how Coherence reaches every session in this project, and a teammate's agent without them gets no vocabulary, specs, journal or checks.
Then run `npx --no -- coherence query practice "adopt Coherence"`, work through it, record it with `enact`, and tell me what each step found.
Ask me whether pull requests should fail on Coherence's findings or get a report comment, then run `npx --no -- coherence ci install --host github --mode fail` (or `--mode comment`) with `--write`.
```

For the full setup, adopting one folder of a monorepo, and platform requirements, see [docs/setup.md](docs/setup.md).

| | |
|---|---|
| **Supported agents** | <!-- generated: agents -->Claude Code, Codex<!-- /generated --> |
| **Supported languages** | <!-- generated: languages -->TypeScript and JavaScript, Python, Rust, Go (opt-in)<!-- /generated -->; more via [language plugins](docs/plugins.md) |

## How it helps

- A project-specific **lexicon** defines all your terms, keeping agents in sync with historical intent
- Machine-checkable **specs** keep the documentation of your architecture in agreement with the code it describes
- Perturbation-based **test validation**, called refutation, ensures your agents didn’t write fake tests
- **Chokepoints** use your language server to ensure that security-sensitive surfaces are precisely documented and monitored. If an agent bypasses your defined security checks, it's warned immediately.
- Agent **decisions and practices** are stored alongside project code, distilling millions of tokens of context into easy-to-read summaries, preventing re-litigation and re-discovery of settled directions
- A web UI for **understanding your project and its history as it evolves**: a 3D view of its components and how much each changes, with agents' reads and edits lit as they happen, and a view of how components connect and where work enters

When an agent starts diverging from your project's architecture goals, Coherence can detect and warn that agent in the same turn, spending less inference at review time. Instead of accreting entropy and slop, your agents build a compass toward order and complexity reduction.

## Make it yours

Coherence supports these languages:

<!-- generated: language plugins -->
- **TypeScript and JavaScript**, through typescript-language-server
- **Python**, through Pyright, with tach's module boundaries where a project draws them
- **Rust**, through rust-analyzer
- **Go**, through gopls (opt-in: `"plugins": { "go": "bundled" }`)
- **Any language with a language server**, through the server the config declares for it under `languages`: the chokepoint check alone
<!-- /generated -->

And these tools:

<!-- generated: tool plugins -->
- **Convex**, over TypeScript: a Convex function reached through the generated API as a reference, and a deployment's functions, HTTP routes and crons as entrances (opt-in: `"plugins": { "convex": "bundled" }`)
- **Quint**, a verifier: `via: [quint]` and `[quint run]` prove a property of a Quint model (opt-in: `"plugins": { "quint": "bundled" }`)
<!-- /generated -->

Eject any implementation and make it your own. Or plug in your own language, framework or verifier support; your agent can whip up a Coherence plugin within minutes. See [docs/plugins.md](docs/plugins.md).

## Learn more

- [A tour of Coherence](docs/tour.md): each part in depth, with screenshots
- [Setup](docs/setup.md): full setup, monorepos, platforms
- [Telemetry](docs/telemetry.md): off until you opt in, and exactly what is sent if you do
- [Contributing](CONTRIBUTING.md): working on Coherence itself, tests, releases
