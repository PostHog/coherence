import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const artifacts=fileURLToPath(new URL('../../docs/prototypes/structure-downtown/',import.meta.url));
const browser=await chromium.launch(),observations=[];
try {
  for(const reducedMotion of ['no-preference','reduce']) {
    const page=await browser.newPage({viewport:{width:1440,height:1600},reducedMotion});
    await page.clock.install({time:new Date('2026-09-14T12:00:00Z')});
    await page.goto(new URL('../../public/_structure-blockout.html',import.meta.url).href);
    await page.locator('[data-stack]').first().waitFor();
    await page.clock.pauseAt(new Date('2026-09-14T13:00:00Z'));
    await page.clock.runFor(1000);
    await page.locator('[data-stack="component:src/evidence"] .card-body').evaluate(el=>el.click());
    await page.mouse.move(500,400);await page.mouse.down();await page.mouse.move(100,300,{steps:6});await page.mouse.up();
    await page.clock.runFor(50);
    const id=await page.evaluate(()=>SCENE.model.relationships.find(e=>e.kind==='guarantee-reliance'&&e.source==='component:src/lifecycle').id);
    const toggle=()=>page.locator('[data-unfurl="component:src/evidence"]').evaluate(el=>el.click());
    const read=async name=> {
      if(!await page.locator(`[data-route="${id}"]`).count()) await page.clock.runFor(16);
      await page.locator(`[data-route="${id}"]`).waitFor({state:'attached'});
      const result=await page.evaluate(id=> {
        const edge=BLOCKOUT.routes.find(e=>e.id===id),line=[...document.querySelectorAll('[data-route]')].find(el=>el.dataset.route===id);
        const end=line.getPointAtLength(line.getTotalLength());
        const rect=edge.labelBox,collisions=[];
        const obstacles=[...BLOCKOUT.cards,...BLOCKOUT.annotations,...BLOCKOUT.routes.filter(r=>r.labelBox&&r.id!==id).map(r=>r.labelBox)];
        for(let d=3;d<line.getTotalLength()-3;d+=3) {
          const p=line.getPointAtLength(d),obstacle=obstacles.find(o=>p.x>o.x+1&&p.x<o.x+o.width-1&&p.y>o.y+1&&p.y<o.y+o.height-1);
          if(obstacle) {collisions.push(obstacle.id);break;}
        }
        return {collisions,target:edge.target,path:line.getAttribute('d'),canonical:edge.path,prefix:edge.prefix,
          tip:{x:end.x,y:end.y},moving:line.hasAttribute('data-retargeting'),progress:line.getAttribute('data-retarget-progress'),
          label:[rect.x,rect.y,rect.width,rect.height],camera:document.querySelector('.react-flow__viewport').style.transform};
      },id);
      observations.push({reducedMotion,name,...result});return result;
    };
    const before=await read('before');
    await page.screenshot({path:`${artifacts}/retarget-${reducedMotion}-before.png`});
    await toggle();
    const start=await read('start');
    if(reducedMotion==='reduce') {
      assert.equal(start.moving,false);assert.equal(start.path,start.canonical);assert.notEqual(start.target,before.target);
      await toggle();const folded=await read('reduced-fold');assert.equal(folded.path,before.canonical);assert.equal(folded.moving,false);
    } else {
      assert.equal(start.moving,true);assert.deepEqual(start.tip,before.tip);
      await page.clock.runFor(175);await read('withdrawing');await page.screenshot({path:`${artifacts}/retarget-withdrawing.png`});
      await page.clock.runFor(175);const middle=await read('middle');
      assert.equal(middle.moving,true);assert.notDeepEqual(middle.tip,before.tip);assert.notEqual(middle.path,middle.canonical);
      await page.screenshot({path:`${artifacts}/retarget-middle.png`});
      await page.clock.runFor(175);await read('extending');await page.screenshot({path:`${artifacts}/retarget-extending.png`});
      await page.clock.runFor(225);const expanded=await read('expanded');
      assert.equal(expanded.moving,false);assert.equal(expanded.path,expanded.canonical);assert.notEqual(expanded.target,before.target);
      await page.screenshot({path:`${artifacts}/retarget-expanded.png`});
      await toggle();const collapseStart=await read('collapse-start');assert.deepEqual(collapseStart.tip,expanded.tip);
      await page.clock.runFor(300);const collapsing=await read('collapsing');assert.equal(collapsing.moving,true);assert.notDeepEqual(collapsing.tip,expanded.tip);
      await toggle();const reversed=await read('reversed');assert.deepEqual(reversed.tip,collapsing.tip);
      await page.clock.runFor(750);const reopened=await read('reopened');assert.equal(reopened.path,expanded.canonical);
      await toggle();await page.clock.runFor(750);const folded=await read('folded');assert.equal(folded.path,before.canonical);
      // Disabling motion while it is in flight settles immediately.
      await toggle();await page.clock.runFor(200);await page.emulateMedia({reducedMotion:'reduce'});await page.clock.runFor(20);
      const preference=await read('preference-change');assert.equal(preference.moving,false);assert.equal(preference.path,preference.canonical);
    }
    for(const o of observations.filter(o=>o.reducedMotion===reducedMotion)) {
      assert.deepEqual(o.collisions,[],`${o.name}: animated line crosses an object`);
      assert.deepEqual(o.label,before.label,`${o.name}: label moved`);
      assert.equal(o.prefix,before.prefix,`${o.name}: upstream changed`);
      assert.equal(o.camera,before.camera,`${o.name}: camera moved`);
    }
    await page.close();
  }
} finally {
  await browser.close();await writeFile(`${artifacts}/retarget-results.json`,JSON.stringify(observations,null,2));
}
console.log(`Passed ${observations.length} animated and reduced-motion observations`);
