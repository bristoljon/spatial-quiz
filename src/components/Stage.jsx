// The big-screen view (host display / projector / Teams share).
import { LETTERS, Quote, Timer, QR, Fmt, Hills } from './bits.jsx';

export default function Stage({ state, answeredBy }) {
  if (!state) return <div className="stage center"><div className="spinner" /></div>;
  const view = {
    lobby: <Lobby state={state} />,
    roundIntro: <RoundIntro state={state} />,
    question: <QuestionStage state={state} />,
    locked: <QuestionStage state={state} />,
    reveal: <QuestionStage state={state} />,
    leaderboard: <Leaderboard state={state} />,
    end: <Podium state={state} />,
  }[state.phase];
  return (
    <div className={`stage phase-${state.phase}`}>
      {view}
      <Hills />
    </div>
  );
}

function joinUrl(code) {
  return `${window.location.origin}/j/${code}`;
}

function Lobby({ state }) {
  const url = joinUrl(state.code);
  return (
    <div className="lobby">
      <div className="lobby-left">
        <p className="eyebrow">{state.subtitle}</p>
        <h1 className="display">{state.title}</h1>
        <p className="join-how">Join on your phone at <strong>{window.location.host}</strong> with code</p>
        <div className="code">{state.code}</div>
        <ol className="round-list">
          {state.rounds.map((r, i) => <li key={i}><span>{i + 1}</span>{r}</li>)}
        </ol>
      </div>
      <div className="lobby-right">
        <QR text={url} size={260} />
        <p className="muted">{state.players.length} {state.players.length === 1 ? 'team' : 'teams'} in</p>
        <div className="names">
          {state.players.map((p) => <span key={p.pid} className="name-pill pop">{p.name}</span>)}
        </div>
      </div>
    </div>
  );
}

function RoundIntro({ state }) {
  const r = state.round;
  return (
    <div className="round-intro">
      <p className="eyebrow">Round {r.index + 1} of {r.total}</p>
      <h1 className="display huge">{r.title}</h1>
      <p className="intro">{r.intro}</p>
      <p className="muted">{r.count} questions</p>
    </div>
  );
}

function QuestionStage({ state }) {
  const q = state.question;
  const rv = state.phase === 'reveal' ? state.reveal : null;
  return (
    <div className={`qstage type-${q.type}`}>
      <header className="qhead">
        <span className="eyebrow">{state.round?.title} · Q{state.qnum}/{state.round?.count}</span>
        <span className="pts">{q.points} pts</span>
      </header>
      <h2 className="prompt">{q.prompt}</h2>
      <div className="qbody">
        <Body q={q} rv={rv} state={state} />
      </div>
      <footer className="qfoot">
        {state.phase === 'question' && <Timer state={state} />}
        {state.phase === 'locked' && <div className="banner">Time's up! Answers locked</div>}
        {state.phase !== 'reveal' && (
          <span className="answered">{state.answered || 0}/{state.players.length} answered</span>
        )}
        {rv?.note && <p className="note">{rv.note}</p>}
      </footer>
      {rv && <TopScorers state={state} />}
    </div>
  );
}

function TopScorers({ state }) {
  const got = state.leaderboard.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  if (!got.length) return <div className="top-scorers"><span className="muted">Nobody scored on that one!</span></div>;
  return (
    <div className="top-scorers">
      {got.map((r) => <span key={r.pid} className="name-pill">{r.name} <b>+{r.delta}</b></span>)}
    </div>
  );
}

function Body({ q, rv, state }) {
  switch (q.type) {
    case 'choice':
    case 'multi':
      return (
        <>
          {q.quote && <Quote quote={q.quote} big />}
          <Options q={q} rv={rv} />
          {q.type === 'multi' && !rv && <p className="muted">Pick all that apply</p>}
        </>
      );
    case 'reveal':
      return (
        <div className="reveal-wrap">
          <div className="reveal-img">
            {q.src && <img key={q.src} src={q.src} alt="Mystery photo" className={rv ? 'unzoom' : 'zoomin'} />}
            {!rv && <div className="stage-pips">{Array.from({ length: q.stages }, (_, i) => <span key={i} className={i <= q.stage ? 'on' : ''} />)}</div>}
            {!rv && <div className="stage-pts">Lock in now for {Math.round(q.points * Math.max(0.3, (q.stages - q.stage) / q.stages))} pts</div>}
          </div>
          {q.options ? <Options q={q} rv={rv} compact /> : rv && (
            <div className="reveal-answer">
              <div className="answer-big">{rv.answerText}</div>
              <Words stats={rv.stats} />
            </div>
          )}
        </div>
      );
    case 'order':
      return rv ? (
        <ol className="order-list reveal">
          {rv.answer.map((id, i) => {
            const it = rv.items.find((x) => x.id === id);
            return <li key={id} style={{ animationDelay: `${i * 0.12}s` }}><span className="rank">{i + 1}</span>{it.text}{rv.values && <b className="val">{rv.values[id]}</b>}</li>;
          })}
        </ol>
      ) : (
        <div className="order-pool">
          {q.labels && <span className="muted">{q.labels.first} → {q.labels.last}</span>}
          <div className="chips">{q.items.map((it) => <span key={it.id} className="chip">{it.text}</span>)}</div>
        </div>
      );
    case 'match':
      if (!rv) {
        return (
          <div className="match-cols">
            <div>{q.left.map((l) => <span key={l.id} className="chip left">{l.text}</span>)}</div>
            <div>{q.right.map((r) => <span key={r.id} className="chip right">{r.text}</span>)}</div>
          </div>
        );
      }
      return (
        <div className="match-grid">
          {q.left.map((l, i) => {
            const right = rv ? q.right.find((r) => r.id === rv.answer[l.id]) : q.right[i];
            return (
              <div key={l.id} className={`match-row ${rv ? 'done' : ''}`} style={{ animationDelay: `${i * 0.1}s` }}>
                <span className="chip left">{l.text}</span>
                <span className="link">{rv ? '⟶' : ''}</span>
                <span className="chip right">{right?.text}</span>
              </div>
            );
          })}
        </div>
      );
    case 'blanks':
      return <Blanks q={q} rv={rv} />;
    case 'slider':
      return <SliderStage q={q} rv={rv} />;
    case 'text':
      return rv ? (
        <div className="reveal-answer"><div className="answer-big">{rv.answer}</div><Words stats={rv.stats} /></div>
      ) : <div className="type-hint">Type your answer on your phone</div>;
    default:
      return null;
  }
}

function Options({ q, rv, compact }) {
  const counts = rv?.stats?.counts;
  const n = Math.max(1, rv?.stats?.n || 0);
  const correct = rv ? new Set(Array.isArray(rv.answer) ? rv.answer : [rv.answer]) : null;
  const hasImages = q.options.some((o) => o.image);
  return (
    <div className={`options ${hasImages ? 'images' : ''} ${compact ? 'compact' : ''} n${q.options.length}`}>
      {q.options.map((o, i) => {
        const state = correct ? (correct.has(o.id) ? 'right' : 'wrong') : '';
        return (
          <div key={o.id} className={`opt c${i % 6} ${state}`}>
            {o.image && <img src={o.image} alt={`Option ${LETTERS[i]}`} />}
            <div className="opt-label">
              <span className="letter">{LETTERS[i]}</span>
              {!o.image && <span className="opt-text">{o.text}</span>}
              {counts && <span className="count">{counts[o.id] || 0}</span>}
            </div>
            {counts && <div className="opt-bar" style={{ transform: `scaleX(${(counts[o.id] || 0) / n})` }} />}
          </div>
        );
      })}
    </div>
  );
}

function Blanks({ q, rv }) {
  const parts = q.text.split(/(\{\d+\})/g);
  return (
    <div className="blanks">
      <p className="sentence">
        {parts.map((p, i) => {
          const m = p.match(/^\{(\d+)\}$/);
          if (!m) return <span key={i}>{p}</span>;
          const k = Number(m[1]);
          return <span key={i} className={`gap ${rv ? 'filled' : ''}`}>{rv ? rv.answer[k] : `  ${k + 1}  `}</span>;
        })}
      </p>
      {!rv && q.blanks.some((b) => b.options) && (
        <div className="blank-opts">
          {q.blanks.map((b, k) => b.options && (
            <div key={k}><span className="gapnum">{k + 1}</span>{b.options.join(' · ')}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function SliderStage({ q, rv }) {
  const pct = (v) => `${((v - q.min) / (q.max - q.min)) * 100}%`;
  const guesses = rv?.stats?.guesses || [];
  let closest = null;
  if (rv) guesses.forEach((g) => { if (!closest || Math.abs(g.v - rv.answer) < Math.abs(closest.v - rv.answer)) closest = g; });
  return (
    <div className="slider-stage">
      <div className="track">
        <span className="end l"><Fmt v={q.min} unit={q.unit} /></span>
        <span className="end r"><Fmt v={q.max} unit={q.unit} /></span>
        {guesses.map((g, i) => (
          <span key={g.pid} className="dot" title={`${g.name}: ${g.v}`} style={{ left: pct(g.v), animationDelay: `${i * 0.05}s` }} />
        ))}
        {rv && (
          <span className="answer-mark" style={{ left: pct(rv.answer) }}>
            <b><Fmt v={rv.answer} unit={q.unit} /></b>
          </span>
        )}
      </div>
      {closest && <p className="closest">Closest: <b>{closest.name}</b> with <Fmt v={closest.v} unit={q.unit} /></p>}
      {!rv && <div className="type-hint">Slide to your guess on your phone</div>}
    </div>
  );
}

function Words({ stats }) {
  if (!stats?.top?.length) return null;
  const max = stats.top[0].c;
  return (
    <div className="words">
      {stats.top.map((w) => <span key={w.text} style={{ fontSize: `${1 + (w.c / max) * 1.2}rem` }}>{w.text}</span>)}
    </div>
  );
}

function Leaderboard({ state }) {
  const rows = state.leaderboard.slice(0, 12);
  const max = Math.max(1, ...rows.map((r) => r.score));
  return (
    <div className="leaderboard">
      <p className="eyebrow">After round {(state.r ?? 0) + 1}</p>
      <h1 className="display">Leaderboard</h1>
      <ol>
        {rows.map((r, i) => (
          <li key={r.pid} style={{ animationDelay: `${(rows.length - i) * 0.08}s` }}>
            <span className="rank">{r.rank}</span>
            <span className="lb-name">{r.name}</span>
            <span className="lb-bar"><span style={{ transform: `scaleX(${r.score / max})` }} /></span>
            <span className="lb-score">{r.score}</span>
          </li>
        ))}
      </ol>
      {state.leaderboard.length > 12 && <p className="muted">+ {state.leaderboard.length - 12} more</p>}
    </div>
  );
}

function Podium({ state }) {
  const [a, b, c] = state.leaderboard;
  const rest = state.leaderboard.slice(3, 10);
  return (
    <div className="podium-wrap">
      <h1 className="display">Final scores</h1>
      <div className="podium">
        {[b, a, c].map((r, i) => r && (
          <div key={r.pid} className={`step s${[2, 1, 3][i]}`}>
            <span className="pname">{r.name}</span>
            <span className="pscore">{r.score}</span>
            <div className="pblock">{r.rank}</div>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <p className="rest">{rest.map((r) => `${r.rank}. ${r.name} (${r.score})`).join('   ')}</p>
      )}
      <Confetti />
    </div>
  );
}

function Confetti() {
  const bits = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 12) * 0.25}s`, background: ['#9be15d', '#ffd166', '#ff7a6b', '#6bc6ff', '#c49bff'][i % 5] }} />
      ))}
    </div>
  );
}
