import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { startScopeServer } from "../src/readings/scope/server.ts";

test("Scope live extensions — transitive code changes announce a new runtime and failed bundles retain the previous generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "scope-live-extension-"));
  let server: Awaited<ReturnType<typeof startScopeServer>> | undefined;
  try {
    await mkdir(join(root, "extension-assets"));
    await writeFile(join(root, "coherence.config.json"), JSON.stringify({ name: "Live parcel", test: [], typecheck: [], ignore: ["extension-assets"] }));
    await writeFile(join(root, "project.spec.md"), "# Live parcel\n\nRetains parcels.\n");
    await writeFile(join(root, "coherence.scope.json"), JSON.stringify({ version: 1, extensions: ["./extension.jsx"] }));
    const module = "import label from './extension-assets/label.js'; export default {apiVersion:1, views:{'parcel:summary':()=>label}};\n";
    await writeFile(join(root, "extension.jsx"), module);
    await writeFile(join(root, "extension-assets/label.js"), "export default 'First runtime';\n");
    server = await startScopeServer({ cfg: await loadConfig(root), intervalMs: 60000 });
    const readEvent = async () => {
      const controller = new AbortController();
      const response = await fetch(server!.url + "events", { signal: controller.signal });
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      let text = "";
      try {
        while (!text.includes("event: snapshot") && !text.includes("event: unavailable")) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += new TextDecoder().decode(chunk.value);
        }
      } finally { controller.abort(); await reader.cancel().catch(() => {}); }
      return text;
    };
    const initial = await (await fetch(server.url)).text();
    const digest = (html: string) => /name="scope-runtime" content="([a-f0-9]+)"/.exec(html)?.[1];
    assert.ok(digest(initial));
    assert.match(await readEvent(), /event: runtime/);
    // The imported file is excluded from the ordinary source walk. Bundler inputs
    // still make it an observed generation input.
    await writeFile(join(root, "extension-assets/label.js"), "export default 'Second runtime';\n");
    const changed = await readEvent();
    assert.match(changed, /event: runtime/);
    const second = await (await fetch(server.url)).text();
    assert.notEqual(digest(initial), digest(second));
    assert.match(second, /Second runtime/);

    await writeFile(join(root, "extension.jsx"), "export default { broken syntax\n");
    const failure = await readEvent();
    assert.match(failure, /event: unavailable/);
    assert.match(failure, /Scope extension bundle failed/);
    assert.equal(await (await fetch(server.url)).text(), second, "Failed generation replaced the last good HTML");
    assert.match(await readEvent(), /event: unavailable/);

    await writeFile(join(root, "extension.jsx"), module);
    await writeFile(join(root, "extension-assets/label.js"), "export default 'Recovered runtime';\n");
    assert.match(await readEvent(), /event: snapshot/);
    const recovered = await (await fetch(server.url)).text();
    assert.notEqual(digest(second), digest(recovered));
    assert.match(recovered, /Recovered runtime/);
    assert.equal(await readFile(join(root, "extension.jsx"), "utf8"), module);
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
});
