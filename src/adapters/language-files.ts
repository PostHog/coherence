/**
 * Which language a file is written in, by its name: the one rule every
 * reader asks (enforcement, the economy's source scan, entrance detection,
 * the lexicon's member scan). A reader that reads fewer of a language's files
 * narrows this rule and says why; none answers the question on its own. The
 * rule is each language plugin's, read from its manifest (src/plugins/languages.ts).
 */

export { LANGUAGES, languageOfFile, type Language } from "../plugins/languages.ts";
