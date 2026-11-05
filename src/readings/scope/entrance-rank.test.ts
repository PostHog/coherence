/**
 * The rank of the undeclared entrances (entrance-rank.ts) as scaffold
 * entrances and orient give it: outside trust first, then whether the
 * handler writes, whether its imports reach a thing a chokepoint protects,
 * and how many components they reach; and, before all of them, the
 * entrances that skip the handler a family declared with one bullet goes
 * through.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Io } from "../../journal/cli.ts";
import { scaffoldCommand } from "../../scaffold/cli.ts";
import { loadSpecModel } from "../../spec/model.ts";
import { readEnforcementConfig } from "../../enforcement/config.ts";
import { rankEntrances, writesOf } from "./entrance-rank.ts";
import { orientUndeclaredText, undeclaredOf } from "./undeclared.ts";

function io(root: string): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { cwd: root, out: (l) => void lines.push(l), err: (l) => void errors.push(l), lines, errors };
}

const GUARDED = (method: string, extra = ""): string => [`import { guard } from '@/lib/guard'`, extra, `export async function ${method}(request: Request) {`, "  guard(request)", "  return new Response('ok')", "}", ""].join("\n");

/**
 * A Next.js shop: three API routes calling one guard (a POST that writes
 * through the store a chokepoint protects, a GET that reads it, a GET that
 * reads nothing more), a health route calling nothing, and a package
 * script that reaches the store. Imports go through a tsconfig path alias.
 */
function shop(options: { family?: boolean } = {}): { root: string; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), "coherence-rank-"));
  const files: Record<string, string> = {
    "coherence.config.json": JSON.stringify({ name: "Shop", language: "typescript" }),
    "package.json": JSON.stringify({ name: "shop", private: true, scripts: { seed: "tsx scripts/seed.ts" } }),
    "tsconfig.json": `{\n  // the app's alias, as Next.js writes it\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] }, },\n}\n`,
    "Shop.spec.md": [
      "# Shop", "", "Sells things.", "",
      "## trust levels", "- visitor (outside): anyone on the network", "- operator: the people who run the shop", "",
      ...(options.family === true ? ["## entrances", "- api routes: every API route, for a visitor, through guard", "  handler: guard in src/lib/guard.ts", "  trust: visitor", ""] : []),
      "## invariants", "",
    ].join("\n"),
    "src/lib/Lib.spec.md": ["# Lib", "", "Shared code.", "", "## invariants", "- one store: Every write reaches the rows through save.", "  protects: rows in store.ts", "  chokepoint: save in store.ts", "  because: one place writes", "  kinds: none", ""].join("\n"),
    "src/lib/guard.ts": "export function guard(request: Request): void {\n  void request\n}\n",
    "src/lib/store.ts": "export const rows: string[] = []\nexport function save(row: string): void {\n  rows.push(row)\n}\n",
    "src/app/api/orders/route.ts": [GUARDED("POST", "import { save } from '@/lib/store'"), GUARDED("GET").split("\n").slice(2).join("\n")].join("\n"),
    "src/app/api/items/route.ts": GUARDED("GET"),
    "src/app/api/health/route.ts": "export async function GET() {\n  return new Response('ok')\n}\n",
    "scripts/seed.ts": "import { save } from '../src/lib/store'\nsave('seed')\n",
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  const git = (...args: string[]): void => void execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "seed");
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** The ranked lines of a scaffold entrances proposal: "  1. <name> (<file>:<line>): <what ranks it>". */
function rankedLines(text: string): string[] {
  return text.split("\n").filter((l) => /^ {2}\d+\. /.test(l));
}

test("scaffold entrances ranks the undeclared entrances outside trust first, then a writing handler, then a chokepoint's protected thing its imports reach, then the components they reach, and proposes bullets for the first of them only", async () => {
  const { root, remove } = shop();
  try {
    const out = io(root);
    assert.equal(await scaffoldCommand(["entrances"], out), 0, out.errors.join("\n"));
    const text = out.lines.join("\n");
    assert.match(text, /^5 undeclared entrances \(5 detected in the project, 0 declared\)\. Undeclared is the normal state of a detected entrance, never a spec gap;/);
    assert.deepEqual(rankedLines(text), [
      "  1. POST api/orders/route (src/app/api/orders/route.ts:3): from off the machine, writes, reaches what 1 chokepoint protects, imports reach 2 components",
      "  2. GET api/orders/route (src/app/api/orders/route.ts:8): from off the machine, reaches what 1 chokepoint protects, imports reach 2 components",
      "  3. GET api/items/route (src/app/api/items/route.ts:3): from off the machine, imports reach 2 components",
      "  4. GET api/health/route (src/app/api/health/route.ts:1): from off the machine, imports reach 1 component",
      "  5. seed (scripts/seed.ts:1): run on the machine, reaches what 1 chokepoint protects, imports reach 2 components",
    ]);
    assert.match(text, /^1 of the 5 carry work in from off the machine and write\.$/m);

    const first = io(root);
    assert.equal(await scaffoldCommand(["entrances", "--first", "2"], first), 0, first.errors.join("\n"));
    const bounded = first.lines.join("\n");
    assert.equal(rankedLines(bounded).length, 2, "the first two, ranked");
    assert.match(bounded, /^ {2}and 3 more, ranked lower; \S+(?: \S+)* scaffold entrances --all proposes every one in this order\.$/m);
    assert.equal((bounded.match(/^- /gm) ?? []).length, 2, "bullets for those two only");
    assert.ok(bounded.includes("- POST api/orders/route: <one line") && !bounded.includes("- GET api/health/route:"), bounded);
    const all = io(root);
    assert.equal(await scaffoldCommand(["entrances", "--all"], all), 0);
    assert.equal((all.lines.join("\n").match(/^- /gm) ?? []).length, 5, "--all proposes every one");
    assert.equal(await scaffoldCommand(["entrances", "--all", "--first", "2"], io(root)), 1, "--all or --first, never both");

    assert.deepEqual(
      [{ symbol: "POST", why: "" }, { symbol: "list", why: "list is decorated @…post('/items'): a web route" }, { symbol: "h", why: "a router's route \"/x\" is handled by delete(h)" }, { symbol: "", why: "POST /rows registered by a .post() call" }, { symbol: "GET", why: "export GET in a Next.js route file: answers GET requests" }, { symbol: "show", why: "show is decorated @…get('/post/:id'): a web route" }].map((c) => writesOf({ ...c, rule: "route handler" })),
      [true, true, true, true, false, false],
      "a write is read from the method the shape names, never from a path that spells one",
    );
  } finally {
    remove();
  }
});

test("a family declared with one bullet stands for its members, and the entrances by its rule under its folder that skip its handler rank first, named with the handler they skip; orient counts them", async () => {
  const { root, remove } = shop({ family: true });
  try {
    const model = loadSpecModel(root, { runs: false });
    const state = undeclaredOf(root, model)!;
    assert.deepEqual([state.detected, state.covered, state.undeclared.length], [5, 3, 2], "one bullet covers the three routes that go through guard");
    const ranked = rankEntrances(root, model, state.undeclared, readEnforcementConfig(root).languages, state.all);
    assert.deepEqual(ranked.map((r) => [r.candidate.file, r.skips?.handler]), [["src/app/api/health/route.ts", "guard"], ["scripts/seed.ts", undefined]], "the route that skips guard ranks first, and the script, another rule, skips nothing");
    const out = io(root);
    assert.equal(await scaffoldCommand(["entrances"], out), 0, out.errors.join("\n"));
    assert.equal(rankedLines(out.lines.join("\n"))[0], '  1. GET api/health/route (src/app/api/health/route.ts:1): skips guard, which 3 others under src/app/api go through (the grouped entrance "api routes"), from off the machine, imports reach 1 component');
    const line = orientUndeclaredText(state, "coherence");
    assert.match(line, /^Entrance coverage: 1 declared entrance covers 3 of 5 detected; 2 undeclared, the normal state of a detected entrance, never a gap; [^]*; 1 skips guard, which 3 under src\/app\/api go through, and rank first\. coherence scaffold entrances ranks them/);
  } finally {
    remove();
  }
});
