/**
 * The glossary as the hook and the check see it.
 *
 * Two files share this reader: Coherence's own glossary (the tool vocabulary,
 * whose rejected entries sit on each concept as `{alternative, because}`) and a
 * project's domain glossary (the same concept shape, plus a top-level
 * `rejected` list of `{concept, because}`). Both parse into one `Glossary`.
 *
 * Only the vocabulary fields are read: name, definition, aliases, rejected,
 * not_to_be_confused_with, properties, related. `detail` and `provenance` are
 * Scope's and never leave the file through this module.
 */

import { readFile } from "node:fs/promises";

export interface RejectedAlternative {
  alternative: string;
  because: string;
}

export interface Concept {
  name: string;
  definition: string;
  aliases: string[];
  rejected: RejectedAlternative[];
  notToBeConfusedWith: string[];
  properties: Record<string, string>;
  related: string[];
}

export interface Glossary {
  /** Where it was read from; used to keep the file itself out of the check. */
  path: string;
  /** The project name the file declares, if any. */
  project: string | undefined;
  concepts: Concept[];
  /** Names rejected at the top level of the file, outside any concept. */
  rejected: RejectedAlternative[];
  /** The names of the trust levels a project declares; accepted names, never concepts. */
  trustLevels: string[];
}

/** A name that must not appear, with the concept it was refused for and why. */
export interface RejectedName {
  name: string;
  concept: string;
  because: string;
  /**
   * True when the rejection names one sense of an ordinary word, as
   * "convention / add_convention (change type)" does: the bare word in prose
   * cannot be told to be that sense, so it is matched only where text names
   * an identifier, in code and inside backticks.
   */
  identifierOnly: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
}

/** A rejected entry may name its alternative under `alternative`, `name`, or `concept`, or be a bare string. */
function parseRejected(value: unknown): RejectedAlternative[] {
  if (!Array.isArray(value)) return [];
  const out: RejectedAlternative[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      out.push({ alternative: entry, because: "" });
      continue;
    }
    if (!isRecord(entry)) continue;
    const alternative = entry["alternative"] ?? entry["name"] ?? entry["concept"];
    if (typeof alternative !== "string") continue;
    const because = entry["because"];
    out.push({ alternative, because: typeof because === "string" ? because : "" });
  }
  return out;
}

function parseConcept(value: unknown, where: string): Concept {
  if (!isRecord(value)) throw new Error(`${where}: a concept must be an object`);
  const name = value["name"];
  const definition = value["definition"];
  if (typeof name !== "string" || name.trim() === "") throw new Error(`${where}: a concept needs a name`);
  if (typeof definition !== "string") throw new Error(`${where} (${name}): a concept needs a definition`);
  return {
    name,
    definition,
    aliases: stringList(value["aliases"]),
    rejected: parseRejected(value["rejected"]),
    notToBeConfusedWith: stringList(value["not_to_be_confused_with"]),
    properties: stringMap(value["properties"]),
    related: stringList(value["related"]),
  };
}

export function parseGlossary(input: unknown, path: string): Glossary {
  if (!isRecord(input)) throw new Error(`${path}: a glossary must be an object`);
  const concepts = input["concepts"];
  if (!Array.isArray(concepts)) throw new Error(`${path}: concepts must be a list`);
  const project = input["project"];
  const trustLevels = Array.isArray(input["trust_levels"])
    ? input["trust_levels"].flatMap((t: unknown) => (isRecord(t) && typeof t["name"] === "string" ? [t["name"]] : []))
    : [];
  return {
    path,
    project: typeof project === "string" ? project : undefined,
    concepts: concepts.map((c, i) => parseConcept(c, `${path} concepts[${i}]`)),
    rejected: parseRejected(input["rejected"]),
    trustLevels,
  };
}

export async function loadGlossary(path: string): Promise<Glossary> {
  const text = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${(error as Error).message})`);
  }
  return parseGlossary(parsed, path);
}

/* ---------------------------------------------------------------- names */

/**
 * Words that mark an alternative as a design sentence rather than a name.
 * "a flat project-level set of invariants" is a rejected design; a two-word
 * noun phrase is a rejected name. Only names are matched in text.
 */
const CLAUSE_WORDS = new Set([
  "a", "an", "the", "as", "or", "and", "of", "in", "into", "for", "with", "to",
  "both", "every", "from", "at", "by", "on", "that", "this", "its", "is", "it",
  "vs", "than", "per", "only", "not", "no",
]);

/** Strip one or more trailing parentheticals: "organism (as a name for the hive)" -> "organism". */
function stripParenthetical(text: string): string {
  let out = text.trim();
  for (;;) {
    const next = out.replace(/\s*\([^()]*\)\s*$/, "").trim();
    if (next === out) return out;
    out = next;
  }
}

/** The trailing parenthetical of an alternative, if any: "(change type)" -> "change type". */
function trailingParenthetical(text: string): string | undefined {
  const match = /\(([^()]*)\)\s*$/.exec(text.trim());
  return match?.[1]?.trim();
}

/**
 * Whether a parenthetical restricts the sense of the name before it rather
 * than elaborating on it. "(as a name for the hive)" and "(change type)"
 * restrict; a list of examples with commas elaborates.
 */
function restrictsSense(parenthetical: string): boolean {
  if (parenthetical.includes(",")) return false;
  if (/^as\b/i.test(parenthetical)) return true;
  return parenthetical.split(/\s+/).length <= 2;
}

/** A token that is a literal form (a URI shape, a snake_case identifier) rather than a word. */
function isLiteralToken(token: string): boolean {
  return /[/{}_.:]/.test(token);
}

export interface AlternativeName {
  name: string;
  identifierOnly: boolean;
}

/**
 * The names an alternative contributes, or none when it reads as a sentence.
 * "canvas / notebook" contributes two; "records/{object}/{id} URI form"
 * contributes the phrase and the literal form inside it. A single word whose
 * parenthetical restricts its sense is identifier-only.
 */
export function namesOfAlternative(alternative: string): AlternativeName[] {
  const names: AlternativeName[] = [];
  const parenthetical = trailingParenthetical(alternative);
  const restricted = parenthetical !== undefined && restrictsSense(parenthetical);
  for (const part of stripParenthetical(alternative).split(/\s+\/\s+/)) {
    const phrase = stripParenthetical(part).replace(/[.,;]+$/, "").trim();
    if (phrase === "") continue;
    const words = phrase.split(/\s+/);
    if (words.length > 3 || phrase.includes(",")) continue;
    if (words.some((w) => CLAUSE_WORDS.has(w.toLowerCase()))) continue;
    const identifierOnly = restricted && words.length === 1;
    names.push({ name: phrase, identifierOnly });
    for (const word of words) if (isLiteralToken(word) && word !== phrase) names.push({ name: word, identifierOnly });
  }
  return names;
}

/** Every rejected name of a glossary, with its concept and because. Top-level rejections carry the file's project as their concept. */
export function rejectedNames(glossary: Glossary): RejectedName[] {
  const out: RejectedName[] = [];
  const seen = new Set<string>();
  const add = (alternative: string, concept: string, because: string): void => {
    for (const { name, identifierOnly } of namesOfAlternative(alternative)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, concept, because, identifierOnly });
    }
  };
  for (const concept of glossary.concepts) {
    for (const r of concept.rejected) add(r.alternative, concept.name, r.because);
  }
  const owner = glossary.project ?? "the glossary";
  for (const r of glossary.rejected) add(r.alternative, owner, r.because);
  return out;
}

/** An alias as written in a project glossary, without its explanatory parenthetical. "record (code term)" -> "record". */
export function aliasNames(alias: string): string[] {
  return stripParenthetical(alias)
    .split(/\s+\/\s+/)
    .map((a) => stripParenthetical(a).trim())
    .filter((a) => a !== "");
}

/** The names a glossary accepts: the project's name, every concept name, alias, and trust level, lowercased. */
export function acceptedNames(glossary: Glossary): Set<string> {
  const out = new Set<string>();
  if (glossary.project !== undefined) out.add(glossary.project.toLowerCase());
  for (const level of glossary.trustLevels) out.add(level.toLowerCase());
  for (const concept of glossary.concepts) {
    out.add(concept.name.toLowerCase());
    for (const alias of concept.aliases) for (const name of aliasNames(alias)) out.add(name.toLowerCase());
    // A property key names a part of the concept (a column, a field, a unit); it is vocabulary, not an unknown noun.
    for (const key of Object.keys(concept.properties)) for (const name of aliasNames(key)) out.add(name.toLowerCase());
  }
  return out;
}

/* -------------------------------------------------------------- compact */

/** A first sentence shorter than this is a label ("Compression."), so the next sentence is kept with it. */
const SHORT_SENTENCE = 30;

/** The first sentence of a definition (two when the first is a bare label), or the whole text. */
export function firstSentence(text: string): string {
  const sentence = /^(.*?[.!?])(?=\s+[A-Z("`]|\s*$)/s;
  const whole = text.trim();
  const first = sentence.exec(whole)?.[1];
  if (first === undefined) return whole.replace(/\s+/g, " ");
  let out = first;
  if (first.length < SHORT_SENTENCE) {
    const second = sentence.exec(whole.slice(first.length).trim())?.[1];
    if (second !== undefined) out = `${first} ${second}`;
  }
  return out.replace(/\s+/g, " ");
}

/** The lead of a not_to_be_confused_with entry: "route pattern: the URL matcher" -> "route pattern". */
function leadOf(entry: string): string {
  const colon = entry.indexOf(":");
  const lead = colon === -1 ? entry : entry.slice(0, colon);
  return stripParenthetical(lead).trim();
}

/**
 * How much of each project concept the compact form carries. The hook steps
 * down this list until the injection fits the host's budget; Coherence's own
 * layer always renders in full.
 */
export const DETAIL_LEVELS = ["full", "no-confusions", "definitions", "names"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

function renderConcept(concept: Concept, detail: DetailLevel = "full"): string {
  if (detail === "names") return concept.name;
  let line = `- ${concept.name}: ${firstSentence(concept.definition)}`;
  if (detail === "definitions") return line;
  const aliases = concept.aliases.flatMap(aliasNames);
  if (aliases.length > 0) line += ` (also: ${aliases.join(", ")})`;
  const rejected = concept.rejected.flatMap((r) => namesOfAlternative(r.alternative).map((n) => n.name));
  if (rejected.length > 0) line += ` [rejected: ${rejected.join(", ")}]`;
  if (detail === "full" && concept.notToBeConfusedWith.length > 0) {
    const leads = concept.notToBeConfusedWith.map(leadOf).filter((l) => l !== "");
    if (leads.length > 0) line += ` (not: ${leads.join(", ")})`;
  }
  return line;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/**
 * The compact form the hook injects: one header line, one line per concept
 * with name, first sentence, accepted aliases and rejected names, and beneath
 * it the project glossary under its own header. Detail, provenance and
 * metaphors never appear.
 */
export function renderCompact(coherence: Glossary, project?: Glossary, detail: DetailLevel = "full"): string {
  const lines: string[] = [];
  lines.push(`Coherence vocabulary (${coherence.concepts.length} concepts; rejected names are defects):`);
  for (const concept of coherence.concepts) lines.push(renderConcept(concept));
  if (project !== undefined) {
    const title = capitalize(project.project ?? "Project");
    lines.push("");
    const note = detail === "names" ? "names only here; full entries: coherence glossary" : "inside the project its sense of a name wins";
    lines.push(`${title} vocabulary (${project.concepts.length} concepts; ${note}):`);
    if (detail === "names") {
      lines.push(project.concepts.map((c) => renderConcept(c, detail)).join(", "));
    } else {
      for (const concept of project.concepts) lines.push(renderConcept(concept, detail));
    }
    const topLevel = project.rejected.flatMap((r) => namesOfAlternative(r.alternative).map((n) => n.name));
    if (topLevel.length > 0) lines.push(`- rejected names: ${topLevel.join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * The compact form at the richest detail level that fits `maxChars`, with the
 * level chosen. The last level is returned even when it does not fit, so the
 * caller always has something to inject.
 */
export function renderCompactWithin(
  coherence: Glossary,
  project: Glossary | undefined,
  maxChars: number,
): { text: string; detail: DetailLevel } {
  let last = { text: renderCompact(coherence, project, "full"), detail: DETAIL_LEVELS[0] as DetailLevel };
  for (const detail of DETAIL_LEVELS) {
    last = { text: renderCompact(coherence, project, detail), detail };
    if (last.text.length <= maxChars) return last;
    if (project === undefined) return last;
  }
  return last;
}

/** The token estimate used throughout: bytes divided by four. */
export function tokenEstimate(text: string): { bytes: number; tokens: number } {
  const bytes = Buffer.byteLength(text, "utf8");
  return { bytes, tokens: Math.ceil(bytes / 4) };
}
