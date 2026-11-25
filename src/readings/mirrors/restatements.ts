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
 *   Excluded: the project's test files (by the rule every reading shares)
 *     and frozen fixtures (never collected), values the compiler holds (a
 *     member of a string-literal type), prose (four or more spaces) unless
 *     bound to a named constant in two or more files, protocol or vocabulary
 *     strings (URLs, MIME types, LSP methods, HTTP header names and status
 *     reason phrases), and the keys of two objects one named type holds (the
 *     same type, or a shape they differ from only in its optional fields).
 *   Excluded by config: what the project's restatements key names (data
 *     files, standalone scripts, deliberate shared values) is counted apart,
 *     by the entry that excluded it, so the count it lowers never reads as a
 *     fix.
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
import { parseRegex, predicateOf, regexAtoms, rulesOf, wordsIn, type PredicateSite } from "./predicates.ts";
import { RARITY_MIN, type Rarity } from "./rarity.ts";
import { DERIVED, DOC_FORMS, type Exclusion, type Finding, type HeldCopy, type Restatement, type RestatementKind, type RestatementSite, type SetRef } from "./model.ts";


/** One place a literal value is written. */
export interface ValueSite {
  file: string;
  line: number;
  /** The variable the literal initializes, when it initializes one. */
  bound?: string;
  exported: boolean;
  /** Written as a regular expression's source. */
  regex?: boolean;
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

/** A type's fields as its declarations write them: an interface, or a type alias of an object type. */
export interface Shape {
  fields: string[];
  /** The fields written with `?`. */
  optional: string[];
  /** An index signature: the type is a set keyed by its members, not a record of fields. */
  indexed: boolean;
  /** The named types it extends or intersects, whose fields it has too. */
  bases: string[];
}

/** The config's restatements key, each entry matched: a glob as a file test, a pattern as a value test. */
export interface Exclusions {
  data: readonly { entry: string; test: (file: string) => boolean }[];
  scripts: readonly { entry: string; test: (file: string) => boolean }[];
  values: readonly { entry: string; test: (value: string) => boolean }[];
}

export const NO_EXCLUSIONS: Exclusions = { data: [], scripts: [], values: [] };

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
  /** The fields of each type the project declares, by name. */
  shapes: ReadonlyMap<string, readonly Shape[]>;
  exclusions: Exclusions;
  /** What a value says, in bits, under the project's background and the prior. */
  rarity: Rarity;
  /** Every predicate the parse found. */
  predicates: readonly PredicateSite[];
  /** Every function that reads text into a named type, with the fields its guard checks. */
  parsers: readonly ParserSite[];
  /** The project's own string literals: probes for its rules. */
  literals: readonly string[];
  /** The comments that declare a copy different on purpose, by file. */
  declarations: ReadonlyMap<string, readonly { line: number; home: string; why: string }[]>;
  /** Each tracked file's blob at the revision: what a witnessed hold is keyed by. */
  blobs: ReadonlyMap<string, string>;
  /** A witnessed hold's verdict by its key: red (the test held the copy), green (it did not), none yet. */
  witnessed: (key: string) => "red" | "green" | undefined;
  /** The class the reading derives for a file it leaves out of a restatement's sites: generated, a migration, an example app. */
  derived?: (file: string) => Exclusion | undefined;
  /** Every package name the project's package.json files name: the registry's vocabulary. */
  packages?: ReadonlySet<string>;
  /** Every string the platform's typings write (TypeScript's library, @types/node): the platform's vocabulary. */
  platform?: ReadonlySet<string>;
  /** Where history places the copies: 2 changed apart, 3 changed together, 4 never changed; none without history. */
  standingOf?: (needles: readonly string[], files: readonly string[]) => number;
}

/** A function that reads text into a named type: the type, and the fields its guard checks. */
export interface ParserSite {
  file: string;
  line: number;
  name: string;
  exported: boolean;
  type: string;
  fields: string[];
}

/**
 * HTTP's own vocabulary, which RFC 9110 and the registries define, not the
 * project: the header names and the status codes' reason phrases, compared
 * without case. A project that writes `WWW-Authenticate` or "Internal Server
 * Error" in two files is speaking the protocol, not keeping a value by hand.
 */
const HTTP_VOCABULARY: ReadonlySet<string> = new Set([
  "accept", "accept-charset", "accept-encoding", "accept-language", "accept-patch", "accept-post", "accept-ranges",
  "access-control-allow-credentials", "access-control-allow-headers", "access-control-allow-methods", "access-control-allow-origin",
  "access-control-expose-headers", "access-control-max-age", "access-control-request-headers", "access-control-request-method",
  "age", "allow", "alt-svc", "authorization", "cache-control", "clear-site-data", "connection", "content-disposition", "content-encoding",
  "content-language", "content-length", "content-location", "content-range", "content-security-policy", "content-security-policy-report-only",
  "content-type", "cookie", "cross-origin-embedder-policy", "cross-origin-opener-policy", "cross-origin-resource-policy", "date", "etag",
  "expect", "expires", "forwarded", "from", "host", "if-match", "if-modified-since", "if-none-match", "if-range", "if-unmodified-since",
  "keep-alive", "last-modified", "link", "location", "max-forwards", "origin", "permissions-policy", "pragma", "proxy-authenticate",
  "proxy-authorization", "range", "referer", "referrer-policy", "retry-after", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site",
  "sec-fetch-user", "sec-websocket-accept", "sec-websocket-extensions", "sec-websocket-key", "sec-websocket-protocol", "sec-websocket-version",
  "server", "server-timing", "set-cookie", "strict-transport-security", "te", "timing-allow-origin", "trailer", "transfer-encoding", "upgrade",
  "upgrade-insecure-requests", "user-agent", "vary", "via", "www-authenticate", "x-content-type-options", "x-forwarded-for", "x-forwarded-host",
  "x-forwarded-proto", "x-frame-options", "x-requested-with", "x-xss-protection",
  "continue", "switching protocols", "processing", "early hints", "ok", "created", "accepted", "non-authoritative information", "no content",
  "reset content", "partial content", "multi-status", "already reported", "im used", "multiple choices", "moved permanently", "found",
  "see other", "not modified", "use proxy", "temporary redirect", "permanent redirect", "bad request", "unauthorized", "payment required",
  "forbidden", "not found", "method not allowed", "not acceptable", "proxy authentication required", "request timeout", "conflict", "gone",
  "length required", "precondition failed", "content too large", "payload too large", "uri too long", "unsupported media type",
  "range not satisfiable", "expectation failed", "i'm a teapot", "misdirected request", "unprocessable content", "unprocessable entity",
  "locked", "failed dependency", "too early", "upgrade required", "precondition required", "too many requests",
  "request header fields too large", "unavailable for legal reasons", "internal server error", "not implemented", "bad gateway",
  "service unavailable", "gateway timeout", "http version not supported", "variant also negotiates", "insufficient storage",
  "loop detected", "not extended", "network authentication required",
  "get", "head", "post", "put", "delete", "connect", "options", "trace", "patch",
]);

/** Git's own names a program passes it: subcommands and the files of a repository's layout. */
const GIT_VOCABULARY: ReadonlySet<string> = new Set([
  "ls-files", "ls-tree", "cat-file", "rev-parse", "rev-list", "for-each-ref", "merge-base", "show-ref", "symbolic-ref", "update-index",
  "diff-tree", "diff-index", "name-rev", "hash-object", "worktree", "packed-refs", "check-ignore", "update-ref", "read-tree", "write-tree",
]);

/** CSS's own keywords a style object or a class writes: the stylesheet's vocabulary, not the project's. */
const CSS_VOCABULARY: ReadonlySet<string> = new Set([
  "break-word", "break-all", "keep-all", "pre-wrap", "pre-line", "nowrap", "normal", "space-between", "space-around", "space-evenly",
  "flex-start", "flex-end", "inline-block", "inline-flex", "inline-grid", "border-box", "content-box", "ease-in-out", "ease-in", "ease-out",
  "line-through", "sans-serif", "monospace", "uppercase", "lowercase", "capitalize", "ellipsis", "pointer", "not-allowed", "transparent",
  "currentColor", "absolute", "relative", "fixed", "sticky", "hidden", "visible", "scroll", "center", "stretch", "baseline", "column", "row",
  "row-reverse", "column-reverse", "wrap-reverse", "translate(-50%, -50%)", "100%", "100vh", "100vw", "auto", "inherit", "initial", "unset",
]);

/** The party that owns a string, when another does: HTTP (a header name, a method, a status reason phrase), git (a subcommand, a file of its layout), ARIA, HTML (a character reference), CSS, a locale tag, the npm registry (a package name a package.json names), the platform (a string the TypeScript library or @types/node typings write), or a URL, MIME type or protocol method; none for the project's own. */
export function ownerOf(value: string, packages?: ReadonlySet<string>, platform?: ReadonlySet<string>): string | undefined {
  if (packages?.has(value) === true) return "the npm registry";
  if (/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?-[A-Z]{2}$/.test(value)) return "a locale tag";
  if (CSS_VOCABULARY.has(value)) return "CSS";
  const lower = value.toLowerCase();
  if (HTTP_VOCABULARY.has(lower)) return "HTTP";
  if (GIT_VOCABULARY.has(lower)) return "git";
  if (/^aria-[a-z]+$/.test(lower)) return "ARIA";
  if (/^&(?:[a-z]+|#\d+|#x[0-9a-f]+);$/.test(lower)) return "HTML";
  if (VOCABULARY.test(value)) return "a URL, MIME type or protocol method";
  if (platform?.has(value) === true) return "the platform's typings";
  return undefined;
}

export function ownedOutside(value: string, packages?: ReadonlySet<string>, platform?: ReadonlySet<string>): boolean {
  return ownerOf(value, packages, platform) !== undefined;
}

/** Prose: four or more spaces between words. */
const PROSE = /(?:\S+\s+){4,}\S/;
/** Strings another party defines: URLs and schemes, MIME types, the language server protocol's methods, git commands, markup. */
const VOCABULARY = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:https?|node|data|file|mailto):|(?:application|text|image|audio|video|font|multipart)\/[\w.+-]+(?:;|$)|(?:textDocument|workspace|window|client|notebookDocument|callHierarchy|typeHierarchy|completionItem|codeAction|codeLens|documentLink|inlayHint|telemetry|\$)\/|git |--git|<svg|xmlns)/;
/** A member that names a file extension: a language's fact. */
const EXTENSION = /^\.[a-z0-9]{1,6}$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*/;

/** Whether a value is left out before any site is weighed: the compiler holds it (a member of a string-literal type), or another party defines it. */
export function excludedValue(value: string, typed: ReadonlySet<string>, packages?: ReadonlySet<string>, platform?: ReadonlySet<string>): boolean {
  return typed.has(value) || ownedOutside(value, packages, platform);
}

/** Utility types whose object is keyed by its members (`Record<Kind, …>`), never a record of fields. */
const KEYED = new Set(["Record", "Partial", "Required", "Readonly", "Pick", "Omit"]);

/** A named type's fields, with the fields of every type it extends that the project declares; undefined for a type the project does not declare. */
function fieldsOf(input: RestatementInput, name: string, seen: Set<string> = new Set()): { fields: Set<string>; optional: Set<string>; indexed: boolean } | undefined {
  const shapes = input.shapes.get(name);
  if (shapes === undefined || seen.has(name)) return undefined;
  seen.add(name);
  const out = { fields: new Set<string>(), optional: new Set<string>(), indexed: false };
  for (const s of shapes) {
    for (const f of s.fields) out.fields.add(f);
    for (const f of s.optional) out.optional.add(f);
    out.indexed ||= s.indexed;
    for (const b of s.bases) {
      const base = fieldsOf(input, b, seen);
      if (base === undefined) continue;
      for (const f of base.fields) out.fields.add(f);
      for (const f of base.optional) out.optional.add(f);
      out.indexed ||= base.indexed;
    }
  }
  return out;
}

/**
 * Whether two objects' keys are one type's fields, not a list kept twice:
 * both are declared as (or satisfy) the same named type, which holds their
 * key set; or one is, the project declares that type as a record of fields,
 * and the two differ only in fields it marks optional. A type keyed by its
 * members (Record, an index signature) is a set, and stays a candidate.
 */
export function typedRecord(input: RestatementInput, f: SetPair): boolean {
  const { a, b } = f;
  if (a.form !== "keys" || b.form !== "keys") return false;
  // Both read only as `X.field`: two records' attributes, whatever their types say.
  if (a.record === true && b.record === true) return true;
  const named = [a.type, b.type].filter((t): t is string => t !== undefined && !KEYED.has(t));
  if (named.length === 0) return false;
  if (named.length === 2 && named[0] === named[1]) return fieldsOf(input, named[0]!)?.indexed !== true;
  for (const t of new Set(named)) {
    const shape = fieldsOf(input, t);
    if (shape === undefined || shape.indexed) continue;
    const odd = [...f.onlyA, ...f.onlyB];
    if ([...f.shared, ...odd].every((m) => shape.fields.has(m)) && odd.every((m) => shape.optional.has(m))) return true;
  }
  return false;
}

/** The name a set is declared by, when a reader could import or name it: `FOOT_KEYS` for "FOOT_KEYS keys" or "FOOT[].key"; none for a literal inside a function or a switch's labels. */
export function listName(s: SetRef): string | undefined {
  if (s.form === "cases") return undefined;
  return IDENTIFIER.exec(s.name)?.[0];
}

/** Every character a regular expression gives a meaning, escaped, backslash first. */
const escaped = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
const word = (name: string): RegExp => new RegExp(`(^|[^\\w$])${escaped(name)}($|[^\\w$])`);

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

/** How a copy is held: an import, a type, a declared mirror, or a test that names it (which holds it only once it went red when the copy changed). */
export type Hold = { by: "import" | "type" | "declared" } | { by: "test"; test: string; copy: RestatementSite; home: RestatementSite };

/** Whether a site's file imports the other side's list by name from the other side's file. */
function importsNamed(w: Weigher, side: SetRef, other: SetRef): boolean {
  const name = listName(other);
  if (name === undefined) return false;
  return (w.input.imports.get(side.file) ?? []).some((i) => i.to === other.file && i.names.includes(name));
}

/** The test that names every one of the files and passes the check on its text: the first, in a stable order. A test that names one copy's file alone reads one side, and holds nothing equal. */
function testNaming(w: Weigher, files: readonly string[], has: (text: string) => boolean): string | undefined {
  const [first, ...rest] = [...new Set(files)];
  if (first === undefined) return undefined;
  return w.testsNaming(first).filter((t) => rest.every((f) => w.testsNaming(f).includes(t))).sort().find((t) => has(w.input.tests.get(t)!));
}

function declaredHeld(w: Weigher, a: SetRef, b: SetRef): boolean {
  const na = listName(a);
  const nb = listName(b);
  if (na === undefined || nb === undefined) return false;
  const x = `${a.file}:${na}`;
  const y = `${b.file}:${nb}`;
  return w.input.declared.some((d) => (d.list === x && d.partner === y) || (d.list === y && d.partner === x));
}

/** How a set finding's copies are held equal, if they are: an import of the list, a declared mirror, or a test that names one side's list. */
export function setHold(w: Weigher, a: SetRef, b: SetRef): Hold | undefined {
  if (importsNamed(w, a, b) || importsNamed(w, b, a)) return { by: "import" };
  if (declaredHeld(w, a, b)) return { by: "declared" };
  // A test that reads both sides: it names both files, and the list it would notice changing.
  for (const [copy, home] of [[b, a], [a, b]] as const) {
    const name = listName(copy);
    if (name === undefined) continue;
    const re = word(name);
    const test = testNaming(w, [a.file, b.file], (text) => re.test(text));
    if (test !== undefined) return { by: "test", test, copy: siteOfSet(copy), home: siteOfSet(home) };
  }
  return undefined;
}

/** The test that holds a value: one naming a site's file and either the constant the value is bound to there or the value itself. */
function valueHold(w: Weigher, value: string, sites: readonly { file: string; line: number; bound?: string }[]): Hold | undefined {
  // A test that reads every copy: it names each site's file, and the value or the constant it would notice changing.
  const files = sites.map((s) => s.file);
  for (const s of [...sites].reverse()) {
    const test = testNaming(w, files, (text) => text.includes(value) || (s.bound !== undefined && word(s.bound).test(text)));
    const home = sites.find((o) => o.file !== s.file);
    if (test !== undefined && home !== undefined) return { by: "test", test, copy: siteOf(s), home: siteOf(home) };
  }
  return undefined;
}

const siteOf = (s: { file: string; line: number; bound?: string }): RestatementSite => ({ file: s.file, line: s.line, ...(s.bound === undefined ? {} : { name: s.bound }) });

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
  const unreachable = (best?.reaches ?? []).flatMap(([, r]) => (r.ok ? [] : [r.why]));
  return `one source, ${best?.source ?? unique[0]}, and a test that holds the other copies equal to it: ${unreachable.join("; ")}`;
}

/** How many of a fact's own occurrences its rarity leaves out: the two copies that make it a restatement. */
const OWN = 2;

/** What a pattern says: its literal words' bits, and a bit and a quarter for each character of its shape. `^\\s*$` or a bare `[0-9a-f]{8}` says too little to be one fact; a whole pattern of seventeen characters written twice does not happen by chance. */
const SHAPE_BITS_PER_CHAR = 1.25;
export function patternBits(rarity: Rarity, source: string, own = 0): number {
  const node = parseRegex(source);
  const atoms = node === undefined ? (source.match(/[A-Za-z]{2,}/g) ?? []) : regexAtoms(node);
  const shape = source.length - atoms.reduce((n, w) => n + w.length, 0);
  return rarity.shared(atoms, own) + SHAPE_BITS_PER_CHAR * Math.max(0, shape);
}

/* --------------------------------------------------------------- finding */

/** A side in a code file the reading parsed, or in a manifest: a doc, a folder or an import closure is no copy. */
const sideOk = (input: RestatementInput, s: SetRef): boolean => !DERIVED.has(s.form) && !DOC_FORMS.has(s.form) && s.line > 0 && (input.imports.has(s.file) || input.manifests.has(s.file));

function siteOfSet(s: SetRef): RestatementSite {
  const name = listName(s);
  return { file: s.file, line: s.line, ...(name === undefined ? {} : { name }) };
}

export type HoldCase = HeldCopy;

export interface Restatements {
  restatements: Restatement[];
  held: number;
  /** Held by a test that has not yet gone red when its copy changed: counted apart from held until it has. */
  unrefuted: Restatement[];
  excluded: Restatement[];
  /** Copies a comment at the copy declares different on purpose, naming the home and how its behavior differs. */
  declared: Restatement[];
  /** Every copy a test names, witnessed or not, for the pass that witnesses them. */
  holds: HoldCase[];
}

/** The first entry of the config that excludes a file, data before scripts, in the order the config writes them. */
function fileExclusion(input: RestatementInput, file: string): Exclusion | undefined {
  for (const key of ["data", "scripts"] as const) {
    const hit = input.exclusions[key].find((e) => e.test(file));
    if (hit !== undefined) return { key, entry: hit.entry };
  }
  return input.derived?.(file);
}

function valueExclusion(input: RestatementInput, value: string): Exclusion | undefined {
  const hit = input.exclusions.values.find((e) => e.test(value));
  return hit === undefined ? undefined : { key: "values", entry: hit.entry };
}

/** Why an excluded restatement is left as it is, said for the key that excluded it: a script runs alone, so it is never told to hold its copy by a test. */
function leftAsItIs(by: Exclusion, files: readonly string[]): string {
  const listed = files.join(", ");
  if (by.key === "scripts") return `left as it is: ${listed} ${files.length === 1 ? "is a standalone script, which runs alone" : "are standalone scripts, which run alone"} (restatements.scripts ${by.entry})`;
  if (by.key === "data") return `left as it is: ${listed} ${files.length === 1 ? "is data" : "are data"} that restates the list on purpose (restatements.data ${by.entry})`;
  if (by.key === "generated") return `held by its generator: ${listed} ${files.length === 1 ? "is" : "are"} generated (${by.entry})`;
  if (by.key === "migrations") return `left as it is: ${listed} ${files.length === 1 ? "is a migration" : "are migrations"}, frozen on purpose, which must not follow (${by.entry})`;
  if (by.key === "owned") return `left as it is: ${by.entry} owns it, not the project`;
  if (by.key === "examples") return `left as it is: ${listed} ${files.length === 1 ? "is an example app, which states" : "are example apps, which state"} its own copy (${by.entry})`;
  return `left as it is: the config names it deliberate shared vocabulary (restatements.values ${by.entry})`;
}

/** The kinds whose copies are the same, which no comment can declare different: they need an import or a test. */
const IDENTICAL: ReadonlySet<RestatementKind> = new Set<RestatementKind>(["copy", "rule", "constant", "literal"]);
/** The kinds whose copies have already parted: a member one lacks, or a rule one widens. */
const DIVERGED = (c: Pick<Candidate, "kind" | "odd">): boolean => c.kind === "drift" || (c.kind === "subset" && c.odd !== undefined);

/** A candidate before it is weighed: what every kind shares. */
interface Candidate {
  kind: RestatementKind;
  value: string;
  members?: string[];
  odd?: { member: string; lacks: string };
  sites: (RestatementSite & { exported?: boolean })[];
  bits: number;
  /** The files whose site binds the value to a name, best first: where the source would be. */
  preferred: string[];
  /** What a line must name for history to count it as a change to the copy: the value, or two of the members or atoms. */
  needles: string[];
  hold?: Hold;
  /** A source to name in place of the computed one. */
  source?: string;
  /** What the witness pass alters at the copy, when it is not the value as written: a rule's longest word. */
  mutate?: string;
  /** An exclusion the candidate carries from what it is, not where it is: a value another party owns. */
  by?: Exclusion;
  /** A regular expression with no word or extension of its own: an idiom, ranked last within its standing. */
  idiom?: boolean;
}

/** The comment at a copy that declares it different on purpose: `// differs on purpose from <home>: <how its behavior differs>`. */
export const DIFFERS = /\/\/\s*differs on purpose from\s+(\S+?):?\s+(.+)$/;

/**
 * The restatements in a reading, ranked: the unheld ones, and those held,
 * excluded, declared different, or held by a test not yet refuted, each
 * counted apart, so that a count that falls says why it fell.
 */
export function restatementsOf(input: RestatementInput): Restatements {
  const w = weigher(input);
  const out: Restatement[] = [];
  const excluded: Restatement[] = [];
  const unrefuted: Restatement[] = [];
  const declared: Restatement[] = [];
  const holds: HoldCase[] = [];
  let held = 0;


  const weigh = (c: Candidate): void => {
    const files = [...new Set(c.sites.map((s) => s.file))];
    if (files.length < 2) return;
    if (c.hold !== undefined) {
      if (c.hold.by !== "test") {
        held++;
        return;
      }
      const key = [c.hold.home.file, c.hold.copy.file, c.hold.test].map((f) => input.blobs.get(f) ?? f).join(":");
      holds.push({ key, test: c.hold.test, copy: c.hold.copy, home: c.hold.home, value: c.mutate ?? c.value, ...(c.members === undefined ? {} : { members: c.members }) });
      const verdict = input.witnessed(key);
      if (verdict === "red") {
        held++;
        return;
      }
      if (verdict === undefined) {
        unrefuted.push({ ...shape(c, files, `held by ${c.hold.test}, not yet refuted: query mirrors --witness changes ${c.hold.copy.file}:${c.hold.copy.line} and runs it`), hold: { test: c.hold.test, key } });
        return;
      }
      // The test stayed green when the copy changed: it names the copy but does not hold it.
      c.source = `${c.hold.test} names it but stayed green when ${c.hold.copy.file}:${c.hold.copy.line} changed, so it holds nothing: `;
    }
    // A comment at the copy that declares it different, for a copy that does differ.
    const declaration = c.sites.map((s) => input.declarations.get(s.file)?.find((d) => d.line === s.line || d.line === s.line - 1)).find((d) => d !== undefined);
    if (declaration !== undefined && !IDENTICAL.has(c.kind)) {
      declared.push({ ...shape(c, files, `differs on purpose from ${declaration.home}: ${declaration.why}`), declared: declaration.why });
      return;
    }
    const live = files.filter((file) => fileExclusion(input, file) === undefined);
    const by = c.by ?? valueExclusion(input, c.value) ?? (live.length < 2 ? fileExclusion(input, files.find((file) => !live.includes(file))!) : undefined);
    if (by !== undefined) {
      excluded.push({ ...shape(c, files, leftAsItIs(by, by.key === "values" ? [] : files.filter((file) => fileExclusion(input, file)?.key === by.key))), by });
      return;
    }
    const apart = files.filter((file) => !live.includes(file));
    const note = apart.map((file) => {
      const key = fileExclusion(input, file)!.key;
      return key === "scripts" ? `${file} is a standalone script, which runs alone, so its copy is left as it is` : key === "generated" ? `${file} is generated, so its generator holds its copy` : `${file} is ${key === "data" ? "data" : key === "migrations" ? "a migration" : "an example app"}, so its copy is left as it is`;
    });
    const refused = declaration !== undefined ? ["a copy written the same cannot differ on purpose: import it, or hold it by a test"] : [];
    const source = `${c.source ?? ""}${sourceOf(input, live, c.preferred, c.members ?? [])}${exportStep(c, live)}`;
    out.push(shape(c, live, [source, ...note, ...refused].join("; ")));
  };

  /** The step that makes a private home importable: its name exported there, then imported by the rest. */
  const exportStep = (c: Candidate, files: readonly string[]): string => {
    const home = c.sites.find((s) => s.file === c.preferred.find((f) => files.includes(f)));
    if (home === undefined || home.exported !== false || home.name === undefined) return "";
    return `; ${home.name} is not exported: export it in ${home.file} first, then import { ${home.name} } from it`;
  };

  const shape = (c: Candidate, files: readonly string[], source: string): Restatement => {
    const sites = c.sites.filter((s) => files.includes(s.file)).map(({ exported: _, ...s }) => s);
    const crossPackage = new Set(sites.map((s) => regionOf(input, s.file))).size > 1;
    const standing = DIVERGED(c) ? 1 : (input.standingOf?.(c.needles, sites.map((s) => s.file)) ?? 4);
    return {
      kind: c.kind,
      value: c.value,
      ...(c.members === undefined ? {} : { members: c.members }),
      ...(c.odd === undefined ? {} : { odd: c.odd }),
      sites,
      source,
      score: Math.round(c.bits * sites.length),
      standing,
      ...(crossPackage ? { crossPackage } : {}),
      ...(sites.every((s) => BUILD_CONFIG.test(s.file)) ? { buildConfig: true } : {}),
      ...(c.idiom === true ? { idiom: true } : {}),
    };
  };

  /* Sets: copies, drift, and subsets nothing types. Strongest first, and each list is the copy in one restatement at most: a group forms around its center, never by chaining pairs. */
  const seen = new Set<string>();
  const copied = new Set<string>();
  // Among equal pairs, the one whose other side more files import first: a copy pairs with its home before another copy.
  const importedBy = new Map<string, number>();
  for (const imports of input.imports.values()) for (const i of imports) if (i.to !== undefined) importedBy.set(i.to, (importedBy.get(i.to) ?? 0) + 1);
  const reachOf = (p: SetPair): number => Math.max(importedBy.get(p.a.file) ?? 0, importedBy.get(p.b.file) ?? 0);
  const pairs = [...input.pairs].sort((x, y) => input.rarity.shared(y.shared) - input.rarity.shared(x.shared) || reachOf(y) - reachOf(x));
  for (const f of pairs) {
    const { a, b } = f;
    if (a.file === b.file || !sideOk(input, a) || !sideOk(input, b)) continue;
    if (a.checked && b.checked) continue;
    // What the two sets share must say enough: three common names do not, two rare ones may.
    const bits = input.rarity.shared(f.shared, OWN);
    if (bits < RARITY_MIN) continue;
    const kind = setKind(f);
    if (kind === undefined) continue;
    const key = `${[a.file, b.file].sort().join("|")}|${[...f.shared].sort().join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // One type holds both objects' keys; and a set of HTTP's own names is the protocol's, not the project's.
    if (typedRecord(input, f)) continue;
    const owners = [...new Set(f.shared.map((m) => ownerOf(m, input.packages, input.platform)))];
    // A list every member of which another party owns is theirs: the platform's stdio names, a protocol's methods.
    const owned = owners.every((o) => o !== undefined) ? owners.join(" and ") : undefined;
    // A list a pattern embeds among words of its own (a route's path, a specifier's stem) is that pattern's, not the list's: only the same words around it make one fact.
    if ((a.context ?? []).join("|") !== (b.context ?? []).join("|")) continue;
    // A part typed against the whole's member type is held by the compiler: a member the whole lacks is a compile error.
    const [part, whole] = f.onlyA.length <= f.onlyB.length ? [a, b] : [b, a];
    // The copy is the side a config entry or a derived class leaves out, else the unnamed one, else the one fewer files import.
    const apartA = fileExclusion(input, a.file) !== undefined;
    const apartB = fileExclusion(input, b.file) !== undefined;
    const copy = kind === "subset" ? part : apartA !== apartB ? (apartA ? a : b) : listName(a) === undefined ? a : listName(b) === undefined ? b : (importedBy.get(a.file) ?? 0) < (importedBy.get(b.file) ?? 0) ? a : b;
    const copyKey = `${copy.file}:${copy.line}:${copy.name}`;
    if (copied.has(copyKey)) continue;
    copied.add(copyKey);
    const typed = (kind === "subset" || kind === "drift") && part.elementType !== undefined && !/^(?:string|String)$/.test(part.elementType);
    const value = f.shared.join(", ");
    const odd = kind === "drift" ? { member: (f.onlyA[0] ?? f.onlyB[0])!, lacks: `${(f.onlyA.length > 0 ? b : a).file}:${(f.onlyA.length > 0 ? b : a).line}` } : kind === "subset" && (part === a ? f.onlyA : f.onlyB).length === 1 ? { member: (part === a ? f.onlyA : f.onlyB)[0]!, lacks: `${whole.file}:${whole.line}` } : undefined;
    // A part is held by its type alone: a file that imports the whole and still writes the part out keeps it by hand.
    const found = typed ? ({ by: "type" } as const) : setHold(w, a, b);
    const hold = kind === "subset" && found?.by === "import" ? undefined : found;
    const wholeName = listName(whole);
    weigh({
      kind,
      value,
      members: f.shared,
      ...(odd === undefined ? {} : { odd }),
      sites: kind === "subset" ? [siteOfSet(whole), siteOfSet(part)] : [siteOfSet(a), siteOfSet(b)],
      bits,
      preferred: kind === "subset" ? [whole.file] : [a, b].filter((s) => listName(s) !== undefined).map((s) => s.file),
      needles: f.shared,
      ...(hold === undefined ? {} : { hold }),
      ...(owned === undefined ? {} : { by: { key: "owned" as const, entry: owned } }),
      ...(kind === "subset" && wholeName !== undefined ? { source: `type ${listName(part) ?? "the part"} against ${wholeName}'s members (${whole.file}:${whole.line}), so the compiler holds it to them${odd === undefined ? "" : `; it holds ${odd.member}, which ${wholeName} lacks`}: ` } : {}),
    });
  }

  /* Predicates: one rule written twice, and a rule derived from another. */
  const { rules, derivations } = rulesOf(input.predicates, input.rarity, RARITY_MIN, input.literals);
  const ruled = new Set<string>();
  for (const r of rules) {
    if (r.sites.every((s) => s.test === true)) continue;
    for (const s of r.sites) if (s.form === "regex") ruled.add(s.text);
    const production = r.sites.filter((s) => s.test !== true);
    const hold = ruleHold(w, input, r.sites);
    weigh({
      kind: "rule",
      value: r.center.text,
      sites: r.sites.map((s) => ({ file: s.file, line: s.line, ...(s.bound === undefined ? {} : { name: s.bound }) })),
      bits: r.bits,
      preferred: [...production.filter((s) => s.bound !== undefined), ...production].map((s) => s.file),
      needles: r.atoms,
      mutate: [...r.atoms].sort((x, y) => y.length - x.length)[0]!,
      ...(hold === undefined ? {} : { hold }),
    });
  }
  for (const d of derivations) {
    if (d.part.test === true || d.whole.test === true) continue;
    // A derived rule says most of what its whole says: a pattern that shares one word with a long alternation is a different rule.
    if (d.bits < 0.5 * input.rarity.shared([...new Set(predicateOf(d.whole)?.atoms ?? [])])) continue;
    const hold = ruleHold(w, input, [d.part, d.whole]);
    weigh({
      kind: "derivation",
      value: d.part.text,
      sites: [d.whole, d.part].map((s) => ({ file: s.file, line: s.line, ...(s.bound === undefined ? {} : { name: s.bound }) })),
      bits: d.bits,
      preferred: [d.whole.file],
      needles: d.atoms,
      ...(hold === undefined ? {} : { hold }),
      source: `${d.part.file}:${d.part.line} accepts a strict part of what ${d.whole.file}:${d.whole.line} accepts (${d.whole.text}): derive it from that one, `,
    });
  }

  /* Parsers: two functions that read text into one type, checking the same fields. */
  const byShape = new Map<string, ParserSite[]>();
  for (const p of input.parsers) {
    const key = `${p.type}|${[...p.fields].sort().join(",")}`;
    byShape.set(key, [...(byShape.get(key) ?? []), p]);
  }
  for (const group of byShape.values()) {
    const files = new Set(group.map((p) => p.file));
    if (files.size < 2) continue;
    const ordered = [...group].sort((x, y) => Number(y.exported) - Number(x.exported) || x.file.localeCompare(y.file));
    const home = ordered[0]!;
    const imported = group.some((p) => p !== home && (input.imports.get(p.file) ?? []).some((i) => i.to === home.file && i.names.includes(home.name)));
    weigh({
      kind: "parser",
      value: `${home.type} from text, checking ${[...home.fields].sort().join(", ")}`,
      sites: ordered.map((p) => ({ file: p.file, line: p.line, name: p.name, exported: p.exported })),
      bits: input.rarity.shared([home.type, ...home.fields]),
      preferred: [home.file],
      needles: [home.name],
      ...(imported ? { hold: { by: "import" } as const } : {}),
    });
  }

  /* Values: one literal written in two or more files. */
  for (const [value, sites] of input.values) {
    const files = [...new Set(sites.map((s) => s.file))];
    if (files.length < 2 || input.typed.has(value) || ruled.has(value)) continue;
    const owner = ownerOf(value, input.packages, input.platform);
    // A value must say enough to be one fact: "id" in forty files is the language's word, `PostInvocation` in two is the project's. A pattern says what its literal words say; its syntax says little.
    // Two of its copies are left out of its background: a pair never vouches for its own rarity, and a value written in forty files is still common.
    const bits = sites.some((s) => s.regex === true) ? patternBits(input.rarity, value, OWN) : input.rarity.value(value, OWN);
    if (bits < RARITY_MIN) continue;
    const boundFiles = new Set(sites.filter((s) => s.bound !== undefined).map((s) => s.file));
    if (PROSE.test(value) && boundFiles.size < 2) continue;
    // One site per file, the first, named by its constant when any site there binds one.
    const shown = files.map((file) => {
      const here = sites.filter((s) => s.file === file);
      const bound = here.find((s) => s.bound !== undefined);
      const site = bound ?? here[0]!;
      return { file, line: site.line, ...(bound?.bound === undefined ? {} : { name: bound.bound }), exported: site.exported };
    });
    const preferred = [...sites.filter((s) => s.exported && s.bound !== undefined), ...sites.filter((s) => s.bound !== undefined)].map((s) => s.file);
    const hold = valueHold(w, value, sites);
    // One regular expression written in two files is one rule written twice, whatever binds it.
    const idiom = sites.some((s) => s.regex === true) && !/[A-Za-z]{2}|\\\.[a-z]/.test(value.replace(/\\[a-zA-Z]|\[[^\]]*\]/g, ""));
    weigh({ kind: sites.some((s) => s.regex === true) ? "rule" : boundFiles.size >= 2 ? "constant" : "literal", value, sites: shown, bits, preferred, needles: [value], ...(hold === undefined ? {} : { hold }), ...(owner === undefined ? {} : { by: { key: "owned" as const, entry: owner } }), ...(idiom ? { idiom } : {}) });
  }

  out.sort(byRank);
  excluded.sort(byRank);
  out.splice(0, out.length, ...families(out));
  unrefuted.sort(byRank);
  declared.sort(byRank);
  return { restatements: out, held, unrefuted, excluded, declared, holds };
}

/**
 * One family counted once: a list, the rule written over its members and the
 * subset another list keeps of it are one fact in three forms when they lie
 * in the same files and share most of their words. Each restatement in rank
 * order is a center or joins the first center it matches, never another
 * member, so two forms alike only through a third never chain into one
 * family; the forms are listed under the center and not counted again.
 */
/** The kinds whose value is a list of members, in one form or another: a family is made of these, never of single values. */
const LIST_FORMS: ReadonlySet<RestatementKind> = new Set<RestatementKind>(["copy", "drift", "subset", "rule", "derivation"]);

function families(input: readonly Restatement[]): Restatement[] {
  // One value set at N sites is one family on its sites, not N-1 pairs: equal copies of the same members merge first, wherever they lie.
  const ranked: Restatement[] = [];
  const byMembers = new Map<string, Restatement>();
  for (const r of input) {
    const key = r.kind === "copy" && r.members !== undefined ? [...r.members].sort().join("\u0000") : undefined;
    const into = key === undefined ? undefined : byMembers.get(key);
    if (into === undefined) {
      const copy = { ...r, sites: [...r.sites] };
      ranked.push(copy);
      if (key !== undefined) byMembers.set(key, copy);
      continue;
    }
    for (const site of r.sites) if (!into.sites.some((s) => s.file === site.file && s.line === site.line)) into.sites.push(site);
    into.score = Math.max(into.score, r.score);
  }
  const wordsOf = (r: Restatement): Set<string> => new Set(r.members ?? wordsIn([r.value]));
  const centers: { r: Restatement; files: Set<string>; words: Set<string>; forms: Restatement[] }[] = [];
  for (const r of ranked) {
    const files = new Set(r.sites.map((s) => s.file));
    const words = wordsOf(r);
    const center = !LIST_FORMS.has(r.kind) ? undefined : centers.find((c) => {
      if (!LIST_FORMS.has(c.r.kind)) return false;
      const sameFiles = [...files].filter((f) => c.files.has(f)).length >= 2;
      if (!sameFiles || words.size === 0 || c.words.size === 0) return false;
      const shared = [...words].filter((w) => c.words.has(w)).length;
      return shared >= 2 && shared >= 0.5 * Math.min(words.size, c.words.size);
    });
    if (center === undefined) centers.push({ r, files, words, forms: [] });
    else center.forms.push(r);
  }
  return centers.map((c) => (c.forms.length === 0 ? c.r : { ...c.r, forms: c.forms.map((f) => ({ kind: f.kind, value: f.value, sites: f.sites })) }));
}

/** Which kind two paired sets are: equal (a copy), one member apart (drift), or one a strict part of the other with at most one member of its own (a subset); none otherwise. Three shared members at least for the last two: two members say too little about a whole. */
function setKind(f: SetPair): RestatementKind | undefined {
  const diff = f.onlyA.length + f.onlyB.length;
  if (diff === 0) return f.jaccard === 1 ? "copy" : undefined;
  if (f.shared.length < 3) return undefined;
  if (diff === 1) return "drift";
  const [own, other] = f.onlyA.length <= f.onlyB.length ? [f.onlyA, f.onlyB] : [f.onlyB, f.onlyA];
  return own.length <= 1 && other.length >= 2 ? "subset" : undefined;
}

/** How copies of one rule are held: a site's file imports another site's bound name, or a test names a site's file and its name. */
function ruleHold(w: Weigher, input: RestatementInput, sites: readonly PredicateSite[]): Hold | undefined {
  for (const s of sites) for (const o of sites) if (s !== o && o.bound !== undefined && (input.imports.get(s.file) ?? []).some((i) => i.to === o.file && i.names.includes(o.bound!))) return { by: "import" };
  const prod = sites.filter((s) => s.test !== true);
  return valueHold(w, sites[0]!.text, prod);
}

/** A build tool's config, where each package states its own: ranked last. */
const BUILD_CONFIG = /(?:^|\/)(?:rollup|jest|webpack|vite|vitest|tsup|babel|esbuild|eslint|prettier|postcss|tailwind|next|nuxt|svelte|astro|playwright|karma|metro|rspack|turbo)\.config\.[^/.]+$/;

/** Rank: what has already diverged, then what history shows changed apart, then what changed together, then what never changed; within each, copies across parts of the project before copies within one, then the most bits. */
function byRank(x: Restatement, y: Restatement): number {
  return Number(x.buildConfig === true) - Number(y.buildConfig === true) || (x.standing ?? 4) - (y.standing ?? 4) || Number(x.idiom === true) - Number(y.idiom === true) || Number(y.crossPackage === true) - Number(x.crossPackage === true) || y.score - x.score || x.value.localeCompare(y.value);
}
