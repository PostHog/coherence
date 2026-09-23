/**
 * The vocabulary signal: which names coverage offers as candidates, which
 * uses it asks a sense review of, and what the hook says about either. Each
 * test below is the totality oracle of one Lifecycle invariant.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attention, attentionText, glossaryCoverage, type Coverage } from "./glossary-coverage.ts";
import { runHook } from "./hook.ts";

const COMPONENTS = ["books", "sales", "stock", "staff"];

/** A project whose glossary knows "exposure" (with a rejected name) and "unit basis" as a property of two concepts. */
function project(config: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-vocabulary-"));
  writeFileSync(
    join(root, "glossary.json"),
    JSON.stringify({
      version: 1,
      project: "ledgerly",
      concepts: [
        {
          name: "exposure",
          definition: "Money at risk, in USD.",
          aliases: [],
          rejected: [{ alternative: "hazard", because: "a hazard is a cause, not money at risk" }],
          properties: { unit_basis: "USD" },
          not_to_be_confused_with: ["Quuxdb: the store the exposure is kept in, not the exposure"],
        },
        { name: "allocation", definition: "A distributed share.", aliases: [], properties: { unit_basis: "percent" } },
        { name: "agent host", definition: "The application running a session.", aliases: [], instances: ["Claude Code"] },
      ],
    }),
  );
  writeFileSync(join(root, "coherence.config.json"), JSON.stringify({ name: "Ledgerly", ...config }));
  writeFileSync(join(root, "Ledgerly.spec.md"), "# Ledgerly\n\n## invariants\n");
  for (const c of COMPONENTS) {
    mkdirSync(join(root, c));
    writeFileSync(join(root, c, `${c[0]!.toUpperCase()}${c.slice(1)}.spec.md`), `# ${c}\n\n## invariants\n`);
  }
  return root;
}

function terms(report: Coverage): string[] {
  return report.terms.map((t) => t.term);
}

function candidates(report: Coverage): string[] {
  return attention(report).undefinedTerms.map((t) => t.term);
}

test("a code identifier is never a candidate unless it is declared and prose recurs it; ids, paths and fragments never are", async () => {
  const root = project();
  try {
    // Code: one declared name, locals, a split identifier, strings and a regular expression.
    writeFileSync(
      join(root, "books/roster.ts"),
      [
        "export interface Roster {",
        "  owner: string;",
        "}",
        "export function rosterBalanceSync(): number {",
        "  const tallyMarks = readFileSync('a.txt');",
        "  const deepEqual = /[a-z]+/.test('tally marks');",
        "  return tallyMarks.length;",
        "}",
        "",
      ].join("\n"),
    );
    // Prose writes "roster", "owner" and "tally marks" as words on many lines in every component; only declared names may surface.
    for (const c of COMPONENTS)
      writeFileSync(
        join(root, c, "notes.md"),
        [
          "The roster keeps every line the owner signed.",
          "A roster is closed monthly; tally marks count the rows.",
          "Nobody edits a roster once the owner closes it; tally marks stay.",
          "The owner reconciles it weekly, and tally marks are erased.",
          "Work order w-947cd2be and decision d-4a122d41 touched `.venv/bin/python` and `[a-z]` in src/books/roster.ts.",
          "Session 0e4a21bf-165b-4cef-8131-e66f7d90d073 read `a-z` and `readFileSync` again.",
          "",
        ].join("\n"),
      );
    const report = await glossaryCoverage(root);
    const found = candidates(report);
    assert.ok(found.includes("roster"), `a declared name recurring in prose is a candidate: ${found.join(", ")}`);
    assert.ok(found.includes("owner"), `a declared field recurring in prose is a candidate: ${found.join(", ")}`);
    for (const never of ["tally marks", "tally", "marks", "read file sync", "deep equal", "roster balance sync", "balance", "sync", "a z", "venv", "bin python", "readfilesync"])
      assert.ok(!terms(report).includes(never), `"${never}" is a local, a split identifier, or a fragment, never a term`);
    for (const t of terms(report)) {
      assert.doesNotMatch(t, /\d/, `an id or hash is never a term: ${t}`);
      assert.match(t, /^[a-z]+(?: [a-z]+)*$/, `a punctuation-bearing token is never a term: ${t}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("well-known names, the project's own name and the glossary's not: names are never candidates, while a common word written as a project's proper noun still is", async () => {
  const root = project({ wellKnown: ["Zanzibar"] });
  try {
    for (const c of COMPONENTS)
      writeFileSync(
        join(root, c, "notes.md"),
        [
          "We check it with Python and Pyright, then open Chrome on macOS.",
          "It deploys through Kubernetes to Postgres, typed in TypeScript.",
          "Each report lands in the Hive before it reaches Ledgerly and Zanzibar.",
          "The copy in Quuxdb waits while Claude Code and GitHub finish; the Hive keeps it.",
          "Around every window the `chrome` is drawn; the `chrome` never scrolls.",
          "",
        ].join("\n"),
      );
    const found = candidates(await glossaryCoverage(root));
    for (const never of ["python", "pyright", "chrome on", "macos", "github", "kubernetes", "postgres", "type script", "ledgerly", "zanzibar", "quuxdb", "claude code", "claude"])
      assert.ok(!found.includes(never), `"${never}" needs no definition, yet it was offered: ${found.join(", ")}`);
    assert.ok(found.includes("hive"), `a common word written as the project's proper noun still surfaces: ${found.join(", ")}`);
    assert.ok(found.includes("chrome"), `a well-known name skipped only when capitalized leaves the lowercase project sense a candidate: ${found.join(", ")}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sense review is asked only where meaning is at risk: more than one recorded sense, a rejected name beside the use, or a Coherence concept an adopter's code declares", async () => {
  const root = project();
  try {
    writeFileSync(join(root, "books/notes.md"), "The exposure is counted in USD.\nNothing else here.\n\n\nThe exposure is settled nightly.\n");
    writeFileSync(join(root, "sales/notes.md"), "The exposure is counted in USD.\nIt is not the hazard.\n");
    writeFileSync(join(root, "stock/notes.md"), "Each row states its unit basis.\n");
    writeFileSync(join(root, "staff/model.ts"), "export function scope(): string {\n  return 'staff';\n}\n");
    writeFileSync(join(root, "staff/notes.md"), "The scope of a shift is one day.\n");
    const report = await glossaryCoverage(root);
    const risk = (term: string, component: string): string | undefined =>
      report.terms.find((t) => t.term === term)?.contexts.find((c) => c.component === component)?.risk;
    assert.equal(risk("exposure", "books"), undefined, "an ordinary use of a defined word asks no review");
    assert.match(risk("exposure", "sales") ?? "", /hazard/, "a name rejected for the concept beside its use puts the sense at risk");
    assert.match(risk("unit basis", "stock") ?? "", /more than one recorded sense/, "a name with two recorded senses is at risk");
    assert.match(risk("scope", "staff") ?? "", /declared in this project's code/, "a Coherence concept the adopter declares in code is at risk");
    const at = attention(report).senses.map((s) => `${s.term}@${s.component}`).sort();
    assert.deepEqual(at, ["exposure@sales", "scope@staff", "unit basis@stock"]);
    assert.equal(report.totals.unreviewedContexts, 3, "only at-risk contexts await review");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Whether a text carries a count of the population rather than names. */
function carriesTotal(text: string): boolean {
  return /\b\d+ (?:unresolved|unsettled|new\/changed|observed|contexts?|candidate)/i.test(text) || /Glossary coverage:/.test(text);
}

function injected(stdout: string): string {
  if (stdout === "") return "";
  const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string }; systemMessage?: string };
  return parsed.hookSpecificOutput?.additionalContext ?? parsed.systemMessage ?? "";
}

test("no hook injection carries a total: orient names the ranked terms or says nothing", async () => {
  const root = project();
  try {
    const input = { session_id: "orient-test", cwd: root };
    const quiet = await runHook("SessionStart", input, root);
    assert.ok(!carriesTotal(injected(quiet.stdout)), injected(quiet.stdout));
    assert.doesNotMatch(injected(quiet.stdout), /lack(?:s)? a definition|Sense at risk/, "nothing owed, nothing said");
    for (const c of COMPONENTS) writeFileSync(join(root, c, "notes.md"), "The `premium` is new.\nEvery `premium` is billed.\nA `premium` is refunded.\n");
    const start = await runHook("SessionStart", input, root);
    const context = injected(start.stdout);
    assert.match(context, /A recurring term lacks a definition: premium\./);
    assert.ok(!carriesTotal(context), context);
    start.commit?.();
    writeFileSync(join(root, "books/charges.md"), "The `surcharge` is new.\nEach `surcharge` is billed.\nA `surcharge` is refunded.\n");
    const edit = await runHook("PostToolUse", { ...input, tool_name: "Write", tool_input: { file_path: join(root, "books/charges.md") } }, root);
    assert.ok(!carriesTotal(injected(edit.stdout)), injected(edit.stdout));
    const stop = await runHook("Stop", input, root);
    assert.ok(!carriesTotal(injected(stop.stdout)), injected(stop.stdout));
    assert.match(injected(stop.stdout), /this session left "surcharge" recurring without a definition/);
    assert.ok(!carriesTotal(attentionText(await glossaryCoverage(root))), "the shared signal never counts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the per-tool line is silent on an ordinary edit and names only the candidate an edit introduces", async () => {
  const root = project();
  try {
    writeFileSync(join(root, "books/notes.md"), "The exposure is counted in USD.\n");
    const input = { session_id: "edit-test", cwd: root };
    const start = await runHook("SessionStart", input, root);
    start.commit?.();
    const tool = { ...input, tool_name: "Write", tool_input: { file_path: join(root, "books/notes.md") } };
    // An ordinary edit: a new line that uses a defined word, and a new line of plain prose.
    appendFileSync(join(root, "books/notes.md"), "The exposure is settled nightly.\nRows are appended at the end of the day.\n");
    const ordinary = await runHook("PostToolUse", tool, root);
    assert.doesNotMatch(injected(ordinary.stdout), /Glossary/, "an ordinary edit says nothing about vocabulary");
    // An edit that makes a new name recur: named, once.
    appendFileSync(join(root, "books/notes.md"), "The `rebate` is new.\nEach `rebate` is paid.\nA `rebate` is clawed back.\n");
    const introduced = await runHook("PostToolUse", tool, root);
    assert.match(injected(introduced.stdout), /this edit made "rebate" recur without a definition/);
    introduced.commit?.();
    const again = await runHook("PostToolUse", tool, root);
    assert.doesNotMatch(injected(again.stdout), /Glossary/, "a candidate already named is not named again");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
