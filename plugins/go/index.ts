/**
 * The Go plugin: Coherence's reading of Go through gopls, run by a project
 * whose config names it under plugins and go under language.
 */

import type { PluginModule } from "../../src/plugins/api.ts";
import { GoAdapter } from "./go.ts";

const go: PluginModule = {
  adapter: ({ root }) => new GoAdapter(root),
};

export default go;
