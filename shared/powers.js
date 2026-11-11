// Power-ups. One of each per player per round.
export const POWERS = [
  { id: 'invisible', icon: '👻', name: 'Invisibility', key: '1', desc: 'Hide your avatar from everyone for this question.' },
  { id: 'reveal', icon: '🔍', name: 'Reveal', key: '2', desc: 'See the real answer on your board.' },
  { id: 'double', icon: '⚡', name: 'Double down', key: '3', desc: 'Double any points you earn this question. Losses stay as they are.' },
  { id: 'possess', icon: '🕹️', name: 'Possess', key: '4', targeted: true, desc: 'Take control of someone. Drag them wherever you like; where you drop them, they stay locked until the reveal. Your own avatar is frozen until you drop them.' },
  { id: 'mirror', icon: '🪞', name: 'Mirror', key: '5', desc: 'Everyone else sees your avatar reflected through the centre of the board.' },
  { id: 'shield', icon: '🛡️', name: 'Shield', key: '6', desc: "You can't be possessed or bumped this question." },
  { id: 'bump', icon: '💥', name: 'Bump', key: '7', needsPlacement: true, desc: 'Shove everyone near you out of the way. The closer they are, the further they fly. You need to be on the board first.' },
];

// Where everyone ends up after `from` bumps. Push is radial, strongest for
// the closest, zero at the edge of the radius. Returns [{ id, x, y }].
export function bumpTargets(from, others, { radius = 0.2, push = 0.25 } = {}) {
  const out = [];
  for (const o of others) {
    if (o.x === null || o.x === undefined) continue;
    let dx = o.x - from.x, dy = o.y - from.y;
    let d = Math.hypot(dx, dy);
    if (d >= radius) continue;
    if (d < 1e-6) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
    const k = push * (1 - d / radius) / d;
    out.push({ id: o.id, x: clamp(o.x + dx * k), y: clamp(o.y + dy * k) });
  }
  return out;
}
const clamp = (v) => Math.max(0.02, Math.min(0.98, v));
export const POWER_IDS = POWERS.map((p) => p.id);

// player.powers = { [id]: { q } } recording the question each was last used on.
// `replenishedAt` is the question index of the last replenish; anything used
// since then is spent.
export function powerStatus(powers, id, qIndex, replenishedAt) {
  const used = powers?.[id];
  if (!used) return 'available';
  if (used.q === qIndex) return 'active';
  if (used.q >= replenishedAt) return 'used';
  return 'available';
}

export const REPLENISH_LABEL = {
  never: 'One of each for the whole quiz. Spend them wisely.',
  round: 'One of each per round.',
  random: 'One of each. Every so often, at random, everyone gets theirs back.',
};

export function activePowers(powers, qIndex) {
  return POWER_IDS.filter((id) => powers?.[id]?.q === qIndex);
}

export function isActive(powers, id, qIndex) {
  return powers?.[id]?.q === qIndex;
}

// Mirror: how everyone else sees a mirrored player's position.
export function mirrored(p) {
  return { x: 1 - p.x, y: 1 - p.y };
}
