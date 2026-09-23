/**
 * The node:test half of an observed pass: loaded into every test child
 * through NODE_OPTIONS (`--import`), it takes V8 precise coverage in the
 * child's own isolate and attributes it to one test at a time. A root
 * `beforeEach` takes (and so resets) the counters; a root `afterEach` takes
 * them again, and what executed in between is that test's. Each child
 * appends one JSON line per test to `<COHERENCE_OBSERVE_DIR>/<pid>.jsonl`.
 *
 * Inert anywhere else: the runner's parent process (no NODE_TEST_CONTEXT),
 * and any process a test spawns (the variable is deleted once this child is
 * active, so a test that runs node, or node --test, never observes itself).
 * What executes while a test file loads, before its first test, belongs to
 * no test and is dropped: a module's top level is load time, not a test.
 *
 * Only scripts under COHERENCE_OBSERVE_ROOT and outside node_modules are
 * kept, and of those only scripts where some function executed: each
 * function's whole range (executed or not, so a closure that never ran is
 * never read as its parent's executed body), and the block ranges of the
 * functions that ran.
 */

import { appendFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

interface FunctionCoverage {
  functionName: string;
  ranges: CoverageRange[];
}

interface ScriptCoverage {
  url: string;
  functions: FunctionCoverage[];
}

/** One script as the child writes it: offsets into the text V8 ran, which for type-stripped TypeScript is the file's own text. */
export interface ObservedScript {
  url: string;
  /** [start, end, count, name] per function; an unnamed one starting at 0 is the module's top level. */
  functions: [number, number, number, string][];
  /** [start, end, count] per block range inside a function that ran. */
  blocks: [number, number, number][];
}

/** One test's line in the child's file. */
export interface ObservedTestLine {
  file: string;
  name: string;
  /** The ancestor titles and the name, space-joined, as the node:test reporter writes fullName. */
  fullName: string;
  scripts: ObservedScript[];
}

/** A script's top level: V8 reports it as an unnamed function starting at offset 0. */
export function isModule(fn: FunctionCoverage): boolean {
  return fn.functionName === "" && fn.ranges[0]?.startOffset === 0;
}

/** The scripts worth keeping from one take: under the root, outside node_modules, with some function run. */
export function keepScripts(result: readonly ScriptCoverage[], rootUrl: string, self: string = import.meta.url): ObservedScript[] {
  const kept: ObservedScript[] = [];
  for (const script of result) {
    // The observer's own hooks run inside every test; they are never the test's region.
    if (!script.url.startsWith(rootUrl) || script.url.includes("/node_modules/") || script.url === self) continue;
    // After a take resets the counters, V8 lists only what ran since and its nested functions: the module's top level is often absent.
    const ran = script.functions.some((f) => !isModule(f) && (f.ranges[0]?.count ?? 0) > 0);
    if (!ran) continue;
    const functions: ObservedScript["functions"] = [];
    const blocks: ObservedScript["blocks"] = [];
    for (const fn of script.functions) {
      const [whole, ...inner] = fn.ranges;
      if (whole === undefined) continue;
      functions.push([whole.startOffset, whole.endOffset, whole.count, fn.functionName]);
      if (whole.count > 0) for (const block of inner) blocks.push([block.startOffset, block.endOffset, block.count]);
    }
    kept.push({ url: script.url, functions, blocks });
  }
  return kept;
}

const dir = process.env["COHERENCE_OBSERVE_DIR"];
const root = process.env["COHERENCE_OBSERVE_ROOT"];
if (process.env["NODE_TEST_CONTEXT"] !== undefined && dir !== undefined && root !== undefined) {
  delete process.env["COHERENCE_OBSERVE_DIR"];
  delete process.env["COHERENCE_OBSERVE_ROOT"];
  const rootUrl = pathToFileURL(root.endsWith("/") ? root : `${root}/`).href;
  const out = join(dir, `${process.pid}.jsonl`);
  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  const { beforeEach, afterEach } = await import("node:test");
  beforeEach(async () => {
    await session.post("Profiler.takePreciseCoverage");
  });
  afterEach(async (t) => {
    const { result } = (await session.post("Profiler.takePreciseCoverage")) as { result: ScriptCoverage[] };
    const context = t as unknown as { name: string; fullName?: string; filePath?: string };
    const line: ObservedTestLine = {
      file: context.filePath ?? process.argv[1] ?? "",
      name: context.name,
      fullName: (context.fullName ?? context.name).split(" > ").join(" "),
      scripts: keepScripts(result, rootUrl),
    };
    appendFileSync(out, JSON.stringify(line) + "\n");
  });
}
