/**
 * The model for the Scope reading: the shape of everything the page handles.
 *
 * The model is a layer of indirection between a glossary file and the render.
 * Fields can be added to a concept, a glossary, a layer, or the shell without
 * restructuring the code that carries them; every render takes a model value,
 * never a bare string or number pulled out of one. Fields the page does not
 * show still belong here: a concept's record and a glossary's record keep
 * every key the file said, so nothing is lost between the file and the page.
 *
 * State is a concrete value of this shape. The page holds exactly one
 * `ShellState` and derives everything it shows from it.
 */

/** One alternative that was considered for a concept and refused, with why. */
export interface RejectedAlternative {
  alternative: string;
  because: string;
}

/**
 * One concept. The fields named here are the ones the reading treats
 * specially; every other key on the JSON object is kept in `record`.
 * Coherence's glossary and a project domain glossary both parse into this.
 */
export interface Concept {
  name: string;
  definition: string;
  /** Absent when the glossary records no status for the concept. */
  status?: string;
  defined_by?: string;
  /** Names the concept had in the reference implementation. */
  reference_aliases: string[];
  /** Names the concept also goes by now. */
  aliases: string[];
  not_to_be_confused_with: string[];
  rejected: RejectedAlternative[];
  related: string[];
  metaphor?: string;
  owner_words?: string;
  /** Every other field of the entry, in file order, rendered as evidence. */
  record: Record<string, RecordValue>;
}

/** A value inside a record: prose, a list, or a nested record. */
export type RecordValue =
  | string
  | number
  | boolean
  | null
  | RecordValue[]
  | { [key: string]: RecordValue };

/** One mechanism retired at the top level of a glossary. */
export interface Retirement {
  concept: string;
  because: string;
  decided_by?: string;
  carry_over?: string;
  correction?: string;
  status?: string;
  resolution?: string;
}

/** Named metaphors that several concepts lean on, keyed by their short name. */
export type Metaphors = Record<string, string>;

/** One entry in the short list a project declares for crossings: an instance of Coherence's trust level. */
export interface TrustLevel {
  name: string;
  meaning: string;
}

/** A ruling on a term: how a contested or uncertain name is to be used. */
export interface Ruling {
  term: string;
  ruling: string;
  decided_by?: string;
}

/** A term found carrying more than one sense, with the senses and where each lives. */
export interface Overload {
  term: string;
  senses: string[];
  where?: string;
  ruling?: string;
}

/** One glossary file, parsed. Coherence's own and a project's share this shape. */
export interface Glossary {
  version: number;
  project?: string;
  status?: string;
  purpose?: string;
  source?: string;
  completed?: string;
  concepts: Concept[];
  retirements: Retirement[];
  metaphors: Metaphors;
  /** Undefined when the file does not speak of them; empty when it says there are none. */
  trust_levels?: TrustLevel[];
  rulings?: Ruling[];
  candidate_overloads?: Overload[];
  uncertain?: Ruling[];
  /** Every other top-level field of the file, in file order. */
  record: Record<string, RecordValue>;
}

/**
 * One layer of the two-layer glossary. A layer is either present with its
 * glossary, or absent with the reason, so absence is a rendered fact rather
 * than a missing element.
 */
export type Layer =
  | { kind: "present"; id: string; title: string; glossary: Glossary }
  | { kind: "absent"; id: string; title: string; because: string };

/** The state of the Glossary view: the layers it reads and the reader's query. */
export interface GlossaryViewState {
  layers: Layer[];
  query: string;
}

/** Identity of one view in the Scope shell. Adding a view adds a member here. */
export interface ViewIdentity {
  id: string;
  label: string;
}

/** The whole state of the Scope shell. The page is a function of this value. */
export interface ShellState {
  project: string;
  views: ViewIdentity[];
  activeView: string;
  glossary: GlossaryViewState;
}

/** The keys a concept entry carries that the render treats specially. */
const CONCEPT_KEYS = new Set([
  "name",
  "status",
  "definition",
  "defined_by",
  "reference_aliases",
  "aliases",
  "not_to_be_confused_with",
  "rejected",
  "related",
  "metaphor",
  "owner_words",
]);

/** The top-level keys of a glossary file that the render treats specially. */
const GLOSSARY_KEYS = new Set([
  "version",
  "project",
  "status",
  "purpose",
  "source",
  "completed",
  "concepts",
  "rejected",
  "metaphors",
  "trust_levels",
  "rulings",
  "candidate_overloads",
  "uncertain",
]);

class GlossaryShapeError extends Error {
  constructor(where: string, message: string) {
    super(`${where}: ${message}`);
    this.name = "GlossaryShapeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new GlossaryShapeError(where, `${key} must be a string`);
  return value;
}

function optionalStringAt(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new GlossaryShapeError(where, `${key} must be a string`);
  return value;
}

function stringListAt(record: Record<string, unknown>, key: string, where: string): string[] {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new GlossaryShapeError(where, `${key} must be a list of strings`);
  }
  return value;
}

function optionalListAt<T>(
  record: Record<string, unknown>,
  key: string,
  where: string,
  parse: (item: unknown, at: string) => T,
): T[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new GlossaryShapeError(where, `${key} must be a list`);
  return value.map((item, i) => parse(item, `${where} ${key}[${i}]`));
}

function asRecordValue(value: unknown, where: string): RecordValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((v, i) => asRecordValue(v, `${where}[${i}]`));
  if (isRecord(value)) {
    const out: { [key: string]: RecordValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = asRecordValue(v, `${where}.${k}`);
    return out;
  }
  throw new GlossaryShapeError(where, "unsupported value");
}

/** Every key not in `known`, kept in file order. */
function restOf(
  value: Record<string, unknown>,
  known: Set<string>,
  where: string,
): Record<string, RecordValue> {
  const record: Record<string, RecordValue> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!known.has(key)) record[key] = asRecordValue(v, `${where}.${key}`);
  }
  return record;
}

function parseRejected(value: unknown, where: string): RejectedAlternative[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new GlossaryShapeError(where, "rejected must be a list");
  return value.map((entry, i) => {
    const at = `${where}.rejected[${i}]`;
    if (!isRecord(entry)) throw new GlossaryShapeError(at, "must be an object");
    return {
      alternative: stringAt(entry, "alternative", at),
      because: stringAt(entry, "because", at),
    };
  });
}

function parseConcept(value: unknown, where: string): Concept {
  if (!isRecord(value)) throw new GlossaryShapeError(where, "must be an object");
  const name = stringAt(value, "name", where);
  const at = `${where} (${name})`;
  const concept: Concept = {
    name,
    definition: stringAt(value, "definition", at),
    reference_aliases: stringListAt(value, "reference_aliases", at),
    aliases: stringListAt(value, "aliases", at),
    not_to_be_confused_with: stringListAt(value, "not_to_be_confused_with", at),
    rejected: parseRejected(value["rejected"], at),
    related: stringListAt(value, "related", at),
    record: restOf(value, CONCEPT_KEYS, at),
  };
  for (const key of ["status", "defined_by", "metaphor", "owner_words"] as const) {
    const v = optionalStringAt(value, key, at);
    if (v !== undefined) concept[key] = v;
  }
  return concept;
}

function parseRetirement(value: unknown, where: string): Retirement {
  if (!isRecord(value)) throw new GlossaryShapeError(where, "must be an object");
  const retirement: Retirement = {
    concept: stringAt(value, "concept", where),
    because: stringAt(value, "because", where),
  };
  for (const key of ["decided_by", "carry_over", "correction", "status", "resolution"] as const) {
    const v = optionalStringAt(value, key, where);
    if (v !== undefined) retirement[key] = v;
  }
  return retirement;
}

function parseTrustLevel(value: unknown, where: string): TrustLevel {
  if (!isRecord(value)) throw new GlossaryShapeError(where, "must be an object");
  return { name: stringAt(value, "name", where), meaning: stringAt(value, "meaning", where) };
}

function parseRuling(value: unknown, where: string): Ruling {
  if (!isRecord(value)) throw new GlossaryShapeError(where, "must be an object");
  const ruling: Ruling = { term: stringAt(value, "term", where), ruling: stringAt(value, "ruling", where) };
  const decidedBy = optionalStringAt(value, "decided_by", where);
  if (decidedBy !== undefined) ruling.decided_by = decidedBy;
  return ruling;
}

function parseOverload(value: unknown, where: string): Overload {
  if (!isRecord(value)) throw new GlossaryShapeError(where, "must be an object");
  const overload: Overload = {
    term: stringAt(value, "term", where),
    senses: stringListAt(value, "senses", where),
  };
  for (const key of ["where", "ruling"] as const) {
    const v = optionalStringAt(value, key, where);
    if (v !== undefined) overload[key] = v;
  }
  return overload;
}

/**
 * Parse one glossary file into the model. Refuses with a located message
 * rather than rendering a shape it does not understand.
 */
export function parseGlossary(input: unknown, where: string): Glossary {
  if (!isRecord(input)) throw new GlossaryShapeError(where, "glossary must be an object");
  const version = input["version"];
  if (typeof version !== "number") throw new GlossaryShapeError(where, "version must be a number");
  const conceptsRaw = input["concepts"];
  if (!Array.isArray(conceptsRaw)) throw new GlossaryShapeError(where, "concepts must be a list");
  const retirementsRaw = input["rejected"] ?? [];
  if (!Array.isArray(retirementsRaw)) throw new GlossaryShapeError(where, "rejected must be a list");
  const metaphorsRaw = input["metaphors"] ?? {};
  if (!isRecord(metaphorsRaw)) throw new GlossaryShapeError(where, "metaphors must be an object");
  const metaphors: Metaphors = {};
  for (const [k, v] of Object.entries(metaphorsRaw)) {
    if (typeof v !== "string") throw new GlossaryShapeError(where, `metaphors.${k} must be a string`);
    metaphors[k] = v;
  }
  const glossary: Glossary = {
    version,
    concepts: conceptsRaw.map((c, i) => parseConcept(c, `${where} concepts[${i}]`)),
    retirements: retirementsRaw.map((r, i) => parseRetirement(r, `${where} rejected[${i}]`)),
    metaphors,
    record: restOf(input, GLOSSARY_KEYS, where),
  };
  for (const key of ["project", "status", "purpose", "source", "completed"] as const) {
    const v = optionalStringAt(input, key, where);
    if (v !== undefined) glossary[key] = v;
  }
  const trustLevels = optionalListAt(input, "trust_levels", where, parseTrustLevel);
  if (trustLevels !== undefined) glossary.trust_levels = trustLevels;
  const rulings = optionalListAt(input, "rulings", where, parseRuling);
  if (rulings !== undefined) glossary.rulings = rulings;
  const overloads = optionalListAt(input, "candidate_overloads", where, parseOverload);
  if (overloads !== undefined) glossary.candidate_overloads = overloads;
  const uncertain = optionalListAt(input, "uncertain", where, parseRuling);
  if (uncertain !== undefined) glossary.uncertain = uncertain;
  return glossary;
}
