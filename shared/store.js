import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

// One site-wide store, strongly consistent so the host's writes are seen
// immediately by the answer function.
export const store = () => getStore({ name: 'stroud-quiz', consistency: 'strong' });

export const keys = {
  state: (c) => `rooms/${c}/state`,
  host: (c) => `rooms/${c}/host`,
  player: (c, p) => `rooms/${c}/players/${p}`,
  players: (c) => `rooms/${c}/players/`,
  answer: (c, q, p) => `rooms/${c}/answers/${q}/${p}`,
  answers: (c, q) => `rooms/${c}/answers/${q}/`,
};

export const token = (n = 18) => crypto.randomBytes(n).toString('base64url');
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O
  let s = '';
  const b = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) s += A[b[i] % A.length];
  return s;
}

export const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

// Fetch every JSON blob under a prefix, in parallel.
export async function readAll(s, prefix) {
  const { blobs } = await s.list({ prefix });
  const out = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })));
  return out.filter(Boolean);
}
