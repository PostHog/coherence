/**
 * The form of a name the config keys a thing by: a plugin (plugins.<name>,
 * a bundled plugin's folder), a peer repository (peers.<name>, its peer:
 * lines and its checkout's variable) and a declared language
 * (languages.<name>, the language id its server is sent). Lowercase letters,
 * digits and hyphens, starting with a letter, so a name is never a path
 * above its folder, and always an environment variable once upper-cased.
 *
 * Pure, with no import, so each reader of the config can take it.
 */
export const CONFIG_NAME = /^[a-z][a-z0-9-]*$/;

/** The form in words, for a refusal. */
export const CONFIG_NAME_FORM = "lowercase letters, digits and hyphens, starting with a letter";
