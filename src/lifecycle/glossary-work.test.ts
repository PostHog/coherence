import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { glossaryCoverage } from "./glossary-coverage.ts";
import {
  applyProposal,
  propose,
  recoverGlossary,
  reviewGlossary,
} from "./glossary-maintain.ts";
import {
  coverageChanges,
  glossaryWorkCommand,
  priorBaseline,
  saveBaseline,
} from "./glossary-cli.ts";
import { loadJournal } from "../journal/store.ts";

const who = { session: "glossary-test", agent: "test" };
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-glossary-work-"));
  writeFileSync(
    join(root, "glossary.json"),
    JSON.stringify({
      version: 1,
      project: "risk",
      purpose: "keep me",
      concepts: [
        {
          name: "exposure",
          definition: "Money at risk, measured in USD.",
          aliases: ["amount at risk"],
          properties: { unit: "USD" },
          not_to_be_confused_with: ["duration: time exposed"],
          detail: { explanation: "retained" },
          provenance: { owner: "human" },
        },
      ],
    }),
  );
  mkdirSync(join(root, "money"));
  mkdirSync(join(root, "time"));
  writeFileSync(
    join(root, "money/Money.spec.md"),
    "# Money\n\n## invariants\n",
  );
  writeFileSync(join(root, "time/Time.spec.md"), "# Time\n\n## invariants\n");
  writeFileSync(
    join(root, "money/model.ts"),
    "export const exposure = 12; // USD\nexport const premiumAmount = 3;\n",
  );
  writeFileSync(
    join(root, "time/model.ts"),
    "export const exposure = 7; // calendar days, not money\n",
  );
  writeFileSync(
    join(root, "notes.md"),
    "The `premium` is new. `exposure` is used twice.\nEvery `premium` is charged per policy.\nA `premium` is billed monthly.\n",
  );
  return root;
}
async function run(
  root: string,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await glossaryWorkCommand(args, {
    cwd: root,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
test("glossary coverage states its observed population and leaves known words in new contexts open to sense review", async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "opaque.ipynb"), "{}");
    mkdirSync(join(root, "node_modules"));
    writeFileSync(
      join(root, "node_modules/stranger.md"),
      "The `badCandidate` is not ours.",
    );
    writeFileSync(join(root, ".env"), "API_SECRET=never-print-this-value\n");
    const a = await glossaryCoverage(root);
    const b = await glossaryCoverage(root);
    assert.deepEqual(a, b);
    assert.ok(a.population.excluded.some((x) => x.file === "opaque.ipynb"));
    assert.ok(a.population.excluded.some((x) => x.file === "node_modules"));
    assert.ok(!JSON.stringify(a).includes("never-print-this-value"));
    const exposure = a.terms.find((t) => t.term === "exposure")!;
    assert.equal(exposure.state, "concept");
    assert.equal(exposure.layer, "project");
    assert.ok(
      exposure.contexts.some(
        (c) => c.component === "money" && c.disposition === "unreviewed",
      ),
    );
    assert.ok(
      exposure.contexts.some(
        (c) => c.component === "time" && c.disposition === "unreviewed",
      ),
    );
    assert.ok(
      a.terms.some((t) => t.term === "premium" && t.state === "unresolved"),
    );
    assert.ok(a.population.limits.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("glossary maintenance preserves full entries, records actual effects, and refuses stale previews and unacknowledged retirement", async () => {
  const root = fixture();
  try {
    const preview = await propose(root, {
      action: "alias",
      name: "exposure",
      value: "financial exposure",
      because: "same monetary sense",
    });
    assert.ok(
      !readFileSync(join(root, "glossary.json"), "utf8").includes(
        "financial exposure",
      ),
    );
    const appliedDecision = applyProposal(
      root,
      preview.id,
      who,
      "same monetary sense",
      ["new concept"],
    );
    assert.match(appliedDecision, /^d-/);
    const changed = JSON.parse(
      readFileSync(join(root, "glossary.json"), "utf8"),
    );
    assert.deepEqual(changed.concepts[0].detail, { explanation: "retained" });
    assert.deepEqual(changed.concepts[0].properties, { unit: "USD" });
    assert.equal(changed.purpose, "keep me");
    assert.ok(changed.concepts[0].aliases.includes("financial exposure"));
    assert.equal(loadJournal(root).records.length, 1);
    assert.throws(
      () => applyProposal(root, preview.id, who, "again", ["none"]),
      /already applied/,
    );
    const rename = await propose(root, {
      action: "rename",
      name: "exposure",
      value: "monetary exposure",
      because: "disambiguation",
    });
    assert.throws(
      () => applyProposal(root, rename.id, who, "disambiguation", ["overload"]),
      /human/,
    );
    assert.ok(!existsSync(join(root, ".coherence/glossary/pending.json")));
    writeFileSync(
      join(root, "glossary.json"),
      JSON.stringify({ ...changed, extra: "concurrent change" }),
    );
    assert.throws(
      () =>
        applyProposal(
          root,
          rename.id,
          who,
          "disambiguation",
          ["overload"],
          "owner approved",
        ),
      /changed since preview/,
    );
    assert.equal(loadJournal(root).records.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("glossary application recovers a journal failure without lying about an unapplied change or duplicating its decision", async () => {
  const root = fixture();
  try {
    const preview = await propose(root, {
      action: "declare",
      name: "premium",
      definition: "Price paid for risk cover.",
      because: "a distinct meaning",
    });
    const unwritablePath = join(root, ".coherence/journal/glossary-test.jsonl");
    mkdirSync(unwritablePath, { recursive: true });
    assert.throws(() =>
      applyProposal(root, preview.id, who, "distinct meaning", ["alias"]),
    );
    assert.ok(
      !existsSync(join(root, ".coherence/glossary/pending.json")),
      "unreadable journal fails before writing",
    );
    assert.ok(
      !readFileSync(join(root, "glossary.json"), "utf8").includes("Price paid"),
    );
    rmSync(unwritablePath, { recursive: true });
    // Simulate interruption at the durable boundary between the glossary replacement and its decision.
    writeFileSync(
      join(root, ".coherence/glossary/pending.json"),
      JSON.stringify({
        proposal: preview,
        who,
        because: "distinct meaning",
        over: ["alias"],
      }),
    );
    writeFileSync(join(root, "glossary.json"), preview.after);
    assert.match(recoverGlossary(root), /^d-/);
    assert.equal(loadJournal(root).records.length, 1);
    assert.equal(recoverGlossary(root), "no pending glossary application");
    assert.equal(loadJournal(root).records.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("glossary maintenance refuses an outside target and preserves the original on invalid proposals", async () => {
  const root = fixture();
  const outside = fixture();
  try {
    const before = readFileSync(join(root, "glossary.json"), "utf8");
    await assert.rejects(
      propose(root, { action: "declare", name: "broken", because: "test" }),
      /definition/,
    );
    assert.equal(readFileSync(join(root, "glossary.json"), "utf8"), before);
    writeFileSync(
      join(root, "coherence.config.json"),
      JSON.stringify({ glossary: join(outside, "glossary.json") }),
    );
    await assert.rejects(
      propose(root, {
        action: "alias",
        name: "exposure",
        value: "x",
        because: "test",
      }),
      /outside/,
    );
    symlinkSync(outside, join(root, "link"));
    writeFileSync(
      join(root, "coherence.config.json"),
      JSON.stringify({ glossary: "link/glossary.json" }),
    );
    await assert.rejects(
      propose(root, {
        action: "alias",
        name: "exposure",
        value: "x",
        because: "test",
      }),
      /outside/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
test("sense rulings require current evidence and reopen after source or definition changes; baselines never settle meaning", async () => {
  const root = fixture();
  try {
    // A name refused for exposure, written beside a use of it, puts that context at risk, so review is asked.
    const g = JSON.parse(readFileSync(join(root, "glossary.json"), "utf8"));
    g.concepts[0].rejected = [{ alternative: "hazard", because: "a hazard is a cause, not money at risk" }];
    writeFileSync(join(root, "glossary.json"), JSON.stringify(g));
    writeFileSync(join(root, "money/notes.md"), "The exposure is counted in USD.\nIt is not the hazard.\n");
    const a = await glossaryCoverage(root);
    const term = a.terms.find((t) => t.term === "exposure")!;
    const context = term.contexts.find((c) => c.component === "money")!;
    saveBaseline(root, who.session, a);
    assert.equal(
      coverageChanges(a, priorBaseline(root, who.session)).length,
      0,
    );
    assert.ok(a.totals.unreviewedContexts > 0);
    await assert.rejects(
      reviewGlossary(
        root,
        "exposure",
        "money",
        context.fingerprint,
        "confirmed",
        who,
        "correct unit",
        ["time"],
      ),
      /human/,
    );
    await reviewGlossary(
      root,
      "exposure",
      "money",
      context.fingerprint,
      "confirmed",
      who,
      "correct unit",
      ["time"],
      "owner: USD is correct",
    );
    const b = await glossaryCoverage(root);
    assert.equal(
      b.terms
        .find((t) => t.term === "exposure")!
        .contexts.find((c) => c.component === "money")!.disposition,
      "confirmed",
    );
    writeFileSync(
      join(root, "money/model.ts"),
      "export const exposure = 100; // percent, not USD\n",
    );
    const c = await glossaryCoverage(root);
    assert.equal(
      c.terms
        .find((t) => t.term === "exposure")!
        .contexts.find((c) => c.component === "money")!.disposition,
      "unreviewed",
    );
    assert.ok(
      coverageChanges(c, priorBaseline(root, who.session)).some(
        (t) => t.term === "exposure",
      ),
    );
    await assert.rejects(
      reviewGlossary(
        root,
        "exposure",
        "money",
        context.fingerprint,
        "confirmed",
        who,
        "stale",
        ["none"],
        "owner",
      ),
      /stale/,
    );
    const change = await propose(root, {
      action: "define",
      name: "exposure",
      definition: "Risk on a percent basis.",
      because: "clarified unit",
    });
    applyProposal(root, change.id, who, "clarified unit", ["USD"]);
    assert.notEqual(
      (await glossaryCoverage(root)).terms.find((t) => t.term === "exposure")!
        .fingerprint,
      term.fingerprint,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("glossary draft and fixed queries work without specs or an existing domain glossary and never overwrite a draft", async () => {
  const root = mkdtempSync(join(tmpdir(), "coherence-glossary-new-"));
  try {
    writeFileSync(
      join(root, "notes.md"),
      "The `premium` has an unsettled meaning.\nA `premium` is charged per policy.\nEvery `premium` is billed monthly.\n",
    );
    const coverage = await run(root, ["coverage", "--json"]);
    assert.equal(coverage.code, 0, coverage.err);
    assert.equal(JSON.parse(coverage.out).projectGlossary, null);
    const draft = await run(root, ["draft", "--out", "draft.json"]);
    assert.equal(draft.code, 0, draft.err);
    assert.equal((await run(root, ["draft", "--out", "draft.json"])).code, 1);
    const proposed = JSON.parse(readFileSync(join(root, "draft.json"), "utf8"));
    assert.ok(
      proposed.candidates.some(
        (c: { name: string; definition: unknown }) =>
          c.name === "premium" && c.definition === null,
      ),
    );
    assert.equal((await run(root, ["ready", "--terms", "premium"])).code, 1);
    assert.equal((await run(root, ["nonsense"])).code, 1);
    assert.equal((await run(root, ["coverage", "--typo"])).code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("glossary lifecycle uses child identities and installed roots, and advances changed contexts only after delivery", async () => {
  const { runHook, writtenFiles } = await import("./hook.ts");
  const root = fixture();
  try {
    mkdirSync(join(root, ".codex"));
    writeFileSync(join(root, ".codex/hooks.json"), "{}");
    const input = {
      session_id: "parent",
      agent_id: "child",
      agent_type: "reviewer",
      hook_event_name: "SubagentStart",
      cwd: join(root, "money"),
    };
    const start = await runHook("SubagentStart", input, join(root, "money"));
    const context = JSON.parse(start.stdout).hookSpecificOutput
      .additionalContext as string;
    assert.match(context, /Session: child/);
    assert.match(context, /Risk vocabulary/);
    assert.match(context, /A recurring term lacks a definition: premium\./);
    assert.ok(
      !existsSync(join(root, ".coherence/glossary/sessions/child.json")),
    );
    start.commit?.();
    assert.ok(
      existsSync(join(root, ".coherence/glossary/sessions/child.json")),
    );
    assert.ok(!existsSync(join(root, "money/.coherence")));
    assert.ok(
      !existsSync(join(root, ".coherence/glossary/sessions/parent.json")),
    );
    writeFileSync(
      join(root, "money/model.ts"),
      "export const riskcharge = 12;\n",
    );
    // The edit makes a new name recur in prose: that, and only that, is worth a line at the edit.
    writeFileSync(
      join(root, "money/charges.md"),
      "The `riskcharge` is new.\nEach `riskcharge` is billed.\nA `riskcharge` is refunded on cancel.\n",
    );
    const patch = {
      ...input,
      hook_event_name: "PostToolUse",
      tool_name: "apply_patch",
      tool_input: {
        command:
          "*** Begin Patch\n*** Update File: money/model.ts\n@@\n+export const riskcharge = 12;\n*** Delete File: time/old.ts\n*** Move to: time/new.ts\n*** End Patch",
      },
    };
    assert.deepEqual(writtenFiles(root, patch), [
      "money/model.ts",
      "time/old.ts",
      "time/new.ts",
    ]);
    const event = await runHook("PostToolUse", patch, root);
    assert.match(event.stdout, /riskcharge/);
    assert.equal(
      (await runHook("PostToolUse", patch, root)).stdout,
      event.stdout,
      "unprinted context is still pending",
    );
    event.commit?.();
    assert.equal(
      (await runHook("PostToolUse", patch, root)).stdout,
      "",
      "no repeated unchanged-context notification",
    );
    const sibling = await runHook(
      "SubagentStart",
      { ...input, agent_id: "sibling" },
      root,
    );
    assert.match(sibling.stdout, /Session: sibling/);
    const unknown = await runHook(
      "SubagentStart",
      { cwd: root, hook_event_name: "SubagentStart", session_id: "parent" },
      root,
    );
    assert.match(unknown.stdout, /Session: unknown/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Scope and the fixed glossary query expose the same live sense evidence and escape source text", async () => {
  const { loadState } = await import("../readings/scope/build.ts");
  const { renderGlossaryView } = await import(
    "../readings/scope/glossary-view.ts"
  );
  const { answer } = await import("../readings/query/query.ts");
  const { COHERENCE_GLOSSARY } = await import("./project.ts");
  const root = fixture();
  try {
    writeFileSync(
      join(root, "notes.md"),
      'The `exposure` has <script>alert("unsafe")</script> in a quoted example.',
    );
    const state = await loadState({
      root,
      glossaryPath: COHERENCE_GLOSSARY,
      project: "risk",
    });
    state.glossary.query = "exposure";
    const html = renderGlossaryView(state.glossary).text;
    assert.match(html, /Vocabulary coverage and sense review/);
    assert.match(html, /money\/model.ts/);
    assert.match(html, /time\/model.ts/);
    assert.ok(!html.includes('<script>alert("unsafe")</script>'));
    const read = answer(state, "glossary", ["exposure"]);
    assert.equal(read.code, 0);
    assert.match(read.text, /Money at risk/);
    assert.match(read.text, /USD/);
    assert.match(read.text, /calendar days/);
    assert.ok(
      state.glossary
        .coverage!.terms.find((t) => t.term === "exposure")!
        .contexts.every(
          (c) =>
            html.includes(c.fingerprint) && read.text.includes(c.fingerprint),
        ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an installed hook command locates its project from a non-git subdirectory for both hosts", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const root = fixture();
  const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "coherence" }),
    );
    symlinkSync(
      fileURLToPath(new URL("..", import.meta.url)),
      join(root, "src"),
    );
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    for (const host of ["claude", "codex"]) {
      const installed = spawnSync(
        process.execPath,
        [cli, "hooks", "install", "--host", host],
        {
          cwd: root,
          env,
          encoding: "utf8",
        },
      );
      assert.equal(installed.status, 0, installed.stderr);
      const settings = JSON.parse(
        readFileSync(
          join(
            root,
            host === "claude" ? ".claude/settings.json" : ".codex/hooks.json",
          ),
          "utf8",
        ),
      );
      const command = settings.hooks.SessionStart[0].hooks[0].command;
      const result = spawnSync("sh", ["-c", command], {
        cwd: join(root, "money"),
        env,
        input: JSON.stringify({
          cwd: join(root, "money"),
          session_id: "native-fixture",
        }),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
        /lacks a definition: premium/,
      );
      assert.ok(
        existsSync(
          join(root, ".coherence/glossary/sessions/native-fixture.json"),
        ),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local similarity is optional, validates vectors and never changes exact coverage when unavailable", async () => {
  const { cosine, normalized, similarTerms } = await import(
    "./glossary-similarity.ts"
  );
  const root = fixture();
  try {
    const before = await glossaryCoverage(root);
    const suggestions = await similarTerms(root, "financial risk");
    assert.equal(suggestions["available"], false);
    assert.deepEqual(await glossaryCoverage(root), before);
    assert.equal(cosine(normalized([3, 4]), normalized([3, 4])), 1);
    assert.throws(() => normalized([0, 0]), /zero/);
    assert.throws(() => normalized([Number.NaN]), /invalid/);
    assert.throws(() => cosine([1], [1, 0]), /different models/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("named instances are distinct from aliases and become known without pretending a product is its category", async () => {
  const root = fixture();
  try {
    const preview = await propose(root, {
      action: "declare",
      name: "agent host",
      definition:
        "The application running an agent session and delivering lifecycle events.",
      entry: { instances: ["Example Host"] },
      because: "a product is an instance, not a synonym of the category",
    });
    applyProposal(root, preview.id, who, "distinct category and instances", [
      "alias of hook",
    ]);
    writeFileSync(join(root, "host.md"), "Example Host runs the session.\n");
    const report = await glossaryCoverage(root);
    const term = report.terms.find((t) => t.term === "example host")!;
    assert.equal(term.state, "instance");
    assert.equal(term.concept, "agent host");
    const { runCheck } = await import("./check.ts");
    const { loadProjectGlossaries } = await import("./project.ts");
    const glossary = await loadProjectGlossaries(root);
    assert.ok(
      !(
        await runCheck({
          root,
          coherence: glossary.coherence,
          project: glossary.project,
        })
      ).unknown.some((n) => n.term === "example host"),
    );
    const change = await propose(root, {
      action: "define",
      name: "agent host",
      entry: { instances: [], detail: { note: "kept" } },
      because: "add context without losing names",
    });
    applyProposal(root, change.id, who, "preserve prior instances", [
      "losing names",
    ]);
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(root, "glossary.json"), "utf8"),
      ).concepts.find((c: { name: string }) => c.name === "agent host")
        .instances,
      ["Example Host"],
    );
    await assert.rejects(
      propose(root, {
        action: "define",
        name: "agent host",
        entry: { name: "secret rename" },
        because: "test",
      }),
      /explicit rename/,
    );
    await assert.rejects(
      propose(root, {
        action: "declare",
        name: "located",
        definition: "No stored addresses",
        entry: { uses: [{ file: "x.ts" }] },
        because: "test",
      }),
      /addresses/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rename --qualify gives the concept a qualified name and leaves the old name free for its other senses", async () => {
  const { mkdtempSync, writeFileSync: write, readFileSync: read } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { propose } = await import("./glossary-maintain.ts");
  const root = mkdtempSync(join(tmpdir(), "coherence-qualify-"));
  write(join(root, "glossary.json"), JSON.stringify({ version: 1, project: "p", concepts: [{ name: "interface", definition: "d", rejected: [] }] }));
  const plain = await propose(root, { action: "rename", name: "interface", value: "component interface", because: "b" });
  assert.match(plain.after, /"alternative": "interface"/, "a plain rename rejects the old name");
  const qualified = await propose(root, { action: "rename", name: "interface", value: "component interface", qualify: true, because: "b" });
  assert.doesNotMatch(qualified.after, /"alternative": "interface"/, "a qualifying rename leaves the old name free");
  assert.match(qualified.after, /"name": "component interface"/);
  void read;
});
