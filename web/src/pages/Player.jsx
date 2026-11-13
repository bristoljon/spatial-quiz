import { useState, useCallback, useEffect, useRef } from 'react';
import { useRoom } from '../useRoom.js';
import { usePreload } from '../usePreload.js';
import { useFx } from '../useFx.js';
import Board from '../components/Board.jsx';
import Timer from '../components/Timer.jsx';
import Avatar from '../components/Avatar.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import PowerBar from '../components/PowerBar.jsx';
import RoundHead from '../components/RoundHead.jsx';
import { POWERS, REPLENISH_LABEL } from '../../../shared/powers.js';
import { describeAnswer, signed } from '../format.js';
import { COLORS, initialsOf } from '../../../shared/avatar.js';

const KEY = 'sq:player';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };

export default function Player() {
  const [saved, setSaved] = useState(load);
  const params = new URLSearchParams(location.search);
  const [code, setCode] = useState((params.get('c') || saved?.code || '').toUpperCase());
  const [name, setName] = useState(saved?.name || '');
  const [color, setColor] = useState(saved?.color || COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [joining, setJoining] = useState(false);
  const [arming, setArming] = useState(null); // power-up waiting for a target

  const onOpen = useCallback((send) => {
    const s = load();
    if (s?.playerId) send({ type: 'player:join', code: s.code, playerId: s.playerId, name: s.name, color: s.color });
  }, []);
  const [fx, onFx] = useFx();
  const onMessage = useCallback((msg) => {
    onFx(msg);
    if (msg.type === 'player:ok') {
      const s = { ...(load() || {}), code: msg.code, playerId: msg.playerId };
      localStorage.setItem(KEY, JSON.stringify(s));
      setSaved(s);
      setJoining(false);
    } else if (msg.type === 'error') {
      setJoining(false);
      if (msg.fatal) { localStorage.removeItem(KEY); setSaved(null); }
    }
  }, [onFx]);

  const { status, state, send, now, lastError, clearError } = useRoom({ onOpen, onMessage });
  // Pull every clip in the quiz into memory from the lobby onwards, and tell
  // the host as each one lands (again on reconnect, since `send` is fresh).
  const sources = usePreload(state?.quiz.videos, useCallback((src) => send({ type: 'player:loaded', src }), [send]));
  const loadedRef = useRef(sources);
  loadedRef.current = sources;
  useEffect(() => { if (status === 'open') for (const src of Object.keys(loadedRef.current)) send({ type: 'player:loaded', src }); }, [status, send]);

  const initials = initialsOf(name);
  const join = (e) => {
    e.preventDefault();
    clearError();
    const c = code.trim().toUpperCase();
    localStorage.setItem(KEY, JSON.stringify({ code: c, name: name.trim(), color }));
    setJoining(true);
    send({ type: 'player:join', code: c, name: name.trim(), color });
  };
  const leave = () => { localStorage.removeItem(KEY); setSaved(null); location.href = '/'; };
  const onMove = useCallback((p, release = false) => send({ type: 'player:move', x: p.x, y: p.y, release }), [send]);
  const usePower = useCallback((power, target) => {
    clearError();
    const def = POWERS.find((p) => p.id === power);
    if (def?.targeted && !target) { setArming((a) => (a === power ? null : power)); return; }
    setArming(null);
    send({ type: 'player:power', power, target });
  }, [send, clearError]);
  const onTarget = useCallback((id) => { if (id && arming) usePower(arming, id); else setArming(null); }, [arming, usePower]);

  const inRoom = saved?.playerId && state && state.room.code === saved.code;
  const me = inRoom ? state.players.find((p) => p.id === saved.playerId) : null;
  const phase = state?.room.phase;

  // Desktop: arrow keys nudge your avatar (shift for bigger steps).
  useEffect(() => {
    if (phase !== 'question' || !me) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { setArming(null); return; }
      const pw = POWERS.find((p) => p.key === e.key);
      if (pw) { if (state?.me?.powers?.[pw.id] === 'available' && !(pw.needsPlacement && me.x === null)) usePower(pw.id); return; }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.02 : 0.005;
      const x = me.x ?? 0.5, y = me.y ?? 0.5;
      onMove({ x: Math.max(0, Math.min(1, x + d[0] * step)), y: Math.max(0, Math.min(1, y + d[1] * step)) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, me?.x, me?.y, onMove, usePower, state?.me?.powers]);
  useEffect(() => setArming(null), [state?.room.qIndex]);

  if (!inRoom) {
    return (
      <main className="player centre">
        <h1 className="brand">Spatial Quiz</h1>
        <form className="card join" onSubmit={join}>
          <label>Room code
            <input className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} placeholder="ABCD" autoCapitalize="characters" autoComplete="off" required />
          </label>
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="e.g. Sam" required />
          </label>
          <div className="avatar-picker">
            <Avatar player={{ tag: initials, color }} size="lg" />
            <div className="avatar-fields">
              <span className="muted">Your initials, in a colour of your choice</span>
              <div className="swatches">
                {COLORS.map((c) => <button type="button" key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
              </div>
            </div>
          </div>
          <button className="primary" disabled={status !== 'open' || joining}>{joining ? 'Joining…' : 'Join'}</button>
          {lastError && <p className="error">{lastError}</p>}
          {saved?.playerId && <p className="muted">Reconnecting as {saved.name}…</p>}
        </form>
      </main>
    );
  }

  const { room, question: q, players, reveal } = state;
  const rank = players.findIndex((p) => p.id === saved.playerId) + 1;

  return (
    <main className={`player phase-${room.phase}`}>
      <header className="topbar">
        {me && <Avatar player={me} size="sm" me />}
        <span className="name">{me?.name}</span>
        <span className="muted">#{rank} · {me?.score ?? 0} pts</span>
        <span className="muted room-code">Room {room.code}</span>
        <span className={`status ${status}`}>{status === 'open' ? 'live' : status}</span>
      </header>

      {room.phase === 'lobby' && (
        <section className="centre">
          <h2>You're in!</h2>
          <p className="muted">Room {room.code} · {players.length} joined</p>
          <p>When a question appears, <b>click or drag anywhere on the board</b> to move your avatar. Where you are when the clock hits zero is your answer.</p>
          <p className="muted">On a keyboard, arrow keys nudge you (hold shift for bigger steps).</p>
          <div className="power-intro">
            {POWERS.map((p) => <div key={p.id}><span className="icon">{p.icon}</span><b>{p.name}</b> <span className="muted">{p.desc}</span></div>)}
            <p className="muted">{REPLENISH_LABEL[state.quiz.replenish] || REPLENISH_LABEL.round}</p>
          </div>
          {state.quiz.speedBonus > 0 && <p className="muted">🏁 The first player to settle on the right answer gets +{state.quiz.speedBonus}. Moving again resets your time.</p>}
          <div className="avatar-grid">
            {players.map((p) => <div key={p.id} className="lobby-player"><Avatar player={p} size="md" me={p.id === saved.playerId} /><span>{p.name}</span></div>)}
          </div>
          {!room.hostOnline && <p className="muted">Waiting for the host to connect…</p>}
          <button className="link" onClick={leave}>Leave</button>
        </section>
      )}

      {(room.phase === 'intro' || room.phase === 'question' || room.phase === 'locked' || room.phase === 'reveal') && q && (
        <section className="stage">
          <div className="question-head">
            <RoundHead q={q} phase={room.phase} replenished={room.replenished} />
            <h2>{q.prompt}</h2>
            {room.phase === 'question' && <Timer endsAt={room.endsAt} timeLimit={q.timeLimit} now={now} />}
          </div>
          <div className="stage-body">
            <div className="board-col">
              {room.phase === 'intro' && (
                <div className="banner">{q.type === 'video' ? '🎬 Watch. The clock starts when the host pauses the clip.' : '👀 Get ready. The host will start the clock.'}</div>
              )}
              {room.phase === 'locked' && <div className="banner">🔒 Answers locked. Let\'s see what happened…</div>}
              <Board
                question={q} players={players} meId={saved.playerId}
                controlId={state.me?.possessing || saved.playerId}
                reveal={reveal} hint={state.me?.hint}
                interactive={room.phase === 'question' && !state.me?.possessed}
                onMove={onMove} targeting={arming} onTarget={onTarget} fx={fx}
                video={room.video} now={now} sources={sources}
                notice={state.me?.possessed && room.phase === 'question' ? { tone: 'bad', text: state.me.possessed.dropped ? '🕹️ Possessed and locked until the reveal' : '🕹️ Someone is moving you!' } : null}
              />
              {room.phase === 'question' && <div className="mobile-only"><PowerBar status={state.me?.powers} onUse={usePower} arming={arming} placed={me?.x !== null && me?.x !== undefined} /></div>}
              {lastError && <p className="error">{lastError}</p>}
            </div>
            <aside className="side">
              {room.phase === 'question' && <div className="desktop-only"><PowerBar status={state.me?.powers} onUse={usePower} arming={arming} placed={me?.x !== null && me?.x !== undefined} /></div>}
              {room.phase === 'reveal' && (
                <div className={`result-card ${me?.result?.delta > 0 ? 'pos' : me?.result?.delta < 0 ? 'neg' : ''}`}>
                  <div className="delta">{me?.result ? signed(me.result.delta) : '0'}</div>
                  <div>
                    <div className="muted">Answer: <b>{describeAnswer(q, reveal)}</b></div>
                    {me?.result?.value === null && <div className="muted">You didn't place in time.</div>}
                    {me?.result?.fastest && <div className="fastest">🏁 Fastest correct answer, +{state.quiz.speedBonus}</div>}
                    {me?.powers?.length > 0 && <div className="muted">Used: {me.powers.map((id) => POWERS.find((p) => p.id === id)?.name).join(' + ')}</div>}
                    {reveal?.note && <div className="note">{reveal.note}</div>}
                  </div>
                </div>
              )}
              <Leaderboard players={players} meId={saved.playerId} limit={10} showDelta={room.phase === 'reveal'} />
            </aside>
          </div>
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
