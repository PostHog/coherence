/**
 * The relief, read in a worker thread the warm server starts for each reading
 * (readReliefApart): mass and the spec model are synchronous and read every
 * source file, so they run here, where no hook waits on them.
 */

import { parentPort, workerData } from "node:worker_threads";
import { startParsers } from "../../plugins/syntax-trees.ts";
import { readRelief } from "./relief.ts";

// A worker starts with a runtime of its own: a language read through a parser needs it started here too, as the CLI starts it.
await startParsers();
const { root } = workerData as { root: string };
parentPort!.postMessage(await readRelief(root));
