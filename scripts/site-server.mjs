import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = await realpath(resolve(root, 'docs'));
if (siteRoot !== resolve(root, 'docs')) throw Error('宣传页目录不能是符号链接。');
const basePath = '/english-printer/';
const port = 10293;
// Keep this exact list aligned with .github/workflows/pages.yml.
// docs/ also contains project guides and screenshots which are not website assets.
const publicFiles = new Set([
  'index.html', 'styles.css', 'site.js',
  'assets/app-icon.png', 'assets/app-print.png',
  'assets/app-chat.png', 'assets/lifestyle.webp',
]);
const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}));

// This preview is deliberately independent of server/server.mjs and its device APIs.
await stat(resolve(siteRoot, 'index.html'));
const server = createServer(async (request, response) => {
  const send = (status, body = '', contentType = 'text/plain; charset=utf-8') => {
    response.writeHead(status, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    send(405, 'Method not allowed');
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/__site_health') {
      send(200, JSON.stringify({ ok: true, project: 'english-printer-site', root, siteRoot, basePath, port }), 'application/json; charset=utf-8');
      return;
    }
    if (pathname === '/' || pathname === basePath.slice(0, -1)) {
      response.writeHead(302, { Location: basePath, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (!pathname.startsWith(basePath) || pathname.includes('\\') || pathname.includes('\0')) {
      send(404, 'Not found');
      return;
    }
    const relative = pathname.slice(basePath.length) || 'index.html';
    if (!publicFiles.has(relative)) {
      send(404, 'Not found');
      return;
    }
    const filename = await realpath(resolve(siteRoot, relative));
    const contentType = types.get(extname(filename).toLowerCase());
    if (filename !== resolve(siteRoot, relative) || !filename.startsWith(siteRoot + sep) || !contentType || !(await stat(filename)).isFile()) {
      send(404, 'Not found');
      return;
    }
    send(200, await readFile(filename), contentType);
  } catch {
    send(404, 'Not found');
  }
});
server.on('error', () => {
  console.error('宣传页服务启动失败，请检查 10293 端口归属。');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`宣传页预览：http://127.0.0.1:${port}${basePath}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
