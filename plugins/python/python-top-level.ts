/**
 * What the spec model asks of a Python file: whether its top level declares a
 * name, by a def or class, or by assigning it (annotated or not).
 */

/** Whether the text declares the name at its top level. */
export function pythonDeclaresAtTop(text: string, name: string): boolean {
  const escaped = name.replace(/\$/g, "\\$");
  return new RegExp(`^(?:async\\s+)?(?:def|class)\\s+${escaped}\\b|^${escaped}\\s*(?::[^=\\n]+)?=`, "m").test(text);
}
