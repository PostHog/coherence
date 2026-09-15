import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bundleScopeExtensions } from "../src/readings/scope/extension-host/bundle.ts";
import { resolveScopeConfiguration } from "../src/readings/scope/configuration.ts";
import { AssetCatalog } from "../src/readings/scope/capture.ts";
import { renderScopeDocument } from "../src/readings/render-scope.ts";

async function project(source: string) {
  const root = await mkdtemp(join(tmpdir(), "scope-extension-"));
  await mkdir(join(root, "presentation"));
  await writeFile(join(root, "presentation", "scope.jsx"), source);
  return root;
}
const configured = (extension = "./presentation/scope.jsx") => resolveScopeConfiguration({ version: 1, extensions: [extension] });

test("Scope extension host — project JSX and React hooks bundle into an offline registration prelude", async () => {
  const root = await project(`import React,{useState} from 'react'; import './scope.css';
    const Card=({DefaultCard,...props})=>{const [value]=useState('hook ran');return <DefaultCard {...props} marker={value}/>};
    export default {apiVersion:1,cards:{'fixture.card':Card}};`);
  await writeFile(join(root, "presentation", "scope.css"), ".fixture{color:rebeccapurple}");
  const result = await bundleScopeExtensions(configured(), root);
  assert.match(result.js, /__SCOPE_EXTENSIONS__/);
  assert.match(result.js, /__SCOPE_REACT_RUNTIME__/);
  assert.match(result.js, /fixture\.card/);
  assert.match(result.css, /\.fixture/);
  assert.ok(result.inputs.some(path => path.endsWith("presentation/scope.jsx")));
  assert.ok(result.inputs.some(path => path.endsWith("presentation/scope.css")));
  assert.ok(!result.inputs.includes("scope-extensions-entry.js"), "synthetic stdin source is not a project input");
  await Promise.all(result.inputs.map(path => access(join(root, path))));
});

test("Scope extension host — no extensions have zero dynamic bundle cost", async () => {
  assert.deepEqual(await bundleScopeExtensions(resolveScopeConfiguration(), undefined), { js: "", css: "", inputs: [] });
});

test("Scope extension host — registrations precede mount and authored configuration survives export", async () => {
  const root = await project("export default {apiVersion:1,rankers:{'fixture.rank':()=>[]}}");
  const configuration = configured(), catalog = new AssetCatalog().finish("fixture");
  const result = await renderScopeDocument({ version: 1, catalog, configuration }, { projectRoot: root });
  const dataEnd = result.html.indexOf("</script>", result.html.indexOf('id="scope-data"'));
  const clientEnd = result.html.indexOf("</script>", dataEnd + 9), registration = result.html.indexOf("__SCOPE_EXTENSIONS__=", clientEnd);
  assert.ok(clientEnd > dataEnd && registration > clientEnd, "project registration script follows the prebuilt client script");
  const embedded = result.html.match(/<script type="application\/json" id="scope-data">(.*?)<\/script>/s)![1];
  assert.deepEqual(JSON.parse(embedded).configuration, configuration);
  assert.ok(!embedded.includes(root), "absolute host resolution leaked into configuration");
  assert.match(result.extensionDigest, /^[a-f0-9]{64}$/);
  assert.ok(result.extensionInputs.some(path => path.endsWith("presentation/scope.jsx")));
});

test("Scope extension host — missing roots, modules, module errors and root escapes refuse visibly", async () => {
  await assert.rejects(bundleScopeExtensions(configured(), undefined), /require a project root/);
  const root = await project("export default {apiVersion:1}");
  await assert.rejects(bundleScopeExtensions(configured("./missing.jsx"), root), /extensions\[0\].*missing\.jsx/);
  await assert.rejects(bundleScopeExtensions(configured(), join(root, "presentation")), /missing|extensions\[0\]/);
  await writeFile(join(root, "presentation", "scope.jsx"), "export default { broken:");
  await assert.rejects(bundleScopeExtensions(configured(), root), /bundle failed/);
});
