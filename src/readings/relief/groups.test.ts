import { strict as assert } from "node:assert";
import { test } from "node:test";
import { groupFiles } from "./groups.ts";

const file = (path: string, lines = 10) => ({ file: path, lines, reached: 0 });
// A component holding another, with loose folders of its own: two of them folded into it by its spec, two not.
const files = [
  ...["a.py", "b.py", "c.py"].map((f) => file(`hc/integrations/email/${f}`)),
  ...["a.py", "b.py", "c.py"].map((f) => file(`hc/integrations/slack/${f}`)),
  ...["a.py", "b.py", "c.py"].map((f) => file(`hc/integrations/webhook/${f}`)),
  ...["a.py", "b.py", "c.py", "deep/d.py"].map((f) => file(`hc/integrations/matrix/${f}`)),
  ...["views.py", "models.py", "forms.py"].map((f) => file(`hc/integrations/signal/${f}`)),
];
const specs = ["hc/integrations", "hc/integrations/signal"];
const names = new Map([["hc/integrations", "Integrations"], ["hc/integrations/signal", "Signal"]]);

test("a folder the spec folds into its component is drawn as the component's own, never as a folder with no spec", () => {
  const unfolded = groupFiles(specs, names, files);
  assert.deepEqual(unfolded.components.filter((c) => c.district).map((c) => c.name).sort(), ["email/", "matrix/", "slack/", "webhook/"], "without folding, each loose folder stands as unclaimed land");

  const folded = groupFiles(specs, names, files, false, [{ folder: "hc/integrations/email", subtree: false }, { folder: "hc/integrations/matrix", subtree: true }]);
  assert.deepEqual(folded.components.filter((c) => c.district).map((c) => c.name).sort(), ["slack/", "webhook/"], "folded folders are no districts");
  const own = folded.components.find((c) => c.folder === "hc/integrations")!;
  assert.equal(own.files, 3 + 4, "the folded folders' files, a folded subtree's included, are the component's own block");
  assert.equal(folded.components[folded.owner("hc/integrations/matrix/deep/d.py")]!.folder, "hc/integrations");

  // Folding all but one leaves a single district, which would only be the component again: none is drawn.
  const most = groupFiles(specs, names, files, false, ["email", "slack", "matrix"].map((f) => ({ folder: `hc/integrations/${f}`, subtree: true })));
  assert.deepEqual(most.components.filter((c) => c.district).map((c) => c.name), []);
});
