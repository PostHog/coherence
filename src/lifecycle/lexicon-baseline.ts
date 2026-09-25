/**
 * The lexicon check's baseline: the findings a project already held when it
 * adopted Coherence, recorded so the check fails only on new ones.
 *
 * It is a record, not a file: a decision in the journal whose chose is
 * "lexicon baseline" and its JSON, attributed to the session that took it and
 * committed with the rest of the journal. It holds a rejected-name finding as
 * a digest of its file, name and line text (the record never spells the name
 * it excuses, so the check never reads its own excuse as drift) and an
 * unknown noun as its term.
 *
 * It only shrinks. Every baseline record in the journal is intersected with
 * the ones before it, oldest first, so a later record can drop findings and
 * never add one; a retracted record no longer counts, which is the one way
 * to widen it, and that way is itself a record with a because. A finding
 * edited out of the text stops matching at once; the next `lexicon baseline`
 * writes the smaller set. A new finding, or a baselined line edited into a
 * new one, fails.
 *
 * Coherence's own repository keeps no baseline: its text is enforced whole.
 */

import { createHash } from "node:crypto";
import { loadJournal } from "../journal/store.ts";
import { decide } from "../journal/verbs.ts";
import { normalizeTerm, type CheckReport, type RejectedFinding } from "./check.ts";

/** The chose of a baseline decision: the verb, then its JSON. */
export const BASELINE_CHOSE = /^lexicon baseline (\{.*\})$/s;

export interface Baseline {
  /** The newest baseline record that shaped it. */
  id: string;
  /** Rejected-name finding digests, each with how many such findings it holds. */
  rejected: Map<string, number>;
  /** Unknown nouns, by term. */
  unknown: Set<string>;
}

/** What the baseline covered in one check, as the report's one line about it. */
export interface BaselineSummary {
  id: string;
  rejected: number;
  unknown: number;
  /** Baselined findings the text no longer holds; counted on a whole-project check only. */
  gone?: number;
}

/** The finding's identity for the baseline: its file, the name, and the line as written. Moving the line keeps it; editing the line makes it new. */
export function findingDigest(file: string, name: string, line: string): string {
  return createHash("sha256").update(`${file}\n${normalizeTerm(name)}\n${line.trim()}`).digest("hex").slice(0, 16);
}

/** A rejected-name finding the baseline may hold: an editable finding the check would fail on. */
export function baselinable(f: RejectedFinding): boolean {
  return f.repair === "edit" && f.advisory !== true;
}

function parse(id: string, json: string): Omit<Baseline, "id"> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`lexicon baseline ${id} is unreadable; retract it and take the baseline again`);
  }
  const record = (value ?? {}) as Record<string, unknown>;
  const rejected = new Map<string, number>();
  const unknown = new Set<string>();
  const counts = record["rejected"];
  if (typeof counts === "object" && counts !== null && !Array.isArray(counts)) {
    for (const [key, n] of Object.entries(counts)) if (typeof n === "number" && n > 0) rejected.set(key, Math.floor(n));
  }
  const terms = record["unknown"];
  if (Array.isArray(terms)) for (const t of terms) if (typeof t === "string") unknown.add(t);
  return { rejected, unknown };
}

function intersect(a: Omit<Baseline, "id">, b: Omit<Baseline, "id">): Omit<Baseline, "id"> {
  const rejected = new Map<string, number>();
  for (const [key, n] of a.rejected) {
    const m = Math.min(n, b.rejected.get(key) ?? 0);
    if (m > 0) rejected.set(key, m);
  }
  return { rejected, unknown: new Set([...a.unknown].filter((t) => b.unknown.has(t))) };
}

/** The project's baseline as the journal holds it, or nothing when no baseline was ever taken. */
export function readBaseline(root: string): Baseline | undefined {
  const { records } = loadJournal(root);
  const retracted = new Set(records.flatMap((r) => (r.kind === "retraction" ? [r.of] : [])));
  let effective: Baseline | undefined;
  for (const r of records) {
    if (r.kind !== "decision" || retracted.has(r.id)) continue;
    const match = BASELINE_CHOSE.exec(r.chose);
    if (match === null) continue;
    const next = parse(r.id, match[1]!);
    effective = { id: r.id, ...(effective === undefined ? next : intersect(effective, next)) };
  }
  return effective;
}

/**
 * Mark the report's findings the baseline holds, and return the line the
 * report prints about them. `lineOf` gives a finding's line as written.
 */
export function applyBaseline(report: CheckReport, baseline: Baseline, lineOf: (file: string, line: number) => string, whole: boolean): BaselineSummary {
  const left = new Map(baseline.rejected);
  let rejected = 0;
  for (const f of report.rejected) {
    if (!baselinable(f)) continue;
    const key = findingDigest(f.file, f.name, lineOf(f.file, f.line));
    const n = left.get(key) ?? 0;
    if (n === 0) continue;
    left.set(key, n - 1);
    f.baselined = true;
    rejected += 1;
  }
  let unknown = 0;
  const present = new Set<string>();
  for (const u of report.unknown) {
    present.add(u.term);
    if (!baseline.unknown.has(u.term)) continue;
    u.baselined = true;
    unknown += 1;
  }
  const summary: BaselineSummary = { id: baseline.id, rejected, unknown };
  if (whole) summary.gone = [...left.values()].reduce((a, b) => a + b, 0) + [...baseline.unknown].filter((t) => !present.has(t)).length;
  return summary;
}

/** The findings a whole-project check holds now, in the baseline's shape. */
export function snapshot(report: CheckReport, lineOf: (file: string, line: number) => string): Omit<Baseline, "id"> {
  const rejected = new Map<string, number>();
  for (const f of report.rejected) {
    if (!baselinable(f)) continue;
    const key = findingDigest(f.file, f.name, lineOf(f.file, f.line));
    rejected.set(key, (rejected.get(key) ?? 0) + 1);
  }
  return { rejected, unknown: new Set(report.unknown.map((u) => u.term)) };
}

function size(b: Omit<Baseline, "id">): { rejected: number; unknown: number } {
  return { rejected: [...b.rejected.values()].reduce((a, n) => a + n, 0), unknown: b.unknown.size };
}

function same(a: Omit<Baseline, "id">, b: Omit<Baseline, "id">): boolean {
  if (a.rejected.size !== b.rejected.size || a.unknown.size !== b.unknown.size) return false;
  for (const [key, n] of a.rejected) if (b.rejected.get(key) !== n) return false;
  return [...a.unknown].every((t) => b.unknown.has(t));
}

export interface Who {
  session: string;
  agent: string;
  work?: string;
  cite?: string[];
}

/**
 * Take the baseline: the first time, every finding the whole-project check
 * holds; after that, only what is both held now and already baselined, so the
 * record can shrink and never grow. Nothing is written when nothing changed.
 */
export function recordBaseline(root: string, report: CheckReport, lineOf: (file: string, line: number) => string, who: Who, because?: string): string {
  const now = snapshot(report, lineOf);
  const prior = readBaseline(root);
  const next = prior === undefined ? now : intersect(prior, now);
  const count = size(next);
  const counts = `${count.rejected} rejected name${count.rejected === 1 ? "" : "s"}, ${count.unknown} unknown noun${count.unknown === 1 ? "" : "s"}`;
  if (prior === undefined && count.rejected + count.unknown === 0) return "Nothing to baseline: the lexicon check holds no findings.";
  if (prior !== undefined && same(prior, next)) return `Baseline unchanged (${prior.id}): ${counts}.`;
  const body = {
    rejected: Object.fromEntries([...next.rejected].sort(([a], [b]) => a.localeCompare(b))),
    unknown: [...next.unknown].sort(),
  };
  const argv = [
    "lexicon baseline " + JSON.stringify(body),
    "--because",
    because?.trim() || (prior === undefined ? "these findings predate the adoption; the check fails only on new ones" : "findings fixed since the last baseline drop out of it"),
    "--over",
    prior === undefined ? "failing the adoption on findings it did not write" : "keeping findings the text no longer holds",
    "--session",
    who.session,
    "--agent",
    who.agent,
    ...(who.work ? ["--work", who.work] : []),
    ...(who.cite ?? []).flatMap((c) => ["--cite", c]),
  ];
  const id = decide(argv, { cwd: root, now: () => new Date() }).record.id;
  return `${prior === undefined ? "Baseline taken" : "Baseline shrunk"} (${id}): ${counts}; the check now fails only on findings outside it.`;
}
