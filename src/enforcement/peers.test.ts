/**
 * Peers: a test that reads a file another repository owns runs against that
 * repository's checkout, named once in the config, and its verdict carries the
 * commit and blob it read. A checkout that is not there, or does not hold the
 * file, reads not run with how to get it, never pass; a change on the other
 * side turns the check red (the hogtower and hoglake token vectors, where a
 * hand copy of the other side's vectors stayed green while the owner moved).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runCommand } from "./cli.ts";
import { loadRuns, type RunEntry } from "./record.ts";
import { defaultPeerEnv, parsePeerFile, readPeers } from "./peers.ts";
import { loadSpecModel } from "../spec/model.ts";

const READER = `import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("mints what the owner's vectors expect", () => {
  const vectors = JSON.parse(readFileSync(join(process.env.OWNER_CHECKOUT, "tokens/vectors.json"), "utf8"));
  assert.deepEqual(vectors.claims, ["iss", "aud", "cli"], "the minter writes iss, aud and cli");
});
`;

const SPEC = (peerLine: string): string => `# Issuer

Mints tokens another repository verifies.

## invariants
- conforms: Every token the issuer mints carries the claims the owner's vectors expect.
  over: every claim the owner's vectors name
  via: mints what the owner's vectors expect
${peerLine}
  because: the owner refuses a token outside its vectors
  kinds: none
`;

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** A project beside a peer checkout: <base>/issuer reads <base>/owner/tokens/vectors.json. */
function fixture(): { base: string; root: string; owner: string; commit: string } {
  const base = mkdtempSync(join(tmpdir(), "coherence-peers-"));
  const root = join(base, "issuer");
  const owner = join(base, "owner");
  write(owner, "tokens/vectors.json", JSON.stringify({ claims: ["iss", "aud", "cli"] }));
  git(owner, "init", "-q");
  git(owner, "-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
  git(owner, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "vectors");
  write(root, "tests/conform.test.mjs", READER);
  write(root, "Issuer.spec.md", SPEC("  peer: owner tokens/vectors.json"));
  write(
    root,
    "coherence.config.json",
    JSON.stringify({
      language: "typescript",
      testDir: "tests",
      test: "node --disable-warning=ExperimentalWarning --test --test-name-pattern={filter} tests/conform.test.mjs",
      testMatch: "# pass [1-9][0-9]*",
      peers: { owner: { repository: "Example/owner", checkout: "../owner", env: "OWNER_CHECKOUT" } },
    }),
  );
  return { base, root, owner, commit: git(owner, "rev-parse", "HEAD") };
}

async function runOnce(root: string, session: string): Promise<{ entry: RunEntry; err: string }> {
  const context = process.env["NODE_TEST_CONTEXT"];
  delete process.env["NODE_TEST_CONTEXT"];
  const err: string[] = [];
  try {
    await runCommand(["--session", session, "--agent", "enforcement"], { cwd: root, out: () => {}, err: (l) => err.push(l) });
  } finally {
    if (context !== undefined) process.env["NODE_TEST_CONTEXT"] = context;
  }
  const runs = loadRuns(root).records.filter((r) => r.session === session);
  const entry = runs.at(-1)?.invariants.find((e) => e.name === "conforms" && e.form === "totality oracle");
  assert.ok(entry !== undefined, `the run recorded the bullet: ${err.join("\n")}`);
  return { entry, err: err.join("\n") };
}

test("a test that reads a peer's file runs against the peer's checkout, records what it read, goes red when the peer changes, and reads not run without the checkout", { timeout: 120_000 }, async () => {
  const { base, root, owner, commit } = fixture();
  try {
    const green = await runOnce(root, "peers-1");
    assert.equal(green.entry.verdict, "pass", green.entry.reason);
    assert.deepEqual(green.entry.peers?.map((p) => [p.peer, p.path, p.repository, p.commit, p.dirty]), [["owner", "tokens/vectors.json", "Example/owner", commit, false]], "the verdict names the commit of the other side it read");
    assert.match(green.entry.peers![0]!.blob, /^[0-9a-f]{40}$/);
    assert.equal(green.entry.peers![0]!.blob, git(owner, "rev-parse", "HEAD:tokens/vectors.json"), "the blob is git's own id for the file read");
    assert.match(green.entry.reason, new RegExp(`read Example/owner tokens/vectors.json at ${commit.slice(0, 7)}$`));

    // The owner renames a claim in its vectors: the issuer's check goes red, and the reading says the checkout changed.
    write(owner, "tokens/vectors.json", JSON.stringify({ claims: ["iss", "aud", "cln"] }));
    const red = await runOnce(root, "peers-2");
    assert.equal(red.entry.verdict, "fail", "a change on the other side fails the check that reads it");
    assert.equal(red.entry.peers?.[0]?.dirty, true);
    assert.match(red.entry.reason, /changed in the checkout/);

    // No checkout where the config says: not run, with how to get one, never pass.
    renameSync(owner, join(base, "elsewhere"));
    const missing = await runOnce(root, "peers-3");
    assert.equal(missing.entry.verdict, "not run");
    assert.match(missing.entry.reason, /no checkout is at \.\.\/owner: clone it there \(git clone https:\/\/github\.com\/Example\/owner \.\.\/owner\)/);
    assert.equal(missing.entry.peers, undefined);

    // A checkout that does not hold the file: not run.
    renameSync(join(base, "elsewhere"), owner);
    rmSync(join(owner, "tokens"), { recursive: true });
    const gone = await runOnce(root, "peers-4");
    assert.equal(gone.entry.verdict, "not run");
    assert.match(gone.entry.reason, /holds no such file/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the config's peers are refused unless each names its repository, a relative checkout and an env of its own", () => {
  const ok = readPeers("/p", { hoglake: { repository: "PostHog/hoglake", checkout: "../hoglake" } }, "c.json");
  assert.deepEqual(ok.map((p) => [p.name, p.repository, p.checkout, p.root, p.env]), [["hoglake", "PostHog/hoglake", "../hoglake", "/hoglake", "HOGLAKE_CHECKOUT"]]);
  assert.equal(defaultPeerEnv("hog-lite"), "HOG_LITE_CHECKOUT");
  assert.deepEqual(readPeers("/p", undefined, "c.json"), []);
  const refused: [unknown, RegExp][] = [
    [["hoglake"], /maps each peer's name/],
    [{ HogLake: { repository: "a/b", checkout: "../b" } }, /lowercase letters, digits and hyphens/],
    [{ hoglake: { repository: "hoglake", checkout: "../b" } }, /repository is <owner>\/<name>/],
    [{ hoglake: { repository: "a/b", checkout: "/abs/b" } }, /checkout is a folder relative/],
    [{ hoglake: { repository: "a/b", checkout: "../b", env: "lower" } }, /env names an environment variable/],
    [{ hoglake: { repository: "a/b", checkout: "../b", ref: "main" } }, /ref is none of them/],
    [{ one: { repository: "a/b", checkout: "../b", env: "X" }, two: { repository: "a/c", checkout: "../c", env: "X" } }, /both hand their checkout in X/],
  ];
  for (const [value, message] of refused) assert.throws(() => readPeers("/p", value, "c.json"), message);
  assert.deepEqual(parsePeerFile("hoglake server/x.json"), { peer: "hoglake", path: "server/x.json" });
  assert.equal(parsePeerFile("hoglake"), undefined);
  assert.equal(parsePeerFile("hoglake ../escape.json"), undefined);
  assert.equal(parsePeerFile("hoglake /etc/passwd"), undefined);
});

test("the spec check names a peer: line the config's peers do not name, one on a chokepoint, and one no form reads", () => {
  const { base, root } = fixture();
  try {
    write(root, "Issuer.spec.md", SPEC("  peer: stranger tokens/vectors.json"));
    assert.ok(loadSpecModel(root).problems.some((p) => /peer: on conforms names peer stranger; the config's peers are owner/.test(p.message)));
    write(root, "Issuer.spec.md", SPEC("  peer: owner"));
    assert.ok(loadSpecModel(root).problems.some((p) => /peer: on conforms reads <peer> <path>/.test(p.message)));
    write(root, "Issuer.spec.md", `# Issuer

Mints tokens.

## invariants
- sealed: The key leaves only through seal.
  protects: KEY
  chokepoint: seal
  peer: owner tokens/vectors.json
  because: fixture
  kinds: none
`);
    assert.ok(loadSpecModel(root).problems.some((p) => /peer: on sealed belongs to the totality oracle form/.test(p.message)));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
