// "Round 2 · Harder · Q1/4" plus a replenish note on a round's first question.
export default function RoundHead({ q, phase, replenished = false }) {
  if (!q) return null;
  return (
    <div className="round-head">
      <span className="qnum">Round {q.round + 1} · {q.roundTitle} · Q{q.indexInRound + 1}/{q.roundTotal} · {q.points} pts</span>
      {replenished && (phase === 'question' || phase === 'intro') && <span className="pill">✨ Power-ups replenished</span>}
    </div>
  );
}
