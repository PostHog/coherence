/**
 * The Convex plugin: opt-in, bundled, extending TypeScript. A project runs it
 * by naming it, "plugins": { "convex": "bundled" }; a project that does not
 * reads nothing of it. Its adapter adds the references Convex's generated API
 * makes to the TypeScript adapter's, and its entrance syntax adds a Convex
 * deployment's functions, HTTP routes and crons to TypeScript's rules.
 */

import type { PluginModule } from "../../src/plugins/api.ts";
import { ConvexAdapter } from "./convex.ts";

const convex: PluginModule = {
  adapter: ({ root, base }) => {
    if (base === undefined) throw new Error("the Convex plugin extends typescript and was handed no TypeScript adapter");
    return new ConvexAdapter(root, base);
  },
};

export default convex;
