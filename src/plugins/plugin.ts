/**
 * The plugin interface: what a plugin is and what it may supply.
 *
 * A plugin is a folder holding a `plugin.json` manifest and, when it
 * supplies code, the module the manifest names. The manifest is read without
 * running anything: what the plugin provides, which via forms it proves,
 * its lexicon fragment, and the ladder its adapter grades on are data, so a
 * hook that only needs to know them (the vocabulary, the spec check, which
 * language a file is) pays for one small JSON read and never imports code.
 * The module is imported only where its code runs: the warm adapter server
 * and a run, when a check first asks the plugin's adapter or verifier.
 *
 * The roles, any of which a plugin may take:
 *
 *   language adapter  provides.language: the LanguageAdapter for a language,
 *                     built by the module's `adapter` factory. A plugin that
 *                     names a built-in language takes its place (the swap
 *                     rule); with `extends` naming a language it is handed
 *                     that language's adapter to wrap, so an enhancement
 *                     reuses what it does not change. A plugin that extends
 *                     without providing wraps the provider in config order.
 *   syntax tables     the manifest's `syntax`: one optional slot per table
 *                     the readings scan by, each naming the export of a
 *                     module beside the manifest that holds it
 *                     ("typescript-entrances.ts#TYPESCRIPT_ENTRANCES"). A reading
 *                     loads only the module of the slot it reads, at the
 *                     moment it reads it; a slot a plugin leaves empty is
 *                     read as "not read for <language>", never as another
 *                     language. What a reading needs without code (which
 *                     files are the language's, the rules' descriptions, the
 *                     member scan) is data in the manifest itself.
 *   verifier          verifiers[]: a via form, written `via: [<form>] <name>`,
 *                     that the plugin proves, graded like a test, with an
 *                     evidence label the run entry records.
 *   lexicon layer     lexicon: a lexicon fragment beside the manifest, one
 *                     layer of the stack between Coherence's and the project's.
 */

import type { AdapterBounds, LanguageAdapter, Ladder } from "../adapters/adapter.ts";
import type { DeclaredLanguage } from "../adapters/declared-config.ts";
import type { EntranceSyntax } from "../adapters/entrance-candidates.ts";
import type { ImportTarget } from "../economy/source.ts";
import type { Literal } from "../lifecycle/mirrors.ts";
import type { InterfaceFacts } from "../readings/scope/component-interfaces.ts";
import type { BoundarySource } from "../scaffold/boundaries.ts";
import type { Verdict } from "../enforcement/record.ts";

/** The interface version this core runs. */
export const PLUGIN_API = 4;

/** The oldest interface version this core still reads: a plugin written for one from here to PLUGIN_API loads, and an older one is named at session start with what changed since; any other is refused, naming both. */
export const OLDEST_PLUGIN_API = 1;

/** What each interface version changed from the one before, for the line a session start says about a plugin written for an older one. */
export const PLUGIN_API_CHANGES: Readonly<Record<number, string>> = {
  2: 'syntax slots moved from the module\'s syntax export to plugin.json ("syntax": { slot: "module#export" }), the member scan became plugin.json data (members), and kept, declares, notice, topLevel and boundaries joined the slots',
  3: 'a language plugin may read its text through a tree-sitter parser and queries (treeSitter) in place of the source, declares and topLevel slots; resolveModule may answer a module of several files ({ module, files }) and Coherence joins each imported name to the file that declares it; the adapter answers topLevelSymbols, and check.json maps the reference project (reference), which plugin check now holds a language plugin to',
  4: 'the hand-written reader slots (syntax.source, syntax.declares, syntax.topLevel and syntax.kept) are gone: a language is read through treeSitter, a grammar\'s .wasm and queries, from which the core derives what they answered, and a manifest that fills one is refused, whatever pluginApi it is written for; the interfaces table states serverBounds alone, its type declarations, default exports, import lists and wildcard imports read through the parser; a copy ejected from an older Coherence is ejected again (coherence plugin eject <name>) and its changes reapplied',
};

/** The interface version from which a duty holds, and what of that version it asks: a plugin written for an older one is told so, never failed by a duty that did not exist when it was written. */
export const DUTY_SINCE: Readonly<Record<string, { since: number; asks: string }>> = {
  "reference reading": { since: 3, asks: "check.json's map of the reference project (reference)" },
  "server agrees": { since: 3, asks: "the adapter's topLevelSymbols" },
};

/** What changed between the interface version a plugin was written for and the one this core runs, oldest first. */
export function changesSince(pluginApi: number): string[] {
  const changes: string[] = [];
  for (let version = pluginApi + 1; version <= PLUGIN_API; version++) {
    const said = PLUGIN_API_CHANGES[version];
    if (said !== undefined) changes.push(`${version}: ${said}`);
  }
  return changes;
}

/** The manifest's file name in a plugin's folder. */
export const MANIFEST = "plugin.json";

/** One via form a plugin proves. */
export interface VerifierForm {
  /** The form as a bullet writes it inside the brackets: `via: [<form>] <name>`. */
  form: string;
  /** What kind of evidence a pass is, recorded on the run entry ("model-checked", "property-tested"). */
  evidence: string;
  /** An argv that names {name}, substituted with the name to prove, run from the project root: exit 0 is a pass. Absent, the module's `verify` answers. */
  command?: string[];
  /** A regular expression the command's output must match for its exit 0 to pass, as testMatch is for a test; an exit 0 without it is a fail naming it. */
  match?: string;
}

/** One entrance detection rule as the readings print it: its name, its plural, what it detects, and whether a request from off the machine reaches it (what the rank of undeclared entrances reads as outside). */
export interface EntranceRule {
  rule: string;
  plural: string;
  detects: string;
  remote?: boolean;
}

/** A folder the walks leave out because the language's tools made it: by a marker file inside it, or by its name beside a marker file. */
export interface MarkedFolder {
  /** A file inside the folder that marks it (pyvenv.cfg). */
  marker?: string;
  /** The folder's name (target), with `beside`. */
  name?: string;
  /** A file beside the folder that marks it (Cargo.toml). */
  beside?: string;
  /** What the walk says it left out ("virtual environment"). */
  reason: string;
}

/**
 * One step the generated CI workflow runs, after the install and before the
 * checks, for a project that reads a plugin's language: an action it uses,
 * pinned to a commit, or a command it runs (the toolchain and the language
 * server its adapter asks, which no lockfile brings).
 */
export interface CiStep {
  name?: string;
  /** An action, as owner/repo@<40-hex commit>. */
  uses?: string;
  /** The release the action's commit is, written beside it as a comment; required with uses. */
  version?: string;
  with?: Record<string, string>;
  /** A shell command. */
  run?: string;
}

/** What `plugin.json` holds. */
export interface PluginManifest {
  name: string;
  version: string;
  pluginApi: number;
  /** What a person reads the plugin as ("TypeScript and JavaScript"): the README's and plugins/README.md's generated lists name each bundled plugin by it. */
  title?: string;
  /** One line on what it adds, read after its title ("through typescript-language-server"), for the same lists. */
  description?: string;
  /** The language the plugin's adapter is the provider for, or the languages a config declares (the bundled declared plugin). */
  provides?: { language?: string; declaredLanguages?: true };
  /** The language whose adapter the plugin's adapter is handed to wrap. */
  extends?: string;
  /** For a language no built-in owns: the file extensions it is written in (".swift"). */
  extensions?: string[];
  /** The files the language is written in, as data: a regular expression a project-relative path matches, and one that takes a match back (".d.ts"). */
  files?: { pattern: string; except?: string };
  /** Of the language's files, those the plain source scan leaves out (TypeScript's JavaScript, Python's stubs), as a regular expression. */
  source?: { except: string };
  /** The extensions a language server can report a site in or resolve a name to. */
  serverExtensions?: string[];
  /** Regular expressions a file's base name matches when it is a test by the language's own naming (pytest's test_*.py). */
  testFiles?: string[];
  /** Folder names that hold the language's tests wherever they sit, besides the config's test folders (SwiftPM's Tests). */
  testFolders?: string[];
  /** The files besides source the language's answers and detected entrances rest on (its configuration, manifests and lockfiles), as regular expressions a base name matches. */
  basisFiles?: string[];
  /** How a module file owns a folder (a package's __init__.py, a Rust mod.rs): regular expressions a project-relative path matches, the first group the folder whose files are the module's. */
  moduleFolders?: string[];
  /** How an exported type's body reads, for the lexicon's member scan: the line that opens it, the one that closes it, a field inside; regular expressions. */
  members?: { opens: string; closes: string; field: string };
  /** The language's entrance detection rules and what they do not see. */
  entrances?: { rules: EntranceRule[]; notDetected: string };
  /** Why the readings that scan text (declarations, imports, entrance rules) do not read the language yet; absent when they do. */
  notScanned?: string;
  /** Folder names no project authors code in, wherever they sit: the language's install and cache folders. */
  environmentFolders?: string[];
  /** Folders the language's tools made, left out by a marker. */
  markedFolders?: MarkedFolder[];
  /** What the CI workflow says when a project reads the language, and the steps it runs first to set up what the plugin's adapter asks. */
  ci?: { note: string; steps?: CiStep[] };
  /** Names a plugin vouches for as well known, beside well-known.json. */
  wellKnown?: string[];
  /** The module, relative to the manifest, whose default export is a PluginModule. */
  module?: string;
  /** Each syntax slot the plugin fills: "<module beside the manifest>#<export>". */
  syntax?: Partial<Record<SyntaxSlot, string>>;
  /**
   * The parser the language's text is read through, and the queries over it
   * (syntax-trees.ts): the one reader of the language's text. The core
   * derives from them every reading of its declarations, imports and exports
   * (languages.ts ParsedReadings); no slot answers one of those by hand.
   */
  treeSitter?: TreeSitterManifest;
  /** The rungs the plugin's adapter grades on; absent, the wrapped adapter's, else reference-choked alone. */
  ladder?: Ladder;
  verifiers?: VerifierForm[];
  /** The lexicon fragment, relative to the manifest. */
  lexicon?: string;
}

/** A manifest's treeSitter: paths relative to the manifest. */
export interface TreeSitterManifest {
  /** The language's tree-sitter parser, compiled to WebAssembly (tree-sitter build --wasm, or the .wasm a grammar's npm package ships). */
  parser: string;
  /** A second parser of the same language, read with the same queries when the parser's tree holds an error and its own holds fewer (TypeScript's TypeScript grammar beside its TSX grammar, for the old-style cast TSX cannot read). */
  alternate?: string;
  /** The queries, in tree-sitter's query language, capturing what syntax-trees.ts's CAPTURES name. */
  queries: string;
  /** "<module beside the manifest>#<export>": where an import leads, which no parse can say. */
  resolve: string;
  /** For a language that exports by name rather than by a keyword its queries capture as @exported: a regular expression a name it keeps private matches (Python's "^_", Go's "^\P{Lu}"), read with Unicode's character classes. */
  privateName?: string;
  /** For queries that capture @import.prefix: the text the language joins a path's segments with (Rust's "::"), which joins each prefix to the path it prefixes. */
  separator?: string;
}

/** Where an import leads: a plugin on the parser path supplies this as code, since a module's place is the language's rule, not its syntax. */
export interface ModuleResolution {
  /** What a specifier names from a file: one project-relative file, or a module of several (its folder and files), or undefined outside the project; `vanished` as for the source slot's. */
  resolveModule(root: string, from: string, specifier: string, vanished: ReadonlySet<string>): ImportTarget | undefined;
  /** Every spelling of the files a module specifier names from a file, resolved or not, for the word index's wildcard keys. */
  modulePaths(from: string, specifier: string): string[];
  /** The name a whole-module import binds in the importing file when the import gives none (a Go package's name, from its path), which the names the file uses through it are qualified by; absent, the specifier's last path element. */
  boundName?(specifier: string): string;
}

/**
 * Every key a manifest may carry, as docs/plugins.md's key table must list
 * them; the type below fails to compile when PluginManifest gains a key this
 * list lacks, so the list and the docs' table cannot drift from the type.
 */
export const MANIFEST_KEYS = ["name", "version", "pluginApi", "title", "description", "provides", "extends", "extensions", "files", "source", "serverExtensions", "testFiles", "testFolders", "basisFiles", "moduleFolders", "members", "entrances", "notScanned", "environmentFolders", "markedFolders", "ci", "wellKnown", "module", "syntax", "treeSitter", "ladder", "verifiers", "lexicon"] as const satisfies readonly (keyof PluginManifest)[];
type ManifestKeyMissing = Exclude<keyof PluginManifest, (typeof MANIFEST_KEYS)[number]>;
export const MANIFEST_KEYS_COMPLETE: [ManifestKeyMissing] extends [never] ? true : ManifestKeyMissing = true;

/** Every key of a manifest's treeSitter, held to its type as MANIFEST_KEYS is. */
export const TREE_SITTER_KEYS = ["parser", "alternate", "queries", "resolve", "privateName", "separator"] as const satisfies readonly (keyof TreeSitterManifest)[];
type TreeSitterKeyMissing = Exclude<keyof TreeSitterManifest, (typeof TREE_SITTER_KEYS)[number]>;
export const TREE_SITTER_KEYS_COMPLETE: [TreeSitterKeyMissing] extends [never] ? true : TreeSitterKeyMissing = true;

/** Every method of a language adapter, as the docs' adapter table must list them, held to the LanguageAdapter type (its two fields, language and ladder, are no methods). */
export const ADAPTER_METHODS = ["ready", "resolve", "references", "visibility", "refute", "testFilter", "forget", "close", "serverPid", "topLevelSymbols"] as const satisfies readonly Exclude<keyof LanguageAdapter, "language" | "ladder">[];
type AdapterMethodMissing = Exclude<keyof LanguageAdapter, "language" | "ladder" | (typeof ADAPTER_METHODS)[number]>;
export const ADAPTER_METHODS_COMPLETE: [AdapterMethodMissing] extends [never] ? true : AdapterMethodMissing = true;

/**
 * The slots a plugin once filled with a hand-written reader of its
 * language's text, which the core now derives from the language's parser
 * alone (languages.ts ParsedReadings; what kept answered is the parsed
 * interfaces reading's wildcardModules): a manifest whose syntax names one is
 * refused, whatever pluginApi it is written for, so no manifest the core
 * loads holds one; and no slot type below can name one.
 */
export const DERIVED_SLOTS = ["source", "declares", "topLevel", "kept"] as const;

/**
 * What a plugin's interfaces table may state: its language's facts, none a
 * reading of its text. The type declarations, default exports, import lists
 * and wildcard imports pluginApi 3 read off the table are the parse's alone
 * (languages.ts ParsedReadings interfaces), and a table that answers any
 * other member is refused by name when it loads (languages.ts).
 */
export const INTERFACE_FACTS = ["serverBounds"] as const satisfies readonly (keyof InterfaceFacts)[];
type InterfaceFactMissing = Exclude<keyof InterfaceFacts, (typeof INTERFACE_FACTS)[number]>;
export const INTERFACE_FACTS_COMPLETE: [InterfaceFactMissing] extends [never] ? true : InterfaceFactMissing = true;

/** What a verifier is asked. */
export interface VerifyRequest {
  root: string;
  /** The folder of the spec whose bullet names the proof, project-relative ("." for the root): where a name without a file is looked for. */
  component: string;
  form: string;
  name: string;
  timeoutMs: number;
}

/** What a verifier answers: graded as a test's verdict is. */
export interface VerifyResult {
  verdict: Verdict;
  reason: string;
}

/** The syntax tables a plugin may supply for the readings, each optional, each loaded from the module its manifest names: what no parse answers, never a reader of the language's text (DERIVED_SLOTS). */
export interface SyntaxTables {
  entrances?: EntranceSyntax;
  /** The language's facts the component interface reading needs and no parse answers. */
  interfaces?: InterfaceFacts;
  /** One line a session start says about the language's instrument at this root, or "" (TypeScript 7 ships no tsserver). */
  notice?: (root: string) => string;
  /** The mirror reader: the literal a list named `name` is set to in a file's text. */
  lists?: (text: string, name: string) => Literal | undefined;
  /** A tool of the language's whose declaration file scaffold import and adoption draft specs from (tach's tach.toml). */
  boundaries?: BoundarySource;
}

/** The slots by name, so a reading can say which one a plugin left empty. */
export const SYNTAX_SLOTS = ["entrances", "interfaces", "notice", "lists", "boundaries"] as const;
export type SyntaxSlot = (typeof SYNTAX_SLOTS)[number];

/** What the adapter factory is handed. */
export interface AdapterContext {
  root: string;
  language: string;
  /** The adapter of the language the manifest extends, when it extends one. */
  base?: LanguageAdapter;
  /** The folders a reading's bounded server leaves out, for the component interface reading alone. */
  bounds?: AdapterBounds;
  /** For the declared plugin: the language the config declares, which its adapter reads. */
  declared?: DeclaredLanguage;
}

/** The module's default export. */
export interface PluginModule {
  adapter?: (context: AdapterContext) => LanguageAdapter;
  verify?: (request: VerifyRequest) => Promise<VerifyResult>;
}

/** A plugin as the registry holds it: its manifest and where it lives. */
export interface LoadedPlugin {
  /** The name the config keys it by, which the manifest must carry. */
  name: string;
  version: string;
  /** The folder holding plugin.json. */
  dir: string;
  /** "bundled", or the path the config gave. */
  source: string;
  manifest: PluginManifest;
}

/** A plugin's name and version as a run entry records who answered. */
export interface PluginTag {
  name: string;
  version: string;
}

export function tagOf(plugin: LoadedPlugin): PluginTag {
  return { name: plugin.name, version: plugin.version };
}

/** The reason a reading gives for a language a plugin provides without the slot it scans by. */
export function slotNotRead(language: string, plugin: string, slot: SyntaxSlot): string {
  return `not read for ${language}: plugin ${plugin} supplies no ${slot} table`;
}
