// QA server: serves dist/ and accepts canvas snapshots POSTed from a remote browser (?snap=1).
// This lets graphics QA run on a real GPU/remote browser while the 1GB sandbox only stores results.
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('dist');
const OUT = path.resolve('.agents/shots');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.webp': 'image/webp', '.json': 'application/json', '.mjs': 'text/javascript', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.bin': 'application/octet-stream', '.gltf': 'model/gltf+json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/__snap') {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 64e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      // a malformed body used to throw inside the callback and crash the whole server
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const name = String(body.name || 'snap').replace(/[^a-z0-9_-]/gi, '') || 'snap';
        // the client sends JPEG data URLs: keep the real extension (was always saved as .png)
        const m = /^data:image\/(png|jpeg);base64,/.exec(body.png || '');
        if (m) fs.writeFileSync(path.join(OUT, name + (m[1] === 'png' ? '.png' : '.jpg')), Buffer.from(body.png.slice(m[0].length), 'base64'));
        if (body.info) fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(body.info, null, 1));
        console.log('snap', name, body.info ? JSON.stringify(body.info) : '');
        res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end('ok');
      } catch (e) { res.writeHead(400); res.end('bad request: ' + e.message); }
    });
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); } // bad %-escape crashed
  let p = path.join(ROOT, rel);
  // "startsWith(ROOT)" also accepted sibling dirs like /dist-secret; require the separator
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('404'); }
  if (fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
}).listen(4180, '0.0.0.0', () => console.log('qa server :4180'));
