// usage: node tools/b/pshot.mjs out.png "q1" [out2.png "q2" ...]   (lane-B dev server on :5173)
// several shots per browser launch (launch + asset load dominate under SwiftShader)
import { chromium } from 'playwright';
const a = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
for (let i = 0; i < a.length; i += 2) {
  const [out, qs = ''] = [a[i], a[i + 1]];
  const p = await b.newPage({ viewport: { width: 900, height: 500 } });
  const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await p.goto(`http://localhost:5173/tools/b/propview.html?${qs}`, { timeout: 120000 });
  await p.waitForFunction(() => document.title === 'READY', null, { timeout: 300000 }).catch(() => logs.push('TIMEOUT'));
  await p.screenshot({ path: out, timeout: 120000 });
  console.log(out, JSON.stringify(await p.evaluate(() => window.__info)), logs.filter((l) => !/vite|DevTools|GPU stall/.test(l)).slice(0, 10).join('\n'));
  await p.close();
}
await b.close();
