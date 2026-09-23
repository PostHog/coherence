/**
 * Names with so much gravity that no project definition could make them less
 * ambiguous: the curated list shipped beside this file (its inclusion rule is
 * written at the top of well-known.json), the names a project vouches for in
 * its config, and the project's own name. A well-known name is never a
 * vocabulary candidate. A name under `cased` is well known only in its
 * capitalized spelling, so a lowercase use of the same word in a project
 * sense stays a candidate.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTerm } from "./check.ts";
import type { VocabularyFacts } from "./project.ts";

export const WELL_KNOWN_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "well-known.json");

export interface WellKnown {
  /** Normalized names skipped in any spelling. */
  any: ReadonlySet<string>;
  /** Normalized name -> the one capitalized spelling that is skipped. */
  cased: ReadonlyMap<string, string>;
  /** The list's version, so a reading can say which list it applied. */
  version: number;
}

interface WellKnownFile {
  version: number;
  rule: string;
  names: string[];
  cased: string[];
}

let shipped: WellKnownFile | undefined;

function list(): WellKnownFile {
  shipped ??= JSON.parse(readFileSync(WELL_KNOWN_FILE, "utf8")) as WellKnownFile;
  return shipped;
}

/** A name as coverage spells a term: camelCase split, then lowercased ("PostHog" -> "post hog"). */
function spelled(name: string): string {
  return normalizeTerm(name.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2"));
}

/** The shipped list plus what the project vouches for; the project's own name is skipped in any spelling. */
export function wellKnown(facts: VocabularyFacts | undefined, projectNames: readonly string[] = []): WellKnown {
  const file = list();
  const any = new Set<string>();
  for (const name of [...file.names, ...(facts?.wellKnown ?? []), ...(facts?.name ? [facts.name] : []), ...projectNames]) {
    any.add(normalizeTerm(name));
    any.add(spelled(name));
  }
  const cased = new Map<string, string>();
  for (const name of file.cased) if (!any.has(normalizeTerm(name))) cased.set(normalizeTerm(name), name);
  return { any, cased, version: file.version };
}

/** Whether a term, as spelled at one site, is well known there. Without a spelling only the any-case names match. */
export function isWellKnown(known: WellKnown, term: string, spelling?: string): boolean {
  const key = normalizeTerm(term);
  if (known.any.has(key)) return true;
  const cased = known.cased.get(key);
  return cased !== undefined && spelling !== undefined && spelling.replace(/[\s_-]+/g, " ").trim() === cased;
}
