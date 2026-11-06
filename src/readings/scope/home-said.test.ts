import { strict as assert } from "node:assert";
import { test } from "node:test";
import { labelOf, sectionsOf } from "./home-view.ts";

test("a hook's message reads as its sections: blocks apart by a blank line, and inside one, each flush-left line ending in a colon", () => {
  const start = "Invariant floor: 24 days ago.\n\nSpec gaps: 2 entrances.\nmore of it\n\nSession: s1\nEvery journal write needs --session s1";
  assert.deepEqual(sectionsOf(start), ["Invariant floor: 24 days ago.", "Spec gaps: 2 entrances.\nmore of it", "Session: s1\nEvery journal write needs --session s1"]);
  const stop = "Regulate (Stop): before stopping, record what this session owes.\nSpec:\n○ a requirement\n1 open\nPractices (advisory):\nPractice fired";
  assert.deepEqual(sectionsOf(stop), ["Regulate (Stop): before stopping, record what this session owes.", "Spec:\n○ a requirement\n1 open", "Practices (advisory):\nPractice fired"]);
  assert.deepEqual(sectionsOf("\n\n"), []);
});

test("a section's label is the words before its first colon outside parentheses, its parenthetical moved to what follows", () => {
  assert.deepEqual(labelOf("Hand lists (the reading at 19:12 UTC; advisory): 2 groups"), { label: "Hand lists", body: "(the reading at 19:12 UTC; advisory)\n2 groups" });
  assert.deepEqual(labelOf("Decided in the last 7 days (2; one whole, with why: journal <id>):\n  d-1 x"), { label: "Decided in the last 7 days", body: "(2; one whole, with why: journal <id>)\nd-1 x" });
  assert.deepEqual(labelOf("Spec gaps: 2 entrances"), { label: "Spec gaps", body: "2 entrances" });
  assert.deepEqual(labelOf("node src/cli.ts journal"), { body: "node src/cli.ts journal" }, "no colon, no label");
  assert.deepEqual(labelOf("https://example.com is where"), { body: "https://example.com is where" }, "a colon not followed by space is no label's end");
});

test("a label ahead of a long parenthetical is still the label, and a sentence before a colon is not one", () => {
  assert.equal(labelOf(`Decided in the last 7 days (2; one whole, with why: node ${"/very/long/path".repeat(12)}/cli.ts journal <id>):\n  d-1 x`).label, "Decided in the last 7 days");
  assert.equal(labelOf("This command scaffold invariant fires a practice and the agent should follow every one of its steps: one").label, undefined);
});
