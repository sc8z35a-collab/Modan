// Headless landscape-phone screenshot harness (used by QA agents).
// usage: node tools/shot.mjs [url] [outPrefix] [--hours=20] [--pos=x,z,yaw,pitch] [--q=high]
import { chromium } from 'playwright';
import fs from 'fs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = pos[0] || 'http://localhost:4173/';
const out = pos[1] || '.agents/shots/shot';
fs.mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--renderer-process-limit=1', '--disable-extensions'],
});
// Pixel-class Android in landscape
const ctx = await browser.newContext({
  viewport: { width: +(args.w || 915), height: +(args.h || 412) }, deviceScaleFactor: args.dpr ? +args.dpr : 1, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (process.env.V) console.log('>', m.text().slice(0, 200)); });
page.on('crash', () => console.log('CRASH'));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const q = args.q || 'qa';
await page.goto(`${url}?q=${q}&autostart=1&fps=1${args.extra ? '&' + args.extra : ''}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.started, null, { timeout: 600000 }).catch(() => {});
const setup = async () => page.evaluate(({ hours, p }) => {
  const g = window.__game; if (!g) return 'no game';
  if (hours) g.state.hours = parseFloat(hours);
  // pitch ?? 0 kept NaN when omitted (split -> Number(undefined) = NaN is not nullish); teleport snaps to ground
  if (p) { const [x, z, yaw, pitch] = p.split(',').map(Number); g.player.teleport(x, z, yaw); g.player.pitch = Number.isFinite(pitch) ? pitch : 0; }
  g.sky.envTimer = 99;
  return 'ok';
}, { hours: args.hours, p: args.pos });
console.log('setup', await setup());
if (args.fire) await page.evaluate(() => { const g = window.__game; g.fire.addFuel(1); g.fire.ignite(); g.fire.intensity = 1; g.fireLogs.visible = true; });
await page.waitForTimeout(+(args.wait || 6000));
// SwiftShader frames take many seconds: the default 30s screenshot timeout failed in the sandbox
await page.screenshot({ path: `${out}.png`, timeout: 300000 });
const info = await page.evaluate(() => { const g = window.__game; if (!g) return null; const i = g.R.r.info; return { tris: i.render.triangles, calls: i.render.calls, fps: document.getElementById('fps').textContent, trees: g.world.treeCount }; });
console.log(JSON.stringify(info));
fs.writeFileSync(`${out}.log`, logs.join('\n'));
if (logs.some((l) => l.startsWith('[pageerror]'))) process.exitCode = 1; // surface JS errors to the QA pipeline
console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 20).join('\n'));
await browser.close();
