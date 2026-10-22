/**
 * What the spec model asks of a Go file: whether its top level declares a
 * name. A package-level func, type, var or const, written alone
 * (`func Write(`, `type Entry struct`) or inside a grouped declaration
 * (`var (` … `)`), where a member sits one indent in. A method
 * (`func (e *Entry) Name(`) is not a package-level name, and neither is a
 * local inside a function body.
 */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether the text declares the name at its top level. */
export function goDeclaresAtTop(text: string, name: string): boolean {
  if (!IDENT.test(name)) return false;
  const single = new RegExp(`^(?:func\\s+${name}\\s*[\\[(]|(?:type|var|const)\\s+(?:[A-Za-z_][A-Za-z0-9_]*\\s*,\\s*)*${name}\\b)`, "m");
  if (single.test(text)) return true;
  let group: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (group === undefined) {
      const open = /^(type|var|const)\s*\(\s*(?:\/\/.*)?$/.exec(line);
      if (open !== null) group = open[1];
      continue;
    }
    if (/^\)/.test(line)) {
      group = undefined;
      continue;
    }
    // A member of the group sits one level in; deeper lines are a struct's fields or a value's continuation.
    const member = /^(?:\t| {2,4})(?![\t ])([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)/.exec(line);
    if (member !== null && member[1]!.split(/\s*,\s*/).includes(name)) return true;
  }
  return false;
}
