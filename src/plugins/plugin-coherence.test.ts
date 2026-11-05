/**
 * The plugin interface kept to one model of each language: a language whose
 * plugin names no parser, or a slot a plugin leaves empty, is said as not
 * read, never read as an empty project; no plugin answers one question in
 * two slots; and the core names no language's files, which are its
 * plugin's to name.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { readEnforcementConfig } from "../enforcement/config.ts";
import { computeMass, formatMass } from "../economy/mass.ts";
import { LOCKFILES } from "../lifecycle/lockfiles.ts";
import { repeatedAnswers } from "./languages.ts";
import type { PluginManifest } from "./plugin.ts";
import { BUNDLED_DIR } from "./registry.ts";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-plugin-coherence-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return root;
}

const STAND_IN = 'export default { adapter: ({ language }) => ({ language, ladder: { top: "reference-choked", because: "a stand-in", rungs: [] }, ready: async () => ({ ok: true }), resolve: async () => ({ ok: false, reason: "a stand-in" }), references: async () => [], visibility: async () => ({ enforced: false, visible: true, evidence: "a stand-in" }), testFilter: (via) => via, refute: async () => ({ seen: false, staged: [], account: "a stand-in" }), forget: async () => {}, close: async () => {} }) };\n';

test("a plugin that names no parser is named not read by mass, with why, never measured as a project of no code", () => {
  const root = project({
    "coherence.config.json": JSON.stringify({ language: ["zz"], plugins: { zz: "./plugins/zz" } }),
    "plugins/zz/plugin.json": JSON.stringify({ name: "zz", version: "0.1.0", pluginApi: 2, provides: { language: "zz" }, module: "./index.ts", extensions: [".zz"] }),
    "plugins/zz/index.ts": STAND_IN,
    "app/accounts.zz": "verb reset\nverb rename\n",
  });
  readEnforcementConfig(root);
  const report = computeMass(root);
  assert.deepEqual(report.languages.read, []);
  assert.deepEqual(report.languages.unread.map((u) => u.language), ["zz"]);
  assert.match(report.languages.unread[0]!.because, /the zz plugin names no treeSitter parser/);
  assert.match(formatMass(report), /zz NOT READ/);
});

/** Every bundled plugin, the opt-in ones too, as the loader holds it. */
function bundled(): { name: string; version: string; dir: string; source: string; manifest: PluginManifest }[] {
  return readdirSync(BUNDLED_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      const dir = join(BUNDLED_DIR, e.name);
      try {
        const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8")) as PluginManifest;
        return [{ name: manifest.name, version: manifest.version, dir, source: "bundled", manifest }];
      } catch {
        return [];
      }
    });
}

test("no bundled plugin gives one answer in two slots: no two of its slots' functions are one function or two spelled alike", () => {
  const plugins = bundled();
  assert.ok(plugins.length >= 6, plugins.map((p) => p.name).join(", "));
  for (const plugin of plugins) assert.deepEqual(repeatedAnswers(plugin), [], `${plugin.name} answers a question twice`);
});

/** The literal file names a regular expression over a base name or a path spells: ^Cargo\.toml$ is Cargo.toml, ^(.*)/mod\.rs$ is mod.rs. */
function spelled(pattern: string): string[] {
  return (pattern.match(/[\w-]+(?:\\\.[\w-]+)+/g) ?? []).map((name) => name.replace(/\\\./g, "."));
}

/** The code of a module, its comments dropped: a comment may name a language's files as an example, and only what runs is held. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/**
 * A core module that names a language's files, and why it may: the one
 * module that names every ecosystem's lockfiles, plugin or none, to leave
 * machine-written files out of the lexicon's corpus.
 */
const MAY_NAME: Readonly<Record<string, string>> = {
  "lifecycle/check.ts": "the lexicon check leaves every ecosystem's lockfiles out of its corpus, a language with a plugin or not",
};

test("the core names no language's files: what a plugin lists as its basis or its module files appears in no core module's code, so knowledge of a language stays in its plugin", () => {
  // Coherence runs on Node, so npm's files are its own install's, not a project language's.
  const own = new Set(["package.json", ...LOCKFILES.map(([file]) => file)]);
  const names = new Set(bundled().flatMap((p) => [...(p.manifest.basisFiles ?? []), ...(p.manifest.moduleFolders ?? [])].flatMap(spelled)).filter((n) => !own.has(n)));
  assert.ok(["Cargo.toml", "mod.rs", "__init__.py", "pyproject.toml", "go.mod"].every((n) => names.has(n)), [...names].join(", "));
  const walk = (folder: string): string[] =>
    readdirSync(join(SRC, folder), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "fixtures" ? [] : walk(join(folder, e.name))) : [join(folder, e.name)]));
  const found = walk("")
    .filter((f) => f.endsWith(".ts") && !/\.(?:test|e2e)\.ts$|-fixture\.ts$/.test(f) && MAY_NAME[f] === undefined)
    .flatMap((f) => {
      const text = code(readFileSync(join(SRC, f), "utf8"));
      return [...names].filter((n) => text.includes(n)).map((n) => `${f} names ${n}`);
    });
  assert.deepEqual(found, [], "a language's files are named in its plugin's manifest (basisFiles, moduleFolders), and the core reads them from there");
});
