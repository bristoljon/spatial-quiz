import { useState } from 'react';
import { api, saved, useRoomState } from './api.js';
import Host from './pages/Host.jsx';
import Play from './pages/Play.jsx';
import Stage from './components/Stage.jsx';
import { Hills } from './components/bits.jsx';

export default function App() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const [page, code] = [parts[0] || '', (parts[1] || '').toUpperCase()];
  if (page === 'host' && code) return <Host code={code} />;
  if (page === 'host') return <HostSetup />;
  if ((page === 'play' || page === 'j') && code) return <Play code={code} />;
  if (page === 'screen' && code) return <Screen code={code} />;
  return <Home />;
}

function Screen({ code }) {
  const [state, error] = useRoomState(code, 1000);
  if (error?.notFound) return <div className="stage center"><h1>Room {code} not found</h1></div>;
  return <Stage state={state} />;
}

function Home() {
  const [code, setCode] = useState('');
  const go = (e) => {
    e.preventDefault();
    const c = code.toUpperCase().replace(/[^A-Z]/g, '');
    if (c.length >= 4) window.location.href = `/play/${c}`;
  };
  return (
    <div className="phone center home">
      <div className="phone-inner">
        <p className="eyebrow">Got a room code?</p>
        <h1 className="display">Jon's Quiz App</h1>
        <form onSubmit={go} className="stack">
          <label htmlFor="code">Room code</label>
          <input id="code" className="code-in" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6} autoCapitalize="characters" autoComplete="off" placeholder="ABCD" autoFocus />
          <button className="btn primary block" disabled={code.replace(/[^A-Za-z]/g, '').length < 4}>Join</button>
        </form>
        <a className="muted small host-link" href="/host">Hosting? →</a>
      </div>
      <Hills />
    </div>
  );
}

function HostSetup() {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const last = saved.get('sq:lastHost');
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.host({ action: 'create', pin });
      saved.set(`sq:host:${r.code}`, r.hostKey);
      saved.set('sq:lastHost', r.code);
      window.location.href = `/host/${r.code}`;
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <div className="phone center home">
      <div className="phone-inner">
        <p className="eyebrow">Host</p>
        <h1 className="display">Start a quiz</h1>
        <form onSubmit={create} className="stack">
          <label htmlFor="pin">Host PIN (if set)</label>
          <input id="pin" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
          {err && <p className="error">{err}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? 'Creating…' : 'Create room'}</button>
        </form>
        {last && saved.get(`sq:host:${last}`) && <a className="btn ghost block" href={`/host/${last}`}>Resume room {last}</a>}
        <p className="muted small">Open this on the laptop you're presenting from. Players join on their phones.</p>
      </div>
      <Hills />
    </div>
  );
}
