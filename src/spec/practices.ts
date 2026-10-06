/**
 * Practices in the model: each practice file paired with its folder's spec,
 * the kernel practices every adopter receives from Coherence, and the
 * checks that keep a practice's integrity.
 *
 * A practice file stands only beside a spec, with the spec's own stem
 * (Enforcement.spec.md, Enforcement.practice.md). Every record or commit a
 * practice cites must exist. An invariant it names must be one its sister
 * spec, or the component it names, declares. And once a practice has been
 * enacted, the text that enactment carried out is the floor: a step or a
 * pitfall that has since left the practice is a problem until a decision
 * cites an enactment of it and says why. Adding a step or a pitfall is free;
 * a candidate (never enacted) may change freely.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRACTICE_SUFFIX, RECORD_ID, parsePractices, type Practice } from "./practice.ts";
import type { Problem } from "./grammar.ts";
import { loadJournal } from "../journal/store.ts";
import { loadWork } from "../journal/work.ts";
import { recordsOnOtherBranches } from "../journal/branches.ts";
import type { Decision, Enactment, JournalRecord } from "../journal/record.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Where Coherence itself is installed: its own checkout, or the package in an adopter. */
export const COHERENCE_ROOT = resolve(here, "..", "..");

/** The name an id carries before a kernel practice, as an adopter reads it. */
export const KERNEL_PREFIX = "coherence:";

export type PracticeState = "candidate" | "established";

export interface ModelPractice extends Practice {
  /** The component folder and the name: src/enforcement/witness a refutation; coherence: first for a kernel practice in an adopter. */
  id: string;
  component: string;
  /** The practice file, relative to the root it was read from. */
  file: string;
  /** Established once an enactment produced the evidence of every step that names it; a candidate before. */
  state: PracticeState;
  enactments: number;
}

/** The stem a spec and its practice file share: Enforcement for Enforcement.spec.md. */
export function stemOf(path: string): string {
  const name = basename(path);
  for (const suffix of [".spec.md", PRACTICE_SUFFIX]) if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  return name;
}

/** Whether the root is Coherence's own tree, read from its package name: there its practices are the project's own. */
export function isCoherenceTree(root: string): boolean {
  try {
    if (realpathSync(resolve(root)) === realpathSync(COHERENCE_ROOT)) return true;
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: unknown };
    return pkg.name === "@posthog/coherence";
  } catch {
    return false;
  }
}

/** The enactments in a journal, oldest first. */
export function enactmentsIn(records: readonly JournalRecord[]): Enactment[] {
  return records.filter((r): r is Enactment => r.kind === "enactment");
}

/** Whether an enactment produced the evidence of every step that names what it leaves. */
export function witnessedWhole(enactment: Enactment): boolean {
  return enactment.steps.every((step, index) => {
    if (step.leaves === undefined) return true;
    const outcome = enactment.results[String(index + 1)];
    return outcome?.result === "done" && outcome.evidence !== undefined && outcome.evidence.trim() !== "";
  });
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** A practice as the model holds it, with its state read from the enactments. */
export function modelPractice(practice: Practice, id: string, component: string, file: string, enactments: readonly Enactment[]): ModelPractice {
  const mine = enactments.filter((e) => e.practice === id);
  return { ...practice, id, component, file, state: mine.some(witnessedWhole) ? "established" : "candidate", enactments: mine.length };
}

/** The kernel practices, read from where Coherence is installed: those whose reach is kernel. */
export function kernelPractices(enactments: readonly Enactment[] = []): ModelPractice[] {
  const src = join(COHERENCE_ROOT, "src");
  if (!existsSync(src)) return [];
  const out: ModelPractice[] = [];
  for (const folder of readdirSync(src, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const name of readdirSync(join(src, folder.name))) {
      if (!name.endsWith(PRACTICE_SUFFIX)) continue;
      const rel = `src/${folder.name}/${name}`;
      const parsed = parsePractices(readFileSync(join(COHERENCE_ROOT, rel), "utf8"), rel);
      for (const practice of parsed.practices) {
        if (practice.reach !== "kernel") continue;
        out.push(modelPractice(practice, `${KERNEL_PREFIX}src/${folder.name}/${practice.name}`, `src/${folder.name}`, rel, enactments));
      }
    }
  }
  return out;
}

/** The commits among the citations that this repository does not hold; undefined when git cannot be asked. */
function missingCommits(root: string, commits: readonly string[]): Set<string> | undefined {
  if (commits.length === 0) return new Set();
  const result = spawnSync("git", ["cat-file", "--batch-check"], { cwd: root, input: commits.map((c) => `${c}^{commit}`).join("\n") + "\n", encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const missing = new Set<string>();
  result.stdout.split("\n").forEach((line, index) => {
    if (/ missing$| ambiguous$/.test(line) && commits[index] !== undefined) missing.add(commits[index]!);
  });
  return missing;
}

export interface PracticeChecks {
  root: string;
  practices: readonly ModelPractice[];
  /** Every invariant name by component folder, for invariants: lines to resolve. */
  invariantsByFolder: ReadonlyMap<string, ReadonlySet<string>>;
  /** Whether the root is Coherence's own tree, where every practice declares its reach and nowhere else may. */
  coherenceTree: boolean;
  records: readonly JournalRecord[];
}

/**
 * The model-level problems of a project's practices: a citation found nowhere,
 * an invariant no spec declares, a reach missing in Coherence's tree or written outside it,
 * and a step or pitfall gone from an enacted practice with no decision citing
 * an enactment of it.
 */
export function practiceProblems(checks: PracticeChecks): Problem[] {
  const { root, practices, invariantsByFolder, coherenceTree, records } = checks;
  const problems: Problem[] = [];
  if (practices.length === 0) return problems;

  // Citations: a record id must be in the journal or the work store (here or on another branch), a commit in git.
  const cited = practices.flatMap((p) => [...p.pitfalls.flatMap((pf) => pf.cites.map((c) => ({ p, c, line: pf.line }))), ...p.learned.map((c) => ({ p, c, line: p.lines.learned ?? p.line }))]);
  const isRecord = (c: string): boolean => new RegExp(`^${RECORD_ID.source}$`).test(c);
  const known = new Set<string>([...records.map((r) => r.id), ...loadWork(root).records.map((r) => r.id)]);
  const unknownIds = [...new Set(cited.filter(({ c }) => isRecord(c) && !known.has(c)).map(({ c }) => c))];
  const elsewhere = unknownIds.length === 0 ? new Map() : recordsOnOtherBranches(root, unknownIds);
  const commits = [...new Set(cited.filter(({ c }) => !isRecord(c)).map(({ c }) => c))];
  const absent = missingCommits(root, commits);
  for (const { p, c, line } of cited) {
    if (isRecord(c)) {
      if (!known.has(c) && !elsewhere.has(c)) problems.push({ file: p.file, line, message: `practice ${p.name} cites ${c}, which no journal or work record has, here or on another branch` });
    } else if (absent !== undefined && absent.has(c)) {
      problems.push({ file: p.file, line, message: `practice ${p.name} cites ${c}, which is no commit in this repository` });
    }
  }

  for (const p of practices) {
    // Never examined and examined are different facts (d-8ed21083): in Coherence's tree every practice says how far it goes.
    if (coherenceTree && p.lines.reach === undefined) {
      problems.push({ file: p.file, line: p.line, message: `practice ${p.name} declares no reach: in Coherence's own tree every practice says how far it goes, reach: kernel (every adopter receives it) or reach: internal (it never leaves this tree)` });
    }
    if (!coherenceTree && p.lines.reach !== undefined) {
      problems.push({ file: p.file, line: p.lines.reach, message: `practice ${p.name}: reach: is for Coherence's own practices; a project's practices are its own, and reach nowhere else` });
    }
    for (const name of p.invariants) {
      const slash = name.lastIndexOf("/");
      const folder = slash === -1 ? p.component : name.slice(0, slash);
      const invariant = slash === -1 ? name : name.slice(slash + 1);
      if (invariantsByFolder.get(folder)?.has(invariant)) continue;
      problems.push({ file: p.file, line: p.lines.invariants ?? p.line, message: `practice ${p.name} names invariant ${name}, which ${slash === -1 ? "its sister spec" : `the spec at ${folder}`} does not declare` });
    }
  }

  // The floor: what the latest enactment carried out may leave the practice only with a decision citing an enactment of it.
  const enactments = enactmentsIn(records);
  const decisions = records.filter((r): r is Decision => r.kind === "decision");
  for (const p of practices) {
    const mine = enactments.filter((e) => e.practice === p.id);
    const latest = mine[mine.length - 1];
    if (latest === undefined || latest.version === p.version) continue;
    const steps = new Set(p.steps.map((s) => normalize(s.text)));
    const pitfalls = new Set(p.pitfalls.map((pf) => normalize(pf.text)));
    const gone = [
      ...latest.steps.filter((s) => !steps.has(normalize(s.text))).map((s) => `step "${s.text}"`),
      ...latest.pitfalls.filter((pf) => !pitfalls.has(normalize(pf))).map((pf) => `pitfall "${pf}"`),
    ];
    if (gone.length === 0) continue;
    const ids = new Set(mine.map((e) => e.id));
    const amended = decisions.some((d) => d.at >= latest.at && (d.cites ?? []).some((id) => ids.has(id)));
    if (amended) continue;
    for (const what of gone) {
      problems.push({
        file: p.file,
        line: p.line,
        message: `practice ${p.name}: ${what} was enacted in ${latest.id} and is gone; a practice keeps what it taught unless a decision says why: decide "amend ${p.id}: <what changed>" --because "<why>" --cite ${latest.id}`,
      });
    }
  }
  return problems;
}

/** The journal's records for the checks, or none when the journal cannot be read: the spec check never fails on the journal. */
export function journalRecords(root: string): JournalRecord[] {
  try {
    return loadJournal(root).records;
  } catch {
    return [];
  }
}
