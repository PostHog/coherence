/**
 * TypeScript's facts for the component interface reading that are no reading
 * of its text: its server reads its tsconfig's project whole, so it takes no
 * bounds. Which declarations are types and which are default exports, and
 * every import and wildcard re-export, are read through its parser (the
 * manifest's treeSitter); an interfaces table states none of them.
 */

import type { InterfaceFacts } from "../../src/plugins/api.ts";

export const TYPESCRIPT_INTERFACES: InterfaceFacts = {
  serverBounds: false,
};
