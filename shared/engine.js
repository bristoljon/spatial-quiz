// Game engine shared by the Netlify Functions: flattening the quiz,
// building the player-safe view of a question, and scoring answers.
import { quiz } from './quiz.js';
import manifest from './media-manifest.js';

// ---------- flatten ----------
export const steps = [];
quiz.rounds.forEach((round, r) => {
  round.questions.forEach((q, i) => {
    steps.push({ r, i, q, last: i === round.questions.length - 1 });
  });
});

export function roundInfo(r) {
  const round = quiz.rounds[r];
  if (!round) return null;
  return { index: r, title: round.title, intro: round.intro, count: round.questions.length, total: quiz.rounds.length };
}

// ---------- media ----------
export function media(ref) {
  if (!ref || typeof ref !== 'string' || !ref.startsWith('media:')) return ref;
  const m = manifest.files[ref.slice(6)];
  return m ? m.url : null;
}

// ---------- deterministic shuffle (per room + question) ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function shuffled(arr, seed) {
  const a = arr.slice();
  let s = hash(seed) || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // never present an "order" question already solved
  if (a.length > 1 && a.every((x, i) => x === arr[i])) a.push(a.shift());
  return a;
}

// ---------- public (answer-free) view ----------
export function publicQuestion(q, { seed = '', stage = 0 } = {}) {
  const base = { id: q.id, type: q.type, prompt: q.prompt, points: q.points, timeLimit: q.timeLimit };
  if (q.image) base.image = media(q.image);
  if (q.quote) base.quote = q.quote;
  const opts = (o) => o.map((x) => ({ id: x.id, text: x.text, image: x.image ? media(x.image) : undefined }));
  switch (q.type) {
    case 'choice':
    case 'multi':
      return { ...base, options: opts(q.options) };
    case 'order':
      return { ...base, labels: q.labels, items: shuffled(q.items, seed + q.id) };
    case 'match':
      return { ...base, left: q.left, right: shuffled(q.right, seed + q.id) };
    case 'blanks':
      return { ...base, text: q.text, blanks: q.blanks.map((b) => (b.options ? { options: b.options } : {})) };
    case 'slider':
      return { ...base, min: q.min, max: q.max, step: q.step, unit: q.unit };
    case 'text':
      return base;
    case 'reveal': {
      const m = manifest.reveal[q.id];
      const stages = m ? m.stages : [];
      return {
        ...base,
        stages: stages.length,
        stage,
        src: stages[Math.min(stage, stages.length - 1)] || null,
        options: q.options ? opts(q.options) : undefined,
      };
    }
    default:
      return base;
  }
}

// What the screens show once the answer is revealed.
export function revealInfo(q) {
  const info = { note: q.note || null };
  switch (q.type) {
    case 'choice': info.answer = q.answer; break;
    case 'multi': info.answer = q.answer; break;
    case 'order': info.answer = q.answer; info.values = q.values || null; info.items = q.items; break;
    case 'match': info.answer = q.answer; break;
    case 'blanks': info.answer = q.blanks.map((b) => b.accept[0]); break;
    case 'slider': info.answer = q.answer; break;
    case 'text': info.answer = q.answer || q.accept[0]; break;
    case 'reveal': {
      const m = manifest.reveal[q.id];
      info.full = m ? m.full : null;
      info.answer = q.options ? q.answer : (q.answer || q.accept[0]);
      info.answerText = q.options ? (q.options.find((o) => o.id === q.answer) || {}).text : info.answer;
      break;
    }
  }
  return info;
}

// ---------- text matching ----------
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').replace(/[^a-z0-9 ]+/g, ' ').replace(/^the /, '').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}
export function textMatches(given, accept) {
  const g = norm(given);
  if (!g) return false;
  return accept.some((a) => {
    const n = norm(a);
    if (n === g) return true;
    const tol = n.length >= 5 ? Math.max(1, Math.floor(n.length / 6)) : 0;
    return lev(n, g) <= tol;
  });
}

// ---------- scoring ----------
// returns { pts, ok } where ok is true | false | 'partial'
export function score(q, ans, meta = {}) {
  const P = q.points || 10;
  const res = (frac) => {
    const f = Math.max(0, Math.min(1, frac));
    const pts = Math.round(P * f);
    return { pts, ok: pts >= P ? true : pts > 0 ? 'partial' : false };
  };
  if (ans === undefined || ans === null) return { pts: 0, ok: false };
  switch (q.type) {
    case 'choice': return res(ans === q.answer ? 1 : 0);
    case 'multi': {
      const picked = new Set(Array.isArray(ans) ? ans : []);
      const right = new Set(q.answer);
      let hits = 0, wrong = 0;
      picked.forEach((p) => (right.has(p) ? hits++ : wrong++));
      return res((hits - wrong) / right.size);
    }
    case 'order': {
      if (!Array.isArray(ans)) return res(0);
      let n = 0;
      q.answer.forEach((id, i) => { if (ans[i] === id) n++; });
      return res(n / q.answer.length);
    }
    case 'match': {
      const keys = Object.keys(q.answer);
      let n = 0;
      keys.forEach((k) => { if (ans && ans[k] === q.answer[k]) n++; });
      return res(n / keys.length);
    }
    case 'blanks': {
      const arr = Array.isArray(ans) ? ans : [];
      let n = 0;
      q.blanks.forEach((b, i) => { if (textMatches(arr[i], b.accept)) n++; });
      return res(n / q.blanks.length);
    }
    case 'slider': {
      const v = Number(ans);
      if (!Number.isFinite(v)) return res(0);
      const d = Math.abs(v - q.answer);
      if (d <= (q.exact || 0)) return res(1);
      return res(1 - (d - (q.exact || 0)) / ((q.zeroAt || (q.max - q.min) / 4) - (q.exact || 0)));
    }
    case 'text': return res(textMatches(ans, q.accept) ? 1 : 0);
    case 'reveal': {
      const right = q.options ? ans === q.answer : textMatches(ans, q.accept);
      if (!right) return res(0);
      const m = manifest.reveal[q.id];
      const total = m ? m.stages.length : 1;
      const st = Math.min(meta.stage || 0, total - 1);
      // stage 0 (most zoomed) = full points, final stage = 1/total... floor at 30%
      return { pts: Math.round(P * Math.max(0.3, (total - st) / total)), ok: true };
    }
    default: return res(0);
  }
}

// Aggregate stats for the reveal screen.
export function answerStats(q, answers) {
  const list = Object.values(answers);
  if (q.type === 'choice' || q.type === 'multi' || (q.type === 'reveal' && q.options)) {
    const counts = {};
    (q.options || []).forEach((o) => (counts[o.id] = 0));
    list.forEach((a) => {
      const v = a.answer;
      (Array.isArray(v) ? v : [v]).forEach((id) => { if (id in counts) counts[id]++; });
    });
    return { kind: 'counts', counts, n: list.length };
  }
  if (q.type === 'slider') {
    return { kind: 'guesses', guesses: list.map((a) => ({ pid: a.pid, v: Number(a.answer) })).filter((g) => Number.isFinite(g.v)), n: list.length };
  }
  if (q.type === 'text' || (q.type === 'reveal' && !q.options)) {
    const freq = {};
    list.forEach((a) => { const k = String(a.answer || '').trim().slice(0, 40); if (k) freq[k] = (freq[k] || 0) + 1; });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([text, c]) => ({ text, c }));
    return { kind: 'words', top, n: list.length };
  }
  return { kind: 'none', n: list.length };
}
