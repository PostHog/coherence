/**
 * The Rust plugin: Coherence's own reading of Rust through rust-analyzer,
 * bundled with the package and run by every project unless its config names
 * a plugin that provides rust in this one's place.
 */

import type { PluginModule } from "../../src/plugins/api.ts";
import { RustAdapter } from "./rust.ts";

const rust: PluginModule = {
  adapter: ({ root }) => new RustAdapter(root),
};

export default rust;
