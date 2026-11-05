// POST /api/answer {code, pid, token, qid, answer}
import { store, keys, cleanCode, sha, json, readBody } from '../../shared/store.js';

export default async (req) => {
  const body = await readBody(req);
  const code = cleanCode(body.code);
  const pid = String(body.pid || '').slice(0, 40);
  if (!code || !pid) return json({ error: 'Bad request' }, 400);
  const s = store();
  const [state, player] = await Promise.all([
    s.get(keys.state(code), { type: 'json' }),
    s.get(keys.player(code, pid), { type: 'json' }),
  ]);
  if (!state) return json({ error: 'Room not found' }, 404);
  if (!player || player.tokenHash !== sha(body.token)) return json({ error: 'Please rejoin' }, 401);
  if (state.phase !== 'question' || !state.question || state.question.id !== body.qid) {
    return json({ error: 'Too late - answers are locked' }, 409);
  }
  // small grace period for network latency
  if (state.closesAt && Date.now() > state.closesAt + 1500) {
    return json({ error: 'Too late - time is up' }, 409);
  }

  const answer = sanitize(body.answer);
  const rec = { pid, answer, at: Date.now(), stage: state.stage || 0 };
  const key = keys.answer(code, body.qid, pid);
  if (state.question.type === 'reveal') {
    // photo reveal: first answer is final (points depend on when you lock in)
    const { modified } = await s.setJSON(key, rec, { onlyIfNew: true });
    if (!modified) return json({ error: 'Already locked in' }, 409);
  } else {
    await s.setJSON(key, rec);
  }
  return json({ ok: true, stage: rec.stage });
};

function sanitize(a) {
  if (a === null || a === undefined) return null;
  if (typeof a === 'number' || typeof a === 'boolean') return a;
  if (typeof a === 'string') return a.slice(0, 120);
  if (Array.isArray(a)) return a.slice(0, 20).map((x) => (typeof x === 'string' ? x.slice(0, 120) : x));
  if (typeof a === 'object') {
    const o = {};
    Object.keys(a).slice(0, 20).forEach((k) => { if (typeof a[k] === 'string') o[k.slice(0, 40)] = a[k].slice(0, 120); });
    return o;
  }
  return null;
}

export const config = { path: '/api/answer', method: 'POST' };
