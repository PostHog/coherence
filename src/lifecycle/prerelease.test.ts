import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { prereleaseCommands, prereleaseProblems } from "./prerelease.ts";
import { execFileSync } from "./work-meter.ts";

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
}

/** A repository with an origin whose main the branch left, the package (naming origin as its repository) and its bundled manifests at a version. */
function repository(version: string, pluginVersion: string = version): { work: string } {
  const top = mkdtempSync(join(tmpdir(), "coherence-prerelease-"));
  fixtures.push(top);
  const origin = join(top, "origin.git");
  git(top, "init", "--quiet", "--bare", "--initial-branch=main", `${origin}.git`);
  const work = join(top, "work");
  git(top, "clone", "--quiet", `${origin}.git`, work);
  const write = (path: string, text: string): void => {
    mkdirSync(join(work, path, ".."), { recursive: true });
    writeFileSync(join(work, path), text);
  };
  write("package.json", JSON.stringify({ name: "@posthog/coherence", version, repository: { type: "git", url: `git+${origin}.git` } }));
  write("plugins/python/plugin.json", JSON.stringify({ name: "python", version: pluginVersion }));
  write("plugins/go/plugin.json", JSON.stringify({ name: "go", version: "0.1.0" }));
  write("mods/coherence/.claude-plugin/plugin.json", JSON.stringify({ name: "coherence", version }));
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "start");
  git(work, "push", "--quiet", "origin", "HEAD:main");
  git(work, "checkout", "--quiet", "-b", "beta");
  git(work, "commit", "--quiet", "--allow-empty", "-m", "beta work");
  git(work, "push", "--quiet", "origin", "beta");
  return { work };
}

test("a prerelease is cut only from a clean HEAD on a branch of the remote package.json names, holding that remote's main as fetched now, at a prerelease version every bundled plugin and mod that follows the package names, under a tag no release has", () => {
  const { work } = repository("1.11.0-beta.3");
  assert.deepEqual(prereleaseProblems(work), [], "a branch that holds main, pushed and committed, at one version throughout");
  const [pack, release] = prereleaseCommands(work, "/notes.md", "/out");
  assert.deepEqual(pack, ["npm", "pack", "--pack-destination", "/out"]);
  assert.deepEqual(release!.slice(0, 5), ["gh", "release", "create", "v1.11.0-beta.3", "--repo"]);
  assert.ok(release!.includes("--prerelease") && release!.includes(git(work, "rev-parse", "HEAD")) && release!.at(-1) === "/out/posthog-coherence-1.11.0-beta.3.tgz", "a prerelease of HEAD carrying the tarball");

  // Main moves on without the branch: the prerelease would take back what main shipped, a local tag named origin/main at the old main notwithstanding.
  git(work, "tag", "origin/main", "HEAD~1");
  const other = join(work, "..", "other");
  git(join(work, ".."), "clone", "--quiet", join(work, "..", "origin.git"), other);
  git(other, "commit", "--quiet", "--allow-empty", "-m", "main moves on (#153)");
  git(other, "push", "--quiet", "origin", "HEAD:main");
  assert.match(prereleaseProblems(work).join("\n"), /origin\/main \([0-9a-f]+\) is not an ancestor of HEAD/);
  git(work, "tag", "-d", "origin/main");
  git(work, "merge", "--quiet", "--no-edit", "origin/main");
  git(work, "push", "--quiet", "origin", "beta");
  assert.deepEqual(prereleaseProblems(work), [], "once merged and pushed, it may be cut");

  // A file no commit names, which npm pack would ship all the same.
  writeFileSync(join(work, "plugins", "python", "secret.env"), "TOKEN=1\n");
  assert.match(prereleaseProblems(work).join("\n"), /the working tree holds changes or files[\s\S]*secret\.env/);
  rmSync(join(work, "plugins", "python", "secret.env"));
  // A bundled plugin npm version left behind; a change no commit names; a commit not pushed.
  writeFileSync(join(work, "plugins", "python", "plugin.json"), JSON.stringify({ name: "python", version: "1.11.0-beta.2" }));
  const problems = prereleaseProblems(work).join("\n");
  assert.match(problems, /plugins\/python\/plugin\.json names 1\.11\.0-beta\.2, not the package's 1\.11\.0-beta\.3/);
  assert.match(problems, /the working tree holds changes/);
  assert.doesNotMatch(problems, /plugins\/go/, "a plugin with a version of its own keeps it");
  git(work, "commit", "--quiet", "-am", "python left behind");
  assert.match(prereleaseProblems(work).join("\n"), /HEAD \([0-9a-f]+\) is on no branch of origin/);
  // Pushed only to a fork: not on the release's remote.
  const fork = join(work, "..", "fork.git");
  git(join(work, ".."), "init", "--quiet", "--bare", fork);
  git(work, "remote", "add", "fork", fork);
  git(work, "push", "--quiet", "fork", "HEAD:beta");
  assert.match(prereleaseProblems(work).join("\n"), /HEAD \([0-9a-f]+\) is on no branch of origin/, "a fork's branch is not the release's remote");
  // Pushed, then the branch deleted on the remote while this clone's tracking ref stays: fetched now, it is on no branch.
  git(work, "push", "--quiet", "origin", "HEAD:beta");
  assert.doesNotMatch(prereleaseProblems(work).join("\n"), /is on no branch/);
  git(other, "push", "--quiet", "origin", "--delete", "beta");
  assert.match(prereleaseProblems(work).join("\n"), /HEAD \([0-9a-f]+\) is on no branch of origin/, "a branch the remote deleted holds it no longer");
  // A clone whose only remote is a fork, as origin: no remote is the repository package.json names.
  const forked = join(work, "..", "forked");
  git(join(work, ".."), "clone", "--quiet", "--branch", "beta", fork, forked);
  assert.match(prereleaseProblems(forked).join("\n"), /no remote's URL is the repository package\.json names/);
  // A major release whose bump left a plugin at the version before.
  assert.match(prereleaseProblems(repository("2.0.0-beta.1", "1.11.0-beta.3").work).join("\n"), /plugins\/python\/plugin\.json names 1\.11\.0-beta\.3, not the package's 2\.0\.0-beta\.1/);

  // A version that is no prerelease, and a tag that exists.
  const plain = repository("1.11.0").work;
  assert.match(prereleaseProblems(plain).join("\n"), /package\.json names 1\.11\.0, which is no prerelease/);
  const tagged = repository("1.11.0-beta.3").work;
  git(tagged, "tag", "v1.11.0-beta.3");
  git(tagged, "push", "--quiet", "origin", "v1.11.0-beta.3");
  assert.match(prereleaseProblems(tagged).join("\n"), /the tag v1\.11\.0-beta\.3 exists already/);

  // The script names no remote and no repository of its own: every git and gh command it runs reaches the one package.json names.
  const source = readFileSync(join(import.meta.dirname, "prerelease.ts"), "utf8").replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
  assert.doesNotMatch(source, /["'`](origin|upstream|PostHog\/coherence)\b/, "no remote or repository is spelled in the script's code");
});
