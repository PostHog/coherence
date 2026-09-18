/**
 * A small project on disk for the Scope check and the agent query's tests:
 * an entry spec with trust levels, a component with one bullet in each
 * lifecycle state, a nested child, a second component that references the
 * first's chokepoint, two runs (the later one skips an enforcement, so its
 * verdict is kept from the earlier), a journal with an open escalation, and
 * a work store with one active order and one completed order. Written to a
 * temporary folder; the caller removes it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Fixture {
  root: string;
  /** What the fixture declares, for assertions to name. */
  names: {
    components: string[];
    invariants: { component: string; name: string; state: "requirement" | "invariant" | "structural defect" }[];
    chokepoint: string;
    protects: string;
    bypass: { file: string; line: number; symbol: string };
    keptName: string;
    runAts: string[];
    journalIds: string[];
    openEscalation: string;
    acknowledgedEscalation: string;
    decisionOver: string;
    conjectureCandidate: string;
    session: string;
    workOrder: string;
    /** The record that moved the work order to active: never an order itself. */
    workMove: string;
    /** An order the store holds as completed. */
    completedOrder: string;
  };
  remove: () => void;
}

const SESSION = "s1-fixture";

function write(root: string, path: string, text: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "coherence-scope-"));
  write(root, "coherence.config.json", JSON.stringify({ name: "fixture", entryDir: ".", language: "typescript" }));
  write(
    root,
    "Fixture.spec.md",
    [
      "# Fixture",
      "",
      "A small project the Scope check reads.",
      "",
      "## trust levels",
      "- outside: A caller beyond the store.",
      "- inside: The store's own code.",
      "",
      "## invariants",
      "- entry rule: The root keeps one rule of its own.",
      "  over: every entry",
      "  via: entry rule holds",
      "  because: the root needs a bullet so the entry component renders one",
      "  kinds: none",
      "",
    ].join("\n"),
  );
  write(
    root,
    "src/store/Store.spec.md",
    [
      "# Store",
      "",
      "Owns every row and funnels every write through one door.",
      "",
      "## invariants",
      "- single writer: Every row write passes through write.",
      "  protects: writeRow",
      "  chokepoint: write",
      "  because: two writers disagree about the row",
      "  crossing: outside -> inside",
      "  refuted: called writeRow from the handler -> the chokepoint check went red (2026-09-01)",
      "  kinds: none",
      "- read shape: Every read returns the row shape.",
      "  over: every read path",
      "  via: read shape holds",
      "  because: a caller that gets a bare value cannot tell a row from a miss",
      "  refuted: returned a bare value -> read shape holds went red (2026-09-01)",
      "  kinds: none",
      "- open one: The store opens one file at a time.",
      "  because: two open files race",
      "",
    ].join("\n"),
  );
  write(
    root,
    "src/store/cache/Cache.spec.md",
    ["# Cache", "", "Remembers recent rows for the store.", "", "## invariants", ""].join("\n"),
  );
  write(
    root,
    "src/api/Api.spec.md",
    ["# Api", "", "Answers requests by asking the store.", "", "## invariants", ""].join("\n"),
  );
  write(root, "src/store/write.ts", "export function write() {}\n");
  write(root, "src/store/rows.ts", "export function writeRow() {}\n");
  write(root, "src/api/handler.ts", "export function handle() {}\n");

  const bypass = { file: "src/api/handler.ts", line: 12, symbol: "handle" };
  const runAts = ["2026-09-10T10:00:00.000Z", "2026-09-11T10:00:00.000Z"];
  const runs = [
    {
      at: runAts[0],
      session: SESSION,
      agent: "fixture",
      commit: "abc1234",
      dirty: false,
      instrument: { language: "typescript", server: "cold" },
      latency: 10,
      invariants: [
        { component: "src/store", name: "single writer", form: "chokepoint", grade: "reference-choked", verdict: "pass", refutation: "automatic", bypasses: [], testReferences: 0, files: ["src/store/rows.ts", "src/store/write.ts"], latency: 5, reason: "writeRow is visible outside its module; every reference in the project is inside the chokepoint" },
        { component: "src/store", name: "read shape", form: "totality oracle", verdict: "pass", mode: "batched", refutation: "witnessed", bypasses: [], testReferences: 0, files: [], latency: 5, reason: "1 test passed" },
      ],
    },
    {
      at: runAts[1],
      session: SESSION,
      agent: "fixture",
      commit: "def5678",
      dirty: true,
      instrument: { language: "typescript", server: "warm" },
      latency: 12,
      invariants: [
        { component: "src/store", name: "single writer", form: "chokepoint", grade: "broken", verdict: "fail", refutation: "automatic", bypasses: [bypass], testReferences: 0, files: ["src/api/handler.ts", "src/store/rows.ts", "src/store/write.ts"], latency: 6, reason: "1 reference to writeRow outside write: src/api/handler.ts:12 in handle" },
      ],
    },
  ];
  write(root, `.coherence/runs/${SESSION}.jsonl`, runs.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const head = (id: string, kind: string, at: string): { id: string; kind: string; at: string; session: string; agent: string; commit: string; dirty: boolean } => ({ id, kind, at, session: SESSION, agent: "fixture", commit: "abc1234", dirty: false });
  const journal: { id: string; [key: string]: unknown }[] = [
    { ...head("d-00000001", "decision", "2026-09-10T11:00:00.000Z"), chose: "one door for writes", over: ["a writer per caller"], because: "two writers disagree" },
    { ...head("c-00000002", "conjecture", "2026-09-10T11:01:00.000Z"), observation: "the cache misses more than it should", couldBe: ["the key is normalized twice", "the instrument is wrong"], discriminatedBy: "log the key at both sites" },
    { ...head("e-00000003", "escalation", "2026-09-10T11:02:00.000Z"), what: "retire the read shape rule", because: "a human decides retirements" },
    { ...head("e-00000004", "escalation", "2026-09-10T11:03:00.000Z"), what: "the store needs a second file", because: "a human decides scope" },
    { ...head("ak-00000005", "acknowledgement", "2026-09-10T11:04:00.000Z"), of: "e-00000004", because: "one file stays" },
    { ...head("u-00000006", "unable", "2026-09-10T11:05:00.000Z"), what: "could not start the language server", because: "no binary on this machine" },
  ];
  write(root, `.coherence/journal/${SESSION}.jsonl`, journal.map((r) => JSON.stringify(r)).join("\n") + "\n");
  // The work store as the journal writes it: an order and the records that moved it. The reader folds them; nothing here is an order's state.
  const workHead = (id: string, kind: string, at: string): { id: string; kind: string; at: string; session: string; agent: string; commit: string; dirty: boolean } => ({ id, kind, at, session: SESSION, agent: "fixture", commit: "abc1234", dirty: false });
  const work = [
    { ...workHead("w-00000001", "order", "2026-09-10T09:00:00.000Z"), objective: "make every write pass through one door", success: "the chokepoint check passes", boundary: "src/store", owner: SESSION },
    { ...workHead("wm-00000002", "move", "2026-09-10T09:01:00.000Z"), of: "w-00000001", state: "active", because: "taking it up" },
    { ...workHead("w-00000003", "order", "2026-09-10T09:02:00.000Z"), objective: "retire the cache", success: "no file under src/store/cache", boundary: "src/store/cache", owner: SESSION },
    { ...workHead("wc-00000004", "completion", "2026-09-10T09:03:00.000Z"), of: "w-00000003", state: "completed", because: "the cache is gone" },
  ];
  write(root, `.coherence/work/${SESSION}.jsonl`, work.map((r) => JSON.stringify(r)).join("\n") + "\n");

  return {
    root,
    names: {
      components: [".", "src/api", "src/store", "src/store/cache"],
      invariants: [
        { component: ".", name: "entry rule", state: "requirement" },
        { component: "src/store", name: "single writer", state: "structural defect" },
        { component: "src/store", name: "read shape", state: "invariant" },
        { component: "src/store", name: "open one", state: "requirement" },
      ],
      chokepoint: "write",
      protects: "writeRow",
      bypass,
      keptName: "read shape",
      runAts: runAts as string[],
      journalIds: journal.map((r) => r.id),
      openEscalation: "e-00000003",
      acknowledgedEscalation: "e-00000004",
      decisionOver: "a writer per caller",
      conjectureCandidate: "the key is normalized twice",
      session: SESSION,
      workOrder: "w-00000001",
      workMove: "wm-00000002",
      completedOrder: "w-00000003",
    },
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
