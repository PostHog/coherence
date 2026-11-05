/**
 * The lexicon stack: Coherence's lexicon, then each plugin's fragment in the
 * config's order, then the project's. Every reader that counts a term as
 * declared, vets a name, or takes a defect class reads the whole stack.
 *
 * A plugin's concept joins the tool layer tagged with its plugin (Concept.layer),
 * so it counts as declared everywhere Coherence's own do, and every view that
 * prints the vocabulary says whose it is. Two things it does not bring:
 *
 *   its rejected names, which govern only that plugin's own terms: a word a
 *   plugin refuses is not refused across the project, whose sense of its own
 *   words wins inside it;
 *   a name another layer already holds: a plugin concept whose name or alias
 *   is Coherence's, or another plugin's, is a clash (save one that repeats a
 *   Coherence concept's name with no definition, which only carries properties
 *   such as defect classes), reported for the project
 *   to settle (its own lexicon declaring the name, as a concept or an alias,
 *   settles it) and never merged silently, so the concept stays out until it is.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aliasNames, parseLexicon, type Concept, type Lexicon } from "../lifecycle/lexicon.ts";
import type { LoadedPlugin } from "./plugin.ts";

/** One plugin's layer: its fragment and the surface that puts its vocabulary in a session's way. */
export interface PluginLayer {
  name: string;
  version: string;
  lexicon: Lexicon;
  /** The languages the plugin provides or extends. */
  languages: string[];
  /** The via forms it proves. */
  forms: string[];
}

/** Each plugin's lexicon layer, in the config's order; a plugin with no fragment has none. A fragment that will not read is refused with its path. */
export function pluginLayers(plugins: readonly LoadedPlugin[]): PluginLayer[] {
  return plugins.flatMap((plugin) => {
    if (plugin.manifest.lexicon === undefined) return [];
    const path = resolve(plugin.dir, plugin.manifest.lexicon);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`plugin ${plugin.name}'s lexicon ${path} will not read: ${(error as Error).message}`);
    }
    const languages = [plugin.manifest.provides?.language, plugin.manifest.extends].filter((l): l is string => l !== undefined);
    return [{ name: plugin.name, version: plugin.version, lexicon: parseLexicon(raw, path), languages: [...new Set(languages)], forms: (plugin.manifest.verifiers ?? []).map((v) => v.form) }];
  });
}

/** Every name a concept answers to, folded for comparison. */
function namesOf(concept: Concept): string[] {
  return [concept.name, ...concept.aliases.flatMap(aliasNames)].map((n) => n.trim().toLowerCase()).filter((n) => n !== "");
}

/** Every name a lexicon declares: its concepts' names and aliases. */
export function declaredNames(lexicon: Lexicon | undefined): Set<string> {
  return new Set((lexicon?.concepts ?? []).flatMap(namesOf));
}

/** One clash: a plugin concept whose name another layer holds, and what settles it. */
export interface LayerClash {
  plugin: string;
  concept: string;
  name: string;
  /** "Coherence" or "plugin <name>". */
  with: string;
}

export function clashText(clash: LayerClash): string {
  return `plugin ${clash.plugin}'s concept "${clash.concept}" names "${clash.name}", which ${clash.with} already declares; settle it in the project lexicon (declare "${clash.name}" there, as a concept or an alias of the one the project means)`;
}

/**
 * The tool layer composed: Coherence's concepts, then each plugin's that
 * clashes with nothing, tagged with its plugin and without its rejected
 * names; and every clash, less those the project lexicon settles by
 * declaring the name. The input lexicons are not changed.
 */
export function composeStack(coherence: Lexicon, layers: readonly PluginLayer[], project?: Lexicon): { coherence: Lexicon; clashes: LayerClash[] } {
  if (layers.length === 0) return { coherence, clashes: [] };
  const settled = declaredNames(project);
  const held = new Map<string, string>();
  for (const name of declaredNames(coherence)) held.set(name, "Coherence");
  const clashes: LayerClash[] = [];
  const joined: Concept[] = [];
  for (const layer of layers) {
    const mine = new Set<string>();
    for (const concept of layer.lexicon.concepts) {
      // A concept that repeats a Coherence concept's name with no definition of its own only carries properties (a defect class):
      // the readers of those read each layer's file, and the concept itself stays Coherence's.
      if (concept.definition.trim() === "" && held.get(concept.name.trim().toLowerCase()) === "Coherence") continue;
      const taken = namesOf(concept).find((n) => held.has(n) && !settled.has(n));
      if (taken !== undefined) {
        clashes.push({ plugin: layer.name, concept: concept.name, name: taken, with: held.get(taken)! });
        continue;
      }
      // A name the project settled is the project's: the plugin's concept steps back for it, and nothing is reported.
      if (namesOf(concept).some((n) => held.has(n))) continue;
      for (const n of namesOf(concept)) mine.add(n);
      joined.push({ ...concept, rejected: [], layer: layer.name });
    }
    for (const n of mine) held.set(n, `plugin ${layer.name}`);
  }
  return { coherence: { ...coherence, concepts: [...coherence.concepts, ...joined], layers: layers.map((l) => ({ name: l.name, version: l.version, languages: l.languages, forms: l.forms })) }, clashes };
}
