/**
 * Which adapter a project gets: the config's `language`, else TypeScript; a
 * language the config declares (declared.ts) is read by the generic adapter;
 * a language a plugin provides is the plugin's (src/plugins), and a plugin
 * that extends a language wraps whichever adapter answers for it.
 */

import { DeclaredAdapter, type DeclaredLanguage } from "./declared.ts";
import { PluginAdapter } from "../plugins/adapter.ts";
import type { LoadedPlugin } from "../plugins/plugin.ts";
import { extendersOf, providerOf } from "../plugins/registry.ts";
import { PythonAdapter } from "./python.ts";
import { RustAdapter } from "./rust.ts";
import { TypeScriptAdapter } from "./typescript.ts";
import type { AdapterBounds, LanguageAdapter } from "./adapter.ts";

import { LANGUAGES, type Language } from "./language-files.ts";
export { LANGUAGES, type Language } from "./language-files.ts";

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

/**
 * The adapter for the language, over the whole workspace; with bounds, one
 * whose server leaves the bounded-away folders out, for the component
 * interface reading alone (Python narrows its workspace; TypeScript's server
 * reads the project its tsconfig names and rust-analyzer its Cargo workspace,
 * and neither takes bounds).
 */
export function adapterFor(language: Language, root: string, bounds?: AdapterBounds): LanguageAdapter {
  switch (language) {
    case "typescript":
      return new TypeScriptAdapter(root);
    case "python":
      return new PythonAdapter(root, undefined, bounds);
    case "rust":
      return new RustAdapter(root);
  }
}

/** What instrumentFor needs of the config: the languages it declares and the plugins it runs. */
export interface Instruments {
  readonly declared: readonly DeclaredLanguage[];
  readonly plugins?: readonly LoadedPlugin[];
}

/** The core's own adapter for a language, a built-in or a declared one, or undefined when the core has none. */
function ownAdapter(language: string, root: string, declared: readonly DeclaredLanguage[], bounds?: AdapterBounds): LanguageAdapter | undefined {
  if (isLanguage(language)) return adapterFor(language, root, bounds);
  const found = declared.find((d) => d.name === language);
  return found === undefined ? undefined : new DeclaredAdapter(root, found);
}

/**
 * The adapter for any of a project's languages: a plugin's when one provides
 * it (handed the core's own when it extends the same language, or the adapter
 * of the language it extends), else a built-in by its own adapter, else a
 * language the config declares by the generic one; then each plugin that
 * extends the language without providing it wraps that, in config order. A
 * name that is none of these is refused, never guessed. Bounds reach only the
 * core's own adapters: a plugin's adapter reads its whole workspace.
 */
export function instrumentFor(language: string, root: string, config: Instruments | readonly DeclaredLanguage[], bounds?: AdapterBounds): LanguageAdapter {
  const { declared, plugins = [] } = Array.isArray(config) ? { declared: config as readonly DeclaredLanguage[], plugins: [] } : (config as Instruments);
  const provider = providerOf(plugins, language);
  let adapter: LanguageAdapter | undefined;
  if (provider !== undefined) {
    const wraps = provider.manifest.extends;
    const base = wraps === undefined ? undefined : wraps === language ? ownAdapter(language, root, declared) : instrumentFor(wraps, root, { declared, plugins });
    adapter = new PluginAdapter(provider, root, language, base);
  } else adapter = ownAdapter(language, root, declared, bounds);
  if (adapter === undefined) throw new Error(`${language} is neither a built-in language (${LANGUAGES.join(", ")}), one the config declares, nor one a plugin provides`);
  for (const wrapper of extendersOf(plugins, language)) adapter = new PluginAdapter(wrapper, root, language, adapter);
  return adapter;
}
