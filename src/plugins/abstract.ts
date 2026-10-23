/**
 * The abstract plugin spec (plugins/Plugin.abstract.md): what every plugin
 * owes by its shape, written once. A bullet holds for each plugin of the
 * shape its holds: line names, whether or not the plugin's author wrote a
 * spec; the plugin's own spec, beside its plugin.json, sets one aside only
 * under its ## overrides, with because:. plugin check grades each bullet
 * that holds (src/plugins/check.ts), and a reading a provider leaves out
 * with no override is said at session start.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec, type Override } from "../spec/grammar.ts";
import { MANIFEST, type LoadedPlugin, type PluginManifest, type SyntaxSlot } from "./plugin.ts";
import { BUNDLED_DIR } from "./registry.ts";

export const ABSTRACT_SPEC = "Plugin.abstract.md";

/** One bullet of the abstract spec. */
export interface AbstractBullet {
  name: string;
  sentence: string;
  /** The shapes it holds for, any one enough: language, provider, slot <name>, slots, verifier, lexicon. */
  holds: string[];
  /** What of check.json (or the plugin) it reads. */
  reads: string;
  /** The empty answer it is graded against again, when it has one. */
  emptied: string | undefined;
}

let bullets: AbstractBullet[] | undefined;

/** The abstract spec's bullets, read once. */
export function abstractBullets(): readonly AbstractBullet[] {
  bullets ??= parseAbstract(readFileSync(join(BUNDLED_DIR, ABSTRACT_SPEC), "utf8"));
  return bullets;
}

/** The bullets of an abstract spec's text: `- <name>: <sentence>`, then holds:, reads: and emptied: lines. */
export function parseAbstract(text: string): AbstractBullet[] {
  const found: AbstractBullet[] = [];
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    const heading = /^##\s+(.*)$/.exec(raw);
    if (heading !== null) {
      inside = heading[1]!.trim() === "invariants";
      continue;
    }
    if (!inside) continue;
    const bullet = /^-\s+([^:]+):\s*(.*)$/.exec(raw);
    if (bullet !== null) {
      found.push({ name: bullet[1]!.trim(), sentence: bullet[2]!.trim(), holds: [], reads: "", emptied: undefined });
      continue;
    }
    const field = /^\s+(holds|reads|emptied):\s*(.*)$/.exec(raw);
    const current = found[found.length - 1];
    if (field === null || current === undefined) continue;
    if (field[1] === "holds") current.holds = field[2]!.split(",").map((s) => s.trim()).filter((s) => s !== "");
    else if (field[1] === "reads") current.reads = field[2]!.trim();
    else current.emptied = field[2]!.trim();
  }
  return found;
}

/** Whether a manifest has one shape a holds: line names. */
function hasShape(manifest: PluginManifest, shape: string): boolean {
  const slot = /^slot\s+(\w+)$/.exec(shape);
  if (slot !== null) return manifest.syntax?.[slot[1] as SyntaxSlot] !== undefined;
  switch (shape) {
    case "language":
      return manifest.provides?.language !== undefined || manifest.extends !== undefined;
    case "provider":
      return manifest.provides?.language !== undefined;
    case "slots":
      return Object.keys(manifest.syntax ?? {}).length > 0;
    case "verifier":
      return (manifest.verifiers ?? []).length > 0;
    case "lexicon":
      return manifest.lexicon !== undefined;
    default:
      return false;
  }
}

/** The shapes a holds: line may name, for the abstract spec's own check. */
export const SHAPES = ["language", "provider", "slots", "verifier", "lexicon"] as const;

/** Whether an abstract bullet holds for a plugin by its shape. */
export function holdsFor(bullet: AbstractBullet, plugin: LoadedPlugin): boolean {
  return bullet.holds.some((shape) => hasShape(plugin.manifest, shape));
}

/** The plugin's own spec, beside its plugin.json: its path, or undefined when it carries none. */
export function pluginSpecPath(plugin: LoadedPlugin): string | undefined {
  if (!existsSync(plugin.dir)) return undefined;
  // The spec model's suffix (src/spec/model.ts), spelled here: the model reads this module, and the registry reads it before any model.
  const spec = readdirSync(plugin.dir).find((f) => f.endsWith(".spec.md"));
  return spec === undefined ? undefined : join(plugin.dir, spec);
}

/** Whether a folder is a plugin's: it holds a plugin.json. */
export function isPluginFolder(dir: string): boolean {
  return existsSync(join(dir, MANIFEST));
}

/** The overrides the plugin's own spec writes, by abstract bullet; only those that say why set a bullet aside. */
export function overridesOf(plugin: LoadedPlugin): ReadonlyMap<string, Override> {
  const path = pluginSpecPath(plugin);
  if (path === undefined) return new Map();
  const parsed = parseSpec(readFileSync(path, "utf8"), path);
  return new Map(parsed.overrides.filter((o) => o.because !== undefined).map((o) => [o.name, o]));
}

/** What is wrong with a spec's overrides against the abstract spec: one naming no bullet of it, or one in a spec that is no plugin's. */
export function overrideProblems(overrides: readonly Override[], folder: string): { line: number; message: string }[] {
  if (overrides.length === 0) return [];
  if (!isPluginFolder(folder)) return [{ line: overrides[0]!.line, message: "## overrides sets aside bullets of the abstract plugin spec, so it belongs in a plugin's spec, beside its plugin.json" }];
  const names = abstractBullets().map((b) => b.name);
  return overrides.filter((o) => !names.includes(o.name)).map((o) => ({ line: o.line, message: `override ${o.name} names no bullet of the abstract plugin spec (plugins/${ABSTRACT_SPEC}); its bullets: ${names.join(", ")}` }));
}

/**
 * The readings a plugin that provides a language leaves out with no
 * override saying why: each abstract bullet that holds for it as a provider
 * and is read from a slot neither it nor the plugin beneath it fills (the
 * bundled provider a swap keeps the readings of). Each is said at session
 * start; plugin check fails it.
 */
export function unsaidReadings(plugin: LoadedPlugin, beneath?: PluginManifest): string[] {
  if (plugin.manifest.provides?.language === undefined) return [];
  const given = (shape: string): boolean => hasShape(plugin.manifest, shape) || (beneath !== undefined && hasShape(beneath, shape));
  const slotted = abstractBullets().filter((b) => b.holds.includes("provider") && b.holds.some((shape) => /^slot\s/.test(shape)));
  const left = slotted.filter((b) => !b.holds.some((shape) => /^slot\s/.test(shape) && given(shape)));
  if (left.length === 0) return [];
  const overrides = overridesOf(plugin);
  return left.filter((b) => !overrides.has(b.name)).map((b) => b.name);
}
