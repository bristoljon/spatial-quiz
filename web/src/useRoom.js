import { useEffect, useRef, useState, useCallback } from 'react';
import { getWsUrl } from './config.js';

// One socket, auto-reconnect, server clock offset, and the latest room
// state. `onOpen` is called on every (re)connect so the page can re-join.
export function useRoom({ onOpen, onMessage } = {}) {
  const [status, setStatus] = useState('connecting'); // connecting | open | closed
  const [state, setState] = useState(null);
  const [lastError, setLastError] = useState(null);
  const wsRef = useRef(null);
  const offsetRef = useRef(0);
  const handlers = useRef({ onOpen, onMessage });
  handlers.current = { onOpen, onMessage };

  useEffect(() => {
    let ws, closed = false, retry = 0, pingTimer;

    const connect = async () => {
      let url;
      try { url = await getWsUrl(); } catch (e) { setLastError(String(e.message || e)); return; }
      setStatus('connecting');
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus('open');
        setLastError(null);
        handlers.current.onOpen?.(send);
        const ping = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        ping();
        pingTimer = setInterval(ping, 15000);
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'pong') {
          const rtt = Date.now() - msg.t;
          offsetRef.current = msg.serverNow + rtt / 2 - Date.now();
          return;
        }
        if (msg.type === 'state') {
          // Positions arrive separately; merge the latest ones into the new snapshot
          // unless the snapshot itself carries positions (reveal) or clears them.
          setState((prev) => {
            if (!prev || prev.room.phase !== msg.room.phase || prev.room.qIndex !== msg.room.qIndex) return msg;
            const byId = new Map(prev.players.map((p) => [p.id, p]));
            return {
              ...msg,
              players: msg.players.map((p) => {
                const old = byId.get(p.id);
                return old && !p.hidden && p.x === null && old.x !== null && msg.room.phase === 'question' ? { ...p, x: old.x, y: old.y } : p;
              }),
            };
          });
        } else if (msg.type === 'pos') {
          setState((prev) => prev && { ...prev, players: prev.players.map((p) => (p.id === msg.id ? { ...p, x: msg.x, y: msg.y } : p)) });
        } else if (msg.type === 'error') {
          setLastError(msg.message);
        }
        handlers.current.onMessage?.(msg, send);
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        if (closed) return;
        setStatus('closed');
        setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
      };
      ws.onerror = () => ws.close();
    };

    const send = (msg) => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    };

    connect();
    return () => { closed = true; clearInterval(pingTimer); ws?.close(); };
  }, []);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }, []);
  const now = useCallback(() => Date.now() + offsetRef.current, []);
  const clearError = useCallback(() => setLastError(null), []);

  return { status, state, send, now, lastError, clearError };
}
