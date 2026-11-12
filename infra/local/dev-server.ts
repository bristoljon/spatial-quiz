// Local stand-in for API Gateway + Lambda + DynamoDB + Step Functions.
// Same Core, in-memory store, plain `ws` server, setTimeout for the timer.
//
// It also serves the built web app (web/dist) on the same port, so one
// `ngrok http 8787` tunnel gives phones both the site and the socket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { Core } from '../lambda/core.js';
import { MemStore } from './mem-store.js';
import type { Transport } from '../lambda/types.js';

const port = Number(process.env.PORT || 8787);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const sockets = new Map<string, WebSocket>();

const transport: Transport = {
  async send(connId, msg) {
    const ws = sockets.get(connId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  },
  async scheduleFinalize(code, qIndex, fireAt) {
    setTimeout(() => core.finalize(code, qIndex).catch(console.error), Math.max(0, fireAt - Date.now()));
  },
};

const core = new Core(new MemStore(), transport, { hostPin: process.env.HOST_PIN || undefined });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.map': 'application/json',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/config.json') {
    // No wsUrl: the browser falls back to its own origin + /ws.
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end('{}');
  }
  if (!fs.existsSync(dist)) {
    res.writeHead(503, { 'content-type': 'text/plain' });
    return res.end('web/dist not built. Run `npm run build` (or use `npm run dev` for Vite with hot reload).');
  }
  let file = path.join(dist, path.normalize(url.pathname));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  const headers: Record<string, string | number> = {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  };
  // Byte ranges, as S3/CloudFront do: Safari refuses to play video without them.
  const size = fs.statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const id = randomUUID();
  sockets.set(id, ws);
  ws.on('message', (data) => core.onMessage(id, data.toString()).catch(console.error));
  ws.on('close', () => {
    sockets.delete(id);
    core.onDisconnect(id).catch(console.error);
  });
});

server.listen(port, () => {
  console.log(`Spatial Quiz local server`);
  console.log(`  site    http://localhost:${port}   (serves web/dist${fs.existsSync(dist) ? '' : ' - not built yet'})`);
  console.log(`  socket  ws://localhost:${port}/ws`);
  console.log(`  tunnel  ngrok http ${port}   then open <ngrok-url>/host`);
});
