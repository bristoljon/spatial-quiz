// Avatars are a player's initials (up to 3 characters) on a coloured disc.
// Colour tells apart two players with the same initials.

export const COLORS = [
  '#ff7a59', '#ffd166', '#3ddc84', '#5ad1ff', '#a78bfa', '#f472b6',
  '#fb923c', '#22d3ee', '#a3e635', '#e879f9', '#f87171', '#60a5fa',
];

// Split into user-perceived characters (so accented letters stay whole).
export function graphemes(str) {
  const s = String(str ?? '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  }
  return Array.from(s);
}

// "Ada Lovelace" -> "AL", "Jean Paul Sartre" -> "JPS", "Mary Anne de Winter" -> "MAW",
// a single word -> its first two letters ("Bob" -> "BO").
export function initialsOf(name) {
  const parts = String(name ?? '').trim().split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return graphemes(parts[0]).slice(0, 2).join('').toUpperCase();
  const firsts = parts.map((w) => graphemes(w)[0]);
  const picked = firsts.length <= 3 ? firsts : [firsts[0], firsts[1], firsts[firsts.length - 1]];
  return picked.join('').toUpperCase();
}

// Pick the player's requested colour unless someone with the same initials
// already has it, in which case take the nearest free one.
export function assignColor(requested, tag, others) {
  const taken = new Set(others.filter((o) => o.tag === tag).map((o) => o.color));
  const start = COLORS.includes(requested) ? COLORS.indexOf(requested) : Math.floor(Math.random() * COLORS.length);
  for (let i = 0; i < COLORS.length; i++) {
    const c = COLORS[(start + i) % COLORS.length];
    if (!taken.has(c)) return c;
  }
  return COLORS[start];
}
