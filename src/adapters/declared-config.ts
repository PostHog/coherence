/**
 * A language the project declares in its config: any language with a
 * language server, read through the protocol alone, with no code of its own
 * (the bundled declared plugin, plugins/declared, answers for it). This is
 * the config's grammar for one: the `languages` object names, per language,
 * the file extensions it owns and the argv of a server speaking the protocol
 * over stdio, and optionally a test filter template and a refutation template.
 */

import { isLanguage } from "./index.ts";
import { languageOfFile } from "./language-files.ts";

/** One language the config declares. */
export interface DeclaredLanguage {
  /** Its name, as the config's `language` and a test setup's `language` name it; never a built-in's. */
  name: string;
  /** The file extensions it owns, each with its dot (".swift"); no built-in owns one. */
  extensions: string[];
  /** The language server's argv, speaking the protocol over stdio; a relative program path is the project's. */
  server: string[];
  /** How a `via` becomes the test runner's filter: `{name}` is the via. */
  testFilter?: string;
  /** The unsaved document a refutation stages: it must reference the protected thing (see REFUTE_PLACEHOLDERS). */
  refute?: string;
}

/** What a `refute` template may name, and what each becomes. */
export const REFUTE_PLACEHOLDERS: Readonly<Record<string, string>> = {
  "{name}": "the protected thing's name (a module's first top-level symbol)",
  "{module}": "the protected thing's file name without its extension",
  "{file}": "the protected thing's file, relative to the staged document's folder (./secrets.swift, ../store/secrets.swift)",
  "{path}": "the protected thing's file, relative to the project root",
};

const NAME = /^[a-z][a-z0-9-]*$/;
const EXTENSION = /^\.[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/**
 * The config's `languages` object, read strictly: every problem is stated,
 * never skipped. `path` names the config file in each message.
 */
export function readDeclaredLanguages(raw: unknown, path: string): DeclaredLanguage[] {
  if (raw === undefined) return [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${path}: languages is an object of declared languages, each keyed by its name`);
  const owners = new Map<string, string>();
  const declared: DeclaredLanguage[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const where = `${path}: languages.${name}`;
    if (isLanguage(name)) throw new Error(`${where} is a built-in language; a declared language takes another name`);
    if (!NAME.test(name)) throw new Error(`${where}: a declared language's name is lowercase letters, digits and hyphens, starting with a letter`);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where} is an object with extensions and server`);
    const entry = value as Record<string, unknown>;
    const extensions = entry["extensions"];
    if (!Array.isArray(extensions) || extensions.length === 0 || !extensions.every((e): e is string => typeof e === "string" && EXTENSION.test(e))) {
      throw new Error(`${where}.extensions is a list of file extensions, each with its dot (".swift")`);
    }
    for (const extension of extensions) {
      const builtIn = languageOfFile(`file${extension}`);
      if (builtIn !== undefined) throw new Error(`${where}.extensions names ${extension}, which the built-in ${builtIn} adapter reads; a declared language takes extensions no built-in owns`);
      const other = owners.get(extension);
      if (other !== undefined) throw new Error(`${where}.extensions names ${extension}, which languages.${other} already owns`);
      owners.set(extension, name);
    }
    const server = entry["server"];
    if (!Array.isArray(server) || server.length === 0 || !server.every((s): s is string => typeof s === "string" && s !== "")) {
      throw new Error(`${where}.server is the language server's command as a list of arguments (["sourcekit-lsp"]), speaking the protocol over stdio`);
    }
    const language: DeclaredLanguage = { name, extensions: [...extensions], server: [...server] };
    for (const key of ["testFilter", "refute"] as const) {
      const template = entry[key];
      if (template === undefined) continue;
      if (typeof template !== "string" || template === "") throw new Error(`${where}.${key} is a template string`);
      language[key] = template;
    }
    if (language.refute !== undefined && !language.refute.includes("{name}") && !language.refute.includes("{module}")) {
      throw new Error(`${where}.refute names neither {name} nor {module}, so the document it stages could reference nothing`);
    }
    const unknown = Object.keys(entry).filter((k) => !["extensions", "server", "testFilter", "refute"].includes(k));
    if (unknown.length > 0) throw new Error(`${where} has ${unknown.join(", ")}; a declared language reads extensions, server, testFilter and refute`);
    declared.push(language);
  }
  return declared;
}

/** The declared language a file is written in, by its extension; undefined for any other file. */
export function declaredLanguageOf(file: string, declared: readonly DeclaredLanguage[]): DeclaredLanguage | undefined {
  const base = file.trim();
  return declared.find((language) => language.extensions.some((extension) => base.endsWith(extension)));
}

/** Programs that run a server rather than being one: the server they run is named in their first argument that is not a flag. */
const RUNNERS = new Set(["node", "nodejs", "bun", "deno", "python", "python3", "java", "npx"]);

/** How a reader names what answered for a declared language: the language and its server, and where it was declared. */
export function declaredInstrument(language: DeclaredLanguage): string {
  const base = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
  const [program, ...args] = language.server;
  const run = RUNNERS.has(base(program!)) ? args.find((a) => !a.startsWith("-")) : undefined;
  return `${language.name} via ${base(run ?? program!)} (declared in the config)`;
}
