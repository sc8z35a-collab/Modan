// QA server: serves dist/ and accepts canvas snapshots POSTed from a remote browser (?snap=1).
// This lets graphics QA run on a real GPU/remote browser while the 1GB sandbox only stores results.
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('dist');
const OUT = path.resolve('.agents/shots');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.bin': 'application/octet-stream', '.gltf': 'model/gltf+json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/__snap') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const name = String(body.name || 'snap').replace(/[^a-z0-9_-]/gi, '');
      if (body.png) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(body.png.split(',')[1], 'base64'));
      if (body.info) fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(body.info, null, 1));
      console.log('snap', name, body.info ? JSON.stringify(body.info) : '');
      res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end('ok');
    });
    return;
  }
  let p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(p).pipe(res);
}).listen(4180, '0.0.0.0', () => console.log('qa server :4180'));
