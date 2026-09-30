import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage', '--renderer-process-limit=1'] });
const ctx = await b.newContext({ viewport: { width: 800, height: 380 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5175/tools/a/uitest.html'); await p.waitForFunction(() => document.title === 'READY');
const st = () => p.evaluate(() => { const L = window.__t.lens; return { z: +L.zoom.toFixed(3), fov: +window.__t.cam.fov.toFixed(2), read: document.getElementById('lensZ').textContent, mm: document.getElementById('lensMM').textContent, mode: document.getElementById('lensMode').textContent, on: [...document.querySelectorAll('#lensPresets button.on')].map((x) => x.textContent).join(), cross: document.getElementById('crosshair').className, look: +window.__t.input.lookScale.toFixed(4) }; });
const wait = () => p.waitForTimeout(900); const out = {};
for (const t of ['.5', '1', '2', '5', '10', '20', '40']) {
  const r = await p.evaluate((t) => { const b = [...document.querySelectorAll('#lensPresets button')].find((x) => x.textContent === t).getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2; return { x, y, hit: document.elementFromPoint(x, y)?.textContent }; }, t);
  await p.touchscreen.tap(r.x, r.y); await wait(); out['tap ' + t] = { hit: r.hit, ...(await st()) };
}
// drag on track to the middle
const tr = await p.evaluate(() => { const r = document.getElementById('lensTrack').getBoundingClientRect(); return { x: r.x + r.width / 2, top: r.top, h: r.height, hit: document.elementFromPoint(r.x + r.width / 2, r.top + r.height / 2)?.id }; });
const cdp = await ctx.newCDPSession(p);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: q[2] ?? i })) });
await touch('touchStart', [[tr.x, tr.top + tr.h * 0.9]]); await touch('touchMove', [[tr.x, tr.top + tr.h * 0.5]]); await touch('touchEnd', []); await wait();
out.dragMid = { hit: tr.hit, ...(await st()) };
// pinch in look zone: two fingers spreading 100px -> 300px (x3)
await p.evaluate(() => window.__t.lens.setZoom(1, true)); await wait();
await touch('touchStart', [[500, 190, 1]]); await touch('touchStart', [[500, 190, 1], [550, 190, 2]]);
for (let d = 50; d <= 150; d += 10) await touch('touchMove', [[500, 190, 1], [500 + d, 190, 2]]);
await touch('touchEnd', [[500, 190, 1]]); await touch('touchEnd', []); await wait();
out.pinch3x = await st();
// wheel
await p.evaluate(() => window.__t.lens.setZoom(1, true)); await wait();
await p.mouse.move(400, 200); await p.mouse.wheel(0, -315); await wait(); out.wheel = await st();
await p.keyboard.press('Equal'); await wait(); out.keyEq = await st();
await p.keyboard.down('KeyZ'); await p.waitForTimeout(1000); await p.keyboard.up('KeyZ'); await wait(); out.holdZ1s = await st();
await p.screenshot({ path: '.agents/shots/ui_lens.png' });
console.log(JSON.stringify(out, null, 0).replace(/},"/g, '},\n"')); console.log('ERR', errs); await b.close();
