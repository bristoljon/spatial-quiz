// Lightweight local runner (no Netlify CLI needed): serves ./dist and runs the
// functions in netlify/functions against a local Netlify Blobs emulator.
//   npm run build && node scripts/local-server.mjs   -> http://localhost:8888
// `netlify dev` works too; this exists for machines where the CLI can't run.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BlobsServer } from '@netlify/blobs/server';
import { setEnvironmentContext } from '@netlify/blobs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.PORT || 8888);

const blobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiz-blobs-'));
const blobs = new BlobsServer({ directory: blobDir, token: 'local' });
const { port: blobPort } = await blobs.start();
setEnvironmentContext({ siteID: 'local', token: 'local', edgeURL: `http://localhost:${blobPort}`, uncachedEdgeURL: `http://localhost:${blobPort}` });
globalThis.Netlify = { env: { get: (k) => process.env[k], has: (k) => k in process.env } };

// load functions + compile their paths
const fnDir = path.join(root, 'netlify', 'functions');
const routes = [];
for (const f of await fs.readdir(fnDir)) {
  if (!f.endsWith('.mjs')) continue;
  const mod = await import(path.join(fnDir, f));
  const paths = [].concat(mod.config?.path || `/.netlify/functions/${f.replace('.mjs', '')}`);
  for (const p of paths) {
    const names = [];
    const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    routes.push({ re, names, handler: mod.default, method: mod.config?.method });
  }
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = routes.find((r) => r.re.test(url.pathname) && (!r.method || r.method === req.method));
  if (route) {
    const m = url.pathname.match(route.re);
    const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    try {
      const out = await route.handler(request, { params });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    } catch (e) {
      console.error(e);
      res.writeHead(500); res.end(String(e));
    }
    return;
  }
  // static with SPA fallback
  let file = path.join(root, 'dist', path.normalize(url.pathname));
  try {
    const st = await fs.stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch { file = path.join(root, 'dist', 'index.html'); }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(PORT, () => console.log(`Stroud Quiz running at http://localhost:${PORT}`));
