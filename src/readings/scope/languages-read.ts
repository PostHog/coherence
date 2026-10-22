/**
 * Which of a project's languages a reading read: the one field every
 * reading carries in its result, and the one line every renderer prints.
 *
 * A project may declare several languages (the config's `language` list, the
 * first being the primary). A reading that covers fewer than the project
 * declares must say so, by name, in its output and in its JSON: a checking
 * tool that skips a language quietly reports a clean result it never read.
 * So the reading states what it read, and a language it did not read carries
 * the reason, and the renderers print the line whenever the project declares
 * more than one language. For one language the line is absent, so a
 * single-language reading prints exactly what it always did.
 *
 * primaryOnly is the one way a reading takes the primary language alone: it
 * hands back the language together with the statement that the others were
 * not read, so the statement cannot be left behind. A test (languages-read.test.ts)
 * refuses any reading that takes the config's primary language another way.
 */

import { languageData } from "./language-data.ts";

/** A language a reading reads by name. */
type Language = string;

/** One language a reading did not read, and why: a built-in, or a language the config declares under `languages`. */
export interface LanguageNotRead {
  language: string;
  because: string;
}

/** What a reading read of the project's declared languages. */
export interface LanguagesRead {
  /** Every language the project declares, the primary first: the built-ins, then those its config declares under `languages`. */
  declared: string[];
  /** The declared languages the reading read, in declared order: only ever built-ins. */
  read: Language[];
  /** The declared languages it did not read, each with its reason. */
  unread: LanguageNotRead[];
}

/** The project's languages as a reading sees them: the config's list, the primary first, and the languages its config declares. */
export interface DeclaredLanguages {
  readonly language: string;
  readonly languages: readonly Language[];
  /** The languages the config declares under `languages`, which only their language server reads (src/adapters/declared.ts). */
  readonly declared?: readonly { readonly name: string }[];
}

/**
 * Every language a reading never scans, each with its reason: those the
 * config declares. A language a plugin adds is among the config's languages,
 * read as a built-in is, by what its plugin fills.
 */
export function unscannedOf(config: DeclaredLanguages): { name: string; because: string }[] {
  return (config.declared ?? []).map((d) => ({ name: d.name, because: DECLARED_NOT_READ }));
}

/** The reason every reading gives for a language the config declares: its language server answers chokepoint checks, and no reading has a scan of its text. */
export const DECLARED_NOT_READ = "a language the config declares is read only by its language server's references, for chokepoint checks; no reading scans its text";

/**
 * What a reading read: every declared language not named in `unread`.
 * `unread` maps a language to the reason it was not read. A language the
 * config declares under `languages` is never read by a reading: it is named
 * with DECLARED_NOT_READ, so a reading never skips it quietly.
 */
export function languagesRead(languages: readonly Language[], unread: ReadonlyMap<Language, string> = new Map(), declared: readonly { readonly name: string; readonly because?: string }[] = []): LanguagesRead {
  return {
    declared: [...languages, ...declared.map((d) => d.name)],
    read: languages.filter((l) => !unread.has(l)),
    unread: [
      ...languages.flatMap((language) => (unread.has(language) ? [{ language, because: unread.get(language)! }] : [])),
      ...declared.map((d) => ({ language: d.name, because: d.because ?? DECLARED_NOT_READ })),
    ],
  };
}

/** Every declared language read. */
export function allLanguagesRead(config: DeclaredLanguages): LanguagesRead {
  return languagesRead(config.languages, new Map(), unscannedOf(config));
}

/**
 * Why a reading that scans a language's text (declarations, imports, entrance
 * rules) does not read the language, or undefined when it reads it: a
 * language whose plugin has an adapter but no text scan yet says so in its
 * manifest (notScanned), so a reading names it rather than parse it as
 * another language.
 */
export function notScannedYet(language: Language): string | undefined {
  return languageData()[language]?.notScanned;
}

/** Every declared language a text scan reads, and each one it does not read yet named with why (notScannedYet). */
export function scannedLanguagesRead(config: DeclaredLanguages): LanguagesRead {
  return languagesRead(config.languages, new Map(config.languages.flatMap((l) => {
    const because = notScannedYet(l);
    return because === undefined ? [] : [[l, because] as const];
  })), unscannedOf(config));
}

/**
 * The primary language, for a reading that reads it alone, with the
 * statement that every other declared language was not read, and why.
 */
export function primaryOnly(config: DeclaredLanguages, because: string): { language: Language | undefined; languages: LanguagesRead } {
  // The primary built-in: a project that names only languages its config declares has none, and the reading reads nothing.
  const primary = config.languages[0];
  return { language: primary, languages: languagesRead(config.languages, new Map(config.languages.filter((l) => l !== primary).map((l) => [l, because])), unscannedOf(config)) };
}

/**
 * The line a renderer prints: undefined for a project of one language read
 * whole (its output is unchanged); otherwise the languages read and, for
 * each one not read, its name and why. An absent field (a record written
 * before readings said so) is undefined too.
 */
export function languagesReadLine(languages: LanguagesRead | undefined): string | undefined {
  if (languages === undefined) return undefined;
  if (languages.declared.length <= 1 && languages.unread.length === 0) return undefined;
  const read = languages.read.length === 0 ? "none" : languages.read.join(" and ");
  if (languages.unread.length === 0) return `languages read: ${read}, each through its own files`;
  return `languages read: ${read}; NOT READ: ${languages.unread.map((u) => `${u.language} (${u.because})`).join("; ")}`;
}
