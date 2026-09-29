// full pipeline (composer + reflections) render at low res, POSTed via ?snap hook, intercepted here
import { chromium } from 'playwright';
import fs from 'fs';
const spec = process.argv[2], out = process.argv[3] || '.agents/qa/out';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-dev-shm-usage','--renderer-process-limit=1'] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 180 }, isMobile: true, hasTouch: true })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.route('**/__snap', async (r) => { const b = JSON.parse(r.request().postData()); fs.writeFileSync(`${out}/${b.name}.jpg`, Buffer.from(b.png.split(',')[1], 'base64')); console.log('snap', b.name, JSON.stringify(b.info.calls)); r.fulfill({ status: 200, body: 'ok' }); });
await page.goto(`http://localhost:4173/?q=qa&autostart=1&snapw=400&snapf=1&snap=${encodeURIComponent(spec)}`, { timeout: 120000 });
await page.waitForFunction(() => document.title === 'SNAP DONE', null, { timeout: 600000, polling: 2000 });
await browser.close();
