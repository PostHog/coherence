/**
 * tach as a boundary source for scaffold import and adoption
 * (src/scaffold/boundaries.ts): tach.toml's [[modules]] and [[interfaces]]
 * read into one record per module, the product.yaml beside a module for its
 * owners, and the pytest file whose tests the drafts' via: lines name.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tomlLineOf as lineOf, parseToml, TomlError, type TomlTable, type TomlValue } from "../../src/plugins/api.ts";
import { readOwners, type BoundaryModule, type BoundarySource, type Exposure } from "../../src/plugins/api.ts";
import { ScaffoldError } from "../../src/plugins/api.ts";

const posix = (path: string): string => path.split(sep).join("/");

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

/** tach, as the Python plugin's boundaries slot supplies it. */
export const TACH_BOUNDARIES: BoundarySource = {
  name: "tach",
  file: "tach.toml",
  checker: "tach check",
  read: readTach,
  testName,
  tests: (modules) =>
    renderTachTests(
      modules.map((m) => m.id),
      new Set(modules.filter((m) => m.exposes !== undefined).map((m) => m.id)),
      new Set(modules.filter((m) => m.dependsOn !== undefined).map((m) => m.id)),
    ),
};
