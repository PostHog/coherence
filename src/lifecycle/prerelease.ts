/**
 * Cut a prerelease of Coherence from a branch: a GitHub prerelease carrying
 * the package's tarball, never npm, which the Release environment publishes
 * to from main alone (.github/workflows/release.yml).
 *
 *   node src/lifecycle/prerelease.ts --notes <file> [--dry-run]
 *
 * It refuses, naming each reason, unless: the version is a prerelease; every
 * bundled plugin and mod that follows the package's major version names this
 * one; the working tree holds no change to a tracked file; HEAD is on the
 * remote, where the release's target must be; origin/main is an ancestor of
 * HEAD, so the prerelease carries everything main has shipped; and no tag of
 * the version exists. 1.11.0-beta.1 was cut from a branch that never took
 * main's #153, and put back what #153 fixed; npm version left the bundled
 * plugins' versions behind the package's.
 */

import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "./work-meter.ts";

/** One command this repository's prerelease runs, as argv. */
type Command = [string, ...string[]];

/** The package's version, and every bundled manifest that follows it: each plugin's and each mod's that shares the package's major version. */
export function versionsOf(repo: string): { version: string; manifests: { file: string; version: string }[] } {
  const version = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string }).version;
  const major = version.split(".")[0];
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
    // A plugin with a version of its own (go, convex and quint at 0.1.0) keeps it; one that follows the package names the package's.
    if (named !== undefined && named.split(".")[0] === major) manifests.push({ file: relative(repo, file), version: named });
  }
  return { version, manifests };
}

/** Run git in the repository: its status and its output, trimmed. */
function git(repo: string, ...args: string[]): { ok: boolean; out: string } {
  const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { ok: run.status === 0, out: `${run.stdout ?? ""}`.trimEnd() };
}

/** Why the repository's HEAD may not be cut as a prerelease now: empty when it may. Fetches origin's main first. */
export function prereleaseProblems(repo: string): string[] {
  const problems: string[] = [];
  const { version, manifests } = versionsOf(repo);
  if (!/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version)) problems.push(`package.json names ${version}, which is no prerelease (1.11.0-beta.3): a release of main is release.yml's`);
  for (const m of manifests) if (m.version !== version) problems.push(`${m.file} names ${m.version}, not the package's ${version}: npm version bumps package.json alone`);
  const changed = git(repo, "status", "--porcelain", "--untracked-files=no").out;
  if (changed !== "") problems.push(`the working tree holds changes the tarball would carry and no commit names:\n${changed}`);
  const head = git(repo, "rev-parse", "HEAD").out;
  if (!git(repo, "fetch", "--quiet", "origin", "main").ok) problems.push("origin's main could not be fetched, so whether HEAD holds it is unknown");
  else if (!git(repo, "merge-base", "--is-ancestor", "origin/main", head).ok) problems.push(`origin/main (${git(repo, "rev-parse", "--short", "origin/main").out}) is not an ancestor of HEAD (${head.slice(0, 7)}): merge it first, or the prerelease takes back what main shipped since this branch left it`);
  if (git(repo, "branch", "--remotes", "--contains", head).out === "") problems.push(`HEAD (${head.slice(0, 7)}) is on no branch of the remote: push it, since the release's target must be there`);
  if (git(repo, "ls-remote", "--tags", "origin", `refs/tags/v${version}`).out !== "") problems.push(`the tag v${version} exists already: bump the version`);
  return problems;
}

/** The commands that cut the prerelease: pack the tarball into a folder of its own, then make the GitHub prerelease with it. */
export function prereleaseCommands(repo: string, notes: string, folder: string): Command[] {
  const { version } = versionsOf(repo);
  const head = git(repo, "rev-parse", "HEAD").out;
  const remote = git(repo, "remote", "get-url", "origin").out;
  const slug = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)?.[1] ?? remote;
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
  if (notes === undefined) {
    process.stderr.write("usage: node src/lifecycle/prerelease.ts --notes <file> [--dry-run]\n");
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
