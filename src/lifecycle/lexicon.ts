/**
 * The lexicon as the hook and the check see it.
 *
 * Two files share this reader: Coherence's own lexicon (the tool vocabulary,
 * whose rejected entries sit on each concept as `{alternative, because}`) and a
 * project's domain lexicon (the same concept shape, plus a top-level
 * `rejected` list of `{concept, because}`). Both parse into one `Lexicon`.
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
  /** Named examples of a concept, not alternate names for the category. */
  instances?: string[];
  rejected: RejectedAlternative[];
  notToBeConfusedWith: string[];
  properties: Record<string, string>;
  related: string[];
  /** The plugin whose lexicon layer brought the concept (src/plugins/lexicon.ts); absent for Coherence's own and the project's. */
  layer?: string;
  /** First in the injection's order however long since the journal last named it, so the last to lose its whole line or its name (`"protected": true` in the file); in an adopter Coherence's own concepts are names alone, protected or not. */
  protected?: boolean;
}

/** A plugin layer composed into the tool layer: who, and the surface that puts its vocabulary in a session's way. */
export interface LayerInfo {
  name: string;
  version: string;
  /** The languages it provides or extends. */
  languages: string[];
  /** The via forms it proves. */
  forms: string[];
}

export interface Lexicon {
  /** Where it was read from; used to keep the file itself out of the check. */
  path: string;
  /** The project name the file declares, if any. */
  project: string | undefined;
  concepts: Concept[];
  /** Names rejected at the top level of the file, outside any concept. */
  rejected: RejectedAlternative[];
  /** The names of the trust levels a project declares; accepted names, never concepts. */
  trustLevels: string[];
  /** The plugin layers composed into this one, in stack order; absent on a lexicon read from one file. */
  layers?: LayerInfo[];
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
    instances: stringList(value["instances"]),
    rejected: parseRejected(value["rejected"]),
    notToBeConfusedWith: stringList(value["not_to_be_confused_with"]),
    properties: stringMap(value["properties"]),
    related: stringList(value["related"]),
    ...(value["protected"] === true ? { protected: true } : {}),
  };
}

export function parseLexicon(input: unknown, path: string): Lexicon {
  if (!isRecord(input)) throw new Error(`${path}: a lexicon must be an object`);
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

export async function loadLexicon(path: string): Promise<Lexicon> {
  const text = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${(error as Error).message})`);
  }
  return parseLexicon(parsed, path);
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

/** Every rejected name of a lexicon, with its concept and because. Top-level rejections carry the file's project as their concept. */
export function rejectedNames(lexicon: Lexicon): RejectedName[] {
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
  for (const concept of lexicon.concepts) {
    for (const r of concept.rejected) add(r.alternative, concept.name, r.because);
  }
  const owner = lexicon.project ?? "the lexicon";
  for (const r of lexicon.rejected) add(r.alternative, owner, r.because);
  return out;
}

/** An alias as written in a project lexicon, without its explanatory parenthetical. "record (code term)" -> "record". */
export function aliasNames(alias: string): string[] {
  return stripParenthetical(alias)
    .split(/\s+\/\s+/)
    .map((a) => stripParenthetical(a).trim())
    .filter((a) => a !== "");
}

/** The names a lexicon accepts: the project's name, every concept name, alias, and trust level, lowercased. */
export function acceptedNames(lexicon: Lexicon): Set<string> {
  const out = new Set<string>();
  if (lexicon.project !== undefined) out.add(lexicon.project.toLowerCase());
  for (const level of lexicon.trustLevels) out.add(level.toLowerCase());
  for (const concept of lexicon.concepts) {
    out.add(concept.name.toLowerCase());
    for (const instance of concept.instances ?? []) out.add(instance.toLowerCase());
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
 * When the journal last named each concept: an ISO time by the concept's
 * name, lowercased (lexicon-recency.ts reads it). A concept no record names
 * is absent.
 */
export type LastNamed = ReadonlyMap<string, string>;

/**
 * Concepts from most to least kept: the protected first, then by the latest
 * record naming each, then in the file's order. The injection keeps the head
 * of this order whole and lets the tail decay, to its name and then out.
 */
export function byRecency(concepts: readonly Concept[], lastNamed: LastNamed = new Map()): Concept[] {
  const at = (c: Concept): string => lastNamed.get(c.name.toLowerCase()) ?? "";
  return concepts
    .map((concept, index) => ({ concept, index }))
    .sort((a, b) => Number(b.concept.protected === true) - Number(a.concept.protected === true) || (at(a.concept) === at(b.concept) ? a.index - b.index : at(a.concept) < at(b.concept) ? 1 : -1))
    .map((c) => c.concept);
}

/** How the injection shows one concept: its whole line, its name alone, or not at all (counted). */
export type Shown = "whole" | "name" | "out";

/** How many concepts the injection showed each way; all out is the one-line pointer. */
export interface Delivered {
  whole: number;
  name: number;
  out: number;
}

/** What a delivery says in a reading of the hook: "whole", or the counts. */
export function deliveredText(delivered: Delivered): string {
  if (delivered.name === 0 && delivered.out === 0) return "whole";
  if (delivered.whole === 0 && delivered.name === 0) return "as a pointer to the lexicon command";
  return `${delivered.whole} whole, ${delivered.name} by name only, ${delivered.out} left out`;
}

/** The one line that stands in for the vocabulary when nothing else fits. */
export function renderPointer(cli = "coherence"): string {
  return `Vocabulary omitted to stay under the host budget; full entries: ${cli} lexicon\n`;
}

function renderConcept(concept: Concept): string {
  let line = `- ${concept.name}: ${firstSentence(concept.definition)}`;
  const aliases = concept.aliases.flatMap(aliasNames);
  if (aliases.length > 0) line += ` (also: ${aliases.join(", ")})`;
  if (concept.instances?.length) line += ` (instances: ${concept.instances.join(", ")})`;
  const rejected = concept.rejected.flatMap((r) => namesOfAlternative(r.alternative).map((n) => n.name));
  if (rejected.length > 0) line += ` [rejected: ${rejected.join(", ")}]`;
  if (concept.notToBeConfusedWith.length > 0) {
    const leads = concept.notToBeConfusedWith.map(leadOf).filter((l) => l !== "");
    if (leads.length > 0) line += ` (not: ${leads.join(", ")})`;
  }
  return line;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** One layer's concepts as shown: whole lines in order, then the names alone, then how many are left out (the least recently named, when the layer is in recency order). */
function layerLines(concepts: readonly Concept[], show: (concept: Concept) => Shown, cli: string, recency = true): string[] {
  const lines = concepts.filter((c) => show(c) === "whole").map(renderConcept);
  const named = concepts.filter((c) => show(c) === "name").map((c) => c.name);
  if (named.length > 0) lines.push(`Named only here (full entries: ${cli} lexicon): ${named.join(", ")}`);
  const out = concepts.filter((c) => show(c) === "out").length;
  if (out > 0) lines.push(`${out} more${recency ? ", the least recently named" : ""}: ${cli} lexicon`);
  return lines;
}

/**
 * The compact form the hook injects: under each layer's header (Coherence's,
 * each plugin's, the project's), one line per concept with name, first
 * sentence, accepted aliases, rejected names and what it is not to be
 * confused with, most recently named first. `show` says which concepts keep
 * their whole line, which only their name, and which are left out; by
 * default every one is whole. Detail, provenance and metaphors never appear.
 */
export function renderCompact(
  coherence: Lexicon,
  project?: Lexicon,
  own = true,
  shown: (layer: string) => boolean = () => true,
  lastNamed: LastNamed = new Map(),
  show: (concept: Concept) => Shown = () => "whole",
  cli = "coherence",
): string {
  const lines: string[] = [];
  const order = lastNamed.size > 0 ? ", most recently named first" : "";
  // In Coherence's own repository its rejected names are defects everywhere; in an adopter they bind only where Coherence's concepts are named.
  const rule = own ? "rejected names are defects" : "use these names when you mean Coherence's concepts";
  // In an adopter Coherence's own concepts keep the file's order: the journal there names them in every record, so recency would rank the tool's vocabulary over the project's.
  const mine = byRecency(coherence.concepts.filter((c) => c.layer === undefined), own ? lastNamed : new Map());
  lines.push(`Coherence vocabulary (${mine.length} concepts${own ? order : ""}; ${rule}):`);
  lines.push(...layerLines(mine, show, cli, own));
  // Each plugin's layer under its own header, between Coherence's and the project's; one whose surface the caller says is out of the way is left out.
  for (const layer of coherence.layers ?? []) {
    if (!shown(layer.name)) continue;
    const theirs = byRecency(coherence.concepts.filter((c) => c.layer === layer.name), lastNamed);
    if (theirs.length === 0) continue;
    lines.push("", `Plugin ${layer.name} vocabulary (${theirs.length} concepts, ${layer.version}${order}):`);
    lines.push(...layerLines(theirs, show, cli));
  }
  if (project !== undefined) {
    const title = capitalize(project.project ?? "Project");
    const concepts = byRecency(project.concepts, lastNamed);
    lines.push("", `${title} vocabulary (${concepts.length} concepts${order}; inside the project its sense of a name wins):`);
    lines.push(...layerLines(concepts, show, cli));
    const topLevel = project.rejected.flatMap((r) => namesOfAlternative(r.alternative).map((n) => n.name));
    if (topLevel.length > 0) lines.push(`- rejected names: ${topLevel.join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * The compact form that fits `maxChars` and `maxTokens`, and how it showed
 * the concepts. The lexicon itself has no ceiling: every concept of every
 * shown layer is put in one order (byRecency), and the two bounds, the room
 * the host's budget leaves and the presentation's own, decide how far down
 * it reaches. The most concepts that fit keep their names, from the head; of
 * those, the most that fit keep their whole lines, from the head again. A
 * concept the journal has not named for longest decays first, to its name
 * and then out, and a protected one goes last; among concepts no record
 * tells apart, the project's outlast a plugin's, and a plugin's outlast
 * Coherence's own. In an adopter (`own` false) Coherence's own concepts are
 * not ranked at all: the window is the project's, so they are one line of
 * names after everything ranked, shown only while every ranked concept is
 * whole and they still fit, and otherwise counted out. When no name fits, one line points at the lexicon command (`cli` names
 * it); that line is returned even when it does not fit, so the caller always
 * has something to inject.
 */
export function renderCompactWithin(
  coherence: Lexicon,
  project: Lexicon | undefined,
  maxChars: number,
  cli = "coherence",
  own = true,
  shown: (layer: string) => boolean = () => true,
  lastNamed: LastNamed = new Map(),
  maxTokens = Number.POSITIVE_INFINITY,
): { text: string; delivered: Delivered } {
  // In an adopter Coherence's own concepts are not ranked: they are names alone, after everything ranked, kept only while every ranked concept is whole (d-980480e2).
  const mine = own ? [] : coherence.concepts.filter((c) => c.layer === undefined);
  // Concepts no record tells apart keep this order: the project's first, whose rejected names bind in all of its text, then each shown plugin's, then Coherence's in its own repository.
  const visible = [
    ...(project?.concepts ?? []),
    ...coherence.concepts.filter((c) => c.layer !== undefined && shown(c.layer)),
    ...(own ? coherence.concepts.filter((c) => c.layer === undefined) : []),
  ];
  const all = byRecency(visible, lastNamed);
  const rank = new Map(all.map((c, i) => [c, i]));
  const render = (kept: number, whole: number, names = false): string =>
    renderCompact(coherence, project, own, shown, lastNamed, (c) => {
      const at = rank.get(c);
      if (at === undefined) return names ? "name" : "out";
      return at < whole ? "whole" : at < kept ? "name" : "out";
    }, cli);
  // The largest n in [0, max] whose render fits, scanning down: a count does not always lengthen the text (a layer's first name adds its "named only" line, its last one drops a "more" line), so a bisection could stop short.
  const largest = (max: number, fits: (n: number) => boolean): number => {
    for (let n = max; n > 0; n--) if (fits(n)) return n;
    return 0;
  };
  const fits = (text: string): boolean => text.length <= maxChars && tokenEstimate(text).tokens <= maxTokens;
  if (mine.length > 0) {
    const withNames = render(all.length, all.length, true);
    if (fits(withNames)) return { text: withNames, delivered: { whole: all.length, name: mine.length, out: 0 } };
  }
  const kept = largest(all.length, (n) => fits(render(n, 0)));
  if (kept === 0 && all.length + mine.length > 0) return { text: renderPointer(cli), delivered: { whole: 0, name: 0, out: all.length + mine.length } };
  const whole = kept < all.length ? 0 : largest(kept, (n) => fits(render(kept, n)));
  return { text: render(kept, whole), delivered: { whole, name: kept - whole, out: all.length - kept + mine.length } };
}

/** The token estimate used throughout: bytes divided by four. */
export function tokenEstimate(text: string): { bytes: number; tokens: number } {
  const bytes = Buffer.byteLength(text, "utf8");
  return { bytes, tokens: Math.ceil(bytes / 4) };
}
