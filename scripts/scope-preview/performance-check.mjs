import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const engine = process.env.SCOPE_BROWSER_ENGINE === 'chromium' ? chromium : webkit;
const browser = await engine.launch(engine === chromium && process.env.SCOPE_BROWSER_CHANNEL ? { channel: process.env.SCOPE_BROWSER_CHANNEL } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    const arc = CanvasRenderingContext2D.prototype.arc;
    window.orbitProbe = { count: 0 };
    CanvasRenderingContext2D.prototype.arc = function (...args) {
      window.orbitProbe = { count: window.orbitProbe.count + 1, args };
      return arc.apply(this, args);
    };
  });
  await page.goto(new URL('../../public/_scope-library.html', import.meta.url).href);
  await page.waitForSelector('.gravity-center');
  await page.getByRole('button', { name: 'Inspector & settings', exact: true }).first().click();
  await page.locator('.parameters summary').click();
  await page.getByLabel('Show reliance rings', { exact: true }).check();
  await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
  const population = await page.locator('#scope-data').evaluate(e => JSON.parse(e.textContent).model.nodes.filter(n => n.role === 'assembly').length);
  assert.equal(await page.locator('.component-card').count(), population, 'measure the full assembly population, not the bounded reading page');
  assert.equal(await page.locator('svg.orbits').count(), 0, 'the measured world-sized SVG failure must stay unrepresentable');
  for (let run = 0; run < 3; run++) {
    await page.getByRole('button', { name: 'Fit displayed assemblies', exact: true }).click();
    await page.waitForTimeout(150);
    const result = await page.evaluate(async () => {
      const pane = document.querySelector('.react-flow__pane'), viewport = document.querySelector('.react-flow__viewport');
      const before = viewport.style.transform, count = window.orbitProbe.count;
      const frames = [], start = performance.now(); let previous = start;
      await new Promise(resolve => {
        function frame(now) {
          frames.push(now - previous); previous = now;
          // Exercise the library input -> store -> DOM AND orbit drawing path.
          // Merely assigning viewport.style.transform bypasses the integration.
          pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
            clientX: 700, clientY: 500, deltaY: Math.cos((now - start) / 400) * 5, ctrlKey: true }));
          if (now - start < 2400) requestAnimationFrame(frame); else resolve();
        }
        requestAnimationFrame(frame);
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sorted = frames.slice(5).sort((a, b) => a - b);
      const canvas = document.querySelector('.orbit-canvas'), box = canvas.getBoundingClientRect();
      const center = document.querySelector('.gravity-center').getBoundingClientRect(), [x, y] = window.orbitProbe.args;
      return { frames: sorted.length, p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1),
        moved: viewport.style.transform !== before, draws: window.orbitProbe.count - count,
        bounded: canvas.width === Math.round(box.width * devicePixelRatio) && canvas.height === Math.round(box.height * devicePixelRatio),
        aligned: Math.abs(x + box.x - center.x - center.width / 2) < 1 && Math.abs(y + box.y - center.y - center.height / 2) < 1 };
    });
    console.log(`Full-population zoom ${run + 1}: ${JSON.stringify(result)}`);
    assert.ok(result.moved && result.draws > 30 && result.bounded && result.aligned, 'rings track the live camera inside a viewport-sized backing store');
    assert.ok(result.p95 < 40, 'p95 frame budget: below 40ms, versus the measured 234–350ms orbit stalls and 85ms residual compositing stalls');
  }
} finally { await browser.close(); }
