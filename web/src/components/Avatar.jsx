export default function Avatar({ player, size = 'md', me = false, dim = false, badge = null, label = null, style }) {
  return (
    <div className={`avatar ${size} ${me ? 'me' : ''} ${dim ? 'dim' : ''} ${player.online === false ? 'offline' : ''}`} style={style} title={player.name}>
      <span className="emoji">{player.emoji}</span>
      <span className="initials">{player.initials}</span>
      {badge !== null && <span className={`badge ${badge > 0 ? 'pos' : badge < 0 ? 'neg' : 'zero'}`}>{badge > 0 ? `+${badge}` : badge}</span>}
      {label && <span className="label">{label}</span>}
    </div>
  );
}
