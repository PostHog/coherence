import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadConfig } from '../src/config.ts';
import { captureScope } from '../src/readings/scope/capture.ts';
import { renderScope } from '../src/readings/render-scope.ts';

// Run npm run build first: this assesses the same generated HTML as normal Scope.
const project = resolve(process.argv[2] ?? '.');
const artifacts = resolve(process.env.SCOPE_REVIEW_DIR ?? 'docs/prototypes/structure-integrated');
await mkdir(artifacts, { recursive: true });
const snapshot = await captureScope(await loadConfig(project));
const html = join(artifacts, 'scope.html');
await writeFile(html, await renderScope(snapshot, { projectRoot: project }));
const browser = await chromium.launch();
const observations = [];
try {
  for (const width of [1440, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(html).href);
    await page.locator('[data-structure-stack]').first().waitFor();
    await page.waitForTimeout(500);
    const read = async name => {
      await page.waitForTimeout(150);
      const observation = await page.evaluate(() => {
        const states = Object.values(globalThis.__SCOPE_STRUCTURE__ ?? {}).flatMap(project => Object.values(project));
        const state = states.at(-1);
        if (!state) throw new Error('Structure diagnostics are absent');
        const boxes = [...document.querySelectorAll('.react-flow__node')].map(node => {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
          return { id: node.dataset.id, x: matrix.e, y: matrix.f, width: node.offsetWidth, height: node.offsetHeight };
        });
        for (const label of document.querySelectorAll('[data-structure-route-label]')) {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(label).transform);
          boxes.push({ id: label.dataset.structureRouteLabel, x: matrix.e, y: matrix.f, width: label.offsetWidth, height: label.offsetHeight });
        }
        const inside = (p,b) => p.x>b.x+1 && p.x<b.x+b.width-1 && p.y>b.y+1 && p.y<b.y+b.height-1;
        const collisions=[];
        for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
          const a=boxes[i],b=boxes[j];
          if(a.x<b.x+b.width-1 && a.x+a.width>b.x+1 && a.y<b.y+b.height-1 && a.y+a.height>b.y+1) collisions.push(`objects: ${a.id} / ${b.id}`);
        }
        const external = {}, allRoutes = {};
        for(const path of document.querySelectorAll('[data-structure-route]')) {
          const id=path.dataset.structureRoute, route=state.routes.find(r=>r.id===id);
          if(!route) throw new Error(`Rendered route lacks diagnostic identity: ${id}`);
          allRoutes[id]=path.getAttribute('d');
          if(!/^(detail:|ownership:)/.test(id)) external[id]=path.getAttribute('d');
          for(let d=2;d<path.getTotalLength()-2;d+=2) {
            const p=path.getPointAtLength(d),hit=boxes.find(b=>![route.source,route.target,id].includes(b.id)&&inside(p,b));
            if(hit){collisions.push(`wire: ${id} / ${hit.id}`);break;}
          }
        }
        const clipped=[];
        for(const stack of document.querySelectorAll('[data-structure-stack]')) {
          const footer=stack.querySelector('[data-structure-unfurl]').getBoundingClientRect();
          for(const part of stack.querySelectorAll('[data-structure-card-body] > *')) if(part.getBoundingClientRect().bottom>footer.top+2) clipped.push(stack.dataset.structureStack);
        }
        for(const promise of document.querySelectorAll('[data-structure-promise-card]')) {
          const box=promise.getBoundingClientRect();
          for(const part of promise.querySelectorAll('button > *')) if(part.getBoundingClientRect().bottom>box.bottom+1) clipped.push(promise.dataset.structurePromiseCard);
        }
        // Text can fit inside its card while flex shrink clips through a line.
        // Long text must end on a whole line and declare its ellipsis policy.
        for (const text of document.querySelectorAll('[data-structure-promise-card] span, .structure-zoom-intent')) {
          const css = getComputedStyle(text), line = parseFloat(css.lineHeight);
          if (css.overflow === 'hidden' && text.scrollHeight > text.clientHeight + 1) {
            if (!(parseInt(css.webkitLineClamp) > 0)) clipped.push(`unmarked text truncation: ${text.textContent}`);
            if (Math.abs(text.clientHeight / line - Math.round(text.clientHeight / line)) > .08) clipped.push(`partial line: ${text.textContent}`);
          }
        }
        const titles = [...document.querySelectorAll('[data-structure-stack] h2')].map(title => {
          const node = title.closest('.react-flow__node');
          return parseFloat(getComputedStyle(title).fontSize) * node.getBoundingClientRect().width / node.offsetWidth;
        });
        const coreIntents = [...document.querySelectorAll('[data-structure-stack][data-downtown="true"] .structure-zoom-intent')].map(el => ({ text:el.textContent, opacity:getComputedStyle(el).opacity, visibility:getComputedStyle(el).visibility }));
        return { error:state.error,collisions,clipped,external,allRoutes,selected:state.selected,titles,coreIntents,
          cards:boxes.filter(b=>state.cards.some(c=>c.id===b.id&&c.nodeKind!=='promise')),
          promises:state.cards.filter(c=>c.nodeKind==='promise'),
          camera:document.querySelector('.react-flow__viewport').style.transform,
          sidebar:document.querySelector('[data-structure-sidebar] h2')?.textContent };
      });
      observations.push({width,name,...observation});
      await page.screenshot({path:join(artifacts,`${name}-${width}.png`),fullPage:true});
      assert.equal(observation.error,null,`${name}: route failure`);
      assert.deepEqual(observation.collisions,[],`${name}: clearance`);
      assert.deepEqual(observation.clipped,[],`${name}: card content clipped`);
      return observation;
    };
    const opening=await read('opening');
    assert.ok(Math.min(...opening.titles) >= (width === 1440 ? 14 : 12), `Opening titles too small: ${Math.min(...opening.titles)}px`);
    assert.ok(opening.coreIntents.length && opening.coreIntents.every(p=>p.text && p.opacity!=='0' && p.visibility!=='hidden'), 'Opening omits the downtown responsibilities');
    const stack=page.locator('[data-structure-stack][data-downtown="true"]').first();
    await stack.locator('[data-structure-card-body]').click();
    const inspected=await read('inspected');
    assert.ok(inspected.sidebar);assert.deepEqual(inspected.external,opening.external);
    await stack.locator('[data-structure-unfurl]').click();
    const expanded=await read('expanded');
    assert.ok(expanded.promises.length);assert.deepEqual(expanded.cards,inspected.cards);assert.deepEqual(expanded.external,inspected.external);assert.equal(expanded.camera,inspected.camera);
    await page.getByRole('button',{name:'Frame local promises',exact:true}).click();
    await page.waitForTimeout(450);
    await read('local-promises');
    await page.locator('[data-structure-promise-card] button').first().click();
    await read('guarantee');
    const promiseWorld=await read('near');
    for(let i=0;i<7;i++) await page.locator('.react-flow__controls-zoomout').click();
    await page.waitForTimeout(450);
    const far=await read('far');assert.deepEqual(far.cards,promiseWorld.cards);assert.deepEqual(far.promises,promiseWorld.promises);assert.deepEqual(far.external,promiseWorld.external);
    await stack.locator('[data-structure-unfurl]').evaluate(el=>el.click());
    const folded=await read('folded');assert.equal(folded.promises.length,0);assert.deepEqual(folded.selected,far.selected);
    await page.getByRole('button',{name:'Return to overview',exact:true}).click();await page.waitForTimeout(450);
    for(const [title,name] of [['All handoffs','all-handoffs'],['Guarantee reliances','reliances']]) {
      await page.getByRole('button',{name:new RegExp(`^${title} ·`)}).click();
      await page.locator('.react-flow__controls-fitview').click();await page.waitForTimeout(450);await read(name);
    }
    const customized = structuredClone(snapshot.configuration);
    customized.views = [customized.views.find(view => view.renderer === 'structure')];
    customized.views[0].id = 'all-fields';
    customized.views[0].structure.cardFields = ['intent','rationale','boundaries','resources','entrances'];
    customized.initialView = 'all-fields';
    customized.extends = false;
    await page.getByRole('button',{name:'Configure',exact:true}).click();
    await page.getByRole('textbox',{name:'Scope JSON configuration'}).fill(JSON.stringify(customized));
    await page.getByRole('button',{name:'Apply preview',exact:true}).click();
    await page.getByRole('region',{name:'Configure Scope'}).getByRole('button',{name:'Close',exact:true}).click();
    await page.waitForTimeout(500);
    assert.ok(await page.locator('[data-structure-stack] .structure-zoom-rationale').count(), 'Optional card fields were not rendered');
    await read('all-fields');
    await page.locator('[data-structure-stack][data-downtown="true"]').first().locator('[data-structure-unfurl]').click();
    await page.locator('[data-structure-promise-card]').first().waitFor();
    customized.views[0].structure.promisePreviewCount = 1;
    await page.getByRole('button',{name:'Configure',exact:true}).click();
    await page.getByRole('textbox',{name:'Scope JSON configuration'}).fill(JSON.stringify(customized));
    await page.getByRole('button',{name:'Apply preview',exact:true}).click();
    await page.getByRole('region',{name:'Configure Scope'}).getByRole('button',{name:'Close',exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-structure-promise-card]').length === 1);
    await read('reconfigured-promises');
    assert.deepEqual(errors,[]);await page.close();
  }
}finally{await browser.close();await writeFile(join(artifacts,'browser-results.json'),JSON.stringify(observations,null,2));}
console.log(`Passed ${observations.length} integrated Structure observations; ${artifacts}`);
