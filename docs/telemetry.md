# Telemetry

Coherence can send anonymous fleet telemetry to PostHog, so its maintainers
learn what its hooks cost and which defects recur across installations. It is
off until you turn it on, and nothing is sent before you do.

```sh
coherence telemetry on        # opt in: creates a random installation id
coherence telemetry status    # on or off, and why
coherence telemetry show      # the queued events, exactly as they would be sent
coherence telemetry reset-id  # a new id; what was queued under the old one is dropped
coherence telemetry off       # opt out: the id is forgotten and the queue dropped
```

Your choice and the id live in `$XDG_CONFIG_HOME/coherence/telemetry.json`
(or `~/.config/coherence/`), never in the project. Each of these turns it off
whatever you chose: `DO_NOT_TRACK=1`, `COHERENCE_TELEMETRY=0`, or
`"telemetry": false` in a project's `coherence.config.json` (a project can
refuse for everyone who works in it). The test suite and CI set
`COHERENCE_TELEMETRY=0`.

Every event carries `distinct_id` (the random installation id),
`timestamp`, and these properties, and no others; an event with any other
field is refused before it is queued:

| Property | Events | Value |
|---|---|---|
| `$process_person_profile` | both | always `false`: PostHog makes no person profile |
| `team` | both | always `coherence` |
| `version` | both | Coherence's version |
| `host` | both | `claude`, `codex` or `unknown` |
| `platform` | both | `darwin`, `linux`, `win32` or `other` |
| `node` | both | Node's major version |
| `files` | both | the project's file count as a bucket: `<1k`, `1k-10k`, `10k-100k`, `>100k` |
| `languages` | session | the configured languages: `typescript`, `python`, `rust` |
| `components` | session | the spec's component count as a bucket: `<10`, `10-100`, `100-1k`, `>1k` |
| `registry` | session | whether the project is a leaf of a registry |
| `<event>_count`, `<event>_p50_ms`, `<event>_p95_ms`, `<event>_max_ms` | session | for each hook event the session ran (`SessionStart`, `PostToolUse`, ...): how many calls, and their median, 95th percentile and slowest milliseconds |
| `class` | defect | the defect's class as a short slug; `other` when it is not one, `unclassified` when absent |
| `introduced` | defect | `fix`, `pre-existing` or `unknown`; never the commit or pull request |
| `caught` | defect | `review`, `ci`, `probe`, `adopter`, `self`, `test` or `unknown` |

- **`coherence session hooks`** summarizes one session's hook cost, once,
  after the session has been idle for 30 minutes; the next session start
  queues it.
- **`coherence defect recorded`** is queued when `coherence defect` records a
  defect.

Never a name, an email, a host name, a path, a repository or project name, a
prompt, a command, code, or a defect's text. Events wait in a queue beside
the settings; a session start or a stop with something queued starts a
detached flush that sends them in one request to PostHog's batch endpoint
and drops them, sent or not. No hook waits for it.

## Update check

Apart from telemetry, and sending nothing about you, a session start asks
the npm registry for the newest published version
(`https://registry.npmjs.org/@posthog/coherence/latest`) at most once a day,
from a detached process no hook waits for. The answer is kept in
`$XDG_CONFIG_HOME/coherence/latest.json` (or `~/.config/coherence/`); a
failed request is dropped and the last answer stands. When the newest is
later than the version running, the session start says so with the update
command for the project's package manager (by its lockfile) and the
release-age setting that may hold the newest back. `coherence --version`
shows the version running, where it is, the newest published, and when the
registry last answered. `COHERENCE_NO_UPDATE_CHECK=1` turns the check off,
and so do `CI` and `DO_NOT_TRACK=1`.
