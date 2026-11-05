import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { prereleaseProblems, repositoryOf } from "./prerelease.ts";
import { execFileSync, spawnSync } from "./work-meter.ts";

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

/** Main moves on without the branch, pushed from another clone of the origin. */
function moveMain(work: string, name: string): void {
  const other = join(work, "..", name);
  git(join(work, ".."), "clone", "--quiet", join(work, "..", "origin.git"), other);
  git(other, "commit", "--quiet", "--allow-empty", "-m", `main moves on (${name})`);
  git(other, "push", "--quiet", "origin", "HEAD:main");
}

/**
 * The workflow's lines as a lint reads them: comments and blank lines dropped, each with its indentation. A lint of
 * the file's shape, not a reading of what the workflow does: it refuses the YAML forms it does not read (a tab, a node
 * named with & or recalled with *, a merge key, a flow mapping, a quoted or complex key, a second document) rather than
 * read past them.
 */
function workflowLines(text: string): { indent: number; text: string }[] {
  const lines: { indent: number; text: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s+)#.*$/, "");
    if (line.trim() === "") continue;
    assert.doesNotMatch(line, /\t|^\s*(- )?["'?]|<<\s*:|:\s+[&*!{]|^---|^\.\.\./, `a YAML form this lint does not read: ${raw}`);
    lines.push({ indent: line.length - line.trimStart().length, text: line.trim() });
  }
  return lines;
}

/** The lines under the one at index, those indented deeper than it, up to the next that is not. */
function blockUnder(lines: { indent: number; text: string }[], index: number): { indent: number; text: string }[] {
  const under: { indent: number; text: string }[] = [];
  for (let i = index + 1; i < lines.length && lines[i]!.indent > lines[index]!.indent; i++) under.push(lines[i]!);
  return under;
}

/** The keys a block holds at its own level: the lines at its least indentation. */
function keysOf(block: { indent: number; text: string }[]): string[] {
  const level = Math.min(...block.map((line) => line.indent));
  return block.filter((line) => line.indent === level).map((line) => line.text);
}

describe("a prerelease is cut only from a clean HEAD on a branch of the remote package.json names, holding that remote's main as fetched now, at a prerelease version every bundled plugin and mod that follows the package names, under a tag no release has", () => {
  test("a branch that holds main, pushed, at one version throughout, may be cut", () => {
    const { work } = repository("1.11.0-beta.3");
    assert.deepEqual(prereleaseProblems(work), [], "a branch that holds main, pushed and committed, at one version throughout");
  });

  test("main moved on is refused, read by its full ref and fetched now, whatever branches the remote is set to fetch", () => {
    const { work } = repository("1.11.0-beta.3");
    // The prerelease would take back what main shipped, a local tag named origin/main at the old main notwithstanding.
    git(work, "tag", "origin/main", "HEAD~1");
    moveMain(work, "other");
    assert.match(prereleaseProblems(work).join("\n"), /origin\/main \([0-9a-f]+\) is not an ancestor of HEAD/);
    git(work, "tag", "-d", "origin/main");
    git(work, "merge", "--quiet", "--no-edit", "origin/main");
    git(work, "push", "--quiet", "origin", "beta");
    assert.deepEqual(prereleaseProblems(work), [], "once merged and pushed, it may be cut");
    // A remote set to fetch fewer branches still has main fetched now.
    git(work, "remote", "set-branches", "origin", "beta");
    moveMain(work, "mover");
    assert.match(prereleaseProblems(work).join("\n"), /origin\/main \([0-9a-f]+\) is not an ancestor of HEAD/, "main fetched now, whatever branches the remote is set to fetch");
  });

  test("a plugin left at another version, a manifest that does not read or names no version, and a commit not pushed are each refused, every version read from HEAD", () => {
    const { work } = repository("1.11.0-beta.3");
    // The versions it vouches for are HEAD's, the commit the workflow checks out, not a working tree's.
    writeFileSync(join(work, "plugins", "python", "plugin.json"), JSON.stringify({ name: "python", version: "1.11.0-beta.2" }));
    assert.deepEqual(prereleaseProblems(work), [], "a version the working tree holds and HEAD does not is not the release's");
    git(work, "commit", "--quiet", "-am", "python left behind");
    const problems = prereleaseProblems(work).join("\n");
    assert.match(problems, /plugins\/python\/plugin\.json names 1\.11\.0-beta\.2, not the package's 1\.11\.0-beta\.3/);
    assert.doesNotMatch(problems, /plugins\/go/, "a plugin with a version of its own keeps it");
    assert.match(problems, /HEAD \([0-9a-f]+\) is on no branch of origin/);
    // A major release whose bump left a plugin at the version before.
    assert.match(prereleaseProblems(repository("2.0.0-beta.1", "1.11.0-beta.3").work).join("\n"), /plugins\/python\/plugin\.json names 1\.11\.0-beta\.3, not the package's 2\.0\.0-beta\.1/);
    // A manifest that does not read, or names no version, is one the release cannot vouch for.
    for (const [label, text] of [["does not read", "{ not json"], ["names no version", JSON.stringify({ name: "python" })]] as const) {
      const broken = repository("1.11.0-beta.3").work;
      writeFileSync(join(broken, "plugins", "python", "plugin.json"), text);
      git(broken, "commit", "--quiet", "-am", `a manifest that ${label}`);
      assert.match(prereleaseProblems(broken).join("\n"), /plugins\/python\/plugin\.json does not read as a manifest naming a version/, `a manifest that ${label}`);
    }
  });

  test("HEAD only on a fork, on a branch the remote deleted, or in a clone whose only remote is a fork is on no branch of the release's remote", () => {
    const { work } = repository("1.11.0-beta.3");
    git(work, "commit", "--quiet", "--allow-empty", "-m", "not pushed");
    const fork = join(work, "..", "fork.git");
    git(join(work, ".."), "init", "--quiet", "--bare", fork);
    git(work, "remote", "add", "fork", fork);
    git(work, "push", "--quiet", "fork", "HEAD:beta");
    assert.match(prereleaseProblems(work).join("\n"), /HEAD \([0-9a-f]+\) is on no branch of origin/, "a fork's branch is not the release's remote");
    // Pushed, then the branch deleted on the remote while this clone's tracking ref stays: fetched now, it is on no branch.
    git(work, "push", "--quiet", "origin", "HEAD:beta");
    assert.doesNotMatch(prereleaseProblems(work).join("\n"), /is on no branch/);
    git(work, "push", "--quiet", "origin", "--delete", "beta");
    git(work, "update-ref", "refs/remotes/origin/beta", "HEAD");
    assert.match(prereleaseProblems(work).join("\n"), /HEAD \([0-9a-f]+\) is on no branch of origin/, "a branch the remote deleted holds it no longer");
    // A clone whose only remote is a fork, as origin: no remote is the repository package.json names.
    const forked = join(work, "..", "forked");
    git(join(work, ".."), "clone", "--quiet", "--branch", "beta", fork, forked);
    assert.match(prereleaseProblems(forked).join("\n"), /no remote's URL is the repository package\.json names/);
  });

  test("a version that is no prerelease, a tag that exists and tags that cannot be listed are refused, GitHub is matched by its own host alone, and the script spells no remote", () => {
    assert.match(prereleaseProblems(repository("1.11.0").work).join("\n"), /package\.json names 1\.11\.0, which is no prerelease/);
    const tagged = repository("1.11.0-beta.3").work;
    git(tagged, "tag", "v1.11.0-beta.3");
    git(tagged, "push", "--quiet", "origin", "v1.11.0-beta.3");
    assert.match(prereleaseProblems(tagged).join("\n"), /the tag v1\.11\.0-beta\.3 exists already/);
    // A remote that cannot be read says nothing of its tags: that is a reason, never "no such tag".
    const unread = repository("1.11.0-beta.3").work;
    renameSync(join(unread, "..", "origin.git.git"), join(unread, "..", "moved.git"));
    const unreadable = prereleaseProblems(unread).join("\n");
    assert.match(unreadable, /origin's tags could not be listed, so whether v1\.11\.0-beta\.3 exists is unknown/);
    assert.doesNotMatch(unreadable, /exists already/);
    // GitHub by its own host alone, in every form git spells it; a host that merely ends in its name is another repository.
    for (const url of ["git+https://github.com/PostHog/coherence.git", "git@github.com:PostHog/coherence.git", "ssh://git@ssh.github.com:443/PostHog/coherence.git", "https://github.com/PostHog/coherence"]) assert.equal(repositoryOf(url), "github:posthog/coherence", url);
    for (const url of ["git@evilgithub.com:PostHog/coherence.git", "https://notgithub.com/PostHog/coherence"]) assert.notEqual(repositoryOf(url), "github:posthog/coherence", url);
    // The script names no remote and no repository of its own: every git command it runs reaches the one package.json names.
    const source = readFileSync(join(import.meta.dirname, "prerelease.ts"), "utf8").replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
    assert.doesNotMatch(source, /["'`](origin|upstream|PostHog\/coherence)\b/, "no remote or repository is spelled in the script's code");
  });

  test("the workflow's shape is linted, not its behaviour: dispatched by hand alone, read access but for the one job that releases, which alone may write contents and checks nothing out, no id-token or environment, every action pinned by commit; the module cuts nothing", () => {
    // A lint of the file's text: what the workflow does is held by how it is built and by its runs, never by this test.
    const lines = workflowLines(readFileSync(join(import.meta.dirname, "..", "..", ".github", "workflows", "prerelease.yml"), "utf8"));
    const top = (key: string): number => {
      const found = lines.flatMap((line, n) => (line.indent === 0 && line.text.startsWith(`${key}:`) ? [n] : []));
      assert.equal(found.length, 1, `one top-level ${key}`);
      return found[0]!;
    };
    assert.deepEqual(lines.filter((line) => line.indent === 0).map((line) => line.text.replace(/:.*$/, "")), ["name", "run-name", "on", "permissions", "concurrency", "jobs"], "the top-level keys, and no other");
    // Dispatched by hand, and by nothing else.
    assert.equal(lines[top("on")]!.text, "on:");
    assert.deepEqual(keysOf(blockUnder(lines, top("on"))), ["workflow_dispatch:"], "dispatched by hand, and by nothing else");
    // Read access for the workflow; each job names its own, and one job alone may write contents, the one that releases.
    assert.deepEqual(blockUnder(lines, top("permissions")).map((line) => line.text), ["contents: read"]);
    const jobs = blockUnder(lines, top("jobs"));
    const jobLevel = Math.min(...jobs.map((line) => line.indent));
    const jobStarts = jobs.flatMap((line, n) => (line.indent === jobLevel ? [n] : []));
    const writers: string[] = [];
    for (const start of jobStarts) {
      const name = jobs[start]!.text;
      const job = blockUnder(jobs, start);
      const permissions = job.findIndex((line) => line.indent === job[0]!.indent && line.text.startsWith("permissions:"));
      assert.ok(permissions >= 0 && job[permissions]!.text === "permissions:", `${name} names its permissions, as a mapping`);
      const granted = blockUnder(job, permissions).map((line) => line.text);
      assert.ok(granted.every((grant) => /^contents: (read|write)$/.test(grant)) && granted.length === 1, `${name} holds contents alone: ${granted.join(", ")}`);
      if (granted[0] === "contents: write") {
        writers.push(name);
        assert.ok(job.some((line) => /\bgh release create\b/.test(line.text)), `${name}, which may write, is the job that releases`);
        assert.ok(!job.some((line) => /actions\/checkout@/.test(line.text)), `${name}, which may write, checks nothing out`);
      }
    }
    assert.equal(writers.length, 1, `one job may write contents: ${writers.join(", ")}`);
    assert.ok(!lines.some((line) => /\bwrite-all\b|\bid-token\b|^environment\s*:/.test(line.text)), "no write-all, no id-token (so no npm trusted publishing), and not the Release environment");
    // Every action pinned by commit.
    const uses = lines.filter((line) => /\buses\s*:/.test(line.text));
    assert.ok(uses.length > 0, "the workflow uses actions");
    for (const line of uses) assert.match(line.text, /^(- )?uses: [\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/, `pinned by commit: ${line.text}`);
    // The module cuts nothing: no gh, npm or clone in its code, so the workflow is the one way a prerelease is made;
    const source = readFileSync(join(import.meta.dirname, "prerelease.ts"), "utf8").replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
    assert.doesNotMatch(source, /["'`](gh|npm|npx)["'`]|["'`]clone["'`]|release create/, "the module runs no gh, npm or clone");
    // and the retired local cut's arguments are refused, so no one takes the check for a cut.
    const retired = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "prerelease.ts"), "--notes", "notes.md", "--dry-run"], { encoding: "utf8" });
    assert.equal(retired.status, 2, `the local cut's arguments are refused: ${retired.stderr}`);
    assert.match(retired.stderr, /cuts nothing; a prerelease is cut by CI: gh workflow run prerelease\.yml/);
  });
});
