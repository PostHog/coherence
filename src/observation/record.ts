/**
 * The observation record (lexicon: observation): one line per observed pass
 * in .coherence/observations/<session>.jsonl, append only. It carries who
 * captured it and at which commit, the source (a test pass, with its runner
 * and whether coverage was attributed per test or per run), and per test the
 * verdict, the region it touched (components executed, component interfaces
 * co-executed), and for a failure the invariant whose totality oracle it is
 * and the likely site. Every component interface known at capture is listed,
 * so "never observed" is a fact of the record, not an absence.
 *
 * Staleness is the reader's rule and has one home, `freshness`: an
 * observation whose commit is not the head, or whose tree was dirty when it
 * was captured, is stale, and every reader says so. `observedEvidence` is the
 * seam the Structure map overlay draws from: a pure function from records and
 * the head to what was observed about one component interface.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Attribution, TestVerdict } from "./capture.ts";
import type { LanguagesRead } from "../readings/scope/languages-read.ts";

export const OBSERVATIONS_DIR = join(".coherence", "observations");

/** What coverage can say about two pieces of code that both ran: never that one called the other. */
export const RELATION = "co-executed";

/** Where a failure most likely broke: the first stack frame outside test files. Evidence, never proof. */
export interface LikelySite {
  label: "likely site";
  file: string;
  /** One-based. */
  line: number;
  /** The enclosing top-level declaration, when one encloses the line. */
  symbol?: string;
  component?: string;
  /** Component interfaces that carry that symbol. */
  interfaces: string[];
}

export interface ObservedTest {
  name: string;
  fullName: string;
  file?: string;
  verdict: TestVerdict;
  /** Invariants (component/name) whose totality oracle this test is: for a failure, what broke. */
  invariants?: string[];
  /** For a failure: the first line of what the runner reported. */
  failure?: string;
  likelySite?: LikelySite;
  /** The region the test touched; absent when coverage was not attributed per test. */
  components?: string[];
  /** Component interfaces co-executed in this test, as `from -> to`. */
  interfaces?: string[];
  /** Entrances whose handler executed in this test, as `component/name`. */
  entrances?: string[];
}

export interface ObservedInterface {
  id: string;
  from: string;
  to: string;
  /** How many symbols the interface carries. */
  symbols: number;
  /** Every file the interface's declarations and reference sites lie in: what a change set is compared with. */
  files: string[];
  /** Every symbol is a type: nothing of it ever executes, so coverage cannot observe it. */
  typeOnly: boolean;
  /** Every symbol lacks a body coverage can report (types and plain values), though not all are types. */
  noBody: boolean;
  /** Tests that co-executed it (per test), or 1 when the per-run region did. */
  exercisedBy: number;
}

export interface ObservedEntrance {
  component: string;
  name: string;
  handler?: string;
  exercisedBy: number;
  reason?: string;
}

export interface ObservationRecord {
  kind: "observation";
  at: string;
  session: string;
  agent: string;
  work?: string;
  binding?: string;
  commit: string | null;
  dirty: boolean;
  source: { kind: "test pass"; runner: string; attribution: Attribution; note: string };
  relation: typeof RELATION;
  tests: ObservedTest[];
  /** The whole run's region, when coverage was per run. */
  run?: { components: string[]; interfaces: string[]; entrances: string[] };
  interfaces: ObservedInterface[];
  entrances: ObservedEntrance[];
  totals: {
    tests: number;
    failed: number;
    components: number;
    interfaces: number;
    exercised: number;
    neverObserved: number;
    noBody: number;
    entrances: number;
    entrancesExercised: number;
  };
  latency: { pass: number; map: number };
  /** Which of the project's languages the observation read (the primary alone), and each other one with why; absent from a record written before. */
  languages?: LanguagesRead;
}

const SESSION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Append one observation as one line; never rewrite one. */
export function appendObservation(root: string, record: ObservationRecord): string {
  if (!SESSION_TOKEN.test(record.session)) throw new Error(`session "${record.session}" cannot name a file; use letters, digits, dot, dash, or underscore`);
  const dir = join(root, OBSERVATIONS_DIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${record.session}.jsonl`);
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  return file;
}

/** Every observation, oldest first, with lines that did not read. */
export function loadObservations(root: string): { records: ObservationRecord[]; damaged: { file: string; line: number }[] } {
  const dir = join(root, OBSERVATIONS_DIR);
  const out: { records: ObservationRecord[]; damaged: { file: string; line: number }[] } = { records: [], damaged: [] };
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
    readFileSync(join(dir, name), "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (line.trim() === "") return;
        try {
          const value = JSON.parse(line) as Partial<ObservationRecord>;
          if (value.kind !== "observation" || typeof value.at !== "string" || !Array.isArray(value.interfaces)) throw new Error("not an observation");
          out.records.push(value as ObservationRecord);
        } catch {
          out.damaged.push({ file: join(OBSERVATIONS_DIR, name), line: index + 1 });
        }
      });
  }
  out.records.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out;
}

export interface Freshness {
  fresh: boolean;
  /** Why, in a phrase: "at the head", or what makes it stale. */
  reason: string;
}

/** The staleness rule, in one place: fresh only when captured at the head on a clean tree. */
export function freshness(record: Pick<ObservationRecord, "commit" | "dirty">, head: string | null): Freshness {
  if (record.commit === null) return { fresh: false, reason: "captured outside any commit" };
  if (head === null) return { fresh: false, reason: `captured at ${record.commit}; the head cannot be read` };
  if (record.commit !== head) return { fresh: false, reason: `captured at ${record.commit}; the head is ${head}` };
  if (record.dirty) return { fresh: false, reason: `captured at ${record.commit} on a dirty tree` };
  return { fresh: true, reason: `captured at the head ${head}` };
}

/** The label a reader prints beside every observed fact. */
export function freshnessLabel(f: Freshness): string {
  return f.fresh ? "fresh" : `STALE: ${f.reason}`;
}

/** What was observed about one component interface: the observed layer, labeled, never blended with the static reading. */
export type ObservedEvidence =
  | { kind: "no observation" }
  | { kind: "not in the observation"; commit: string | null; freshness: Freshness }
  | {
      kind: "exercised" | "never observed" | "no runtime body";
      relation: typeof RELATION;
      attribution: Attribution;
      /** Tests that co-executed it (0 unless exercised); for a per-run observation, the run counts once. */
      tests: number;
      commit: string | null;
      freshness: Freshness;
      /** Failing tests that co-executed it. */
      failing: string[];
      /** Failing tests whose likely site lies on a symbol it carries. */
      likelySiteOf: string[];
    };

/**
 * The seam for the Structure map overlay: from the latest observation, what
 * was observed about the component interface `from -> to`, with its freshness
 * and the breakage that touched it. Pure: the caller supplies the records
 * and the head.
 */
export function observedEvidence(records: readonly ObservationRecord[], head: string | null, from: string, to: string): ObservedEvidence {
  const latest = records[records.length - 1];
  if (latest === undefined) return { kind: "no observation" };
  const id = `${from} -> ${to}`;
  const f = freshness(latest, head);
  const known = latest.interfaces.find((i) => i.id === id);
  if (known === undefined) return { kind: "not in the observation", commit: latest.commit, freshness: f };
  const failing = latest.tests.filter((t) => t.verdict === "fail" && (t.interfaces ?? []).includes(id)).map((t) => t.fullName);
  const likelySiteOf = latest.tests.filter((t) => t.verdict === "fail" && (t.likelySite?.interfaces ?? []).includes(id)).map((t) => t.fullName);
  const kind = known.exercisedBy > 0 ? "exercised" : known.noBody ? "no runtime body" : "never observed";
  return { kind, relation: RELATION, attribution: latest.source.attribution, tests: known.exercisedBy, commit: latest.commit, freshness: f, failing, likelySiteOf };
}
