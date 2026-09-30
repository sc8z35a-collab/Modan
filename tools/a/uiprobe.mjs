// Full-game DOM/logic probe for the lens (no screenshot-quality rendering needed): starts the game with the
// cheapest settings, drives zoom through presets / wheel / pinch and checks camera FOV, UI state, pass wiring.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--renderer-process-limit=1'] });
const ctx = await b.newContext({ viewport: { width: 640, height: 288 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:4173/?q=qalite&autostart=1&norefl', { timeout: 120000 });
await p.waitForFunction(() => window.__game?.started, null, { timeout: 400000, polling: 2000 });
const st = () => p.evaluate(() => { const g = window.__game, L = g.R.lens; return { zoom: +L.zoom.toFixed(3), target: L.target, fov: +g.camera.fov.toFixed(3), dig: +L.digital.toFixed(2), lensOn: g.R.lensPass.enabled, prevToScreen: g.R.lensPrev.renderToScreen, read: document.getElementById('lensZ').textContent, mm: document.getElementById('lensMM').textContent, mode: document.getElementById('lensMode').textContent, on: [...document.querySelectorAll('#lensPresets button.on')].map((x) => x.textContent), look: +g.input.lookScale.toFixed(4), vm: g.viewmodel.root.scale.x.toFixed(3), lod: g.R.lens.lodBias() }; });
const settle = () => p.waitForTimeout(2500);
const out = {};
for (const z of ['.5', '1', '5', '20', '40']) {
  const box = await p.evaluate((t) => { const b = [...document.querySelectorAll('#lensPresets button')].find((x) => x.textContent === t); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.textContent }; }, z);
  await p.touchscreen.tap(box.x, box.y); await settle();
  out['preset ' + z] = { hit: box.hit, ...(await st()) };
}
await p.evaluate(() => window.__game.R.lens.setZoom(1, true)); await settle();
// wheel (desktop): 3 notches in
await p.mouse.move(400, 150); for (let i = 0; i < 3; i++) await p.mouse.wheel(0, -100); await settle();
out.wheel3 = await st();
// keyboard presets
await p.keyboard.press('Equal'); await settle(); out.keyPlus = await st();
await p.keyboard.press('Minus'); await p.keyboard.press('Minus'); await p.keyboard.press('Minus'); await settle(); out.keyMinus3 = await st();
// photo mode keeps the lens bar
await p.evaluate(() => window.__game.togglePhoto(true)); await settle();
out.photo = await p.evaluate(() => ({ bar: getComputedStyle(document.getElementById('lensbar')).display, dofOn: window.__game.R.dofPass.enabled, range: +window.__game.R.dof.cocMaterial.focusRange.toFixed(3) }));
console.log(JSON.stringify(out, null, 1));
console.log('ERRORS', errs.slice(0, 10));
await b.close();
