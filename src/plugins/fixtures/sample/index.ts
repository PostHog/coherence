/**
 * The sample plugin: a fixture for the plugin interface's tests. Its adapter
 * wraps the TypeScript adapter it extends and marks the visibility evidence it
 * answers with; its verifier proves "holds" and refuses "breaks".
 */

import type { LanguageAdapter } from "../../../adapters/adapter.ts";
import type { PluginModule } from "../../plugin.ts";

const sample: PluginModule = {
  adapter: ({ base }): LanguageAdapter => {
    if (base === undefined) throw new Error("the sample plugin extends typescript and was handed no adapter");
    return {
      language: base.language,
      ladder: base.ladder,
      ready: () => base.ready(),
      resolve: (name, hint) => base.resolve(name, hint),
      references: (definition) => base.references(definition),
      visibility: async (definition, chokepoint) => {
        const seen = await base.visibility(definition, chokepoint);
        return { ...seen, evidence: `the sample plugin answered: ${seen.evidence}` };
      },
      testFilter: (via) => base.testFilter(via),
      refute: (protectedThing, outsideOf, exempt, occasion) => base.refute(protectedThing, outsideOf, exempt, occasion),
      forget: (files) => base.forget(files),
      // The core closes the adapter it handed over; the plugin closes only what it started, which is nothing.
      close: async () => {},
    };
  },
  verify: async ({ name }) =>
    name === "holds" ? { verdict: "pass", reason: "the sample model holds" } : name === "breaks" ? { verdict: "fail", reason: "the sample model found a counterexample" } : { verdict: "not run", reason: `the sample model knows no property ${name}` },
};

export default sample;
