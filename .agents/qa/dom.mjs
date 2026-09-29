import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-dev-shm-usage','--renderer-process-limit=1'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 288 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:4173/?q=qa&autostart=1&norefl&nocomposer', { timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.started, null, { timeout: 300000, polling: 1000 });
const r = await page.evaluate(() => {
  const out = {};
  for (const id of ['btnPhoto','btnMenu','btnRun','btnCrouch']) {
    const b = document.getElementById(id).getBoundingClientRect();
    const el = document.elementFromPoint(b.x + b.width/2, b.y + b.height/2);
    out[id] = el ? (el.id || el.className) : null;
  }
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
