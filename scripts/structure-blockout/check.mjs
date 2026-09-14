import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const artifacts = fileURLToPath(new URL('../../docs/prototypes/structure-downtown/', import.meta.url));
const url = new URL('../../public/_structure-blockout.html', import.meta.url).href;
const browser = await chromium.launch();
const results = [], stabilityResults = [];
try {
  for (const size of [{ width: 1440, height: 1000 }, { width: 1280, height: 900 }]) {
    const page = await browser.newPage({ viewport: size });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    await page.goto(url);
    await page.locator('[data-stack]').first().waitFor();
    await page.waitForTimeout(500);
    const landmarks = () => page.evaluate(() => ({
      objects:Object.fromEntries([...BLOCKOUT.cards,...BLOCKOUT.annotations,...BLOCKOUT.routes.filter(r=>r.labelBox).map(r=>r.labelBox)].map(o=>[o.id,[o.x,o.y,o.width,o.height]])),
      paths:Object.fromEntries(BLOCKOUT.routes.filter(r=>(r.kind==='architecture'||r.kind==='guarantee-reliance')).map(r=>[r.id,r.path])),
      camera:document.querySelector('.react-flow__viewport').style.transform
    }));
    const stable = (before,after,why) => {
      for(const [id,rect] of Object.entries(before.objects)) if(after.objects[id]) assert.deepEqual(after.objects[id],rect,`${why}: moved ${id}`);
      for(const [id,path] of Object.entries(before.paths)) if(after.paths[id]) assert.equal(after.paths[id],path,`${why}: changed shared curve ${id}`);
      assert.equal(after.camera,before.camera,`${why}: moved camera`);
      stabilityResults.push({size,transition:why,unchangedObjects:Object.keys(before.objects).filter(id=>after.objects[id]),
        unchangedArchitecturePaths:Object.keys(before.paths).filter(id=>after.paths[id]),camera:after.camera,
        before:before.objects,after:after.objects});
    };
    const inspect = async name => {
      await page.waitForFunction(() => BLOCKOUT.error || BLOCKOUT.routes.every(r => [...document.querySelectorAll('[data-route]')].some(el => el.dataset.route === r.id)));
      const observation = await page.evaluate(() => {
        const { cards, routes, annotations, error } = window.BLOCKOUT;
        const labels = routes.filter(r => r.labelBox);
        const overlap = (a, b) => a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
        const collisions = [];
        for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (overlap(cards[i], cards[j])) collisions.push(`cards: ${cards[i].label} / ${cards[j].label}`);
        for (const r of routes) {
          for (const c of [...cards, ...annotations]) if (r.labelBox && overlap(r.labelBox, c)) collisions.push(`label/card: ${r.label} / ${c.label}`);
          for (const other of labels) if (r.labelBox && r.id < other.id && overlap(r.labelBox, other.labelBox)) collisions.push(`labels: ${r.label} / ${other.label}`);
          // Sample the browser's actual cubic path, not its unsmoothed routing scaffold.
          const path = [...document.querySelectorAll('[data-route]')].find(el=>el.dataset.route===r.id);
          if (!path) { collisions.push(`missing SVG: ${r.id}`); continue; }
          const length=path.getTotalLength();
          const start=path.getPointAtLength(0),source=cards.find(c=>c.id===r.source),first=r.points[0];
          if(Math.abs(start.x-first.x)>0.1||Math.abs(start.y-first.y)>0.1||!source||
            !(Math.abs(start.x-source.x)<0.1||Math.abs(start.x-source.x-source.width)<0.1||Math.abs(start.y-source.y)<0.1||Math.abs(start.y-source.y-source.height)<0.1)) collisions.push(`detached source: ${r.label}`);
          for(let d=2;d<length-2;d+=2) {
            const p=path.getPointAtLength(d), probe={x:p.x,y:p.y,width:0.1,height:0.1};
            const card=[...cards,...annotations].find(c=>c.id!==r.source&&c.id!==r.target&&overlap(probe,c));
            const label=labels.find(l=>l.id!==r.id&&overlap(probe,l.labelBox));
            if(card||label) { collisions.push(`curve: ${r.label} / ${card?.label??label.label}`); break; }
          }
          const end=path.getPointAtLength(length), shaft=path.getPointAtLength(Math.max(0,length-24));
          const target=cards.find(c=>c.id===r.target), p=r.points.at(-1);
          if(Math.abs((end.x-shaft.x)*p.dy-(end.y-shaft.y)*p.dx)>0.1 ||
            (end.x-shaft.x)*p.dx+(end.y-shaft.y)*p.dy > -23.9)
            collisions.push(`short or non-normal arrow approach: ${r.label}`);
          if(!target || Math.abs(end.x-p.x)>0.1 || Math.abs(end.y-p.y)>0.1) collisions.push(`missed target: ${r.label}`);
          if(r.kind!=='ownership'&&r.kind!=='continuation') {
            const marker=document.getElementById(`arrow-${r.kind}`);
            if(marker.getAttribute('markerUnits')!=='userSpaceOnUse'||marker.getAttribute('refX')!=='10'||marker.getAttribute('markerWidth')!=='16') collisions.push(`unstable arrowhead: ${r.label}`);
          }
        }
        const contentOverruns = [];
        for (const node of document.querySelectorAll('[data-stack]')) {
          const footer = node.querySelector('.unfurl')?.getBoundingClientRect();
          for (const child of node.querySelectorAll('.card-body > *')) if (footer && child.getBoundingClientRect().bottom > footer.top + 2) contentOverruns.push(`${node.dataset.stack}: ${child.className}`);
        }
        for(const node of document.querySelectorAll('[data-promise-card]')) {
          const box=node.getBoundingClientRect();let bottom=box.top;
          for(const child of node.querySelectorAll('button > *')) {
            const r=child.getBoundingClientRect();
            if(r.bottom>box.bottom-2 || r.top<bottom-1) contentOverruns.push(`${node.dataset.promiseCard}: ${child.tagName}`);
            bottom=r.bottom;
          }
        }
        const transform = document.querySelector('.react-flow__viewport').style.transform;
        const zoom = Number(transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1);
        const map = document.querySelector('.map').getBoundingClientRect();
        const clippedLabels = [...document.querySelectorAll('[data-route-label]')].filter(el => {
          const r = el.getBoundingClientRect(); return r.x < map.x || r.right > map.right || r.y < map.y || r.bottom > map.bottom;
        }).map(el => el.textContent);
        return { error, collisions: [...new Set(collisions)], contentOverruns, clippedLabels, routes: routes.filter(r => r.kind === 'architecture'||r.kind==='guarantee-reliance').length, ownershipLinks: routes.filter(r => r.kind === 'ownership').length, continuations: routes.filter(r=>r.kind==='continuation').length, promises: cards.filter(c => c.nodeKind === 'promise').length, zoom,
          titlePixels: 26 * zoom, intentPixels: 19 * zoom, labelPixels: 18 * zoom, transform };
      });
      results.push({ size, scene: name, ...observation });
      await page.screenshot({ path: `${artifacts}/${name}-${size.width}.png`, fullPage: true });
      assert.equal(observation.error, null, `${name}: routing rejected`);
      assert.deepEqual(observation.collisions, [], `${name}: collision`);
      assert.deepEqual(observation.contentOverruns, [], `${name}: clipped content`);
      return observation;
    };
    const opening = await inspect('opening');
    assert.deepEqual(opening.clippedLabels, [], 'Opening must fit labels as well as cards');
    assert.equal(opening.routes, 4);
    assert.equal(await page.locator('.stack.selected').count(),0,'Opening falsely selects cards');
    assert.equal(await page.locator('[data-terminal]').count(),3);
    assert.equal(await page.locator('[data-entrance]').count(), 2);
    assert.equal(await page.locator('[data-sidebar]').count(), 0, 'Overview should give the map the full width');
    assert.ok(await page.evaluate(() => BLOCKOUT.annotations.every(a => {
      const c = BLOCKOUT.cards.find(c => c.id === a.owner);
      const path = document.querySelector(`[data-entry-arrow="${a.owner}"]`);
      const start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
      return end.y > start.y && Math.abs(a.y + end.y - c.y) < 5 && Math.abs(a.x + end.x - c.x - c.width / 2) < 1;
    })), 'An entrance arrow does not point into its owning card');
    const ownerBefore = await page.evaluate(() => {
      const c = BLOCKOUT.cards.find(c => c.id === 'component:src/evidence'); return { x:c.x, y:c.y, width:c.width, height:c.height };
    });
    const positionsBefore = await page.evaluate(() => BLOCKOUT.cards.map(c => [c.id, c.x, c.y, c.width, c.height]));
    const evidence = page.locator('[data-stack="component:src/evidence"]');
    // Reproduce the user's ordinary body click, not the special title selector.
    await evidence.locator('.intent').click();
    assert.equal(await page.locator('[data-sidebar] h2').innerText(), 'Durable evidence');
    const selected = await inspect('body-selection');
    assert.equal(selected.zoom, opening.zoom, 'Selection reset the camera zoom');
    const beforeReveal=await landmarks();
    await evidence.locator('[data-unfurl]').click();
    assert.equal(await evidence.getAttribute('data-open'), 'true');
    await page.waitForTimeout(900);
    stable(beforeReveal,await landmarks(),'evidence unfurl');
    await inspect('expanded-stationary');
    await page.getByRole('button',{name:'Frame local promises',exact:true}).click();
    await page.waitForTimeout(600);
    const unfurled = await inspect('expanded');
    assert.equal(unfurled.promises, 3);
    assert.equal(unfurled.ownershipLinks+unfurled.continuations,3);
    assert.equal(unfurled.continuations,2);
    const ownerAfter = await page.evaluate(() => {
      const c = BLOCKOUT.cards.find(c => c.id === 'component:src/evidence'); return { x:c.x, y:c.y, width:c.width, height:c.height };
    });
    assert.deepEqual(ownerAfter, ownerBefore, 'Unfurl stretched or moved the owner card');
    assert.equal(await page.locator('[data-stack] [data-promise]').count(), 0, 'Promises are still nested inside the owner card');
    assert.ok(await page.evaluate(() => {
      const promises = BLOCKOUT.cards.filter(c => c.nodeKind === 'promise');
      return promises.every((a, i) => promises.slice(i+1).every(b => Math.abs(a.x-b.x) - a.width >= 99));
    }), 'Promise cards have less than the declared 100-unit gap');
    const promiseId = await page.evaluate(() => window.SCENE.model.relationships.find(e => e.kind === 'guarantee-reliance' && e.source === 'component:src/lifecycle').guaranteeIds[0]);
    await page.locator(`[data-promise="${promiseId}"]`).click();
    assert.match(await page.locator('[data-sidebar] h2').innerText(), /verdict-bearing decision reads/);
    await page.getByRole('button', {name:'Focus connections',exact:true}).click();
    const guarantee = await inspect('guarantee');
    assert.equal(guarantee.routes, 1);
    assert.ok(await page.evaluate(id => {
      const external=BLOCKOUT.routes.find(r=>r.kind==='guarantee-reliance');
      const r=BLOCKOUT.routes.find(r=>r.kind==='continuation'&&r.target===id);
      const c=BLOCKOUT.cards.find(c=>c.id===id),p=r.points.at(-1);
      return external.target===r.source && external.declaredTarget==='component:src/evidence' && r.relationshipIds.includes(external.id) &&
        (Math.abs(p.x-c.x)<1 || Math.abs(p.x-c.x-c.width)<1 || Math.abs(p.y-c.y)<1 || Math.abs(p.y-c.y-c.height)<1);
    }, promiseId), 'Terminal continuation missed the exact promise or lost its declared reliance');
    assert.match(await page.locator('[data-sidebar]').innerText(), /Agent lifecycle → Durable evidence/);
    // Get a useful close look, in addition to the full-map mechanical capture.
    await page.locator('.react-flow__controls-zoomin').click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${artifacts}/guarantee-close-${size.width}.png`, fullPage: true });
    const expansion = await page.evaluate(() => window.BLOCKOUT.expanded);
    for (let i = 0; i < 6; i++) {
      const button = page.locator('.react-flow__controls-zoomout');
      if (await button.isDisabled()) break;
      await button.click();
    }
    await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => window.BLOCKOUT.expanded), expansion, 'Zoom erased explicit expansion');
    assert.ok(await page.locator('.stack.sparse').count(), 'Far zoom did not simplify cards');
    assert.equal(await page.locator('[data-promise-card]').count(), 3, 'Zoom hid explicitly unfurled promises');
    for (let i=0;i<4;i++) await page.locator('.react-flow__controls-zoomin').click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('[data-promise-card]').count(), 3, 'Zooming back lost independent promise cards');
    const beforeFold=await landmarks();
    await page.locator('[data-unfurl="component:src/evidence"]').evaluate(el=>el.click());
    await page.waitForTimeout(500);
    stable(beforeFold,await landmarks(),'evidence fold');
    assert.equal(await page.locator('[data-promise-card]').count(), 0, 'Fold left promise cards behind');
    assert.deepEqual(await page.evaluate(() => BLOCKOUT.cards.map(c => [c.id, c.x, c.y, c.width, c.height])), positionsBefore, 'Fold did not restore the component map');
    await page.getByRole('button', { name: 'Return to overview', exact: true }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'All handoffs · 12', exact: true }).click();
    await page.locator('.react-flow__controls-fitview').click();
    await page.waitForTimeout(400);
    const all = await inspect('all-handoffs');
    assert.equal(all.routes, 12);
    if(await page.locator('.stack.sparse').count()) { await page.locator('.react-flow__controls-zoomin').click(); await page.waitForTimeout(350); }
    await page.locator('[data-unfurl="component:test"]').click();
    assert.equal(await page.locator('[data-sidebar] h2').innerText(), 'Executable contracts');
    assert.equal(await page.locator('[data-stack="component:test"]').getAttribute('data-open'), 'false', 'Zero promises produced an empty expansion');
    await page.getByRole('button', { name: 'Return to overview', exact: true }).click();
    await page.waitForTimeout(600);
    // Reproduce the reported moving label, then add/fold/reveal neighboring fans.
    await page.locator('[data-stack="component:src/derivation"] .card-body').evaluate(el=>el.click());
    await page.getByRole('button', {name:'Focus connections',exact:true}).click();
    await inspect('derivation-collapsed');
    const collapsed=await landmarks();
    assert.ok(await page.getByRole('button',{name:'Addresses classification subjects',exact:true}).count());
    await page.locator('[data-unfurl="component:src/derivation"]').evaluate(el=>el.click());
    await page.waitForTimeout(400);
    const derivationOpen=await landmarks(); stable(collapsed,derivationOpen,'derivation unfurl');
    await inspect('derivation-unfurled-stationary');
    for(const id of ['component:src/evidence','component:src/taxonomy']) {
      const before=await landmarks();
      await page.locator(`[data-unfurl="${id}"]`).evaluate(el=>el.click());
      await page.waitForTimeout(400);
      stable(before,await landmarks(),`additional unfurl ${id}`);
    }
    // Restore the same selected subject without hiding any revealed cards.
    await page.locator('[data-stack="component:src/derivation"] .card-body').evaluate(el=>el.click());
    stable(derivationOpen,await landmarks(),'three-stack reveal');
    const multiple=await inspect('derivation-multiple');
    assert.equal(multiple.promises,9); assert.equal(multiple.ownershipLinks+multiple.continuations,9);
    assert.equal(multiple.continuations,3);
    const beforeNeighborFold=await landmarks();
    await page.locator('[data-unfurl="component:src/evidence"]').evaluate(el=>el.click());
    stable(beforeNeighborFold,await landmarks(),'neighbor fold');
    await page.locator('[data-unfurl="component:src/derivation"]').evaluate(el=>el.click());
    await page.locator('[data-unfurl="component:src/derivation"]').evaluate(el=>el.click());
    stable(derivationOpen,await landmarks(),'repeat reveal');
    await inspect('derivation-reopened');
    await page.getByRole('button',{name:'Frame local promises',exact:true}).click();
    await page.waitForTimeout(600);
    await inspect('derivation-context');
    assert.deepEqual(errors, [], 'Browser errors');
    assert.ok(requests.every(r => r.startsWith('file:')), 'Offline artifact used the network');
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(`${artifacts}/browser-results.json`, JSON.stringify(results, null, 2));
  await writeFile(`${artifacts}/stability-results.json`, JSON.stringify(stabilityResults,null,2));
  console.log(JSON.stringify(results, null, 2));
}
