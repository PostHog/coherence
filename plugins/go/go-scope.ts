/**
 * Go's facts for the component interface reading: which declaration lines
 * declare a type only, and what the word index reads of a file's imports
 * (component-interfaces.ts reads them through the interfaces slot,
 * kept-answers.ts through the same wildcardModules).
 */

import type { InterfaceSyntax } from "../../src/plugins/api.ts";
import { declarationAt } from "./go-source.ts";

/**
 * An interface or a type alias declares a type only; a struct or another
 * defined type carries methods, so a reach goes on through it. Go has no
 * default export. gopls reads its module whole, so it takes no bounds.
 *
 * Go renames packages, never names: `st "shop/store"` binds the package as
 * st, and every use still spells the member's own name (`st.Seal`), so no
 * import list extends a name to an alias. A dot import (`import .
 * "shop/store"`) brings the package's names in unqualified, and each use
 * still spells the name, which the word index reads like any other token;
 * gopls reports no site at the import itself, so the reading needs no
 * module named for it (and from a file's path alone, with no root to read
 * the go.mod by, the package's files could not be named).
 */
export const GO_INTERFACES: InterfaceSyntax = {
  isTypeDeclaration(line) {
    const form = declarationAt(line)?.form;
    return form === "alias" || form === "interface";
  },
  isDefaultExport: () => false,
  serverBounds: false,
  importLists: () => [],
  defaultNames: () => [],
  wildcardModules: () => [],
};
