/**
 * When the journal last named each concept: the order the start injection
 * keeps the vocabulary in (lexicon.ts byRecency).
 *
 * The journal is the project's timestamped trail of what its work named:
 * every decision, defect, conjecture and escalation, and every lexicon
 * change, which is itself a record naming the concept. So one reading
 * answers both when a concept was last used and when it was last touched. A
 * concept is named by its name, an alias or an instance, as whole words in
 * a record's prose (never its ids, paths or states), singular or plural.
 */

import { recordWords, type JournalRecord } from "../journal/record.ts";
import { aliasNames, type Concept, type LastNamed } from "./lexicon.ts";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The words that name a concept, as one pattern: each spelling as whole words, its words apart by any space, with a plural ending. */
function namePattern(concept: Concept): RegExp {
  const spellings = [concept.name, ...concept.aliases.flatMap(aliasNames), ...(concept.instances ?? [])]
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => s.split(/\s+/).map(escape).join("\\s+"));
  return new RegExp(`(?<![\\w-])(?:${spellings.join("|")})(?:s|es)?(?![\\w-])`, "i");
}

/**
 * The latest time a record names each concept, by the concept's name
 * lowercased. Records are read newest first and the reading stops once every
 * concept has a time, so it costs the records since the least recent one.
 */
export function lastNamed(records: readonly JournalRecord[], concepts: readonly Concept[]): LastNamed {
  const out = new Map<string, string>();
  const waiting = new Map<string, RegExp>();
  for (const concept of concepts) waiting.set(concept.name.toLowerCase(), namePattern(concept));
  for (let i = records.length - 1; i >= 0 && waiting.size > 0; i--) {
    const record = records[i]!;
    const prose = recordWords(record, (role) => role !== "meta").join("\n");
    for (const [name, pattern] of waiting) {
      if (!pattern.test(prose)) continue;
      out.set(name, record.at);
      waiting.delete(name);
    }
  }
  return out;
}
