import { useCallback, useEffect, useRef, useState } from 'react';
import { api, saved, useTick, secondsLeft } from '../api.js';
import Stage from '../components/Stage.jsx';

// Host = big screen + control bar. Polls the uncached status endpoint so it
// always sees joins and answer counts first-hand.
export default function Host({ code }) {
  const hostKey = saved.get(`sq:host:${code}`);
  const [state, setState] = useState(null);
  const [answeredBy, setAnsweredBy] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoZoom, setAutoZoom] = useState(true);
  const [panel, setPanel] = useState(false);
  const vRef = useRef(0);

  const take = useCallback((s) => { if (s && (s.v || 0) >= vRef.current) { vRef.current = s.v; setState(s); } }, []);

  const act = useCallback(async (action, extra = {}) => {
    setBusy(true); setErr('');
    try { take((await api.host({ action, code, hostKey, ...extra })).state); } catch (e) { setErr(e.message); }
    setBusy(false);
  }, [code, hostKey, take]);

  // status poll
  useEffect(() => {
    if (!hostKey) return undefined;
    let stop = false, t;
    const tick = async () => {
      try {
        const r = await api.host({ action: 'status', code, hostKey });
        if (!stop) { take(r.state); setAnsweredBy(r.answeredBy || []); }
      } catch (e) { if (!stop) setErr(e.message); }
      if (!stop) t = setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [code, hostKey, take]);

  // auto-lock when the clock runs out; auto-zoom photo reveals
  useTick(500);
  const firedLock = useRef('');
  const lastZoom = useRef({ id: '', at: 0 });
  useEffect(() => {
    if (!state || state.phase !== 'question') return;
    const left = secondsLeft(state);
    if (left <= 0 && firedLock.current !== state.question.id + state.closesAt) {
      firedLock.current = state.question.id + state.closesAt;
      act('lock');
      return;
    }
    const q = state.question;
    if (autoZoom && q.type === 'reveal' && q.stage < q.stages - 1) {
      const per = q.timeLimit / q.stages;
      if (lastZoom.current.id !== q.id) lastZoom.current = { id: q.id, at: Date.now() };
      if (Date.now() - lastZoom.current.at > per * 1000 && !busy) {
        lastZoom.current.at = Date.now();
        act('zoom');
      }
    }
  });

  // keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); act('next'); }
      if (e.key === 'z') act('zoom');
      if (e.key === 'l') act('lock');
      if (e.key === 'f') document.documentElement.requestFullscreen?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act]);

  if (!hostKey) {
    return <div className="phone center"><div className="phone-inner"><h2>Not your room</h2><p className="muted">This browser doesn't have the host key for {code}.</p><a className="btn" href="/host">Host a new quiz</a></div></div>;
  }

  const nextLabel = {
    lobby: 'Start quiz', roundIntro: 'First question', question: 'Lock answers',
    locked: 'Reveal answer', reveal: 'Next', leaderboard: 'Next round', end: 'Finished',
  }[state?.phase] || 'Next';
  const lastInRound = state?.phase === 'reveal' && state.qnum === state.round?.count;

  return (
    <div className="host">
      <Stage state={state} answeredBy={answeredBy} />
      <div className="controls">
        <button className="btn primary" disabled={busy || state?.phase === 'end'} onClick={() => act('next')}>
          {lastInRound ? 'Show leaderboard' : nextLabel} <kbd>space</kbd>
        </button>
        {state?.phase === 'question' && state.question.type === 'reveal' && (
          <>
            <button className="btn" disabled={busy} onClick={() => act('zoom')}>Zoom out <kbd>z</kbd></button>
            <label className="toggle"><input type="checkbox" checked={autoZoom} onChange={(e) => setAutoZoom(e.target.checked)} /> auto</label>
          </>
        )}
        {(state?.phase === 'question' || state?.phase === 'locked') && (
          <button className="btn" disabled={busy} onClick={() => act('extend')}>+15s</button>
        )}
        <span className="spacer" />
        {err && <span className="error">{err}</span>}
        <span className="muted small">Room <b>{code}</b></span>
        <a className="btn ghost" href={`/screen/${code}`} target="_blank" rel="noreferrer">Screen ↗</a>
        <button className="btn ghost" onClick={() => setPanel((p) => !p)}>☰</button>
      </div>
      {panel && state && <Panel state={state} act={act} answeredBy={answeredBy} close={() => setPanel(false)} />}
    </div>
  );
}

function Panel({ state, act, answeredBy, close }) {
  const [qi, setQi] = useState(Math.max(0, state.qi));
  const answered = new Set(answeredBy);
  return (
    <aside className="panel">
      <button className="btn ghost close" onClick={close}>✕</button>
      <h3>Jump to</h3>
      <div className="row">
        {state.rounds.map((r, i) => <button key={i} className="btn small" onClick={() => act('round', { r: i })}>R{i + 1} intro</button>)}
      </div>
      <div className="row">
        <input type="number" min={0} max={state.totalQuestions - 1} value={qi} onChange={(e) => setQi(Number(e.target.value))} />
        <button className="btn small" onClick={() => act('goto', { qi })}>Open question #{qi}</button>
      </div>
      <div className="row">
        <button className="btn small" onClick={() => act('leaderboard')}>Leaderboard</button>
        <button className="btn small" onClick={() => act('end')}>End quiz</button>
      </div>
      <h3>Teams ({state.players.length})</h3>
      <ul className="team-list">
        {state.players.map((p) => (
          <li key={p.pid}>
            <span className={answered.has(p.pid) ? 'dot on' : 'dot'} title={answered.has(p.pid) ? 'answered' : 'waiting'} />
            <span className="t">{p.name}</span>
            <b>{state.scores[p.pid] || 0}</b>
            <button className="mini" onClick={() => act('adjust', { pid: p.pid, delta: -5 })}>−5</button>
            <button className="mini" onClick={() => act('adjust', { pid: p.pid, delta: 5 })}>+5</button>
          </li>
        ))}
      </ul>
      <p className="muted small">Keys: space/→ next · z zoom · l lock · f fullscreen</p>
    </aside>
  );
}
