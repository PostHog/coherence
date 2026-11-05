/**
 * The TypeScript plugin: Coherence's own reading of TypeScript and
 * JavaScript, bundled with the package and run by every project unless its
 * config names a plugin that provides typescript in this one's place.
 */

import type { PluginModule } from "@posthog/coherence/plugin";
import { TypeScriptAdapter } from "./typescript.ts";

const typescript: PluginModule = {
  adapter: ({ root }) => new TypeScriptAdapter(root),
};

export default typescript;
