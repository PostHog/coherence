/**
 * The relief, read in a worker thread the warm server starts for each reading
 * (readReliefApart): mass and the spec model are synchronous and read every
 * source file, so they run here, where no hook waits on them.
 */

import { parentPort, workerData } from "node:worker_threads";
import { startParsers } from "../../plugins/syntax-trees.ts";
import { readRelief } from "./relief.ts";

// The server stopping: git's children are ended here, since a worker ended outright leaves them running.
const stop = new AbortController();
parentPort!.on("message", (message) => {
  if (message === "stop") stop.abort();
});
// Listening holds no worker open: it ends when its reading does.
parentPort!.unref();

// A worker starts with a runtime of its own: a language read through a parser needs it started here too, as the CLI starts it.
await startParsers();
const { root } = workerData as { root: string };
const read = await readRelief(root, stop.signal);
if (!stop.signal.aborted) parentPort!.postMessage(read);
