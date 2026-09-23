#!/usr/bin/env node
/**
 * The command line: `node src/cli.ts <verb> ...`.
 *
 * Each area of the tool exports its verbs; this file dispatches on the first
 * word. The journal's verbs arrive as a record of synchronous commands over an
 * `Io`; the lifecycle's verbs are dispatched below them.
 *
 *   coherence lexicon                 print the compact lexicon the hook injects
 *   coherence lexicon --json          print the parsed lexicon model
 *   coherence lexicon --check [paths] run the lexicon check (--json for the report as JSON)
 *   coherence spec --check [root]      every component, its invariants with state, every problem
 *   coherence spec --json [root]       the spec model
 *   coherence scaffold component | invariant   the complete shape, cheapest to produce
 *   coherence run [--session --agent]  the chokepoint check and the totality oracle pass, appended as one run
 *   coherence run --status             the latest verdict per enforcement, a view over every run
 *   coherence refute <component>/<name> --broke "<what you changed>"   the totality oracle with the break staged; it must fail
 *   coherence serve                    the warm language server for this project
 *   coherence query <question> ...     the agent query: what Scope shows a human, as plain text
 *   coherence scope [--no-open]        open the live Scope reading from the warm server; --snapshot [--out <file>] writes one file
 *   coherence hook <event>             answer one harness event (event JSON on stdin)
 *   coherence hooks install --host <claude|codex>   merge one entry per event into the agent host's settings
 *   coherence hooks uninstall --host <claude|codex> remove exactly those entries; every other hook stays
 *   coherence hooks --check --host <claude|codex>   exit 1 with each event's drift from what install would write
 *   coherence hooks status             the wiring per agent host and what each event delivers for this project
 *   coherence decide | retract | conjecture | ... | journal   (see JOURNAL_USAGE)
 *   coherence work create | move | close | owner | inspect   (see WORK_USAGE)
 *
 * Exit codes: the check exits 1 with findings and 0 without; a hook exits 2
 * to refuse a stop, with the reason on stderr.
 */

import { LEXICON_WORK_USAGE, lexiconWorkCommand } from "./lifecycle/lexicon-cli.ts";
import { ECONOMY_USAGE, calibrateCommand, economyCommand, massCommand } from "./economy/cli.ts";
import { ENFORCEMENT_USAGE, refuteCommand, runCommand, serveCommand } from "./enforcement/cli.ts";
import { JOURNAL_USAGE, journalVerbs, type Io } from "./journal/cli.ts";
import { formatReport, hasFindings, runCheck } from "./lifecycle/check.ts";
import { renderCompact, renderCompactWithin, tokenEstimate } from "./lifecycle/lexicon.ts";
import { CONTEXT_BUDGET, isHookEvent, HOOK_EVENTS, readStdinJson, runHook } from "./lifecycle/hook.ts";
import { deliveries, formatDeliveries } from "./lifecycle/delivery.ts";
import { check, formatCheck, formatStatus, formatUninstall, HOSTS, install, isHost, status, uninstall } from "./lifecycle/install.ts";
import { isCoherenceItself, loadProjectLexicons } from "./lifecycle/project.ts";
import { QUERY_USAGE, queryCommand } from "./readings/query/cli.ts";
import { SCOPE_USAGE, scopeCommand } from "./readings/scope/cli.ts";
import { scopeApp } from "./readings/scope/live.ts";
import { SCAFFOLD_USAGE, scaffoldCommand } from "./scaffold/cli.ts";
import { SPEC_USAGE, specCommand } from "./spec/cli.ts";

type CommandResult = number | Promise<number>;
type RootCommand = (argv: string[], io: Io) => CommandResult;

const commands: Record<string, RootCommand> = { ...journalVerbs, spec: specCommand, scaffold: scaffoldCommand };

const USAGE = `usage:
${LEXICON_WORK_USAGE}
  coherence lexicon [--json]
  coherence lexicon --check [--json] [paths...]
${SPEC_USAGE}
${SCAFFOLD_USAGE}
${ENFORCEMENT_USAGE}
${ECONOMY_USAGE}
${QUERY_USAGE}
${SCOPE_USAGE}
  coherence hook <${HOOK_EVENTS.join("|")}>
  coherence hooks install --host <${HOSTS.join("|")}> [--command "<prefix>"]
  coherence hooks uninstall --host <${HOSTS.join("|")}>
  coherence hooks --check --host <${HOSTS.join("|")}> [--command "<prefix>"]
  coherence hooks status
${JOURNAL_USAGE}
`;

function fail(message: string, code = 64): never {
  process.stderr.write(message.endsWith("\n") ? message : message + "\n");
  process.exit(code);
}

interface Parsed {
  flags: Map<string, string | true>;
  positionals: string[];
}

/** `--flag`, `--flag value`, `--flag=value`, and positionals, in any order. */
function parse(args: string[], valued: Set<string>): Parsed {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const name = arg.slice(2);
    if (valued.has(name) && i + 1 < args.length) {
      flags.set(name, args[++i]!);
    } else {
      flags.set(name, true);
    }
  }
  return { flags, positionals };
}

/**
 * The command prefix a hook entry uses to reach this CLI. Paths are relative
 * to the project root, which is where both hosts run hooks; Claude Code also
 * names it in CLAUDE_PROJECT_DIR, honored when set. The installed bin is
 * addressed directly rather than through npx, which would fetch a stranger's
 * package of the same name when the dependency is missing.
 */
async function defaultCommand(root: string): Promise<string> {
  const dir = '$(dir="${CLAUDE_PROJECT_DIR:-$PWD}"; while [ "$dir" != "/" ] && [ ! -f "$dir/.claude/settings.json" ] && [ ! -f "$dir/.codex/hooks.json" ]; do dir=$(dirname "$dir"); done; printf "%s" "$dir")';
  return (await isCoherenceItself(root)) ? `node "${dir}/src/cli.ts"` : `"${dir}/node_modules/.bin/coherence"`;
}

async function lexiconCommand(args: string[], root: string): Promise<number> {
  const io: Io = {
    cwd: root,
    out: (line) => process.stdout.write(line + "\n"),
    err: (line) => process.stderr.write(line + "\n"),
  };
  if (args[0] === "--help") return lexiconWorkCommand(["help"], io);
  if (args[0] && !args[0].startsWith("--")) return lexiconWorkCommand(args, io);
  const { flags, positionals } = parse(args, new Set());
  const unknown = [...flags.keys()].find((flag) => flag !== "check" && flag !== "json");
  if (unknown !== undefined) {
    process.stderr.write(`lexicon: unknown flag --${unknown}\n`);
    return 1;
  }
  const { coherence, project } = await loadProjectLexicons(root);
  if (flags.has("check")) {
    const report = await runCheck({ root, paths: positionals, coherence, project });
    process.stdout.write(flags.has("json") ? JSON.stringify(report, null, 2) + "\n" : formatReport(report));
    return hasFindings(report) ? 1 : 0;
  }
  if (flags.has("json")) {
    process.stdout.write(JSON.stringify({ coherence, project: project ?? null }, null, 2) + "\n");
    return 0;
  }
  const compact = renderCompact(coherence, project);
  process.stdout.write(compact);
  const estimate = tokenEstimate(compact);
  let note = "";
  if (project !== undefined) {
    const within = renderCompactWithin(coherence, project, CONTEXT_BUDGET);
    if (within.detail !== "full") {
      note = `; the hook injects the project layer at detail "${within.detail}" (~${tokenEstimate(within.text).tokens} tokens) to stay under ${CONTEXT_BUDGET} characters`;
    }
  }
  process.stderr.write(`~${estimate.tokens} tokens (${estimate.bytes} bytes / 4)${note}\n`);
  return 0;
}

/** Write to stdout and settle only once the bytes were accepted, so what follows records an effect that happened. */
function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.once("error", reject);
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

/** The exit code for output the host never received (sysexits EX_IOERR). */
const OUTPUT_LOST_EXIT = 74;

async function hookCommand(args: string[], root: string): Promise<number> {
  const event = args[0];
  if (event === undefined || !isHookEvent(event)) fail(`hook: expected one of ${HOOK_EVENTS.join(", ")}\n${USAGE}`);
  const input = await readStdinJson(process.stdin);
  const result = await runHook(event, input, root);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  if (result.stdout !== "") {
    try {
      await writeStdout(result.stdout);
    } catch (error) {
      // The host has nothing, so nothing is committed: an unprinted feed is shown again next time.
      process.stderr.write(`hook ${event}: the output never reached the host (${error instanceof Error ? error.message : String(error)}); nothing was committed\n`);
      return OUTPUT_LOST_EXIT;
    }
  }
  result.commit?.();
  return result.exit;
}

/** The flags each hooks verb takes; anything else is a usage error rather than silently ignored. */
const HOOKS_FLAGS: Record<string, ReadonlySet<string>> = {
  install: new Set(["host", "command"]),
  uninstall: new Set(["host"]),
  check: new Set(["check", "host", "command"]),
  status: new Set(),
};

async function hooksCommand(args: string[], root: string): Promise<number> {
  const { flags, positionals } = parse(args, new Set(["host", "command"]));
  // The check is the noun's --check, as lexicon --check and spec --check are; the other actions are verbs.
  const verb = flags.has("check") && positionals.length === 0 ? "check" : positionals[0];
  const allowed = verb === undefined ? undefined : HOOKS_FLAGS[verb];
  if (allowed === undefined || positionals.length > (verb === "check" ? 0 : 1)) fail(USAGE);
  const unknown = [...flags.keys()].filter((flag) => !allowed.has(flag));
  if (unknown.length > 0) fail(`hooks ${verb}: unknown flag${unknown.length === 1 ? "" : "s"} ${unknown.map((f) => `--${f}`).join(", ")}\n${USAGE}`);
  if (verb === "status") {
    const statuses = await Promise.all(HOSTS.map((host) => status(root, host)));
    process.stdout.write(formatStatus(statuses) + "\n" + formatDeliveries(await deliveries(root), statuses));
    return 0;
  }
  const host = flags.get("host");
  const label = verb === "check" ? "hooks --check" : `hooks ${verb}`;
  if (typeof host !== "string" || !isHost(host)) fail(`${label}: --host must be one of ${HOSTS.join(", ")}\n${USAGE}`);
  const given = flags.get("command");
  if (given === true) fail(`${label}: --command needs a value\n${USAGE}`);
  if (verb === "uninstall") {
    process.stdout.write(formatUninstall(host, await uninstall(root, host)));
    return 0;
  }
  const command = given ?? (await defaultCommand(root));
  if (verb === "check") {
    let result;
    try {
      result = await check(root, host, command);
    } catch (error) {
      process.stderr.write(`hooks --check: ${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
    process.stdout.write(formatCheck(result));
    return result.drift.length === 0 ? 0 : 1;
  }
  const result = await install({ root, host, command });
  process.stdout.write(`${result.changed ? "wrote" : "unchanged"} ${result.path}: ${result.events.join(", ")}\n`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [verb, ...rest] = argv;
  const root = process.cwd();
  const command = verb === undefined ? undefined : commands[verb];
  if (command !== undefined) {
    const io: Io = {
      cwd: root,
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    };
    return command(rest, io);
  }
  const io: Io = {
    cwd: root,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
  switch (verb) {
    case "lexicon":
      return lexiconCommand(rest, root);
    case "run":
      return runCommand(rest, io);
    case "refute":
      return refuteCommand(rest, io);
    case "serve":
      // The warm server answers the live Scope reading over HTTP besides the instrument over its socket.
      return serveCommand(rest, io, { http: scopeApp() });
    case "scope":
      return scopeCommand(rest, io);
    case "economy":
      return economyCommand(rest, io);
    case "calibrate":
      return calibrateCommand(rest, io);
    case "mass":
      return massCommand(rest, io);
    case "query":
      return queryCommand(rest, io);
    case "hook":
      return hookCommand(rest, root);
    case "hooks":
      return hooksCommand(rest, root);
    default:
      fail(verb === undefined ? USAGE : `unknown verb "${verb}"\n${USAGE}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    fail(error instanceof Error ? error.message : String(error), 70);
  },
);
