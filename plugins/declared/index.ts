/**
 * The declared plugin: the generic language-server adapter that reads every
 * language a project's config declares under `languages`, through the
 * language server protocol alone (src/adapters/declared-config.ts holds the
 * config's grammar for one).
 */

import type { PluginModule } from "../../src/plugins/api.ts";
import { DeclaredAdapter } from "./declared.ts";

const declared: PluginModule = {
  adapter: ({ root, language, declared }) => {
    if (declared === undefined) throw new Error(`the declared plugin was asked for ${language} with no declaration from the config`);
    return new DeclaredAdapter(root, declared);
  },
};

export default declared;
