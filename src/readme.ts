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

const OPEN = /<!-- generated: ([a-z -]+) -->/g;
const CLOSE = "<!-- /generated -->";

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
const table = (header: string, plugins: Bundled[], note: (p: Bundled) => string = () => ""): string =>
  [`| Plugin | ${header} |`, "|---|---|", ...plugins.map((p) => `| \`${p.name}\` | ${p.title}, ${p.description}${note(p)} |`)].join("\n");

/** Whether an opt-in plugin provides a language that no default plugin does, which the opt-in table says, since naming it adds a language rather than swapping one. */
const newLanguage = (p: Bundled, plugins: Bundled[]): boolean => {
  const language = p.manifest.provides?.language;
  return !p.byDefault && language !== undefined && !plugins.some((d) => d.byDefault && d.manifest.provides?.language === language);
};

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
    "opt-in plugins": table("Adds", plugins.filter((p) => !p.byDefault), (p) => (newLanguage(p, plugins) ? ": a language no default plugin provides, read as one is once a project names it" : "")),
  };
}

/**
 * The file's text with every generated block written afresh; a block the file
 * is not owed, one it is owed and lacks, and one opened and not closed before
 * the next block opens are named. An unclosed block is left as it stands: read
 * to the next closing marker, it would swallow the author's text between.
 */
export function fill(file: string, text: string, blocks: Record<string, string> = generatedBlocks()): { text: string; problems: string[] } {
  const owed = GENERATED[file] ?? [];
  const problems: string[] = [];
  const seen = new Set<string>();
  let filled = "";
  let at = 0;
  for (;;) {
    OPEN.lastIndex = at;
    const open = OPEN.exec(text);
    if (open === null) break;
    const name = open[1]!;
    const inner = open.index + open[0].length;
    seen.add(name);
    const close = text.indexOf(CLOSE, inner);
    OPEN.lastIndex = inner;
    const next = OPEN.exec(text);
    if (close === -1 || (next !== null && next.index < close)) {
      problems.push(`${file} opens its generated block ${name} and does not close it with ${CLOSE} before ${next === null ? "the file ends" : `the block ${next[1]} opens`}`);
      filled += text.slice(at, inner);
      at = inner;
      continue;
    }
    const block = owed.includes(name) ? blocks[name] : undefined;
    if (block === undefined) {
      problems.push(`${file} carries a generated block named ${name}, which it is not owed (${owed.join(", ")})`);
      filled += text.slice(at, close + CLOSE.length);
    } else {
      filled += text.slice(at, open.index) + (block.includes("\n") ? `<!-- generated: ${name} -->\n${block}\n${CLOSE}` : `<!-- generated: ${name} -->${block}${CLOSE}`);
    }
    at = close + CLOSE.length;
  }
  filled += text.slice(at);
  for (const name of owed) if (!seen.has(name)) problems.push(`${file} lacks its generated block ${name}: <!-- generated: ${name} -->${CLOSE}`);
  return { text: filled, problems };
}

/**
 * Every generated file under dir written afresh, or, when any file has a
 * problem, none written: a file filled around a broken marker could lose text.
 */
export function regenerate(dir: string, blocks: Record<string, string> = generatedBlocks()): { files: { file: string; changed: boolean }[]; problems: string[] } {
  const results = Object.keys(GENERATED).map((file) => {
    const path = join(dir, file);
    const before = readFileSync(path, "utf8");
    return { file, path, before, ...fill(file, before, blocks) };
  });
  const problems = results.flatMap((r) => r.problems);
  if (problems.length === 0) for (const r of results) if (r.text !== r.before) writeFileSync(r.path, r.text);
  return { files: results.map((r) => ({ file: r.file, changed: r.text !== r.before })), problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files, problems } = regenerate(root);
  for (const problem of problems) console.error(problem);
  for (const { file, changed } of files) console.log(`${file}: ${!changed ? "current" : problems.length > 0 ? "not written, for the problems above" : "written"}`);
  if (problems.length > 0) process.exitCode = 1;
}
