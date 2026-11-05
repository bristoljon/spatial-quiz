import { useEffect, useState } from 'react';
import { api, saved, useRoomState } from '../api.js';
import PlayerInput from '../components/PlayerInput.jsx';
import { Timer } from '../components/bits.jsx';

export default function Play({ code }) {
  const credKey = `sq:player:${code}`;
  const [me, setMe] = useState(() => saved.get(credKey));
  const [state, error] = useRoomState(code, 1000);

  // quietly re-validate saved credentials once
  useEffect(() => {
    if (!me) return;
    api.join({ code, pid: me.pid, token: me.token }).catch((e) => {
      if (/rejoin|team name/i.test(e.message)) { saved.del(credKey); setMe(null); }
    });
  }, []); // eslint-disable-line

  if (error?.notFound) return <Shell><h2>Room {code} not found</h2><p className="muted">Check the code on the big screen.</p><a className="btn" href="/">Back</a></Shell>;
  if (!me) return <JoinForm code={code} onJoined={(c) => { saved.set(credKey, c); setMe(c); }} />;
  if (!state) return <Shell><div className="spinner" /></Shell>;
  return <Game state={state} me={me} code={code} onReset={() => { saved.del(credKey); setMe(null); }} />;
}

function Shell({ children, className = '' }) {
  return <div className={`phone ${className}`}><div className="phone-inner">{children}</div></div>;
}

function JoinForm({ code, onJoined }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onJoined(await api.join({ code, name })); } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  return (
    <Shell className="center">
      <p className="eyebrow">Joining room</p>
      <div className="code small">{code}</div>
      <form onSubmit={submit} className="stack">
        <label htmlFor="team">Team name</label>
        <input id="team" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoFocus placeholder="e.g. The Slad Lads" />
        {err && <p className="error">{err}</p>}
        <button className="btn primary block" disabled={busy || !name.trim()}>{busy ? 'Joining…' : 'Join quiz'}</button>
      </form>
    </Shell>
  );
}

function Game({ state, me, code, onReset }) {
  const ansKey = `sq:answers:${code}`;
  const [mine, setMine] = useState(() => saved.get(ansKey) || {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const q = state.question;

  useEffect(() => { setErr(''); }, [q?.id, state.phase]);

  const submit = async (answer) => {
    setBusy(true); setErr('');
    try {
      await api.answer({ code, pid: me.pid, token: me.token, qid: q.id, answer });
      const next = { ...mine, [q.id]: answer };
      setMine(next); saved.set(ansKey, next);
      if (navigator.vibrate) navigator.vibrate(30);
    } catch (e) {
      setErr(e.message);
      if (/rejoin/i.test(e.message)) onReset();
    }
    setBusy(false);
  };

  const myRow = state.leaderboard?.find((r) => r.pid === me.pid);
  const header = (
    <header className="p-head">
      <span className="p-name">{me.name}</span>
      {myRow && <span className="p-score">{myRow.score} pts · #{myRow.rank}</span>}
    </header>
  );

  switch (state.phase) {
    case 'lobby':
      return <Shell className="center">{header}<div className="big-emoji">🌳</div><h2>You're in!</h2><p className="muted">Watch the big screen. We'll start soon.</p></Shell>;
    case 'roundIntro':
      return <Shell className="center">{header}<p className="eyebrow">Round {state.round.index + 1}</p><h2 className="display">{state.round.title}</h2><p className="muted">{state.round.intro}</p></Shell>;
    case 'question':
      return (
        <Shell>
          {header}
          <Timer state={state} compact />
          <p className="eyebrow">Q{state.qnum} · {q.points} pts</p>
          <h3 className="p-prompt">{q.prompt}</h3>
          <PlayerInput key={q.id + (q.type === 'reveal' ? '' : '')} q={q} sent={mine[q.id]} busy={busy} onSubmit={submit} />
          {err && <p className="error">{err}</p>}
        </Shell>
      );
    case 'locked':
      return <Shell className="center">{header}<div className="big-emoji">⏱️</div><h2>Time's up</h2><p className="muted">{mine[q.id] !== undefined ? 'Answer in. Fingers crossed…' : 'You didn\'t answer that one.'}</p></Shell>;
    case 'reveal': {
      const res = state.last?.[me.pid];
      const ok = res?.ok;
      return (
        <Shell className={`center result ${ok === true ? 'good' : ok === 'partial' ? 'meh' : 'bad'}`}>
          {header}
          <div className="big-emoji">{ok === true ? '🎉' : ok === 'partial' ? '👍' : res?.answered ? '😬' : '💤'}</div>
          <h2>{ok === true ? 'Correct!' : ok === 'partial' ? 'Partly right' : res?.answered ? 'Not this time' : 'No answer'}</h2>
          <div className="delta">+{res?.pts || 0}</div>
          {state.reveal?.note && <p className="muted">{state.reveal.note}</p>}
        </Shell>
      );
    }
    case 'leaderboard':
    case 'end':
      return (
        <Shell className="center">
          {header}
          <p className="eyebrow">{state.phase === 'end' ? 'Final position' : 'Current position'}</p>
          <div className="rank-big">#{myRow?.rank ?? '–'}</div>
          <p className="muted">of {state.leaderboard.length} teams · {myRow?.score ?? 0} pts</p>
          {state.phase === 'end' && <p>Thanks for playing! 🍻</p>}
        </Shell>
      );
    default:
      return <Shell>{header}</Shell>;
  }
}
