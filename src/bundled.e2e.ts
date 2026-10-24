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

function run(cwd: string, program: string, args: readonly string[], allowed: readonly number[] = [0]): string {
  // As the unit run does: no warm server is left behind, no telemetry or update check leaves the machine.
  const env = { ...process.env, COHERENCE_NO_WARM_UP: "1", COHERENCE_TELEMETRY: "0", COHERENCE_NO_UPDATE_CHECK: "1" };
  const done = spawnSync(program, args, { cwd, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  assert.ok(done.status !== null && allowed.includes(done.status), `${program} ${args.join(" ")} in ${cwd} exited ${done.status}:\n${done.stdout}\n${done.stderr}`);
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

let tarball: string | undefined;

/** A project with the package extracted into its node_modules, as an install leaves it; packed once for the file. */
function installedProject(name: string): { project: string; installed: string } {
  const scratch = mkdtempSync(join(tmpdir(), `coherence-bundled-${name}-`));
  scratches.push(scratch);
  tarball ??= packed(scratch);
  const project = join(scratch, "project");
  const unpacked = join(scratch, "unpacked");
  mkdirSync(unpacked);
  run(unpacked, "tar", ["-xzf", tarball]);
  mkdirSync(join(project, "node_modules", "@posthog"), { recursive: true });
  renameSync(join(unpacked, "package"), join(project, "node_modules", "@posthog", "coherence"));
  return { project, installed: join(project, "node_modules", "@posthog", "coherence") };
}

test("the bundled plugins load from an installed package: every adapter module and every syntax slot, as JavaScript, and the package's command reads a project through them", async (t) => {
  budget(t, 120, "d-e318776a");
  const { project, installed } = installedProject("load");
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
      out.slots[language] = ["entrances", "interfaces", "source", "declares", "notice"].filter((slot) => languages.syntaxOf(language, slot) !== undefined);
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
    typescript: ["entrances", "interfaces", "source", "declares", "notice"],
    python: ["entrances", "interfaces", "source", "declares"],
    rust: ["entrances", "interfaces", "source", "declares"],
  });
  assert.deepEqual(said.adapters, { typescript: "TypeScriptAdapter", python: "PythonAdapter", rust: "RustAdapter", declared: "DeclaredAdapter" });

  // The package's own command, reading the project's TypeScript through the bundled plugin's entrance rules: a package script it runs is detected.
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "adopter", private: true, type: "module", scripts: { start: "node src/app.ts" } }));
  run(project, process.execPath, [join(installed, "dist", "cli.js"), "scaffold", "component", ".", "an adopter's app"]);
  const entrances = run(project, process.execPath, [join(installed, "dist", "cli.js"), "scaffold", "entrances"]);
  assert.match(entrances, /src\/app\.ts/, `the bundled TypeScript plugin's rules detected the script package.json runs:\n${entrances}`);
});

test("an ejected plugin, swapped in from an installed package, passes plugin check and grades a project's chokepoint as the bundled one did", async (t) => {
  budget(t, 120, "d-092d0009");
  const { project, installed } = installedProject("eject");
  const coherence = (...args: string[]): string => run(project, process.execPath, [join(installed, "dist", "cli.js"), ...args], args[0] === "run" ? [0, 1] : [0]);
  // The language server and compiler a project installs beside Coherence.
  for (const dep of ["typescript", "typescript-language-server"]) symlinkSync(join(CHECKOUT, "node_modules", dep), join(project, "node_modules", dep));
  const check = JSON.parse(readFileSync(join(CHECKOUT, "plugins", "typescript", "check.json"), "utf8")) as { files: Record<string, string> };
  for (const [path, text] of Object.entries(check.files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), text);
  }
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "adopter", private: true, type: "module" }));
  writeFileSync(join(project, "coherence.config.json"), JSON.stringify({ language: "typescript" }, null, 2) + "\n");
  writeFileSync(join(project, "Shop.spec.md"), "# Shop\n\nA shop.\n\n## invariants\n- one way out: Every use of SECRET_COLUMNS goes through seal.\n  protects: SECRET_COLUMNS\n  chokepoint: seal\n  kinds: none\n");
  const graded = (session: string): { verdict: string; grade: string; refutation: string; bypasses: string[]; plugins: unknown } => {
    const entry = (JSON.parse(coherence("run", "--form", "chokepoint", "--no-server", "--json", "--session", session, "--agent", "e2e")) as { invariants: Record<string, unknown>[] }).invariants[0]!;
    return { verdict: String(entry["verdict"]), grade: String(entry["grade"]), refutation: String(entry["refutation"]), bypasses: ((entry["bypasses"] ?? []) as { file: string; line: number }[]).map((b) => `${b.file}:${b.line}`), plugins: entry["plugins"] };
  };
  const before = graded("bundled");
  assert.deepEqual({ ...before, plugins: undefined }, { verdict: "fail", grade: "broken", refutation: "automatic", bypasses: ["src/api/render.ts:1", "src/api/render.ts:5"], plugins: undefined });
  assert.match(coherence("plugin", "eject", "typescript"), /^ejected plugin typescript into \.\/coherence-plugins\/typescript/m);
  assert.match(coherence("plugin", "check", "./coherence-plugins/typescript"), /^plugin check typescript \(\.\/coherence-plugins\/typescript, typescript, [^)]*\): pass$/m, "the copy, reading Coherence through @posthog/coherence/plugin, owes what the bundled one does");
  const after = graded("ejected");
  assert.deepEqual({ ...after, plugins: undefined }, { ...before, plugins: undefined }, "graded as the bundled plugin graded it");
  assert.deepEqual(after.plugins, [{ name: "typescript", version: JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).version }], "by the ejected copy, which the entry names");
});

