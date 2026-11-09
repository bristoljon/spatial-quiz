import { graphemes } from '../../../shared/avatar.js';

// A coloured disc with a 1–2 character tag. One character renders big and centred.
import { POWERS } from '../../../shared/powers.js';

export default function Avatar({ player, size = 'md', me = false, dim = false, ghost = false, badge = null, label = null, powers = null, style }) {
  const n = graphemes(player.tag || '?').length;
  return (
    <div
      className={`avatar ${size} ${n <= 1 ? 'one' : 'two'} ${me ? 'me' : ''} ${dim ? 'dim' : ''} ${ghost ? 'ghost' : ''} ${player.online === false ? 'offline' : ''}`}
      style={{ ...style, '--c': player.color || '#9ea2c9' }}
      title={player.name}
    >
      <span className="tag">{player.tag || '?'}</span>
      {badge !== null && <span className={`badge ${badge > 0 ? 'pos' : badge < 0 ? 'neg' : 'zero'}`}>{badge > 0 ? `+${badge}` : badge}</span>}
      {label && <span className="label">{label}</span>}
      {powers && powers.length > 0 && (
        <span className="powers">{powers.map((id) => <i key={id} title={POWERS.find((p) => p.id === id)?.name}>{POWERS.find((p) => p.id === id)?.icon}</i>)}</span>
      )}
    </div>
  );
}
