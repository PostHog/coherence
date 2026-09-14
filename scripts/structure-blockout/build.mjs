import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadConfig } from '../../src/config.ts';
import { captureScope } from '../../src/readings/scope/capture.ts';
import { buildStructureModel } from '../../src/readings/scope/structure-model.ts';
import { place, policy } from './rules.mjs';
import { terminalNames } from './terminals.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const options = {};
for(let i=0;i<args.length;i+=2) {
  if(!['--project','--name','--presentation'].includes(args[i]) || !args[i+1]) throw new Error('Expected --project PATH, --name SLUG, or --presentation JSON');
  options[args[i].slice(2)]=args[i+1];
}
const name=options.name??'structure-blockout';
if(!/^[a-z0-9-]+$/.test(name)) throw new Error('Artifact name must be a lowercase slug');
const projectRoot=resolve(options.project??root);
const presentation=options.presentation?JSON.parse(await readFile(resolve(options.presentation),'utf8')):{terminalNames};
const snapshot = await captureScope(await loadConfig(projectRoot));
const model = buildStructureModel(snapshot.catalog);
const layout = place(model);
const directory = resolve(root, 'docs/prototypes', options.name??'structure-downtown');
await mkdir(directory, { recursive: true });
const data = { model, layout, policy, presentation, capturedAt: new Date().toISOString(),
  catalogHash: createHash('sha256').update(JSON.stringify(snapshot.catalog)).digest('hex') };
await writeFile(resolve(directory, 'scene.json'), JSON.stringify(data, null, 2));
const bundle = await build({ entryPoints: [resolve(root, 'scripts/structure-blockout/app.jsx')],
  bundle: true, write: false, outdir: 'out', format: 'iife', minify: false,
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.woff2': 'dataurl' } });
const css = bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
const escaped = JSON.stringify(data).replace(/</g, '\\u003c');
const title=(layout.root?.label??model.project.label).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Structure study</title><style>${css}</style><div id="root"></div><script>window.SCENE=${escaped}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></html>`;
await writeFile(resolve(root, `public/_${name}.html`), html);
console.log(JSON.stringify({ html: resolve(root, `public/_${name}.html`),
  ranking: layout.ranked.map(c => ({ component: c.label, ...c.counts, score: +c.score.toFixed(2) })),
  placement: layout.cards.map(c => ({ label: c.label, downtown: c.downtown, x: c.x, y: c.y })), issues: model.issues }, null, 2));
