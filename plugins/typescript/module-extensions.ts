/**
 * The extensions a JavaScript or TypeScript module is written under, read
 * from this plugin's manifest: serverExtensions lists them, and source.except
 * says which are JavaScript. Every reader here that resolves an import by hand
 * (the plugin's resolution and its entrances) takes them from this module, and
 * a plugin that extends TypeScript reads the same list through the registry
 * (serverExtensions("typescript")): a copy of its own is how one reader came
 * to miss .jsx.
 */

import manifest from "./plugin.json" with { type: "json" };
import { escape } from "../../src/plugins/api.ts";

/** Every extension a module file may have, TypeScript's first, in the order a resolution tries them. */
export const MODULE_EXTENSIONS: readonly string[] = manifest.serverExtensions;

/** A specifier ending in a JavaScript extension, which a TypeScript import writes for the .ts file it means. */
export const JAVASCRIPT_EXTENSION = new RegExp(manifest.source.except);

export const JAVASCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(MODULE_EXTENSIONS.filter((e) => JAVASCRIPT_EXTENSION.test(e)));

export const TYPESCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(MODULE_EXTENSIONS.filter((e) => !JAVASCRIPT_EXTENSION.test(e)));

/** The extensions a folder's index file may have: TypeScript resolves no .mts, .cts, .mjs or .cjs index. */
export const INDEX_EXTENSIONS: readonly string[] = MODULE_EXTENSIONS.filter((e) => !/^\.[cm]/.test(e));

/** A path ending in any module extension: what a path with its extension stripped is stripped of. */
export const MODULE_EXTENSION = new RegExp(`(?:${MODULE_EXTENSIONS.map(escape).join("|")})$`);
