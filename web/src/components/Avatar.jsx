import { graphemes } from '../../../shared/avatar.js';

// A coloured disc with a 1–2 character tag. One character renders big and centred.
export default function Avatar({ player, size = 'md', me = false, dim = false, badge = null, label = null, style }) {
  const n = graphemes(player.tag || '?').length;
  return (
    <div
      className={`avatar ${size} ${n <= 1 ? 'one' : 'two'} ${me ? 'me' : ''} ${dim ? 'dim' : ''} ${player.online === false ? 'offline' : ''}`}
      style={{ ...style, '--c': player.color || '#9ea2c9' }}
      title={player.name}
    >
      <span className="tag">{player.tag || '?'}</span>
      {badge !== null && <span className={`badge ${badge > 0 ? 'pos' : badge < 0 ? 'neg' : 'zero'}`}>{badge > 0 ? `+${badge}` : badge}</span>}
      {label && <span className="label">{label}</span>}
    </div>
  );
}
