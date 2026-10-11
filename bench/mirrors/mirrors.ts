/**
 * The mirror reading, a spike: find the lists a project keeps by hand that
 * must mirror something defined elsewhere (the lexicon's defect family
 * `hand-list`), where drift fails silently.
 *
 * Three steps. Candidates are literal collections of names, read with the
 * TypeScript compiler's parser: string arrays and sets, object keys and
 * values, columns of an array of tuples or records, regular-expression and
 * string alternations (`Bash|Edit|Write`, `<review|ci|probe>`), string
 * literal unions, switch case labels, and in Markdown, alternations, table
 * key columns and prose enumerations. Universes are what a list may mirror
 * and code derives: a folder's files, the import closure of a list of files,
 * a module's exports, the keys a file reads off one object. Every candidate
 * is matched against every other set by overlap, and git history says which
 * pairs grew together, which grew apart, and which commit grew one side alone.
 *
 * Everything is read from git objects at one revision, so the reading holds
 * still while the working tree moves: `--rev v1.7.1` reads that release.
 *
 * usage: node bench/mirrors/mirrors.ts [--rev <rev>] [--json] [--limit <n>]
 *          [--no-history] [--truth bench/mirrors/truth.json] [--all]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, posix } from "node:path";
import ts from "typescript";

/* ------------------------------------------------------------------ input */

const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(name);
}
function option(name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

const REV = option("--rev") ?? "HEAD";
const JSON_OUT = flag("--json");
const LIMIT = Number(option("--limit") ?? 40);
const HISTORY = !flag("--no-history");
const TRUTH = option("--truth");
const ALL = flag("--all");
const CWD = process.cwd();

const t0 = performance.now();
const phases: Record<string, number> = {};
function phase(name: string, since: number): number {
  const now = performance.now();
  phases[name] = Math.round(now - since);
  return now;
}

/** Folders that are not the project's code, as coherence.config.json's `ignore` names them, plus fixtures. */
const IGNORED = /(^|\/)(node_modules|promo|fonts)(\/|$)/;
/** Test files: their literals are fixtures and expectations, which copy the lists on purpose. */
const TEST_FILE = /\.(test|e2e)\.[cm]?[tj]s$|fixture/;
const CODE_FILE = /\.(ts|mts|cts|js|mjs|cjs)$/;
const DOC_FILE = /\.md$/;

function git(args: string[], input?: string): Buffer {
  return execFileSync("git", args, { cwd: CWD, maxBuffer: 1024 * 1024 * 1024, ...(input === undefined ? {} : { input }) });
}

const paths = git(["ls-tree", "-r", "-z", "--name-only", REV]).toString("utf8").split("\0").filter((p) => p !== "" && !IGNORED.test(p));
const wanted = paths.filter((p) => (CODE_FILE.test(p) || DOC_FILE.test(p)) && !p.endsWith(".d.ts"));

/** Every wanted file's text at the revision, through one cat-file process. */
function readAll(files: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const buf = git(["cat-file", "--batch"], files.map((f) => `${REV}:${f}`).join("\n") + "\n");
  let at = 0;
  for (const file of files) {
    const nl = buf.indexOf(10, at);
    const header = buf.subarray(at, nl).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (header.endsWith("missing") || Number.isNaN(size)) {
      at = nl + 1;
      continue;
    }
    out.set(file, buf.subarray(nl + 1, nl + 1 + size).toString("utf8"));
    at = nl + 1 + size + 1;
  }
  return out;
}

const texts = readAll(wanted);
let mark = phase("read", t0);

/* --------------------------------------------------------------- the sets */

type Form =
  | "array" | "set" | "keys" | "values" | "column" | "alternation" | "union" | "cases"
  | "doc-alternation" | "doc-table" | "prose"
  | "folder" | "closure" | "exports" | "reads";

const DOC_FORMS: ReadonlySet<Form> = new Set<Form>(["doc-alternation", "doc-table", "prose"]);
const DERIVED: ReadonlySet<Form> = new Set<Form>(["folder", "closure", "exports", "reads"]);

interface NameSet {
  id: number;
  file: string;
  line: number;
  name: string;
  form: Form;
  members: string[];
  /** Declarations that came from one source node (an object's keys and its values) never pair. */
  origin: string;
  /** The compiler holds these keys to a type (`Record<Kind, …>`): not kept by hand. */
  checked: boolean;
  /** A switch with a default clause: a label it lacks is handled, not missed. */
  open?: boolean;
}

const sets: NameSet[] = [];
function addSet(s: Omit<NameSet, "id" | "members"> & { members: readonly string[] }): void {
  const members = [...new Set(s.members)];
  if (members.length < 2) return;
  if (!members.every(nameLike)) return;
  sets.push({ ...s, members, id: sets.length });
}

/** A name, not prose or a pattern: up to three words, none of them long, no markup. */
function nameLike(value: string): boolean {
  if (value === "" || value.length > 60) return false;
  if (/[\n`{}()<>\\^$*+?\[\]]/.test(value)) return false;
  return value.trim().split(/\s+/).length <= 3;
}

/* ------------------------------------------------------- code: candidates */

interface ModuleFacts {
  imports: { spec: string; typeOnly: boolean }[];
}
const modules = new Map<string, ModuleFacts>();

function scriptKind(file: string): ts.ScriptKind {
  return /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/** Steps through wrappers that do not change what a literal is: `as const`, `satisfies`, parentheses, `new Set(…)`. */
function outer(node: ts.Node): ts.Node {
  let at = node;
  for (;;) {
    const p = at.parent;
    if (p === undefined) return at;
    if (ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isParenthesizedExpression(p) || ts.isTypeAssertionExpression(p)) at = p;
    else if (ts.isNewExpression(p) && p.arguments?.[0] === at) at = p;
    else return at;
  }
}

function declName(node: ts.Node): string {
  const top = outer(node);
  const p = top.parent;
  if (p === undefined) return "<anon>";
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) return p.name.getText();
  if (ts.isBinaryExpression(p) && p.right === top) return p.left.getText().slice(0, 40);
  if (ts.isTypeAliasDeclaration(p)) return p.name.text;
  return `<in ${enclosingFunction(node)}>`;
}

function enclosingFunction(node: ts.Node): string {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name !== undefined) return at.name.getText();
    if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent)) return at.parent.name.getText();
    if (ts.isSourceFile(at)) return "module";
  }
  return "module";
}

function atModuleScope(node: ts.Node): boolean {
  const top = outer(node);
  const decl = top.parent;
  if (decl === undefined || !ts.isVariableDeclaration(decl)) return false;
  const stmt = decl.parent?.parent;
  return stmt !== undefined && ts.isVariableStatement(stmt) && ts.isSourceFile(stmt.parent);
}

/** The declared type's key, when it is a `Record<K, …>` over anything but string: the compiler then checks the keys. */
function checkedKeys(node: ts.Node): boolean {
  const top = outer(node);
  const typeNode = (ts.isVariableDeclaration(top.parent) ? top.parent.type : undefined) ?? (ts.isSatisfiesExpression(node.parent) ? node.parent.type : undefined);
  if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode) || typeNode.typeName.getText() !== "Record") return false;
  const key = typeNode.typeArguments?.[0];
  return key !== undefined && key.kind !== ts.SyntaxKind.StringKeyword && key.kind !== ts.SyntaxKind.NumberKeyword;
}

function stringValue(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function propName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

/** A plain alternative: a name, maybe with escaped dots or dashes, and nothing a pattern means. */
function plainAlternative(alt: string): string | undefined {
  const unescaped = alt.replace(/\\([.\-/])/g, "$1");
  return /^[\w.\-/ ]+$/.test(unescaped) && /\w/.test(unescaped) ? unescaped : undefined;
}

/** The alternations in a regular expression's source: every group, and the whole pattern, whose alternatives are all plain. */
function regexAlternations(source: string): string[][] {
  const out: string[][] = [];
  const consider = (body: string): void => {
    const alts = splitTopLevel(body);
    if (alts.length < 2) return;
    const plain = alts.map(plainAlternative);
    if (plain.every((a) => a !== undefined)) out.push(plain as string[]);
  };
  // Groups, innermost content of each parenthesis pair.
  const stack: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") {
      while (i < source.length && source[i] !== "]") i += source[i] === "\\" ? 2 : 1;
      continue;
    }
    if (ch === "(") stack.push(i);
    else if (ch === ")" && stack.length > 0) {
      const open = stack.pop()!;
      let body = source.slice(open + 1, i);
      body = body.replace(/^\?(?::|<?[=!]|<\w+>)/, "");
      consider(body);
    }
  }
  consider(source.replace(/^\^|\$$/g, "").replace(/^\\b|\\b$/g, ""));
  return out;
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "|" && depth === 0) {
      out.push(body.slice(from, i));
      from = i + 1;
    }
  }
  out.push(body.slice(from));
  return out;
}

/** Alternations written in a string: the whole string (`Bash|Edit|Write`) or a placeholder (`<review|ci|probe>`), with the flag before it. */
function stringAlternations(text: string): { members: string[]; label: string }[] {
  const out: { members: string[]; label: string }[] = [];
  if (/^[\w.-]+(\|[\w.-]+)+$/.test(text)) out.push({ members: text.split("|"), label: "" });
  for (const m of text.matchAll(/(--[\w-]+\s+)?<([\w.\- ]+(?:\|[\w.\- ]+)+)>/g)) out.push({ members: m[2]!.split("|").map((s) => s.trim()), label: m[1]?.trim() ?? "" });
  return out;
}

/**
 * A switch the compiler holds to its discriminant's type: no default, every
 * clause leaves by return or throw, the switch ends its function, and the
 * function declares a return type without undefined. A case missing from such
 * a switch over a union is a compile error (TS2366), so its labels are not
 * kept by hand. Syntactic: without the checker the discriminant's type is
 * assumed to be a union.
 */
function exhaustiveSwitch(node: ts.SwitchStatement): boolean {
  const clauses = node.caseBlock.clauses;
  if (clauses.some(ts.isDefaultClause)) return false;
  const leaves = (c: ts.CaseOrDefaultClause): boolean => {
    const last = c.statements[c.statements.length - 1];
    if (last === undefined) return true; // falls through to the next label
    if (ts.isBlock(last)) {
      const inner = last.statements[last.statements.length - 1];
      return inner !== undefined && (ts.isReturnStatement(inner) || ts.isThrowStatement(inner));
    }
    return ts.isReturnStatement(last) || ts.isThrowStatement(last);
  };
  if (!clauses.every(leaves)) return false;
  const block = node.parent;
  if (!ts.isBlock(block) || block.statements[block.statements.length - 1] !== node) return false;
  const fn = block.parent;
  if (fn === undefined || !(ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false;
  const type = fn.type?.getText();
  return type !== undefined && type !== "void" && !/\bundefined\b|\bvoid\b/.test(type);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function readCode(file: string, text: string): void {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const facts: ModuleFacts = { imports: [] };
  modules.set(file, facts);
  const exported: string[] = [];
  const reads = new Map<string, { keys: string[]; line: number }>();
  const isTest = TEST_FILE.test(file);

  const visit = (node: ts.Node): void => {
    // Imports and exports: the facts universes are made of; read in every file, tests too.
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      // `import type …`, or `import { type A, type B }` with no default: erased when the module is stripped.
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && named !== undefined && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)));
      facts.imports.push({ spec: node.moduleSpecifier.text, typeOnly });
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      facts.imports.push({ spec: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    }
    if (node.parent !== undefined && ts.isSourceFile(node.parent) && ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) exported.push(d.name.getText());
      else if ("name" in node && node.name !== undefined && ts.isIdentifier(node.name as ts.Node)) exported.push((node.name as ts.Identifier).text);
    }
    if (isTest) {
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isArrayLiteralExpression(node)) {
      const top = outer(node);
      const argOfCall = ts.isCallExpression(top.parent) && top.parent.arguments.includes(top as ts.Expression);
      const strings = node.elements.map(stringValue);
      // An argument vector mixes flags with words (`["diff", "--name-only", "-z"]`): a command, not a list.
      const argvLike = strings.some((s) => s?.startsWith("-")) && !strings.every((s) => s?.startsWith("-"));
      if (!argOfCall && !argvLike && strings.length >= 2 && strings.every((s) => s !== undefined)) {
        const isSet = top !== node && ts.isNewExpression(top);
        addSet({ file, line: lineOf(sf, node), name: declName(node), form: isSet ? "set" : "array", members: strings as string[], origin: `${file}:${node.pos}`, checked: false });
      }
      // Columns: an array of tuples, or of records, holding a string in the same place.
      const rows = node.elements;
      const argvRows = rows.some((r) => ts.isArrayLiteralExpression(r) && r.elements.some((e) => stringValue(e)?.startsWith("-") === true));
      if (rows.length >= 2 && !argvRows && rows.every((r) => ts.isArrayLiteralExpression(r))) {
        const width = Math.min(...rows.map((r) => (r as ts.ArrayLiteralExpression).elements.length));
        for (let c = 0; c < width; c++) {
          const col = rows.map((r) => stringValue((r as ts.ArrayLiteralExpression).elements[c]!));
          if (col.every((s) => s !== undefined)) addSet({ file, line: lineOf(sf, node), name: `${declName(node)}[][${c}]`, form: "column", members: col as string[], origin: `${file}:${node.pos}`, checked: false });
        }
      }
      if (rows.length >= 2 && rows.every((r) => ts.isObjectLiteralExpression(r))) {
        const first = rows[0] as ts.ObjectLiteralExpression;
        for (const prop of first.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = propName(prop.name);
          if (key === undefined) continue;
          const col = rows.map((r) => {
            const p = (r as ts.ObjectLiteralExpression).properties.find((q) => ts.isPropertyAssignment(q) && propName(q.name) === key) as ts.PropertyAssignment | undefined;
            return p === undefined ? undefined : stringValue(p.initializer);
          });
          if (col.every((s) => s !== undefined)) addSet({ file, line: lineOf(sf, node), name: `${declName(node)}[].${key}`, form: "column", members: col as string[], origin: `${file}:${node.pos}`, checked: false });
        }
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      const props = node.properties.filter(ts.isPropertyAssignment);
      const keys = props.map((p) => propName(p.name));
      const literalValues = props.every((p) => {
        const v = p.initializer;
        return ts.isStringLiteralLike(v) || ts.isNumericLiteral(v) || ts.isArrayLiteralExpression(v) || v.kind === ts.SyntaxKind.TrueKeyword || v.kind === ts.SyntaxKind.FalseKeyword || v.kind === ts.SyntaxKind.NullKeyword;
      });
      // Inside a function an object literal is a shape (an answer, an options bag), not a list.
      const kept = atModuleScope(node) && props.length === node.properties.length;
      if (kept && keys.every((k) => k !== undefined)) {
        // A dispatch table, whose every value calls the function its key names, is bound by code: the keys are the dispatch's verbs.
        const dispatch = props.filter((p) => new RegExp(`\\b${(propName(p.name) ?? "").replace(/[^\w$]/g, "")}\\b`).test(p.initializer.getText())).length >= 0.8 * props.length && !literalValues;
        const checked = checkedKeys(node) || dispatch;
        addSet({ file, line: lineOf(sf, node), name: `${declName(node)} keys`, form: "keys", members: keys as string[], origin: `${file}:${node.pos}`, checked });
        const values = props.map((p) => stringValue(p.initializer));
        if (values.every((v) => v !== undefined)) addSet({ file, line: lineOf(sf, node), name: `${declName(node)} values`, form: "values", members: values as string[], origin: `${file}:${node.pos}`, checked: false });
      }
    }

    if (ts.isRegularExpressionLiteral(node)) {
      const source = node.text.slice(1, node.text.lastIndexOf("/"));
      for (const alts of regexAlternations(source)) addSet({ file, line: lineOf(sf, node), name: `${declName(node)} /…/`, form: "alternation", members: alts, origin: `${file}:${node.pos}:${alts.join("|")}`, checked: false });
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const parentIsImport = ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent);
      if (!parentIsImport) {
        for (const alt of stringAlternations(node.text)) addSet({ file, line: lineOf(sf, node), name: `${declName(node)} ${alt.label}`.trim(), form: "alternation", members: alt.members, origin: `${file}:${node.pos}:${alt.members.join("|")}`, checked: false });
      }
    }

    // A union passed as a type argument (`Omit<T, "from" | "to">`) names members of another type: a selection, not a list.
    if (ts.isUnionTypeNode(node) && !ts.isTypeReferenceNode(node.parent) && !ts.isExpressionWithTypeArguments(node.parent)) {
      const lits = node.types.map((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : undefined));
      if (lits.every((l) => l !== undefined)) {
        let name = "<union>";
        for (let at: ts.Node = node.parent; at !== undefined && !ts.isSourceFile(at); at = at.parent) {
          if (ts.isTypeAliasDeclaration(at) || ts.isPropertySignature(at) || ts.isParameter(at) || ts.isVariableDeclaration(at)) {
            name = at.name.getText();
            break;
          }
        }
        addSet({ file, line: lineOf(sf, node), name, form: "union", members: lits as string[], origin: `${file}:${node.pos}`, checked: false });
      }
    }

    if (ts.isSwitchStatement(node)) {
      const labels = node.caseBlock.clauses.filter(ts.isCaseClause).map((c) => stringValue(c.expression));
      const strings = labels.filter((l): l is string => l !== undefined);
      if (strings.length >= 2 && strings.length === labels.length) {
        addSet({ file, line: lineOf(sf, node), name: `${enclosingFunction(node)}: switch (${node.expression.getText().slice(0, 30)})`, form: "cases", members: strings, origin: `${file}:${node.pos}`, checked: scriptKind(file) === ts.ScriptKind.TS && exhaustiveSwitch(node), open: node.caseBlock.clauses.some(ts.isDefaultClause) });
      }
    }

    // The keys one file reads off one object by string: `record["testMatch"]`.
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      const target = node.expression.getText();
      const entry = reads.get(target) ?? { keys: [], line: lineOf(sf, node) };
      entry.keys.push(node.argumentExpression.text);
      reads.set(target, entry);
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!isTest) {
    if (exported.length >= 2) addSet({ file, line: 1, name: "exports", form: "exports", members: exported, origin: `${file}:exports`, checked: false });
    for (const [target, entry] of reads) addSet({ file, line: entry.line, name: `${target}["…"]`, form: "reads", members: entry.keys, origin: `${file}:reads:${target}`, checked: false });
  }
}

/* -------------------------------------------------------- docs: candidates */

function readDoc(file: string, text: string): void {
  const lines = text.split("\n");
  let table: { line: number; keys: string[]; heading: string } | undefined;
  let heading = "";
  const flushTable = (): void => {
    if (table !== undefined) addSet({ file, line: table.line, name: `table under "${table.heading}"`, form: "doc-table", members: table.keys, origin: `${file}:table:${table.line}`, checked: false });
    table = undefined;
  };
  lines.forEach((raw, index) => {
    const n = index + 1;
    if (/^#+ /.test(raw)) heading = raw.replace(/^#+ /, "").slice(0, 50);
    // Tables: the backticked names in each row's first cell.
    if (/^\|/.test(raw)) {
      const cell = raw.split("|")[1] ?? "";
      const names = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
      if (names.length > 0) {
        table ??= { line: n, keys: [], heading };
        table.keys.push(...names);
      }
    } else flushTable();
    for (const alt of stringAlternations(raw)) addSet({ file, line: n, name: `${heading} ${alt.label}`.trim(), form: "doc-alternation", members: alt.members, origin: `${file}:${n}:${alt.members.join("|")}`, checked: false });
    // Prose enumerations of short single tokens: "review, ci, probe, adopter, self or test".
    for (const m of raw.matchAll(/(?:\b[\w-]{1,24}\b, ){2,}\b[\w-]{1,24}\b,? (?:or|and) \b[\w-]{1,24}\b/g)) {
      const members = m[0].split(/,? (?:or|and) |, /).map((s) => s.trim());
      addSet({ file, line: n, name: `${heading} (prose)`, form: "prose", members, origin: `${file}:${n}:${m.index}`, checked: false });
    }
  });
  flushTable();
}

for (const [file, text] of texts) {
  if (CODE_FILE.test(file)) readCode(file, text);
  else if (/(^docs\/|\.spec\.md$|^README\.md$)/.test(file)) readDoc(file, text);
}
mark = phase("candidates", mark);

/* --------------------------------------------------------- the universes */

const tracked = new Set(paths);
const filesByDir = new Map<string, string[]>();
for (const p of paths) {
  if (!CODE_FILE.test(p) && !DOC_FILE.test(p)) continue;
  const d = dirname(p);
  filesByDir.set(d, [...(filesByDir.get(d) ?? []), p]);
}
for (const [dir, files] of filesByDir) {
  const own = files.filter((f) => !TEST_FILE.test(f) && CODE_FILE.test(f));
  addSet({ file: dir, line: 0, name: `files in ${dir}/`, form: "folder", members: own.map((f) => basename(f)), origin: `folder:${dir}`, checked: false });
}

function resolveImport(from: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(dirname(from), spec));
  for (const c of [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}/index.ts`]) if (tracked.has(c)) return c;
  return undefined;
}

/** Every file the starts import, transitively, staying inside the folders they are in. */
function closure(starts: string[], dirs: ReadonlySet<string>): string[] {
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length > 0) {
    const at = queue.pop()!;
    for (const imp of modules.get(at)?.imports ?? []) {
      if (imp.typeOnly) continue;
      const to = resolveImport(at, imp.spec);
      if (to === undefined || !dirs.has(dirname(to)) || TEST_FILE.test(to) || seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return [...seen];
}

/**
 * A list of files: every member resolves to a tracked code file from one home
 * folder (`html.ts`, `../../spec/covers.ts`), or from src/ (`enforcement/record.ts`).
 */
function filesNamed(members: string[]): { home: string; files: string[]; spell: (file: string) => string } | undefined {
  if (!members.every((m) => CODE_FILE.test(m))) return undefined;
  for (const home of filesByDir.keys()) {
    const files = members.map((m) => posix.normalize(`${home}/${m}`));
    if (files.every((f) => tracked.has(f))) return { home, files, spell: (f) => posix.relative(home, f) };
  }
  const fromSrc = members.map((m) => `src/${m}`);
  if (fromSrc.every((f) => tracked.has(f))) return { home: "src", files: fromSrc, spell: (f) => posix.relative("src", f) };
  return undefined;
}

const closureFiles = new Map<number, Map<string, string>>();
const hasClosure = new Set<number>();
const literalCount = sets.length;
for (const s of sets.slice(0, literalCount)) {
  if (DERIVED.has(s.form)) continue;
  const named = filesNamed(s.members);
  if (named === undefined) continue;
  const reach = closure(named.files, new Set(named.files.map((f) => dirname(f))));
  // Kept even when equal: a list that equals its closure is the latent case, right today and kept by hand.
  const id = sets.length;
  addSet({ file: named.home, line: 0, name: `import closure of ${s.name} (${s.file}:${s.line})`, form: "closure", members: reach.map(named.spell), origin: `closure:${s.id}`, checked: false });
  if (sets.length > id) closureFiles.set(id, new Map(reach.map((f) => [named.spell(f), f])));
  hasClosure.add(s.id);
}
for (const [dir, files] of filesByDir) {
  const index = files.find((f) => basename(f) === "index.ts");
  if (index === undefined) continue;
  const id = sets.length;
  const reach = closure([index], new Set([dir]));
  addSet({ file: index, line: 0, name: `import closure of ${index}`, form: "closure", members: reach.map((f) => basename(f)), origin: `closure:${index}`, checked: false });
  if (sets.length > id) closureFiles.set(id, new Map(reach.map((f) => [basename(f), f])));
}
mark = phase("universes", mark);

/* --------------------------------------------------------------- matching */

/** Strip the affix every member shares (`.coherence/`, `-`, `.ts`) so `.coherence/journal` meets `journal`. */
function stripped(members: string[]): string[] | undefined {
  if (members.length < 2) return undefined;
  let pre = members[0]!;
  let suf = members[0]!;
  for (const m of members) {
    while (!m.startsWith(pre)) pre = pre.slice(0, -1);
    while (!m.endsWith(suf)) suf = suf.slice(1);
  }
  // Only affixes that end (or start) at a separator, so `runs`/`run-index` keep their stems.
  pre = pre.replace(/[^/.\-_:]*$/, "");
  suf = suf.replace(/^[^/.\-_:]*/, "");
  if (pre === "" && suf === "") return undefined;
  const out = members.map((m) => m.slice(pre.length, m.length - suf.length));
  if (out.some((m) => m === "") || new Set(out).size !== out.length) return undefined;
  return out;
}

interface Variant {
  set: number;
  members: string[];
  strippedForm: boolean;
}
const variants: Variant[] = [];
for (const s of sets) {
  variants.push({ set: s.id, members: s.members, strippedForm: false });
  const st = stripped(s.members);
  if (st !== undefined) variants.push({ set: s.id, members: st, strippedForm: true });
}

// Rarity: a member few sets hold is evidence; `id` or `name` is not.
const df = new Map<string, number>();
for (const s of sets) for (const m of new Set([...s.members, ...(stripped(s.members) ?? [])])) df.set(m, (df.get(m) ?? 0) + 1);
const N = sets.length;
const idf = (m: string): number => Math.log(1 + N / (df.get(m) ?? 1));

const index = new Map<string, number[]>();
variants.forEach((v, i) => {
  for (const m of v.members) index.set(m, [...(index.get(m) ?? []), i]);
});

type Verdict = "drifted" | "latent" | "duplicate";

interface Finding {
  a: NameSet;
  b: NameSet;
  verdict: Verdict;
  shared: string[];
  onlyA: string[];
  onlyB: string[];
  /** A third set that accounts for the difference: A is B together with it. */
  union?: NameSet;
  jaccard: number;
  containment: number;
  overlap: number;
  history?: History;
  /** Every set equal to the first side, and to the second: the copies one finding stands for. */
  copiesA: NameSet[];
  copiesB: NameSet[];
  score: number;
}

interface History {
  together: string[];
  lagged: string[];
  missed: { commit: string; subject: string; member: string; side: "a" | "b" }[];
}

const pairBest = new Map<string, { va: Variant; vb: Variant; shared: string[] }>();
for (let i = 0; i < variants.length; i++) {
  const va = variants[i]!;
  const counts = new Map<number, number>();
  for (const m of va.members) for (const j of index.get(m) ?? []) if (j > i) counts.set(j, (counts.get(j) ?? 0) + 1);
  for (const [j, n] of counts) {
    if (n < 2) continue;
    const vb = variants[j]!;
    if (va.set === vb.set) continue;
    const A = sets[va.set]!;
    const B = sets[vb.set]!;
    if (A.origin === B.origin) continue;
    const literalA = !DERIVED.has(A.form) && !A.checked;
    const literalB = !DERIVED.has(B.form) && !B.checked;
    if (!literalA && !literalB) continue;
    // Prose against prose is two documents agreeing; a mirror reading wants code on one side.
    if (DOC_FORMS.has(A.form) && DOC_FORMS.has(B.form)) continue;
    // Doc prose that names some of a list is a mention, not a mirror: prose pairs only when near-equal (checked below).
    // A list of files that has its own import closure is read against that, not against its whole folder.
    if ((A.form === "folder" && hasClosure.has(B.id)) || (B.form === "folder" && hasClosure.has(A.id))) continue;
    const key = `${Math.min(A.id, B.id)}:${Math.max(A.id, B.id)}`;
    const setB = new Set(vb.members);
    const shared = va.members.filter((m) => setB.has(m));
    const prev = pairBest.get(key);
    if (prev === undefined || shared.length > prev.shared.length) pairBest.set(key, { va, vb, shared });
  }
}

const findings: Finding[] = [];
for (const { va, vb, shared } of pairBest.values()) {
  let A = sets[va.set]!;
  let B = sets[vb.set]!;
  let ma = va.members;
  let mb = vb.members;
  // The hand-kept side first.
  const literal = (s: NameSet): boolean => !DERIVED.has(s.form) && !s.checked;
  if (!literal(A) && literal(B)) {
    [A, B] = [B, A];
    [ma, mb] = [mb, ma];
  }
  const sb = new Set(mb);
  const sa = new Set(ma);
  const onlyA = ma.filter((m) => !sb.has(m));
  const onlyB = mb.filter((m) => !sa.has(m));
  const union = new Set([...ma, ...mb]).size;
  const jaccard = shared.length / union;
  const containment = shared.length / Math.min(ma.length, mb.length);
  const overlap = shared.reduce((n, m) => n + idf(m), 0);
  const bothLiteral = literal(A) && literal(B);
  let verdict: Verdict | undefined;
  if (onlyA.length === 0 && onlyB.length === 0) verdict = bothLiteral ? "duplicate" : "latent";
  else if (containment >= 0.8 && jaccard >= 0.3) verdict = bothLiteral && jaccard >= 0.6 ? "duplicate" : "drifted";
  // A switch with a default that handles a subset of a list is choosing, not mirroring.
  const openSubset = (s: NameSet, only: string[]): boolean => s.form === "cases" && s.open === true && only.length === 0;
  if (openSubset(A, onlyA) || openSubset(B, onlyB)) verdict = undefined;
  if ((DOC_FORMS.has(A.form) || DOC_FORMS.has(B.form)) && jaccard < 0.6) verdict = undefined;
  if (verdict === undefined && !ALL) continue;
  findings.push({ a: A, b: B, verdict: verdict ?? "drifted", shared, onlyA, onlyB, jaccard, containment, overlap, score: 0, copiesA: [], copiesB: [] });
}

// Copies: sets equal to one another form one cluster, so twelve copies of KINDS are one finding, not sixty-six.
const parent = sets.map((_, i) => i);
const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
for (const f of findings) if (f.onlyA.length === 0 && f.onlyB.length === 0) parent[find(f.a.id)] = find(f.b.id);
const clusterOf = new Map<number, NameSet[]>();
for (const s of sets) clusterOf.set(find(s.id), [...(clusterOf.get(find(s.id)) ?? []), s]);
{
  const kept = new Map<string, Finding>();
  for (const f of findings) {
    const ka = find(f.a.id);
    const kb = find(f.b.id);
    const key = ka === kb ? `${ka}` : `${Math.min(ka, kb)}:${Math.max(ka, kb)}`;
    f.copiesA = clusterOf.get(ka)!;
    f.copiesB = ka === kb ? [] : clusterOf.get(kb)!;
    const prev = kept.get(key);
    if (prev === undefined || f.overlap > prev.overlap || (f.overlap === prev.overlap && f.a.checked && !prev.a.checked)) kept.set(key, f);
  }
  findings.length = 0;
  for (const f of kept.values()) {
    const all = [...f.copiesA, ...f.copiesB];
    const literals = all.filter((s) => !DERIVED.has(s.form) && !s.checked && !DOC_FORMS.has(s.form));
    // A cluster all of whose copies but one are bound by code is not kept by hand.
    if (literals.length === 0) continue;
    // One literal and the rest held to it by the compiler (`Record<Kind, …>`, an exhaustive switch): the type is the derivation.
    const universes = all.filter((s) => DERIVED.has(s.form));
    if (literals.length === 1 && universes.length === 0 && f.onlyA.length === 0 && f.onlyB.length === 0) continue;
    if (f.copiesB.length === 0) f.verdict = literals.length >= 2 ? "duplicate" : "latent";
    findings.push(f);
  }
}
// A difference another set accounts for: RECORD_ID's alternation is KINDS' values together with WORK_KINDS'.
for (const f of findings) {
  if (f.onlyA.length === 0 && f.onlyB.length === 0) continue;
  const extra = f.onlyA.length > 0 && f.onlyB.length === 0 ? f.onlyA : f.onlyB.length > 0 && f.onlyA.length === 0 ? f.onlyB : undefined;
  if (extra === undefined) continue;
  const whole = new Set(extra === f.onlyA ? [...f.shared, ...f.onlyA] : [...f.shared, ...f.onlyB]);
  const first = extra[0]!;
  for (const vi of index.get(first) ?? []) {
    const v = variants[vi]!;
    const C = sets[v.set]!;
    if (C === f.a || C === f.b || find(C.id) === find(f.a.id) || find(C.id) === find(f.b.id)) continue;
    if (extra.every((m) => v.members.includes(m)) && v.members.every((m) => whole.has(m))) {
      f.union = C;
      f.verdict = "latent";
      break;
    }
  }
}
mark = phase("matching", mark);

/* ---------------------------------------------------------------- history */

interface FileDiff {
  added: string[];
  removed: string[];
  created: boolean;
}
interface Commit {
  sha: string;
  subject: string;
  files: Map<string, FileDiff>;
}

const commits: Commit[] = [];
if (HISTORY) {
  const log = git(["log", "-p", "--unified=0", "--no-merges", "--no-renames", "--format=@@@%H%x09%s", REV, "--", "src", "bench", ".github", "docs", "README.md", "package.json"]).toString("utf8");
  let commit: Commit | undefined;
  let file: FileDiff | undefined;
  for (const line of log.split("\n")) {
    if (line.startsWith("@@@")) {
      const [sha, subject] = line.slice(3).split("\t");
      commit = { sha: sha!, subject: subject ?? "", files: new Map() };
      commits.push(commit);
      file = undefined;
    } else if (line.startsWith("diff --git ") && commit !== undefined) {
      const path = line.slice(line.lastIndexOf(" b/") + 3);
      file = { added: [], removed: [], created: false };
      commit.files.set(path, file);
    } else if (file === undefined) continue;
    else if (line.startsWith("new file mode")) file.created = true;
    else if (line.startsWith("+++") || line.startsWith("---")) continue;
    else if (line.startsWith("+")) file.added.push(line.slice(1));
    else if (line.startsWith("-")) file.removed.push(line.slice(1));
  }
}
mark = phase("history-read", mark);

const quotedCache = new Map<string, RegExp>();
function mention(member: string, quoted: boolean): RegExp {
  const key = `${quoted}:${member}`;
  let re = quotedCache.get(key);
  if (re === undefined) {
    const esc = member.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    re = quoted ? new RegExp(`["'\`]${esc}["'\`]|\\b${esc}\\s*:|[|<(]${esc}[|>)]`) : new RegExp(`(^|[^\\w-])${esc}($|[^\\w-])`);
    quotedCache.set(key, re);
  }
  return re;
}

/** The commits that added the member to the set: a line naming it appeared where the set lives, and none naming it left. */
function growth(s: NameSet, member: string): string[] {
  const out: string[] = [];
  for (const c of commits) {
    switch (s.form) {
      case "folder": {
        const d = c.files.get(`${s.file}/${member}`);
        if (d?.created === true) out.push(c.sha);
        break;
      }
      case "closure": {
        // The closure grew by the member when a file of the closure began importing it.
        const files = closureFiles.get(s.id);
        const target = files?.get(member);
        if (files === undefined || target === undefined) break;
        const within = new Set([...files.values()]);
        for (const [path, d] of c.files) {
          if (!within.has(path) || path === target) continue;
          if (d.added.some((l) => /^\s*(import|export)\b.*from\s+["']/.test(l) && !/^\s*(import|export)\s+type\b/.test(l) && l.includes(`/${basename(target)}"`))) {
            out.push(c.sha);
            break;
          }
        }
        break;
      }
      default: {
        const d = c.files.get(s.file);
        if (d === undefined) break;
        const quoted = !["doc-alternation", "doc-table", "prose", "exports"].includes(s.form) && !(s.form === "alternation");
        const re = mention(member, quoted);
        const inAdded = d.added.some((l) => re.test(l));
        const inRemoved = d.removed.some((l) => re.test(l));
        if (inAdded && !inRemoved) out.push(c.sha);
      }
    }
  }
  return out;
}

function touches(s: NameSet, sha: string): boolean {
  const c = commits.find((x) => x.sha === sha);
  if (c === undefined) return false;
  if (DERIVED.has(s.form)) return true;
  return c.files.has(s.file);
}

const growthCache = new Map<string, string[]>();
function grown(s: NameSet, member: string, raw: string[]): string[] {
  const key = `${s.id}:${member}`;
  let out = growthCache.get(key);
  if (out === undefined) {
    // The member as the set spells it, when matching used the stripped form.
    const i = raw.indexOf(member);
    const spelled = i >= 0 ? s.members[i] ?? member : member;
    out = growth(s, spelled);
    growthCache.set(key, out);
  }
  return out;
}

/** The commits that added most of a set at once: where it was written, or copied, not where it was kept. */
function births(s: NameSet, view: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const m of view) for (const c of grown(s, m, view)) counts.set(c, (counts.get(c) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n >= Math.max(2, 0.6 * view.length)).map(([c]) => c));
}

if (HISTORY) {
  for (const f of findings) {
    const h: History = { together: [], lagged: [], missed: [] };
    const view = (s: NameSet, m: string): string[] => (s.members.includes(m) ? s.members : stripped(s.members) ?? s.members);
    const bornA = births(f.a, view(f.a, f.shared[0]!));
    const bornB = births(f.b, view(f.b, f.shared[0]!));
    for (const m of f.shared) {
      const ga = grown(f.a, m, view(f.a, m));
      const gb = grown(f.b, m, view(f.b, m));
      // Grew by the same name in the same commit, which was the birth of neither: someone kept them together.
      const both = ga.filter((c) => gb.includes(c) && !bornA.has(c) && !bornB.has(c));
      for (const c of both) if (!h.together.includes(c)) h.together.push(c);
      // Grew by the same name in different commits, neither a birth: someone caught one up to the other.
      const kept = (g: string[], born: Set<string>): boolean => g.some((c) => !born.has(c));
      if (both.length === 0 && kept(ga, bornA) && kept(gb, bornB) && !ga.some((c) => gb.includes(c))) h.lagged.push(m);
    }
    for (const [side, only, s, other] of [["b", f.onlyB, f.b, f.a], ["a", f.onlyA, f.a, f.b]] as const) {
      for (const m of only) {
        for (const sha of grown(s, m, view(s, m))) {
          if (!touches(other, sha)) h.missed.push({ commit: sha.slice(0, 7), subject: commits.find((c) => c.sha === sha)!.subject.slice(0, 70), member: m, side });
        }
      }
    }
    f.history = h;
  }
}
mark = phase("history-match", mark);

/* ---------------------------------------------------------------- ranking */

const VERDICT_WEIGHT: Record<Verdict, number> = { drifted: 1.2, latent: 1, duplicate: 1 };
for (const f of findings) {
  const shape = f.containment * (0.5 + 0.5 * f.jaccard);
  const overlapScore = f.overlap * shape * VERDICT_WEIGHT[f.verdict];
  const h = f.history;
  const historyScore = h === undefined ? 0 : 4 * Math.min(h.together.length, 5) + 2 * Math.min(h.lagged.length, 5);
  const all = [f.a, f.b, ...f.copiesA, ...f.copiesB];
  const literalFiles = new Set(all.filter((s) => !DERIVED.has(s.form)).map((s) => s.file));
  // A copy in another file is out of the editor's sight; one beside it is not.
  const spread = literalFiles.size > 1 || all.some((s) => DERIVED.has(s.form)) ? 1 : 0.5;
  const copies = Math.max(0, new Set(all).size - 2);
  f.score = overlapScore * spread * (1 + 0.25 * Math.min(copies, 4)) + historyScore;
  (f as Finding & { overlapScore: number; historyScore: number }).overlapScore = overlapScore;
  (f as Finding & { overlapScore: number; historyScore: number }).historyScore = historyScore;
}
findings.sort((x, y) => y.score - x.score);

/**
 * Groups: findings that share a cluster are one question for the reader
 * (seventeen pairings of the TypeScript extension lists are one group), so
 * the ranking is of groups, by their strongest finding.
 */
interface Group {
  findings: Finding[];
  score: number;
  overlapScore: number;
  historyScore: number;
}
const groupParent = new Map<number, number>();
const groupFind = (i: number): number => {
  const p = groupParent.get(i) ?? i;
  if (p === i) return i;
  const r = groupFind(p);
  groupParent.set(i, r);
  return r;
};
// Only a close pairing of two hand-kept lists joins groups; a universe or a loose overlap would chain everything.
const bridges = (f: Finding): boolean => f.jaccard >= 0.5 && !DERIVED.has(f.a.form) && !DERIVED.has(f.b.form);
for (const f of findings) {
  if (!bridges(f)) continue;
  const x = groupFind(find(f.a.id));
  const y = groupFind(find(f.b.id));
  if (x !== y) groupParent.set(x, y);
}
const groupOf = new Map<number, Group>();
for (const f of findings) {
  const k = groupFind(find(f.a.id));
  const grp = groupOf.get(k) ?? { findings: [], score: 0, overlapScore: 0, historyScore: 0 };
  grp.findings.push(f);
  const scored = f as Finding & { overlapScore: number; historyScore: number };
  grp.score = Math.max(grp.score, f.score);
  grp.overlapScore = Math.max(grp.overlapScore, scored.overlapScore);
  grp.historyScore = Math.max(grp.historyScore, scored.historyScore);
  groupOf.set(k, grp);
}
const groups = [...groupOf.values()].sort((x, y) => y.score - x.score);
mark = phase("ranking", mark);
const total = Math.round(performance.now() - t0);

/* ----------------------------------------------------------------- output */

const where = (s: NameSet): string => `${s.file}${s.line > 0 ? `:${s.line}` : ""} ${s.name} [${s.form}${s.checked ? ", checked" : ""}]`;

interface Truth {
  id: number;
  label: string;
  /** Each side: a file and a substring of the set's name. A group matches when one of its sets hits the first side and another set hits any other side. */
  sides: { file: string; name?: string; form?: Form }[];
}

function hits(s: NameSet, side: Truth["sides"][number]): boolean {
  return s.file === side.file && (side.name === undefined || s.name.includes(side.name)) && (side.form === undefined || s.form === side.form);
}

function groupHits(t: Truth, grp: Group): Finding | undefined {
  const first = t.sides[0]!;
  return grp.findings.find((f) => {
    const all = [f.a, f.b, ...f.copiesA, ...f.copiesB];
    return all.some((s) => hits(s, first)) && t.sides.some((y, j) => j !== 0 && all.some((s) => hits(s, y) && !hits(s, first)));
  });
}

function scoreTruth(truth: Truth[], ranked: Group[]): { id: number; label: string; rank?: number; finding?: string }[] {
  return truth.map((t) => {
    const rank = ranked.findIndex((grp) => groupHits(t, grp) !== undefined);
    const f = rank >= 0 ? groupHits(t, ranked[rank]!) : undefined;
    return { id: t.id, label: t.label, ...(f === undefined ? {} : { rank: rank + 1, finding: `${f.verdict}: ${f.a.file} ${f.a.name} ~ ${f.b.file} ${f.b.name}` }) };
  });
}

interface Label {
  /** A substring of some set's `file name` in the group; with exact, the whole of it. */
  exact?: boolean;
  match: string;
  /** hand-list: two places kept by hand that must agree, apart; weak: a true mirror beside its source or held by types; not: no mirror. */
  label: "hand-list" | "weak" | "not";
  why: string;
}
const LABELS = option("--labels");
const labels: Label[] = LABELS === undefined ? [] : JSON.parse(readFileSync(LABELS, "utf8"));
function labelOf(grp: Group): Label | undefined {
  const names = grp.findings.flatMap((f) => [f.a, f.b, ...f.copiesA, ...f.copiesB]).map((s) => `${s.file} ${s.name}`);
  return labels.find((l) => names.some((n) => (l.exact === true ? n === l.match : n.includes(l.match))));
}

const truth: Truth[] | undefined = TRUTH === undefined ? undefined : JSON.parse(readFileSync(TRUTH, "utf8"));

const byOverlap = [...groups].sort((x, y) => y.overlapScore - x.overlapScore);
const byHistory = groups.filter((f) => f.historyScore > 0).sort((x, y) => y.historyScore - x.historyScore);

function precisionAt(ranked: Group[], k: number): { k: number; hand: number; weak: number; not: number; unlabeled: number } {
  const top = ranked.slice(0, k).map(labelOf);
  const count = (label: Label["label"]): number => top.filter((l) => l?.label === label).length;
  return { k: Math.min(k, ranked.length), hand: count("hand-list"), weak: count("weak"), not: count("not"), unlabeled: top.filter((l) => l === undefined).length };
}

const slim = (f: Finding) => ({ verdict: f.verdict, score: Number(f.score.toFixed(2)), a: where(f.a), b: where(f.b), copies: [...f.copiesA, ...f.copiesB].filter((c) => c !== f.a && c !== f.b).map(where), shared: f.shared.length, onlyA: f.onlyA, onlyB: f.onlyB, union: f.union === undefined ? undefined : where(f.union), history: f.history });

if (JSON_OUT) {
  const out: Record<string, unknown> = { rev: REV, ms: total, phases, sets: sets.length, findings: findings.length, groups: groups.slice(0, LIMIT).map((grp) => ({ score: Number(grp.score.toFixed(2)), label: labelOf(grp), findings: grp.findings.map(slim) })) };
  if (truth !== undefined) out["truth"] = { both: scoreTruth(truth, groups), overlap: scoreTruth(truth, byOverlap), history: scoreTruth(truth, byHistory) };
  if (labels.length > 0) out["precision"] = { both: [10, 20, 40, groups.length].map((k) => precisionAt(groups, k)), overlap: [10, 20, 40].map((k) => precisionAt(byOverlap, k)), history: [10, 20, byHistory.length].map((k) => precisionAt(byHistory, k)) };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
} else {
  console.log(`mirror reading at ${REV}: ${sets.length} sets, ${findings.length} findings in ${groups.length} groups, ${total} ms (${Object.entries(phases).map(([k, v]) => `${k} ${v}`).join(", ")})\n`);
  groups.slice(0, LIMIT).forEach((grp, i) => {
    const label = labelOf(grp);
    console.log(`#${i + 1}  score ${grp.score.toFixed(1)}  ${grp.findings.length} finding(s)${label === undefined ? "" : `  [${label.label}: ${label.why}]`}`);
    for (const f of grp.findings.slice(0, ALL ? Infinity : 3)) printFinding(f);
    if (!ALL && grp.findings.length > 3) console.log(`  … and ${grp.findings.length - 3} more in this group`);
  });
  if (truth !== undefined) {
    console.log("\nrecall against the manual sweep (group rank):");
    const o = scoreTruth(truth, byOverlap);
    const h = scoreTruth(truth, byHistory);
    scoreTruth(truth, groups).forEach((r, i) => console.log(`  #${r.id} ${r.label}: ${r.rank === undefined ? "missed" : `rank ${r.rank}`} (overlap alone ${o[i]!.rank ?? "-"}, history alone ${h[i]!.rank ?? "-"})${r.finding === undefined ? "" : `  ${r.finding}`}`));
  }
  if (labels.length > 0) {
    console.log("\nprecision (groups labeled hand-list among the top k):");
    for (const [name, ranked] of [["both", groups], ["overlap", byOverlap], ["history", byHistory]] as const) console.log(`  ${name}: ${[10, 20, 40, ranked.length].map((k) => precisionAt(ranked, k)).map((p) => `@${p.k} ${p.hand} hand-list + ${p.weak} weak / ${p.k}${p.unlabeled > 0 ? ` (${p.unlabeled} unlabeled)` : ""}`).join(", ")}`);
  }
}

function printFinding(f: Finding): void {
  console.log(`  ${f.verdict.toUpperCase()}  score ${f.score.toFixed(1)}  shared ${f.shared.length}, J ${f.jaccard.toFixed(2)}`);
  console.log(`     ${where(f.a)}`);
  console.log(`     ${where(f.b)}`);
  for (const c of [...f.copiesA, ...f.copiesB]) if (c !== f.a && c !== f.b) console.log(`     copy: ${where(c)}`);
  if (f.union !== undefined) console.log(`     = together with ${where(f.union)}`);
  if (f.onlyA.length > 0) console.log(`     only in the first: ${f.onlyA.join(", ")}`);
  if (f.onlyB.length > 0) console.log(`     only in the second: ${f.onlyB.join(", ")}`);
  const h = f.history;
  if (h !== undefined && h.together.length + h.lagged.length + h.missed.length > 0) {
    console.log(`     history: kept together in ${h.together.length} commit(s); ${h.lagged.length} shared name(s) caught up later`);
    for (const m of h.missed.slice(0, 3)) console.log(`     missed: ${m.commit} added ${m.member} to the ${m.side === "a" ? "first" : "second"} alone (${m.subject})`);
  }
}
