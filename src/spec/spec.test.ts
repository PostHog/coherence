/**
 * The spec check: the grammar, the model, and the state derivation over
 * fixtures written into a temporary directory.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadLexicon } from "../lifecycle/lexicon.ts";
import { runCheck } from "../lifecycle/check.ts";
import { COHERENCE_LEXICON } from "../lifecycle/project.ts";
import { RETIRED_SECTIONS, isCalendarDate, parseSpec, type Invariant } from "./grammar.ts";
import { loadSpecModel, type SpecModel } from "./model.ts";
import { formatReport } from "./report.ts";
import { applicableShapes, loadSeed } from "./seed.ts";
import { deriveState } from "./state.ts";
import type { Latest } from "../enforcement/record.ts";

/** A latest chokepoint entry whose automatic refutation fired: the run's own witness. */
function automatic(): Latest {
  return {
    component: ".",
    name: "digest-only egress",
    form: "chokepoint",
    verdict: "pass",
    grade: "reference-choked",
    refutation: "automatic",
    bypasses: [],
    testReferences: 0,
    files: [],
    latency: 1,
    reason: "",
    at: "2026-09-18T10:00:00.000Z",
    commit: null,
    session: "s",
  };
}

const seed = loadSeed();

function scratch(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-spec-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return root;
}

function withModel(files: Record<string, string>, run: (model: SpecModel) => void): void {
  const root = scratch(files);
  try {
    run(loadSpecModel(root, { seed }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const ENTRY = `# Widgetry

A store of widgets with one door in.

## trust levels
- owner-trusted: the owner's own calls
- storage: the rows beneath everything
- public-egress: what leaves in the clear

## invariants
`;

const FULL_BULLET = `- digest-only egress: A secret leaves storage only as its digest.
  protects: SECRET_COLUMNS
  chokepoint: seal
  over: every column declared secret in SECRET_COLUMNS
  via: egress digest totality
  because: a read of a leaked row must disclose no usable bearer
  crossing: storage -> public-egress
  refuted: removed the seal call from the row renderer -> egress digest totality went red naming the column (2026-09-17)
  kinds: credential, output
`;

function checklistFor(kinds: string[], declaredAs: string): string {
  return applicableShapes(seed, kinds)
    .map((shape, index) => (index === 0 ? `  checklist: ${shape.shape} declared as ${declaredAs}\n` : `  checklist: ${shape.shape} dismissed: not this shape\n`))
    .join("");
}

const OTHER = `- door count: Every write enters through one door.
  protects: rows
  chokepoint: write
  because: one door is one place to look
  kinds: none
`;

function firstInvariant(text: string): Invariant {
  const parsed = parseSpec(text, "X.spec.md", { seed });
  assert.deepEqual(parsed.problems, []);
  const invariant = parsed.invariants[0];
  assert.ok(invariant !== undefined);
  return invariant;
}

test("the grammar parses a full bullet with both enforcement forms", () => {
  const invariant = firstInvariant(`${ENTRY}${FULL_BULLET}${checklistFor(["credential", "output"], "door count")}${OTHER}`);
  assert.equal(invariant.name, "digest-only egress");
  assert.equal(invariant.sentence, "A secret leaves storage only as its digest.");
  assert.deepEqual(
    invariant.enforcements.map((e) => e.form),
    ["chokepoint", "totality oracle"],
  );
  const chokepoint = invariant.enforcements[0];
  assert.ok(chokepoint !== undefined && chokepoint.form === "chokepoint");
  assert.equal(chokepoint.protects, "SECRET_COLUMNS");
  assert.equal(chokepoint.chokepoint, "seal");
  const totality = invariant.enforcements[1];
  assert.ok(totality !== undefined && totality.form === "totality oracle");
  assert.equal(totality.via, "egress digest totality");
  assert.equal(invariant.because, "a read of a leaked row must disclose no usable bearer");
  assert.deepEqual({ from: invariant.crossing?.from, to: invariant.crossing?.to }, { from: "storage", to: "public-egress" });
  assert.equal(invariant.refutations.length, 1);
  assert.equal(invariant.refutations[0]?.date, "2026-09-17");
  assert.equal(invariant.refutations[0]?.broke, "removed the seal call from the row renderer");
  assert.deepEqual(invariant.kinds, ["credential", "output"]);
  assert.equal(invariant.checklist.length, applicableShapes(seed, ["credential", "output"]).length);
  assert.equal(invariant.checklist[0]?.outcome, "declared");
  assert.equal(invariant.checklist[1]?.outcome, "dismissed");
  assert.deepEqual(invariant.unfilled, []);
});

test("a wrapped value continues the line above it", () => {
  const invariant = firstInvariant(`${ENTRY}- wrapped: A sentence that
    keeps going.
  because: a reason that
    also wraps
`);
  assert.equal(invariant.sentence, "A sentence that keeps going.");
  assert.equal(invariant.because, "a reason that also wraps");
});

test("the state derivation: the full bullet is an invariant, and each missing part keeps it a requirement", () => {
  const full = firstInvariant(`${ENTRY}${FULL_BULLET}${checklistFor(["credential", "output"], "door count")}${OTHER}`);
  const applicable = applicableShapes(seed, ["credential", "output"]).map((s) => s.shape);
  // The bullet carries a refuted: line and both forms; with no run and no refutation record it refutes nothing.
  assert.deepEqual(deriveState(full, applicable), {
    state: "requirement",
    lacks: ["refutation"],
    missingShapes: [],
    verified: [],
    defects: [],
    unrefuted: ["chokepoint", "totality oracle"],
  });
  const witnessedBoth = { chokepoint: automatic(), totality: undefined };
  assert.deepEqual(deriveState(full, applicable, witnessedBoth, true).lacks, [], "the automatic refutation and the record together");
  assert.equal(deriveState(full, applicable, witnessedBoth, true).state, "invariant");

  const without = (...keys: string[]): Invariant => {
    const lines = `${FULL_BULLET}${checklistFor(["credential", "output"], "door count")}`
      .split("\n")
      .filter((line) => !keys.some((key) => line.trimStart().startsWith(`${key}:`)));
    return firstInvariant(`${ENTRY}${lines.join("\n")}\n${OTHER}`);
  };
  const oneForm = without("protects", "chokepoint");
  assert.equal(oneForm.enforcements.length, 1, "the totality oracle form alone still enforces");
  assert.equal(deriveState(oneForm, applicable, undefined, true).state, "invariant");
  assert.equal(deriveState(oneForm, applicable).state, "requirement", "and it still needs its own refutation record");
  const noEnforcement = without("protects", "chokepoint", "over", "via");
  assert.deepEqual(deriveState(noEnforcement, applicable).lacks, ["enforcement", "refutation"]);
  assert.equal(deriveState(noEnforcement, applicable).state, "requirement");

  const noRefutation = without("refuted");
  assert.deepEqual(deriveState(noRefutation, applicable).lacks, ["refutation"]);
  assert.deepEqual(deriveState(noRefutation, applicable, witnessedBoth, true).lacks, [], "the refuted: line is the human account, not the evidence");

  const noBecause = without("because");
  assert.deepEqual(deriveState(noBecause, applicable, witnessedBoth, true).lacks, ["because"]);
  assert.equal(deriveState(noBecause, applicable, witnessedBoth, true).state, "invariant", "because is reported but does not change the state");

  const noKinds = without("kinds");
  assert.deepEqual(deriveState(noKinds, [], witnessedBoth, true).lacks, ["kinds"]);
  assert.equal(deriveState(noKinds, [], witnessedBoth, true).state, "requirement");

  const noChecklist = without("checklist");
  const derived = deriveState(noChecklist, applicable, witnessedBoth, true);
  assert.deepEqual(derived.lacks, ["checklist"]);
  assert.deepEqual(derived.missingShapes, applicable);
  assert.equal(derived.state, "requirement");

  const bare = firstInvariant(`${ENTRY}- bare: Nothing but a sentence.\n`);
  assert.deepEqual(deriveState(bare, []).lacks, ["enforcement", "refutation", "kinds", "because"]);
});

test("a placeholder value parses but counts as absent", () => {
  const invariant = firstInvariant(`${ENTRY}- <name>: A sentence.
  protects: <the protected thing>
  chokepoint: seal
  because: <why>
  refuted: <what was broken> -> <what was seen> (<date>)
  kinds: credential
  checklist: capability-authorization declared as <invariant name> | dismissed: <reason>
`);
  assert.deepEqual(invariant.enforcements, []);
  assert.equal(invariant.because, undefined);
  assert.deepEqual(invariant.refutations, []);
  assert.deepEqual(invariant.checklist, []);
  assert.deepEqual(invariant.unfilled, ["name", "protects", "because", "refuted", "checklist capability-authorization"]);
});

test("half an enforcement form, an unknown key, a bad crossing, and a bad refutation are problems", () => {
  const parsed = parseSpec(
    `${ENTRY}- half: A sentence.
  chokepoint: seal
  via: a test
  colour: blue
  crossing: storage
  refuted: broke it and nothing happened
  kinds: credential, sprocket
  checklist: no-such-shape dismissed: never
  checklist: capability-authorization is fine
`,
    "X.spec.md",
    { seed },
  );
  const messages = parsed.problems.map((p) => p.message);
  assert.ok(messages.some((m) => m.includes("the chokepoint form on half names both protects: and chokepoint:; protects: is missing")), messages.join("\n"));
  assert.ok(messages.some((m) => m.includes("the totality oracle form on half names both over: and via:; over: is missing")));
  assert.ok(messages.some((m) => m.includes('unknown key "colour"')));
  assert.ok(messages.some((m) => m.includes("crossing on half reads <trust level> -> <trust level>")));
  assert.ok(messages.some((m) => m.includes("refuted on half reads <what was broken> -> <what was seen> (YYYY-MM-DD)")));
  assert.ok(messages.some((m) => m.includes("unknown kind sprocket")));
  assert.ok(messages.some((m) => m.includes("no shape named no-such-shape")));
  assert.ok(messages.some((m) => m.includes("checklist on half reads <shape> declared as <invariant name> or <shape> dismissed: <reason>")));
});

test("every retired section is refused by name with its replacement", () => {
  assert.ok(RETIRED_SECTIONS.length >= 7);
  for (const retired of RETIRED_SECTIONS) {
    const parsed = parseSpec(`# X\n\nIntent.\n\n## ${retired.section}\n- something\n\n## invariants\n`, "X.spec.md", { seed });
    const found = parsed.problems.find((p) => p.message.includes(`## ${retired.section} is retired`));
    assert.ok(found !== undefined, `${retired.section} is refused`);
    assert.ok(found.message.includes(retired.replacement), `${retired.section} names its replacement`);
    assert.equal(found.line, 5);
  }
  const unknown = parseSpec(`# X\n\nIntent.\n\n## notes\n`, "X.spec.md", { seed });
  assert.ok(unknown.problems.some((p) => p.message.includes('unknown section "notes"')));
});

test("a spec needs a title and an intent, and holds no prose beyond the intent", () => {
  const bare = parseSpec("", "X.spec.md", { seed });
  assert.ok(bare.problems.some((p) => p.message.includes("a spec starts with # <Name>")));
  assert.ok(bare.problems.some((p) => p.message.includes("a spec needs its intent")));
  const chatty = parseSpec("# X\n\nIntent.\n\nMore prose here.\n\n## invariants\n", "X.spec.md", { seed });
  assert.equal(chatty.intent, "Intent.");
  assert.ok(chatty.problems.some((p) => p.message.includes("prose after the intent")));
});

test("the model: components nest by folder, transparent folders are skipped, and counts add up", () => {
  withModel(
    {
      "Widgetry.spec.md": `${ENTRY}${FULL_BULLET}${checklistFor(["credential", "output"], "door count")}${OTHER}`,
      "src/store/Store.spec.md": "# Store\n\nThe rows.\n\n## invariants\n- one: A sentence.\n  because: reasons\n",
      "src/store/deep/inner/Inner.spec.md": "# Inner\n\nDeep.\n\n## invariants\n",
      "node_modules/x/X.spec.md": "# Skipped\n\nNever read.\n",
    },
    (model) => {
      assert.deepEqual(model.problems, []);
      assert.deepEqual(
        model.components.map((c) => [c.folder, c.parent, c.children]),
        [
          [".", undefined, ["src/store"]],
          ["src/store", ".", ["src/store/deep/inner"]],
          ["src/store/deep/inner", "src/store", []],
        ],
      );
      assert.equal(model.entry, ".");
      assert.deepEqual(
        model.trustLevels.map((t) => t.name),
        ["owner-trusted", "storage", "public-egress"],
      );
      assert.equal(model.components[1]?.intent, "The rows.");
      assert.deepEqual(
        model.components[0]?.invariants.map((i) => [i.name, i.state]),
        [
          ["digest-only egress", "requirement"],
          ["door count", "requirement"],
        ],
      );
      // No run and no refutation record: nothing in this tree has been seen to fire.
      assert.deepEqual(model.counts, {
        components: 3,
        bullets: 3,
        invariants: 0,
        requirements: 3,
        structuralDefects: 0,
        lacking: { enforcement: 1, refutation: 3, kinds: 1, checklist: 0, because: 0 },
        unfilled: 0,
        problems: 0,
      });
      const report = formatReport(model);
      assert.match(report, /digest-only egress {2}requirement {2}lacks refutation\n/);
      assert.match(report, /chokepoint seal protects SECRET_COLUMNS: declared, unverified/);
      assert.match(report, /totality oracle "egress digest totality" over every column declared secret in SECRET_COLUMNS: declared, unverified/);
      assert.match(report, /door count {2}requirement {2}lacks refutation/);
      assert.match(report, /3 components, 3 bullets: 0 invariants, 3 requirements/);
    },
  );
});

test("the model: crossings name declared trust levels, and only the entry spec declares them", () => {
  withModel(
    {
      "Widgetry.spec.md": `${ENTRY}- x: A sentence.\n  crossing: storage -> nowhere\n`,
      "sub/Sub.spec.md": "# Sub\n\nA sub.\n\n## trust levels\n- extra: not here\n\n## invariants\n- y: A sentence.\n  crossing: owner-trusted -> storage\n",
    },
    (model) => {
      const messages = model.problems.map((p) => `${p.file}:${p.line} ${p.message}`);
      assert.ok(messages.some((m) => m.startsWith("Widgetry.spec.md:") && m.includes("crossing on x names trust level nowhere; declared: owner-trusted, storage, public-egress")), messages.join("\n"));
      assert.ok(messages.some((m) => m.startsWith("sub/Sub.spec.md:5") && m.includes("trust levels are declared in the entry spec only (Widgetry.spec.md)")));
      assert.equal(messages.length, 2);
    },
  );
  withModel({ "sub/Sub.spec.md": "# Sub\n\nA sub.\n\n## invariants\n- y: A sentence.\n  crossing: a -> b\n" }, (model) => {
    assert.ok(model.problems.some((p) => p.message.includes("no entry spec declares trust levels")));
  });
});

test("the model: names are unique within a component, declared-as names must exist, and one spec per folder", () => {
  withModel(
    {
      "Widgetry.spec.md": `${ENTRY}- twin: A sentence.\n- twin: Another.\n- lonely: A sentence.\n  kinds: credential\n  checklist: capability-authorization declared as nobody\n  checklist: revalidated-permission declared as lonely\n`,
      "Zecond.spec.md": "# Zecond\n\nA second spec in the root, sorted after the first.\n",
    },
    (model) => {
      const messages = model.problems.map((p) => p.message);
      assert.ok(messages.some((m) => m === "invariant twin declared twice in this component"));
      assert.ok(messages.some((m) => m.includes('capability-authorization declared as "nobody", which names no invariant')));
      assert.ok(!messages.some((m) => m.includes("revalidated-permission")), "a shape declared as the bullet itself is fine: the requirement often is the shape");
      assert.ok(messages.some((m) => m.includes("a folder holds one spec")));
    },
  );
});

test("the model honors the config's entryDir and ignore list", () => {
  withModel(
    {
      "coherence.config.json": JSON.stringify({ entryDir: "app", ignore: ["vendor"] }),
      "app/App.spec.md": "# App\n\nThe app.\n\n## trust levels\n- a: one\n- b: two\n\n## invariants\n- x: A sentence.\n  crossing: a -> b\n",
      "vendor/lib/Lib.spec.md": "# Lib\n\nIgnored.\n",
    },
    (model) => {
      assert.deepEqual(model.problems, []);
      assert.equal(model.entry, "app");
      assert.deepEqual(
        model.components.map((c) => c.folder),
        ["app"],
      );
    },
  );
});

test("a spec written in the grammar with every shape name carries no rejected name", async () => {
  const lines = [ENTRY, "- every shape: A sentence.\n  kinds: none\n"];
  for (const shape of seed.shapes) lines.push(`  checklist: ${shape.shape} dismissed: not this one\n`);
  for (const kind of Object.keys(seed.kinds)) lines.push(`- kind ${kind}: A sentence.\n  kinds: ${kind}\n`);
  const root = scratch({ "Widgetry.spec.md": lines.join("") });
  try {
    const coherence = await loadLexicon(COHERENCE_LEXICON);
    const report = await runCheck({ root, coherence });
    assert.deepEqual(report.rejected, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a long refuted value parses in linear time, and three digit groups that name no day are refused", () => {
  // Reviewer A: the old pattern put a lazy group on each side of the arrow and a third before the date,
  // so a long value with no closing date backtracked quadratically: 156 KB took 16 s, on every hook event.
  // The shape that blows up is a value that reaches the arrow and never reaches a date: 156 KB of "a -> "
  // took 16.5 s here against the old pattern, and one interior run of 8 KB of spaces took 161 s.
  const long = "a -> ".repeat((156 * 1024) / 5);
  const started = Date.now();
  const slow = parseSpec(`${ENTRY}- long: A sentence.\n  refuted: ${long}\n  because: reasons\n  kinds: none\n`, "X.spec.md", { seed });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `a ${long.length} character refuted value took ${elapsed} ms to refuse`);
  assert.ok(slow.problems.some((p) => p.message.includes("refuted on long reads")));
  const spaced = "broke it ->" + " ".repeat(8 * 1024) + "x";
  const spacedStarted = Date.now();
  parseSpec(`${ENTRY}- spaced: A sentence.\n  refuted: ${spaced}\n  because: reasons\n  kinds: none\n`, "X.spec.md", { seed });
  assert.ok(Date.now() - spacedStarted < 1000, "an interior run of spaces is linear too");

  // Reviewer B: the date was three digit groups, so a day the calendar does not have parsed.
  const noSuchDay = parseSpec(`${ENTRY}- bad date: A sentence.\n  refuted: broke it -> it went red (2026-13-45)\n  because: reasons\n  kinds: none\n`, "X.spec.md", { seed });
  assert.deepEqual(noSuchDay.invariants[0]?.refutations, []);
  assert.ok(
    noSuchDay.problems.some((p) => p.message === "refuted on bad date ends with (2026-13-45), which is not a day that exists"),
    JSON.stringify(noSuchDay.problems),
  );
  assert.equal(isCalendarDate("2026", "02", "29"), false, "2026 is not a leap year");
  assert.equal(isCalendarDate("2024", "02", "29"), true);

  const good = parseSpec(`${ENTRY}- fine: A sentence.\n  refuted: broke it -> it went red (2026-09-18)\n  because: reasons\n  kinds: none\n`, "X.spec.md", { seed });
  assert.deepEqual(good.problems, []);
  assert.deepEqual({ broke: good.invariants[0]?.refutations[0]?.broke, date: good.invariants[0]?.refutations[0]?.date }, { broke: "broke it", date: "2026-09-18" });
});
