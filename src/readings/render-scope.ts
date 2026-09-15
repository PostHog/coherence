import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ScopeSnapshot } from "./scope/capture.ts";
import { bundleScopeExtensions } from "./scope/extension-host/bundle.ts";

/** One bundled renderer ships to consumers; viewing needs no npm install or CDN. */
export async function renderScope(snapshot: ScopeSnapshot, options: { projectRoot?: string } = {}): Promise<string> {
  return (await renderScopeDocument(snapshot, options)).html;
}

export async function renderScopeDocument(snapshot: ScopeSnapshot, options: { projectRoot?: string } = {}): Promise<{ html: string; extensionDigest: string; extensionInputs: string[] }> {
  async function bundle(name: string) {
    try { return await readFile(new URL(`./scope/${name}`, import.meta.url), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try { return await readFile(new URL(`../../dist/readings/scope/${name}`, import.meta.url), "utf8"); }
      catch { throw new Error("Scope browser bundle is missing. Run npm run build in the Coherence source checkout."); }
    }
  }
  const [js, css, extensions] = await Promise.all([bundle("client.js"), bundle("client.css"), bundleScopeExtensions(snapshot.configuration, options.projectRoot)]);
  // Preserve the authored relative declarations for Configure/download round trips.
  // Absolute module resolution belongs to the host; the browser never loads paths.
  const data = JSON.stringify(snapshot).replace(/</g, "\\u003c");
  const extensionScript = extensions.js ? `try{${extensions.js}}catch(error){globalThis.__SCOPE_EXTENSION_ERROR__=String(error?.stack??error);throw error}` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coherence Scope</title><style>${css.replace(/<\/style/gi, "<\\/style")}${extensions.css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="root"></div><noscript>Scope requires JavaScript. The complete asset catalog is available in scope.json.</noscript><script type="application/json" id="scope-data">${data}</script><script>${js.replace(/<\/script/gi, "<\\/script")}</script>${extensionScript ? `<script>${extensionScript.replace(/<\/script/gi, "<\\/script")}</script>` : ""}</body></html>\n`;
  const extensionDigest = createHash("sha256").update(extensions.js).update("\0").update(extensions.css).digest("hex");
  return { html, extensionDigest, extensionInputs: extensions.inputs };
}
