import { useState, useCallback } from 'react';
import { useRoom } from '../useRoom.js';
import Board from '../components/Board.jsx';
import Timer from '../components/Timer.jsx';
import Avatar from '../components/Avatar.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import { describeAnswer, signed } from '../format.js';

const KEY = 'sq:player';
const EMOJI = ['🦊', '🐸', '🐙', '🦄', '🐝', '🦖', '🐧', '🦉', '🐢', '🦩', '🐳', '🦔', '🍕', '🌮', '🍩', '🧀', '🚀', '🛸', '🎸', '🎲', '🔥', '⚡', '🌈', '🍄'];
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };

export default function Player() {
  const [saved, setSaved] = useState(load);
  const params = new URLSearchParams(location.search);
  const [code, setCode] = useState((params.get('c') || saved?.code || '').toUpperCase());
  const [name, setName] = useState(saved?.name || '');
  const [emoji, setEmoji] = useState(saved?.emoji || EMOJI[Math.floor(Math.random() * EMOJI.length)]);
  const [joining, setJoining] = useState(false);

  const onOpen = useCallback((send) => {
    const s = load();
    if (s?.playerId) send({ type: 'player:join', code: s.code, playerId: s.playerId, name: s.name, emoji: s.emoji });
  }, []);
  const onMessage = useCallback((msg) => {
    if (msg.type === 'player:ok') {
      const s = { ...(load() || {}), code: msg.code, playerId: msg.playerId };
      localStorage.setItem(KEY, JSON.stringify(s));
      setSaved(s);
      setJoining(false);
    } else if (msg.type === 'error') {
      setJoining(false);
      if (msg.fatal) { localStorage.removeItem(KEY); setSaved(null); }
    }
  }, []);

  const { status, state, send, now, lastError, clearError } = useRoom({ onOpen, onMessage });

  const join = (e) => {
    e.preventDefault();
    clearError();
    const c = code.trim().toUpperCase();
    localStorage.setItem(KEY, JSON.stringify({ code: c, name: name.trim(), emoji }));
    setJoining(true);
    send({ type: 'player:join', code: c, name: name.trim(), emoji });
  };
  const leave = () => { localStorage.removeItem(KEY); setSaved(null); location.href = '/'; };
  const onMove = useCallback((p) => send({ type: 'player:move', x: p.x, y: p.y }), [send]);

  const inRoom = saved?.playerId && state && state.room.code === saved.code;

  if (!inRoom) {
    return (
      <main className="player centre">
        <h1 className="brand">Spatial Quiz</h1>
        <form className="card join" onSubmit={join}>
          <label>Room code
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} placeholder="ABCD" autoCapitalize="characters" autoComplete="off" required />
          </label>
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="e.g. Sam" required />
          </label>
          <div className="emoji-grid">
            {EMOJI.map((e) => <button type="button" key={e} className={e === emoji ? 'on' : ''} onClick={() => setEmoji(e)}>{e}</button>)}
          </div>
          <button className="primary" disabled={status !== 'open' || joining}>{joining ? 'Joining…' : 'Join'}</button>
          {lastError && <p className="error">{lastError}</p>}
          {saved?.playerId && <p className="muted">Reconnecting as {saved.name}…</p>}
        </form>
      </main>
    );
  }

  const { room, question: q, players, reveal } = state;
  const me = players.find((p) => p.id === saved.playerId);
  const rank = players.findIndex((p) => p.id === saved.playerId) + 1;

  return (
    <main className={`player phase-${room.phase}`}>
      <header className="topbar">
        {me && <Avatar player={me} size="sm" me />}
        <span className="name">{me?.name}</span>
        <span className="muted">#{rank} · {me?.score ?? 0} pts</span>
        <span className={`status ${status}`}>{status === 'open' ? 'live' : status}</span>
      </header>

      {room.phase === 'lobby' && (
        <section className="centre">
          <h2>You're in!</h2>
          <p className="muted">Room {room.code} · {players.length} joined</p>
          <p>When a question appears, <b>drag anywhere on the board</b> to move your avatar. Where you are when the clock hits zero is your answer.</p>
          {!room.hostOnline && <p className="muted">Waiting for the host to connect…</p>}
          <button className="link" onClick={leave}>Leave</button>
        </section>
      )}

      {(room.phase === 'question' || room.phase === 'reveal') && q && (
        <section className="stage">
          <div className="question-head">
            <span className="qnum">Q{q.index + 1}/{q.total} · {q.points} pts</span>
            <h2>{q.prompt}</h2>
            {room.phase === 'question' && <Timer endsAt={room.endsAt} timeLimit={q.timeLimit} now={now} />}
          </div>
          <Board question={q} players={players} meId={saved.playerId} reveal={reveal} interactive={room.phase === 'question'} onMove={onMove} />
          {room.phase === 'reveal' && (
            <div className={`result-card ${me?.result?.delta > 0 ? 'pos' : me?.result?.delta < 0 ? 'neg' : ''}`}>
              <div className="delta">{me?.result ? signed(me.result.delta) : '0'}</div>
              <div>
                <div className="muted">Answer: <b>{describeAnswer(q, reveal)}</b></div>
                {me?.result?.value === null && <div className="muted">You didn't place in time.</div>}
                {reveal?.note && <div className="note">{reveal.note}</div>}
              </div>
            </div>
          )}
        </section>
      )}

      {room.phase === 'final' && (
        <section className="final">
          <h2>{rank === 1 ? '🏆 You won!' : `You came #${rank}`}</h2>
          <Leaderboard players={players} meId={saved.playerId} />
          <button className="link" onClick={leave}>Leave</button>
        </section>
      )}
    </main>
  );
}
