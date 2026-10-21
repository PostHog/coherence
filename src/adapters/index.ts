/**
 * Which adapter a project gets: the config's `language`, else TypeScript; a
 * language the config declares (declared.ts) is read by the generic adapter.
 */

import { DeclaredAdapter, type DeclaredLanguage } from "./declared.ts";
import { PythonAdapter } from "./python.ts";
import { RustAdapter } from "./rust.ts";
import { TypeScriptAdapter } from "./typescript.ts";
import type { AdapterBounds, LanguageAdapter } from "./adapter.ts";

export const LANGUAGES = ["typescript", "python", "rust"] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

/**
 * The adapter for the language, over the whole workspace; with bounds, one
 * whose server leaves the bounded-away folders out, for the component
 * interface reading alone (Python narrows its workspace; TypeScript's server
 * reads the project its tsconfig names and rust-analyzer its Cargo workspace,
 * and neither takes bounds).
 */
export function adapterFor(language: Language, root: string, bounds?: AdapterBounds): LanguageAdapter {
  switch (language) {
    case "typescript":
      return new TypeScriptAdapter(root);
    case "python":
      return new PythonAdapter(root, undefined, bounds);
    case "rust":
      return new RustAdapter(root);
  }
}

/**
 * The adapter for any of a project's languages: a built-in by its own
 * adapter, a language the config declares by the generic one; a name that is
 * neither is refused, never guessed.
 */
export function instrumentFor(language: string, root: string, declared: readonly DeclaredLanguage[]): LanguageAdapter {
  if (isLanguage(language)) return adapterFor(language, root);
  const found = declared.find((d) => d.name === language);
  if (found === undefined) throw new Error(`${language} is neither a built-in language (${LANGUAGES.join(", ")}) nor one the config declares`);
  return new DeclaredAdapter(root, found);
}
