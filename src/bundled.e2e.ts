/**
 * The bundled plugins as an adopter installs them: a scratch copy of this
 * checkout built and packed as npm publishes it, extracted into a project's
 * node_modules, where Node strips no types. Every bundled plugin's adapter
 * module and every syntax slot its manifest names must load from there, and
 * the package's own command must read the project's languages through them.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { budget } from "./enforcement/test-budgets.ts";

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratches: string[] = [];

after(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

function run(cwd: string, program: string, args: readonly string[]): string {
  // As the unit run does: no warm server is left behind, no telemetry or update check leaves the machine.
  const env = { ...process.env, COHERENCE_NO_WARM_UP: "1", COHERENCE_TELEMETRY: "0", COHERENCE_NO_UPDATE_CHECK: "1" };
  const done = spawnSync(program, args, { cwd, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(done.status, 0, `${program} ${args.join(" ")} in ${cwd}:\n${done.stdout}\n${done.stderr}`);
  return done.stdout;
}

/** This checkout's sources, built and packed in a scratch copy, so neither the checkout's dist nor its tree is touched. */
function packed(scratch: string): string {
  const copy = join(scratch, "checkout");
  mkdirSync(copy);
  for (const name of ["src", "plugins", "docs", "package.json", "tsconfig.json", "tsconfig.build.json", "tsconfig.plugin-types.json", "README.md", "LICENSE"]) {
    if (existsSync(join(CHECKOUT, name))) cpSync(join(CHECKOUT, name), join(copy, name), { recursive: true });
  }
  symlinkSync(join(CHECKOUT, "node_modules"), join(copy, "node_modules"));
  run(copy, process.execPath, ["--disable-warning=ExperimentalWarning", "src/build.ts"]);
  const out = join(scratch, "pack");
  mkdirSync(out);
  run(copy, "npm", ["pack", "--ignore-scripts", "--pack-destination", out, "--json"]);
  const tarballs = readdirSync(out).filter((f) => f.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, `npm pack wrote ${tarballs.join(", ")}`);
  return join(out, tarballs[0]!);
}

test("the bundled plugins load from an installed package: every adapter module and every syntax slot, as JavaScript, and the package's command reads a project through them", async (t) => {
  budget(t, 120, "d-e318776a");
  const scratch = mkdtempSync(join(tmpdir(), "coherence-bundled-"));
  scratches.push(scratch);
  const tarball = packed(scratch);
  const project = join(scratch, "project");
  const unpacked = join(scratch, "unpacked");
  mkdirSync(unpacked);
  run(unpacked, "tar", ["-xzf", tarball]);
  mkdirSync(join(project, "node_modules", "@posthog"), { recursive: true });
  renameSync(join(unpacked, "package"), join(project, "node_modules", "@posthog", "coherence"));
  const installed = join(project, "node_modules", "@posthog", "coherence");
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "adopter", private: true, type: "module" }));
  mkdirSync(join(project, "src"));
  writeFileSync(join(project, "src", "app.ts"), "export const answer = 42;\n");

  // What the package holds: compiled modules, manifests naming them as JavaScript.
  const bundled = join(installed, "dist", "bundled");
  const defaults = JSON.parse(readFileSync(join(bundled, "defaults.json"), "utf8")) as { plugins: string[] };
  for (const name of defaults.plugins) {
    const manifest = JSON.parse(readFileSync(join(bundled, name, "plugin.json"), "utf8")) as { module?: string; syntax?: Record<string, string> };
    for (const named of [manifest.module, ...Object.values(manifest.syntax ?? {}).map((at) => at.split("#")[0])]) {
      if (named === undefined) continue;
      assert.match(named, /\.js$/, `${name} names ${named} as JavaScript`);
      assert.ok(existsSync(join(bundled, name, named)), `${name}'s ${named} is in the package`);
    }
  }

  // Loaded from node_modules: each language's slots and adapter, and the declared plugin's adapter.
  const probe = `
    const languages = await import("@posthog/coherence/dist/plugins/languages.js");
    const out = { languages: [...languages.LANGUAGES], files: {}, slots: {}, adapters: {} };
    for (const file of ["a.ts", "b.py", "c.rs"]) out.files[file] = languages.languageOfFile(file) ?? null;
    for (const language of languages.LANGUAGES) {
      out.slots[language] = ["entrances", "interfaces", "kept", "source", "declares", "notice"].filter((slot) => languages.syntaxOf(language, slot) !== undefined);
      out.adapters[language] = languages.coreAdapter(language, process.cwd()).constructor.name;
    }
    out.adapters.declared = languages.declaredAdapter({ name: "swift", extensions: [".swift"], server: ["sourcekit-lsp"] }, process.cwd()).constructor.name;
    console.log(JSON.stringify(out));
  `;
  const said = JSON.parse(run(project, process.execPath, ["--input-type=module", "-e", probe])) as {
    languages: string[];
    files: Record<string, string | null>;
    slots: Record<string, string[]>;
    adapters: Record<string, string>;
  };
  assert.deepEqual(said.languages, ["typescript", "python", "rust"]);
  assert.deepEqual(said.files, { "a.ts": "typescript", "b.py": "python", "c.rs": "rust" });
  assert.deepEqual(said.slots, {
    typescript: ["entrances", "interfaces", "kept", "source", "declares", "notice"],
    python: ["entrances", "interfaces", "kept", "source", "declares"],
    rust: ["entrances", "interfaces", "kept", "source", "declares"],
  });
  assert.deepEqual(said.adapters, { typescript: "TypeScriptAdapter", python: "PythonAdapter", rust: "RustAdapter", declared: "DeclaredAdapter" });

  // The package's own command, reading the project's TypeScript through the bundled plugin's entrance rules: a package script it runs is detected.
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "adopter", private: true, type: "module", scripts: { start: "node src/app.ts" } }));
  run(project, process.execPath, [join(installed, "dist", "cli.js"), "scaffold", "component", ".", "an adopter's app"]);
  const entrances = run(project, process.execPath, [join(installed, "dist", "cli.js"), "scaffold", "entrances"]);
  assert.match(entrances, /src\/app\.ts/, `the bundled TypeScript plugin's rules detected the script package.json runs:\n${entrances}`);
});
