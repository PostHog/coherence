/**
 * Which adapter a project gets: the config's `language`, else the bundled
 * default's. Every language's adapter is a plugin's: the bundled plugins
 * (plugins/) answer for the core's languages and for the languages a config
 * declares; a plugin the config names that provides a language takes its
 * place, and a plugin that extends a language wraps whichever adapter
 * answers for it (src/plugins).
 */

import { PluginAdapter } from "../plugins/adapter.ts";
import { coreAdapter, declaredAdapter, LANGUAGES, type Language } from "../plugins/languages.ts";
import type { LoadedPlugin } from "../plugins/plugin.ts";
import { extendersOf, providerOf } from "../plugins/registry.ts";
import type { DeclaredLanguage } from "./declared-config.ts";
import type { AdapterBounds, LanguageAdapter } from "./adapter.ts";

export { LANGUAGES, type Language } from "../plugins/languages.ts";

export function isLanguage(value: string): value is Language {
  return LANGUAGES.includes(value);
}

/**
 * The adapter for one of the core's languages, over the whole workspace;
 * with bounds, one whose server leaves the bounded-away folders out, for the
 * component interface reading alone (a server that cannot narrow reads its
 * whole project and takes no bounds).
 */
export function adapterFor(language: Language, root: string, bounds?: AdapterBounds): LanguageAdapter {
  const adapter = coreAdapter(language, root, bounds);
  if (adapter === undefined) throw new Error(`${language} is not one of the core's languages (${LANGUAGES.join(", ")})`);
  return adapter;
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
  return found === undefined ? undefined : declaredAdapter(found, root);
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
