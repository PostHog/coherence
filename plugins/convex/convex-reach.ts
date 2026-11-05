/**
 * Every place a project reaches a Convex function through the generated API,
 * and every place it might without the plugin being able to tell: a gap.
 *
 * Followed, so each is a reference like a direct chain:
 *   - the api and internal objects under any local name, and a namespace
 *     import of _generated/api (g.internal.telemetry.send);
 *   - a module that re-exports them (export { internal } from ..., export *
 *     from ..., or an import exported again), imported by a relative path or
 *     a path alias ending in that module's path, however many relays deep;
 *   - a const that holds part of a chain (const t = internal.telemetry;
 *     t.send), and a destructure (const { send: s } = internal.telemetry),
 *     whose binding is the reference.
 *
 * A gap, named with why, never silence: any other use of the object or of a
 * chain that could still lead to the function (passed on as a value, spread,
 * read with a computed key, a rest pattern), and a string naming the function
 * as Convex names it ("telemetry:send"). The adapter reports a gap as a site
 * it could not read through, so one outside the chokepoint keeps it from
 * passing.
 *
 * Names are matched by name, not by scope: a local that shadows a followed
 * name is read as that name.
 */

import { posix } from "node:path";
import type * as TS from "typescript";
import { typescriptCompiler } from "../../src/plugins/api.ts";
import { enclosingName, namesGenerated, parse } from "./convex-api.ts";

function ts(): typeof TS {
  return typescriptCompiler("the Convex plugin reads a Convex project's code with its parser");
}

/** What a local name holds: part of a generated-API chain (its segments below api or internal), or a namespace whose members are api and internal. */
type Root = { ns: true } | { ns: false; prefix: readonly string[] };

/** One place a file reaches the target, or might: zero-based line and character, the enclosing declaration, and why it is a gap when it is one. */
export interface Reach {
  line: number;
  character: number;
  symbol: string | undefined;
  unread?: string;
}

/** The functions a reference may name: the module's path below the functions folder, and its exported names. */
export interface ReachTarget {
  folder: string;
  path: readonly string[];
  names: readonly string[];
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const OBJECTS: ReadonlySet<string> = new Set(["api", "internal"]);

export class ApiReader {
  private readonly parsed = new Map<string, TS.SourceFile | undefined>();
  private readonly relaysByFolder = new Map<string, Map<string, Map<string, Root>>>();
  private readonly files: readonly string[];
  private readonly known: ReadonlySet<string>;
  private readonly read: (file: string) => string | undefined;

  /** `files` are the sources the reader may parse, project-relative; `read` gives a file's text, a staged document's included. */
  constructor(files: readonly string[], read: (file: string) => string | undefined) {
    this.files = files;
    this.known = new Set(files);
    this.read = read;
  }

  private source(file: string): TS.SourceFile | undefined {
    if (!this.parsed.has(file)) {
      const text = this.read(file);
      this.parsed.set(file, text === undefined ? undefined : parse(file, text));
    }
    return this.parsed.get(file);
  }

  /** The project file a module specifier in `file` names: a relative path resolved with the extensions TypeScript tries, or a path alias by the file whose path it ends with. */
  private resolve(file: string, specifier: string): string | undefined {
    const bare = specifier.replace(/\.(js|mjs|cjs|jsx)$/, "");
    const stems = bare.startsWith(".") ? [posix.normalize(posix.join(posix.dirname(file), bare))] : [];
    const tries = (stem: string): string[] => [stem, ...EXTENSIONS.map((e) => stem + e), ...EXTENSIONS.map((e) => `${stem}/index${e}`)];
    for (const stem of stems) for (const candidate of tries(stem)) if (this.known.has(candidate)) return candidate;
    if (bare.startsWith(".")) return undefined;
    // A path alias (@/lib/api, ~/lib/api): the one project file whose path, extension aside, ends with what follows its first segment.
    const rest = bare.replace(/^[^/]*\//, "");
    if (rest === bare) return undefined;
    const found = this.files.filter((f) => tries(rest).some((t) => f === t || f.endsWith(`/${t}`)));
    return found.length === 1 ? found[0] : undefined;
  }

  /** What a module specifier in `file` exports of the folder's generated API, by exported name: the generated module itself, or a relay. */
  private exportsOf(file: string, specifier: string, folder: string, relays: Map<string, Map<string, Root>>): Map<string, Root> | undefined {
    if (namesGenerated(file, specifier, folder, "api")) return new Map([["api", { ns: false, prefix: [] }], ["internal", { ns: false, prefix: [] }]]);
    const target = this.resolve(file, specifier);
    return target === undefined ? undefined : relays.get(target);
  }

  /** The names a file binds by its imports to the folder's generated API. */
  private importRoots(file: string, source: TS.SourceFile, folder: string, relays: Map<string, Map<string, Root>>): Map<string, Root> {
    const compiler = ts();
    const roots = new Map<string, Root>();
    for (const statement of source.statements) {
      if (!compiler.isImportDeclaration(statement) || !compiler.isStringLiteral(statement.moduleSpecifier)) continue;
      const exported = this.exportsOf(file, statement.moduleSpecifier.text, folder, relays);
      const bindings = statement.importClause?.namedBindings;
      if (exported === undefined || bindings === undefined) continue;
      if (compiler.isNamespaceImport(bindings)) {
        roots.set(bindings.name.text, { ns: true });
        continue;
      }
      for (const element of bindings.elements) {
        const root = exported.get((element.propertyName ?? element.name).text);
        if (root !== undefined) roots.set(element.name.text, root);
      }
    }
    return roots;
  }

  /** Every module that re-exports the folder's generated API, with what it exports under each name, followed to a fixed point. */
  private relays(folder: string): Map<string, Map<string, Root>> {
    const known = this.relaysByFolder.get(folder);
    if (known !== undefined) return known;
    const compiler = ts();
    const relays = new Map<string, Map<string, Root>>();
    const candidates = this.files.filter((file) => {
      const text = this.read(file);
      return text !== undefined && /\bexport\b/.test(text) && /\b(?:api|internal)\b|export\s*\*/.test(text);
    });
    for (let changed = true, round = 0; changed && round < 8; round++) {
      changed = false;
      for (const file of candidates) {
        const source = this.source(file);
        if (source === undefined) continue;
        const roots = this.importRoots(file, source, folder, relays);
        const out = new Map<string, Root>();
        for (const statement of source.statements) {
          if (compiler.isExportDeclaration(statement)) {
            const from = statement.moduleSpecifier !== undefined && compiler.isStringLiteral(statement.moduleSpecifier) ? this.exportsOf(file, statement.moduleSpecifier.text, folder, relays) : undefined;
            if (statement.moduleSpecifier !== undefined && from === undefined) continue;
            const clause = statement.exportClause;
            if (clause === undefined) for (const [name, root] of from!) out.set(name, root);
            else if (compiler.isNamespaceExport(clause)) out.set(clause.name.text, { ns: true });
            else for (const element of clause.elements) {
              const root = (from ?? roots).get((element.propertyName ?? element.name).text);
              if (root !== undefined) out.set(element.name.text, root);
            }
          } else if (compiler.isVariableStatement(statement) && (compiler.getModifiers(statement) ?? []).some((m) => m.kind === compiler.SyntaxKind.ExportKeyword)) {
            for (const declaration of statement.declarationList.declarations) {
              const root = declaration.initializer === undefined ? undefined : rootOfChain(declaration.initializer, roots);
              if (root !== undefined && compiler.isIdentifier(declaration.name)) out.set(declaration.name.text, root);
            }
          }
        }
        if (out.size > 0 && JSON.stringify([...out]) !== JSON.stringify([...(relays.get(file) ?? new Map())])) {
          relays.set(file, out);
          changed = true;
        }
      }
    }
    this.relaysByFolder.set(folder, relays);
    return relays;
  }

  /** Where `file` reaches one of the target's functions, or might: references, and gaps with why. */
  reach(file: string, target: ReachTarget): Reach[] {
    const text = this.read(file);
    if (text === undefined) return [];
    const strings = target.names.map((name) => `${target.path.join("/")}:${name}`);
    const mayHold = /\b(?:api|internal)\b|import\s*\*|_generated/.test(text) || strings.some((s) => text.includes(s));
    if (!mayHold) return [];
    const source = this.source(file);
    if (source === undefined) return [];
    const compiler = ts();
    const relays = this.relays(target.folder);
    const roots = this.importRoots(file, source, target.folder, relays);
    const found: Reach[] = [];
    const at = (node: TS.Node, unread?: string): void => {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push({ line: position.line, character: position.character, symbol: enclosingName(node), ...(unread === undefined ? {} : { unread }) });
    };
    const names = new Set(target.names);
    /** Whether segments below the objects name a target function, could still lead to one, or neither. */
    const judge = (segments: readonly string[]): "reference" | "partial" | "other" => {
      const head = segments.slice(0, target.path.length);
      if (!head.every((s, i) => s === target.path[i])) return "other";
      if (segments.length > target.path.length) return names.has(segments[target.path.length]!) ? "reference" : "other";
      return "partial";
    };

    // Aliases and destructures: names that hold part of a chain, followed to a fixed point; their initializers are followed, not uses.
    const followed = new Set<TS.Node>();
    const declarations: TS.VariableDeclaration[] = [];
    const collect = (node: TS.Node): void => {
      if (compiler.isVariableDeclaration(node) && node.initializer !== undefined) declarations.push(node);
      compiler.forEachChild(node, collect);
    };
    collect(source);
    for (let changed = true, round = 0; changed && round < 8; round++) {
      changed = false;
      for (const declaration of declarations) {
        if (followed.has(declaration.initializer!)) continue;
        const root = rootOfChain(declaration.initializer!, roots);
        // Only a part of a chain that could still lead to the function is followed; a complete chain is a reference where it is written.
        if (root === undefined || (!root.ns && judge(root.prefix) !== "partial")) continue;
        if (compiler.isIdentifier(declaration.name)) {
          roots.set(declaration.name.text, root);
          followed.add(declaration.initializer!);
          changed = true;
        } else if (compiler.isObjectBindingPattern(declaration.name)) {
          followed.add(declaration.initializer!);
          changed = true;
          bindPattern(declaration.name, root);
        }
      }
    }
    function bindPattern(pattern: TS.ObjectBindingPattern, root: Root): void {
      for (const element of pattern.elements) {
        const key = element.propertyName ?? element.name;
        const segment = compiler.isIdentifier(key) || compiler.isStringLiteral(key) ? key.text : undefined;
        const below = segment === undefined ? undefined : step(root, segment);
        if (element.dotDotDotToken !== undefined || segment === undefined || below === undefined) {
          const partial = root.ns || judge(root.prefix) === "partial";
          if (partial) at(element, element.dotDotDotToken !== undefined ? "a rest pattern takes what is left of the generated API, which the plugin does not follow" : "a computed key destructures the generated API, which the plugin does not follow");
          continue;
        }
        if (compiler.isObjectBindingPattern(element.name)) bindPattern(element.name, below);
        else if (compiler.isIdentifier(element.name)) {
          if (!below.ns && judge(below.prefix) === "reference") at(element);
          else roots.set(element.name.text, below);
        }
      }
    }

    const visit = (node: TS.Node): void => {
      if (compiler.isTypeNode(node) || compiler.isImportDeclaration(node) || compiler.isExportDeclaration(node)) return;
      if (followed.has(node)) return;
      if ((compiler.isStringLiteral(node) || compiler.isNoSubstitutionTemplateLiteral(node)) && strings.includes(node.text)) {
        at(node, `names ${node.text} by string, which the plugin does not resolve to the function`);
      }
      if (compiler.isIdentifier(node) && roots.has(node.text) && isValueUse(node)) {
        const root = roots.get(node.text)!;
        const segments: string[] = [];
        let outer: TS.Expression = node;
        let computed = false;
        for (;;) {
          const parent: TS.Node = outer.parent;
          if (compiler.isPropertyAccessExpression(parent) && parent.expression === outer) {
            segments.push(parent.name.text);
            outer = parent;
          } else if (compiler.isElementAccessExpression(parent) && parent.expression === outer) {
            if (!compiler.isStringLiteralLike(parent.argumentExpression)) {
              computed = true;
              break;
            }
            segments.push(parent.argumentExpression.text);
            outer = parent;
          } else break;
        }
        if (!followed.has(outer)) {
          const full = below(root, segments);
          const verdict = full === "unrelated" ? "other" : full === "namespace" ? "partial" : judge(full);
          const chain = [node.text, ...segments].join(".");
          if (verdict === "reference") at(node);
          else if (verdict === "partial") at(node, computed ? `${chain} is read with a computed key, which the plugin does not follow` : `${chain} is passed on as a value, which the plugin does not follow`);
        }
      }
      compiler.forEachChild(node, visit);
    };
    visit(source);
    return found;
  }
}

/** The root one step below: a member of a namespace must be api or internal; below an object, the segment joins its prefix. */
function step(root: Root, segment: string): Root | undefined {
  if (root.ns) return OBJECTS.has(segment) ? { ns: false, prefix: [] } : undefined;
  return { ns: false, prefix: [...root.prefix, segment] };
}

/** The segments below the objects a chain from `root` reaches; "namespace" when it stops at a namespace, "unrelated" when it leaves the generated API (a namespace member other than api or internal). */
function below(root: Root, segments: readonly string[]): readonly string[] | "namespace" | "unrelated" {
  let at: Root = root;
  for (const segment of segments) {
    const next = step(at, segment);
    if (next === undefined) return "unrelated";
    at = next;
  }
  return at.ns ? "namespace" : at.prefix;
}

/** The root an initializer holds when it is a chain of property and static element accesses on a followed name; undefined otherwise. */
function rootOfChain(expression: TS.Expression, roots: ReadonlyMap<string, Root>): Root | undefined {
  const compiler = ts();
  const segments: string[] = [];
  let at: TS.Expression = expression;
  for (;;) {
    if (compiler.isPropertyAccessExpression(at)) {
      segments.unshift(at.name.text);
      at = at.expression;
    } else if (compiler.isElementAccessExpression(at) && compiler.isStringLiteralLike(at.argumentExpression)) {
      segments.unshift(at.argumentExpression.text);
      at = at.expression;
    } else if (compiler.isParenthesizedExpression(at) || compiler.isNonNullExpression(at) || compiler.isAsExpression(at) || compiler.isSatisfiesExpression(at)) {
      at = at.expression;
    } else break;
  }
  if (!compiler.isIdentifier(at)) return undefined;
  let root = roots.get(at.text);
  for (const segment of segments) root = root === undefined ? undefined : step(root, segment);
  return root;
}

/** Whether an identifier is a use of a value, not a name being declared, a property name, or a key. */
function isValueUse(node: TS.Identifier): boolean {
  const compiler = ts();
  const parent = node.parent;
  if (compiler.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((compiler.isPropertyAssignment(parent) || compiler.isPropertyDeclaration(parent) || compiler.isMethodDeclaration(parent) || compiler.isPropertySignature(parent)) && parent.name === node) return false;
  if ((compiler.isVariableDeclaration(parent) || compiler.isParameter(parent) || compiler.isFunctionDeclaration(parent) || compiler.isClassDeclaration(parent) || compiler.isBindingElement(parent)) && parent.name === node) return false;
  if (compiler.isBindingElement(parent) && parent.propertyName === node) return false;
  if (compiler.isImportSpecifier(parent) || compiler.isExportSpecifier(parent) || compiler.isNamespaceImport(parent) || compiler.isImportClause(parent)) return false;
  return true;
}

/** The references one file's text makes to a target on its own, re-exports from other files aside: what a single file shows. */
export function generatedApiReferences(file: string, text: string, target: ReachTarget): Reach[] {
  return new ApiReader([file], (f) => (f === file ? text : undefined)).reach(file, target);
}
