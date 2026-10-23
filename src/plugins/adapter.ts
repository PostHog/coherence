/**
 * A plugin's language adapter as the core holds it: built at once from the
 * manifest, its module loaded only when something first asks for it (a
 * question, its test filter), so a reading that needs only the ladder
 * (Structure's grades, from the manifest) or a hook that never asks the
 * instrument pays no load. A module that fails to load, or holds
 * no adapter factory, makes the adapter unready with that reason: every
 * chokepoint it was asked about reads not run, never a pass.
 */

import type { Definition, LanguageAdapter, Ladder, Occasion, Refutation, ReferenceSite, Resolved, ResolveHint, Visibility } from "../adapters/adapter.ts";
import type { LoadedPlugin, PluginTag } from "./plugin.ts";
import { tagOf } from "./plugin.ts";
import { moduleSyncOf } from "./registry.ts";

/** The ladder of a plugin adapter that declares none and wraps none: Coherence's check alone, as for a declared language. */
function referenceLadder(plugin: LoadedPlugin, language: string): Ladder {
  return {
    top: "reference-choked",
    because: `plugin ${plugin.name} declares no visibility rules for ${language}, so no compiler or checker is credited`,
    rungs: [{ grade: "reference-choked", enforcer: "Coherence's check at the edit and in CI", fact: `plugin ${plugin.name}'s adapter reports every reference, and every one in the project is inside the chokepoint` }],
  };
}

export class PluginAdapter implements LanguageAdapter {
  readonly language: string;
  readonly ladder: Ladder;
  /** Who answers: this plugin, and every plugin whose adapter it wraps. */
  readonly plugins: PluginTag[];
  private readonly plugin: LoadedPlugin;
  private readonly root: string;
  private readonly base: LanguageAdapter | undefined;
  private inner: Promise<LanguageAdapter> | undefined;
  private loaded: LanguageAdapter | undefined;

  constructor(plugin: LoadedPlugin, root: string, language: string, base: LanguageAdapter | undefined) {
    this.plugin = plugin;
    this.root = root;
    this.language = language;
    this.base = base;
    this.ladder = plugin.manifest.ladder ?? base?.ladder ?? referenceLadder(plugin, language);
    this.plugins = [...(base instanceof PluginAdapter ? base.plugins : []), tagOf(plugin)];
  }

  /** The plugin's adapter, built once, synchronously, the first time anything asks: a question, its ladder or its test filter. */
  private build(): LanguageAdapter {
    if (this.loaded !== undefined) return this.loaded;
    const module = moduleSyncOf(this.plugin);
    if (typeof module.adapter !== "function") throw new Error(`plugin ${this.plugin.name}'s module exports no adapter factory for ${this.language}`);
    this.loaded = module.adapter({ root: this.root, language: this.language, ...(this.base === undefined ? {} : { base: this.base }) });
    return this.loaded;
  }

  private adapter(): Promise<LanguageAdapter> {
    this.inner ??= Promise.resolve().then(() => this.build());
    return this.inner;
  }

  async ready(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      return await (await this.adapter()).ready();
    } catch (error) {
      return { ok: false, reason: `plugin ${this.plugin.name} (${this.plugin.version}) could not load its adapter: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async resolve(name: string, hint: ResolveHint): Promise<Resolved> {
    return (await this.adapter()).resolve(name, hint);
  }

  async references(definition: Definition): Promise<ReferenceSite[]> {
    return (await this.adapter()).references(definition);
  }

  async visibility(definition: Definition, chokepoint?: Definition): Promise<Visibility> {
    return (await this.adapter()).visibility(definition, chokepoint);
  }

  /** Synchronous by the interface: the plugin's own filter, its module loaded now when no question has loaded it yet; a module that will not load leaves the wrapped adapter's, else the name as written, and its failure stands at ready(). */
  testFilter(via: string): string {
    try {
      return this.build().testFilter(via);
    } catch {
      return this.base?.testFilter(via) ?? via;
    }
  }

  async refute(protectedThing: Definition, outsideOf: Definition | undefined, exempt?: string, occasion?: Occasion): Promise<Refutation> {
    return (await this.adapter()).refute(protectedThing, outsideOf, exempt, occasion);
  }

  async forget(files?: readonly string[]): Promise<void> {
    await (await this.adapter()).forget(files);
  }

  async close(): Promise<void> {
    // Never built, nothing of the plugin's runs; the wrapped adapter may still hold a server.
    try {
      await this.loaded?.close();
    } finally {
      await this.base?.close();
    }
  }

  serverPid(): number | undefined {
    return this.loaded?.serverPid?.() ?? this.base?.serverPid?.();
  }
}
