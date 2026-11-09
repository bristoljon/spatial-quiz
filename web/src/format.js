import { zonesFor, zoneAt, rangeValue, xyValue, wagerValue } from '../../shared/spatial.js';

// What a position "means" for a question, as a short label.
export function describe(q, p, { double = false } = {}) {
  if (!q || !p || p.x === null || p.x === undefined) return null;
  switch (q.type) {
    case 'choice': {
      const z = zoneAt(zonesFor(q.options), p);
      return z ? q.options.find((o) => o.id === z.id)?.text ?? '' : 'Nowhere';
    }
    case 'range': return fmt(rangeValue(q, p), q.unit);
    case 'xy': { const v = xyValue(q, p); return `${fmt(v.x)} · ${fmt(v.y)}`; }
    case 'wager': { const { side, stake } = wagerValue(p); const pts = Math.round(q.points * stake); return `${q[side].text} · ${pts === 0 ? 'nothing at stake' : `win ${double ? pts * 2 : pts} or lose ${pts}`}`; }
    default: return null;
  }
}

export function describeAnswer(q, reveal) {
  if (!q || !reveal) return '';
  switch (q.type) {
    case 'choice': return q.options.find((o) => o.id === reveal.answer)?.text ?? '';
    case 'range': return fmt(reveal.answer, q.unit);
    case 'xy': return `${q.axes.x.label} ${fmt(reveal.answer.x)} · ${q.axes.y.label} ${fmt(reveal.answer.y)}`;
    case 'wager': return q[reveal.answer].text;
    default: return '';
  }
}

export function fmt(n, unit = '') {
  if (n === null || n === undefined) return '';
  const s = Math.abs(n) >= 10000 ? n.toLocaleString() : String(Math.round(n * 100) / 100);
  return unit ? `${s}${unit}` : s;
}

export const signed = (n) => (n > 0 ? `+${n}` : String(n));
