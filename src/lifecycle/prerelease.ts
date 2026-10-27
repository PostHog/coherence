/**
 * Cut a prerelease of Coherence from a branch: a GitHub prerelease carrying
 * the package's tarball, never npm, which the Release environment publishes
 * to from main alone (.github/workflows/release.yml).
 *
 *   node src/lifecycle/prerelease.ts --notes <file> [--dry-run]
 *
 * The release goes to the repository package.json names, through the remote
 * whose URL is that repository's, whatever the remote is called: a fork set
 * up as origin is never released to. It refuses, naming each reason, unless:
 * the version is a prerelease; every bundled plugin and mod that follows the
 * package (each but a 0.x one, which keeps a version of its own) names this
 * one; the working tree holds no change and no file git does not ignore,
 * which npm pack would ship; HEAD is on a branch of that remote, as fetched
 * now, deleted branches pruned; that remote's main, as fetched now, is an
 * ancestor of HEAD, so the prerelease carries everything main has shipped;
 * and no tag of the version exists there. 1.11.0-beta.1 was cut from a
 * branch that never took main's #153, and put back what #153 fixed; npm
 * version left the bundled plugins' versions behind the package's.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "./work-meter.ts";

/** One command this repository's prerelease runs, as argv. */
type Command = [string, ...string[]];

/** The package's version, and every bundled manifest that follows it: each plugin's and each mod's but a 0.x one's, which keeps a version of its own. */
export function versionsOf(repo: string): { version: string; manifests: { file: string; version: string }[] } {
  const version = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string }).version;
  const files = [
    ...readdirSync(join(repo, "plugins"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(repo, "plugins", e.name, "plugin.json")),
    ...readdirSync(join(repo, "mods"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(repo, "mods", e.name, ".claude-plugin", "plugin.json")),
  ];
  const manifests: { file: string; version: string }[] = [];
  for (const file of files) {
    let named: string | undefined;
    try {
      named = (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version;
    } catch {
      continue;
    }
    // A plugin with a version of its own (go, convex and quint at 0.1.0) keeps it; one that follows the package names the package's,
    // whatever major version each is at, so a major release's bump that leaves one behind is caught.
    if (named !== undefined && named.split(".")[0] !== "0") manifests.push({ file: relative(repo, file), version: named });
  }
  return { version, manifests };
}

/** Run git in the repository: its status and its output, trimmed. */
function git(repo: string, ...args: string[]): { ok: boolean; out: string } {
  const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { ok: run.status === 0, out: `${run.stdout ?? ""}`.trimEnd() };
}

/** A repository's URL as one to compare: a GitHub repository by its owner/name, any other by its URL or path, as git and npm may each spell it. */
function repositoryOf(url: string): string {
  const bare = url.replace(/^git\+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  const github = /github\.com[:/]([^/]+\/[^/]+)$/.exec(bare);
  if (github !== null) return `github:${github[1]!.toLowerCase()}`;
  return isAbsolute(bare) ? resolve(bare) : bare;
}

/** The repository package.json names, where a release goes, and the remote whose URL is it, or undefined where no remote's is. */
function releaseRemote(repo: string): { url: string; remote: string | undefined } {
  const named = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { repository?: string | { url?: string } }).repository;
  const url = (typeof named === "string" ? named : named?.url) ?? "";
  const remote = git(repo, "remote").out.split("\n").filter(Boolean).find((name) => url !== "" && repositoryOf(git(repo, "remote", "get-url", name).out) === repositoryOf(url));
  return { url, remote };
}

/** Why the repository's HEAD may not be cut as a prerelease now: empty when it may. Fetches the release's remote first, pruning what it deleted. */
export function prereleaseProblems(repo: string): string[] {
  const problems: string[] = [];
  const { version, manifests } = versionsOf(repo);
  if (!/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version)) problems.push(`package.json names ${version}, which is no prerelease (1.11.0-beta.3): a release of main is release.yml's`);
  for (const m of manifests) if (m.version !== version) problems.push(`${m.file} names ${m.version}, not the package's ${version}: npm version bumps package.json alone`);
  // A file git does not ignore ships in the tarball whether or not a commit names it.
  const changed = git(repo, "status", "--porcelain").out;
  if (changed !== "") problems.push(`the working tree holds changes or files the tarball would carry and no commit names:\n${changed}`);
  const head = git(repo, "rev-parse", "HEAD").out;
  const { url, remote } = releaseRemote(repo);
  if (remote === undefined) {
    problems.push(`no remote's URL is the repository package.json names (${url || "none"}), where the release goes`);
    return problems;
  }
  // Read through the remote's own refs, fetched now: a local tag or branch named like them, or a branch the remote deleted since, says nothing.
  const main = `refs/remotes/${remote}/main`;
  if (!git(repo, "fetch", "--quiet", "--prune", remote).ok) problems.push(`${remote} could not be fetched, so whether HEAD holds its main and is on it are unknown`);
  else {
    if (!git(repo, "merge-base", "--is-ancestor", main, head).ok) problems.push(`${remote}/main (${git(repo, "rev-parse", "--short", main).out}) is not an ancestor of HEAD (${head.slice(0, 7)}): merge it first, or the prerelease takes back what main shipped since this branch left it`);
    if (git(repo, "for-each-ref", "--contains", head, "--format=%(refname)", `refs/remotes/${remote}/`).out === "") problems.push(`HEAD (${head.slice(0, 7)}) is on no branch of ${remote}: push it, since the release's target must be there`);
  }
  if (git(repo, "ls-remote", "--tags", remote, `refs/tags/v${version}`).out !== "") problems.push(`the tag v${version} exists already: bump the version`);
  return problems;
}

/** The commands that cut the prerelease: pack the tarball into a folder of its own, then make the GitHub prerelease with it. */
export function prereleaseCommands(repo: string, notes: string, folder: string): Command[] {
  const { version } = versionsOf(repo);
  const head = git(repo, "rev-parse", "HEAD").out;
  const { url } = releaseRemote(repo);
  const slug = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? url;
  const tarball = join(folder, `posthog-coherence-${version}.tgz`);
  return [
    ["npm", "pack", "--pack-destination", folder],
    ["gh", "release", "create", `v${version}`, "--repo", slug, "--prerelease", "--target", head, "--title", `v${version}`, "--notes-file", notes, tarball],
  ];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--notes");
  const notes = at < 0 ? undefined : args[at + 1];
  const repo = resolve(import.meta.dirname, "..", "..");
  // Only the arguments it takes: a mistyped --dry-run would otherwise cut the release.
  const known = args.every((arg, i) => arg === "--notes" || arg === "--dry-run" || (i === at + 1 && at >= 0));
  if (notes === undefined || !known || !existsSync(notes)) {
    process.stderr.write(`usage: node src/lifecycle/prerelease.ts --notes <file> [--dry-run]${notes !== undefined && !existsSync(notes) ? `\nno notes file at ${notes}` : ""}\n`);
    process.exit(2);
  }
  const problems = prereleaseProblems(repo);
  if (problems.length > 0) {
    process.stderr.write(`not cut:\n${problems.map((p) => `- ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  const commands = prereleaseCommands(repo, resolve(notes), mkdtempSync(join(tmpdir(), "coherence-prerelease-")));
  for (const [command, ...rest] of commands) {
    process.stdout.write(`${[command, ...rest].join(" ")}\n`);
    if (args.includes("--dry-run")) continue;
    const run = spawnSync(command, rest, { cwd: repo, stdio: "inherit" });
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
