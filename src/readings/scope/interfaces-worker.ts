/**
 * The component interface reading, on the worker thread readInterfacesApart
 * starts for each reading: everything synchronous runs here, and each
 * question for a language server goes to the thread that holds the server.
 */

import { parentPort, workerData } from "node:worker_threads";
import type { Definition, LanguageAdapter, ReferenceSite, Resolved, ResolveHint } from "../../adapters/adapter.ts";
import type { Language } from "../../adapters/index.ts";
import { startParsers } from "../../plugins/syntax-trees.ts";
import { readComponentInterfaces } from "./component-interfaces.ts";
import { readAndRecord } from "./gaps.ts";
import type { FromReading, Question, ToReading } from "./apart.ts";
import type { InterfaceReading } from "./model.ts";

const port = parentPort!;
let next = 0;
const waiting = new Map<number, { answered: (value: unknown) => void; failed: (error: Error) => void }>();
port.on("message", (reply: ToReading) => {
  const asked = waiting.get(reply.ask);
  waiting.delete(reply.ask);
  if ("failed" in reply) asked?.failed(new Error(reply.failed));
  else asked?.answered(reply.value);
});

function ask<T>(language: Language, question: Question, args: unknown[]): Promise<T> {
  return new Promise((answered, failed) => {
    const id = next++;
    waiting.set(id, { answered: answered as (value: unknown) => void, failed });
    port.postMessage({ ask: id, language, question, args } satisfies FromReading<InterfaceReading>);
  });
}

const RELAYED_ONLY = "the interface reading's worker asks only what the reading asks: ready, resolve and references";

/** A language's adapter as the reading sees it: each question it asks is answered by the thread that holds the server. */
function relayed(language: Language): LanguageAdapter {
  const unasked = (): never => {
    throw new Error(RELAYED_ONLY);
  };
  return {
    language,
    ladder: { top: "reference-choked", because: RELAYED_ONLY, rungs: [] },
    ready: () => ask(language, "ready", []),
    resolve: (name: string, hint: ResolveHint) => ask<Resolved>(language, "resolve", [name, hint]),
    references: (definition: Definition) => ask<ReferenceSite[]>(language, "references", [definition]),
    visibility: unasked,
    testFilter: unasked,
    refute: unasked,
    forget: unasked,
    // The server is the holding thread's to close.
    close: async () => {},
  };
}

// A worker starts with a runtime of its own: a language read through a parser needs it started here too, as the CLI starts it.
await startParsers();
const { root } = workerData as { root: string };
const adapters = new Map<Language, LanguageAdapter>();
const adapterOf = (language: Language): LanguageAdapter => {
  let adapter = adapters.get(language);
  if (adapter === undefined) adapters.set(language, (adapter = relayed(language)));
  return adapter;
};
const reading = await readAndRecord(root, () => readComponentInterfaces(root, adapterOf, { memory: (adapter) => ask(adapter.language as Language, "memory", []) }));
port.postMessage({ done: reading } satisfies FromReading<InterfaceReading>);
