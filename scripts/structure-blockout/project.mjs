import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// A local authoring instrument, using the same snapshot and renderer as the UI.
const started = performance.now();
const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), options = {}, buildArgs = [];
for (let i=0;i<args.length;i++) {
  const key=args[i];
  if(key==='--capture-only') {options.captureOnly=true;continue;}
  if(!['--project','--name','--presentation','--layer','--unfurl','--frame'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))
    throw new Error('Usage: project.mjs [--project PATH] [--name SLUG] [--presentation JSON] [--layer opening|all|guarantees] [--unfurl COMPONENT] [--frame local] [--capture-only]');
  const value=args[++i]; options[key.slice(2)]=value;
  if(['--project','--name','--presentation'].includes(key)) buildArgs.push(key,value);
}
const name=options.name??'structure-blockout', layer=options.layer??'opening';
if(!/^[a-z0-9-]+$/.test(name)||!['opening','all','guarantees'].includes(layer)) throw new Error('Invalid artifact slug or layer');
if(options.frame && (options.frame!=='local'||!options.unfurl)) throw new Error('--frame local requires --unfurl COMPONENT');
if(!options.captureOnly) execFileSync(process.execPath,[resolve(root,'scripts/structure-blockout/build.mjs'),...buildArgs],{cwd:process.cwd(),stdio:['ignore','pipe','inherit']});
const directory=resolve(root,'docs/prototypes',options.name??'structure-downtown');
const variant=`agent-${layer}${options.unfurl?'-unfurled':''}${options.frame?'-local':''}`;
const screenshot=resolve(directory,`${variant}.png`), readingPath=resolve(directory,`${variant}.json`);
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL(`../../public/_${name}.html`,import.meta.url).href);
  await page.locator('[data-stack]').first().waitFor();await page.waitForTimeout(300);
  if(layer!=='opening') {
    await page.getByRole('button',{name:layer==='all'?/^All handoffs ·/:/^Guarantee reliances ·/}).click();
    await page.locator('.react-flow__controls-fitview').click();
  }
  if(options.unfurl) {
    const owner=await page.evaluate(value=>{
      const matches=SCENE.model.components.filter(c=>c.id===value||c.label===value);
      if(matches.length!==1||!matches[0].guarantees.length) throw new Error('Unfurl needs one component with declared promises');
      return matches[0].id;
    },options.unfurl);
    const card=page.locator('[data-stack]').filter({has:page.locator(`[data-unfurl=${JSON.stringify(owner)}]`)});
    await card.locator('[data-unfurl]').evaluate(el=>el.click());
    if(options.frame==='local') {
      await card.locator('.card-body').evaluate(el=>el.click());
      await page.getByRole('button',{name:'Frame local promises',exact:true}).click();
    }
  }
  await page.waitForTimeout(500);
  await page.waitForFunction(()=>BLOCKOUT.error||BLOCKOUT.routes.every(r=>[...document.querySelectorAll('[data-route]')].some(el=>el.dataset.route===r.id)));
  const reading=await page.evaluate(()=>{
    const map=document.querySelector('.map').getBoundingClientRect();
    const geometry=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,
      inViewport:r.right>map.left&&r.left<map.right&&r.bottom>map.top&&r.top<map.bottom,
      fullyVisible:r.left>=map.left&&r.right<=map.right&&r.top>=map.top&&r.bottom<=map.bottom};};
    return {
      project:SCENE.layout.root?.label??SCENE.model.project.label,capturedAt:SCENE.capturedAt,catalogHash:SCENE.catalogHash,
      purpose:SCENE.model.project.purposes.map(p=>p.attributes.text),notice:SCENE.presentation?.notice??null,
      gaps:[...SCENE.model.issues,...(!SCENE.model.project.purposes.length?[{source:'specs',message:'No project-purpose declaration'}]:[]),
        ...(!SCENE.model.project.entrances.length?[{source:'specs',message:'No entry-point declarations'}]:[]),
        ...(!SCENE.model.relationships.length?[{source:'specs',message:'No architectural handoffs or guarantee consumers declared'}]:[])],
      components:SCENE.layout.ranked.map(c=>({id:c.id,label:c.label,purpose:c.intent,parent:c.parent,downtown:SCENE.layout.coreIds.includes(c.id),score:c.score,counts:c.counts,
        guarantees:c.guarantees.map(g=>({id:g.id,label:g.label,verdict:g.verdict}))})),
      entrances:SCENE.model.project.entrances.map(e=>({id:e.id,label:e.label,component:e.attributes.component,anchor:e.attributes.anchor,description:e.attributes.description})),
      relationships:SCENE.model.relationships.map(r=>({id:r.id,kind:r.kind,from:r.source,to:r.target,label:r.label,because:r.because,declaration:r.declarationId,guarantees:r.guaranteeIds,problems:r.problems})),
      view:{mode:BLOCKOUT.mode,focus:BLOCKOUT.connectionFocus,selected:BLOCKOUT.selected,expanded:BLOCKOUT.expanded,sparse:BLOCKOUT.sparse,
        camera:document.querySelector('.react-flow__viewport').style.transform,
        visibleRelationships:BLOCKOUT.routes.filter(r=>['architecture','guarantee-reliance'].includes(r.kind)).map(r=>r.id),
        objects:[...document.querySelectorAll('[data-stack],[data-terminal],[data-promise-card],[data-entrance],[data-route-label]')].map(el=>({id:el.dataset.stack??el.dataset.terminal??el.dataset.promiseCard??el.dataset.entrance??el.dataset.routeLabel,...geometry(el)}))},
      routingError:BLOCKOUT.error,
    };
  });
  await page.screenshot({path:screenshot,fullPage:true});
  await writeFile(readingPath,JSON.stringify({...reading,browserErrors:errors},null,2));
  if(reading.routingError||errors.length) throw new Error(`Projection failed; inspect ${readingPath}`);
  console.log(JSON.stringify({screenshot,reading:readingPath,project:reading.project,capturedAt:reading.capturedAt,elapsedMs:Math.round(performance.now()-started),
    components:reading.components.length,relationships:reading.relationships.length,gaps:reading.gaps,
    clippedObjects:reading.view.objects.filter(o=>!o.fullyVisible).map(o=>o.id)},null,2));
} finally {await browser.close();}
