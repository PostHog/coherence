/**
 * The mirror reading's model: what a reading holds, as plain data a record
 * can keep and orient can read without loading the reading itself.
 */

export type Form =
  | "array" | "set" | "keys" | "values" | "column" | "alternation" | "union" | "cases"
  | "doc-alternation" | "doc-table" | "prose"
  | "folder" | "closure" | "exports" | "reads";

export const DOC_FORMS: ReadonlySet<Form> = new Set<Form>(["doc-alternation", "doc-table", "prose"]);
/** Sets code derives: never kept by hand, so a finding needs a literal on its other side. */
export const DERIVED: ReadonlySet<Form> = new Set<Form>(["folder", "closure", "exports", "reads"]);

export type Verdict = "drifted" | "latent" | "duplicate";

/** One set as a finding names it: where it is, what it is, and what it holds. */
export interface SetRef {
  file: string;
  /** 0 for a universe, which has no line of its own. */
  line: number;
  name: string;
  form: Form;
  /** The compiler holds these to a type (`Record<Kind, …>`, an exhaustive switch): not kept by hand. */
  checked: boolean;
  members: string[];
  /** For an import closure: the files whose imports it follows, as the list spells them. */
  of?: string[];
  /** For the import closure of a list of files: where that list is, as file:line. */
  list?: string;
  /** For an object's keys: the named type the object is declared as or satisfies (`Command` in `const x: Command = {…}`), a utility type such as Record aside. */
  type?: string;
  /** For an object's keys: read only by property access where it is declared, never iterated or keyed: a record's attributes, not a set's members. */
  record?: boolean;
  /** For a list: the member type it is declared with (`HookEvent` in `ReadonlySet<HookEvent>` or `new Set<HookEvent>(…)`), when it names one. */
  elementType?: string;
}

export interface Missed {
  /** The commit, abbreviated to seven characters. */
  commit: string;
  subject: string;
  member: string;
  /** Which side the commit grew alone. */
  side: "a" | "b";
}

export interface MirrorHistory {
  /** Commits that grew both sides by the same name, the birth of neither. */
  together: string[];
  /** Shared names added to each side in different commits. */
  lagged: string[];
  /** Commits that grew one side by a name now only on that side. */
  missed: Missed[];
}

export interface Finding {
  /** The hand-kept side. */
  a: SetRef;
  b: SetRef;
  verdict: Verdict;
  shared: string[];
  onlyA: string[];
  onlyB: string[];
  /** A third set that accounts for the difference: A is B together with it. */
  union?: SetRef;
  jaccard: number;
  containment: number;
  score: number;
  overlapScore: number;
  historyScore: number;
  /** The other sets equal to one side: the copies this finding stands for. */
  copies: SetRef[];
  history?: MirrorHistory;
}

/** Findings that share a cluster: one question for the reader, ranked by its strongest finding. */
export interface Group {
  rank: number;
  score: number;
  overlapScore: number;
  historyScore: number;
  findings: Finding[];
}

export interface MirrorReading {
  /** The revision as asked for (HEAD by default). */
  rev: string;
  /** The commit it resolved to. */
  commit: string;
  /** Milliseconds the reading took, and per phase. */
  ms: number;
  phases: Record<string, number>;
  sets: number;
  /** The code files the reading parsed (TypeScript and JavaScript). */
  read: number;
  /** The tracked files in a language the reading does not parse, counted by extension: `{ ".py": 4123 }`. */
  unread: Record<string, number>;
  groups: Group[];
  /** The restatements nothing holds equal, in rank order: the count later readings must not exceed. */
  restatements: Restatement[];
  /** How many restatements a test, an import or a declared mirror holds: found, and not counted. */
  held: number;
  /** The restatements the config's restatements key excludes, each naming the entry that excluded it: never counted, never lost. */
  excluded: Restatement[];
  /** Held by a test that has not yet gone red when its copy changed. */
  unrefuted: Restatement[];
  /** Declared different on purpose by a comment at the copy. */
  declared: Restatement[];
  /** The rules the reading applied, as a digest: a count is compared with another only under the same rules. */
  rules: string;
  /** Every copy a test names, witnessed or not: what query mirrors --witness changes and runs. */
  holds: HeldCopy[];
}

/** A copy a test names, to be witnessed: change the copy, and the test must go red. Keyed by the blobs of the home, the copy and the test. */
export interface HeldCopy {
  key: string;
  test: string;
  copy: RestatementSite;
  home: RestatementSite;
  /** The value or the members the copy writes, for the change. */
  value: string;
  members?: string[];
}

/** The config's restatements key: the project facts the reading cannot derive. */
export interface RestatementConfig {
  /** Globs of seed, demo and example files whose literals restate lists on purpose; still code for every other reading. */
  data: string[];
  /** Globs of standalone scripts, which run alone: a copy there is left as it is. */
  scripts: string[];
  /** Regular expressions a deliberate shared value matches. */
  values: string[];
}

export type ExclusionKey = keyof RestatementConfig;
export const EXCLUSION_KEYS: readonly ExclusionKey[] = ["data", "scripts", "values"] as const satisfies readonly ExclusionKey[];

/** The config entry that excluded a restatement: its key, and the glob or pattern as the config writes it. */
export interface Exclusion {
  key: ExclusionKey;
  entry: string;
}

/**
 * The kinds of restatement: two sets that differ by one member (live
 * drift); a list that is a strict part of another, typed as plain strings
 * (a derivation nothing types); one rule written as two predicates (a
 * regular expression, a chain of string tests, a set tested for
 * membership) that accept the same strings; a predicate whose accepted
 * strings are a strict part of another's (a derived rule); two functions
 * that parse text into one type checking the same fields (a parser); one
 * value bound to a named constant in two or more files; two equal sets; and
 * one literal written in two or more files.
 */
export type RestatementKind = "drift" | "subset" | "rule" | "derivation" | "parser" | "constant" | "copy" | "literal";

export interface RestatementSite {
  file: string;
  /** 0 when the file has no line for it (a manifest value it could not place). */
  line: number;
  /** The constant or list the value is bound to there, when it is bound to one. */
  name?: string;
}

/**
 * A restatement: one value, a literal of 16 or more characters or a set of
 * three or more members, at live sites in two or more files, where no site
 * imports it from another and no test, type or declared mirror holds the
 * copies equal.
 */
export interface Restatement {
  kind: RestatementKind;
  /** The literal, for a value; the members the sets share, for a set. */
  value: string;
  members?: string[];
  /** For drift: the one member only one side holds, and the side that lacks it as file:line. */
  odd?: { member: string; lacks: string };
  sites: RestatementSite[];
  /** Where the value would live once: one module the rest import, a plugin's manifest, or a test that holds the copies equal; for an excluded one, why it is left as it is. */
  source: string;
  score: number;
  /** Set on an excluded restatement alone: the config entry that excluded it. */
  by?: Exclusion;
  /** History's standing: 1 already diverged, 2 changed apart, 3 changed together, 4 never changed (or no history read). */
  standing?: number;
  /** Its sites lie in different parts of the project (a plugin, a package, a top folder). */
  crossPackage?: boolean;
  /** Held by a test not yet refuted: the test, and the key its verdict is kept under. */
  hold?: { test: string; key: string };
  /** Declared different on purpose by a comment at the copy: how its behavior differs. */
  declared?: string;
}
