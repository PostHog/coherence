/**
 * coherence plugin eject <name> [--to <dir>]: a bundled plugin's source and
 * its tests (check.json, the project plugin check holds it to) copied into
 * the project, its import of the core rewritten to `@posthog/coherence/plugin`
 * (the bundled plugins import the core only through src/plugins/api.ts, which
 * that export is), and the project's config pointed at the copy, which then
 * takes the bundled plugin's place: the eject, enhance and swap workflow
 * (docs/plugins.md). Refused, with nothing written, when the destination
 * exists, when it leaves the project, or when the config already runs a
 * plugin by that name.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE } from "../enforcement/config.ts";
import { MANIFEST } from "./plugin.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The bundled plugins' sources: plugins/ beside src in a checkout, and beside dist in the published package, which ships them for this. */
export const PLUGIN_SOURCES = resolve(here, "..", "..", "plugins");

/** How a bundled plugin's module names the core, and how an ejected one names it. */
export const CORE_SPECIFIER = "../../src/plugins/api.ts";
export const PACKAGE_SPECIFIER = "@posthog/coherence/plugin";

export class EjectError extends Error {}

/** What eject wrote. */
export interface Ejected {
  /** The copy's folder, from the project root, "./" led. */
  folder: string;
  /** Every file it wrote, from the project root. */
  files: string[];
  config: string;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** The bundled plugin's source rewritten for the copy: its one import of the core named as a plugin outside the package names it. */
function forProject(file: string, text: string): string {
  if (!file.endsWith(".ts")) return text;
  const out = text.split(`"${CORE_SPECIFIER}"`).join(`"${PACKAGE_SPECIFIER}"`);
  if (out.includes('"../../src/')) throw new EjectError(`${file} imports Coherence other than through ${CORE_SPECIFIER}, so its copy could not reach what it imports; export what it needs from src/plugins/api.ts`);
  return out;
}

export function ejectPlugin(root: string, name: string, to?: string): Ejected {
  const source = join(PLUGIN_SOURCES, name);
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !existsSync(join(source, MANIFEST))) {
    const bundled = existsSync(PLUGIN_SOURCES) ? readdirSync(PLUGIN_SOURCES).filter((n) => existsSync(join(PLUGIN_SOURCES, n, MANIFEST))) : [];
    throw new EjectError(`plugin eject: no bundled plugin is named ${JSON.stringify(name)}; the bundled plugins are ${bundled.join(", ")}`);
  }
  const target = resolve(root, to ?? join("coherence-plugins", name));
  const folder = relative(resolve(root), target).split(sep).join("/");
  if (folder === "" || folder.startsWith("..") || isAbsolute(folder)) throw new EjectError(`plugin eject: ${to} is not a folder inside the project; a plugin's path in the config stays inside it`);
  if (existsSync(target)) throw new EjectError(`plugin eject: ${folder} exists; eject into a new folder (--to <dir>), or remove it first`);
  const configPath = join(root, CONFIG_FILE);
  const configText = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;
  const config = configText === undefined ? {} : (JSON.parse(configText) as Record<string, unknown>);
  const plugins = (config["plugins"] ?? {}) as Record<string, unknown>;
  if (typeof plugins !== "object" || plugins === null || Array.isArray(plugins)) throw new EjectError(`plugin eject: ${CONFIG_FILE}'s plugins is not an object of plugins`);
  if (name in plugins) throw new EjectError(`plugin eject: ${CONFIG_FILE} already runs plugin ${name} from ${JSON.stringify(plugins[name])}; remove that entry to eject it again`);
  // Every file read and rewritten before any is written: a refusal leaves nothing behind.
  const copies = filesUnder(source).map((file) => {
    const rel = relative(source, file);
    return { rel, text: forProject(rel, readFileSync(file, "utf8")) };
  });
  for (const { rel, text } of copies) {
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), text);
  }
  const indent = configText === undefined ? 2 : (/^[ \t]+/m.exec(configText)?.[0] ?? "  ");
  const next = { ...config, plugins: { ...plugins, [name]: `./${folder}` } };
  writeFileSync(configPath, `${JSON.stringify(next, null, indent)}\n`);
  return { folder: `./${folder}`, files: copies.map(({ rel }) => `${folder}/${rel.split(sep).join("/")}`).sort(), config: CONFIG_FILE };
}

/** What eject prints. */
export function ejectText(ejected: Ejected, name: string, cli: string): string {
  return [
    `ejected plugin ${name} into ${ejected.folder}: ${ejected.files.length} files`,
    ...ejected.files.map((f) => `  wrote ${f}`),
    `${ejected.config}: plugins.${name} is ${JSON.stringify(ejected.folder)}, so the copy answers for ${name} in the bundled plugin's place`,
    `Change it, then hold it to what every language plugin owes: ${cli} plugin check ${ejected.folder}`,
  ].join("\n");
}
