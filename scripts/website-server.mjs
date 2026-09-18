// Read-only, loopback-only preview. Does not run the WinDock host or app actions.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { buildWebsiteDemo } from './build-website-demo.mjs';
await buildWebsiteDemo();
const websiteRoot = resolve(import.meta.dirname, '../website');
const downloadRoot = resolve(import.meta.dirname, '../artifacts/website-downloads');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.exe': 'application/octet-stream', '.apk': 'application/vnd.android.package-archive', '.txt': 'text/plain; charset=utf-8' };
const downloads = new Set(['WinDockSetup.exe', 'WinDock-android-debug.apk', 'SHA256SUMS.txt']);
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.includes('\\') || path.includes('\0')) throw new Error('Invalid path');
    let file;
    if (path.startsWith('/downloads/')) {
      const name = path.slice('/downloads/'.length);
      if (!downloads.has(name)) throw new Error('Unknown download');
      file = resolve(downloadRoot, name);
      res.setHeader('Content-Disposition', `${name.endsWith('.txt') ? 'inline' : 'attachment'}; filename="${name}"`);
    } else if (path === '/downloads.json') {
      file = resolve(downloadRoot, 'downloads.json');
      try { await stat(file); } catch { file = resolve(websiteRoot, 'downloads.json'); }
    } else {
      file = resolve(websiteRoot, path === '/' ? 'index.html' : path.slice(1));
      if (!file.startsWith(websiteRoot + sep) || !mime[extname(file)] || /(?:^|[\\/])\./.test(path)) throw new Error('Invalid path');
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch {
    res.removeHeader('Content-Disposition');
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
  }
});
server.listen(4173, '127.0.0.1', () => console.log('WinDock website preview: http://127.0.0.1:4173'));
