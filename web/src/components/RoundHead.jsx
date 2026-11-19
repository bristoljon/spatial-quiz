// "Round 2 · Harder · Q1/4" plus a replenish note on a round's first question
// and a reminder when the round is a practice one.
export default function RoundHead({ q, phase, replenished = false }) {
  if (!q) return null;
  return (
    <div className="round-head">
      <span className="qnum">Round {q.round + 1} · {q.roundTitle} · Q{q.indexInRound + 1}/{q.roundTotal} · {q.points} pts</span>
      {q.practice && <span className="pill practice" title="Scores go back to zero when this round ends">🎓 Practice · doesn't count</span>}
      {replenished && (phase === 'question' || phase === 'intro') && <span className="pill">✨ Power-ups replenished</span>}
    </div>
  );
}
