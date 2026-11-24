/**
 * Restatements (c-74956e4e, rs-a454912d): one value at live sites in two or
 * more files, where no site imports it from another and no test, type or
 * declared mirror holds the copies equal. The value is a literal of 16 or
 * more characters, or a set of three or more members in any form the mirror
 * reading reads (an array, a Set, a regular-expression alternation, a union,
 * an object's keys, a manifest's data). Their number is the count a project
 * lowers by consolidating, and a held copy is not counted, so the count can
 * drop without the copy going away (d-fc099227).
 *
 * Pure over what the reading collected: no file, no git, no parser. The
 * lessons of the prototype that produced the rated ten, each measured:
 *
 *   Excluded: test files and frozen fixtures (never collected), values the
 *     compiler holds (a member of a string-literal type), prose (four or more
 *     spaces) unless bound to a named constant in two or more files, and
 *     protocol or vocabulary strings (URLs, MIME types, LSP methods).
 *   Held: a site's file imports the other's list by name from it, a test
 *     names a site's file and its list (or its value), or a spec declares the
 *     pair a mirror.
 *   Ranked: sets that differ by exactly one member with three or more
 *     shared (live drift), then one value bound to a named constant in two or
 *     more files, then the rest by size.
 *   Source: one module the rest import when every site can import it;
 *     otherwise the owning plugin's manifest for a language's fact, read
 *     through the registry, or a test that holds the copies equal.
 */

import { basename, posix } from "node:path";
import { MANIFEST } from "../../plugins/plugin.ts";
import { DERIVED, DOC_FORMS, type Finding, type Restatement, type RestatementKind, type RestatementSite, type SetRef } from "./model.ts";

/** A literal this long or longer is a value worth one source. */
export const VALUE_MIN = 16;
/** A set restates when this many members are shared: two-member sets were noise. */
export const SET_SHARED_MIN = 3;

/** One place a literal value is written. */
export interface ValueSite {
  file: string;
  line: number;
  /** The variable the literal initializes, when it initializes one. */
  bound?: string;
  exported: boolean;
}

/** One import of a module, resolved: `to` is the project file it names, undefined for a package or a built-in. */
export interface ImportFact {
  to: string | undefined;
  /** The names it binds (named imports and the default), type-only ones too: a type read off a list holds a copy to it. */
  names: string[];
  typeOnly: boolean;
}

/** A declared mirror's two sides, each `<file>:<NAME>`. */
export interface DeclaredPair {
  list: string;
  partner: string;
}

/** Two sets the matching paired, as a finding names them. */
export type SetPair = Pick<Finding, "a" | "b" | "shared" | "onlyA" | "onlyB" | "jaccard">;

export interface RestatementInput {
  /** Every pair the matching found, loose ones included. */
  pairs: readonly SetPair[];
  values: ReadonlyMap<string, readonly ValueSite[]>;
  /** Strings a literal type names: the compiler holds a value written as one of them. */
  typed: ReadonlySet<string>;
  /** Test files and their text. */
  tests: ReadonlyMap<string, string>;
  /** Every code file the reading parsed, and its imports, resolved. */
  imports: ReadonlyMap<string, readonly ImportFact[]>;
  /** Files the compiler does not check (`@ts-nocheck`, or plain JavaScript). */
  untyped: ReadonlySet<string>;
  /** The folders that hold a plugin manifest, and the manifest files themselves. */
  plugins: readonly string[];
  manifests: ReadonlySet<string>;
  declared: readonly DeclaredPair[];
}

/** Prose: four or more spaces between words. */
const PROSE = /(?:\S+\s+){4,}\S/;
/** Strings another party defines: URLs and schemes, MIME types, the language server protocol's methods, git commands, markup. */
const VOCABULARY = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:https?|node|data|file|mailto):|(?:application|text|image|audio|video|font|multipart)\/[\w.+-]+(?:;|$)|(?:textDocument|workspace|window|client|notebookDocument|callHierarchy|typeHierarchy|completionItem|codeAction|codeLens|documentLink|inlayHint|telemetry|\$)\/|git |--git|<svg|xmlns)/;
/** A member that names a file extension: a language's fact. */
const EXTENSION = /^\.[a-z0-9]{1,6}$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*/;

/** Whether a value is excluded before any site is weighed: the compiler holds it, or another party defines it. */
export function excludedValue(value: string, typed: ReadonlySet<string>): boolean {
  return typed.has(value) || VOCABULARY.test(value);
}

/** The name a set is declared by, when a reader could import or name it: `FOOT_KEYS` for "FOOT_KEYS keys" or "FOOT[].key"; none for a literal inside a function or a switch's labels. */
export function listName(s: SetRef): string | undefined {
  if (s.form === "cases") return undefined;
  return IDENTIFIER.exec(s.name)?.[0];
}

const word = (name: string): RegExp => new RegExp(`(^|[^\\w$])${name.replace(/[$]/g, "\\$")}($|[^\\w$])`);

interface Weigher {
  input: RestatementInput;
  /** The tests that name a file's basename. */
  testsNaming: (file: string) => string[];
}

function weigher(input: RestatementInput): Weigher {
  // One pass over each test for the file names it mentions, so a site costs a lookup, not a scan of every test.
  const byBase = new Map<string, string[]>();
  for (const [test, text] of input.tests) {
    for (const m of new Set(text.match(/[\w.-]+\.[a-z]{1,4}\b/g) ?? [])) {
      const at = byBase.get(m);
      if (at === undefined) byBase.set(m, [test]);
      else at.push(test);
    }
  }
  return { input, testsNaming: (file) => byBase.get(basename(file)) ?? [] };
}

/** Whether a site's file imports the other side's list by name from the other side's file. */
function importsNamed(w: Weigher, side: SetRef, other: SetRef): boolean {
  const name = listName(other);
  if (name === undefined) return false;
  return (w.input.imports.get(side.file) ?? []).some((i) => i.to === other.file && i.names.includes(name));
}

/** Whether a test names the side's file and its list: the copy is held by that test. */
function testHeld(w: Weigher, side: SetRef): boolean {
  const name = listName(side);
  if (name === undefined) return false;
  const re = word(name);
  return w.testsNaming(side.file).some((t) => re.test(w.input.tests.get(t)!));
}

function declaredHeld(w: Weigher, a: SetRef, b: SetRef): boolean {
  const na = listName(a);
  const nb = listName(b);
  if (na === undefined || nb === undefined) return false;
  const x = `${a.file}:${na}`;
  const y = `${b.file}:${nb}`;
  return w.input.declared.some((d) => (d.list === x && d.partner === y) || (d.list === y && d.partner === x));
}

/** Whether a set finding's copies are held equal: by an import of the list, by a test, or by a declared mirror. */
export function setHeld(w: Weigher, a: SetRef, b: SetRef): boolean {
  return importsNamed(w, a, b) || importsNamed(w, b, a) || testHeld(w, a) || testHeld(w, b) || declaredHeld(w, a, b);
}

/** Whether a test names a site's file and either the constant the value is bound to there or the value itself. */
function valueHeld(w: Weigher, value: string, sites: readonly ValueSite[]): boolean {
  return sites.some((s) => w.testsNaming(s.file).some((t) => {
    const text = w.input.tests.get(t)!;
    return text.includes(value) || (s.bound !== undefined && word(s.bound).test(text));
  }));
}

/* ------------------------------------------------------------------ source */

/** The part of the project a file belongs to: its plugin's folder, else its first folder. */
function regionOf(input: RestatementInput, file: string): string {
  const plugin = input.plugins.find((p) => file.startsWith(`${p}/`));
  if (plugin !== undefined) return plugin;
  const slash = file.indexOf("/");
  return slash < 0 ? "." : file.slice(0, slash);
}

type Reach = { ok: true; via?: string } | { ok: false; why: string };

/** Whether `from` could import a value from `source`: as its neighbors do, or through the one module it already reaches that part of the project by. */
function reach(input: RestatementInput, from: string, source: string): Reach {
  if (from === source) return { ok: true };
  if (input.untyped.has(from)) return { ok: false, why: `${from} is not type-checked` };
  if (input.manifests.has(from)) return { ok: false, why: `${from} is a manifest, which imports nothing` };
  const imports = (input.imports.get(from) ?? []).filter((i) => !i.typeOnly);
  const project = imports.filter((i) => i.to !== undefined);
  // A file that imports packages and nothing of the project's is kept self-contained (a status line, a standalone script).
  if (project.length === 0 && imports.length > 0) return { ok: false, why: `${from} imports nothing of the project's` };
  const region = regionOf(input, source);
  if (regionOf(input, from) === region) return { ok: true };
  const into = [...new Set(project.map((i) => i.to!).filter((to) => regionOf(input, to) === region))];
  if (into.length === 0) return { ok: false, why: `${from} imports nothing from ${region}/` };
  return into.length === 1 && into[0] !== source ? { ok: true, via: into[0]! } : { ok: true };
}

/** Where the value would live once, for these sites. `preferred` are the sites that bind it to an exported name, then to any name. */
const IMPORTERS = new WeakMap<RestatementInput, Map<string, Set<string>>>();

/** For each part of the project, the other parts that import from it: a part others import is a better source than one nothing imports (a separate package, a bench). */
function importersOf(input: RestatementInput): Map<string, Set<string>> {
  let out = IMPORTERS.get(input);
  if (out !== undefined) return out;
  out = new Map();
  for (const [from, imports] of input.imports) {
    for (const i of imports) {
      if (i.to === undefined || regionOf(input, i.to) === regionOf(input, from)) continue;
      const at = out.get(regionOf(input, i.to)) ?? new Set<string>();
      at.add(regionOf(input, from));
      out.set(regionOf(input, i.to), at);
    }
  }
  IMPORTERS.set(input, out);
  return out;
}

export function sourceOf(input: RestatementInput, files: readonly string[], preferred: readonly string[], members: readonly string[] = []): string {
  const unique = [...new Set(files)];
  const untyped = unique.filter((f) => input.untyped.has(f));
  if (untyped.length > 0) return `hold the copies equal by a test: ${untyped.join(", ")} ${untyped.length === 1 ? "is" : "are"} not type-checked`;
  const manifests = unique.filter((f) => input.manifests.has(f));
  if (manifests.length > 0) return `the plugin's manifest (${manifests.join(" or ")}), read through the registry, where the code that copies it reads it`;
  const plugins = [...new Set(unique.map((f) => regionOf(input, f)).filter((r) => input.plugins.includes(r)))];
  const languageFact = members.length > 0 && members.every((m) => EXTENSION.test(m));
  if (languageFact && plugins.length > 0 && unique.some((f) => !plugins.includes(regionOf(input, f)) || plugins.length > 1)) {
    return `the owning plugin's manifest (${plugins.map((p) => posix.join(p, MANIFEST)).join(" or ")}), read through the registry: the core names no language`;
  }
  const importedBy = importersOf(input);
  const reachBy = (f: string): number => importedBy.get(regionOf(input, f))?.size ?? 0;
  const rankOf = (f: string): number => (preferred.indexOf(f) < 0 ? Infinity : preferred.indexOf(f));
  const order = [...unique].sort((x, y) => rankOf(x) - rankOf(y) || reachBy(y) - reachBy(x) || x.localeCompare(y));
  let best: { source: string; reaches: [string, Reach][]; ok: number } | undefined;
  for (const source of order) {
    const reaches = unique.filter((f) => f !== source).map((f) => [f, reach(input, f, source)] as [string, Reach]);
    const ok = reaches.filter(([, r]) => r.ok).length;
    if (ok === reaches.length) {
      const via = reaches.flatMap(([f, r]) => (r.ok && r.via !== undefined ? [`${f} through ${r.via}`] : []));
      return `one module, ${source}, imported by the rest${via.length === 0 ? "" : ` (${via.join("; ")})`}`;
    }
    if (best === undefined || ok > best.ok || (ok === best.ok && reachBy(source) > reachBy(best.source))) best = { source, reaches, ok };
  }
  const blocked = (best?.reaches ?? []).flatMap(([, r]) => (r.ok ? [] : [r.why]));
  return `one source, ${best?.source ?? unique[0]}, and a test that holds the other copies equal to it: ${blocked.join("; ")}`;
}

/* --------------------------------------------------------------- finding */

/** A side in a code file the reading parsed, or in a manifest: a doc, a folder or an import closure is no copy. */
const sideOk = (input: RestatementInput, s: SetRef): boolean => !DERIVED.has(s.form) && !DOC_FORMS.has(s.form) && s.line > 0 && (input.imports.has(s.file) || input.manifests.has(s.file));

function siteOfSet(s: SetRef): RestatementSite {
  const name = listName(s);
  return { file: s.file, line: s.line, ...(name === undefined ? {} : { name }) };
}

export interface Restatements {
  restatements: Restatement[];
  held: number;
}

const ORDER: Record<RestatementKind, number> = { drift: 0, constant: 1, copy: 2, literal: 2 };

/** The restatements in a reading, ranked: the unheld ones, and how many were held. */
export function restatementsOf(input: RestatementInput): Restatements {
  const w = weigher(input);
  const out: Restatement[] = [];
  let held = 0;

  const seen = new Set<string>();
  for (const f of input.pairs) {
    const { a, b } = f;
    if (a.file === b.file || !sideOk(input, a) || !sideOk(input, b)) continue;
    if (a.checked && b.checked) continue;
    if (f.shared.length < SET_SHARED_MIN) continue;
    const diff = f.onlyA.length + f.onlyB.length;
    if (diff > 1 || (diff === 0 && f.jaccard < 1)) continue;
    const key = `${[a.file, b.file].sort().join("|")}|${[...f.shared].sort().join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (setHeld(w, a, b)) {
      held++;
      continue;
    }
    const preferred = [a, b].filter((s) => listName(s) !== undefined).map((s) => s.file);
    const source = sourceOf(input, [a.file, b.file], preferred, f.shared);
    const sites = [siteOfSet(a), siteOfSet(b)];
    if (diff === 1) {
      const member = (f.onlyA[0] ?? f.onlyB[0])!;
      const lacks = f.onlyA.length > 0 ? b : a;
      out.push({ kind: "drift", value: f.shared.join(", "), members: f.shared, odd: { member, lacks: `${lacks.file}:${lacks.line}` }, sites, source, score: 2000 + f.shared.length });
    } else {
      out.push({ kind: "copy", value: f.shared.join(", "), members: f.shared, sites, source, score: 500 + 10 * f.shared.length });
    }
  }

  for (const [value, sites] of input.values) {
    const files = [...new Set(sites.map((s) => s.file))];
    if (files.length < 2 || excludedValue(value, input.typed)) continue;
    const boundFiles = new Set(sites.filter((s) => s.bound !== undefined).map((s) => s.file));
    if (PROSE.test(value) && boundFiles.size < 2) continue;
    if (valueHeld(w, value, sites)) {
      held++;
      continue;
    }
    // One site per file, the first, named by its constant when any site there binds one.
    const shown = files.map((file) => {
      const here = sites.filter((s) => s.file === file);
      const bound = here.find((s) => s.bound !== undefined);
      const site = bound ?? here[0]!;
      return { file, line: site.line, ...(bound?.bound === undefined ? {} : { name: bound.bound }) };
    });
    const preferred = [...sites.filter((s) => s.exported && s.bound !== undefined), ...sites.filter((s) => s.bound !== undefined)].map((s) => s.file);
    const constant = boundFiles.size >= 2;
    out.push({ kind: constant ? "constant" : "literal", value, sites: shown, source: sourceOf(input, files, preferred), score: (constant ? 1000 : 0) + sites.length * Math.min(value.length, 60) });
  }

  out.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || y.score - x.score || x.value.localeCompare(y.value));
  return { restatements: out, held };
}
