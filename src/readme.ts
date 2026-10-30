/**
 * The lists the README and plugins/README.md keep of the agent hosts and the
 * bundled plugins, generated: `npm run readme`. A list typed by hand beside
 * the plugins it names drifts the day a plugin is added or a host supported,
 * so each lives between `<!-- generated: <block> -->` and
 * `<!-- /generated -->`, written from HOSTS and each bundled manifest's title
 * and description, and readme.test.ts holds every file equal to what this
 * writes. Everything outside the markers is the author's and never touched.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_TITLE, HOSTS } from "./lifecycle/hosts.ts";
import { bundledPlugins } from "./plugins/languages.ts";
import type { PluginManifest } from "./plugins/plugin.ts";
import { BUNDLED_DIR, readManifest } from "./plugins/registry.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The files that carry generated blocks, relative to the checkout, and the blocks each is owed. */
export const GENERATED: Readonly<Record<string, readonly string[]>> = {
  "README.md": ["agents", "languages", "language plugins", "tool plugins"],
  "plugins/README.md": ["default plugins", "opt-in plugins"],
};

const MARKED = /<!-- generated: ([a-z -]+) -->[\s\S]*?<!-- \/generated -->/g;

interface Bundled {
  name: string;
  title: string;
  description: string;
  manifest: PluginManifest;
  /** Whether every project runs it, or only one whose config names it. */
  byDefault: boolean;
}

/** Every bundled plugin, the defaults first in their own order, then the opt-in ones by name; one without a title or description is the package's fault. */
function bundled(): Bundled[] {
  const defaults = bundledPlugins().map((p) => p.name);
  const optIn = readdirSync(BUNDLED_DIR).filter((name) => !defaults.includes(name) && existsSync(join(BUNDLED_DIR, name, "plugin.json"))).sort();
  return [...defaults, ...optIn].map((name) => {
    const read = readManifest(name, join(BUNDLED_DIR, name), `bundled plugin ${name}`);
    const manifest = read.manifest;
    if (manifest === undefined) throw new Error(read.problems.join("; "));
    if (manifest.title === undefined || manifest.description === undefined) throw new Error(`bundled plugin ${name} carries no title or description in its plugin.json, which the generated lists name it by`);
    return { name, title: manifest.title, description: manifest.description, manifest, byDefault: defaults.includes(name) };
  });
}

const optInNote = (p: Bundled): string => (p.byDefault ? "" : ` (opt-in: \`"plugins": { "${p.name}": "bundled" }\`)`);
const bullets = (plugins: Bundled[]): string => plugins.map((p) => `- **${p.title}**, ${p.description}${optInNote(p)}`).join("\n");
const table = (header: string, plugins: Bundled[]): string => [`| Plugin | ${header} |`, "|---|---|", ...plugins.map((p) => `| \`${p.name}\` | ${p.title}, ${p.description} |`)].join("\n");

/** Each block's text, by name: a one-line block sits inline between its markers, a longer one on lines of its own. */
export function generatedBlocks(): Record<string, string> {
  const plugins = bundled();
  const named = plugins.filter((p) => p.manifest.provides?.language !== undefined);
  const declared = plugins.filter((p) => p.manifest.provides?.declaredLanguages === true);
  const tools = plugins.filter((p) => p.manifest.provides === undefined);
  return {
    agents: HOSTS.map((host) => HOST_TITLE[host]).join(", "),
    languages: named.map((p) => `${p.title}${p.byDefault ? "" : " (opt-in)"}`).join(", "),
    "language plugins": bullets([...named, ...declared]),
    "tool plugins": bullets(tools),
    "default plugins": table("Provides", plugins.filter((p) => p.byDefault)),
    "opt-in plugins": table("Adds", plugins.filter((p) => !p.byDefault)),
  };
}

/** The file's text with every generated block written afresh; a block the file is not owed, or one it is owed and lacks, is named. */
export function fill(file: string, text: string, blocks: Record<string, string> = generatedBlocks()): { text: string; problems: string[] } {
  const owed = GENERATED[file] ?? [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const filled = text.replace(MARKED, (whole, name: string) => {
    seen.add(name);
    const block = owed.includes(name) ? blocks[name] : undefined;
    if (block === undefined) {
      problems.push(`${file} carries a generated block named ${name}, which it is not owed (${owed.join(", ")})`);
      return whole;
    }
    return block.includes("\n") ? `<!-- generated: ${name} -->\n${block}\n<!-- /generated -->` : `<!-- generated: ${name} -->${block}<!-- /generated -->`;
  });
  for (const name of owed) if (!seen.has(name)) problems.push(`${file} lacks its generated block ${name}: <!-- generated: ${name} --><!-- /generated -->`);
  return { text: filled, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const blocks = generatedBlocks();
  let failed = false;
  for (const file of Object.keys(GENERATED)) {
    const path = join(root, file);
    const before = readFileSync(path, "utf8");
    const { text, problems } = fill(file, before, blocks);
    for (const problem of problems) console.error(problem);
    failed ||= problems.length > 0;
    if (text !== before) writeFileSync(path, text);
    console.log(`${file}: ${text === before ? "current" : "written"}`);
  }
  if (failed) process.exitCode = 1;
}
