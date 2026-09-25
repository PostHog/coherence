/**
 * Where prose writes a word as a name: the one reading both vocabulary
 * coverage and the lexicon check's unknown nouns take from a line of prose,
 * so the two never disagree about what a name is. Title Case away from a
 * sentence start is a proper noun; a single backticked plain word and a
 * heading's words are names too, but not proper ones. Never a name: the
 * capitalized tail of an acronym or a model number ("M4 Pro", "SF Pro"),
 * a word English capitalizes in any sentence (months, weekdays, languages),
 * and a capitalized common word opening the phrase ("Every Durable Object").
 */

import { normalizeTerm } from "./check.ts";
import { ALWAYS_CAPITALIZED, STOPLIST } from "./stoplist.ts";

/** A name as vocabulary spells a term: camelCase split, then lowercased ("PostHog" -> "post hog"). */
export const clean = (s: string): string =>
  normalizeTerm(
    s
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2"),
  );

const HEADING_WORD = /[A-Za-z][A-Za-z'-]*/g;

/** Whether the text before a match on a line puts the match at the start of a sentence. */
export function atSentenceStart(prefix: string): boolean {
  const lead = prefix.replace(/^[\s>*\-+|#]*(?:\d+[.)]\s*)?/, "");
  if (lead.trim() === "") return true;
  const trimmed = lead.replace(/[\s"'*_)\]]+$/, "");
  return /[.!?:|]$/.test(trimmed) || trimmed === "";
}

export interface Nomination {
  term: string;
  /** The name as written, for a well-known name skipped only in its capitalized spelling. */
  spelling: string;
  /** Title Case away from a sentence start: a proper noun, so a common word stays a candidate. */
  proper: boolean;
}

/** Names prose writes as names: Title Case away from a sentence start, heading words, a single backticked word. */
export function proseNominations(text: string, heading: boolean): Nomination[] {
  const out: Nomination[] = [];
  let blanked = text;
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const inner = match[1]!.trim();
    // One plain word only: a backticked identifier (flowOf, work_order) is a code reference, not a word.
    if (/^[A-Za-z][a-z]+$/.test(inner)) out.push({ term: clean(inner), spelling: inner, proper: false });
    blanked = blanked.slice(0, match.index) + " ".repeat(match[0].length) + blanked.slice(match.index + match[0].length);
  }
  blanked = blanked.replace(/\[([^\]]*)\]\([^)]*\)/g, (m, label: string) => label.padEnd(m.length));
  if (heading) {
    for (const m of blanked.replace(/^#+\s*/, "").matchAll(HEADING_WORD)) out.push({ term: clean(m[0]), spelling: m[0], proper: false });
    return out;
  }
  for (const match of blanked.matchAll(/(?<![A-Za-z0-9_'./-])[A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,2}(?![A-Za-z0-9_/-]|\.[A-Za-z0-9])/g)) {
    // A capitalized common word opening the phrase ("Every Durable Object") is the sentence's, not the name's.
    let phrase = match[0];
    let start = match.index;
    for (;;) {
      const lead = /^([A-Za-z]+)[\s-]+/.exec(phrase);
      if (lead === null || !STOPLIST.has(lead[1]!.toLowerCase())) break;
      phrase = phrase.slice(lead[0].length);
      start += lead[0].length;
    }
    if (atSentenceStart(blanked.slice(0, start))) continue;
    // A capitalized word after an acronym or a model number ("M4 Pro", "SF Pro", "**STL Quest**") is the tail of that product's name.
    if (/(?:(?:^|[\s*_(["'])[A-Z]{2,}|(?:^|\s)\S*\d\S*)\s+$/.test(blanked.slice(0, start))) continue;
    // Months, weekdays and language names are capitalized in any sentence; that is English, not a proper noun of the project's.
    if (ALWAYS_CAPITALIZED.has(clean(phrase))) continue;
    out.push({ term: clean(phrase), spelling: phrase, proper: true });
  }
  return out;
}
