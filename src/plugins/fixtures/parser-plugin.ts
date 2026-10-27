/**
 * A plugin folder for the plugin interface's tests that reads a made-up
 * language, "zz", through Python's tree-sitter parser and queries: the one
 * way a plugin reads its language's text (docs/plugins.md, Reading through a
 * parser), so a test that needs a language the core reads uses this, never a
 * hand-written reader, which no plugin may fill.
 */

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_API, type PluginManifest } from "../plugin.ts";
import { BUNDLED_DIR } from "../registry.ts";

/** Where an import leads (nowhere), and an interfaces table that states only the language's own facts. */
export const PARSER_RESOLVE = "export const RESOLVE = { resolveModule: () => undefined, modulePaths: () => [] };\nexport const FACTS = { serverBounds: false };\n";

/**
 * Write the plugin into `dir`: Python's parser as zz.wasm and its queries as
 * zz.scm, a resolve that leads nowhere, an empty module, and a manifest for
 * the current pluginApi, each overridden by `manifest` and `files`.
 */
export function writeParserPlugin(dir: string, manifest: Record<string, unknown> = {}, files: Record<string, string> = {}): PluginManifest {
  mkdirSync(dir, { recursive: true });
  const python = join(BUNDLED_DIR, "python");
  copyFileSync(join(python, "tree-sitter-python.wasm"), join(dir, "zz.wasm"));
  copyFileSync(join(python, "python.scm"), join(dir, "zz.scm"));
  writeFileSync(join(dir, "resolve.ts"), PARSER_RESOLVE);
  writeFileSync(join(dir, "index.ts"), "export default {};\n");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const full = { name: "zz", version: "0.1.0", pluginApi: PLUGIN_API, provides: { language: "zz" }, extensions: [".zz"], module: "./index.ts", treeSitter: { parser: "zz.wasm", queries: "zz.scm", resolve: "resolve.ts#RESOLVE" }, ...manifest };
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(full));
  return full as PluginManifest;
}
