/**
 * One synthetic project at any size, for the hooks' size-independence tests:
 * the same shape at 1× and at 10×, with ten times the components, the
 * practices, the files and the lines. Every component is the same size, so a
 * hook whose work is its own component's does the same work at both sizes,
 * and one whose work grows with the project does not.
 *
 *   <top>/                      a git repository whose host settings sit here
 *     .claude/settings.json
 *     other/note-<k>.md         a folder that is no project, 4 × scale files
 *     proj/                     the project, with its own host settings
 *       .claude/settings.json
 *       coherence.config.json
 *       src/c<i>/C<i>.spec.md   3 × scale components, each with a chokepoint
 *       src/c<i>/C<i>.practice.md     invariant and a practice fired by
 *       src/c<i>/m.ts                 `deploy<i>`, its source and its notes;
 *       src/c<i>/secret.ts            m.ts spells no chokepoint name, so an
 *                                     edit to it touches no invariant
 *       src/c<i>/README.md
 *       docs/note-<k>.md        4 × scale notes in no component
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
  /** The components, project-relative. */
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

function spec(i: number): string {
  return [
    `# C${i}`,
    "",
    `Component ${i} of the sized fixture.`,
    "",
    "## invariants",
    `- secret ${i} leaves through its seal: SECRET_${i} is read only by seal${i}.`,
    `  protects: SECRET_${i}`,
    `  chokepoint: seal${i}`,
    "  because: a fixture",
    "  kinds: none",
    "",
  ].join("\n");
}

function practice(i: number): string {
  return [`- release ${i}: A release is cut only from a green line.`, `  when: command deploy${i}`, "  step: run the checks", "  step: cut the release", "  reach: internal", "  because: fixture", ""].join("\n");
}

/** The project at `scale` (1 or 10, any positive integer), committed in a fresh repository. */
export function sizedProject(scale: number): SizedProject {
  // Spelled as the hook spells it: a temporary folder reached through a link (macOS /var) would read as outside the project.
  const top = realpathSync(mkdtempSync(join(tmpdir(), `coherence-sized-${scale}-`)));
  const root = join(top, "proj");
  const other = join(top, "other");
  const files: Record<string, string> = {
    ".claude/settings.json": "{}\n",
    "proj/.claude/settings.json": "{}\n",
    "proj/coherence.config.json": JSON.stringify({ name: "sized" }) + "\n",
  };
  const components: string[] = [];
  for (let i = 0; i < 3 * scale; i++) {
    const folder = `src/c${i}`;
    components.push(folder);
    files[`proj/${folder}/C${i}.spec.md`] = spec(i);
    files[`proj/${folder}/C${i}.practice.md`] = practice(i);
    files[`proj/${folder}/m.ts`] = source(i);
    files[`proj/${folder}/secret.ts`] = secret(i);
    files[`proj/${folder}/README.md`] = `# Notes on c${i}\n\n` + notes(12, i);
  }
  for (let k = 0; k < 4 * scale; k++) {
    files[`proj/docs/note-${k}.md`] = `# Note ${k}\n\n` + notes(40, k);
    files[`other/note-${k}.md`] = notes(40, k);
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
