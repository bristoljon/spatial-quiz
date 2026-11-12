import { zonesFor, zoneAt, rangeValue, xyValue, wagerValue, imageValue, imageFraction, media } from '../../shared/spatial.js';

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
    case 'image':
    case 'video': {
      const v = imageValue(q, p);
      if (!v.inside) return 'Off the picture';
      return media(q).bounds ? latLon(v.lat, v.lon) : `${Math.round(v.x * 100)}% across · ${Math.round(v.y * 100)}% down`;
    }
    default: return null;
  }
}

// 27.1°S 109.4°W
export function latLon(lat, lon) {
  const d = (v) => Math.abs(Math.round(v * 10) / 10);
  return `${d(lat)}°${lat < 0 ? 'S' : 'N'} ${d(lon)}°${lon < 0 ? 'W' : 'E'}`;
}

// What to call an image answer: its label, or its coordinates.
export function describePoint(q, a) {
  if (!a) return '';
  if (a.label) return a.label;
  if (a.box) return 'In the box';
  if (typeof a.lat === 'number') return latLon(a.lat, a.lon);
  const f = imageFraction(q, a);
  return `${Math.round(f.x * 100)}% across · ${Math.round(f.y * 100)}% down`;
}

export function describeAnswer(q, reveal) {
  if (!q || !reveal) return '';
  switch (q.type) {
    case 'choice': return q.options.find((o) => o.id === reveal.answer)?.text ?? '';
    case 'range': return fmt(reveal.answer, q.unit);
    case 'xy': return `${q.axes.x.label} ${fmt(reveal.answer.x)} · ${q.axes.y.label} ${fmt(reveal.answer.y)}`;
    case 'wager': return q[reveal.answer].text;
    case 'image':
    case 'video': return describePoint(q, reveal.answer);
    default: return '';
  }
}

export function fmt(n, unit = '') {
  if (n === null || n === undefined) return '';
  const s = Math.abs(n) >= 10000 ? n.toLocaleString() : String(Math.round(n * 100) / 100);
  return unit ? `${s}${unit}` : s;
}

export const signed = (n) => (n > 0 ? `+${n}` : String(n));
