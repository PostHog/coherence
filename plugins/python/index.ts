/**
 * The Python plugin: Coherence's own reading of Python through Pyright, with
 * tach's module boundaries where a project draws them, bundled with the
 * package and run by every project unless its config names a plugin that
 * provides python in this one's place.
 */

import type { PluginModule } from "../../src/plugins/api.ts";
import { PythonAdapter } from "./python.ts";

const python: PluginModule = {
  // Python's server narrows its workspace to a reading's bounds; the others read their project whole.
  adapter: ({ root, bounds }) => new PythonAdapter(root, undefined, bounds),
};

export default python;
