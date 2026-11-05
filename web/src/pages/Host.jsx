import { useEffect, useState, useCallback, useMemo } from 'react';
import QRCode from 'qrcode';
import { useRoom } from '../useRoom.js';
import Board from '../components/Board.jsx';
import Timer from '../components/Timer.jsx';
import Avatar from '../components/Avatar.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import { describeAnswer } from '../format.js';

const KEY = 'sq:host';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };

export default function Host() {
  const [creds, setCreds] = useState(load);
  const [pin, setPin] = useState('');

  const onOpen = useCallback((send) => {
    const c = load();
    if (c) send({ type: 'host:join', code: c.code, token: c.token });
  }, []);
  const onMessage = useCallback((msg) => {
    if (msg.type === 'host:ok') {
      const c = { code: msg.code, token: msg.token };
      localStorage.setItem(KEY, JSON.stringify(c));
      setCreds(c);
    } else if (msg.type === 'error' && msg.fatal) {
      localStorage.removeItem(KEY);
      setCreds(null);
    }
  }, []);

  const { status, state, send, now, lastError, clearError } = useRoom({ onOpen, onMessage });
  const phase = state?.room.phase;

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space' || e.key === 'ArrowRight') { e.preventDefault(); if (phase !== 'question') send({ type: 'host:next' }); }
      if (e.key === 'e' && phase === 'question') send({ type: 'host:end' });
      if (e.key === 'f') document.documentElement.requestFullscreen?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, send]);

  if (!creds || !state) {
    return (
      <main className="host centre">
        <h1 className="brand">Spatial Quiz</h1>
        <p className="muted">Big screen &amp; controls</p>
        {creds ? (
          <p className="muted">Reconnecting to room {creds.code}…</p>
        ) : (
          <form className="card" onSubmit={(e) => { e.preventDefault(); clearError(); send({ type: 'host:create', pin }); }}>
            <label>Host PIN <span className="muted">(if one is set)</span>
              <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="optional" autoComplete="off" />
            </label>
            <button className="primary" disabled={status !== 'open'}>Create room</button>
            {lastError && <p className="error">{lastError}</p>}
          </form>
        )}
        <Status status={status} />
      </main>
    );
  }

  const { room, question: q, players, reveal, quiz } = state;
  const placed = players.filter((p) => p.x !== null).length;

  return (
    <main className={`host phase-${room.phase}`}>
      <header className="topbar">
        <span className="brand">{quiz.title}</span>
        <span className="code">Join at <b>{location.host}</b> · code <b>{room.code}</b></span>
        <Status status={status} />
      </header>

      {room.phase === 'lobby' && <Lobby room={room} players={players} onStart={() => send({ type: 'host:start' })} />}

      {(room.phase === 'question' || room.phase === 'reveal') && q && (
        <section className="stage">
          <div className="question-head">
            <span className="qnum">Q{q.index + 1}/{q.total} · {q.points} pts</span>
            <h2>{q.prompt}</h2>
            {room.phase === 'question' && <Timer endsAt={room.endsAt} timeLimit={q.timeLimit} now={now} big />}
          </div>
          <div className="stage-body">
            <Board question={q} players={players} reveal={reveal} size="lg" />
            <aside className="side">
              {room.phase === 'question' ? (
                <>
                  <div className="stat"><b>{placed}</b> / {players.length} placed</div>
                  <button onClick={() => send({ type: 'host:end' })}>End now <kbd>E</kbd></button>
                </>
              ) : (
                <>
                  <div className="answer-card">
                    <div className="muted">Answer</div>
                    <div className="answer">{describeAnswer(q, reveal)}</div>
                    {reveal?.note && <p className="note">{reveal.note}</p>}
                  </div>
                  <Leaderboard players={players} limit={8} showDelta />
                  <button className="primary" onClick={() => send({ type: 'host:next' })}>
                    {q.index + 1 >= q.total ? 'Final scores' : 'Next question'} <kbd>␣</kbd>
                  </button>
                </>
              )}
            </aside>
          </div>
        </section>
      )}

      {room.phase === 'final' && (
        <section className="final">
          <h2>Final scores</h2>
          <Podium players={players} />
          <Leaderboard players={players} />
          <button onClick={() => send({ type: 'host:reset' })}>Back to lobby</button>
        </section>
      )}
    </main>
  );
}

function Lobby({ room, players, onStart }) {
  const joinUrl = useMemo(() => `${location.origin}/?c=${room.code}`, [room.code]);
  const [qr, setQr] = useState('');
  useEffect(() => { QRCode.toDataURL(joinUrl, { margin: 1, width: 320, color: { dark: '#0f1020', light: '#ffffff' } }).then(setQr); }, [joinUrl]);
  return (
    <section className="lobby">
      <div className="join-panel">
        <div className="big-code">{room.code}</div>
        <div className="join-url">{joinUrl.replace(/^https?:\/\//, '')}</div>
        {qr && <img className="qr" src={qr} alt="Join QR code" />}
        <button className="primary" onClick={onStart} disabled={players.length === 0}>Start <kbd>␣</kbd></button>
      </div>
      <div className="lobby-players">
        <h3>{players.length} {players.length === 1 ? 'player' : 'players'}</h3>
        <div className="avatar-grid">
          {players.map((p) => <div key={p.id} className="lobby-player"><Avatar player={p} size="md" /><span>{p.name}</span></div>)}
          {players.length === 0 && <p className="muted">Waiting for people to join…</p>}
        </div>
      </div>
    </section>
  );
}

function Podium({ players }) {
  const [first, second, third] = players;
  const step = (p, place) => p && (
    <div className={`step p${place}`}>
      <Avatar player={p} size="lg" />
      <div className="name">{p.name}</div>
      <div className="score">{p.score}</div>
    </div>
  );
  return <div className="podium">{step(second, 2)}{step(first, 1)}{step(third, 3)}</div>;
}

function Status({ status }) {
  return <span className={`status ${status}`} title={status}>{status === 'open' ? 'live' : status}</span>;
}
