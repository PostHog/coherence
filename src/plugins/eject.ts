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

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE } from "../enforcement/config.ts";
import { MANIFEST } from "./plugin.ts";
import { PACKAGE_SPECIFIER } from "./registry.ts";
import { moduleSpecifiers } from "./specifiers.ts";
import { landsWithin } from "./within.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The bundled plugins' sources: plugins/ beside src in a checkout, and beside dist in the published package, which ships them for this. */
export const PLUGIN_SOURCES = resolve(here, "..", "..", "plugins");

/** How a bundled plugin's module names the core, and how an ejected one names it. */
export const CORE_SPECIFIER = "../../src/plugins/api.ts";
export { PACKAGE_SPECIFIER };

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

/**
 * The bundled plugin's source rewritten for the copy: its one import of the
 * core named as a plugin outside the package names it, every specifier read
 * with the parser (moduleSpecifiers). Any other import that leaves the
 * plugin's own folder is refused: the copy could not reach it.
 */
export function ejectedSource(file: string, text: string): string {
  if (!/\.[cm]?[jt]sx?$/.test(file)) return text;
  let out = "";
  let at = 0;
  const from = posix.dirname(file.split(sep).join("/"));
  for (const specifier of moduleSpecifiers(file, text)) {
    if (specifier.text === CORE_SPECIFIER) {
      out += `${text.slice(at, specifier.start)}"${PACKAGE_SPECIFIER}"`;
      at = specifier.end;
      continue;
    }
    if (specifier.text.startsWith(".") && posix.normalize(posix.join(from, specifier.text)).startsWith("..")) {
      throw new EjectError(`${file} imports ${specifier.text}, which leaves the plugin's folder, so its copy could not reach it; a plugin imports Coherence only through ${CORE_SPECIFIER} (export what it needs there)`);
    }
  }
  return out + text.slice(at);
}

/** The config's text with its plugins key set to `plugins`, every other byte as it was: the key's value replaced where it is, or added last. */
function withPlugins(text: string, plugins: Record<string, unknown>): string {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
  const value = JSON.stringify(plugins, null, indent).split("\n").join(`\n${indent}`);
  const span = topLevelValue(text, "plugins");
  if (span !== undefined) return `${text.slice(0, span.start)}${value}${text.slice(span.end)}`;
  const close = text.lastIndexOf("}");
  const before = text.slice(0, close).replace(/\s*$/, "");
  return `${before}${before.endsWith("{") ? "" : ","}\n${indent}"plugins": ${value}\n${text.slice(close)}`;
}

/** The end of the JSON string whose opening quote is at `open`: the index of its closing quote. */
function stringEnd(text: string, open: number): number {
  let i = open + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i;
}

/** Where a top-level key's value starts and ends in a JSON object's text, strings and nesting read; undefined when the object has no such key. */
function topLevelValue(text: string, key: string): { start: number; end: number } | undefined {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      const close = stringEnd(text, i);
      const name = text.slice(i + 1, close);
      i = close;
      const colon = /^\s*:\s*/.exec(text.slice(i + 1));
      if (depth === 1 && colon !== null && name === key) {
        const start = i + 1 + colon[0].length;
        return { start, end: valueEnd(text, start) };
      }
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
  }
  return undefined;
}

/** Where the JSON value starting at `start` ends. */
function valueEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      i = stringEnd(text, i);
      if (depth === 0) return i + 1;
    } else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
      if (depth < 0) return i;
    } else if (depth === 0 && /[,\s]/.test(c)) return i;
  }
  return text.length;
}

export function ejectPlugin(root: string, name: string, to?: string): Ejected {
  const source = join(PLUGIN_SOURCES, name);
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !existsSync(join(source, MANIFEST))) {
    const bundled = existsSync(PLUGIN_SOURCES) ? readdirSync(PLUGIN_SOURCES).filter((n) => existsSync(join(PLUGIN_SOURCES, n, MANIFEST))) : [];
    throw new EjectError(`plugin eject: no bundled plugin is named ${JSON.stringify(name)}; the bundled plugins are ${bundled.join(", ")}`);
  }
  const target = resolve(root, to ?? join("coherence-plugins", name));
  const folder = relative(resolve(root), target).split(sep).join("/");
  // Followed through every symbolic link on the way, on the target and on the root alike: a link inside the project to a folder outside it leaves it.
  let present = false;
  try {
    lstatSync(target);
    present = true;
  } catch {
    // Absent: the eject writes it.
  }
  const refusePresent = (): never => {
    throw new EjectError(`plugin eject: ${folder} exists${existsSync(target) ? "" : " as a symbolic link that leads nowhere"}; eject into a new folder (--to <dir>), or remove it first`);
  };
  const lands = landsWithin(root, target);
  if (lands === undefined) {
    if (present) refusePresent();
    throw new EjectError(`plugin eject: ${folder} passes through a symbolic link that leads nowhere; eject into a folder that does not`);
  }
  if (folder === "" || !lands) throw new EjectError(`plugin eject: ${to ?? folder} is not a folder inside the project; a plugin's path in the config stays inside it`);
  if (present) refusePresent();
  const configPath = join(root, CONFIG_FILE);
  const configText = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;
  const config = configText === undefined ? {} : (JSON.parse(configText) as Record<string, unknown>);
  const plugins = (config["plugins"] ?? {}) as Record<string, unknown>;
  if (typeof plugins !== "object" || plugins === null || Array.isArray(plugins)) throw new EjectError(`plugin eject: ${CONFIG_FILE}'s plugins is not an object of plugins`);
  // A plugin the project runs bundled is the one being copied: the copy takes that entry's place. One it runs from a path is a copy already.
  if (name in plugins && plugins[name] !== "bundled") throw new EjectError(`plugin eject: ${CONFIG_FILE} already runs plugin ${name} from ${JSON.stringify(plugins[name])}; remove that entry to eject it again`);
  // Every file read and rewritten before any is written: a refusal leaves nothing behind.
  const copies = filesUnder(source).map((file) => {
    const rel = relative(source, file);
    return { rel, text: ejectedSource(rel, readFileSync(file, "utf8")) };
  });
  // The copy's modules are ES modules run as TypeScript: a package.json saying so, unless it carries one, keeps Node from guessing (and
  // warning) at every load, whatever the project's own package.json says.
  if (!copies.some(({ rel }) => rel === "package.json")) copies.push({ rel: "package.json", text: '{ "type": "module", "private": true }\n' });
  for (const { rel, text } of copies) {
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), text);
  }
  // Only the plugins key's text changes: every other byte of the config, its arrays as written among them, stays.
  writeFileSync(configPath, withPlugins(configText ?? "{}\n", { ...plugins, [name]: `./${folder}` }));
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
