/**
 * The hooks' cost without losing their reading: the stop predicts for the
 * session's own patch and says what it found, the instrument is warmed before
 * the stop that needs it, and practice delivery reads the practices the light
 * way and the same ones.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { recordWriteTrace, sessionPatch, type Snapshot } from "../economy/trace.ts";
import { economyStopText, editContext, runHook } from "./hook.ts";
import { TypeScriptAdapter } from "../adapters/typescript.ts";
import { deliveryPractices } from "./practice-delivery.ts";
import { projectPractices } from "../spec/model.ts";

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "coherence-hook-speed-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return root;
}

test("a stop predicts for the session's own writes: never another session's or a person's uncommitted change, an ignored folder, or a file since removed", () => {
  const root = repo({ "coherence.config.json": JSON.stringify({ name: "p", ignore: ["promo"] }), "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n", "promo/x.js": "x\n" });
  try {
    writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
    writeFileSync(join(root, "src/b.ts"), "export const b = 2;\n"); // someone else's edit: the session never wrote it
    writeFileSync(join(root, "promo/x.js"), "y\n");
    writeFileSync(join(root, "src/gone.ts"), "export const g = 1;\n");
    recordWriteTrace(root, "s1", ["src/a.ts", "promo/x.js", "src/gone.ts"]);
    rmSync(join(root, "src/gone.ts"));
    assert.deepEqual(sessionPatch(root, "s1"), ["src/a.ts"]);
    assert.deepEqual(sessionPatch(root, "s2"), [], "a session that wrote nothing has no patch");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("regulate names the files the prediction found beyond what the session wrote, and which of them it never read", () => {
  const snapshot = (predicted: string[], read: string[]): Snapshot => ({ kind: "snapshot", at: "2026-10-06T00:00:00.000Z", session: "s1", commit: null, changed: ["src/a.ts"], read, predicted, tokens: 0, instrument: { language: "typescript", server: "warm" } });
  const text = economyStopText(snapshot(["src/a.ts", "src/b.ts", "src/c.ts", "src/A.spec.md"], ["src/b.ts"]));
  assert.match(text, /^Economy: this session wrote 1 file; the prediction names 3 other files that rely on them or that they rely on, and the session read 1 of them\. Not read: src\/c\.ts, src\/A\.spec\.md\.$/);
  assert.equal(economyStopText(snapshot(["src/a.ts"], [])), "", "nothing beyond the session's own files says nothing");
  assert.equal(economyStopText(undefined), "");
});

test("a session start and every prompt warm the instrument without waiting for it, and no other event does", async () => {
  const root = repo({ "README.md": "x\n" });
  try {
    const warmed: string[] = [];
    const options = { warm: (r: string) => void warmed.push(r) };
    for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"] as const) {
      await runHook(event, { cwd: root, session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } }, root, options);
    }
    assert.deepEqual(warmed, [root, root], "the start and the prompt, once each");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("practice delivery reads the same practices as the spec model, through git's listing of practice files alone", () => {
  const spec = "# Widget\n\nWidgets turn.\n\n## invariants\n";
  const practice = (name: string) => `- ${name}: A knob is oiled before it turns.\n  when: command turn-knob\n  step: oil it\n  learned: d-0000abcd\n  because: dry knobs seize\n`;
  const root = repo({
    "src/widget/Widget.spec.md": spec,
    "src/widget/Widget.practice.md": practice("oil the knob"),
    "src/loose/Loose.practice.md": practice("loose"),
    "coherence.config.json": JSON.stringify({ name: "w", ignore: ["vendor"] }),
    "vendor/v/V.spec.md": spec,
    "vendor/v/V.practice.md": practice("vendored"),
  });
  try {
    const ids = (list: { id: string; version: string }[]) => list.map((p) => `${p.id}@${p.version}`).sort();
    assert.deepEqual(ids(deliveryPractices(root)), ids(projectPractices(root)));
    assert.ok(ids(deliveryPractices(root)).some((id) => id.startsWith("src/widget/oil the knob@")), "the paired practice");
    assert.ok(!ids(deliveryPractices(root)).some((id) => /loose|vendored/.test(id)), "never one beside no spec, nor one in an ignored folder");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the prediction resolves a chokepoint invariant only when a given file spells its protected or chokepoint name, or is the module it names", async () => {
  const { spelledInGiven } = await import("../economy/closure.ts");
  const texts = new Map([["src/store.ts", "export function seal() {}\nconst SECRET_COLUMNS = {};\n"], ["src/other.ts", "export const sealed = 1;\n"]]);
  const given = [...texts.keys()];
  assert.equal(spelledInGiven("seal", given, texts), true, "a symbol a given file declares");
  assert.equal(spelledInGiven("SECRET_COLUMNS in store.ts", given, texts), true, "a symbol in a file");
  assert.equal(spelledInGiven("unseal", given, texts), false, "a name no given file spells, even as part of a longer word");
  assert.equal(spelledInGiven("seal", ["src/other.ts"], texts), false, "sealed is not seal");
  assert.equal(spelledInGiven("src/store.ts", given, texts), true, "a module path that is a given file");
  assert.equal(spelledInGiven("src/elsewhere.ts", given, texts), false);
  assert.equal(spelledInGiven("the store's secret columns", given, texts), false, "prose resolves to nothing, so it is never resolved");
});

test("an edit says which chokepoint invariants it could not check, and stays silent only for a value the spec writes as prose", { timeout: 120_000 }, async () => {
  const spec = "# Fixture\n\nA store.\n\n## invariants\n- ghost door: GHOST leaves only through gate.\n  protects: GHOST\n  chokepoint: gate\n  because: a fixture\n  kinds: none\n- prose door: the secret leaves only one way.\n  protects: the secret columns\n  chokepoint: gate\n  because: a fixture\n  kinds: none\n";
  const root = repo({
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, strict: true }, include: ["src/**/*.ts"] }),
    "coherence.config.json": JSON.stringify({ language: "typescript" }),
    "Fixture.spec.md": spec,
    "src/a.ts": "// GHOST was renamed away; gate stays\nexport function gate(): number {\n  return 1;\n}\n",
  });
  const adapter = new TypeScriptAdapter(root);
  try {
    const text = await editContext(root, { cwd: root, session_id: "s1", tool_name: "Edit", tool_input: { file_path: join(root, "src/a.ts") } }, { adapter });
    assert.match(text, /Coherence could not check 1 chokepoint invariant at this edit:\n {2}○ \.\/ghost door: .*GHOST/, text);
    assert.doesNotMatch(text, /prose door/, "a prose value is the spec's own lack, reported by spec --check");
  } finally {
    await adapter.close();
    rmSync(root, { recursive: true, force: true });
  }
});
