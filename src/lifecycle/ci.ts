/**
 * The CI check: Coherence run on every pull request by the project's CI
 * host, in one of two modes. `fail` fails the check on a spec problem or a
 * structural defect; `comment` never fails on findings, only when Coherence
 * itself did not finish, and posts one report comment on the pull request,
 * updated in place on every push (ci-report.ts builds it).
 *
 *   coherence ci install --host github --mode fail|comment [--write]
 *   coherence ci report --session <id> [--base <commit>]
 *
 * Install prints the workflow it would write, and with --write writes
 * .github/workflows/coherence.yml at the repository top; a file already
 * there is never overwritten, and install says so. The workflow is planned
 * from the tree: the lockfile names the package manager and where to
 * install, the registry (a top config with projects) puts the check at the
 * repository top so every listed project is covered, and a project nested
 * below the top runs there. The language servers come with the package's
 * optional dependencies, which the lockfile install brings.
 *
 * Nothing here reaches the network: the plan reads files, and the actions
 * the workflow uses are pinned by commit as Coherence's own CI pins them.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { registryOf, repositoryTop } from "../adapters/project-config.ts";
import { ciNotes, ciSteps, forProject } from "../plugins/languages.ts";
import type { CiStep } from "../plugins/plugin.ts";
import { readEnforcementConfig } from "../enforcement/config.ts";
import type { Io } from "../journal/cli.ts";
import { isCoherenceItself, PACKAGE_NAME } from "./project.ts";
import { LOCKFILES, type PackageManager as AnyManager } from "./lockfiles.ts";

export const CI_HOSTS = ["github"] as const;
export type CiHost = (typeof CI_HOSTS)[number];
export const CI_MODES = ["fail", "comment"] as const;
export type CiMode = (typeof CI_MODES)[number];

/** Where the workflow goes, relative to the repository top. */
export const WORKFLOW_PATH = join(".github", "workflows", "coherence.yml");

/** What each mode does, in the words the usage, the refusal and the suggestion share. */
export const MODE_TEXT: Record<CiMode, string> = {
  fail: "fail the check on a spec problem or a structural defect",
  comment: "post one report comment on the pull request and fail only when Coherence itself breaks",
};

export const CI_USAGE = [
  `  ci install --host <${CI_HOSTS.join("|")}> --mode <${CI_MODES.join("|")}> [--write]   the workflow that runs Coherence on every pull request: --mode fail ${MODE_TEXT.fail}; --mode comment ${MODE_TEXT.comment}; printed, and with --write written to ${WORKFLOW_PATH.split(sep).join("/")}, never over a file already there`,
  "  ci report --session <id> [--base <commit>]   the pull request report as Markdown: problems, chokepoint verdicts, spec gaps and guard failures for every project, marking those in files changed since --base (on GitHub Actions, the pull request's base branch by default); exit 1 when the session's run is missing or a chokepoint was not run",
].join("\n");

/** The actions the workflow uses, pinned by commit; the comment names the release. */
const ACTIONS = {
  checkout: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
  setupNode: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
  setupPnpm: "pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0",
  setupBun: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
} as const;

/** The pnpm major the workflow installs when package.json names no packageManager; lockfile 9.0 is what pnpm 9 and 10 write. */
const PNPM_DEFAULT = "10";

/** The package managers the workflow sets up, in the order a refusal names them. */
const CI_MANAGERS = ["npm", "pnpm", "bun"] as const;
export type PackageManager = (typeof CI_MANAGERS)[number];

/** How each manager installs from its lockfile, runs the installed Coherence and never one it would fetch, and adds Coherence as a dev dependency; Bun's runs through Node.js, as an older bunx has no --no-install and fetches what is missing. */
const COMMANDS: Record<PackageManager, { install: string; cli: string; add: string }> = {
  npm: { install: "npm ci", cli: "npx --no -- coherence", add: "npm install -D" },
  pnpm: { install: "pnpm install --frozen-lockfile", cli: "pnpm exec coherence", add: "pnpm add -D" },
  bun: { install: "bun install --frozen-lockfile", cli: "npx --no -- coherence", add: "bun add -d" },
};

/** The step a manager Node.js does not bring needs: its action, the input that reads packageManager from a package.json below the top, and the version it installs when packageManager does not name one. */
const MANAGER_SETUP: Partial<Record<PackageManager, { action: string; packageJsonInput: string; fallback: string }>> = {
  pnpm: { action: ACTIONS.setupPnpm, packageJsonInput: "package_json_file", fallback: `version: ${PNPM_DEFAULT}` },
  bun: { action: ACTIONS.setupBun, packageJsonInput: "bun-version-file", fallback: "bun-version: latest" },
};

function setUp(manager: AnyManager): manager is PackageManager {
  return (CI_MANAGERS as readonly string[]).includes(manager);
}

/** Every lockfile Coherence recognizes, named in a refusal in file order; one whose manager the workflow does not set up is named, never ignored. */
const LOCKS: readonly { file: string; manager: PackageManager | undefined }[] = LOCKFILES.map(([file, manager]) => ({ file, manager: setUp(manager) ? manager : undefined })).sort((a, b) => a.file.localeCompare(b.file));
/** The lockfiles the workflow installs from, each with its manager. */
const SET_UP = LOCKS.flatMap((l) => (l.manager === undefined ? [] : [{ file: l.file, manager: l.manager }]));

function orList(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

function lockfilesOf(manager: PackageManager): string[] {
  return SET_UP.filter((l) => l.manager === manager).map((l) => l.file);
}

/** The lockfiles the workflow installs from, as a refusal names them. */
const SET_UP_FILES = orList(CI_MANAGERS.flatMap(lockfilesOf));
/** Each manager the workflow sets up with its lockfiles, as a refusal names them. */
const SET_UP_MANAGERS = orList(CI_MANAGERS.map((manager) => `${manager} (${orList(lockfilesOf(manager))})`));

export class CiError extends Error {}

/** Everything the workflow text depends on, read from the tree. */
export interface CiPlan {
  host: CiHost;
  mode: CiMode;
  /** The repository top, where .github lives. */
  top: string;
  /** Where Coherence's commands run, relative to the top with forward slashes ("." for the top): the registry's top, else the project's folder. */
  workdir: string;
  /** The registry's listed projects, relative to the top, when the check runs at a registry's top. */
  projects: string[] | undefined;
  manager: PackageManager;
  /** The folder holding the lockfile, relative to the top ("." for the top). */
  installDir: string;
  /** Whether the package.json at the install folder names the manager's version where its setup action reads one. */
  versionDeclared: boolean;
  /** The Node.js version file at the install folder (.nvmrc or .node-version), relative to the top, when there is one. */
  nodeVersionFile: string | undefined;
  /** What the workflow says for the languages the projects read: each a language plugin's note (a Python checker the workflow does not install). */
  notes: string[];
  /** The steps the language plugins the projects run ask the workflow to set up with (Go and gopls), after the install. */
  steps: CiStep[];
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function slash(path: string): string {
  const rel = path.split(sep).join("/");
  return rel === "" ? "." : rel;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function declares(manifest: Record<string, unknown> | undefined, name: string): boolean {
  if (manifest === undefined) return false;
  return ["dependencies", "devDependencies", "optionalDependencies"].some((key) => {
    const deps = manifest[key];
    return typeof deps === "object" && deps !== null && name in deps;
  });
}

/** Whether a package.json names the manager's version where its setup action reads one: packageManager, and for Bun engines.bun too. */
function declaresVersion(manifest: Record<string, unknown> | undefined, manager: PackageManager): boolean {
  const packageManager = manifest?.["packageManager"];
  if (typeof packageManager === "string" && packageManager.startsWith(`${manager}@`)) return true;
  const engines = manifest?.["engines"];
  return manager === "bun" && typeof engines === "object" && engines !== null && typeof (engines as Record<string, unknown>)["bun"] === "string";
}

/** The folders from `from` up to `top`, both included, nearest first. */
function upTo(from: string, top: string): string[] {
  const out: string[] = [];
  for (let dir = from; ; dir = dirname(dir)) {
    out.push(dir);
    if (dir === top || dirname(dir) === dir) return out;
  }
}

/** The languages a config at `dir` names, as its language key lists them. */
function languagesNamed(dir: string): string[] {
  const language = readJson(join(dir, "coherence.config.json"))?.["language"];
  return typeof language === "string" ? [language] : Array.isArray(language) ? language.filter((l): l is string => typeof l === "string") : [];
}

/**
 * The plan for `root`, the project the command resolved to. Refused with
 * what to do: no repository, no lockfile between where the check runs and the
 * repository top, a lockfile of a package manager the workflow does not set
 * up, two lockfiles in one folder, or no package.json there that lists
 * Coherence (the workflow runs the installed package, as the hooks do).
 */
export function planWorkflow(root: string, host: CiHost, mode: CiMode): CiPlan {
  const found = repositoryTop(root);
  if (found === undefined) throw new CiError(`ci install: ${root} is in no git repository; the workflow lives at a repository's top`);
  const top = realOr(found);
  const registry = registryOf(root);
  // A registry's check runs at its top, where spec --check and run cover every listed project; else in the project's own folder.
  const at = registry === undefined ? realOr(root) : top;
  const workdir = slash(relative(top, at));
  let lock: { dir: string; manager: PackageManager } | undefined;
  for (const dir of upTo(at, top)) {
    const held = LOCKS.filter((l) => existsSync(join(dir, l.file)));
    if (held.length === 0) continue;
    if (held.length > 1) throw new CiError(`ci install: ${slash(relative(top, dir))} holds ${held.map((l) => l.file).join(" and ")}; keep the one lockfile the project installs with`);
    const [one] = held;
    if (one!.manager === undefined) throw new CiError(`ci install: ${slash(relative(top, join(dir, one!.file)))} is a lockfile the workflow does not set up; it installs with ${SET_UP_MANAGERS}`);
    lock = { dir, manager: one!.manager };
    break;
  }
  if (lock === undefined) {
    throw new CiError(
      registry === undefined
        ? `ci install: no ${SET_UP_FILES} from ${workdir} up to the repository top; install ${PACKAGE_NAME} as a dev dependency first (${orList(CI_MANAGERS.map((m) => COMMANDS[m].add))})`
        : `ci install: no ${SET_UP_FILES} at the repository top, where a registry's check runs; install ${PACKAGE_NAME} as a dev dependency there first`,
    );
  }
  // The workflow runs the installed package from where the check runs, as npx --no -- coherence does there.
  const manifests = upTo(at, lock.dir).map((dir) => readJson(join(dir, "package.json")));
  if (!manifests.some((m) => declares(m, PACKAGE_NAME))) {
    throw new CiError(`ci install: no package.json from ${workdir} up to ${slash(relative(top, lock.dir))} lists ${PACKAGE_NAME}; add it as a dev dependency so the workflow runs the installed package`);
  }
  const versionDeclared = declaresVersion(readJson(join(lock.dir, "package.json")), lock.manager);
  const versionFile = [".nvmrc", ".node-version"].find((name) => existsSync(join(lock.dir, name)));
  const projects = registry === undefined ? undefined : registry.leaves.map((leaf) => slash(relative(top, leaf)));
  // Each project's plugins are registered by reading its config, so a language a plugin adds says what it needs as a bundled one does.
  const said = [...new Set([top, at, ...(registry?.leaves ?? [])])].map((dir) => {
    try {
      readEnforcementConfig(dir);
    } catch (error) {
      throw new CiError(`ci install: ${error instanceof Error ? error.message : String(error)}`);
    }
    return forProject(dir, () => ({ notes: ciNotes(languagesNamed(dir)), steps: ciSteps(languagesNamed(dir)) }));
  });
  const notes = [...new Set(said.flatMap((s) => s.notes))];
  const steps = [...new Map(said.flatMap((s) => s.steps).map((step) => [JSON.stringify(step), step])).values()];
  return {
    host,
    mode,
    top,
    workdir,
    projects,
    manager: lock.manager,
    installDir: slash(relative(top, lock.dir)),
    versionDeclared,
    nodeVersionFile: versionFile === undefined ? undefined : slash(relative(top, join(lock.dir, versionFile))),
    notes,
    steps,
  };
}

/** One plugin step as workflow lines: an action keeps its release in a comment, every other value is quoted. */
function stepLines(step: CiStep): string[] {
  const head = step.name === undefined ? [] : [`name: ${JSON.stringify(step.name)}`];
  const body = step.uses !== undefined ? [`uses: ${step.uses}${step.version === undefined ? "" : ` # ${step.version}`}`, ...(step.with === undefined ? [] : ["with:", ...Object.entries(step.with).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)])] : [`run: ${JSON.stringify(step.run)}`];
  return [...head, ...body].map((line, i) => `${i === 0 ? "      - " : "        "}${line}`);
}

/** The step that sets up a manager Node.js does not bring: the version packageManager names, read where the lockfile is, else the fallback. */
function managerSetup(plan: CiPlan): string[] {
  const setup = MANAGER_SETUP[plan.manager];
  if (setup === undefined) return [];
  const withs = !plan.versionDeclared ? [setup.fallback] : plan.installDir === "." ? [] : [`${setup.packageJsonInput}: ${plan.installDir}/package.json`];
  return [`      - uses: ${setup.action}`, ...(withs.length > 0 ? ["        with:", ...withs.map((w) => `          ${w}`)] : []), ""];
}

/** The workflow text for a plan. */
export function workflowText(plan: CiPlan): string {
  const { cli, install } = COMMANDS[plan.manager];
  const comment = plan.mode === "comment";
  const lines: string[] = [];
  const add = (...more: string[]) => lines.push(...more);
  add(
    "# Coherence on every pull request, written by coherence ci install.",
    comment
      ? "# Mode comment: findings never fail the job; one comment on the pull request carries the report and is updated on every push. The job fails only when Coherence itself did not finish."
      : "# Mode fail: the check fails on a spec problem (spec --check) or a structural defect (the chokepoint run).",
  );
  if (plan.projects !== undefined) add(`# The registry at the repository top lists ${plan.projects.length === 1 ? "one project" : `${plan.projects.length} projects`}: both commands run at the top and cover each one.`);
  add(
    "name: Coherence",
    "",
    "on:",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    ...(comment ? ["  pull-requests: write"] : []),
    "",
    "# A newer push to the same pull request replaces a run still going.",
    "concurrency:",
    "  group: coherence-${{ github.ref }}",
    "  cancel-in-progress: true",
    "",
    "# CI never sends telemetry or asks the registry for a newer release, whatever a config on the runner says.",
    "env:",
    '  COHERENCE_TELEMETRY: "0"',
    '  DO_NOT_TRACK: "1"',
    '  COHERENCE_NO_UPDATE_CHECK: "1"',
    "",
    "jobs:",
    "  coherence:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 30",
    "    steps:",
    "      # Full history: a practice's pitfalls may cite commits, and the spec check confirms each exists.",
    `      - uses: ${ACTIONS.checkout}`,
    "        with:",
    "          persist-credentials: false",
    "          fetch-depth: 0",
    "",
  );
  add(...managerSetup(plan));
  add(`      - uses: ${ACTIONS.setupNode}`, "        with:", plan.nodeVersionFile === undefined ? '          node-version: "22"' : `          node-version-file: ${plan.nodeVersionFile}`, "");
  add(
    "      # The lockfile install brings Coherence and, as its optional dependencies, the language servers it asks.",
    "      - name: Install",
    ...(plan.installDir === "." ? [] : [`        working-directory: ${plan.installDir}`]),
    `        run: ${install}`,
    "",
  );
  for (const note of plan.notes) add(`      # ${note}`, "");
  for (const step of plan.steps) add(...stepLines(step), "");
  const where = plan.workdir === "." ? [] : [`        working-directory: ${plan.workdir}`];
  if (!comment) {
    add(
      "      - name: Spec check",
      ...where,
      `        run: ${cli} spec --check`,
      "",
      "      # Every chokepoint graded in process; a bypass, a missing chokepoint or an instrument that never answered fails the run.",
      "      - name: Chokepoints",
      "        if: ${{ !cancelled() }}",
      ...where,
      `        run: ${cli} run --form chokepoint --no-server --session "ci-\${{ github.run_id }}" --agent ci`,
    );
    return lines.join("\n") + "\n";
  }
  add(
    "      # Exit 1 is findings, which the report carries; any other exit is Coherence itself breaking.",
    "      - name: Spec check",
    ...where,
    `        run: ${cli} spec --check || [ $? -eq 1 ]`,
    "",
    "      - name: Chokepoints",
    ...where,
    `        run: ${cli} run --form chokepoint --no-server --session "ci-\${{ github.run_id }}" --agent ci || [ $? -eq 1 ]`,
    "",
    "      # The report fails the job when the run is missing or a chokepoint could not be checked; it is written either way.",
    "      - name: Report",
    "        id: report",
    ...where,
    "        run: |",
    "          status=0",
    `          ${cli} ci report --session "ci-\${{ github.run_id }}" > "$RUNNER_TEMP/coherence-report.md" || status=$?`,
    '          cat "$RUNNER_TEMP/coherence-report.md" >> "$GITHUB_STEP_SUMMARY"',
    '          exit "$status"',
    "",
    "      # One comment, found by its marker and updated in place. A pull request from a fork gets a read-only token: the report stays in the job summary, and a warning says so.",
    "      - name: Comment",
    "        if: ${{ !cancelled() && steps.report.outcome != 'skipped' }}",
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    "          REPO: ${{ github.repository }}",
    "          PR: ${{ github.event.pull_request.number }}",
    "        run: |",
    '          body="$RUNNER_TEMP/coherence-report.md"',
    '          if [ ! -s "$body" ]; then echo "::warning::Coherence wrote no report, so none was posted"; exit 0; fi',
    `          ids=$(gh api --paginate "repos/$REPO/issues/$PR/comments" --jq '.[] | select(.user.login == "github-actions[bot]" and (.body | startswith("${REPORT_MARKER}"))) | .id')`,
    "          id=${ids%%$'\\n'*}",
    '          if [ -n "$id" ]; then',
    '            gh api --method PATCH "repos/$REPO/issues/comments/$id" -F body=@"$body" > /dev/null || echo "::warning::the Coherence report comment could not be updated; the report is in the job summary"',
    "          else",
    '            gh api --method POST "repos/$REPO/issues/$PR/comments" -F body=@"$body" > /dev/null || echo "::warning::the Coherence report could not be posted (a pull request from a fork gets a read-only token); the report is in the job summary"',
    "          fi",
  );
  return lines.join("\n") + "\n";
}

/** The first line of every report, by which the workflow finds its own comment to update. */
export const REPORT_MARKER = "<!-- coherence-report -->";

export interface Installed {
  path: string;
  text: string;
  /** False when a file was already there: nothing was written. */
  written: boolean;
}

/** Write the workflow unless a file is already at its path; never overwrite. */
export function writeWorkflow(plan: CiPlan): Installed {
  const path = join(plan.top, WORKFLOW_PATH);
  const text = workflowText(plan);
  if (existsSync(path)) return { path, text, written: false };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { flag: "wx" });
  return { path, text, written: true };
}

/** A workflow line that runs Coherence's check: the installed command or a checkout's cli, with spec --check or a run. */
const RUNS_COHERENCE = /(?:coherence|cli\.[jt]s)\b[^\n]*\b(?:spec --check|run --form)/;

/** Whether the repository holding `root` has a workflow that runs Coherence: ours by its path, or any workflow whose text runs the check. */
export function hasCoherenceWorkflow(root: string): boolean {
  const top = repositoryTop(root) ?? root;
  const dir = join(top, ".github", "workflows");
  if (existsSync(join(top, WORKFLOW_PATH))) return true;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  return names
    .filter((name) => /\.ya?ml$/.test(name))
    .some((name) => {
      try {
        return RUNS_COHERENCE.test(readFileSync(join(dir, name), "utf8"));
      } catch {
        return false;
      }
    });
}

/** The one line hooks install prints when no workflow runs Coherence: the command and its two modes. */
export async function ciSuggestion(root: string): Promise<string> {
  if (hasCoherenceWorkflow(root)) return "";
  const cli = (await isCoherenceItself(root)) ? "node src/cli.ts" : "npx --no -- coherence";
  return `CI: no workflow runs Coherence on pull requests; ${cli} ci install --host github --mode fail (${MODE_TEXT.fail}) or --mode comment (${MODE_TEXT.comment}) prints one, and --write writes it.\n`;
}

function isMode(value: string): value is CiMode {
  return (CI_MODES as readonly string[]).includes(value);
}

function isCiHost(value: string): value is CiHost {
  return (CI_HOSTS as readonly string[]).includes(value);
}

/** ci install: print the workflow, or write it with --write; a file already there is named and kept. */
export function ciInstallCommand(argv: string[], io: Io): number {
  let host: string | undefined;
  let mode: string | undefined;
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    if (flag === "--write" && inline === undefined) write = true;
    else if (flag === "--host" || flag === "--mode") {
      const value = inline ?? argv[++i];
      if (value === undefined) {
        io.err(`ci install: ${flag} needs a value\n${CI_USAGE}`);
        return 64;
      }
      if (flag === "--host") host = value;
      else mode = value;
    } else {
      io.err(`ci install: unexpected ${arg}\n${CI_USAGE}`);
      return 64;
    }
  }
  if (host === undefined || !isCiHost(host)) {
    io.err(`ci install: --host must be one of ${CI_HOSTS.join(", ")}\n${CI_USAGE}`);
    return 64;
  }
  // The mode is the user's choice: both are presented, and neither is assumed.
  if (mode === undefined || !isMode(mode)) {
    io.err(`ci install: choose a mode: --mode fail to ${MODE_TEXT.fail}, or --mode comment to ${MODE_TEXT.comment}`);
    return 64;
  }
  let plan: CiPlan;
  try {
    plan = planWorkflow(io.cwd, host, mode);
  } catch (error) {
    if (!(error instanceof CiError)) throw error;
    io.err(error.message);
    return 1;
  }
  const shown = WORKFLOW_PATH.split(sep).join("/");
  if (!write) {
    io.out(workflowText(plan).trimEnd());
    io.err(`ci install: printed, not written; add --write to write ${shown}${existsSync(join(plan.top, WORKFLOW_PATH)) ? `, which already exists and would be kept` : ""}`);
    return 0;
  }
  const installed = writeWorkflow(plan);
  if (!installed.written) {
    io.err(`ci install: ${installed.path} already exists and was not overwritten; compare it with the workflow ci install prints without --write, or move it aside and run again`);
    return 1;
  }
  io.out(`wrote ${installed.path} (mode ${mode}, ${plan.manager}${plan.projects === undefined ? "" : `, ${plan.projects.length} registry project${plan.projects.length === 1 ? "" : "s"}`}); commit it, and the next pull request runs it`);
  return 0;
}
