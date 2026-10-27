/**
 * The checks a prerelease of Coherence must pass before it is cut from a
 * branch: a GitHub prerelease carrying the package's tarball, never npm,
 * which the Release environment publishes to from main alone
 * (.github/workflows/release.yml).
 *
 * Only .github/workflows/prerelease.yml cuts one, run by hand:
 *
 *   gh workflow run prerelease.yml -f ref=<branch> -f notes="<markdown>"
 *
 * Its build job checks the branch out clean, with full history, runs this
 * module there (node src/lifecycle/prerelease.ts, which takes no arguments
 * and cuts nothing), and only when it names no reason installs, packs and
 * checks the tarball; its release job then tags the commit checked out, by
 * its sha, and makes the prerelease on that tag. Run anywhere
 * else, it reads that clone's HEAD and remotes, which is no reading of what
 * the workflow would cut: a local working tree, remote or ref is not what
 * ships, and review after review found the local script's view of them
 * diverging from what would.
 *
 * The release goes to the repository package.json names, through the remote
 * whose URL is that repository's, whatever the remote is called (in the
 * workflow's checkout, origin): a fork set up as origin is never released to.
 * It refuses, naming each reason, unless: the version is a prerelease; every
 * bundled plugin and mod that follows the package (each but a 0.x one, which
 * keeps a version of its own) names this one, and every manifest reads, each
 * read from HEAD; HEAD is on a branch of that remote, every branch fetched now
 * by an explicit refspec, deleted ones pruned; that remote's main, so fetched,
 * is an ancestor of HEAD, so the prerelease carries everything main has
 * shipped; and that remote's tags list, with no tag of the version among
 * them, a listing that fails being a reason too. 1.11.0-beta.1 was cut from
 * a branch that never took main's #153, and put back what #153 fixed; npm
 * version left the bundled plugins' versions behind the package's.
 */

import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "./work-meter.ts";

/** The package's version, and every bundled manifest that follows it: each plugin's and each mod's but a 0.x one's, which keeps a version of its own. */
export function versionsOf(repo: string): { version: string; manifests: { file: string; version: string }[]; unreadable: string[] } {
  // Read from HEAD, the commit the workflow checks out and packs, never the working tree: what the release ships is what it vouches for.
  const version = (JSON.parse(git(repo, "show", "HEAD:package.json").out) as { version: string }).version;
  const files = git(repo, "ls-tree", "-r", "--name-only", "HEAD", "--", "plugins", "mods").out.split("\n").filter((file) => /^plugins\/[^/]+\/plugin\.json$|^mods\/[^/]+\/\.claude-plugin\/plugin\.json$/.test(file));
  const manifests: { file: string; version: string }[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    let named: unknown;
    try {
      named = (JSON.parse(git(repo, "show", `HEAD:${file}`).out) as { version?: unknown }).version;
    } catch {
      // A manifest that will not read, or names no version, is one the release cannot vouch for.
      unreadable.push(file);
      continue;
    }
    if (typeof named !== "string") {
      unreadable.push(file);
      continue;
    }
    // A plugin with a version of its own (go, convex and quint at 0.1.0) keeps it; one that follows the package names the package's,
    // whatever major version each is at, so a major release's bump that leaves one behind is caught.
    if (named.split(".")[0] !== "0") manifests.push({ file, version: named });
  }
  return { version, manifests, unreadable };
}

/** Run git in the repository: its status and its output, trimmed. */
function git(repo: string, ...args: string[]): { ok: boolean; out: string } {
  const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { ok: run.status === 0, out: `${run.stdout ?? ""}`.trimEnd() };
}

/** A repository's URL as one to compare: a GitHub repository by its owner/name, any other by its URL or path, as git and npm may each spell it. */
export function repositoryOf(url: string): string {
  const bare = url.replace(/^git\+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  // GitHub's own host alone, by https, ssh or scp form (git@github.com:o/r, ssh://git@ssh.github.com:443/o/r), never a host that ends in its name.
  const github = /^(?:(?:https?|ssh|git):\/\/)?(?:[^@/]+@)?(?:ssh\.)?github\.com(?::\d+)?[:/]([^/]+\/[^/]+)$/.exec(bare);
  if (github !== null) return `github:${github[1]!.toLowerCase()}`;
  return isAbsolute(bare) ? resolve(bare) : bare;
}

/** The repository package.json names, where a release goes, and the remote whose URL is it, or undefined where no remote's is. */
function releaseRemote(repo: string): { url: string; remote: string | undefined } {
  const named = (JSON.parse(git(repo, "show", "HEAD:package.json").out) as { repository?: string | { url?: string } }).repository;
  const url = (typeof named === "string" ? named : named?.url) ?? "";
  const remote = git(repo, "remote").out.split("\n").filter(Boolean).find((name) => url !== "" && repositoryOf(git(repo, "remote", "get-url", name).out) === repositoryOf(url));
  return { url, remote };
}

/** Why the repository's HEAD may not be cut as a prerelease now: empty when it may. Fetches the release's remote first, pruning what it deleted. */
export function prereleaseProblems(repo: string): string[] {
  const problems: string[] = [];
  const { version, manifests, unreadable } = versionsOf(repo);
  if (!/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version)) problems.push(`package.json names ${version}, which is no prerelease (1.11.0-beta.3): a release of main is release.yml's`);
  for (const m of manifests) if (m.version !== version) problems.push(`${m.file} names ${m.version}, not the package's ${version}: npm version bumps package.json alone`);
  for (const file of unreadable) problems.push(`${file} does not read as a manifest naming a version`);
  const head = git(repo, "rev-parse", "HEAD").out;
  const { url, remote } = releaseRemote(repo);
  if (remote === undefined) {
    problems.push(`no remote's URL is the repository package.json names (${url || "none"}), where the release goes`);
    return problems;
  }
  // Read through the remote's own refs, fetched now: a local tag or branch named like them, or a branch the remote deleted since, says nothing.
  const main = `refs/remotes/${remote}/main`;
  // Every branch, by an explicit refspec, so a remote configured to fetch fewer (set-branches) still brings main and every branch now.
  if (!git(repo, "fetch", "--quiet", "--prune", remote, `+refs/heads/*:refs/remotes/${remote}/*`).ok) problems.push(`${remote} could not be fetched, so whether HEAD holds its main and is on it are unknown`);
  else {
    if (!git(repo, "merge-base", "--is-ancestor", main, head).ok) problems.push(`${remote}/main (${git(repo, "rev-parse", "--short", main).out}) is not an ancestor of HEAD (${head.slice(0, 7)}): merge it first, or the prerelease takes back what main shipped since this branch left it`);
    if (git(repo, "for-each-ref", "--contains", head, "--format=%(refname)", `refs/remotes/${remote}/`).out === "") problems.push(`HEAD (${head.slice(0, 7)}) is on no branch of ${remote}: push it, since the release's target must be there`);
  }
  // A listing that failed says nothing of the tag, so it is a reason too, never read as "no such tag".
  const tags = git(repo, "ls-remote", "--tags", remote, `refs/tags/v${version}`);
  if (!tags.ok) problems.push(`${remote}'s tags could not be listed, so whether v${version} exists is unknown`);
  else if (tags.out !== "") problems.push(`the tag v${version} exists already: bump the version`);
  return problems;
}

// The workflow's check step: every reason named, and a failure when there is one. It takes no arguments and cuts nothing.
if (import.meta.main) {
  // The arguments the retired local cut took (--notes, --dry-run) are refused, so no one takes a check for a cut.
  if (process.argv.length > 2) {
    process.stderr.write("usage: node src/lifecycle/prerelease.ts\nit checks HEAD and cuts nothing; a prerelease is cut by CI: gh workflow run prerelease.yml -f ref=<branch> -f notes=\"<markdown>\"\n");
    process.exit(2);
  }
  const problems = prereleaseProblems(resolve(import.meta.dirname, "..", ".."));
  if (problems.length > 0) {
    process.stderr.write(`not cut:\n${problems.map((p) => `- ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("no reason not to cut it\n");
}
