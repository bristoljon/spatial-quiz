// Power-ups. One of each per player per round.
export const POWERS = [
  { id: 'invisible', icon: '👻', name: 'Invisibility', key: '1', desc: 'Hide your avatar from everyone for this question.' },
  { id: 'reveal', icon: '🔍', name: 'Reveal', key: '2', desc: 'See the real answer on your board.' },
  { id: 'double', icon: '⚡', name: 'Double down', key: '3', desc: 'Double any points you earn this question. Losses stay as they are.' },
  { id: 'possess', icon: '🕹️', name: 'Possess', key: '4', targeted: true, desc: 'Take control of someone. Drag them wherever you like; where you drop them, they stay locked until the reveal. Your own avatar is frozen until you drop them.' },
  { id: 'mirror', icon: '🪞', name: 'Mirror', key: '5', desc: 'Everyone else sees your avatar reflected through the centre of the board.' },
  { id: 'shield', icon: '🛡️', name: 'Shield', key: '6', desc: "You can't be possessed this question." },
];
export const POWER_IDS = POWERS.map((p) => p.id);

// player.powers = { [id]: { round, q } } recording where each was last used.
export function powerStatus(powers, id, round, qIndex) {
  const used = powers?.[id];
  if (!used) return 'available';
  if (used.q === qIndex) return 'active';
  if (used.round === round) return 'used';
  return 'available';
}

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
