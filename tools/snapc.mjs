// Lane C snapshot helper: deterministic ?snap= rendering through tools/qa-server.mjs (port 4180).
// usage: node tools/snapc.mjs "name|hours|x,z,yaw,pitch|extra;name2|..." [--w=800] [--f=2]
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const spec = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'c_default|10|20,40,0.8,-0.1';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--renderer-process-limit=1', '--disable-extensions'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
page.on('console', (m) => { const t = m.text(); if (/error|snap\]|warn/i.test(t) || m.type() === 'error') console.log('>', t.slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const url = `http://localhost:${args.port || 4180}/?q=${args.q || 'qa'}&snapw=${args.w || 800}&snapf=${args.f || 2}&snap=${encodeURIComponent(spec)}${args.extra ? '&' + args.extra : ''}`;
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => document.title === 'SNAP DONE', null, { timeout: 900000 });
await browser.close();
