/**
 * Drafting specs from the boundaries a repository already declares by machine.
 *
 * A source is a tool's own declaration file. Each source reads its file into
 * BoundaryModule records, and one renderer turns a record into a draft spec,
 * so a second source (an .importlinter file, Nx project.json, CODEOWNERS)
 * adds a reader and nothing else. tach is the first: tach.toml's [[modules]]
 * and [[interfaces]], and the product.yaml beside a module for its owners.
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

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { INVARIANTS_SECTION } from "../spec/grammar.ts";
import { loadSeed } from "../spec/seed.ts";
import { componentDir, renderInvariant, ScaffoldError, specFileName, specsIn } from "./scaffold.ts";
import { lineOf, parseToml, TomlError, type TomlTable, type TomlValue } from "../adapters/toml.ts";

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

function strings(value: TomlValue | undefined, file: string, line: number, what: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TomlError(file, line, `${what} must be an array`);
  return value.map((item) => {
    if (typeof item === "string") return item;
    // tach accepts a dependency as { path = "x", deprecated = true }.
    if (typeof item === "object" && !Array.isArray(item) && typeof item.path === "string") return item.path;
    throw new TomlError(file, line, `${what} holds ${JSON.stringify(item)}, not a string`);
  });
}

function tables(value: TomlValue | undefined, file: string, what: string): TomlTable[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TomlError(file, 1, `${what} must be an array of tables ([[${what}]])`);
  return value.map((item) => {
    if (typeof item !== "object" || Array.isArray(item)) throw new TomlError(file, 1, `${what} must be an array of tables ([[${what}]])`);
    return item;
  });
}

/** A tach pattern read as a dotted path when it is one: escaped dots, an optional trailing .* and nothing else of a regex. */
export function literalPath(pattern: string): string | undefined {
  const body = pattern.replace(/(\\\.)?\.\*$/, "").replace(/\\\./g, "\u0000");
  if (/[\\.*+?()[\]{}|^$]/.test(body)) return undefined;
  const path = body.replace(/\u0000/g, ".");
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path) ? path : undefined;
}

/** A dotted path below a module folder as a chokepoint the spec grammar names: a package folder, a module file, or a symbol in its file. */
function chokepointOf(projectRoot: string, moduleDir: string, path: string): string | undefined {
  const parts = path.split(".");
  let dir = moduleDir;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    const rest = parts.slice(i + 1);
    const asDir = join(dir, part);
    const asFile = join(dir, `${part}.py`);
    if (existsSync(asDir) && statSync(asDir).isDirectory()) {
      dir = asDir;
      continue;
    }
    if (existsSync(asFile)) {
      const file = posix(relative(projectRoot, asFile));
      if (rest.length === 0) return file;
      if (rest.length === 1) return `${rest[0]} in ${file}`;
      return undefined;
    }
    // A symbol a package's __init__.py defines.
    const init = join(dir, "__init__.py");
    if (rest.length === 0 && i > 0 && existsSync(init)) return `${part} in ${posix(relative(projectRoot, init))}`;
    return undefined;
  }
  return `${posix(relative(projectRoot, dir))}/`;
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

/** tach.toml read into one record per [[modules]] entry. A malformed file is refused with its line. */
export function readTach(projectRoot: string, file: string): BoundaryModule[] {
  const text = readFileSync(file, "utf8");
  const shown = posix(relative(projectRoot, file)) || "tach.toml";
  let doc: TomlTable;
  try {
    doc = parseToml(text, shown);
  } catch (error) {
    if (error instanceof TomlError) throw new ScaffoldError(`${error.message}; tach.toml could not be read, so nothing is drafted`);
    throw error;
  }
  const tachDir = dirname(file);
  try {
    const sourceRoots = strings(doc.source_roots, shown, 1, "source_roots") ?? ["."];
    const interfaces = tables(doc.interfaces, shown, "interfaces").map((t) => {
      const line = lineOf(t) ?? 1;
      const expose = strings(t.expose, shown, line, "expose");
      const from = strings(t.from, shown, line, "from");
      if (expose === undefined || from === undefined) throw new TomlError(shown, line, "an [[interfaces]] entry needs expose and from");
      const matchers = from.map((f) => {
        try {
          return new RegExp(`^(?:${f})$`);
        } catch {
          throw new TomlError(shown, line, `from holds ${JSON.stringify(f)}, which is no pattern`);
        }
      });
      return { expose, from: matchers, line };
    });
    const modules = tables(doc.modules, shown, "modules");
    return modules.map((t) => {
      const line = lineOf(t) ?? 1;
      if (typeof t.path !== "string" || t.path === "") throw new TomlError(shown, line, "a [[modules]] entry needs path = \"<dotted.module>\"");
      const id = t.path;
      const notes: string[] = [];
      const declaredAt = `${shown}:${line}`;
      if (typeof t.layer === "string") notes.push(`layer = "${t.layer}": the spec grammar has no layers; a layer rule is a relationship invariant in the folder above`);
      if (t.utility === true) notes.push("utility = true: any module may import it undeclared; no spec slot says so");
      if (t.visibility !== undefined) notes.push("visibility: which modules may depend on it has no spec slot");
      if (t.unchecked === true) notes.push("unchecked = true: tach does not check its imports, so its dependency bullet has no detector");
      const dependsOn = strings(t.depends_on, shown, line, "depends_on");
      const applying = interfaces.filter((i) => i.from.some((m) => m.test(id)));
      const segments = id === "<root>" ? [] : id.split(".");
      const candidates = sourceRoots.map((r) => join(tachDir, r, ...segments));
      const abs = candidates.find((c) => existsSync(c) && statSync(c).isDirectory()) ?? candidates[0]!;
      const rel = posix(relative(resolve(projectRoot), abs));
      const inside = !(rel === ".." || rel.startsWith("../") || /^[A-Za-z]:|^\//.test(rel));
      const exists = existsSync(abs) && statSync(abs).isDirectory();
      if (!exists && existsSync(`${abs}.py`)) notes.push(`${posix(relative(projectRoot, `${abs}.py`))} is a module file, and a component is a folder`);
      const exposes =
        applying.length === 0
          ? undefined
          : [...new Set(applying.flatMap((i) => i.expose))].map((pattern): Exposure => {
              const path = literalPath(pattern);
              return { pattern, path, chokepoint: path === undefined || !exists ? undefined : chokepointOf(resolve(projectRoot), abs, path) };
            });
      const yaml = join(abs, "product.yaml");
      const owners = exists && existsSync(yaml) ? { ...readOwners(readFileSync(yaml, "utf8")), file: posix(relative(projectRoot, yaml)) } : undefined;
      return { id, declaredAt, folder: inside ? rel || "." : undefined, exists, dependsOn, exposes, owners, notes };
    });
  } catch (error) {
    if (error instanceof TomlError) throw new ScaffoldError(`${error.message}; tach.toml could not be read, so nothing is drafted`);
    throw error;
  }
}

/** A test function name pytest selects with -k: the module's dotted path, made an identifier. */
export function testName(check: "dependencies" | "interface", id: string): string {
  return `test_tach_${check}_${id.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

/** Fill named slots of a scaffolded bullet, leaving every other placeholder as scaffold invariant prints it. */
function fill(bullet: string, values: Record<string, string>): string {
  let out = bullet;
  for (const [key, value] of Object.entries(values)) out = out.replace(new RegExp(`^  ${key}: .*$`, "m"), `  ${key}: ${value}`);
  return out;
}

const seed = loadSeed();

/** One draft spec for a boundary module: its folder, intent, and a bullet per declared boundary. */
export function renderDraft(projectRoot: string, m: BoundaryModule, source: string): Draft {
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
      { over: `every import from ${where} into another ${source} module that tach check reads`, via: testName("dependencies", m.id) },
    );
  }
  if (m.exposes !== undefined) {
    const surface = m.exposes.map((e) => e.path ?? e.pattern).join(", ");
    bullet(
      "reached only through its interface",
      `Code outside ${where} imports it only through ${surface}.`,
      "totality oracle",
      { over: `every import of ${where} from another ${source} module that tach check reads`, via: testName("interface", m.id) },
    );
    for (const e of m.exposes) {
      const label = e.path ?? e.pattern;
      const chokepoint = e.chokepoint ?? `<the module or symbol '${e.pattern}' names under ${where}; ${e.path === undefined ? "a pattern names no single path" : "not found on disk"}>`;
      bullet(`internals only through ${label}`, `Code outside ${where} reaches the internal it protects only through ${label}.`, "chokepoint", {
        protects: `<an internal of ${where} that code outside it reaches only through ${label}>`,
        chokepoint,
        // tach checks only imports from other modules: the module's own references are exempt, and reported as such.
        from: "outside the component",
      });
    }
  }
  const text = `# ${title}\n\n${intent}\n${owners}\n## ${INVARIANTS_SECTION}\n${bullets.join("")}`;
  return { module: m, specPath, text };
}

/** The pytest file the drafts' via: tests name. tach check has no per-module flag, so each test filters its JSON report to one module. */
export function renderTachTests(ids: readonly string[], withInterface: ReadonlySet<string>, withDependencies: ReadonlySet<string>): string {
  const lines = [
    "# The via: tests the drafted specs name. tach check has no per-module flag, so tach runs once",
    "# (--output json) and each test keeps the diagnostics of one module. Run tach as CI does.",
    "import functools",
    "import json",
    "import subprocess",
    "",
    "",
    "@functools.cache",
    "def _report():",
    '    done = subprocess.run(["tach", "check", "--dependencies", "--interfaces", "--output", "json"], capture_output=True, text=True)',
    '    return json.loads(done.stdout or "[]")',
    "",
    "",
    "def _violations(check, module):",
    "    found = []",
    "    for item in _report():",
    '        located = item.get("Located") if isinstance(item, dict) else None',
    '        codes = (located or {}).get("details", {}).get("Code")',
    "        if not isinstance(codes, dict):",
    "            continue",
    "        for code, detail in codes.items():",
    '            private = code == "PrivateDependency"',
    '            if check == "interface" and private and detail.get("definition_module") == module:',
    '                found.append(f"{located[\'file_path\']}:{located[\'line_number\']}: {detail.get(\'dependency\')}")',
    '            if check == "dependencies" and not private and detail.get("usage_module") == module:',
    '                found.append(f"{located[\'file_path\']}:{located[\'line_number\']}: {code} {detail.get(\'dependency\')}")',
    "    return found",
  ];
  for (const id of ids) {
    if (withDependencies.has(id)) lines.push("", "", `def ${testName("dependencies", id)}():`, `    assert _violations("dependencies", ${JSON.stringify(id)}) == []`);
    if (withInterface.has(id)) lines.push("", "", `def ${testName("interface", id)}():`, `    assert _violations("interface", ${JSON.stringify(id)}) == []`);
  }
  return lines.join("\n") + "\n";
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
