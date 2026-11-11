import { useState, useCallback, useRef } from 'react';

// Collects short-lived board effects from socket messages and drops them
// after `ttl` ms. Returns [fx, onMessage].
export function useFx(ttl = 700) {
  const [fx, setFx] = useState([]);
  const n = useRef(0);
  const onMessage = useCallback((msg) => {
    if (msg.type !== 'bump') return;
    const key = ++n.current;
    setFx((list) => [...list, { key, type: 'bump', x: msg.x, y: msg.y }]);
    setTimeout(() => setFx((list) => list.filter((f) => f.key !== key)), ttl);
  }, [ttl]);
  return [fx, onMessage];
}
