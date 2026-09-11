// Totality admission at an explicit, bounded source grade. This does not prove that an
// assertion is correct, that a loop executes, or that the declared set models the world.
// It binds a concrete runtime population to an unfiltered iteration in the named oracle;
// executable verification still has to establish that the named oracle actually ran.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { Node } from "web-tree-sitter";
import { grammarHandle, withTree } from "../adapters/tree-sitter.ts";
import type { Config, Graph } from "../types.ts";
import { claimsTotality } from "./boundary.ts";
import { cookedStringText, NOISE_DIRS } from "./oracle-domain.ts";
import { pythonTotalityFailure } from "./python-totality.ts";

const children = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
function walk(n: Node, visit: (n: Node) => void): void { visit(n); for (const c of children(n)) walk(c, visit); }
function uncast(n: Node): Node {
  while (["as_expression", "satisfies_expression", "parenthesized_expression"].includes(n.type)) {
    const inner = children(n)[0]; if (!inner) break; n = inner;
  }
  return n;
}
const topLevel = (n: Node): boolean => n.parent?.type === "program" || n.parent?.type === "export_statement" && n.parent.parent?.type === "program";

/** Only known finite runtime constructors earn this grade. Type/interface declarations,
 * scalar bindings, dynamic calls, spreads, computed keys and empty populations refuse. */
function concreteDomain(root: Node, name: string): string | null {
  const declarations: Node[] = [];
  walk(root, (n) => {
    if (["variable_declarator", "enum_declaration"].includes(n.type)
      && n.childForFieldName("name")?.text === name) declarations.push(n);
  });
  if (declarations.length !== 1) return "requires one concrete declaration in its source file";
  const n = declarations[0];
  if (n.type === "enum_declaration") {
    if (!topLevel(n) || n.children.some((c) => c?.text === "const")) return "requires a top-level runtime enum (const enums are erased)";
    const body = n.childForFieldName("body");
    return body && children(body).length ? null : "empty enum cannot supply a nonempty population";
  }
  const declaration = n.parent;
  if (!declaration || declaration.type !== "lexical_declaration" || declaration.childForFieldName("kind")?.text !== "const" || !topLevel(declaration))
    return "requires a top-level const collection or runtime enum";
  const value = n.childForFieldName("value");
  if (!value) return "has no runtime initializer";
  const v = uncast(value), members = children(v);
  if (v.type === "array" && members.length && members.every((m) => m.type !== "spread_element")) return null;
  if (v.type === "object" && members.length && members.every((m) =>
    m.type === "pair" && ["property_identifier", "string", "number"].includes(m.childForFieldName("key")?.type ?? "")
      && !m.childForFieldName("key")!.text.includes("\\")
      && (cookedStringText(m.childForFieldName("key")!) ?? m.childForFieldName("key")?.text) !== "__proto__")) return null;
  return "is not a supported nonempty const array/object literal or runtime enum (dynamic construction, spreads and computed keys are unsupported)";
}

/** Direct imports bind a local alias to an explicit relative source-file path. No
 * extension inference, emitted-path rewriting, package resolution or re-export chasing. */
function importedDomain(root: Node, file: string, domainFile: string, name: string): string[] {
  const aliases: string[] = [];
  for (const statement of children(root)) {
    if (statement.type !== "import_statement" || statement.children.some((c) => c?.type === "type")) continue;
    const source = statement.childForFieldName("source");
    // This source-binding grade does not decode JavaScript escape sequences. A cooked
    // approximation could bind a different module or hide a special object key.
    if (source?.text.includes("\\")) continue;
    const spec = source && cookedStringText(source);
    if (!spec?.startsWith(".")) continue;
    const base = relative("/__coherence_domain_root__", resolve("/__coherence_domain_root__", dirname(file), spec));
    if (base === ".." || base.startsWith("../")) continue;
    if (base !== domainFile) continue;
    walk(statement, (n) => {
      if (n.type !== "import_specifier" || n.children.some((c) => c?.type === "type")) return;
      if (n.childForFieldName("name")?.text === name)
        aliases.push((n.childForFieldName("alias") ?? n.childForFieldName("name"))!.text);
    });
  }
  return aliases;
}

/** Recognized binding positions. Patterns are conservatively traversed:
 * a destructured name, catch parameter or named function expression cannot borrow the
 * identity of an outer import or of a built-in helper. */
function declaredNames(n: Node): string[] {
  const field = ["variable_declarator", "function_declaration", "function_expression", "generator_function", "generator_function_declaration", "class_declaration", "class", "enum_declaration", "internal_module"].includes(n.type) ? "name"
    : ["required_parameter", "optional_parameter"].includes(n.type) ? "pattern"
      : ["catch_clause", "arrow_function"].includes(n.type) ? "parameter" : n.type === "for_in_statement" ? "left" : null;
  const name = field ? n.childForFieldName(field) : n.type === "import_specifier" ? n.childForFieldName("alias") ?? n.childForFieldName("name") : null;
  const patterns = name ? [name] : ["import_clause", "namespace_import"].includes(n.type) ? children(n) : [];
  const names: string[] = [];
  for (const pattern of patterns) walk(pattern, (part) => {
    if (part.type.includes("identifier")) names.push(part.text);
  });
  return names;
}

type DomainShape = "array" | "object";
function iterationShape(n: Node, aliases: Set<string>, wrappers: Set<string>, shape: DomainShape): DomainShape | null {
  n = uncast(n);
  if (n.type === "identifier") return aliases.has(n.text) ? shape : null;
  if (n.type !== "call_expression") return null;
  const fn = n.childForFieldName("function"), args = n.childForFieldName("arguments");
  if (!fn || !args || !wrappers.has(fn.text) || fn.text === "Array.from" && shape !== "array") return null;
  const arguments_ = children(args);
  // In particular, do not peel .filter/.slice/.some: a subset is not the named domain.
  return arguments_.length === 1 && uncast(arguments_[0]).type === "identifier" && aliases.has(uncast(arguments_[0]).text) ? "array" : null;
}

function oracleBinding(root: Node, title: string, aliases: string[], shape: DomainShape): { found: number; bound: boolean } {
  const bodies: Node[] = [];
  let unsupportedScope = false;
  walk(root, (n) => {
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function"), args = n.childForFieldName("arguments");
    if (!fn || !args || !["describe", "test", "it"].includes(fn.text)) return;
    const a = children(args);
    if (a[0] && cookedStringText(a[0]) === title && a[1]) {
      bodies.push(a[1]);
      // No scope resolver is promised for nested declarations: an enclosing function
      // parameter must never impersonate the direct module import with the same name.
      if (n.parent?.type !== "expression_statement" || n.parent.parent?.type !== "program"
        || !["arrow_function", "function_expression"].includes(a[1].type)) unsupportedScope = true;
    }
  });
  if (bodies.length !== 1 || unsupportedScope) return { found: bodies.length, bound: false };
  const body = bodies[0], usable = new Set(aliases);
  const wrappers = new Set(["Object.keys", "Object.values", "Object.entries", "Array.from"]);
  // Wrapper recognition must not borrow built-in semantics from a locally rebound
  // Object or Array. Conservatively refuse that helper anywhere in this source file.
  walk(root, (n) => {
    for (const name of declaredNames(n)) for (const key of wrappers) if (key.startsWith(name + ".")) wrappers.delete(key);
  });
  // Conservative lexical scope: a same-name local/parameter anywhere in the oracle
  // makes that alias unsupported. Never promote a shadowed imported name to identity.
  walk(body, (n) => {
    for (const name of declaredNames(n)) usable.delete(name);
    if (n.type === "for_in_statement") {
      const left = n.childForFieldName("left");
      if (left) walk(left, (part) => { usable.delete(part.text); });
    }
  });
  let bound = false;
  walk(body, (n) => {
    if (n.type === "for_in_statement") {
      const right = n.childForFieldName("right");
      const iterated = right && iterationShape(right, usable, wrappers, shape);
      if (iterated && (iterated === "array" || n.children.some((c) => c?.text === "in"))) bound = true;
    }
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    if (fn?.type !== "member_expression") return;
    const receiver = fn.childForFieldName("object"), method = fn.childForFieldName("property")?.text;
    if (receiver && ["forEach", "map", "reduce", "reduceRight"].includes(method ?? "") && iterationShape(receiver, usable, wrappers, shape) === "array") bound = true;
    if (receiver && ["test", "it", "describe"].includes(receiver.text) && method === "each") {
      const args = n.childForFieldName("arguments");
      const domain = args && children(args)[0];
      if (domain && iterationShape(domain, usable, wrappers, shape) === "array") bound = true;
    }
  });
  return { found: 1, bound };
}

/** Refuse unsupported totality admission; null means only that this structural grade
 * is met. Both guard and test verbs owe the same population/identity checks. */
export async function totalityGateFailure(
  cfg: Config, graph: Graph, inv: string, chokepoint: string, over: string | null, oracle: string,
): Promise<string | null> {
  if (cfg.totalityEnumeration === false || !claimsTotality(inv) && !claimsTotality(oracle)) return null;
  const name = over ?? chokepoint;
  const fail = (detail: string): string => `[totality] ${detail}. Name a supported domain with \`over <ENUMERATION>\` and an oracle iterating that binding, or narrow the claim: \`coverage "${inv}" at ${chokepoint} residual "<what this does NOT cover>" …\`. Structural admission does not prove semantic totality.`;
  const matches = graph.nodes.filter((n) => n.kind === "symbol" && n.label === name);
  if (matches.length !== 1) return fail(`enumeration \`${name}\` must resolve uniquely; found ${matches.length} matching symbols`);
  const node = matches[0];
  if (!["const", "enum"].includes(node.sub ?? "")) return fail(`\`${name}\` is a ${node.sub ?? "(unknown)"}, not a supported concrete runtime enumeration`);
  if (!oracle) return fail(`"${inv}" names no oracle; symbol existence cannot establish totality`);
  if (node.path?.endsWith(".py")) {
    const problem = await pythonTotalityFailure(cfg, node.path, name, oracle);
    return problem ? fail(problem) : null;
  }
  if (!node.path || !/\.[cm]?[jt]sx?$/.test(node.path)) return fail(`\`${name}\` has no supported TS/JS or Python source address; other language grades are not implemented`);
  const absolute = resolve(cfg.root, node.path);
  if (relative(cfg.root, absolute).startsWith("..")) return fail("enumeration source escapes the repository");
  const { parser } = await grammarHandle("typescript");
  let source: string;
  try { source = await readFile(absolute, "utf8"); } catch { return fail(`cannot read enumeration source ${node.path}`); }
  const domain = withTree(parser, source, { problem: "cannot parse enumeration source" as string | null, exported: false, shape: "object" as DomainShape }, (tree) => {
    let exported = false;
    let shape: DomainShape = "object";
    walk(tree.rootNode, (n) => {
      if (n.childForFieldName("name")?.text !== name) return;
      const value = n.type === "variable_declarator" && n.childForFieldName("value");
      if (value && uncast(value).type === "array") shape = "array";
      if (n.type === "enum_declaration" && n.parent?.type === "export_statement"
        || n.type === "variable_declarator" && n.parent?.parent?.type === "export_statement") exported = true;
    });
    return { problem: tree.rootNode.hasError ? "enumeration source has syntax errors" : concreteDomain(tree.rootNode, name), exported, shape };
  });
  if (domain.problem) return fail(`\`${name}\` ${domain.problem}`);
  let count = 0, bound = false, damaged = false;
  async function visit(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { damaged = true; return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || NOISE_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) { damaged = true; continue; }
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      let text: string;
      try { text = await readFile(path, "utf8"); } catch { damaged = true; continue; }
      const file = relative(cfg.root, path);
      withTree(parser, text, undefined, (tree) => {
        if (tree.rootNode.hasError) { damaged = true; return; }
        const aliases = file === node.path ? [name] : domain.exported ? importedDomain(tree.rootNode, file, node.path!, name) : [];
        const reading = oracleBinding(tree.rootNode, oracle, aliases, domain.shape);
        count += reading.found; bound ||= reading.bound;
      });
    }
  }
  await visit(cfg.root);
  if (damaged) return fail("oracle population is unreadable, linked, or syntactically unsupported; binding is UNKNOWN");
  if (count !== 1) return fail(`oracle "${oracle}" requires one direct test/it/describe declaration; found ${count}`);
  if (!bound) return fail(`oracle "${oracle}" does not directly iterate the declared domain \`${name}\` from ${node.path}; requires a top-level declaration and direct named imports using explicit relative source-file paths, without shadowing or filtering`);
  return null;
}
