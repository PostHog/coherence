import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GUARANTEE_CATALOG as catalog } from "../src/verification/guarantee-catalog.ts";
import { runGuaranteeCatalog } from "../src/verification/guarantee-catalog-cli.ts";
import { runGuaranteesCommand } from "../src/verification/guarantees-cli.ts";
import { TAXONOMY } from "../src/taxonomy/taxonomy-catalog.ts";
import { cfg, tmpProject, cleanup } from "./_helpers.ts";

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

test("guarantee catalog — every candidate retains scope, falsifier, demotion and pinned evidence without activation", async () => {
  const evidence = JSON.parse(await readFile(new URL("../docs/assays/posthog-guarantees-v0/evidence.json", import.meta.url), "utf8"));
  assert.equal(catalog.definitions.length, 36);
  assert.equal(catalog.maturity, "candidate");
  assert.equal(catalog.portability, "unproven");
  assert.equal(catalog.applicability, "caller-assessed");
  assert.equal(evidence.catalogSha256, sha(JSON.stringify(catalog)));
  assert.equal(evidence.source.commit, catalog.source.commit);
  for (const key of ["id", "title", "promise"] as const)
    assert.equal(new Set(catalog.definitions.map(item => item[key])).size, 36, key);
  const ids = new Set(catalog.definitions.map(item => item.id));
  assert.deepEqual(evidence.definitions.map((item: { id: string }) => item.id), [...ids]);
  assert.ok(new Set(catalog.definitions.map(item => item.example.area)).size >= 12);
  for (const item of catalog.definitions) {
    assert.match(item.id, /^guarantee:[a-z][a-z-]+$/);
    for (const value of [item.title, item.category, item.promise, item.appliesWhen, item.excludes, item.falsifier, item.demoteWhen, item.distinctFrom.because, item.example.limit]) {
      assert.ok(value.trim().length > 4, item.id);
      assert.doesNotMatch(value, /[\x00-\x1f\x7f]/u);
    }
    assert.ok(item.parameters.length >= 3);
    assert.equal(new Set(item.parameters).size, item.parameters.length);
    assert.ok(ids.has(item.distinctFrom.id));
    assert.notEqual(item.id, item.distinctFrom.id);
    assert.ok(!TAXONOMY.guarantees.some(old => old.id === item.id), "candidate IDs must not silently reinterpret historical suggestions");
    assert.ok(!("when" in item) && !("level" in item) && !("satisfaction" in item));
    const pin = evidence.definitions.find((entry: { id: string }) => entry.id === item.id);
    for (const kind of ["implementation", "oracle"] as const) {
      const ref = item.example[kind];
      if (!ref) { assert.equal(pin[kind], null); continue; }
      assert.equal(pin[kind].path, ref.path);
      assert.equal(pin[kind].anchor, ref.anchor);
      assert.match(pin[kind].sha256, /^[a-f0-9]{64}$/);
      assert.ok(pin[kind].line > 0);
      assert.ok(pin[kind].url.includes(catalog.source.commit));
      assert.ok(!ref.path.startsWith("/") && !ref.path.split("/").includes(".."));
    }
    if (item.example.grade === "mutation-tested") {
      assert.ok(item.example.oracle);
      assert.equal(item.example.runEvidence.length, 3);
      for (const path of item.example.runEvidence) {
        const bytes = await readFile(new URL("../" + path, import.meta.url));
        assert.equal(pin.runEvidence.find((p: { path: string }) => p.path === path).sha256, sha(bytes));
      }
    } else {
      assert.equal(item.example.runEvidence.length, 0);
      assert.equal(item.example.grade, item.example.oracle ? "test-inspected" : "source-inspected");
    }
  }
});

test("guarantee catalog — list and detail preserve the canonical population, qualifications and refusal semantics", async () => {
  const expected = JSON.stringify(catalog);
  const root = await tmpProject({});
  try {
    const before = await readdir(root);
    const list = await runGuaranteesCommand(cfg(root), ["catalog", "--json"]);
    assert.equal(list.code, 0);
    assert.deepEqual(JSON.parse(list.output), catalog);
    assert.equal(list.output, runGuaranteeCatalog(["--json"]).output);
    assert.match(runGuaranteeCatalog([]).output, /36 candidate definitions; no obligations activated/);
    for (const item of catalog.definitions) {
      const detail = runGuaranteeCatalog([item.id, "--json"]);
      assert.equal(detail.code, 0);
      const parsed = JSON.parse(detail.output);
      assert.equal(parsed.maturity, "candidate");
      assert.equal(parsed.portability, "unproven");
      assert.deepEqual(parsed.definition, item);
      const text = runGuaranteeCatalog([item.id]).output;
      for (const value of [item.promise, item.falsifier, item.demoteWhen, item.excludes, item.example.limit, catalog.limit]) assert.ok(text.includes(value));
    }
    for (const args of [["missing"], ["--check"], ["--json", "--json"], ["--satisfied"], ["a", "b"], ["--json", "--wat"]])
      assert.equal(runGuaranteeCatalog(args).code, 2);
    assert.equal(JSON.stringify(catalog), expected);
    assert.deepEqual(await readdir(root), before);
  } finally { await cleanup(root); }
});

test("guarantee catalog — public lookup never loads project configuration or reads its ledgers", async () => {
  const root = await tmpProject({ "coherence.config.json": "broken config", ".coherence/decisions/damaged.jsonl": "torn ledger" });
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  try {
    const before = await readdir(root, { recursive: true });
    const run = spawnSync(process.execPath, [cli, "guarantees", "catalog", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), catalog);
    assert.deepEqual(await readdir(root, { recursive: true }), before);
    assert.equal(await readFile(join(root, "coherence.config.json"), "utf8"), "broken config");
  } finally { await cleanup(root); }
});
