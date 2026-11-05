import { useEffect, useState } from 'react';

export default function Timer({ endsAt, timeLimit, now, big = false }) {
  const [left, setLeft] = useState(() => Math.max(0, (endsAt - now()) / 1000));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, (endsAt - now()) / 1000)), 100);
    return () => clearInterval(id);
  }, [endsAt, now]);
  const frac = timeLimit ? Math.min(1, left / timeLimit) : 0;
  const urgent = left <= 5;
  return (
    <div className={`timer ${big ? 'big' : ''} ${urgent ? 'urgent' : ''}`}>
      <div className="bar" style={{ transform: `scaleX(${frac})` }} />
      <span className="secs">{Math.ceil(left)}</span>
    </div>
  );
}
