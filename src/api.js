// Transport layer. Everything real-time goes through here, so swapping
// polling for websockets (Ably, PartyKit...) later only touches this file.
import { useEffect, useRef, useState, useCallback } from 'react';

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  host: (body) => post('/api/host', body),
  join: (body) => post('/api/join', body),
  answer: (body) => post('/api/answer', body),
  state: async (code) => {
    const res = await fetch(`/api/state/${code}`, { cache: 'no-store' });
    if (res.status === 404) throw Object.assign(new Error('Room not found'), { notFound: true });
    if (!res.ok) throw new Error('Connection problem');
    return res.json();
  },
};

// ---- local storage helpers (wrapped: private mode can throw) ----
export const saved = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// Server clock offset, so countdowns agree across devices.
let offset = 0;
export const serverNow = () => Date.now() + offset;
function syncClock(state) {
  if (state?.serverNow) offset = offset * 0.7 + (state.serverNow - Date.now()) * 0.3;
}

// Poll the public room state. Returns [state, error, push] where push lets
// the host apply the state returned from its own actions immediately.
export function useRoomState(code, interval = 1000) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const latest = useRef(0);

  const push = useCallback((s) => {
    if (!s) return;
    syncClock(s);
    if ((s.v || 0) >= latest.current) {
      latest.current = s.v || 0;
      setState(s);
    }
  }, []);

  useEffect(() => {
    if (!code) return undefined;
    let stop = false;
    let timer;
    let fails = 0;
    const tick = async () => {
      if (document.hidden) { timer = setTimeout(tick, interval * 2); return; }
      try {
        const s = await api.state(code);
        if (stop) return;
        fails = 0;
        setError(null);
        push(s);
      } catch (e) {
        if (stop) return;
        fails++;
        setError(e);
        if (e.notFound) return; // stop polling a dead room
      }
      timer = setTimeout(tick, fails ? Math.min(interval * 2 ** fails, 8000) : interval);
    };
    tick();
    const onVis = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [code, interval, push]);

  return [state, error, push];
}

// Re-render every `ms` for countdowns.
export function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function secondsLeft(state) {
  if (!state?.closesAt || state.phase !== 'question') return 0;
  return Math.max(0, (state.closesAt - serverNow()) / 1000);
}
