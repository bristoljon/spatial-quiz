// Turns a player's final board position into a value and a score.
// Used only on the server; the browser never sees q.answer.
import { zonesFor, zoneAt, rangeValue, xyValue, xyPosition, wagerValue, imageValue, answerDistance } from './spatial.js';

// Full points within `exact`, nothing at `zeroAt`, linear in between.
export function falloff(err, exact, zeroAt, points) {
  if (err <= exact) return points;
  if (err >= zeroAt) return 0;
  return Math.round(points * (1 - (err - exact) / (zeroAt - exact)));
}

// Does the clock wait for the host? Video questions always do: the host plays
// the clip, pauses it, then starts the countdown.
export const hostClock = (q) => q.type === 'video' || q.clock === 'host';

// Does the question hold the results back after the clock, so the host can
// resume the video before the reveal?
export const holdsReveal = (q) => q.type === 'video';

// Image questions: radii as fractions of the board width.
export const IMAGE_EXACT = 0.02;
export const IMAGE_ZERO_AT = 0.25;

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
    case 'image':
    case 'video': {
      const value = imageValue(q, p);
      const err = answerDistance(q, q.answer, p);
      const delta = falloff(err, q.exact ?? IMAGE_EXACT, q.zeroAt ?? IMAGE_ZERO_AT, q.points);
      return { value, delta, correct: err <= (q.exact ?? IMAGE_EXACT) };
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
    case 'image':
    case 'video': return { answer: q.answer, exact: q.exact ?? IMAGE_EXACT, zeroAt: q.zeroAt ?? IMAGE_ZERO_AT, note: q.note };
    case 'wager': return { answer: q.answer, note: q.note };
    default: return { note: q.note };
  }
}

// Strip anything a player shouldn't see before the reveal.
export function publicQuestion(q, index, total) {
  const { answer, note, exact, zeroAt, ...rest } = q;
  return { ...rest, index, total };
}

// What the Reveal power-up hands a player: just the answer, no note.
export function hintFor(q) {
  return { answer: q.answer };
}
