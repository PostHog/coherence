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
 *                     ("typescript-source.ts#TYPESCRIPT_SOURCE"). A reading
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
import type { SourceSyntax } from "../economy/source.ts";
import type { Literal } from "../lifecycle/mirrors.ts";
import type { InterfaceSymbol } from "../observation/interfaces.ts";
import type { InterfaceSyntax } from "../readings/scope/component-interfaces.ts";
import type { BoundarySource } from "../scaffold/boundaries.ts";
import type { Verdict } from "../enforcement/record.ts";

/** The interface version this core runs. */
export const PLUGIN_API = 2;

/** The oldest interface version this core still reads: a plugin written for one from here to PLUGIN_API loads, and an older one is named at session start with what changed since; any other is refused, naming both. */
export const OLDEST_PLUGIN_API = 1;

/** What each interface version changed from the one before, for the line a session start says about a plugin written for an older one. */
export const PLUGIN_API_CHANGES: Readonly<Record<number, string>> = {
  2: 'syntax slots moved from the module\'s syntax export to plugin.json ("syntax": { slot: "module#export" }), the member scan became plugin.json data (members), and kept, declares, notice, topLevel and boundaries joined the slots',
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

/** One entrance detection rule as the readings print it: its name, its plural, and what it detects. */
export interface EntranceRule {
  rule: string;
  plural: string;
  detects: string;
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
  /** The rungs the plugin's adapter grades on; absent, the wrapped adapter's, else reference-choked alone. */
  ladder?: Ladder;
  verifiers?: VerifierForm[];
  /** The lexicon fragment, relative to the manifest. */
  lexicon?: string;
}

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

/** The syntax tables a plugin may supply for the readings, each optional, each loaded from the module its manifest names. */
export interface SyntaxTables {
  entrances?: EntranceSyntax;
  interfaces?: InterfaceSyntax;
  source?: SourceSyntax;
  /** The module files a file star-imports or wildcard re-exports, for the Structure reading's kept answers. */
  kept?: (file: string, text: string) => string[];
  /** What a declaration line's keyword says can execute, for the observation's interface reading. */
  declares?: (line: string) => InterfaceSymbol["declares"];
  /** One line a session start says about the language's instrument at this root, or "" (TypeScript 7 ships no tsserver). */
  notice?: (root: string) => string;
  /** The mirror reader: the literal a list named `name` is set to in a file's text. */
  lists?: (text: string, name: string) => Literal | undefined;
  /** Whether a file's text declares a name at its top level, for the spec model's check that a handler, guard or mirror exists. */
  topLevel?: (text: string, name: string) => boolean;
  /** A tool of the language's whose declaration file scaffold import and adoption draft specs from (tach's tach.toml). */
  boundaries?: BoundarySource;
}

/** The slots by name, so a reading can say which one a plugin left empty. */
export const SYNTAX_SLOTS = ["entrances", "interfaces", "source", "kept", "declares", "notice", "lists", "topLevel", "boundaries"] as const;
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
