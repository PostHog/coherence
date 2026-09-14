import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const name = process.argv[2];
if (!/^[a-z0-9-]+$/.test(name ?? '')) throw new Error('Provide the built artifact slug');
const artifacts = fileURLToPath(new URL(`../../docs/prototypes/${name}/`, import.meta.url));
const browser = await chromium.launch(), results = [];
try {
  for (const width of [1440, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    await page.goto(new URL(`../../public/_${name}.html`, import.meta.url).href);
    await page.locator('[data-stack]').first().waitFor(); await page.waitForTimeout(500);
    const read = async scene => {
      await page.waitForFunction(() => BLOCKOUT.error || BLOCKOUT.routes.every(r => [...document.querySelectorAll('[data-route]')].some(el => el.dataset.route === r.id)));
      const result = await page.evaluate(() => {
        const { cards, annotations, routes } = BLOCKOUT;
        const boxes = [...cards, ...annotations, ...routes.filter(r => r.labelBox).map(r => r.labelBox)];
        const inside = (p, b) => p.x > b.x + 1 && p.x < b.x + b.width - 1 && p.y > b.y + 1 && p.y < b.y + b.height - 1;
        const collisions = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.x < b.x+b.width-1 && a.x+a.width > b.x+1 && a.y < b.y+b.height-1 && a.y+a.height > b.y+1) collisions.push(`boxes: ${a.id} / ${b.id}`);
        }
        for (const r of routes) {
          const path = [...document.querySelectorAll('[data-route]')].find(el => el.dataset.route === r.id);
          for (let d=2;d<path.getTotalLength()-2;d+=2) {
            const p = path.getPointAtLength(d);
            const hit = boxes.find(b => ![r.source,r.target,r.id].includes(b.id) && inside(p,b));
            if(hit) {collisions.push(`path: ${r.id} / ${hit.id}`);break;}
          }
        }
        const clippedText = [];
        for(const el of document.querySelectorAll('[data-stack]')) {
          const footer = el.querySelector('.unfurl').getBoundingClientRect();
          for(const part of el.querySelectorAll('.card-body > *')) if(part.getBoundingClientRect().bottom>footer.top+2) clippedText.push(el.dataset.stack);
        }
        for(const el of document.querySelectorAll('[data-promise-card]')) {
          const box=el.getBoundingClientRect(); let bottom=box.top;
          for(const part of el.querySelectorAll('button > *')) {const r=part.getBoundingClientRect();if(r.top<bottom-1||r.bottom>box.bottom-2)clippedText.push(el.dataset.promiseCard);bottom=r.bottom;}
        }
        return {error:BLOCKOUT.error, collisions, clippedText, selected:BLOCKOUT.selected, sparse:BLOCKOUT.sparse,
          cards:cards.filter(c=>c.nodeKind!=='promise').map(c=>[c.id,c.x,c.y,c.width,c.height]),
          promises:cards.filter(c=>c.nodeKind==='promise').map(c=>[c.id,c.x,c.y,c.width,c.height]),
          external:Object.fromEntries(routes.filter(r=>['architecture','guarantee-reliance'].includes(r.kind)).map(r=>[r.id,r.path])),
          camera:document.querySelector('.react-flow__viewport').style.transform,
          sidebar:document.querySelector('[data-sidebar] h2')?.textContent??null};
      });
      results.push({width,scene,...result});
      await page.screenshot({path:`${artifacts}/${scene}-${width}.png`,fullPage:true});
      assert.equal(result.error,null,scene); assert.deepEqual(result.collisions,[],scene); assert.deepEqual(result.clippedText,[],scene);
      return result;
    };
    const opening = await read('opening');
    const model = await page.evaluate(() => ({components:SCENE.model.components.length,guarantees:SCENE.model.components.reduce((n,c)=>n+c.guarantees.length,0),core:SCENE.layout.coreIds,relationships:SCENE.model.relationships,entrances:SCENE.model.project.entrances}));
    assert.equal(await page.locator('[data-stack]').count(),model.components-1);
    assert.ok(model.relationships.every(r=>!r.problems.length));
    const owner=model.core[0];
    await page.locator(`[data-stack="${owner}"] .card-body`).click();
    const inspected=await read('inspected');assert.deepEqual(inspected.external,opening.external);
    const count=await page.evaluate(id=>Math.min(3,SCENE.model.components.find(c=>c.id===id).guarantees.length),owner);
    if(count) {
      await page.locator(`[data-unfurl="${owner}"]`).click();await page.waitForTimeout(800);
      const expanded=await read('expanded-stationary');
      assert.equal(expanded.promises.length,count);assert.deepEqual(expanded.external,inspected.external);assert.deepEqual(expanded.cards,inspected.cards);assert.equal(expanded.camera,inspected.camera);
      await page.getByRole('button',{name:'Frame local promises',exact:true}).click();await page.waitForTimeout(600);
      await read('promises');
      await page.locator('[data-promise]').first().click();await read('guarantee');
      const near=await read('before-zoom');
      for(let i=0;i<8 && !await page.evaluate(()=>BLOCKOUT.sparse);i++) {await page.locator('.react-flow__controls-zoomout').click();await page.waitForTimeout(250);}
      const far=await read('far');assert.deepEqual(far.cards,near.cards);assert.deepEqual(far.promises,near.promises);assert.deepEqual(far.external,near.external);
      await page.locator(`[data-unfurl="${owner}"]`).evaluate(el=>el.click());
      const folded=await read('folded');assert.equal(folded.promises.length,0);assert.deepEqual(folded.selected,far.selected);
    }
    await page.getByRole('button',{name:'Return to overview',exact:true}).click();await page.waitForTimeout(600);
    for (const layer of ['All handoffs','Guarantee reliances']) {
      await page.getByRole('button',{name:new RegExp(`^${layer} ·`)}).click();
      await page.locator('.react-flow__controls-fitview').click();await page.waitForTimeout(500);
      await read(layer==='All handoffs'?'all-handoffs':'reliances');
    }
    assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.startsWith('file:')));await page.close();
  }
} finally {await browser.close();await writeFile(`${artifacts}/browser-results.json`,JSON.stringify(results,null,2));}
console.log(`Passed ${results.length} ${name} observations`);
