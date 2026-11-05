// POST /api/join {code, name, pid?, token?} -> {pid, token, name}
import { store, keys, cleanCode, token, sha, json, readBody } from '../../shared/store.js';

export default async (req) => {
  const body = await readBody(req);
  const code = cleanCode(body.code);
  const s = store();
  const state = code ? await s.get(keys.state(code), { type: 'json' }) : null;
  if (!state) return json({ error: 'No quiz with that code' }, 404);

  // rejoin with saved credentials (page refresh, phone locked etc.)
  if (body.pid && body.token) {
    const p = await s.get(keys.player(code, String(body.pid).slice(0, 40)), { type: 'json' });
    if (p && p.tokenHash === sha(body.token)) return json({ pid: p.pid, token: body.token, name: p.name, code });
  }

  const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!name) return json({ error: 'Pick a team name' }, 400);
  if (state.phase === 'end') return json({ error: 'This quiz has finished' }, 400);

  const pid = token(6);
  const t = token();
  await s.setJSON(keys.player(code, pid), { pid, name, tokenHash: sha(t), joinedAt: Date.now() });
  return json({ pid, token: t, name, code });
};

export const config = { path: '/api/join', method: 'POST' };
