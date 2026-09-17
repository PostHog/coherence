/**
 * Which adapter a project gets: the config's `language`, else TypeScript.
 */

import { PythonAdapter } from "./python.ts";
import { TypeScriptAdapter } from "./typescript.ts";
import type { LanguageAdapter } from "./adapter.ts";

export const LANGUAGES = ["typescript", "python"] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export function adapterFor(language: Language, root: string): LanguageAdapter {
  switch (language) {
    case "typescript":
      return new TypeScriptAdapter(root);
    case "python":
      return new PythonAdapter(root);
  }
}
