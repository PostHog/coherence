/**
 * Drafting specs from the boundaries a repository already declares by machine.
 *
 * A source is a tool's own declaration file. Each source reads its file into
 * BoundaryModule records, and one renderer turns a record into a draft spec,
 * so a second source (an .importlinter file, Nx project.json, CODEOWNERS)
 * adds a reader and nothing else. A source is the language plugin's that
 * knows the tool (its boundaries slot, reached through the registry): tach's
 * is the Python plugin's (plugins/python/tach-boundaries.ts), which reads
 * tach.toml's [[modules]] and [[interfaces]], and the product.yaml beside a
 * module for its owners.
 *
 * The mapping, and where Coherence's grammar stops:
 *   module         -> a component: the folder its dotted path names
 *   depends_on     -> not reliance, which is computed and never declared, but
 *                     a totality oracle bullet whose sentence lists the
 *                     declared modules and whose via: test runs tach check
 *   interfaces     -> a totality oracle bullet (outside code imports the
 *                     module only through what it exposes), and one
 *                     chokepoint bullet per exposed path, the path as the
 *                     chokepoint, the protected internal a placeholder, and
 *                     from: outside the component, since tach checks only
 *                     imports from other modules and the module's own code
 *                     may use its internals
 *   owners         -> the header's owners: line; the product.yaml name
 *                     stays in the intent
 *   layer, utility, visibility -> no slot; reported as notes
 *
 * Drafts are printed; written only where the folder exists and holds no
 * spec. Every slot only a human can fill stays a placeholder, as scaffold
 * invariant leaves it.
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { INVARIANTS_SECTION } from "../spec/grammar.ts";
import { loadSeed } from "../spec/seed.ts";
import { componentDir, renderInvariant, ScaffoldError, specFileName, specsIn } from "./scaffold.ts";

/** One boundary a source declares, in the source's terms resolved against the tree. */
export interface BoundaryModule {
  /** The module as the source names it (tach: the dotted path). */
  id: string;
  /** Where it was declared, for the intent and the notes. */
  declaredAt: string;
  /** The component folder, relative to the project root, "/" separated; undefined when it lies outside the project. */
  folder: string | undefined;
  /** Whether that folder exists on disk. */
  exists: boolean;
  /** The modules it may import; undefined when the source leaves it unconstrained. */
  dependsOn: string[] | undefined;
  /** What outside code may import, each as written and as a chokepoint where one can be named. */
  exposes: Exposure[] | undefined;
  owners: { name: string | undefined; owners: string[]; file: string } | undefined;
  /** What the source declares that the spec grammar has no slot for. */
  notes: string[];
}

export interface Exposure {
  /** The pattern as the source writes it. */
  pattern: string;
  /** The pattern read as a dotted path below the module, or undefined when it is a pattern no path names. */
  path: string | undefined;
  /** The chokepoint value: a package folder, a module file, or a symbol in its file; undefined when not on disk. */
  chokepoint: string | undefined;
}

export interface Draft {
  module: BoundaryModule;
  /** The spec file's path relative to the project root, when the module has a folder in it. */
  specPath: string | undefined;
  text: string;
}

/**
 * A tool whose declaration file a draft reads, as the language plugin that
 * knows the tool supplies it (its boundaries slot): tach's is the Python
 * plugin's.
 */
export interface BoundarySource {
  /** The source's name, as scaffold import takes it. */
  name: string;
  /** The declaration file, found at or above the project root. */
  file: string;
  /** The command that checks what the file declares, as a drafted bullet's over: line names it ("tach check"). */
  checker: string;
  /** The file read into one record per module; a malformed file is refused with its line. */
  read(projectRoot: string, file: string): BoundaryModule[];
  /** The test a drafted bullet's via: line names for one module's check. */
  testName(check: "dependencies" | "interface", id: string): string;
  /** The test file the drafts' via: tests name, for a human to place. */
  tests(modules: readonly BoundaryModule[]): string;
}

const posix = (path: string): string => path.split(sep).join("/");

/** The nearest file of this name at or above the project root. */
export function findUpward(root: string, name: string): string | undefined {
  let dir = resolve(root);
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** The name and owners a product.yaml declares: `name: X` and `owners:` as a block or inline list. */
export function readOwners(text: string): { name: string | undefined; owners: string[] } {
  const unquote = (s: string): string => s.trim().replace(/^(["'])(.*)\1$/, "$2");
  let name: string | undefined;
  const owners: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!.replace(/\s+#.*$/, "");
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw);
    if (top === null) continue;
    if (top[1] === "name" && top[2] !== "") name = unquote(top[2]!);
    if (top[1] !== "owners") continue;
    const inline = top[2]!.trim();
    if (inline.startsWith("[")) {
      for (const item of inline.replace(/^\[|\]$/g, "").split(",")) if (unquote(item) !== "") owners.push(unquote(item));
      continue;
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      const item = /^\s+-\s+(.+?)\s*$/.exec(lines[j]!.replace(/\s+#.*$/, ""));
      if (item === null) {
        if (/^\S/.test(lines[j]!)) break;
        continue;
      }
      owners.push(unquote(item[1]!));
    }
  }
  return { name, owners };
}

/** Fill named slots of a scaffolded bullet, leaving every other placeholder as scaffold invariant prints it. */
function fill(bullet: string, values: Record<string, string>): string {
  let out = bullet;
  for (const [key, value] of Object.entries(values)) out = out.replace(new RegExp(`^  ${key}: .*$`, "m"), `  ${key}: ${value}`);
  return out;
}

const seed = loadSeed();

/** One draft spec for a boundary module: its folder, intent, and a bullet per declared boundary. */
export function renderDraft(projectRoot: string, m: BoundaryModule, from: BoundarySource): Draft {
  const source = from.name;
  const where = m.folder ?? `<the folder of ${m.id}, outside this project>`;
  const specPath = m.folder === undefined ? undefined : posix(join(m.folder, specFileName(m.folder, projectRoot)));
  const title = specPath === undefined ? m.id : specFileName(m.folder!, projectRoot).replace(/\.spec\.md$/, "");
  const named = m.owners?.name === undefined ? "" : `${m.owners.name}, `;
  const intent = `<what ${m.id} is for, in one line> ${named}drafted from ${source} module ${m.id} (${m.declaredAt}).`;
  // Owners are declared in the header, never folded into the intent; a product.yaml that lists none leaves the line out.
  const owners = m.owners === undefined || m.owners.owners.length === 0 ? "" : `owners: ${m.owners.owners.join(", ")}\n`;
  const bullets: string[] = [];
  const bullet = (name: string, sentence: string, form: "chokepoint" | "totality oracle", values: Record<string, string>): void => {
    const { bullet: b } = renderInvariant(seed, { sentence, name, kinds: undefined, form });
    bullets.push(fill(b, values));
  };
  if (m.dependsOn !== undefined) {
    const list = m.dependsOn.length === 0 ? "none" : m.dependsOn.join(", ");
    bullet(
      "declared dependencies only",
      `Code in ${where} imports another ${source} module only where ${m.declaredAt.replace(/:\d+$/, "")} declares it: ${list}.`,
      "totality oracle",
      { over: `every import from ${where} into another ${source} module that ${from.checker} reads`, via: from.testName("dependencies", m.id) },
    );
  }
  if (m.exposes !== undefined) {
    const surface = m.exposes.map((e) => e.path ?? e.pattern).join(", ");
    bullet(
      "reached only through its interface",
      `Code outside ${where} imports it only through ${surface}.`,
      "totality oracle",
      { over: `every import of ${where} from another ${source} module that ${from.checker} reads`, via: from.testName("interface", m.id) },
    );
    for (const e of m.exposes) {
      const label = e.path ?? e.pattern;
      const chokepoint = e.chokepoint ?? `<the module or symbol '${e.pattern}' names under ${where}; ${e.path === undefined ? "a pattern names no single path" : "not found on disk"}>`;
      bullet(`internals only through ${label}`, `Code outside ${where} reaches the internal it protects only through ${label}.`, "chokepoint", {
        protects: `<an internal of ${where} that code outside it reaches only through ${label}>`,
        chokepoint,
        // A boundary checker checks only imports from other modules: the module's own references are exempt, and reported as such.
        from: "outside the component",
      });
    }
  }
  const text = `# ${title}\n\n${intent}\n${owners}\n## ${INVARIANTS_SECTION}\n${bullets.join("")}`;
  return { module: m, specPath, text };
}

export interface WriteResult {
  wrote: string[];
  skipped: { module: string; because: string }[];
}

/** Write each draft where its folder exists and holds no spec; every other draft is skipped with why. Never overwrites. */
export function writeDrafts(projectRoot: string, drafts: readonly Draft[]): WriteResult {
  const result: WriteResult = { wrote: [], skipped: [] };
  for (const d of drafts) {
    const m = d.module;
    if (m.folder === undefined || d.specPath === undefined) {
      result.skipped.push({ module: m.id, because: "its folder is outside the project" });
      continue;
    }
    if (!m.exists) {
      result.skipped.push({ module: m.id, because: `${m.folder} is no folder on disk` });
      continue;
    }
    const dir = componentDir(projectRoot, m.folder);
    const existing = specsIn(dir);
    if (existing.length > 0) {
      result.skipped.push({ module: m.id, because: `${m.folder} already holds ${existing.join(", ")}` });
      continue;
    }
    const path = join(dir, specFileName(m.folder, projectRoot));
    writeFileSync(path, d.text, { encoding: "utf8", flag: "wx" });
    result.wrote.push(d.specPath);
  }
  return result;
}
