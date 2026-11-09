import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, '..', 'frontend', 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const requested = new URL(request.url, 'http://localhost').pathname;
    let target = path.resolve(dist, `.${decodeURIComponent(requested)}`);
    if (!target.startsWith(`${dist}${path.sep}`) && target !== path.join(dist, 'index.html')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try { if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html'); }
    catch { target = path.join(dist, 'index.html'); }
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(500).end('Server error');
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, () => console.log(`B-Insight is available at http://localhost:${port}`));
