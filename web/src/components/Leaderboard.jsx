import Avatar from './Avatar.jsx';
import { signed } from '../format.js';

export default function Leaderboard({ players, meId, limit, showDelta = false }) {
  const rows = limit ? players.slice(0, limit) : players;
  return (
    <ol className="leaderboard">
      {rows.map((p, i) => (
        <li key={p.id} className={p.id === meId ? 'me' : ''}>
          <span className="rank">{i + 1}</span>
          <Avatar player={p} size="sm" />
          <span className="name">{p.name}</span>
          {showDelta && p.result && <span className={`delta ${p.result.delta > 0 ? 'pos' : p.result.delta < 0 ? 'neg' : ''}`}>{signed(p.result.delta)}</span>}
          <span className="score">{p.score}</span>
        </li>
      ))}
    </ol>
  );
}
