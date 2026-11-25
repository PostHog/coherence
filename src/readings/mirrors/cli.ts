/**
 * query mirrors: the mirror reading on request.
 *
 *   query mirrors [--all] [--limit <n>] [--rev <rev>] [--no-history] [--json | --proposals | --restatements] [--base <rev>] [--witness] [--refresh]
 *
 * By default the groups the threshold policy surfaces, at HEAD; --all every
 * group; --json the whole reading with the alarms and the proposals;
 * --proposals only the proposed declarations, as JSON; --restatements the
 * values written in two or more files that nothing holds equal, ranked, each
 * with the one source it would come from (restatements.ts), then the ones the
 * config's restatements key excludes, each naming its entry; the default
 * answer and --json say the counts apart: unheld, excluded by config (by key
 * and entry), and held. A reading of HEAD with
 * the default options (history read, loose pairs left out) is kept for the
 * hooks (recorded.ts). --refresh is what a hook starts in the background: it
 * reads and keeps only when the kept reading is of another commit, and prints
 * nothing. --base reads that revision too, under the same rules, and says
 * what the code removed apart from what the rules changed (from the base's
 * counts kept under earlier rules) and each restatement born since; --witness
 * changes each copy a test names, runs that test in a scratch worktree, and
 * keeps the verdict (holds.ts): where tests already run, never in a session.
 */

import { execFileSync } from "../../lifecycle/work-meter.ts";
import type { Io } from "../../journal/cli.ts";
import { MirrorUnable, readMirrors, type MirrorReading } from "./mirrors.ts";
import { witnessHolds } from "./holds.ts";
import { alarmsOf, baseComparisonText, compareWithBase, MIRRORS_USAGE, proposalsOf, readingText, restatementCounts, restatementsText, surfaced } from "./policy.ts";
import { earlierCounts, lastMirrors, recordCounts, recordMirrors } from "./recorded.ts";

interface Parsed {
  all: boolean;
  json: boolean;
  proposals: boolean;
  restatements: boolean;
  history: boolean;
  refresh: boolean;
  witness: boolean;
  base: string | undefined;
  rev: string | undefined;
  limit: number | undefined;
}

function parse(argv: readonly string[]): Parsed | string {
  const parsed: Parsed = { all: false, json: false, proposals: false, restatements: false, history: true, refresh: false, witness: false, base: undefined, rev: undefined, limit: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") parsed.all = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--proposals") parsed.proposals = true;
    else if (arg === "--restatements") parsed.restatements = true;
    else if (arg === "--no-history") parsed.history = false;
    else if (arg === "--refresh") parsed.refresh = true;
    else if (arg === "--witness") parsed.witness = true;
    else if (arg === "--rev" || arg === "--limit" || arg === "--base") {
      const value = argv[++i];
      if (value === undefined || value === "") return `${arg} needs a value`;
      if (arg === "--rev") parsed.rev = value;
      else if (arg === "--base") parsed.base = value;
      else {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) return "--limit needs a whole number of 1 or more";
        parsed.limit = n;
      }
    } else return `unknown argument ${arg}`;
  }
  if ([parsed.json, parsed.proposals, parsed.restatements].filter(Boolean).length > 1) return "--json, --proposals and --restatements are three answers; ask for one";
  return parsed;
}

function headCommit(root: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

export async function mirrorsCommand(root: string, argv: readonly string[], io: Pick<Io, "out" | "err">): Promise<number> {
  const parsed = parse(argv);
  if (typeof parsed === "string") {
    io.err(`query mirrors: ${parsed}\n${MIRRORS_USAGE}`);
    return 64;
  }
  if (parsed.refresh) {
    const head = headCommit(root);
    if (head === undefined || lastMirrors(root)?.commit === head) return 0;
  }
  // Only HEAD with the default options is what orient may stand on.
  const keep = parsed.rev === undefined && parsed.history && !parsed.all;
  let reading: MirrorReading;
  try {
    reading = await readMirrors(root, { ...(parsed.rev === undefined ? {} : { rev: parsed.rev }), history: parsed.history, all: parsed.all });
  } catch (error) {
    if (!(error instanceof MirrorUnable)) throw error;
    io.err(`query mirrors: ${error.message}`);
    return 1;
  }
  if (keep) {
    try {
      recordMirrors(root, reading);
    } catch {
      // A reading that cannot be kept only means orient reads the last one.
    }
  }
  const keepCounts = (r: typeof reading): void => {
    try {
      recordCounts(root, r.commit, { rules: r.rules, at: new Date().toISOString(), counts: restatementCounts(r) });
    } catch {
      // Counts that cannot be kept only mean a later reading cannot say what the rules changed.
    }
  };
  if (parsed.refresh) {
    keepCounts(reading);
    return 0;
  }
  if (parsed.witness) {
    const report = await witnessHolds(root, reading, parsed.limit === undefined ? {} : { limit: parsed.limit });
    for (const w of report.witnessed) io.out(`${w.verdict === "red" ? "held" : "not held"}: ${w.hold.test} ${w.verdict === "red" ? "went red" : "stayed green"} when it ${w.change}\n`);
    for (const s of report.skipped) io.out(`not witnessed: ${s.hold.copy.file}:${s.hold.copy.line} by ${s.hold.test}: ${s.why}\n`);
    io.out(`witnessed ${report.witnessed.length} (${report.witnessed.filter((w) => w.verdict === "red").length} held), ${report.skipped.length} not witnessed, ${reading.holds.length - report.witnessed.length - report.skipped.length} already kept\n`);
    // The verdicts change the counts: read again from the kept verdicts.
    reading = await readMirrors(root, { ...(parsed.rev === undefined ? {} : { rev: parsed.rev }), history: parsed.history, all: parsed.all });
  }
  let comparison;
  if (parsed.base !== undefined) {
    let base;
    try {
      base = await readMirrors(root, { rev: parsed.base, history: false });
    } catch (error) {
      if (!(error instanceof MirrorUnable)) throw error;
      io.err(`query mirrors: ${error.message}`);
      return 1;
    }
    const earlier = earlierCounts(root, base.commit, base.rules);
    keepCounts(base);
    comparison = compareWithBase(base, reading, earlier);
  }
  keepCounts(reading);
  if (comparison !== undefined && !parsed.json) io.out(`${baseComparisonText(comparison)}\n\n`);
  if (parsed.restatements) io.out(restatementsText(reading, parsed.limit === undefined ? {} : { limit: parsed.limit }));
  else if (parsed.proposals) io.out(JSON.stringify(proposalsOf(reading.groups), null, 2));
  else if (parsed.json) io.out(JSON.stringify({ ...reading, counts: restatementCounts(reading), ...(comparison === undefined ? {} : { base: comparison }), surfaced: reading.groups.filter(surfaced).map((g) => g.rank), alarms: alarmsOf(reading.groups), proposals: proposalsOf(reading.groups) }, null, 2));
  else io.out(readingText(reading, { all: parsed.all, ...(parsed.limit === undefined ? {} : { limit: parsed.limit }) }));
  return 0;
}
