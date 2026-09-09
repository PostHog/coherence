import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { layoutScope } from './layout.mjs';
import { scopeScene } from './scene.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const rootFlag = process.argv.indexOf('--project');
const project = rootFlag < 0 ? fileURLToPath(new URL('../..', import.meta.url)) : resolve(process.argv[rootFlag + 1]);
const input = join(project, 'public/scope.json');
const output = join(project, 'public/_scope-library.html');
const model = JSON.parse(await readFile(input, 'utf8'));
const readings = JSON.parse(await readFile(join(project, 'public/scope-readings.json'), 'utf8'));
// Saved geometry is auditable independently of the browser. Interactive controls
// are explicitly a local view, not a mutation of the canonical snapshot.
const initial = layoutScope(scopeScene(model, { all: true }).model);
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
  console.log(`Scope library preview: ${model.nodes.length} components, ${model.relations.length} reliances, ${model.guarantees.length} guarantees; ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB → ${output}`);
}
