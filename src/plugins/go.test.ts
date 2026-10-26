/**
 * The Go plugin (plugins/go): opt-in and bundled, providing a language no
 * default plugin does. It is held to every duty a language plugin owes by
 * plugin check over its own check.json, read by a real gopls: its file rule,
 * its declarations, every reference to the protected thing, and a chokepoint
 * graded broken with the bypass named and its refutation seen. A missing
 * gopls fails the test rather than leaving the duties unread: CI installs it
 * (go install golang.org/x/tools/gopls).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { goDeclaresAtTop } from "../../plugins/go/go-top-level.ts";
import { locateGopls } from "../../plugins/go/go.ts";
import { checkPlugin } from "./check.ts";

test("Go's top level is read by its slot: a func, a type, a var or const alone or grouped is declared; a method, a local and another package's name are not", () => {
  const text = [
    "package store",
    "",
    "type Entry struct {",
    "\tID string",
    "}",
    "",
    "var (",
    "\trows = map[string]string{}",
    "\tlimit, depth = 1, 2",
    ")",
    "",
    "const Version = 1",
    "",
    "func Write(key, value string) {",
    "\tlocal := key",
    "\trows[local] = value",
    "}",
    "",
    "func (e *Entry) Name() string { return e.ID }",
    "",
    "func Map[K comparable](k K) K { return k }",
  ].join("\n");
  const declared = ["Entry", "rows", "limit", "depth", "Version", "Write", "Map"];
  const not = ["ID", "local", "Name", "store", "Writ", "a.b"];
  assert.deepEqual(declared.filter((name) => !goDeclaresAtTop(text, name)), [], "every package-level name is declared");
  assert.deepEqual(not.filter((name) => goDeclaresAtTop(text, name)), [], "a field, a local, a method, the package and a part of a name are not");
});

test("plugin check holds the Go plugin to every duty a language plugin owes, read by a real gopls", async () => {
  const gopls = locateGopls(process.cwd());
  assert.ok(gopls.found, `gopls is not installed, so the Go plugin's duties cannot be read: go install golang.org/x/tools/gopls@v0.23.0 (looked at: ${gopls.found ? "" : gopls.looked.join("; ")})`);
  const checked = await checkPlugin(process.cwd(), "go");
  assert.equal(checked.language, "go");
  assert.deepEqual(checked.duties.map((d) => [d.name, d.verdict]), [["file rule", "pass"], ["declarations", "pass"], ["answers agree", "pass"], ["reference reading", "pass"], ["references", "pass"], ["server agrees", "pass"], ["chokepoint", "pass"], ["mass", "pass"], ["imports", "pass"], ["interfaces", "pass"], ["entrances", "pass"], ["one answer each", "pass"]], JSON.stringify(checked.duties));
  assert.match(checked.duties.find((d) => d.name === "chokepoint")!.reason, /SecretColumns through Seal graded broken, refutation automatic/);
});
