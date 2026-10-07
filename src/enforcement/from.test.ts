/**
 * Which references a chokepoint governs (a bullet's from: line, the config's
 * chokepointFrom): a module boundary over a small TypeScript project. The
 * notebooks component keeps its rows behind a facade module; its own renderer
 * reads the rows directly, and a dashboard in another component does too.
 * Under anywhere both are bypasses; under outside the component only the
 * dashboard is, and the renderer's references are reported as exempt. The
 * automatic refutation stages a use from outside the exempted folder, so it
 * still proves an outside use is caught. The TypeScript adapter runs
 * in-process, as in enforcement.test.ts.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { TypeScriptAdapter } from "../adapters/typescript.ts";
import { parseSpec } from "../spec/grammar.ts";
import { checkChokepoint } from "./check.ts";
import { formatRun } from "./cli.ts";
import { readEnforcementConfig } from "./config.ts";
import { performRun } from "./run.ts";
import { answer } from "../readings/query/query.ts";
import { DEFAULTS, scopeState } from "../readings/scope/build.ts";
import { renderView } from "../readings/scope/shell.ts";

const TSCONFIG = `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true, "allowImportingTsExtensions": true }, "include": ["src/**/*.ts"] }\n`;

const INTERNAL = `export const NOTEBOOK_ROWS: string[] = ["a", "b"];\n`;
const FACADE = `import { NOTEBOOK_ROWS } from "./internal.ts";

export function openNotebook(): string[] {
  return [...NOTEBOOK_ROWS];
}
`;
const OWN = `import { NOTEBOOK_ROWS } from "./internal.ts";
export const renderNotebook = (): string => NOTEBOOK_ROWS.join(",");
`;
const OUTSIDE = `import { NOTEBOOK_ROWS } from "../notebooks/internal.ts";
export const board = (): number => NOTEBOOK_ROWS.length;
`;
const THROUGH_FACADE = `import { openNotebook } from "../notebooks/facade.ts";
export const board = (): number => openNotebook().length;
`;

const bullet = (name: string, from: string | undefined): string =>
  `- ${name}: Code outside the notebooks reaches their rows only through the facade.
  protects: NOTEBOOK_ROWS
  chokepoint: src/notebooks/facade.ts
${from === undefined ? "" : `  from: ${from}\n`}  because: the facade is the notebooks' component interface
  kinds: none
`;

const SPEC = `# Notebooks

The notebooks and their facade.
owners: team-notebooks, @ana

## invariants
${bullet("silent", undefined)}${bullet("anywhere", "anywhere")}${bullet("outside the component", "outside the component")}${bullet("outside the folder", "outside src/notebooks/")}`;

let root: string;
let adapter: TypeScriptAdapter;
const component = "src/notebooks";
const hint = { component, testFolders: readEnforcementConfig("/nowhere").testFolders };

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "coherence-from-"));
  write("tsconfig.json", TSCONFIG);
  write("Fixture.spec.md", "# Fixture\n\nA project with a module boundary.\n\n## invariants\n");
  write("src/notebooks/Notebooks.spec.md", SPEC);
  write("src/notebooks/internal.ts", INTERNAL);
  write("src/notebooks/facade.ts", FACADE);
  write("src/notebooks/render.ts", OWN);
  write("src/dashboards/board.ts", OUTSIDE);
  adapter = new TypeScriptAdapter(root);
});

after(async () => {
  await adapter.close();
  rmSync(root, { recursive: true, force: true });
});

test("from: reads anywhere, outside the component, or outside a folder on a chokepoint bullet, and refuses anything else", () => {
  const parsed = parseSpec(SPEC, "Notebooks.spec.md");
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.owners, ["team-notebooks", "@ana"]);
  assert.equal(parsed.intent, "The notebooks and their facade.", "the owners: line is not prose in the intent");
  const froms = parsed.invariants.map((i) => (i.enforcements[0] as { from?: unknown }).from);
  assert.deepEqual(froms, [undefined, "anywhere", "outside the component", { outside: "src/notebooks" }]);
  const bad = parseSpec(`# X\n\nX.\n\n## invariants\n${bullet("a", "storage")}- b: B.\n  over: o\n  via: v\n  from: anywhere\n`, "X.spec.md");
  assert.deepEqual(bad.problems.map((p) => p.message), [
    'from: on a reads anywhere, outside the component, or outside <folder>; "storage" is none of them',
    "from: on b belongs to the chokepoint form (protects: and chokepoint:); it names which references the chokepoint governs",
  ]);
  assert.match(parseSpec(`# X\n\nX.\n\n## invariants\n${bullet("c", "outside ../elsewhere")}`, "X.spec.md").problems[0]!.message, /outside <folder>/);
});

test("a chokepoint from outside the component exempts its own references and still catches a bypass from another component; from anywhere calls both bypasses", async () => {
  const anywhere = await checkChokepoint(adapter, { protects: "NOTEBOOK_ROWS", chokepoint: "src/notebooks/facade.ts", ...hint, root });
  assert.equal(anywhere.grade, "broken");
  assert.deepEqual(anywhere.bypasses.map((b) => `${b.file}:${b.line}`), ["src/dashboards/board.ts:1", "src/dashboards/board.ts:2", "src/notebooks/render.ts:1", "src/notebooks/render.ts:2"]);
  assert.deepEqual(anywhere.governed, { value: "anywhere", by: "default" });
  assert.doesNotMatch(anywhere.reason, /exempt/);

  for (const from of ["outside the component", { outside: "src/notebooks" }] as const) {
    const scoped = await checkChokepoint(adapter, { protects: "NOTEBOOK_ROWS", chokepoint: "src/notebooks/facade.ts", ...hint, root, from, fromBy: "bullet" });
    assert.equal(scoped.grade, "broken", scoped.reason);
    assert.deepEqual(scoped.bypasses.map((b) => `${b.file}:${b.line}`), ["src/dashboards/board.ts:1", "src/dashboards/board.ts:2"], "only the other component's references are bypasses");
    const own = scoped.sites.filter((s) => s.file === "src/notebooks/render.ts").map((s) => `${s.line} ${s.class}`);
    assert.deepEqual(own, ["1 exempt", "2 exempt"], "the component's own references are reported as exempt, never dropped");
    assert.equal(scoped.counts.exempt, 2);
    assert.equal(scoped.governed?.exempt, "src/notebooks");
    assert.match(scoped.reason, /governs only references from outside src\/notebooks \(from: outside .*, by its from: line\), so 2 references from inside it are exempt/);
    assert.equal(scoped.refutation, "automatic", scoped.refutationAccount);
    assert.match(scoped.refutationAccount, /a use of NOTEBOOK_ROWS from the unsaved document src\/coherence-refutation-[0-9a-f]+\.ts, outside src\/notebooks/);
  }

  write("src/dashboards/board.ts", THROUGH_FACADE);
  await adapter.forget();
  try {
    const clean = await checkChokepoint(adapter, { protects: "NOTEBOOK_ROWS", chokepoint: "src/notebooks/facade.ts", ...hint, root, from: "outside the component", fromBy: "bullet" });
    assert.equal(clean.grade, "reference-choked", clean.reason);
    assert.equal(clean.verdict, "pass");
    assert.equal(clean.refutation, "automatic", "the staged use from outside the folder is classified a bypass, so the refutation fires");
    assert.match(clean.reason, /2 references from inside it are exempt/);
    const stillBroken = await checkChokepoint(adapter, { protects: "NOTEBOOK_ROWS", chokepoint: "src/notebooks/facade.ts", ...hint, root });
    assert.equal(stillBroken.grade, "broken", "from anywhere, the component's own references are bypasses");
  } finally {
    write("src/dashboards/board.ts", OUTSIDE);
    await adapter.forget();
  }
});

test("the config's chokepointFrom governs a silent bullet, a bullet's own from: overrides it, and the run records and prints which governed", async () => {
  write("coherence.config.json", JSON.stringify({ language: "typescript", chokepointFrom: "outside the component" }));
  try {
    const outcome = await performRun(root, { session: "from-default", agent: "enforcement", adapter, form: "chokepoint", invariants: ["silent", "anywhere", "outside the folder"] });
    const byName = new Map(outcome.record.invariants.map((e) => [e.name, e]));
    const silent = byName.get("silent")!;
    assert.deepEqual(silent.from, { value: "outside the component", by: "config", exempt: "src/notebooks" });
    assert.deepEqual(silent.bypasses.map((b) => b.file), ["src/dashboards/board.ts", "src/dashboards/board.ts"]);
    assert.deepEqual(silent.sites?.filter((s) => s.class === "exempt").map((s) => `${s.file}:${s.line}`), ["src/notebooks/render.ts:1", "src/notebooks/render.ts:2"]);
    assert.match(silent.reason, /by the config's chokepointFrom/);
    const overridden = byName.get("anywhere")!;
    assert.deepEqual(overridden.from, { value: "anywhere", by: "bullet" });
    assert.equal(overridden.bypasses.length, 4, "the bullet's own from: anywhere overrides the config default");
    assert.deepEqual(byName.get("outside the folder")!.from, { value: "outside src/notebooks", by: "bullet", exempt: "src/notebooks" });
    assert.match(formatRun(outcome), /references: 2 inside, 0 test, 2 exempt \(from inside src\/notebooks; from: outside the component, by the config.s chokepointFrom\), 2 bypass/);
  } finally {
    rmSync(join(root, "coherence.config.json"));
  }
  const unset = await performRun(root, { session: "from-default", agent: "enforcement", adapter, form: "chokepoint", invariants: ["silent"] });
  assert.deepEqual(unset.record.invariants[0]!.from, { value: "anywhere", by: "default" }, "with no config default, a silent bullet governs anywhere");
  write("coherence.config.json", JSON.stringify({ chokepointFrom: "inside" }));
  try {
    assert.throws(() => readEnforcementConfig(root), /chokepointFrom reads anywhere, outside the component, or outside <folder>/);
  } finally {
    rmSync(join(root, "coherence.config.json"));
  }
});

test("Scope and the agent query show which references governed: the from: line with its exempt count on the enforcement, each exempt site as exempt, and the component's owners", async () => {
  write("coherence.config.json", JSON.stringify({ language: "typescript", chokepointFrom: "outside the component" }));
  try {
    await performRun(root, { session: "from-scope", agent: "enforcement", adapter, form: "chokepoint", invariants: ["silent"] });
  } finally {
    rmSync(join(root, "coherence.config.json"));
  }
  const state = await scopeState({ root, lexiconPath: join(process.cwd(), DEFAULTS.lexiconPath), project: "Fixture", window: false });
  assert.match(renderView(state, "components").text, /data-field="owners"><span class="label">Owners<\/span> team-notebooks, @ana</);
  assert.match(
    renderView(state, "invariants").text,
    /data-field="from" data-exempt="src\/notebooks"><span class="label">from<\/span> outside the component <span class="quiet">\(the config default\): governs only references from outside <code>src\/notebooks<\/code>; 2 references from inside it exempt, reported and never a bypass/,
  );
  const relies = answer(state, "relies-on", ["NOTEBOOK_ROWS"]).text;
  assert.match(relies, /governs only references from outside src\/notebooks \(from: outside the component, by the config\)/);
  assert.match(relies, /src\/notebooks\/render\.ts:1 in module top level — protected thing; exempt, from where the chokepoint does not govern; never a bypass/);
  assert.match(answer(state, "component", ["src/notebooks"]).text, /^ {2}owners: team-notebooks, @ana$/m);
});
