/**
 * Python's facts for the component interface reading: which declaration
 * lines are types or default exports, and what the word index and the kept
 * answers read of a file's imports (component-interfaces.ts reads them
 * through INTERFACE_SYNTAX, and kept-answers.ts through its wildcardModules).
 */

import { resolveDotted } from "./python.ts";
import type { InterfaceSyntax } from "../../src/plugins/api.ts";

/** A Python import statement, a parenthesized list or one logical line: `import a as b`, `from m import (a as b, c)`. */
const PY_IMPORT = /^[ \t]*(?:from\s+\S+\s+)?import\s+(\([^)]*\)|[^\n]*(?:\\\n[^\n]*)*)/gm;
const PY_STAR = /^from\s+(\.*)([A-Za-z0-9_.]*)\s+import\s+\*/gm;

/** The module files a file star-imports: each dotted module as a .py file and as a package's __init__.py. */
function starModules(file: string, text: string): string[] {
  const modules: string[] = [];
  for (const [, dots, dotted] of text.matchAll(PY_STAR)) {
    const target = resolveDotted(file, dots!, dotted!);
    if (target === undefined) continue;
    modules.push(`${target}.py`, `${target}/__init__.py`);
  }
  return modules;
}

/** Python declares no type-only names and has no default export; pyright narrows its workspace to the bounds. */
export const PYTHON_INTERFACES: InterfaceSyntax = {
  isTypeDeclaration: () => false,
  isDefaultExport: () => false,
  serverBounds: true,
  importLists: (text) => [...text.matchAll(PY_IMPORT)].map((m) => m[1]!),
  defaultNames: () => [],
  wildcardModules: starModules,
};

