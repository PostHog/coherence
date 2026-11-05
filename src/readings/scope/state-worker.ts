/**
 * The whole state scopeState reads, on the worker thread scopeStateApart
 * starts for each reading: the spec model, the lexicons and their coverage
 * read every file synchronously, so they run here.
 */

import { parentPort, workerData } from "node:worker_threads";
import { startParsers } from "../../plugins/syntax-trees.ts";
import type { FromReading } from "./apart.ts";
import { scopeState, type BuildOptions } from "./build.ts";
import type { ShellState } from "./model.ts";

// A worker starts with a runtime of its own: a language read through a parser needs it started here too, as the CLI starts it.
await startParsers();
const state = await scopeState(workerData as BuildOptions);
parentPort!.postMessage({ done: state } satisfies FromReading<ShellState>);
