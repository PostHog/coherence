import { readFile } from "node:fs/promises";
import type { ScopeSnapshot } from "./scope/capture.ts";

/** One bundled renderer ships to consumers; viewing needs no npm install or CDN. */
export async function renderScope(snapshot: ScopeSnapshot): Promise<string> {
  async function bundle(name: string) {
    try { return await readFile(new URL(`./scope/${name}`, import.meta.url), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try { return await readFile(new URL(`../../dist/readings/scope/${name}`, import.meta.url), "utf8"); }
      catch { throw new Error("Scope browser bundle is missing. Run npm run build in the Coherence source checkout."); }
    }
  }
  const [js, css] = await Promise.all([bundle("client.js"), bundle("client.css")]);
  const data = JSON.stringify(snapshot).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coherence Scope</title><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="root"></div><noscript>Scope requires JavaScript. The complete asset catalog is available in scope.json.</noscript><script type="application/json" id="scope-data">${data}</script><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>\n`;
}
