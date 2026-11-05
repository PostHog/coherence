/**
 * Python's facts for the component interface reading that are no reading of
 * its text: Pyright narrows its workspace to a reading's bounds. Which
 * declarations are types, its default exports (none), and its imports, star
 * imports among them, are read through its parser (the manifest's treeSitter);
 * an interfaces table states none of them.
 */

import type { InterfaceFacts } from "../../src/plugins/api.ts";

export const PYTHON_INTERFACES: InterfaceFacts = {
  serverBounds: true,
};
