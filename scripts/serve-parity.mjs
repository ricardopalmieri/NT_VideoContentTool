// Servidor restrito às duas distribuições que o teste compara.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const directories = { legacy: resolve('legacy/0.6.2'), current: resolve('dist') };
// A versão atual roda sob a mesma CSP do .htaccess publicado, para um bloqueio aparecer nos testes.
const csp = (await readFile(resolve('public/.htaccess'), 'utf8')).match(/Content-Security-Policy "([^"]+)"/)?.[1];
// E sob o mesmo isolamento de origem (COOP e COEP): threads do WebAssembly e tudo o que o app faz precisam funcionar com ele.
const isolation = [...(await readFile(resolve('public/.htaccess'), 'utf8')).matchAll(/Header always set (Cross-Origin-[A-Za-z-]+) "([^"]+)"/g)].map(([, name, value]) => [name, value]);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
createServer(async (request, response) => {
  try {
    const parts = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).split('/').filter(Boolean);
    const root = directories[parts.shift()];
    if (!root) { response.writeHead(404).end(); return; }
    const file = resolve(root, parts.join('/') || 'index.html');
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const data = await readFile(file);
    const headers = { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (root === directories.current && csp) headers['Content-Security-Policy'] = csp;
    if (root === directories.current) for (const [name, value] of isolation) headers[name] = value;
    response.writeHead(200, headers);
    response.end(data);
  } catch { response.writeHead(404).end(); }
}).listen(4174, '127.0.0.1', () => console.log('Paridade: http://127.0.0.1:4174'));
