import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** A value of the block YAML the workflows are written in. */
type Yaml = string | null | Yaml[] | { [key: string]: Yaml };

/**
 * A strict reader of the block YAML the workflows are written in: mappings, sequences, plain and quoted scalars, flow
 * sequences of plain scalars, and literal block scalars, every scalar a string. Anything else (a tab, a node named with & or recalled with *, a tag, a
 * flow mapping, a folded scalar, a duplicate key, a plain scalar holding ": ", indentation no parent expects) throws,
 * so it never reads a file as YAML would not.
 */
function readYaml(text: string): Yaml {
  if (text.includes("\t")) throw new Error("a tab, which YAML refuses for indentation");
  const lines = text.split("\n");
  let i = 0;
  const fail = (why: string): never => {
    throw new Error(`line ${i + 1}: ${why}: ${lines[i]}`);
  };
  const indentOf = (line: string): number => line.length - line.trimStart().length;
  const isItem = (line: string): boolean => /^\s*-( |$)/.test(line);
  const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*|"[^"]*"|'[^']*'):(?: +(.*))?$/;
  // The next line that is neither blank nor a comment, outside a block scalar.
  const next = (): number => {
    while (i < lines.length && /^\s*(#.*)?$/.test(lines[i]!)) i++;
    return i;
  };
  const scalar = (raw: string): Yaml => {
    const s = raw.trim();
    if (s === "" || s.startsWith("#")) return null;
    if (s.startsWith('"')) return (/^"((?:[^"\\]|\\.)*)" *(#.*)?$/.exec(s) ?? fail("a double-quoted scalar that does not close"))[1]!.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
    if (s.startsWith("'")) return (/^'((?:[^']|'')*)' *(#.*)?$/.exec(s) ?? fail("a single-quoted scalar that does not close"))[1]!.replace(/''/g, "'");
    if (s.startsWith("[")) return (/^\[([^[\]{}"']*)\] *(#.*)?$/.exec(s) ?? fail("a flow sequence of more than plain scalars"))[1]!.split(",").map((item) => item.trim()).filter((item) => item !== "").map(scalar);
    if (/^[{&*!|>%@`]/.test(s)) fail("a form this reader does not take");
    const plain = s.replace(/ +#.*$/, "");
    if (/: |:$/.test(plain)) fail("a plain scalar holding ': '");
    return plain;
  };
  // A literal block scalar under a key at `indent`: every line deeper than it, or blank, taken as written.
  const literal = (indent: number): string => {
    const body: string[] = [];
    while (i < lines.length && (lines[i]!.trim() === "" || indentOf(lines[i]!) > indent)) body.push(lines[i++]!);
    while (body.length > 0 && body.at(-1)!.trim() === "") body.pop();
    const at = Math.min(...body.filter((line) => line.trim() !== "").map(indentOf));
    return `${body.map((line) => line.slice(at)).join("\n")}\n`;
  };
  const mapping = (indent: number): { [key: string]: Yaml } => {
    const out: { [key: string]: Yaml } = {};
    while (next() < lines.length) {
      const line = lines[i]!;
      if (indentOf(line) < indent || (indentOf(line) === indent && isItem(line))) break;
      if (indentOf(line) > indent) fail("indentation this mapping does not expect");
      const m = KEY.exec(line.slice(indent)) ?? fail("no key");
      const key = m[1]!.replace(/^(["'])(.*)\1$/, "$2");
      if (Object.hasOwn(out, key)) fail(`the key ${key} twice`);
      const rest = (m[2] ?? "").trim();
      i++;
      if (/^\|-?( +#.*)?$/.test(rest)) out[key] = literal(indent);
      else if (rest !== "" && !rest.startsWith("#")) out[key] = scalar(rest);
      else if (next() < lines.length && (indentOf(lines[i]!) > indent || (indentOf(lines[i]!) === indent && isItem(lines[i]!)))) out[key] = block();
      else out[key] = null;
    }
    return out;
  };
  const sequence = (indent: number): Yaml[] => {
    const out: Yaml[] = [];
    while (next() < lines.length) {
      const line = lines[i]!;
      if (indentOf(line) < indent || (indentOf(line) === indent && !isItem(line))) break;
      if (indentOf(line) > indent) fail("indentation this sequence does not expect");
      const content = line.slice(indent + 1).trimStart();
      if (content === "" || content.startsWith("#")) {
        i++;
        out.push(next() < lines.length && indentOf(lines[i]!) > indent ? block() : null);
      } else if (KEY.test(content)) {
        // A mapping begun on the item's own line: read as though its first key stood alone, at the column it starts at.
        const column = line.length - content.length;
        lines[i] = `${" ".repeat(column)}${content}`;
        out.push(mapping(column));
      } else {
        i++;
        out.push(scalar(content));
      }
    }
    return out;
  };
  const block = (): Yaml => (isItem(lines[next()]!) ? sequence(indentOf(lines[i]!)) : mapping(indentOf(lines[i]!)));
  const document = block();
  if (next() < lines.length) fail("a line no mapping or sequence holds");
  return document;
}

/** The mapping a value is, refused when it is none. */
function mappingOf(value: Yaml | undefined, what: string): { [key: string]: Yaml } {
  assert.ok(value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value), `${what} is a mapping`);
  return value;
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

  test("a version that is no prerelease and a tag that exists are refused, GitHub is matched by its own host alone, and the script spells no remote", () => {
    assert.match(prereleaseProblems(repository("1.11.0").work).join("\n"), /package\.json names 1\.11\.0, which is no prerelease/);
    const tagged = repository("1.11.0-beta.3").work;
    git(tagged, "tag", "v1.11.0-beta.3");
    git(tagged, "push", "--quiet", "origin", "v1.11.0-beta.3");
    assert.match(prereleaseProblems(tagged).join("\n"), /the tag v1\.11\.0-beta\.3 exists already/);
    // GitHub by its own host alone, in every form git spells it; a host that merely ends in its name is another repository.
    for (const url of ["git+https://github.com/PostHog/coherence.git", "git@github.com:PostHog/coherence.git", "ssh://git@ssh.github.com:443/PostHog/coherence.git", "https://github.com/PostHog/coherence"]) assert.equal(repositoryOf(url), "github:posthog/coherence", url);
    for (const url of ["git@evilgithub.com:PostHog/coherence.git", "https://notgithub.com/PostHog/coherence"]) assert.notEqual(repositoryOf(url), "github:posthog/coherence", url);
    // The script names no remote and no repository of its own: every git command it runs reaches the one package.json names.
    const source = readFileSync(join(import.meta.dirname, "prerelease.ts"), "utf8").replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
    assert.doesNotMatch(source, /["'`](origin|upstream|PostHog\/coherence)\b/, "no remote or repository is spelled in the script's code");
  });

  test("the workflow alone cuts, by hand: it checks a branch out clean with full history, checks it before it installs or packs, makes a prerelease targeting by sha the commit it checked out, with contents: write and nothing more, every action pinned by commit, and never publishes to npm", () => {
    // Read as YAML, not as text: what GitHub reads is the parse, so a key, a step or a permission is held where it stands.
    const flow = mappingOf(readYaml(readFileSync(join(import.meta.dirname, "..", "..", ".github", "workflows", "prerelease.yml"), "utf8")), "the workflow");
    // Run by hand alone, with a branch and the notes, both required.
    const on = mappingOf(flow.on, "on");
    assert.deepEqual(Object.keys(on), ["workflow_dispatch"], "dispatched by hand, and by nothing else");
    const inputs = mappingOf(mappingOf(on.workflow_dispatch, "workflow_dispatch").inputs, "its inputs");
    assert.deepEqual(Object.keys(inputs).sort(), ["notes", "ref"]);
    for (const name of ["notes", "ref"]) assert.equal(mappingOf(inputs[name], name).required, "true", `${name} is required`);
    // The least it needs: read for the workflow, write for the one job that creates the release, and no id-token, so no npm trusted publishing.
    assert.deepEqual(flow.permissions, { contents: "read" });
    const jobs = mappingOf(flow.jobs, "jobs");
    assert.deepEqual(Object.keys(jobs), ["prerelease"]);
    const job = mappingOf(jobs.prerelease, "the job");
    assert.deepEqual(job.permissions, { contents: "write" }, "contents: write and nothing more");
    assert.equal(job.environment, undefined, "not the Release environment, which publishes to npm from main");
    const concurrency = mappingOf(flow.concurrency, "concurrency");
    assert.ok(typeof concurrency.group === "string" && concurrency.group !== "", "one concurrency group");
    assert.equal(concurrency["cancel-in-progress"], "false", "a second cut waits rather than cancelling the first");
    assert.ok(Array.isArray(job.steps));
    const steps = job.steps.map((step, n) => mappingOf(step, `step ${n + 1}`));
    // Every action pinned by commit.
    for (const step of steps.filter((step) => step.uses !== undefined)) assert.match(String(step.uses), /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/, `pinned by commit: ${String(step.uses)}`);
    // The branch checked out first, clean, by its full ref, with full history (main's ancestry), and no credentials left on disk.
    assert.match(String(steps[0]!.uses), /^actions\/checkout@/);
    assert.deepEqual(steps[0]!.with, { ref: "refs/heads/${{ inputs.ref }}", "fetch-depth": "0", "persist-credentials": "false" });
    const runs = steps.map((step) => (typeof step.run === "string" ? step.run : ""));
    // No expression reaches a shell but through a step's environment, so neither input can be spliced into a script.
    for (const run of runs) assert.doesNotMatch(run, /\$\{\{/, `an expression spliced into a script: ${run}`);
    // Never npm: no publish, and no registry set up to publish to.
    for (const run of runs) assert.doesNotMatch(run, /\bnpm\b[^\n]*\bpublish\b/, `an npm publish: ${run}`);
    assert.doesNotMatch(JSON.stringify(flow), /registry-url|NODE_AUTH_TOKEN|NPM_TOKEN|id-token/, "nothing set up to publish to npm");
    // The checks, then the install and the pack, then the release, in that order.
    const index = (pattern: RegExp, what: string): number => {
      const found = runs.flatMap((run, n) => (pattern.test(run) ? [n] : []));
      assert.equal(found.length, 1, `one step ${what}`);
      return found[0]!;
    };
    const check = index(/^node( --[\w=-]+)* src\/lifecycle\/prerelease\.ts\n?$/, "runs the checks");
    const install = index(/^npm ci\b/, "installs");
    const pack = index(/^npm pack\n?$/, "packs");
    const release = index(/\bgh release create\b/, "creates the release");
    assert.ok(0 < check && check < install && install < pack && pack < release, `checks ${check}, installs ${install}, packs ${pack}, releases ${release}, in that order`);
    // A prerelease, its target the commit checked out by sha: the environment variable --target names is a step's output, written from git rev-parse HEAD.
    const create = runs[release]!.split("\n").find((line) => /\bgh release create\b/.test(line))!;
    assert.match(create, / --prerelease\b/, "marked a prerelease");
    const target = / --target "\$(\w+)"/.exec(create)?.[1];
    assert.ok(target !== undefined, `--target names a variable: ${create}`);
    const output = /^\$\{\{ steps\.([\w-]+)\.outputs\.([\w-]+) \}\}$/.exec(String(mappingOf(steps[release]!.env, "the release's env")[target]));
    assert.ok(output !== null, `--target is a step's output, never a branch's name: ${target}`);
    const resolved = steps.findIndex((step) => step.id === output[1]);
    assert.ok(0 < resolved && resolved < check, "the commit is resolved after the checkout and before the checks");
    assert.match(runs[resolved]!, new RegExp(`^echo "${output[2]}=\\$\\(git rev-parse HEAD\\)" >> "\\$GITHUB_OUTPUT"$`, "m"), "from the commit checked out");
    assert.match(create, /"posthog-coherence-\$VERSION\.tgz"$/, "carrying the tarball packed");
    // The module cuts nothing: no gh, npm or clone in its code, so the workflow is the one way a prerelease is made;
    const source = readFileSync(join(import.meta.dirname, "prerelease.ts"), "utf8").replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
    assert.doesNotMatch(source, /["'`](gh|npm|npx)["'`]|["'`]clone["'`]|release create/, "the module runs no gh, npm or clone");
    // and the retired local cut's arguments are refused, so no one takes the check for a cut.
    const retired = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "prerelease.ts"), "--notes", "notes.md", "--dry-run"], { encoding: "utf8" });
    assert.equal(retired.status, 2, `the local cut's arguments are refused: ${retired.stderr}`);
    assert.match(retired.stderr, /cuts nothing; a prerelease is cut by CI: gh workflow run prerelease\.yml/);
  });
});
