// Python totality admission: concrete syntax and direct binding identity, never execution.
// This grade deliberately refuses dynamic domains and unknown lexical/import scopes.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { Node } from "web-tree-sitter";
import { grammarHandle, withTree } from "../adapters/tree-sitter.ts";
import { pythonImportCandidates } from "../derivation/derive.ts";
import type { Config } from "../types.ts";
import { isPyTestPath, NOISE_DIRS } from "./oracle-domain.ts";

const children = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
function walk(n: Node, visit: (n: Node) => void): void { visit(n); for (const c of children(n)) walk(c, visit); }
const directAssignment = (n: Node) => n.type === "assignment" && n.parent?.type === "expression_statement" && n.parent.parent?.type === "module";
function unparen(n: Node): Node {
  while (n.type === "parenthesized_expression" && children(n).length === 1) n = children(n)[0];
  return n;
}
function literal(n: Node): boolean {
  if (["integer", "float", "true", "false", "none"].includes(n.type)) return true;
  if (n.type === "string") return !n.text.match(/^[rbu]*f/i) && !children(n).some((c) => c.type === "interpolation");
  if (n.type === "unary_operator") return /^[+-]/.test(n.text) && children(n).every(literal);
  return ["tuple", "list", "set"].includes(n.type) && children(n).every(literal);
}
function hashableLiteral(n: Node): boolean {
  return literal(n) && (n.type === "tuple" ? children(n).every(hashableLiteral) : !["list", "set"].includes(n.type));
}

/** Binding targets, including conservative scope-wide shadows. Annotation names and
 * names being imported under a different alias do not themselves bind local names. */
function targets(n: Node): Node[] {
  if (["assignment", "augmented_assignment", "for_statement", "for_in_clause"].includes(n.type)) {
    const p = n.childForFieldName("left"); return p ? [p] : [];
  }
  if (["function_definition", "class_definition", "named_expression"].includes(n.type)) {
    const p = n.childForFieldName("name"); return p ? [p] : [];
  }
  if (n.type === "as_pattern") { const p = n.childForFieldName("alias"); return p ? [p] : []; }
  // Pattern matching binds names without an assignment node. Conservatively treating
  // every identifier in a pattern as a possible binding also refuses value patterns
  // whose finer distinction would require a separate Python scope resolver.
  if (n.type === "case_pattern") return [n];
  if (n.type === "parameters" || n.type === "lambda_parameters") return children(n).flatMap((p) => {
    if (["default_parameter", "typed_default_parameter"].includes(p.type)) { const q = p.childForFieldName("name"); return q ? [q] : []; }
    return p.type === "typed_parameter" ? children(p).filter((q) => q.type !== "type") : [p];
  });
  if (["delete_statement", "global_statement", "nonlocal_statement"].includes(n.type)) return children(n);
  if (["import_from_statement", "import_statement"].includes(n.type)) return n.childrenForFieldName("name").flatMap((p) => {
    if (p.type === "aliased_import") { const q = p.childForFieldName("alias"); return q ? [q] : []; }
    return p.type === "dotted_name" ? children(p).slice(0, 1) : [p];
  });
  return [];
}
function mentions(n: Node, name: string): boolean {
  let found = false; walk(n, (p) => { if (p.type === "identifier" && p.text === name) found = true; }); return found;
}
function unsafeBinding(root: Node, name: string, allowed: Set<number>, dict: boolean): boolean {
  let unsafe = false;
  walk(root, (n) => {
    if (!allowed.has(n.startIndex) && targets(n).some((p) => mentions(p, name))) unsafe = true;
    if (n.type === "wildcard_import") unsafe = true;
    // Direct mutation, deletion and reassignment are refused. Indirect mutation through
    // aliases/callees cannot be decided by this source grade and remains a stated limit.
    if (n.type === "call") {
      const fn = n.childForFieldName("function");
      if (fn?.type === "attribute" && fn.childForFieldName("object")?.text === name
        && !(dict && ["keys", "values", "items"].includes(fn.childForFieldName("attribute")?.text ?? ""))) unsafe = true;
    }
  });
  return unsafe;
}

/** Root-relative absolute imports and explicit relative imports use the derivation's
 * direct-module candidates, with filesystem collisions retained even outside the graph.
 * An alternate test-directory root or module/package prefix makes identity unknown. */
function importTarget(file: string, spec: string, files: Set<string>): string | null {
  const candidates = pythonImportCandidates(file, spec), hits = candidates.filter((p) => files.has(p));
  if (hits.length !== 1) return null;
  const target = hits[0];
  if (!spec.startsWith(".")) {
    const localBase = join(dirname(file), spec.replaceAll(".", "/"));
    if ([`${localBase}.py`, `${localBase}/__init__.py`].some((p) => p !== target && files.has(p))) return null;
  }
  const folders = dirname(target).split("/").filter((p) => p !== ".");
  if (target.endsWith("/__init__.py")) folders.pop();
  for (let i = 1; i <= folders.length; i++) if (files.has(`${folders.slice(0, i).join("/")}.py`)) return null;
  return target;
}
function imports(root: Node, file: string, domain: string, name: string, files: Set<string>): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const n of children(root)) {
    if (n.type !== "import_from_statement") continue;
    const spec = n.childForFieldName("module_name")?.text;
    if (!spec || importTarget(file, spec, files) !== domain) continue;
    for (const binding of n.childrenForFieldName("name")) {
      const imported = binding.type === "aliased_import" ? binding.childForFieldName("name") : binding;
      const alias = binding.type === "aliased_import" ? binding.childForFieldName("alias")?.text : binding.text;
      if (imported?.text === name && alias) {
        // The allowed location identifies an entire import statement. Check all its
        // bindings before permitting it: `DOMAIN, OTHER as DOMAIN` names a different
        // object at runtime despite containing a correct import of the authored name.
        if (result.has(alias) || targets(n).filter((p) => mentions(p, alias)).length !== 1) result.set(alias, new Set());
        else result.set(alias, new Set([n.startIndex]));
      }
    }
  }
  return result;
}
function iteration(n: Node, alias: string, dict: boolean): boolean {
  n = unparen(n);
  if (n.type === "identifier") return n.text === alias;
  if (!dict || n.type !== "call") return false;
  const fn = n.childForFieldName("function"), args = n.childForFieldName("arguments");
  return fn?.type === "attribute" && fn.childForFieldName("object")?.text === alias
    && ["keys", "values", "items"].includes(fn.childForFieldName("attribute")?.text ?? "") && !!args && children(args).length === 0;
}
function oracleReading(root: Node, oracle: string, aliases: Map<string, Set<number>>, dict: boolean): { found: number; bound: boolean } {
  const functions: Node[] = [];
  walk(root, (n) => { if (n.type === "function_definition" && n.childForFieldName("name")?.text === oracle) functions.push(n); });
  if (functions.length !== 1) return { found: functions.length, bound: false };
  const fn = functions[0], parent = fn.parent;
  if (unsafeBinding(root, oracle, new Set([fn.startIndex]), false)) return { found: 1, bound: false };
  const directMethod = parent?.type === "block" && parent.parent?.type === "class_definition" && parent.parent.parent?.type === "module";
  if (parent?.type !== "module" && !directMethod || fn.children.some((n) => n?.text === "async")) return { found: 1, bound: false };
  const body = fn.childForFieldName("body");
  if (!body) return { found: 1, bound: false };
  let partial = false;
  walk(body, (n) => { if (["break_statement", "return_statement", "yield", "await", "function_definition", "class_definition"].includes(n.type)) partial = true; });
  if (partial) return { found: 1, bound: false };
  for (const [alias, allowed] of aliases) {
    if (!allowed.size || unsafeBinding(root, alias, allowed, dict)) continue;
    if (children(body).some((n) => n.type === "for_statement" && !n.children.some((c) => c?.text === "async")
      && !!n.childForFieldName("right") && iteration(n.childForFieldName("right")!, alias, dict))) return { found: 1, bound: true };
  }
  return { found: 1, bound: false };
}

export async function pythonTotalityFailure(cfg: Config, domainFile: string, name: string, oracle: string): Promise<string | null> {
  const absolute = resolve(cfg.root, domainFile), rel = relative(cfg.root, absolute);
  if (rel === ".." || rel.startsWith("../")) return "enumeration source escapes the repository";
  const { parser } = await grammarHandle("python");
  const sources = new Map<string, string>();
  let damaged = false;
  async function visit(dir: string): Promise<void> {
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { damaged = true; return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || NOISE_DIRS.has(e.name)) continue;
      const path = join(dir, e.name);
      if (e.isSymbolicLink()) { damaged = true; continue; }
      if (e.isDirectory()) { await visit(path); continue; }
      if (!e.name.endsWith(".py")) continue;
      try { sources.set(relative(cfg.root, path), await readFile(path, "utf8")); } catch { damaged = true; }
    }
  }
  await visit(cfg.root);
  if (damaged) return "Python source population is unreadable or linked; binding is UNKNOWN";
  const source = sources.get(domainFile);
  if (source === undefined) return `cannot read Python enumeration source ${domainFile}`;
  const domain = withTree(parser, source, { problem: "cannot parse Python enumeration source" as string | null, dict: false, assignment: -1 }, (tree) => {
    const found: Node[] = [];
    walk(tree.rootNode, (n) => { if (directAssignment(n) && n.childForFieldName("left")?.text === name) found.push(n); });
    if (tree.rootNode.hasError || found.length !== 1) return { problem: "requires one syntactically valid module-level Python assignment", dict: false, assignment: -1 };
    const assignment = found[0], raw = assignment.childForFieldName("right"), value = raw && unparen(raw);
    const dict = value?.type === "dictionary", members = value ? children(value) : [];
    const concrete = value && members.length && (dict ? members.every((n) => n.type === "pair" && !!n.childForFieldName("key") && hashableLiteral(n.childForFieldName("key")!) && !!n.childForFieldName("value") && literal(n.childForFieldName("value")!))
      : ["tuple", "list", "set"].includes(value.type) && members.every(value.type === "set" ? hashableLiteral : literal));
    if (!concrete) return { problem: "is not a supported nonempty Python literal tuple/list/set/dict (dynamic members, comprehensions and splats are unsupported)", dict: !!dict, assignment: -1 };
    if (unsafeBinding(tree.rootNode, name, new Set([assignment.startIndex]), !!dict)) return { problem: "Python domain is rebound, shadowed or directly mutated", dict: !!dict, assignment: -1 };
    return { problem: null, dict: !!dict, assignment: assignment.startIndex };
  });
  if (domain.problem) return `\`${name}\` ${domain.problem}`;
  const files = new Set(sources.keys());
  let found = 0, bound = false;
  for (const [file, text] of sources) {
    if (!isPyTestPath(file)) continue;
    withTree(parser, text, undefined, (tree) => {
      if (tree.rootNode.hasError) { damaged = true; return; }
      const aliases = file === domainFile ? new Map([[name, new Set([domain.assignment])]]) : imports(tree.rootNode, file, domainFile, name, files);
      const result = oracleReading(tree.rootNode, oracle, aliases, domain.dict);
      found += result.found; bound ||= result.bound;
    });
  }
  if (damaged) return "Python oracle population has syntax errors; binding is UNKNOWN";
  if (found !== 1) return `Python oracle "${oracle}" requires one named test function or direct test method; found ${found}`;
  if (!bound) return `Python oracle "${oracle}" does not directly iterate the declared domain \`${name}\` from ${domainFile}; requires an unshadowed direct module binding and an unfiltered for loop (decorators, nested scopes and early exits are unsupported)`;
  return null;
}
