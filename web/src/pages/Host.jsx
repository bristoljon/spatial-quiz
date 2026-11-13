import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import QRCode from 'qrcode';
import { useRoom } from '../useRoom.js';
import { usePreload } from '../usePreload.js';
import { useFx } from '../useFx.js';
import Board from '../components/Board.jsx';
import Timer from '../components/Timer.jsx';
import Avatar from '../components/Avatar.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import { describeAnswer } from '../format.js';
import RoundHead from '../components/RoundHead.jsx';

const KEY = 'sq:host';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };

export default function Host() {
  const [creds, setCreds] = useState(load);
  const [pin, setPin] = useState('');

  const onOpen = useCallback((send) => {
    const c = load();
    if (c) send({ type: 'host:join', code: c.code, token: c.token });
  }, []);
  const [fx, onFx] = useFx();
  const onMessage = useCallback((msg) => {
    onFx(msg);
    if (msg.type === 'host:ok') {
      const c = { code: msg.code, token: msg.token };
      localStorage.setItem(KEY, JSON.stringify(c));
      setCreds(c);
    } else if (msg.type === 'error' && msg.fatal) {
      localStorage.removeItem(KEY);
      setCreds(null);
    }
  }, [onFx]);

  const { status, state, send, now, lastError, clearError } = useRoom({ onOpen, onMessage });
  const phase = state?.room.phase;
  const q = state?.question;
  const sources = usePreload(state?.quiz.videos);

  // Video questions: this screen's <video> is the one everyone follows.
  const videoRef = useRef(null);
  const hasVideo = q?.type === 'video';
  const canSteer = hasVideo && (phase === 'intro' || phase === 'locked' || phase === 'reveal');
  const report = useCallback((playing) => {
    const el = videoRef.current;
    if (el) send({ type: 'host:video', playing, t: el.currentTime });
  }, [send]);
  const play = useCallback(() => { const el = videoRef.current; if (!el || !canSteer) return; el.play().catch(() => {}); report(true); }, [canSteer, report]);
  const pause = useCallback(() => { const el = videoRef.current; if (!el || !canSteer) return; el.pause(); report(false); }, [canSteer, report]);
  const toggle = useCallback(() => (videoRef.current?.paused ? play() : pause()), [play, pause]);
  const seek = useCallback((d) => {
    const el = videoRef.current;
    if (!el || !canSteer) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 1e9, el.currentTime + d));
    report(!el.paused);
  }, [canSteer, report]);
  const startClock = useCallback(() => {
    const el = videoRef.current;
    if (el) el.pause();
    send({ type: 'host:clock', t: el ? el.currentTime : undefined });
  }, [send]);
  // Heartbeat while playing (keeps phones in step) and a final pause when the clip ends.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !hasVideo) return;
    const onEnded = () => report(false);
    el.addEventListener('ended', onEnded);
    const id = setInterval(() => { if (!el.paused && !el.ended) report(true); }, 3000);
    return () => { el.removeEventListener('ended', onEnded); clearInterval(id); };
  }, [hasVideo, q?.id, report]);
  // video.pauseAt: while the clip is on the intro screen, stop it the moment
  // playback crosses that time, so the host doesn't have to judge the pause.
  // Playing on from there (or past it after a seek) isn't stopped again.
  const pauseAt = hasVideo ? q.video.pauseAt : undefined;
  useEffect(() => {
    const el = videoRef.current;
    if (!el || typeof pauseAt !== 'number' || phase !== 'intro') return;
    let last = el.currentTime;
    let raf;
    const tick = () => {
      const t = el.currentTime;
      if (!el.paused && last < pauseAt && t >= pauseAt) {
        el.pause();
        el.currentTime = pauseAt;
        report(false);
      }
      last = el.currentTime;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pauseAt, q?.id, phase, report]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const next = () => send({ type: 'host:next' });
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (canSteer && phase !== 'reveal') toggle();
          else if (phase === 'intro') startClock();
          else if (phase !== 'question' && phase !== 'locked') next();
          break;
        case 'Enter':
          if (phase === 'intro') startClock();
          else if (phase === 'locked') send({ type: 'host:reveal' });
          else if (phase !== 'question') next();
          break;
        case 'ArrowRight': if (canSteer) seek(5); else if (phase !== 'question' && phase !== 'locked') next(); break;
        case 'ArrowLeft': if (canSteer) seek(-5); break;
        case 'e': if (phase === 'question') send({ type: 'host:end' }); break;
        case 'f': document.documentElement.requestFullscreen?.(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, send, canSteer, toggle, seek, startClock]);

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

  const { room, players, reveal, quiz } = state;
  const placed = players.filter((p) => p.x !== null).length;
  const hidden = players.filter((p) => p.hidden).length;
  const live = room.phase === 'intro' || room.phase === 'question' || room.phase === 'locked' || room.phase === 'reveal';

  return (
    <main className={`host phase-${room.phase}`}>
      <header className="topbar">
        <span className="brand">{quiz.title}</span>
        <span className="code">Join at <b>{location.host}</b> · code <b>{room.code}</b></span>
        <Status status={status} />
      </header>

      {room.phase === 'lobby' && <Lobby room={room} players={players} onStart={() => send({ type: 'host:start' })} />}

      {live && q && (
        <section className="stage">
          <div className="question-head">
            <RoundHead q={q} phase={room.phase} replenished={room.replenished} />
            <h2>{q.prompt}</h2>
            {room.phase === 'question' && <Timer endsAt={room.endsAt} timeLimit={q.timeLimit} now={now} big />}
          </div>
          <div className="stage-body">
            <Board question={q} players={players} reveal={reveal} fx={fx} size="lg" video={room.video} videoRef={hasVideo ? videoRef : null} now={now} sources={sources} />
            <aside className="side">
              {room.phase === 'intro' && (
                <>
                  {hasVideo && <VideoControls videoRef={videoRef} playing={!!room.video?.playing} onToggle={toggle} onSeek={seek} />}
                  {hasVideo && <ClipReady players={players} />}
                  <div className="muted">{hasVideo ? (typeof pauseAt === 'number' ? 'Play it: it stops itself at the moment to guess from. Then start the clock.' : 'Pause at the moment to guess from, then start the clock.') :'Start the clock when you\'re ready.'}</div>
                  <button className="primary" onClick={startClock}>Start the clock · {q.timeLimit}s <kbd>⏎</kbd></button>
                  <Leaderboard players={players} limit={12} />
                </>
              )}
              {room.phase === 'question' && (
                <>
                  <div className="stat"><b>{placed + hidden}</b> / {players.length} placed</div>
                  {hidden > 0 && <div className="stat small">👻 <b>{hidden}</b> invisible</div>}
                  <button onClick={() => send({ type: 'host:end' })}>End now <kbd>E</kbd></button>
                  <Leaderboard players={players} limit={12} />
                </>
              )}
              {room.phase === 'locked' && (
                <>
                  <div className="stat">🔒 Answers locked</div>
                  {hasVideo && <VideoControls videoRef={videoRef} playing={!!room.video?.playing} onToggle={toggle} onSeek={seek} resume />}
                  <button className="primary" onClick={() => send({ type: 'host:reveal' })}>Show results <kbd>⏎</kbd></button>
                  <Leaderboard players={players} limit={12} />
                </>
              )}
              {room.phase === 'reveal' && (
                <>
                  <div className="answer-card">
                    <div className="muted">Answer</div>
                    <div className="answer">{describeAnswer(q, reveal)}</div>
                    {reveal?.note && <p className="note">{reveal.note}</p>}
                  </div>
                  <Leaderboard players={players} limit={12} showDelta />
                  <button className="primary" onClick={() => send({ type: 'host:next' })}>
                    {q.index + 1 >= q.total ? 'Final scores' : 'Next question'} <kbd>⏎</kbd>
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

// How many phones have the clip in memory. The rest will stream it, which
// works but can lag on a busy wifi.
function ClipReady({ players }) {
  const online = players.filter((p) => p.online);
  const ready = online.filter((p) => p.ready).length;
  const all = ready === online.length;
  return (
    <div className={`stat small ${all ? 'good' : ''}`}>
      {all ? '✅' : '⏳'} <b>{ready}</b> / {online.length} phones have the clip
    </div>
  );
}

// Play/pause and ±5s for the host's clip, with where it's up to.
function VideoControls({ videoRef, playing, onToggle, onSeek, resume = false }) {
  const [t, setT] = useState({ at: 0, dur: 0 });
  useEffect(() => {
    const id = setInterval(() => { const el = videoRef.current; if (el) setT({ at: el.currentTime, dur: el.duration || 0 }); }, 200);
    return () => clearInterval(id);
  }, [videoRef]);
  return (
    <div className="video-controls">
      <button onClick={() => onSeek(-5)} title="Back 5s">⏪ <kbd>←</kbd></button>
      <button className="play" onClick={onToggle}>{playing ? '⏸ Pause' : resume && t.at > 0 ? '▶ Resume' : '▶ Play'} <kbd>␣</kbd></button>
      <button onClick={() => onSeek(5)} title="Forward 5s">⏩ <kbd>→</kbd></button>
      <span className="time">{clock(t.at)} / {clock(t.dur)}</span>
    </div>
  );
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

function Status({ status }) {
  return <span className={`status ${status}`} title={status}>{status === 'open' ? 'live' : status}</span>;
}
