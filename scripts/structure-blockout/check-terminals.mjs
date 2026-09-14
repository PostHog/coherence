import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const artifacts=fileURLToPath(new URL('../../docs/prototypes/structure-downtown/',import.meta.url));
const browser=await chromium.launch(),results=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1600}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('../../public/_structure-blockout.html',import.meta.url).href);
  await page.locator('[data-terminal]').first().waitFor();
  await page.waitForTimeout(400);
  const journal=page.locator('[data-terminal]').filter({hasText:'Journal integrity'});
  await journal.click();
  assert.match(await page.locator('[data-sidebar] h2').innerText(),/verdict-bearing decision reads/);
  await page.locator('[data-stack="component:src/evidence"] .card-body').evaluate(el=>el.click());
  await page.getByRole('button',{name:'Focus connections',exact:true}).click();
  // Pan once for inspection, then disclosure must preserve this camera.
  await page.mouse.move(500,400);await page.mouse.down();await page.mouse.move(100,300,{steps:6});await page.mouse.up();
  const read=async name=> {
    const r=await page.evaluate(()=> {
      const geometry=o=>[o.x,o.y,o.width,o.height];
      const external=BLOCKOUT.routes.filter(r=>r.kind==='guarantee-reliance');
      return {error:BLOCKOUT.error,terminals:Object.fromEntries(BLOCKOUT.cards.filter(c=>c.nodeKind==='terminal').map(t=>[t.id,geometry(t)])),
        external:external.map(e=> {
          const line=[...document.querySelectorAll('[data-route]')].find(p=>p.dataset.route===e.id),end=line.getPointAtLength(line.getTotalLength());
          return {id:e.id,target:e.target,provider:e.declaredTarget,guarantees:e.guaranteeIds,path:line.getAttribute('d'),endpoint:[end.x,end.y],port:e.targetPort};
        }),
        continuations:BLOCKOUT.routes.filter(r=>r.kind==='continuation').map(e=>({id:e.id,source:e.source,target:e.target,relationshipIds:e.relationshipIds,start:e.points[0],end:e.points.at(-1)})),
        cards:Object.fromEntries(BLOCKOUT.cards.filter(c=>c.nodeKind==='component').map(c=>[c.id,geometry(c)])),
        promises:BLOCKOUT.cards.filter(c=>c.nodeKind==='promise').map(c=>({id:c.id,...Object.fromEntries(['x','y','width','height'].map(k=>[k,c[k]]))})),
        semanticCount:BLOCKOUT.routes.filter(r=>r.kind==='architecture'||r.kind==='guarantee-reliance').length,
        declaredCount:SCENE.model.relationships.length,camera:document.querySelector('.react-flow__viewport').style.transform,
        labelOverruns:[...document.querySelectorAll('[data-terminal]')].filter(el=>el.querySelector('span').getBoundingClientRect().width>el.getBoundingClientRect().width-4).map(el=>el.textContent),
        animations:[...document.querySelectorAll('[data-detail-reveal]')].map(el=>({id:el.dataset.detailReveal,offset:getComputedStyle(el).strokeDashoffset})),
        dependencyHeadsOnDetail:[...document.querySelectorAll('.route.continuation')].filter(el=>el.hasAttribute('marker-end')).length};
    });
    results.push({name,...r});assert.equal(r.error,null);assert.deepEqual(r.labelOverruns,[]);assert.equal(r.declaredCount,15);assert.equal(r.dependencyHeadsOnDetail,0);
    return r;
  };
  const baseline=await read('collapsed');await page.screenshot({path:`${artifacts}/terminals-collapsed.png`});
  const toggle=()=>page.locator('[data-unfurl="component:src/evidence"]').evaluate(el=>el.click());
  await toggle();
  const starting=await read('reveal-start');assert.deepEqual(starting.external,baseline.external);assert.deepEqual(starting.terminals,baseline.terminals);assert.equal(starting.camera,baseline.camera);
  assert.ok(starting.animations.length===2);assert.ok(starting.animations.some(a=>Number.parseFloat(a.offset)>0));
  await page.waitForTimeout(800);
  const expanded=await read('expanded');await page.screenshot({path:`${artifacts}/terminals-expanded.png`});
  assert.deepEqual(expanded.external,baseline.external);assert.deepEqual(expanded.cards,baseline.cards);assert.equal(expanded.semanticCount,baseline.semanticCount);
  assert.equal(expanded.continuations.length,2);
  for(const e of expanded.external) {
    const c=expanded.continuations.find(c=>c.source===e.target);
    assert.ok(c);assert.ok(e.guarantees.includes(c.target));assert.ok(c.relationshipIds.includes(e.id));
    assert.deepEqual(e.endpoint,[e.port.x,e.port.y]);
    const t=expanded.terminals[c.source];
    assert.ok(c.start.x===t[0]||c.start.x===t[0]+t[2]||c.start.y===t[1]||c.start.y===t[1]+t[3]);
    assert.ok(expanded.promises.some(p=>p.id===c.target));
  }
  for(let i=0;i<6;i++) {const zoom=page.locator('.react-flow__controls-zoomout');if(await zoom.isDisabled()||await page.locator('.stack.sparse').count())break;await zoom.click();}
  await page.waitForTimeout(400);const tiles=await read('tiles');await page.screenshot({path:`${artifacts}/terminals-tiles.png`});
  assert.deepEqual(tiles.terminals,baseline.terminals);assert.deepEqual(tiles.continuations,expanded.continuations);assert.deepEqual(tiles.promises,expanded.promises);assert.deepEqual(tiles.external,baseline.external);
  for(const e of tiles.external) assert.deepEqual(e.endpoint,baseline.external.find(b=>b.id===e.id).endpoint);
  for(let i=0;i<4;i++)await page.locator('.react-flow__controls-zoomin').click();
  await page.waitForTimeout(800);const near=await read('near-again');assert.deepEqual(near.external,baseline.external);assert.deepEqual(near.terminals,baseline.terminals);assert.deepEqual(near.promises,expanded.promises);
  await toggle();const folded=await read('folded');assert.deepEqual(folded.external,baseline.external);assert.equal(folded.continuations.length,0);
  await page.emulateMedia({reducedMotion:'reduce'});await toggle();await page.waitForTimeout(50);
  const reduced=await read('reduced-motion');assert.ok(reduced.animations.every(a=>Number.parseFloat(a.offset)===0));assert.deepEqual(reduced.external,baseline.external);
  await journal.evaluate(el=>el.click());assert.match(await page.locator('[data-sidebar] h2').innerText(),/verdict-bearing decision reads/);
  assert.match(await page.locator('[data-sidebar]').innerText(),/Agent lifecycle → Durable evidence/);
  assert.deepEqual(errors,[]);
  await page.close();
} finally {await browser.close();await writeFile(`${artifacts}/terminal-results.json`,JSON.stringify(results,null,2));}
console.log(`Passed ${results.length} terminal disclosure and zoom observations`);
