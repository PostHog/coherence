/**
 * One synthetic project at any size, for the hooks' size-independence tests:
 * the same shape at 1× and at 10×, with ten times the components, the
 * practices, the files, the lines, the lexicon and the history, at the same
 * folder depth. Every small component is the same size, so a hook whose
 * work is its own files' does the same work at both sizes, and one whose
 * work grows with the project, its breadth or its history does not.
 *
 *   <top>/                         a git repository whose host settings sit here
 *     .claude/settings.json
 *     other/note-<k>.md            a folder that is no project, 4 × scale files
 *     proj/                        the project, with its own host settings
 *       .claude/settings.json
 *       coherence.config.json      names the project lexicon
 *       lexicon.json               10 × scale concepts
 *       Sized.spec.md              the root component: every file below in no
 *       README.md                  other component is its own
 *       src/c<i>/C<i>.spec.md      3 × scale small components, each with a
 *       src/c<i>/C<i>.practice.md  chokepoint invariant and a practice fired by
 *       src/c<i>/m.ts              `deploy<i>`, its source and its notes;
 *       src/c<i>/secret.ts         m.ts spells no chokepoint name, so an edit
 *       src/c<i>/README.md         to it touches no invariant
 *       src/big/Big.spec.md        one component of 6 × scale notes
 *       src/big/part-<k>.md
 *       docs/note-<k>.md           4 × scale notes in the root component
 *       .coherence/runs/h<k>.jsonl     2 × scale run files of 3 × scale runs each
 *       .coherence/journal/h<k>.jsonl  2 × scale journal files of 5 × scale records each
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface SizedProject {
  /** The repository's top, where a host launched above the project runs. */
  top: string;
  /** The project's root. */
  root: string;
  /** A folder inside the repository that is no project. */
  other: string;
  /** The small components, project-relative. */
  components: string[];
}

const PROSE = [
  "The widget turns when the knob is oiled, and a dry knob seizes before noon.",
  "Each component keeps its own notes beside its source, read by whoever changes it.",
  "A release is cut from the main line once every check is green and the notes agree.",
];

function notes(lines: number, salt: number): string {
  return Array.from({ length: lines }, (_, n) => `${PROSE[(n + salt) % PROSE.length]} Line ${n}.`).join("\n") + "\n";
}

function source(i: number): string {
  return Array.from({ length: 24 }, (_, n) => `export const value${i}_${n} = ${n};`).join("\n") + "\n";
}

function secret(i: number): string {
  return [`export const SECRET_${i} = "s${i}";`, `export function seal${i}(): string {`, `  return SECRET_${i}.slice(1);`, "}", ""].join("\n");
}

function spec(title: string, invariant?: number): string {
  const lines = [`# ${title}`, "", `The ${title} part of the sized fixture.`, ""];
  if (invariant !== undefined) {
    const i = invariant;
    lines.push("## invariants", `- secret ${i} leaves through its seal: SECRET_${i} is read only by seal${i}.`, `  protects: SECRET_${i}`, `  chokepoint: seal${i}`, "  because: a fixture", "  kinds: none", "");
  }
  return lines.join("\n");
}

function practice(i: number): string {
  return [`- release ${i}: A release is cut only from a green line.`, `  when: command deploy${i}`, "  step: run the checks", "  step: cut the release", "  reach: internal", "  because: fixture", ""].join("\n");
}

/** One run record, as `run` appends it, checking component i's chokepoint invariant. */
function run(at: string, i: number): string {
  const entry = { component: `src/c${i}`, name: `secret ${i} leaves through its seal`, form: "chokepoint", verdict: "pass", refutation: "automatic", bypasses: [], testReferences: 0, files: [`src/c${i}/secret.ts`], latency: 5, reason: "fixture" };
  return JSON.stringify({ at, session: "history", agent: "fixture", binding: "none", commit: null, dirty: false, instrument: { language: "typescript", server: "warm" }, latency: 5, invariants: [entry] });
}

/** One journal decision, as decide appends it, long before any session the tests run. */
function decision(at: string, n: number): string {
  return JSON.stringify({ id: `d-${n.toString(16).padStart(8, "0")}`, kind: "decision", at, session: `history-${n}`, agent: "fixture", commit: null, dirty: false, chose: `choice ${n}`, over: [`another ${n}`], because: "fixture history" });
}

/** The project at `scale` (1 or 10, any positive integer), committed in a fresh repository. */
export function sizedProject(scale: number): SizedProject {
  // Spelled as the hook spells it: a temporary folder reached through a link (macOS /var) would read as outside the project.
  const top = realpathSync(mkdtempSync(join(tmpdir(), `coherence-sized-${String(scale).padStart(3, "0")}-`)));
  const root = join(top, "proj");
  const other = join(top, "other");
  const concepts = Array.from({ length: 10 * scale }, (_, n) => ({ name: `gizmo ${n}`, definition: `the fixture's gizmo number ${n}` }));
  const files: Record<string, string> = {
    ".claude/settings.json": "{}\n",
    "proj/.claude/settings.json": "{}\n",
    // What install writes: the transient state under .coherence is no file of the project, git lists none of it.
    "proj/.coherence/.gitignore": "/*\n!/.gitignore\n!/journal/\n!/runs/\n!/work/\n!/hooks/\n",
    "proj/coherence.config.json": JSON.stringify({ name: "sized", lexicon: "lexicon.json" }) + "\n",
    "proj/lexicon.json": JSON.stringify({ project: "sized", concepts }, null, 2) + "\n",
    "proj/Sized.spec.md": spec("Sized"),
    "proj/README.md": "# Sized\n\n" + notes(20, 0),
    "proj/src/big/Big.spec.md": spec("Big"),
  };
  const components: string[] = [];
  for (let i = 0; i < 3 * scale; i++) {
    const folder = `src/c${i}`;
    components.push(folder);
    files[`proj/${folder}/C${i}.spec.md`] = spec(`C${i}`, i);
    files[`proj/${folder}/C${i}.practice.md`] = practice(i);
    files[`proj/${folder}/m.ts`] = source(i);
    files[`proj/${folder}/secret.ts`] = secret(i);
    files[`proj/${folder}/README.md`] = `# Notes on c${i}\n\n` + notes(12, i);
  }
  for (let k = 0; k < 6 * scale; k++) files[`proj/src/big/part-${k}.md`] = `# Part ${k}\n\n` + notes(30, k);
  for (let k = 0; k < 4 * scale; k++) {
    files[`proj/docs/note-${k}.md`] = `# Note ${k}\n\n` + notes(40, k);
    files[`other/note-${k}.md`] = notes(40, k);
  }
  for (let k = 0; k < 2 * scale; k++) {
    const day = `2026-01-${String((k % 28) + 1).padStart(2, "0")}`;
    // History grows in each file as well as in the number of files: 3 × scale runs and 5 × scale records each.
    files[`proj/.coherence/runs/h${k}.jsonl`] = Array.from({ length: 3 * scale }, (_, r) => run(`${day}T${String(r % 24).padStart(2, "0")}:${String(r).padStart(2, "0")}:00.000Z`, (k + r) % (3 * scale)) + "\n").join("");
    files[`proj/.coherence/journal/h${k}.jsonl`] = Array.from({ length: 5 * scale }, (_, r) => decision(`${day}T${String(r % 24).padStart(2, "0")}:${String(r).padStart(2, "0")}:30.000Z`, k * 100 + r) + "\n").join("");
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(top, path)), { recursive: true });
    writeFileSync(join(top, path), text);
  }
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: top, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return { top, root, other, components };
}
