/**
 * The readings the warm server takes on worker threads, so its loop keeps
 * answering hooks and pages while they read. Each is synchronous for long
 * stretches over every file it reads: on PostHog, the model's state stalled
 * the loop 55 s (the vocabulary coverage) and the component interfaces 12 to
 * 20 s (the walk, the word index, the parses, the kept answers and the
 * fingerprint the reading keeps for the hooks).
 *
 * The state is read whole in its worker. The interface reading's language
 * servers stay with the caller: the worker asks each question (ready,
 * resolve, references, and the server's memory for the budget) through this
 * thread, of the adapter the caller gives for the language, so a warm
 * instrument the caller owns answers as it does in process. Neither worker
 * starts a process of its own, so one ended outright leaves nothing running.
 */

import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { LanguageAdapter } from "../../adapters/adapter.ts";
import type { Language } from "../../adapters/index.ts";
import type { BuildOptions } from "./build.ts";
import { languageServerMemory } from "./component-interfaces.ts";
import type { InterfaceReading, ShellState } from "./model.ts";

/** What the interface reading asks of a language's adapter: the adapter's own questions, and its server's memory. */
export type Question = "ready" | "resolve" | "references" | "memory";

/** A worker to this thread: a question for one language's adapter, or what it read once it is done. */
export type FromReading<T> = { ask: number; language: Language; question: Question; args: unknown[] } | { done: T };

/** This thread to the interface reading's worker: the answer to one question, or why it failed. */
export type ToReading = { ask: number; value: unknown } | { ask: number; failed: string };

const own = extname(fileURLToPath(import.meta.url));
const INTERFACES = new URL(`./interfaces-worker${own}`, import.meta.url);
const STATE = new URL(`./state-worker${own}`, import.meta.url);

/**
 * Run one reading's worker to its end: what it read, once the worker has
 * ended; a rejection when it stopped (an abort ends it outright) or failed.
 * `answer` answers each question it asks.
 */
function apart<T>(what: string, worker: URL, data: unknown, answer: (language: Language, question: Question, args: unknown[]) => Promise<unknown>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error(`${what} was stopped`));
  return new Promise((done, fail) => {
    let thread: Worker;
    try {
      // None of this process's flags: a test's --import would load the suite's leak guard into the worker.
      thread = new Worker(worker, { workerData: data, execArgv: [] });
    } catch (error) {
      fail(new Error(`${what}'s worker did not start: ${(error as Error).message}`));
      return;
    }
    let read: { value: T } | undefined;
    let failure: string | undefined;
    let ended = false;
    const stop = (): void => void thread.terminate();
    signal?.addEventListener("abort", stop, { once: true });
    thread.on("message", (message: FromReading<T>) => {
      if ("done" in message) {
        read = { value: message.done };
        // What it read is held here: the worker has nothing left to do.
        void thread.terminate();
        return;
      }
      void answer(message.language, message.question, message.args).then(
        (value) => !ended && thread.postMessage({ ask: message.ask, value } satisfies ToReading),
        (error: unknown) => !ended && thread.postMessage({ ask: message.ask, failed: error instanceof Error ? error.message : String(error) } satisfies ToReading),
      );
    });
    thread.once("error", (error) => (failure = error.message));
    thread.once("exit", (code) => {
      ended = true;
      signal?.removeEventListener("abort", stop);
      if (read !== undefined) done(read.value);
      else if (signal?.aborted) fail(new Error(`${what} was stopped`));
      else fail(new Error(failure !== undefined ? `${what}'s worker failed: ${failure}` : `${what}'s worker stopped (exit ${code}) before it answered`));
    });
  });
}

/** The whole state scopeState reads, read on a worker thread. */
export function scopeStateApart(options: BuildOptions, signal?: AbortSignal): Promise<ShellState> {
  return apart("the state's reading", STATE, options, () => Promise.reject(new Error("the state's reading asks no language server")), signal);
}

/**
 * Read the component interfaces on a worker thread, asking `adapterOf` for
 * each language's adapter when the reading asks that language anything; the
 * caller starts and closes them. The reading is kept for the hooks as
 * readAndRecord keeps it.
 */
export function readInterfacesApart(root: string, adapterOf: (language: Language) => LanguageAdapter | Promise<LanguageAdapter>, signal?: AbortSignal): Promise<InterfaceReading> {
  const answer = async (language: Language, question: Question, args: unknown[]): Promise<unknown> => {
    const adapter = await adapterOf(language);
    switch (question) {
      case "ready":
        return adapter.ready();
      case "resolve":
        return adapter.resolve(...(args as Parameters<LanguageAdapter["resolve"]>));
      case "references":
        return adapter.references(...(args as Parameters<LanguageAdapter["references"]>));
      case "memory":
        return languageServerMemory(adapter.serverPid?.());
    }
  };
  return apart("the interface reading", INTERFACES, { root }, answer, signal);
}
