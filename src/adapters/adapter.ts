/**
 * The language adapter: the seam that lets chokepoint detection generalize
 * across languages. It answers exactly the questions enforcement asks and
 * nothing else; the spec walker and the check are language-neutral and sit
 * outside it.
 *
 *   resolve      a name from a spec (`writeClass`, `KERNEL_WRITE_POLICY in
 *                policy.ts`, `entities/Hive/policy.ts`) to a definition
 *   references   every reference to that definition across the project
 *   visibility   whether the language enforces the thing's visibility, and
 *                whether the thing is visible outside its module
 *   testFilter   the form a `via` value takes as a test filter
 *   refute       prove the instrument sees a synthetic reference from
 *                outside the chokepoint, without touching disk
 *
 * The grade ladder's top rung is the adapter's to name: TypeScript enforces
 * visibility (not exported means unreachable), Python does not.
 */

/** A position as the protocol counts it: zero-based line and character. */
export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

/** The three forms a spec value may take before it is resolved. */
export type NameForm =
  | { form: "symbol"; name: string; fileHint: string | undefined }
  | { form: "module"; path: string }
  | { form: "prose"; text: string };

export interface Definition {
  /** As the spec wrote it. */
  name: string;
  kind: "symbol" | "module";
  /** Relative to the project root, with forward slashes. */
  file: string;
  /** The whole declaration (a module: the whole file). */
  range: Range;
  /** The name itself, where a references query starts (a module: the first export's name, if any). */
  selection: Position;
}

export interface ReferenceSite {
  file: string;
  /** One-based, as an editor shows it. */
  line: number;
  /** Zero-based, as the protocol counts it. */
  character: number;
  /** The innermost named symbol enclosing the site, as `outer.inner`, or undefined at module top level. */
  symbol: string | undefined;
  /** True when the site is an import or re-export specifier: it brings the name into scope and is no use of it. */
  isImport: boolean;
}

export interface Visibility {
  /** Whether the language itself refuses a reference from outside the module. */
  enforced: boolean;
  /** Whether the thing is reachable from outside its module (TypeScript: exported). */
  visible: boolean;
  /** What the adapter read to decide, for the report. */
  evidence: string;
}

export interface Refutation {
  /** Whether the synthetic site appeared among the references. */
  seen: boolean;
  /** What was done and what was seen, in one line. */
  account: string;
}

/** The rung the adapter's language can reach, with the reason. */
export interface Ladder {
  /** The rung a clean chokepoint earns when the protected thing is not visible outside its module. */
  top: "visibility-choked" | "reference-choked";
  /** Why the top rung is what it is, in one sentence. */
  because: string;
}

export interface LanguageAdapter {
  readonly language: string;
  readonly ladder: Ladder;
  /** Whether the instrument is up; a reason when it is not. */
  ready(): Promise<{ ok: true } | { ok: false; reason: string }>;
  resolve(name: string, hint: ResolveHint): Promise<Resolved>;
  references(definition: Definition): Promise<ReferenceSite[]>;
  visibility(definition: Definition): Promise<Visibility>;
  testFilter(via: string): string;
  /** Open an unsaved document outside `outsideOf` that references `protected`, ask for references, confirm, close. */
  refute(protectedThing: Definition, outsideOf: Definition | undefined): Promise<Refutation>;
  close(): Promise<void>;
}

export interface ResolveHint {
  /** The component folder, relative to the root: a definition under it is preferred when several match. */
  component: string;
  /** Folders whose files are tests; a definition there is never chosen while another exists. */
  testFolders: readonly string[];
}

export type Resolved =
  | { ok: true; definition: Definition }
  | { ok: false; reason: string; candidates?: string[] };

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const IN_FILE = /^([A-Za-z_$][A-Za-z0-9_$]*)\s+in\s+(\S+)$/;
const MODULE_PATH = /^[A-Za-z0-9_./@-]+\.[A-Za-z]+$/;

/** How a spec value reads before any instrument is asked. */
export function parseName(value: string): NameForm {
  const text = value.trim();
  if (IDENTIFIER.test(text)) return { form: "symbol", name: text, fileHint: undefined };
  const inFile = IN_FILE.exec(text);
  if (inFile !== null) return { form: "symbol", name: inFile[1]!, fileHint: inFile[2]! };
  if (MODULE_PATH.test(text) && text.includes("/")) return { form: "module", path: text };
  return { form: "prose", text };
}

export function positionBefore(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

export function rangeContains(range: Range, position: Position): boolean {
  return !positionBefore(position, range.start) && !positionBefore(range.end, position);
}

/** Whether a project-relative path lies in a test folder or is a test file by name. */
export function isTestPath(file: string, testFolders: readonly string[]): boolean {
  const parts = file.split("/");
  if (parts.some((part) => testFolders.includes(part))) return true;
  const base = parts[parts.length - 1] ?? "";
  return /\.(test|spec)\.[a-z]+$/.test(base);
}
