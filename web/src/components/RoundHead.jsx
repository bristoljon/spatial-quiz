// "Round 2 · Harder · Q1/4" plus a replenish note on a round's first question.
export default function RoundHead({ q, phase }) {
  if (!q) return null;
  return (
    <div className="round-head">
      <span className="qnum">Round {q.round + 1} · {q.roundTitle} · Q{q.indexInRound + 1}/{q.roundTotal} · {q.points} pts</span>
      {q.indexInRound === 0 && phase === 'question' && <span className="pill">New round · power-ups replenished</span>}
    </div>
  );
}
