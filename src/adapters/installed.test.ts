/**
 * Where the language servers and the tsserver are found: by Node's package
 * resolver, from the project, then from Coherence's own module, then PATH,
 * over fake installs laid out the way npm and pnpm lay them out. Under pnpm
 * Coherence's dependencies sit beside its package in the store, not inside
 * it, and TypeScript 7 ships no tsserver: an adopter on pnpm and
 * TypeScript 7 could not start the TypeScript instrument at all (df-aa4a8606).
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { installedPackage, locateServer, locateTsserver, tsserverNotice } from "./installed.ts";
import { startContext, tsserverBlock } from "../lifecycle/hook.ts";

// The real path: the resolver answers with real paths, and on macOS the temporary folder is a link.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "coherence-installed-")));
after(() => rmSync(scratch, { recursive: true, force: true }));

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A package folder holding a manifest and the files named. */
function pkg(dir: string, manifest: Record<string, unknown>, files: readonly string[] = []): void {
  write(join(dir, "package.json"), JSON.stringify(manifest));
  for (const file of files) write(join(dir, file), "// fixture\n");
}

const TS7 = { name: "typescript", version: "7.0.2", type: "module", exports: { "./package.json": "./package.json", ".": "./lib/version.cjs" }, bin: { tsc: "./bin/tsc" } };
const TS7_FILES = ["lib/version.cjs", "lib/tsc.js", "bin/tsc"];
const TS5 = (version: string) => ({ name: "typescript", version, bin: { tsc: "./bin/tsc", tsserver: "./bin/tsserver" } });
const TSLS = { name: "typescript-language-server", version: "5.3.0", bin: { "typescript-language-server": "lib/cli.mjs" } };
const PYRIGHT = { name: "pyright", version: "1.1.414", bin: { pyright: "index.js", "pyright-langserver": "langserver.index.js" } };

/**
 * A pnpm project on TypeScript 7: the project's own typescript in its
 * node_modules, Coherence in the store with its own dependencies beside it,
 * none inside it. Returns the project root and the file Coherence resolves from.
 */
function pnpmProject(name: string): { root: string; coherenceFrom: string } {
  const root = join(scratch, name);
  pkg(join(root, "node_modules", "typescript"), TS7, TS7_FILES);
  const store = join(root, "node_modules", ".pnpm", "@posthog+coherence@1.5.2", "node_modules");
  const coherence = join(store, "@posthog", "coherence");
  pkg(coherence, { name: "@posthog/coherence", version: "1.5.2" }, ["dist/adapters/installed.js"]);
  pkg(join(store, "typescript"), TS5("5.9.3"), ["lib/tsserver.js"]);
  pkg(join(store, "typescript-language-server"), TSLS, ["lib/cli.mjs"]);
  pkg(join(store, "pyright"), PYRIGHT, ["index.js", "langserver.index.js"]);
  write(join(root, "package.json"), JSON.stringify({ name, devDependencies: { "@posthog/coherence": "1.5.2", typescript: "^7.0.2" } }));
  return { root, coherenceFrom: join(coherence, "dist", "adapters", "installed.js") };
}

test("under pnpm with TypeScript 7, the tsserver and both language servers are Coherence's own, resolved beside its package, and the project's TypeScript is named as passed over", () => {
  const { root, coherenceFrom } = pnpmProject("pnpm-ts7");
  const store = join(root, "node_modules", ".pnpm", "@posthog+coherence@1.5.2", "node_modules");
  // The project's resolver cannot reach lib/tsserver.js: TypeScript 7's exports refuse the subpath, and the file is not there.
  assert.deepEqual(installedPackage("typescript", join(root, "package.json"))?.version, "7.0.2", "the project's TypeScript is found through its exports");
  const tsserver = locateTsserver(root, coherenceFrom);
  assert.deepEqual(tsserver, { path: join(store, "typescript", "lib", "tsserver.js"), version: "5.9.3", whose: "coherence", passedOver: "7.0.2" });
  assert.match(tsserverNotice(root, coherenceFrom), /^TypeScript: this project's TypeScript 7\.0\.2 ships no tsserver, so Coherence is using its own TypeScript 5\.9\.3 for readings/);
  const server = locateServer("typescript-language-server", "typescript-language-server", root, coherenceFrom, "");
  assert.ok(server.found, server.looked.join("\n"));
  assert.equal(server.path, join(store, "typescript-language-server", "lib", "cli.mjs"));
  assert.deepEqual([server.command, server.args], [process.execPath, [server.path]], "a package's bin script runs under this Node, whatever its mode bits");
  assert.match(server.looked[0]!, /^typescript-language-server resolved from the project \(.*\): not installed$/);
  assert.match(server.looked[1]!, /^typescript-language-server 5\.3\.0 resolved from Coherence/);
  const pyright = locateServer("pyright", "pyright-langserver", root, coherenceFrom, "");
  assert.ok(pyright.found && pyright.path === join(store, "pyright", "langserver.index.js"), pyright.looked.join("\n"));
});

test("the project's own tsserver and language server come first when it has them; a TypeScript whose tsserver.js is missing is passed over", () => {
  const { root, coherenceFrom } = pnpmProject("own-ts5");
  pkg(join(root, "node_modules", "typescript"), TS5("5.8.2"), ["lib/tsserver.js"]);
  pkg(join(root, "node_modules", "typescript-language-server"), { ...TSLS, version: "5.1.0" }, ["lib/cli.mjs"]);
  assert.deepEqual(locateTsserver(root, coherenceFrom), { path: join(root, "node_modules", "typescript", "lib", "tsserver.js"), version: "5.8.2", whose: "project", passedOver: undefined });
  assert.equal(tsserverNotice(root, coherenceFrom), "", "nothing to say when the project's own tsserver is driven");
  const server = locateServer("typescript-language-server", "typescript-language-server", root, coherenceFrom, "");
  assert.ok(server.found && server.path === join(root, "node_modules", "typescript-language-server", "lib", "cli.mjs"), server.looked.join("\n"));
  assert.equal(server.looked.length, 1, "the project's own is taken before Coherence's is looked for");
  // A typescript below 7 without its tsserver.js (a stub, a partial install) is no tsserver.
  rmSync(join(root, "node_modules", "typescript", "lib", "tsserver.js"));
  assert.equal(locateTsserver(root, coherenceFrom)?.whose, "coherence");
});

test("a server neither the project nor Coherence holds is found on PATH, and its absence names every place looked", () => {
  const root = join(scratch, "bare");
  write(join(root, "package.json"), "{}");
  const coherenceFrom = join(scratch, "bare-coherence", "dist", "adapters", "installed.js");
  write(coherenceFrom, "");
  const bin = join(scratch, "bare-bin");
  write(join(bin, "pyright-langserver"), "#!/bin/sh\n");
  const onPath = locateServer("pyright", "pyright-langserver", root, coherenceFrom, ["", join(scratch, "nowhere"), bin].join(":"));
  assert.ok(onPath.found && onPath.command === join(bin, "pyright-langserver") && onPath.args.length === 0, onPath.looked.join("\n"));
  const absent = locateServer("pyright", "pyright-langserver", root, coherenceFrom, join(scratch, "nowhere"));
  assert.equal(absent.found, false);
  assert.deepEqual(absent.looked.map((l) => l.replace(/ \(.*\)/, "")), ["pyright resolved from the project: not installed", "pyright resolved from Coherence: not installed", "pyright-langserver on PATH: none"]);
  assert.equal(locateTsserver(root, coherenceFrom), undefined);
});

test("orient says once that Coherence reads with its own TypeScript when the project's is 7 or later", async () => {
  const root = join(scratch, "orient-ts7");
  pkg(join(root, "node_modules", "typescript"), TS7, TS7_FILES);
  write(join(root, "package.json"), JSON.stringify({ name: "orient-ts7" }));
  write(join(root, "coherence.config.json"), JSON.stringify({ name: "orient-ts7", language: "typescript" }));
  const own = (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "typescript", "package.json"), "utf8")) as { version: string }).version;
  const line = `TypeScript: this project's TypeScript 7.0.2 ships no tsserver, so Coherence is using its own TypeScript ${own} for readings`;
  assert.ok(tsserverBlock(root).startsWith(line), tsserverBlock(root));
  const text = await startContext(root, { session_id: "orient-ts7" });
  assert.equal(text.split(line).length - 1, 1, `orient carries the line exactly once:\n${text.slice(0, 600)}`);
  write(join(root, "coherence.config.json"), JSON.stringify({ name: "orient-ts7", language: "python" }));
  assert.equal(tsserverBlock(root), "", "a project that reads no TypeScript is told nothing about its TypeScript");
});

/** Every non-test TypeScript source under a folder. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.(test|e2e)\.ts$/.test(name) ? [path] : [];
  });
}

/** A path into node_modules built by hand: a join or resolve given the folder name, or a string spelling a path inside it. */
const HAND_BUILT = [/\b(?:join|resolve)\([^()]*["'`]node_modules["'`]/, /["'`][^"'`\n]*node_modules[\\/][\w@.$]/];

/**
 * The files allowed to spell one, and why: the hook command install writes is
 * shell the agent host runs before any Node is started, so no resolver can be
 * asked, and it looks for Coherence itself where every package manager links
 * a direct dependency (pnpm included); hook-command reads that shell back.
 */
const SHELL_ONLY = new Map([
  ["lifecycle/install.ts", "the committed hook command is shell, run before any Node resolver exists"],
  ["lifecycle/hook-command.ts", "it reads that shell back, to tell a hook an earlier Coherence wrote, and opens no path"],
]);

test("no source file builds a path into node_modules by hand: every package Coherence starts, drives or detects is found by the resolver", () => {
  const src = dirname(dirname(fileURLToPath(import.meta.url)));
  const found = sources(src)
    .filter((file) => !SHELL_ONLY.has(file.slice(src.length + 1)))
    .flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (HAND_BUILT.some((pattern) => pattern.test(line)) ? [`${file.slice(src.length + 1)}:${i + 1}: ${line.trim()}`] : [])),
    );
  assert.deepEqual(found, [], "a hand-built node_modules path names nothing under pnpm, where a package's dependencies sit beside it, or past a package's exports; ask installed.ts");
  // The scan itself sees the shapes it refuses.
  for (const shape of [`join(root, "node_modules", ".bin", SERVER_BIN)`, "const p = `${root}/node_modules/typescript/lib/tsserver.js`;", `resolve(base, 'node_modules', "typescript")`]) {
    assert.ok(HAND_BUILT.some((pattern) => pattern.test(shape)), shape);
  }
});
