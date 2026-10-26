/**
 * Python's facts for the component interface reading that are no reading of
 * its text: Pyright narrows its workspace to a reading's bounds. Python
 * declares no type-only names and has no default export, which the parser's
 * reading already says; its imports, star imports among them, are read
 * through its parser (the manifest's treeSitter).
 */

import type { InterfaceSyntax } from "../../src/plugins/api.ts";

export const PYTHON_INTERFACES: Partial<InterfaceSyntax> = {
  serverBounds: true,
};
