/**
 * A node:test reporter that writes the jest-shaped JSON report the batched
 * totality oracle pass reads: testResults[].assertionResults[] with
 * ancestorTitles, title, fullName, and status. node:test ships tap, spec,
 * dot, junit, and lcov reporters and no JSON one, so a project on node:test
 * names this file in its config:
 *
 *   "testJson": ["node", "--test", "--test-reporter=./src/enforcement/node-test-reporter.ts",
 *                "--test-reporter-destination={out}", "--test-name-pattern={filter}", "src/**\/*.test.ts"]
 *
 * (an adopter names it under node_modules/coherence). The runner emits
 * events only for the tests the name pattern selects; a parent's start
 * arrives before its children's, so the ancestor titles of a test are the
 * names started at shallower nesting in the same file.
 */

interface TestEvent {
  type: string;
  data: { name?: string; nesting?: number; file?: string; skip?: boolean | string; todo?: boolean | string; details?: { error?: unknown } };
}

interface AssertionResult {
  ancestorTitles: string[];
  title: string;
  fullName: string;
  status: "passed" | "failed" | "skipped";
  /** For a failure, jest's field: the stack of what the test threw (node:test wraps it as the cause of a test failure). */
  failureMessages?: string[];
}

/** The stack of the error a failing test threw, unwrapped from node:test's own test-failure error. */
export function failureText(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return error === undefined ? undefined : String(error);
  const outer = error as { cause?: unknown; stack?: unknown; message?: unknown; code?: unknown };
  const inner = outer.code === "ERR_TEST_FAILURE" && typeof outer.cause === "object" && outer.cause !== null ? (outer.cause as { stack?: unknown; message?: unknown }) : outer;
  if (typeof inner.stack === "string") return inner.stack;
  return typeof inner.message === "string" ? inner.message : undefined;
}

export default async function* nodeTestReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const stacks = new Map<string, string[]>();
  const files = new Map<string, AssertionResult[]>();
  for await (const event of source) {
    const { data } = event;
    const file = data.file ?? "";
    const name = data.name ?? "";
    const nesting = data.nesting ?? 0;
    if (event.type === "test:start") {
      const stack = stacks.get(file) ?? [];
      stack.length = nesting;
      stack[nesting] = name;
      stacks.set(file, stack);
      continue;
    }
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const ancestorTitles = (stacks.get(file) ?? []).slice(0, nesting);
    const skipped = (data.skip !== undefined && data.skip !== false) || (data.todo !== undefined && data.todo !== false);
    const status: AssertionResult["status"] = event.type === "test:fail" ? "failed" : skipped ? "skipped" : "passed";
    const results = files.get(file) ?? [];
    const failure = status === "failed" ? failureText(data.details?.error) : undefined;
    results.push({ ancestorTitles, title: name, fullName: [...ancestorTitles, name].join(" "), status, ...(failure === undefined ? {} : { failureMessages: [failure] }) });
    files.set(file, results);
  }
  const testResults = [...files].map(([name, assertionResults]) => ({ name, assertionResults }));
  yield JSON.stringify({ testResults }, null, 2) + "\n";
}
