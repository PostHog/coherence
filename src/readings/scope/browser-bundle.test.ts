/**
 * The browser bundle is derived, never listed: esbuild follows every import
 * from the page's entry, packages included. A module the page calls into
 * cannot be left out (1.6.0 to 1.7.1 shipped a page whose Structure view
 * called languagesReadLine, defined in a module no list named, so the live
 * page waited on "Connecting…" forever), and an import the bundler cannot
 * resolve fails the build. And the page shows its own
 * failures: a drawing that throws is put on the page, never kept as a
 * connection reason nothing shows.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleBrowserScript, buildShell } from "./build.ts";

test("the page's bundle carries every module its entry imports, packages included, and an import nothing resolves fails the bundle", async () => {
  const script = await bundleBrowserScript();
  // The relief draws with three.js: the bundle carries the package itself, so the page loads nothing from outside.
  assert.match(script, /THREE\.WebGLRenderer/, "three.js is bundled into the page");
  assert.doesNotMatch(script, /<\/script/i, "nothing in the bundle can close the inline script early");

  const dir = mkdtempSync(join(tmpdir(), "scope-bundle-"));
  try {
    writeFileSync(join(dir, "entry.ts"), 'import { gone } from "./missing.ts";\nimport { marked } from "no-such-package";\nconsole.log(gone, marked);\n');
    await assert.rejects(bundleBrowserScript(join(dir, "entry.ts")), /missing\.ts|no-such-package/, "an import the bundler cannot resolve fails the build, naming it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a page whose drawing throws shows the failure where the reader sees it, never a waiting line forever", async () => {
  const { html } = await buildShell();
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script !== undefined, "the shell carries its module");
  // A fake DOM just deep enough to boot, fetch the first load and start drawing; the drawing then throws on what it lacks.
  let banner: { innerHTML: string } | undefined;
  const root = {
    innerHTML: "",
    querySelector(selector: string) {
      if (selector === "[data-failure]") return banner ?? null;
      if (selector === ".connection-waiting") return root.innerHTML.includes("connection-waiting") ? { remove: () => (root.innerHTML = "") } : null;
      return null;
    },
    prepend(element: { innerHTML: string }) {
      banner = element;
    },
  };
  const element = () => ({ className: "", innerHTML: "", setAttribute() {} });
  const state = { lexicon: { layers: [] }, spec: {}, runs: { records: [] }, journal: { records: [] } };
  const context = {
    document: { getElementById: (id: string) => (id === "scope-root" ? root : null), createElement: element, querySelector: () => null },
    location: { search: "?token=t", hash: "" },
    URLSearchParams,
    addEventListener() {},
    // The page's own timers (retries, watchdogs) never hold the test open: a page that keeps waiting fails the assertion below instead of hanging.
    setTimeout: (run: () => void, ms?: number) => setTimeout(run, ms).unref(),
    clearTimeout,
    console,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ state, version: "v", history: {} }) }),
  };
  // One module in the browser; a script here, so the module's export keywords go.
  runInNewContext(script.replace(/^export \{\};?$/gm, "").replace(/^export /gm, ""), context);
  for (let i = 0; i < 50 && banner === undefined; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(banner !== undefined, `the failure is on the page; the page shows: ${root.innerHTML.slice(0, 160)}`);
  assert.match(banner.innerHTML, /Scope could not draw this reading\./);
  assert.doesNotMatch(root.innerHTML, /Connecting to the warm server/, "the waiting line is gone");
});
