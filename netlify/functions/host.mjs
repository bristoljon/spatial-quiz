// POST /api/host {action, code?, hostKey?, ...}
// The host is the single source of truth: every phase change goes through here.
import { store, keys, cleanCode, roomCode, token, sha, json, readBody, readAll } from '../../shared/store.js';
import { quiz } from '../../shared/quiz.js';
import { steps, roundInfo, publicQuestion, revealInfo, score, answerStats } from '../../shared/engine.js';

export default async (req) => {
  const body = await readBody(req);
  const s = store();

  if (body.action === 'create') return create(s, body);

  const code = cleanCode(body.code);
  const host = code ? await s.get(keys.host(code), { type: 'json' }) : null;
  if (!host) return json({ error: 'Room not found' }, 404);
  if (host.keyHash !== sha(body.hostKey)) return json({ error: 'Not the host of this room' }, 403);

  if (body.action === 'status') return status(s, code);

  // all other actions mutate state: read-modify-write guarded by etag
  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = await s.getWithMetadata(keys.state(code), { type: 'json' });
    if (!entry) return json({ error: 'Room not found' }, 404);
    const state = entry.data;
    let next;
    try {
      next = await apply(s, code, state, body);
    } catch (e) {
      return json({ error: e.message }, 400);
    }
    next.v = (state.v || 0) + 1;
    const { modified } = await s.setJSON(keys.state(code), next, { onlyIfMatch: entry.etag });
    if (modified) return json({ state: { ...next, serverNow: Date.now() } });
  }
  return json({ error: 'Busy, try again' }, 409);
};

export const config = { path: '/api/host', method: 'POST' };

// ---------------------------------------------------------------------------

async function create(s, body) {
  const pin = Netlify.env.get('HOST_PIN');
  if (pin && String(body.pin || '') !== pin) return json({ error: 'Wrong host PIN' }, 403);
  const hostKey = token();
  for (let i = 0; i < 8; i++) {
    const code = roomCode();
    const { modified } = await s.setJSON(keys.host(code), { keyHash: sha(hostKey), createdAt: Date.now() }, { onlyIfNew: true });
    if (!modified) continue;
    const state = {
      v: 1, code, seed: token(4), title: quiz.title, subtitle: quiz.subtitle,
      phase: 'lobby', r: -1, qi: -1, round: null, question: null,
      totalQuestions: steps.length, rounds: quiz.rounds.map((r) => r.title),
      players: [], answered: 0, scores: {}, last: {}, reveal: null, leaderboard: [],
    };
    await s.setJSON(keys.state(code), state);
    return json({ code, hostKey, state: { ...state, serverNow: Date.now() } });
  }
  return json({ error: 'Could not allocate a room code' }, 500);
}

// Host polls this every ~1.5s: who's joined and how many have answered.
// Folds changes into the public state so phones and screens see them.
async function status(s, code) {
  const [players, answers, entry] = await Promise.all([
    readAll(s, keys.players(code)),
    (async () => {
      const st = await s.get(keys.state(code), { type: 'json' });
      if (!st || !st.question) return [];
      const { blobs } = await s.list({ prefix: keys.answers(code, st.question.id) });
      return blobs.map((b) => b.key.split('/').pop());
    })(),
    s.getWithMetadata(keys.state(code), { type: 'json' }),
  ]);
  const state = entry.data;
  const plist = players.sort((a, b) => a.joinedAt - b.joinedAt).map((p) => ({ pid: p.pid, name: p.name }));
  const answered = state.phase === 'question' || state.phase === 'locked' ? answers.length : state.answered;
  const changed = plist.length !== state.players.length
    || plist.some((p, i) => state.players[i]?.pid !== p.pid || state.players[i]?.name !== p.name)
    || answered !== state.answered;
  let out = state;
  if (changed) {
    out = { ...state, players: plist, answered, v: (state.v || 0) + 1 };
    // keep leaderboard names fresh
    if (out.leaderboard?.length) out.leaderboard = board(out, out.last);
    const { modified } = await s.setJSON(keys.state(code), out, { onlyIfMatch: entry.etag });
    if (!modified) out = state; // host action won the race; pick it up next poll
  }
  return json({ state: { ...out, serverNow: Date.now() }, answeredBy: answers });
}

function openQuestion(state, qi) {
  const step = steps[qi];
  if (!step) throw new Error('No such question');
  const now = Date.now();
  return {
    ...state, phase: 'question', qi, r: step.r, round: roundInfo(step.r),
    qnum: step.i + 1,
    question: publicQuestion(step.q, { seed: state.seed, stage: 0 }),
    stage: 0, openedAt: now, closesAt: now + (step.q.timeLimit || 30) * 1000,
    answered: 0, reveal: null,
  };
}

async function doReveal(s, code, state) {
  const step = steps[state.qi];
  const q = step.q;
  const answers = {};
  (await readAll(s, keys.answers(code, q.id))).forEach((a) => (answers[a.pid] = a));
  const scores = { ...state.scores };
  const last = {};
  for (const p of state.players) {
    const a = answers[p.pid];
    const res = a ? score(q, a.answer, { stage: a.stage }) : { pts: 0, ok: false };
    last[p.pid] = { ...res, answered: !!a, answer: a ? a.answer : null, stage: a ? a.stage : null };
    scores[p.pid] = (scores[p.pid] || 0) + res.pts;
  }
  const info = revealInfo(q);
  const stats = answerStats(q, answers);
  if (stats.kind === 'guesses') {
    const names = Object.fromEntries(state.players.map((p) => [p.pid, p.name]));
    stats.guesses = stats.guesses.map((g) => ({ ...g, name: names[g.pid] || '?' }));
  }
  const question = q.type === 'reveal'
    ? { ...state.question, stage: state.question.stages - 1, src: info.full }
    : state.question;
  const next = { ...state, phase: 'reveal', question, scores, last, reveal: { ...info, stats }, answered: Object.keys(answers).length };
  next.leaderboard = board(next, last);
  return next;
}

function board(state, last) {
  const rows = state.players.map((p) => ({
    pid: p.pid, name: p.name, score: state.scores[p.pid] || 0, delta: last?.[p.pid]?.pts || 0,
  }));
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  rows.forEach((r, i) => { if (r.score !== prev) { rank = i + 1; prev = r.score; } r.rank = rank; });
  return rows;
}

async function apply(s, code, state, body) {
  switch (body.action) {
    case 'next': {
      switch (state.phase) {
        case 'lobby':
          return { ...state, phase: 'roundIntro', r: 0, round: roundInfo(0), question: null, reveal: null };
        case 'roundIntro': {
          const qi = steps.findIndex((st) => st.r === state.r);
          return openQuestion(state, qi);
        }
        case 'question':
          return { ...state, phase: 'locked', closesAt: Math.min(state.closesAt || Date.now(), Date.now()) };
        case 'locked':
          return doReveal(s, code, state);
        case 'reveal':
          if (steps[state.qi].last) return { ...state, phase: 'leaderboard' };
          return openQuestion(state, state.qi + 1);
        case 'leaderboard':
          if (state.r + 1 < quiz.rounds.length) {
            return { ...state, phase: 'roundIntro', r: state.r + 1, round: roundInfo(state.r + 1), question: null, reveal: null };
          }
          return { ...state, phase: 'end' };
        default:
          return state;
      }
    }
    case 'lock':
      if (state.phase !== 'question') return state;
      return { ...state, phase: 'locked', closesAt: Math.min(state.closesAt || Date.now(), Date.now()) };
    case 'reveal':
      if (state.phase !== 'question' && state.phase !== 'locked') throw new Error('Nothing to reveal');
      return doReveal(s, code, state);
    case 'zoom': {
      if (state.phase !== 'question' || state.question?.type !== 'reveal') return state;
      const stage = Math.min((state.stage || 0) + 1, state.question.stages - 1);
      const step = steps[state.qi];
      return { ...state, stage, question: publicQuestion(step.q, { seed: state.seed, stage }) };
    }
    case 'extend': // add 15s to the clock
      if (state.phase !== 'question' && state.phase !== 'locked') return state;
      return { ...state, phase: 'question', closesAt: Math.max(state.closesAt || 0, Date.now()) + 15000 };
    case 'goto': {
      const qi = Number(body.qi);
      if (!Number.isInteger(qi) || !steps[qi]) throw new Error('No such question');
      return openQuestion(state, qi);
    }
    case 'round': {
      const r = Number(body.r);
      if (!roundInfo(r)) throw new Error('No such round');
      return { ...state, phase: 'roundIntro', r, round: roundInfo(r), question: null, reveal: null };
    }
    case 'leaderboard':
      return { ...state, phase: 'leaderboard', leaderboard: board(state, state.last) };
    case 'end':
      return { ...state, phase: 'end', leaderboard: board(state, state.last) };
    case 'adjust': { // manual score correction
      const pid = String(body.pid || '');
      if (!state.players.some((p) => p.pid === pid)) throw new Error('Unknown player');
      const scores = { ...state.scores, [pid]: (state.scores[pid] || 0) + Number(body.delta || 0) };
      const next = { ...state, scores };
      next.leaderboard = board(next, state.last);
      return next;
    }
    default:
      throw new Error('Unknown action');
  }
}
