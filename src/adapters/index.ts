/**
 * Which adapter a project gets: the config's `language`, else TypeScript.
 * `language` names one instrument or a list of them; a list is one
 * composite adapter over its members.
 *
 * Two sets of keys: the languages the plain scans read (economy, mass,
 * observation), and the instruments a check can ask, which add dbt. dbt has
 * no source language of its own to scan; its manifest is the instrument.
 */

import { CompositeAdapter } from "./composite.ts";
import { DbtAdapter } from "./dbt.ts";
import { PythonAdapter } from "./python.ts";
import { TypeScriptAdapter } from "./typescript.ts";
import type { AdapterBounds, LanguageAdapter } from "./adapter.ts";

export const LANGUAGES = ["typescript", "python"] as const;
export type Language = (typeof LANGUAGES)[number];

export const INSTRUMENTS = [...LANGUAGES, "dbt"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export function isInstrument(value: string): value is Instrument {
  return (INSTRUMENTS as readonly string[]).includes(value);
}

/**
 * The adapter for the language, over the whole workspace; with bounds, one
 * whose server leaves the bounded-away folders out, for the component
 * interface reading alone (Python narrows its workspace; TypeScript's server
 * reads the project its tsconfig names and takes no bounds). A list of
 * instruments is one composite adapter over them, in the order given.
 */
export function adapterFor(language: Instrument | readonly Instrument[], root: string, bounds?: AdapterBounds): LanguageAdapter {
  if (typeof language !== "string") {
    const members = [...new Set(language)].map((one) => adapterFor(one, root, bounds));
    return members.length === 1 ? members[0]! : new CompositeAdapter(members);
  }
  switch (language) {
    case "typescript":
      return new TypeScriptAdapter(root);
    case "python":
      return new PythonAdapter(root, undefined, bounds);
    case "dbt":
      return new DbtAdapter(root);
  }
}
