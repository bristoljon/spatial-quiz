// Power-ups. One of each per player per round.
export const POWERS = [
  { id: 'invisible', icon: '👻', name: 'Invisibility', key: '1', desc: 'Hide your avatar from everyone for this question.' },
  { id: 'reveal', icon: '🔍', name: 'Reveal', key: '2', desc: 'See the real answer on your board.' },
  { id: 'double', icon: '⚡', name: 'Double down', key: '3', desc: 'Double any points you earn this question. Losses stay as they are.' },
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
