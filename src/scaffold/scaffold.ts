/**
 * Scaffold: the complete shape as the cheapest thing to produce.
 *
 * A folder named for a component is confined to the project root: it comes
 * from a command line or from spec text an agent wrote, and neither may reach
 * above the tree it names.
 *
 * Two shapes. A component is a folder plus a spec with its intent and an
 * empty invariants section. An invariant is one bullet with every slot
 * present as a placeholder, and beside it the decomposition checklist for
 * the kinds it names, each shape as a declare-or-dismiss line. The agent
 * fills slots instead of recalling rules; the parser treats an unfilled
 * placeholder as absent, so what is written first still parses.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { INVARIANTS_SECTION, KEYS, type Key } from "../spec/grammar.ts";
import { SPEC_SUFFIX } from "../spec/model.ts";
import { applicableShapes, type Seed, type Shape } from "../spec/seed.ts";

export class ScaffoldError extends Error {}

/** The project's own name for the entry component: coherence.config.json's name, then package.json's, then the folder's. */
function entryName(root: string): string {
  for (const file of ["coherence.config.json", "package.json"]) {
    try {
      const parsed = JSON.parse(readFileSync(join(root, file), "utf8")) as { name?: unknown };
      if (typeof parsed.name === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(parsed.name)) return parsed.name;
    } catch {
      // absent or unreadable: try the next source
    }
  }
  return basename(root);
}

/** The spec file name for a folder: <Name>.spec.md. A component is named for its folder; the entry
 *  component is named for the project, never for the checkout folder (a worktree is a hash). */
export function specFileName(folder: string, root: string): string {
  const absolute = resolve(root, folder);
  const name = absolute === resolve(root) ? entryName(resolve(root)) : basename(absolute);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${SPEC_SUFFIX}`;
}

export function specsIn(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => name.endsWith(SPEC_SUFFIX)).sort();
}

export interface ComponentScaffold {
  path: string;
  text: string;
}

export function renderComponent(name: string, intent: string): string {
  return `# ${name}\n\n${intent.trim()}\n\n## ${INVARIANTS_SECTION}\n`;
}

/**
 * The absolute path of a folder named relative to the project root, refused
 * when it reaches outside that root. The folder arrives from a command line
 * or from spec text an agent wrote, neither of which is trusted to stay
 * inside the tree it names. Internal: componentDir is the one door, so the
 * confinement cannot be skipped by a caller that resolves a path itself.
 */
function confineToRoot(root: string, folder: string): string {
  const dir = resolve(root, folder);
  const rel = relative(resolve(root), dir);
  if (rel === ".." || rel.startsWith(".." + "/") || rel.startsWith(".." + "\\") || isAbsolute(rel)) {
    throw new ScaffoldError(`"${folder}" is outside the project root; a component lives under the project it belongs to`);
  }
  return dir;
}

/**
 * Where a component named relative to the project root lives on disk. Every
 * path the scaffold builds from a folder a caller named comes from here, so
 * the confinement above has one site and no caller can route around it.
 */
export function componentDir(root: string, folder: string): string {
  return confineToRoot(root, folder);
}

/** Create the folder if needed and its spec; refused when the folder already holds one, or when it is not under the project root. */
export function scaffoldComponent(root: string, folder: string, intent: string): ComponentScaffold {
  if (intent.trim() === "") throw new ScaffoldError("a component needs its intent: one line saying what it is for");
  const dir = componentDir(root, folder);
  const existing = specsIn(dir);
  if (existing.length > 0) throw new ScaffoldError(`${folder} already holds a spec: ${existing.join(", ")}`);
  const file = specFileName(folder, root);
  const path = join(dir, file);
  const nameOnly = file.slice(0, -SPEC_SUFFIX.length);
  const text = renderComponent(nameOnly, intent);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, text, "utf8");
  return { path, text };
}

export type Form = "chokepoint" | "totality oracle";

export interface InvariantOptions {
  sentence: string;
  name?: string | undefined;
  /** Kinds the requirement names; undefined prints a placeholder, "none" an examined empty set. */
  kinds: string[] | "none" | undefined;
  form: Form;
  /** A declared crossing supplied now; absent keeps the scaffold placeholder. */
  crossing?: { from: string; to: string } | undefined;
}

export interface InvariantScaffold {
  bullet: string;
  /** The applicable shapes, for the guidance printed beside the bullet. */
  shapes: Shape[];
}

const PLACEHOLDERS: Record<Key, string> = {
  protects: "<the symbol or module every reference reaches only through the chokepoint>",
  chokepoint: "<the one symbol every reference to the protected thing passes through>",
  over: "<the whole set the detector checks; a spot check is not enforcement>",
  via: "<the test that fails when the invariant is broken>",
  because: "<why this exists; what it protects against>",
  crossing: "<trust level> -> <trust level>",
  refuted: "<what was broken> -> <what was seen> (<date>)",
  kinds: "<a, b: the kinds of thing protected, or none>",
  checklist: "",
};

/** The bullet, every slot present, checklist lines for the applicable shapes. */
export function renderInvariant(seed: Seed, options: InvariantOptions): InvariantScaffold {
  const sentence = options.sentence.trim();
  if (sentence === "") throw new ScaffoldError("an invariant needs its sentence: the abstract behavioral requirement");
  if (options.kinds !== undefined && options.kinds !== "none") {
    const unknown = options.kinds.filter((kind) => !Object.hasOwn(seed.kinds, kind));
    if (unknown.length > 0) {
      throw new ScaffoldError(`unknown kind ${unknown.join(", ")}; the kinds are ${Object.keys(seed.kinds).join(", ")}`);
    }
  }
  const shapes = options.kinds === undefined || options.kinds === "none" ? [] : applicableShapes(seed, options.kinds);
  const lines: string[] = [`- ${options.name ?? "<name>"}: ${sentence}`];
  const formKeys: readonly Key[] = options.form === "chokepoint" ? ["protects", "chokepoint"] : ["over", "via"];
  for (const key of KEYS) {
    if (key === "protects" || key === "chokepoint" || key === "over" || key === "via") {
      if (!formKeys.includes(key)) continue;
      lines.push(`  ${key}: ${PLACEHOLDERS[key]}`);
      continue;
    }
    if (key === "crossing") {
      const value = options.crossing === undefined ? PLACEHOLDERS.crossing : `${options.crossing.from} -> ${options.crossing.to}`;
      lines.push(`  crossing: ${value}`);
      continue;
    }
    if (key === "kinds") {
      const value = options.kinds === undefined ? PLACEHOLDERS.kinds : options.kinds === "none" ? "none" : options.kinds.join(", ");
      lines.push(`  kinds: ${value}`);
      continue;
    }
    if (key === "checklist") {
      for (const shape of shapes) lines.push(`  checklist: ${shape.shape} declared as <invariant name> | dismissed: <reason>`);
      continue;
    }
    lines.push(`  ${key}: ${PLACEHOLDERS[key]}`);
  }
  return { bullet: lines.join("\n") + "\n", shapes };
}


/** Parse the same two-ended crossing shape the spec grammar accepts. */
export function parseCrossing(text: string): { from: string; to: string } {
  const parts = text.split(/\s*(?:->|→)\s*/);
  const from = parts[0]?.trim() ?? "";
  const to = parts[1]?.trim() ?? "";
  if (parts.length !== 2 || from === "" || to === "") {
    throw new ScaffoldError('--crossing reads "<trust level> -> <trust level>"');
  }
  return { from, to };
}

/** What the agent needs in view while filling the checklist: each shape's sentence and when it applies. */
export function renderGuidance(shapes: readonly Shape[]): string {
  if (shapes.length === 0) return "";
  const lines = [`${shapes.length} checklist shape${shapes.length === 1 ? "" : "s"} apply; declare each as an invariant or dismiss it with a reason:`];
  for (const shape of shapes) {
    lines.push(`  ${shape.shape}: ${shape.sentence}`);
    lines.push(`    applies when ${shape.appliesWhen}`);
  }
  return lines.join("\n") + "\n";
}

/** Append a bullet at the end of the spec's invariants section, adding the section when absent. */
export function appendInvariant(specPath: string, bullet: string): string {
  const text = readFileSync(specPath, "utf8");
  const lines = text.split(/\r?\n/);
  const header = new RegExp(`^##\\s+${INVARIANTS_SECTION}\\s*$`, "i");
  const start = lines.findIndex((line) => header.test(line));
  if (start === -1) {
    const body = text.endsWith("\n") || text === "" ? text : `${text}\n`;
    const out = `${body}\n## ${INVARIANTS_SECTION}\n${bullet}`;
    writeFileSync(specPath, out, "utf8");
    return out;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##?\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  // Trim the blank lines that close the section, then put the bullet and one blank line back.
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === "") insertAt -= 1;
  const bulletLines = bullet.replace(/\n$/, "").split("\n");
  const tail = end < lines.length ? [""] : [];
  const out = [...lines.slice(0, insertAt), ...bulletLines, ...tail, ...lines.slice(end)].join("\n");
  const final = out.endsWith("\n") ? out : `${out}\n`;
  writeFileSync(specPath, final, "utf8");
  return final;
}
