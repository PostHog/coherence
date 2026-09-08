import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { layoutScope } from './layout.mjs';
import { scopeScene } from './scene.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const input = new URL('../../public/scope.json', import.meta.url);
const output = new URL('../../public/_scope-library.html', import.meta.url);
const model = JSON.parse(await readFile(input, 'utf8'));
const readings = JSON.parse(await readFile(new URL('../../public/scope-readings.json', import.meta.url), 'utf8'));
// Saved geometry is auditable independently of the browser. Interactive controls
// are explicitly a local view, not a mutation of the canonical snapshot.
const initial = layoutScope(scopeScene(model).model);
const result = await build({ absWorkingDir: here, entryPoints: ['app.jsx'], bundle: true,
  write: false, outfile: 'preview.js', minify: true, legalComments: 'inline', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = result.outputFiles.find(f => f.path.endsWith('.css')).text;
const data = JSON.stringify({ model, initial, readings }).replace(/</g, '\\u003c');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scope · library preview</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><noscript>This interactive comparison requires JavaScript. Canonical evidence remains in scope.json.</noscript><script type="application/json" id="scope-data">${data}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>\n`;
if (process.argv.includes('--check')) {
  if (html !== await readFile(output, 'utf8')) throw new Error('Scope library preview is stale');
  console.log('Scope library preview is byte-current');
} else {
  await writeFile(output, html);
  console.log(`Scope library preview: ${model.nodes.length} components, ${model.relations.length} reliances, ${model.guarantees.length} guarantees; ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB → ${fileURLToPath(output)}`);
}
