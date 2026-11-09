// Avatars are a 1–2 character tag (letters, digits or emoji) on a coloured
// disc. Colour tells apart two players who picked the same characters.

export const COLORS = [
  '#ff7a59', '#ffd166', '#3ddc84', '#5ad1ff', '#a78bfa', '#f472b6',
  '#fb923c', '#22d3ee', '#a3e635', '#e879f9', '#f87171', '#60a5fa',
];

// Split into user-perceived characters so an emoji counts as one.
export function graphemes(str) {
  const s = String(str ?? '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  }
  return Array.from(s);
}

export function normaliseTag(tag, fallbackName = '') {
  const g = graphemes(String(tag ?? '').trim()).filter((c) => !/\s/.test(c)).slice(0, 2);
  if (g.length) return g.join('');
  return initialsOf(fallbackName) || '?';
}

export function initialsOf(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const s = parts.length >= 2 ? graphemes(parts[0])[0] + graphemes(parts[parts.length - 1])[0] : graphemes(parts[0]).slice(0, 2).join('');
  return s.toUpperCase();
}

// Pick the player's requested colour unless someone with the same tag already
// has it, in which case take the nearest free one.
export function assignColor(requested, tag, others) {
  const taken = new Set(others.filter((o) => o.tag === tag).map((o) => o.color));
  const start = COLORS.includes(requested) ? COLORS.indexOf(requested) : Math.floor(Math.random() * COLORS.length);
  for (let i = 0; i < COLORS.length; i++) {
    const c = COLORS[(start + i) % COLORS.length];
    if (!taken.has(c)) return c;
  }
  return COLORS[start];
}
