import { POWERS } from '../../../shared/powers.js';

// One of each per round. Status comes from the server: available | active | used.
export default function PowerBar({ status, onUse, disabled, arming = null }) {
  if (!status) return null;
  return (
    <div className="power-bar">
      {POWERS.map((p) => {
        const st = status[p.id] || 'used';
        const armed = arming === p.id;
        return (
          <button
            key={p.id}
            type="button"
            className={`power ${st} ${armed ? 'armed' : ''}`}
            disabled={disabled || st !== 'available'}
            onClick={() => onUse(p.id)}
            title={`${p.desc}${st === 'used' ? ' (used this round)' : ''}`}
          >
            <span className="icon">{p.icon}</span>
            <span className="pname">{p.name}</span>
            <span className="pstate">{armed ? 'pick…' : st === 'active' ? 'ON' : st === 'used' ? 'used' : <kbd>{p.key}</kbd>}</span>
          </button>
        );
      })}
    </div>
  );
}
