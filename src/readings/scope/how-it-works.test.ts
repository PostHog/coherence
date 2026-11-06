import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readHowItWorks } from "./how-it-works.ts";

test("the explainer Home shows reads whole: the shipped docs/how-coherence-works.md gives a title, an opening and five moments, each with its hook names and a plain line", () => {
  const how = readHowItWorks();
  assert.equal(how.kind, "read", how.kind === "unread" ? how.because : "");
  if (how.kind !== "read") return;
  assert.equal(how.title, "How Coherence works");
  assert.ok(how.lead.length > 0, "an opening");
  assert.deepEqual(how.moments.map((m) => m.tab), ["Start", "Your message", "Before a tool", "After a tool", "Stop"]);
  for (const moment of how.moments) {
    assert.ok(moment.events.length > 0, `${moment.tab} names its hooks`);
    assert.ok(moment.plain.length > 0, `${moment.tab} has a plain line`);
  }
});
