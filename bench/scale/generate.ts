/**
 * A synthetic monorepo shaped like PostHog's: a registry at the top opting
 * in three products, each a Python backend and a TypeScript frontend with
 * specs, practices, a lexicon and a run history, beside shared code no
 * product owns. About 5,000 files and 400,000 lines, committed to git.
 *
 * usage: node bench/scale/generate.ts <empty folder>
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LEAVES = ["products/alpha", "products/beta", "products/gamma"] as const;

/** Per product: Python packages x modules, TypeScript features x components. */
const PACKAGES = 25;
const MODULES = 25;
const FEATURES = 25;
const COMPONENTS = 25;
/** Outside every product: shared Python and TypeScript code. */
const SHARED_PY = 550;
const SHARED_TS = 550;
/** Functions per generated file, seven or eight lines each. */
const FUNCTIONS = 10;
/** Sessions and runs per session in each product's history. */
const SESSIONS = 25;
const RUNS_PER_SESSION = 8;
/** The journal decision each product's practices cite. */
const DECISION = "d-0000beef";

export interface Generated {
  files: number;
  lines: number;
}

function capital(word: string): string {
  return word[0]!.toUpperCase() + word.slice(1);
}

function pythonModule(seed: number, sibling: string | undefined): string {
  const lines = ['"""Generated module."""', "", "from __future__ import annotations", ""];
  if (sibling !== undefined) lines.push(`from .${sibling} import compute_0 as upstream`, "");
  else lines.push("def upstream(value: int) -> int:", "    return value", "");
  for (let f = 0; f < FUNCTIONS; f++) {
    lines.push(
      `def compute_${f}(value: int) -> int:`,
      `    """Step ${f} of the pipeline for seed ${seed}."""`,
      `    total = upstream(value) + ${(seed * 7 + f) % 97}`,
      "    for step in range(3):",
      `        total = (total * ${f + 2} + step) % 1_000_003`,
      "    return total",
      "",
    );
  }
  lines.push("", "class Record:", "    def __init__(self, key: str) -> None:", "        self.key = key", "");
  return lines.join("\n");
}

function typescriptModule(seed: number, sibling: string | undefined): string {
  const lines = ["// Generated component.", ""];
  if (sibling !== undefined) lines.push(`import { compute0 as upstream } from "./${sibling}.ts";`, "");
  else lines.push("function upstream(value: number): number {", "  return value;", "}", "");
  for (let f = 0; f < FUNCTIONS; f++) {
    lines.push(
      `/** Step ${f} of the pipeline for seed ${seed}. */`,
      `export function compute${f}(value: number): number {`,
      `  let total = upstream(value) + ${(seed * 7 + f) % 97};`,
      "  for (let step = 0; step < 3; step++) {",
      `    total = (total * ${f + 2} + step) % 1_000_003;`,
      "  }",
      "  return total;",
      "}",
    );
  }
  lines.push("", "export interface Row {", "  key: string;", "}", "");
  return lines.join("\n");
}

function leafFiles(leaf: string): Record<string, string> {
  const name = leaf.split("/").at(-1)!;
  const upper = name.toUpperCase();
  const files: Record<string, string> = {};
  for (let p = 0; p < PACKAGES; p++) {
    files[`backend/pkg_${p}/__init__.py`] = "";
    for (let m = 0; m < MODULES; m++) files[`backend/pkg_${p}/module_${m}.py`] = pythonModule(p * MODULES + m, m === 0 ? undefined : `module_${m - 1}`);
  }
  for (let f = 0; f < FEATURES; f++) {
    for (let c = 0; c < COMPONENTS; c++) files[`frontend/src/feature_${f}/component_${c}.ts`] = typescriptModule(f * COMPONENTS + c, c === 0 ? undefined : `component_${c - 1}`);
  }
  // The guarded rows and the one door to them, in each language.
  files["backend/store/__init__.py"] = "";
  files["backend/store/rows.py"] = `${upper}_ROWS: list[str] = ["first", "second"]\n`;
  files["backend/store/door.py"] = `from .rows import ${upper}_ROWS\n\n\ndef door() -> list[str]:\n    return list(${upper}_ROWS)\n`;
  files["backend/store/reader.py"] = "from .door import door\n\n\ndef first() -> str:\n    return door()[0]\n";
  files["frontend/src/vault/secret.ts"] = `export const ${upper}_SECRET = "s3cr3t";\n`;
  files["frontend/src/vault/reveal.ts"] = `import { ${upper}_SECRET } from "./secret.ts";\n\nexport function reveal(): string {\n  return ${upper}_SECRET.slice(0, 2) + "****";\n}\n`;
  files["frontend/src/vault/view.ts"] = `import { reveal } from "./reveal.ts";\n\nexport const shown = reveal();\n`;
  files["tsconfig.json"] = `${JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["frontend/src/**/*.ts"] }, null, 2)}\n`;
  files["coherence.config.json"] = `${JSON.stringify({ name }, null, 2)}\n`;

  // The entry spec, two guarded components, and components held by totality oracles.
  files[`${capital(name)}.spec.md`] = [
    `# ${capital(name)}`,
    "",
    `The ${name} product: a Python backend and a TypeScript frontend.`,
    "",
    "## trust levels",
    "- browser (outside): What a visitor's browser sends the API.",
    "- service: The product's own backend code.",
    "",
    "## invariants",
    `- ${name} answers its own routes: Every request to the ${name} API is answered by the ${name} backend.`,
    "  over: every route the product declares",
    `  via: ${name} answers its own routes`,
    "  because: a fixture",
    "  kinds: none",
    "",
  ].join("\n");
  files["backend/store/Store.spec.md"] = [
    "# Store",
    "",
    `Holds the ${name} rows.`,
    "",
    "## invariants",
    `- ${name} rows through door: The ${name} rows leave the store only through door.`,
    `  protects: ${upper}_ROWS in backend/store/rows.py`,
    "  chokepoint: door in backend/store/door.py",
    `  because: a raw row must never reach a caller unchecked`,
    "  crossing: browser -> service",
    "  kinds: none",
    "",
  ].join("\n");
  files["frontend/src/vault/Vault.spec.md"] = [
    "# Vault",
    "",
    `Keeps the ${name} secret masked.`,
    "",
    "## invariants",
    `- ${name} secret masked: The ${name} secret leaves the vault only through reveal.`,
    `  protects: ${upper}_SECRET in frontend/src/vault/secret.ts`,
    "  chokepoint: reveal in frontend/src/vault/reveal.ts",
    "  because: an unmasked secret must never be shown",
    "  kinds: none",
    "",
  ].join("\n");
  for (let p = 0; p < 6; p++) {
    const bullets: string[] = [];
    for (let b = 0; b < 5; b++) {
      bullets.push(
        `- package ${p} step ${b} holds: Step ${b} of package ${p} keeps its total under the modulus.`,
        "  over: every value the step receives",
        `  via: package ${p} step ${b} holds`,
        "  because: a fixture",
        "  kinds: none",
      );
    }
    files[`backend/pkg_${p}/Pkg${p}.spec.md`] = [`# Pkg${p}`, "", `Package ${p} of the ${name} pipeline.`, "", "## invariants", ...bullets, ""].join("\n");
  }

  files["backend/store/Store.practice.md"] = [
    "- read the door first: Read the door before changing the store.",
    "  when: edit **/*.py",
    "  step: read backend/store/door.py",
    "  step: read the store spec",
    `  learned: ${DECISION}`,
    "  because: a change that bypasses the door leaks raw rows",
    "",
  ].join("\n");
  files["frontend/src/vault/Vault.practice.md"] = [
    "- mask before showing: Confirm a shown value passed through reveal.",
    "  when: edit **/*.ts | command ls",
    "  step: find where the value is shown",
    "  step: confirm it passed through reveal",
    `  learned: ${DECISION}`,
    "  because: an unmasked secret on screen cannot be taken back",
    "",
  ].join("\n");

  files["lexicon.json"] = `${JSON.stringify(
    {
      project: name,
      version: 1,
      concepts: [
        { name: "row", definition: `One stored ${name} record.`, aliases: ["record"] },
        { name: "door", definition: "The one function a guarded value leaves through.", aliases: [] },
        { name: "pipeline", definition: "The chain of compute steps a value passes.", aliases: [] },
        { name: "secret", definition: "A value the frontend shows only masked.", aliases: [] },
      ],
      rejected: [{ concept: "row", name: "tuple", because: "a row is a record, not a database tuple" }],
    },
    null,
    2,
  )}\n`;

  // The run history: every invariant of the product, run after run.
  const entries = [
    { component: "backend/store", name: `${name} rows through door`, form: "chokepoint" },
    { component: "frontend/src/vault", name: `${name} secret masked`, form: "chokepoint" },
    { component: ".", name: `${name} answers its own routes`, form: "totality oracle" },
    ...Array.from({ length: 6 }, (_, p) => Array.from({ length: 5 }, (_, b) => ({ component: `backend/pkg_${p}`, name: `package ${p} step ${b} holds`, form: "totality oracle" }))).flat(),
  ];
  const start = Date.parse("2026-09-01T09:00:00.000Z");
  for (let s = 0; s < SESSIONS; s++) {
    const session = `history-${String(s).padStart(3, "0")}`;
    const lines: string[] = [];
    // The first session witnessed each totality oracle's refutation: red with a break staged, before the passing runs.
    if (s === 0) {
      for (const e of entries.filter((entry) => entry.form === "totality oracle")) {
        lines.push(JSON.stringify({ kind: "refutation", at: new Date(start - 60_000).toISOString(), session, agent: "main", ...e, broke: "returned early", verdict: "fail", reason: "the test went red", commit: "0000000", dirty: true }));
      }
    }
    for (let r = 0; r < RUNS_PER_SESSION; r++) {
      const at = new Date(start + (s * RUNS_PER_SESSION + r) * 3_600_000).toISOString();
      lines.push(
        JSON.stringify({
          at,
          session,
          agent: "main",
          commit: "0000000",
          dirty: false,
          instrument: { language: "python", server: "warm" },
          latency: 1200 + r,
          invariants: entries.map((e, i) => ({
            ...e,
            verdict: "pass",
            refutation: e.form === "chokepoint" ? "automatic" : "witnessed",
            bypasses: [],
            testReferences: 1,
            files: [],
            latency: 40 + i,
            reason: "",
            ...(e.form === "totality oracle" ? { mode: "batched", testMs: 30 + ((i + r) % 7) } : { grade: "reference-choked" }),
          })),
        }),
      );
    }
    files[`.coherence/runs/${session}.jsonl`] = `${lines.join("\n")}\n`;
  }
  const decision = { id: DECISION, kind: "decision", at: new Date(start - 120_000).toISOString(), session: "history-000", agent: "main", commit: "0000000", dirty: false, chose: "guard the rows behind one door", over: ["read the rows anywhere"], because: "a raw row once reached a log" };
  files[".coherence/journal/history-000.jsonl"] = `${JSON.stringify(decision)}\n`;
  return files;
}

function sharedFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < SHARED_PY; i++) {
    const pkg = `posthog/shared_${Math.floor(i / 25)}`;
    if (i % 25 === 0) files[`${pkg}/__init__.py`] = "";
    files[`${pkg}/module_${i % 25}.py`] = pythonModule(10_000 + i, i % 25 === 0 ? undefined : `module_${(i % 25) - 1}`);
  }
  for (let i = 0; i < SHARED_TS; i++) {
    files[`frontend/src/lib_${Math.floor(i / 25)}/part_${i % 25}.ts`] = typescriptModule(20_000 + i, i % 25 === 0 ? undefined : `part_${(i % 25) - 1}`);
  }
  files["README.md"] = "# Monorepo\n\nA synthetic repository for the scale benchmark.\n";
  files["coherence.config.json"] = `${JSON.stringify({ projects: [...LEAVES], language: ["python", "typescript"], ignore: ["__pycache__", "node_modules"] }, null, 2)}\n`;
  return files;
}

/** Write the repository into `root` (empty or absent) and commit it. */
export function generate(root: string): Generated {
  const all: Record<string, string> = { ...sharedFiles() };
  for (const leaf of LEAVES) for (const [path, text] of Object.entries(leafFiles(leaf))) all[`${leaf}/${path}`] = text;
  let lines = 0;
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    lines += text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  }
  const git = (...args: string[]): void => {
    const result = spawnSync("git", ["-c", "user.email=bench@example.com", "-c", "user.name=bench", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  };
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return { files: Object.keys(all).length, lines };
}

if (import.meta.main) {
  const root = process.argv[2];
  if (root === undefined) {
    process.stderr.write("usage: node bench/scale/generate.ts <empty folder>\n");
    process.exit(64);
  }
  const made = generate(root);
  process.stdout.write(`${made.files} files, ${made.lines} lines in ${root}\n`);
}
