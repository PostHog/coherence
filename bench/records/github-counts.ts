/**
 * What GitHub counts of a pull request's records, asked of GitHub itself.
 *
 * 1. History: for recent merged pull requests, GitHub's own additions,
 *    deletions and changed files beside the share of them the record stores
 *    hold, from the local diff of each merge commit's first parent. The
 *    stores have been linguist-generated since 1.7.0, so a share above zero
 *    in GitHub's numbers is what that attribute leaves in them.
 * 2. Probe: the files under bench/records/probe/, one per attribute (none,
 *    linguist-generated, -diff, binary, linguist-generated with -diff, and a
 *    diff driver no one configured), each the same 20 record-shaped lines.
 *    Given the number of a pull request that adds them, GitHub's per-file
 *    additions and whether it renders a patch say which attribute takes a
 *    file out of the +/- count; no attribute takes one out of the
 *    files-changed count.
 *
 *   node bench/records/github-counts.ts [--pr <number>] [--history <count>]
 *
 * Needs gh, authenticated for this repository. Writes
 * bench/records/github-counts.json.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STORE_NAMES, storeDir } from "../../src/journal/stores.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const PR = flag("--pr");
const HISTORY = Number(flag("--history") ?? 20);

const run = (cmd: string, cmdArgs: string[]): string => execFileSync(cmd, cmdArgs, { cwd: REPO, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const gh = (ghArgs: string[]): unknown => JSON.parse(run("gh", ghArgs));
const shortstat = (text: string): { files: number; added: number; removed: number } => ({
  files: Number(/(\d+) files? changed/.exec(text)?.[1] ?? 0),
  added: Number(/(\d+) insertions?/.exec(text)?.[1] ?? 0),
  removed: Number(/(\d+) deletions?/.exec(text)?.[1] ?? 0),
});

const out: Record<string, unknown> = { at: new Date().toISOString() };

const merged = gh(["pr", "list", "--state", "merged", "--limit", String(HISTORY), "--json", "number,additions,deletions,changedFiles,mergeCommit"]) as { number: number; additions: number; deletions: number; changedFiles: number; mergeCommit: { oid: string } | null }[];
const history = merged.flatMap((pr) => {
  const oid = pr.mergeCommit?.oid;
  if (oid === undefined) return [];
  try {
    const all = shortstat(run("git", ["diff", "--shortstat", `${oid}^1`, oid]));
    const records = shortstat(run("git", ["diff", "--shortstat", `${oid}^1`, oid, "--", ...STORE_NAMES.map((s) => storeDir(s))]));
    return [{ pr: pr.number, githubAdditions: pr.additions, githubDeletions: pr.deletions, githubFiles: pr.changedFiles, localAdditions: all.added, recordAdditions: records.added, recordFiles: records.files, recordShareOfAdditions: all.added === 0 ? 0 : Math.round((records.added / all.added) * 100) }];
  } catch {
    return [];
  }
});
out["history"] = history;
const sum = (key: keyof (typeof history)[number]): number => history.reduce((n, h) => n + Number(h[key]), 0);
out["historyTotals"] = { prs: history.length, githubAdditions: sum("githubAdditions"), localAdditions: sum("localAdditions"), recordAdditions: sum("recordAdditions"), githubFiles: sum("githubFiles"), recordFiles: sum("recordFiles") };

if (PR !== undefined) {
  const repo = (gh(["repo", "view", "--json", "nameWithOwner"]) as { nameWithOwner: string }).nameWithOwner;
  const files = gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${PR}/files?per_page=100`]) as { filename: string; additions: number; deletions: number; changes: number; patch?: string }[][];
  const view = gh(["pr", "view", PR, "--json", "additions,deletions,changedFiles"]);
  const probeDir = join("bench", "records", "probe");
  const attributes = existsSync(join(REPO, probeDir, ".gitattributes")) ? readFileSync(join(REPO, probeDir, ".gitattributes"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")) : [];
  out["probe"] = {
    pr: Number(PR),
    totals: view,
    files: files.flat().filter((f) => f.filename.startsWith(`${probeDir}/`)).map((f) => ({
      file: f.filename.slice(probeDir.length + 1),
      attributes: attributes.find((l) => l.split(/\s+/)[0] === f.filename.slice(probeDir.length + 1))?.split(/\s+/).slice(1).join(" ") ?? "(none)",
      additions: f.additions,
      deletions: f.deletions,
      patchRendered: f.patch !== undefined,
    })),
  };
}

writeFileSync(join(REPO, "bench", "records", "github-counts.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
