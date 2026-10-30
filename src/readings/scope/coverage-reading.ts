/**
 * The vocabulary coverage Scope shows, and the warm server's way of reading
 * it without stopping.
 *
 * The page's coverage is the kept reading the hooks keep at a session's
 * start and stop (currentReading in vocabulary-state.ts): one reading for the
 * page and the hooks, served from what they kept while nothing it is keyed by
 * moved, and taken in full otherwise. Either way the reading is work on the
 * thread that runs it: a full one scans every prose and code file (about a
 * minute over a large project), and even a kept one runs git and parses what
 * it kept. A snapshot and the agent query await it on their own thread.
 *
 * The warm server answers the agent's hooks and the page on one event loop,
 * so it reads coverage on a worker thread instead: the worker takes the
 * reading, projects it to the page's bound, and hands back only the
 * projection, so the main thread never parses the reading itself either.
 * Callers that ask while a reading of the same root is under way share it.
 *
 * The reading reads no text through a parser (its code names come from each
 * language's lines, lexicon-coverage.ts); the worker still starts the parser
 * runtime, as the CLI does before any command, so it runs any reading the
 * CLI could.
 */

import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { loadProjectLexicons } from "../../lifecycle/project.ts";
import { currentReading } from "../../lifecycle/vocabulary-state.ts";
import { startParsers } from "../../plugins/syntax-trees.ts";
import { projectLexiconCoverage } from "./lexicon-projection.ts";
import type { LexiconCoverage } from "./model.ts";

/**
 * The vocabulary coverage as the page carries it: the kept reading, projected
 * to the page's bound. On the caller's thread.
 */
export async function pageCoverage(root: string): Promise<LexiconCoverage> {
  return projectLexiconCoverage(await currentReading(root, await loadProjectLexicons(root)));
}

/** What the worker is started with: the root it reads. */
interface Asked {
  coverageOf: string;
}

/** What the worker answers: the projection, or why it could not read. */
type Answered = { coverage: LexiconCoverage } | { failed: string };

const underWay = new Map<string, Promise<LexiconCoverage>>();

/**
 * The page's coverage, read on a worker thread so the caller's loop never
 * waits on it; a call while a reading of the same root is under way shares
 * that reading.
 */
export function coverageOffLoop(root: string): Promise<LexiconCoverage> {
  const found = underWay.get(root);
  if (found !== undefined) return found;
  const reading = new Promise<LexiconCoverage>((resolve, reject) => {
    // The worker runs this module; no inherited preload (a test's leak guard) runs in it, and it never holds the process open.
    const worker = new Worker(new URL(import.meta.url), { workerData: { coverageOf: root } satisfies Asked, execArgv: [] });
    worker.unref();
    let settled = false;
    worker.once("message", (answer: Answered) => {
      settled = true;
      if ("coverage" in answer) resolve(answer.coverage);
      else reject(new Error(answer.failed));
      void worker.terminate();
    });
    worker.once("error", (error) => {
      settled = true;
      reject(error);
    });
    worker.once("exit", (code) => {
      if (!settled) reject(new Error(`the coverage reading's worker exited (code ${code}) without an answer`));
    });
  }).finally(() => underWay.delete(root));
  underWay.set(root, reading);
  return reading;
}

if (!isMainThread && typeof (workerData as Partial<Asked> | null)?.coverageOf === "string") {
  const { coverageOf } = workerData as Asked;
  let answer: Answered;
  try {
    await startParsers();
    answer = { coverage: await pageCoverage(coverageOf) };
  } catch (error) {
    answer = { failed: error instanceof Error ? error.message : String(error) };
  }
  parentPort!.postMessage(answer);
}
