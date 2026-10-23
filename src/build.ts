/**
 * The published package's build: `npm run build`. Node will not strip types
 * from a file under node_modules, so the package ships JavaScript compiled
 * from src into dist, at the same depth, so every path a module takes from
 * its own location (the lexicon and checklist seed in docs, the package.json)
 * resolves the same compiled as in a checkout. Beside the JavaScript go the
 * files modules read at run time: the data files, the stylesheet, the Scope
 * browser sources stripped by the same stripper a checkout runs when it
 * builds a page, and the one font file the page embeds with its license.
 * npm runs this as prepare, so an install from the git repository builds too.
 */

import { spawnSync } from "./lifecycle/work-meter.ts";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserSources, strippedName } from "./readings/scope/build.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");
const scope = join("readings", "scope");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__pycache__" ? [] : files(path);
    return [path];
  });
}

function copy(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

rmSync(dist, { recursive: true, force: true });
// The compiler as the package resolver finds it from this checkout, never a path into node_modules built by hand (installed.ts).
const tsc = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("typescript/bin/tsc"), "-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
// The plugin interface's types, for a plugin's author (package.json exports them as @posthog/coherence/plugin): plugin.ts and the types it names.
const types = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("typescript/bin/tsc"), "-p", join(root, "tsconfig.plugin-types.json")], { stdio: "inherit" });
if (types.status !== 0) process.exit(types.status ?? 1);
// A declaration keeps the source's .ts specifiers; beside the compiled .js each names its .d.ts by the .js a reader resolves.
for (const file of files(dist).filter((f) => f.endsWith(".d.ts"))) writeFileSync(file, readFileSync(file, "utf8").replace(/(from\s+["']\.{1,2}\/[^"']+)\.ts(["'])/g, "$1.js$2"));

for (const file of files(src)) {
  const at = relative(src, file);
  // A test's fixture plugin is the tests' alone: never shipped.
  if (at.startsWith(join("plugins", "fixtures"))) continue;
  if (/\.(json|css)$/.test(file) || dirname(at) === join(scope, "fonts")) copy(file, join(dist, at));
}
// The bundled plugins (plugins/): their manifests and the defaults beside them, and each module stripped of its types, at
// dist/bundled at the same depth as plugins/ beside src, so a plugin's import of the core ("../../src/x.ts") is the compiled
// one ("../../x.js") and its own siblings keep their names. A manifest names its modules as .js there.
const plugins = join(root, "plugins");
const bundled = join(dist, "bundled");
for (const file of files(plugins)) {
  const at = relative(plugins, file);
  if (/\.(test|e2e)\.ts$/.test(file)) continue;
  if (file.endsWith(".ts")) {
    const code = stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" })
      .replace(/((?:\bfrom|\bimport)\s*\(?\s*["'])\.\.\/\.\.\/src\//g, "$1../../")
      .replace(/((?:\bfrom|\bimport)\s*\(?\s*["']\.{1,2}\/[^"']+)\.ts(["'])/g, "$1.js$2");
    mkdirSync(dirname(join(bundled, at)), { recursive: true });
    writeFileSync(join(bundled, at.replace(/\.ts$/, ".js")), code);
  } else if (file.endsWith(".json")) {
    const text = readFileSync(file, "utf8");
    // Every module a manifest names (its module and each syntax slot's) by the .js the build wrote.
    writeFileSync((mkdirSync(dirname(join(bundled, at)), { recursive: true }), join(bundled, at)), basename(file) === "plugin.json" ? text.replace(/("[A-Za-z]+":\s*"[^"#/]+)\.ts(["#])/g, "$1.js$2") : text);
  } else if (file.endsWith(".md")) {
    // The abstract plugin spec every plugin is held to, and each plugin's own spec, whose overrides plugin check and the readings read.
    mkdirSync(dirname(join(bundled, at)), { recursive: true });
    writeFileSync(join(bundled, at), readFileSync(file, "utf8"));
  }
}

// The same modules the page joins, found the same way: from the entry, by what each imports at run time.
for (const name of await browserSources()) {
  const source = readFileSync(join(src, scope, name), "utf8");
  writeFileSync(join(dist, scope, strippedName(name)), stripTypeScriptTypes(source, { mode: "strip" }));
}
