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
 *   syntax tables     the module's `syntax`: one optional slot per table the
 *                     readings scan by. A slot a plugin leaves empty is read
 *                     as "not read for <language>", never as another language.
 *   verifier          verifiers[]: a via form, written `via: [<form>] <name>`,
 *                     that the plugin proves, graded like a test, with an
 *                     evidence label the run entry records.
 *   lexicon layer     lexicon: a lexicon fragment beside the manifest, one
 *                     layer of the stack between Coherence's and the project's.
 */

import type { LanguageAdapter, Ladder } from "../adapters/adapter.ts";
import type { EntranceSyntax } from "../adapters/entrance-candidates.ts";
import type { SourceSyntax } from "../economy/source.ts";
import type { MemberScan } from "../lifecycle/lexicon-coverage.ts";
import type { Literal } from "../lifecycle/mirrors.ts";
import type { InterfaceSyntax } from "../readings/scope/component-interfaces.ts";
import type { Verdict } from "../enforcement/record.ts";

/** The interface version this core runs; a plugin written for another is refused, naming both. */
export const PLUGIN_API = 1;

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

/** What `plugin.json` holds. */
export interface PluginManifest {
  name: string;
  version: string;
  pluginApi: number;
  /** The language the plugin's adapter is the provider for. */
  provides?: { language?: string };
  /** The language whose adapter the plugin's adapter is handed to wrap. */
  extends?: string;
  /** For a language no built-in owns: the file extensions it is written in (".swift"). */
  extensions?: string[];
  /** The module, relative to the manifest, whose default export is a PluginModule. */
  module?: string;
  /** The rungs the plugin's adapter grades on; absent, the wrapped adapter's, else reference-choked alone. */
  ladder?: Ladder;
  verifiers?: VerifierForm[];
  /** The lexicon fragment, relative to the manifest. */
  lexicon?: string;
}

/** What a verifier is asked. */
export interface VerifyRequest {
  root: string;
  form: string;
  name: string;
  timeoutMs: number;
}

/** What a verifier answers: graded as a test's verdict is. */
export interface VerifyResult {
  verdict: Verdict;
  reason: string;
}

/** The syntax tables a plugin may supply for the readings, each optional. */
export interface SyntaxTables {
  entrances?: EntranceSyntax;
  interfaces?: InterfaceSyntax;
  source?: SourceSyntax;
  members?: MemberScan;
  /** The mirror reader: the literal a list named `name` is set to in a file's text. */
  lists?: (text: string, name: string) => Literal | undefined;
}

/** The slots by name, so a reading can say which one a plugin left empty. */
export const SYNTAX_SLOTS = ["entrances", "interfaces", "source", "members", "lists"] as const;
export type SyntaxSlot = (typeof SYNTAX_SLOTS)[number];

/** What the adapter factory is handed. */
export interface AdapterContext {
  root: string;
  language: string;
  /** The adapter of the language the manifest extends, when it extends one. */
  base?: LanguageAdapter;
}

/** The module's default export. */
export interface PluginModule {
  adapter?: (context: AdapterContext) => LanguageAdapter;
  verify?: (request: VerifyRequest) => Promise<VerifyResult>;
  syntax?: SyntaxTables;
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
