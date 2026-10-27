/**
 * docs/plugins.md held to the code it describes: its tables list exactly
 * what the code holds, its examples validate as what they show, and its
 * claims about the bundled plugins are true of them. A plugin author follows
 * the guide, and the guide steered authors to hand-written readers after
 * Python moved to a parser (mnemion's Swift plugin, written from the
 * 1.11.0-beta.0 docs), which pluginApi 4 then removed, so the guide is
 * checked as code is.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { LANGUAGE_DUTIES } from "./check.ts";
import { parsedOf, syntaxOf } from "./languages.ts";
import { ADAPTER_METHODS, INTERFACE_FACTS, MANIFEST_KEYS, PLUGIN_API, SYNTAX_SLOTS, TREE_SITTER_KEYS, type PluginManifest } from "./plugin.ts";
import { BUNDLED_DIR, readManifest } from "./registry.ts";
import { CAPTURES } from "./syntax-trees.ts";

const DOC = readFileSync(resolve("docs/plugins.md"), "utf8");
const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** The first cells of the table whose header row begins with `header`, each cell's names: its backticked ones, or the cell's text when it has none. */
function tableNames(header: string): string[] {
  const lines = DOC.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(`| ${header} |`));
  assert.ok(start >= 0, `docs/plugins.md has a table headed ${header}`);
  const names: string[] = [];
  for (const line of lines.slice(start + 2)) {
    const row = line.trim();
    if (!row.startsWith("|")) break;
    const cell = row.split("|")[1]!.trim();
    const ticked = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.replace(/\(.*\)$/, ""));
    names.push(...(ticked.length > 0 ? ticked : [cell]));
  }
  return names;
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

test("docs/plugins.md's tables list exactly what the code holds: the duties plugin check runs, the manifest's keys, the syntax slots, the treeSitter keys, the captures and the adapter's methods", () => {
  assert.deepEqual(sorted(tableNames("Duty")), sorted(LANGUAGE_DUTIES), "the duty table");
  assert.deepEqual(sorted(tableNames("Key")), sorted(MANIFEST_KEYS), "the manifest key table, the first headed Key");
  assert.deepEqual(sorted(tableNames("Slot")), sorted(SYNTAX_SLOTS), "the syntax slot table");
  // The second Key table is treeSitter's.
  const second = DOC.split("\n").findIndex((l, i, all) => l.trim().startsWith("| Key |") && all.slice(0, i).some((m) => m.trim().startsWith("| Key |")));
  const treeKeys: string[] = [];
  for (const line of DOC.split("\n").slice(second + 2)) {
    if (!line.trim().startsWith("|")) break;
    treeKeys.push(...[...line.split("|")[1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!));
  }
  assert.deepEqual(sorted(treeKeys), sorted(TREE_SITTER_KEYS), "the treeSitter key table");
  assert.deepEqual(sorted(tableNames("Capture").map((c) => c.replace(/^@/, ""))), sorted(CAPTURES), "the capture table");
  assert.deepEqual(sorted(tableNames("Method")), sorted(ADAPTER_METHODS), "the adapter method table");
});

test("every plugin.json example in docs/plugins.md validates as a manifest of the interface version this Coherence runs, and every treeSitter example names only treeSitter's keys", () => {
  const blocks = [...DOC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const manifests = blocks.filter((b) => b.includes('"pluginApi"'));
  assert.ok(manifests.length > 0, "the guide shows a manifest");
  for (const text of manifests) {
    const manifest = JSON.parse(text) as PluginManifest;
    assert.equal(manifest.pluginApi, PLUGIN_API, `the example is written for pluginApi ${manifest.pluginApi}, and this Coherence runs ${PLUGIN_API}`);
    // Beside it, a file at every path it names, so the manifest is held to its shape and not to files the page cannot ship.
    const dir = mkdtempSync(join(tmpdir(), "coherence-doc-manifest-"));
    fixtures.push(dir);
    const named = [manifest.module, manifest.lexicon, manifest.treeSitter?.parser, manifest.treeSitter?.queries].filter((p): p is string => p !== undefined);
    for (const path of named) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), "");
    }
    writeFileSync(join(dir, "plugin.json"), text);
    assert.deepEqual(readManifest(manifest.name, dir, "docs/plugins.md").problems, [], "the example validates");
  }
  for (const text of blocks.filter((b) => b.trim().startsWith('"treeSitter"'))) {
    const fragment = JSON.parse(`{${text}}`) as { treeSitter: Record<string, unknown> };
    for (const key of Object.keys(fragment.treeSitter)) assert.ok((TREE_SITTER_KEYS as readonly string[]).includes(key), `treeSitter example names ${key}`);
  }
});

test("docs/plugins.md's claims about the bundled plugins are true of them: each named as read through a parser names one, and the plugin it says to start from reads through a parser", () => {
  const manifest = (name: string): PluginManifest => readManifest(name, join(BUNDLED_DIR, name), "docs/plugins.md").manifest!;
  const claims = [...DOC.matchAll(/<!-- claims: ([^.]*)\./g)].flatMap((m) => m[1]!.split(";").map((c) => c.trim()));
  assert.ok(claims.length > 0, "the guide says which bundled plugins read through a parser");
  for (const claim of claims) {
    const [kind, ...rest] = claim.split(/\s+/);
    for (const name of rest.join(" ").split(",").map((n) => n.trim()).filter((n) => n !== "")) {
      const m = manifest(name);
      // A plugin reads its text through a parser or not at all: no claim of another kind is one the code can hold.
      if (kind === "parser") assert.ok(m.treeSitter !== undefined, `the guide says ${name} reads through a parser; its manifest names none`);
      else assert.fail(`a claim of no known kind: ${claim}`);
    }
  }
  const start = /start from `(\w+)`/.exec(DOC);
  assert.ok(start !== null, "the guide names a plugin to start from");
  assert.ok(manifest(start[1]!).treeSitter !== undefined, `the guide says to start from ${start[1]}, which names no parser`);
});

test("docs/plugins.md's claims about what the slots read are true: the interfaces table states exactly the facts the code lets it, the readings it may not answer are exactly the parse's, and the entrance members it says read text by hand are the entrance syntax's", () => {
  const prose = DOC.replace(/\s+/g, " ");
  const row = DOC.split("\n").find((l) => l.trim().startsWith("| `interfaces` |"));
  assert.ok(row !== undefined, "the slot table has an interfaces row");
  const stated = /`\{ ([^}]*) \}` alone/.exec(row);
  assert.ok(stated !== null, `the interfaces row says what the table states: ${row}`);
  assert.deepEqual(sorted(stated[1]!.split(",").map((f) => f.trim())), sorted(INTERFACE_FACTS), "the facts an interfaces table states");
  const refused = /an `interfaces` table that answers ((?:`\w+`,? )+)or anything but `(\w+)` is refused/.exec(prose);
  assert.ok(refused !== null, "the guide names the readings an interfaces table may not answer");
  assert.deepEqual([refused[2]], [...INTERFACE_FACTS], "the one member it may answer");
  // The readings it names are the parse's, every one of them: what pluginApi 3's tables answered by hand.
  assert.deepEqual(sorted([...refused[1]!.matchAll(/`(\w+)`/g)].map((m) => m[1]!)), sorted(Object.keys(parsedOf("typescript", "interfaces")!)), "the parse's interfaces readings");
  assert.deepEqual(syntaxOf("typescript", "interfaces"), { serverBounds: false }, "the bundled table states its facts alone");
  // The entrance members the guide says read a file's text by hand are the entrance syntax's own.
  const entrances = /`entrances` reads a code file for ([^;]*);/.exec(prose);
  assert.ok(entrances !== null, "the guide says what the entrances slot reads by hand");
  const members = [...entrances[1]!.matchAll(/`(\w+)`/g)].map((m) => m[1]!);
  assert.ok(members.length > 0);
  const syntax = syntaxOf("typescript", "entrances")!;
  for (const member of members) assert.equal(typeof (syntax as unknown as Record<string, unknown>)[member], "function", `${member} is a function of the entrance syntax`);
});
