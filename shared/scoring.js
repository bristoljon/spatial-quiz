// Turns a player's final board position into a value and a score.
// Used only on the server; the browser never sees q.answer.
import { zonesFor, zoneAt, rangeValue, xyValue, xyPosition, wagerValue } from './spatial.js';

// Full points within `exact`, nothing at `zeroAt`, linear in between.
export function falloff(err, exact, zeroAt, points) {
  if (err <= exact) return points;
  if (err >= zeroAt) return 0;
  return Math.round(points * (1 - (err - exact) / (zeroAt - exact)));
}

// Returns { value, delta, correct } for one player, or null if they never placed.
export function scorePosition(q, p) {
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  switch (q.type) {
    case 'choice': {
      const zone = zoneAt(zonesFor(q.options), p);
      const correct = !!zone && zone.id === q.answer;
      return { value: zone ? zone.id : null, delta: correct ? q.points : 0, correct };
    }
    case 'range': {
      const value = rangeValue(q, p);
      const err = Math.abs(value - q.answer);
      const delta = falloff(err, q.exact ?? 0, q.zeroAt, q.points);
      return { value, delta, correct: err <= (q.exact ?? 0) };
    }
    case 'xy': {
      const value = xyValue(q, p);
      const target = xyPosition(q, q.answer);
      // Distance in board space so a diagonal miss costs the same as a straight one.
      const err = Math.hypot(p.x - target.x, p.y - target.y);
      const delta = falloff(err, q.exact ?? 0.03, q.zeroAt ?? 0.35, q.points);
      return { value, delta, correct: err <= (q.exact ?? 0.03) };
    }
    case 'wager': {
      const { side, stake } = wagerValue(p);
      const correct = side === q.answer;
      const staked = Math.round(q.points * stake);
      return { value: { side, stake: Math.round(stake * 100) }, delta: correct ? staked : (staked === 0 ? 0 : -staked), correct };
    }
    default:
      return null;
  }
}

// What the browser is allowed to know about the answer once revealed.
export function revealFor(q) {
  switch (q.type) {
    case 'choice': return { answer: q.answer, note: q.note };
    case 'range': return { answer: q.answer, exact: q.exact ?? 0, zeroAt: q.zeroAt, note: q.note };
    case 'xy': return { answer: q.answer, exact: q.exact ?? 0.03, zeroAt: q.zeroAt ?? 0.35, note: q.note };
    case 'wager': return { answer: q.answer, note: q.note };
    default: return { note: q.note };
  }
}

// Strip anything a player shouldn't see before the reveal.
export function publicQuestion(q, index, total) {
  const { answer, note, exact, zeroAt, ...rest } = q;
  return { ...rest, index, total };
}
